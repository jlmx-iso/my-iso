import { OTP_MAX_ATTEMPTS } from "./limits";

/**
 * What `signIn("otp", { redirect: false })` resolves to, as far as this
 * module cares. The contract is documented in src/auth.ts.
 */
export type OtpSignInResult = {
  code?: string | null;
  error?: string | null;
  ok?: boolean;
};

export type OtpOutcome =
  | { kind: "signed_in" }
  /** Wrong or expired code; the same code can still be tried `attemptsLeft` times. */
  | { attemptsLeft: number; kind: "wrong_code" }
  /** The code has used up its attempts: only a new code will work. */
  | { kind: "locked" }
  /** Too many attempts from this browser or for this address; the code was not checked. */
  | { kind: "rate_limited" }
  | { kind: "failed" };

/**
 * Reads the result of an email-code sign-in.
 *
 * The server never says how many guesses a code has left (it answers the
 * same for wrong, expired and used-up codes), so the form counts the wrong
 * codes it has submitted since the last code was sent:
 * `wrongAttemptsBefore` is that count before this attempt.
 */
export function interpretOtpSignIn(
  result: OtpSignInResult | undefined,
  wrongAttemptsBefore: number,
): OtpOutcome {
  if (result?.ok && !result.error) return { kind: "signed_in" };
  if (result?.error !== "CredentialsSignin") return { kind: "failed" };
  if (result.code === "rate_limited") return { kind: "rate_limited" };

  const attemptsLeft = OTP_MAX_ATTEMPTS - (wrongAttemptsBefore + 1);
  return attemptsLeft <= 0 ? { kind: "locked" } : { attemptsLeft, kind: "wrong_code" };
}

/** What to tell the person; null when they are signed in. */
export function otpOutcomeMessage(outcome: OtpOutcome): string | null {
  switch (outcome.kind) {
    case "signed_in":
      return null;
    case "wrong_code":
      return outcome.attemptsLeft === 1
        ? "That code isn't right, or it has expired. You have 1 try left before you'll need a new code."
        : `That code isn't right, or it has expired. You have ${outcome.attemptsLeft} tries left before you'll need a new code.`;
    case "locked":
      return `That code no longer works: it was entered incorrectly ${OTP_MAX_ATTEMPTS} times. Send a new code to continue.`;
    case "rate_limited":
      return "Too many sign-in attempts. Wait 15 minutes, then send a new code. Entering codes before then won't work.";
    case "failed":
      return "We couldn't sign you in. Please try again.";
  }
}
