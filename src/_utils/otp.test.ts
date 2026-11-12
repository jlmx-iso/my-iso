import { describe, expect, it } from "vitest";

import { OTP_MAX_ATTEMPTS } from "./limits";
import { interpretOtpSignIn, otpOutcomeMessage } from "./otp";

const wrong = { code: "credentials", error: "CredentialsSignin", ok: false };
const limited = { code: "rate_limited", error: "CredentialsSignin", ok: false };

describe("interpretOtpSignIn", () => {
  it("recognises a successful sign-in", () => {
    expect(interpretOtpSignIn({ error: null, ok: true }, 0)).toEqual({ kind: "signed_in" });
  });

  it("counts down the tries a wrong code leaves", () => {
    expect(interpretOtpSignIn(wrong, 0)).toEqual({ attemptsLeft: OTP_MAX_ATTEMPTS - 1, kind: "wrong_code" });
    expect(interpretOtpSignIn(wrong, 3)).toEqual({ attemptsLeft: 1, kind: "wrong_code" });
  });

  it("locks the code on the attempt that uses it up, and after", () => {
    expect(interpretOtpSignIn(wrong, OTP_MAX_ATTEMPTS - 1)).toEqual({ kind: "locked" });
    expect(interpretOtpSignIn(wrong, OTP_MAX_ATTEMPTS + 3)).toEqual({ kind: "locked" });
  });

  it("tells a rate limit apart from a wrong code, whatever the count", () => {
    expect(interpretOtpSignIn(limited, 0)).toEqual({ kind: "rate_limited" });
    expect(interpretOtpSignIn(limited, OTP_MAX_ATTEMPTS)).toEqual({ kind: "rate_limited" });
  });

  it("treats a wrong code without a code field as a wrong code", () => {
    expect(interpretOtpSignIn({ error: "CredentialsSignin", ok: false }, 0).kind).toBe("wrong_code");
  });

  it("reports anything else as a plain failure", () => {
    expect(interpretOtpSignIn(undefined, 0)).toEqual({ kind: "failed" });
    expect(interpretOtpSignIn({ error: "Configuration", ok: false }, 0)).toEqual({ kind: "failed" });
    // `ok` with an error is not a sign-in.
    expect(interpretOtpSignIn({ error: "AccessDenied", ok: true }, 0)).toEqual({ kind: "failed" });
  });
});

describe("otpOutcomeMessage", () => {
  it("has nothing to say after signing in", () => {
    expect(otpOutcomeMessage({ kind: "signed_in" })).toBeNull();
  });

  it("says how many tries are left, with the right plural", () => {
    expect(otpOutcomeMessage({ attemptsLeft: 4, kind: "wrong_code" })).toMatch(/4 tries left/);
    expect(otpOutcomeMessage({ attemptsLeft: 1, kind: "wrong_code" })).toMatch(/1 try left/);
  });

  it("sends a locked-out person to a new code", () => {
    expect(otpOutcomeMessage({ kind: "locked" })).toMatch(/no longer works.*Send a new code/);
  });

  it("explains that a rate limit is about waiting, not about the code", () => {
    const message = otpOutcomeMessage({ kind: "rate_limited" });
    expect(message).toMatch(/Too many sign-in attempts/);
    expect(message).toMatch(/Wait 15 minutes/);
  });

  it("says an account still being deleted cannot be used yet", () => {
    expect(interpretOtpSignIn({ code: "deletion_pending", error: "CredentialsSignin" }, 0)).toEqual({
      kind: "deletion_pending",
    });
    expect(otpOutcomeMessage({ kind: "deletion_pending" })).toBe(
      "This account is still being deleted. Try again in a few minutes or contact support.",
    );
  });
});
