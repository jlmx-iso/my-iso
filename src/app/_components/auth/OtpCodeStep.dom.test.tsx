// @vitest-environment happy-dom
//
// The code step of email sign-in: six digits typed (or pasted) sign in at
// once, a wrong code says how many tries are left, the fifth locks the code
// until a new one is sent, the resend button waits out its cooldown, and
// every failure is said in the status line under the code.

import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NETWORK_ERROR_MESSAGE } from "~/_utils/userError";
import { renderWithProviders } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

vi.mock("next-auth/react", () => import("~/test/dom/session"));

import { OTP_RESEND_COOLDOWN_SECONDS, OtpCodeStep } from "./OtpCodeStep";

const EMAIL = "ann@example.com";
const WRONG = { code: "credentials", error: "CredentialsSignin", ok: false, status: 401, url: null };

/** A promise the test settles, to hold a request in flight. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

let assign: ReturnType<typeof vi.fn>;

beforeEach(() => {
  assign = vi.fn();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function renderStep(props: Partial<Parameters<typeof OtpCodeStep>[0]> = {}) {
  const onResend = vi.fn(() => Promise.resolve<string | null>(null));
  const onChangeEmail = vi.fn();
  const view = renderWithProviders(
    <OtpCodeStep email={EMAIL} destination="/app/events" onResend={onResend} onChangeEmail={onChangeEmail} {...props} />,
  );
  return { ...view, onChangeEmail, onResend };
}

const digits = () => screen.getAllByLabelText("Digit of your 6-digit sign-in code");
const status = () => screen.getByRole("status");

async function enterCode(code: string) {
  await userEvent.click(digits()[0]!);
  await userEvent.keyboard(code);
}

describe("OtpCodeStep", () => {
  it("names the address and the expiry, and keeps Verify off until six digits are in", async () => {
    renderStep();

    expect(screen.getByText(EMAIL)).toBeTruthy();
    expect(screen.getByText(/It expires in 10 minutes/)).toBeTruthy();
    expect(digits()).toHaveLength(6);
    expect(screen.getByRole("group", { name: "Enter your code" })).toBeTruthy();

    await enterCode("123");
    expect(screen.getByRole("button", { name: "Verify and sign in" }).hasAttribute("disabled")).toBe(true);
    expect(testSession.signInCalls).toEqual([]);
  });

  it("signs in as soon as the sixth digit is typed, then loads the destination", async () => {
    renderStep();

    await enterCode("123456");

    await waitFor(() => expect(assign).toHaveBeenCalledWith("/app/events"));
    expect(testSession.signInCalls).toEqual([
      { options: { code: "123456", email: EMAIL, redirect: false }, provider: "otp" },
    ]);
  });

  it("says it is checking, with the inputs and 'different email' off, while the code is verified", async () => {
    const answer = deferred<typeof WRONG>();
    testSession.onSignIn = () => answer.promise;
    renderStep();

    await enterCode("123456");

    expect(await screen.findByText("Checking your code…")).toBeTruthy();
    expect(digits().every((input) => input.hasAttribute("disabled"))).toBe(true);
    expect(screen.getByRole("button", { name: "Use a different email" }).hasAttribute("disabled")).toBe(true);

    await act(async () => answer.resolve(WRONG));
    expect(await screen.findByText(/You have 4 tries left/)).toBeTruthy();
  });

  it("counts down the tries left on wrong codes, clearing the inputs each time", async () => {
    testSession.onSignIn = () => Promise.resolve(WRONG);
    renderStep();

    await enterCode("111111");
    expect(await screen.findByText(/You have 4 tries left before you'll need a new code/)).toBeTruthy();
    expect(digits().map((input) => (input as HTMLInputElement).value)).toEqual(["", "", "", "", "", ""]);

    await enterCode("222222");
    expect(await screen.findByText(/You have 3 tries left/)).toBeTruthy();
    await enterCode("333333");
    expect(await screen.findByText(/You have 2 tries left/)).toBeTruthy();
    await enterCode("444444");
    expect(await screen.findByText(/You have 1 try left/)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("locks the code after the fifth wrong one, until a new code is sent", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval", "Date"] });
    testSession.onSignIn = () => Promise.resolve(WRONG);
    const view = renderStep();

    for (const code of ["111111", "222222", "333333", "444444"]) {
      await enterCode(code);
      await waitFor(() => expect(status().textContent).toMatch(/tr(y|ies) left/));
    }
    await enterCode("555555");

    expect(
      await screen.findByText("That code no longer works: it was entered incorrectly 5 times. Send a new code to continue."),
    ).toBeTruthy();
    expect(digits().every((input) => input.hasAttribute("disabled"))).toBe(true);
    expect(screen.queryByRole("button", { name: "Verify and sign in" })).toBeNull();
    const sendNew = screen.getByTestId("otp-send-new");
    expect(sendNew.textContent).toMatch(/^Send a new code in \d+s$/);
    expect(sendNew.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(OTP_RESEND_COOLDOWN_SECONDS * 1000);
    });
    await userEvent.click(screen.getByRole("button", { name: "Send a new code" }));

    expect(await screen.findByText("A new code is on its way. Earlier codes no longer work.")).toBeTruthy();
    expect(view.onResend).toHaveBeenCalledTimes(1);
    expect(digits().some((input) => input.hasAttribute("disabled"))).toBe(false);
    // The count starts again for the new code.
    await enterCode("666666");
    expect(await screen.findByText(/You have 4 tries left/)).toBeTruthy();
  });

  it("waits out the resend cooldown, counting it down on the button", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval", "Date"] });
    const view = renderStep();

    const resend = screen.getByTestId("otp-resend");
    expect(resend.textContent).toBe(`Send a new code in ${OTP_RESEND_COOLDOWN_SECONDS}s`);
    expect(resend.hasAttribute("disabled")).toBe(true);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(screen.getByTestId("otp-resend").textContent).toBe(`Send a new code in ${OTP_RESEND_COOLDOWN_SECONDS - 10}s`);

    await act(async () => {
      await vi.advanceTimersByTimeAsync((OTP_RESEND_COOLDOWN_SECONDS - 10) * 1000);
    });
    await userEvent.click(screen.getByRole("button", { name: "Send a new code" }));

    expect(await screen.findByText("A new code is on its way. Earlier codes no longer work.")).toBeTruthy();
    expect(view.onResend).toHaveBeenCalledTimes(1);
    // And the cooldown starts again.
    expect(screen.getByTestId("otp-resend").hasAttribute("disabled")).toBe(true);
  });

  it("shows why a resend failed", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true, toFake: ["setInterval", "clearInterval", "Date"] });
    renderStep({ onResend: () => Promise.resolve("Too many codes requested. Try again later.") });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(OTP_RESEND_COOLDOWN_SECONDS * 1000);
    });

    await userEvent.click(screen.getByRole("button", { name: "Send a new code" }));

    expect(await screen.findByTestId("otp-error")).toBeTruthy();
    expect(screen.getByTestId("otp-error").textContent).toBe("Too many codes requested. Try again later.");
  });

  it("says the connection failed when the request itself fails", async () => {
    testSession.onSignIn = () => Promise.reject(new TypeError("Failed to fetch"));
    renderStep();

    await enterCode("123456");

    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });

  it("says to wait when sign-ins are rate limited", async () => {
    testSession.onSignIn = () => Promise.resolve({ ...WRONG, code: "rate_limited" });
    renderStep();

    await enterCode("123456");

    expect(
      await screen.findByText(
        "Too many sign-in attempts. Wait 15 minutes, then send a new code. Entering codes before then won't work.",
      ),
    ).toBeTruthy();
  });

  it("uses the caller's explanation of a refused code when it has one", async () => {
    testSession.onSignIn = () => Promise.resolve(WRONG);
    const explainRejection = vi.fn(() => Promise.resolve("This invite has expired. Ask for a new one."));
    renderStep({ explainRejection });

    await enterCode("123456");

    expect(await screen.findByText("This invite has expired. Ask for a new one.")).toBeTruthy();
    expect(explainRejection).toHaveBeenCalledTimes(1);
  });

  it("falls back to the usual message when the explanation fails", async () => {
    testSession.onSignIn = () => Promise.resolve(WRONG);
    renderStep({ explainRejection: () => Promise.reject(new Error("offline")) });

    await enterCode("123456");

    expect(await screen.findByText(/You have 4 tries left/)).toBeTruthy();
  });

  it("goes back to the email step on request", async () => {
    const view = renderStep();

    await userEvent.click(screen.getByRole("button", { name: "Use a different email" }));

    expect(view.onChangeEmail).toHaveBeenCalledTimes(1);
  });
});
