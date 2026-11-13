// @vitest-environment happy-dom
//
// Signing up with an invite code: the code is checked first (and refused
// with one message whether it does not exist or is used up), then the
// email, then the invite is registered for that address and either a code
// is emailed or the browser goes to Google. An invite that runs out while
// someone is signing up is said as such, wherever it is noticed. A
// waitlist-approved visitor only gets the Google button.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NETWORK_ERROR_MESSAGE } from "~/_utils/userError";
import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));
vi.mock("next-auth/react", () => import("~/test/dom/session"));

import Page from "./page";

const CODE_NOT_USABLE =
  "That code isn't valid, or all of its invites have been used. Check it for typos, or ask the person who invited you for a new code.";
const INVITE_GONE =
  "This invite is no longer available: its last spot was taken, or the code was replaced, while you were signing up. Ask the person who invited you for a new code, or request an invite below.";

const VALID = { inviterName: "Penny", valid: true } as const;
const USED_UP = { inviterName: null, valid: false } as const;

type Handlers = {
  prepareRegistration?: NonNullable<NonNullable<TrpcHandlers["invite"]>["prepareRegistration"]>;
  requestMobileOtp?: NonNullable<NonNullable<TrpcHandlers["auth"]>["requestMobileOtp"]>;
  validate?: NonNullable<NonNullable<TrpcHandlers["invite"]>["validate"]>;
};

function renderJoin(handlers: Handlers = {}) {
  return renderWithProviders(<Page />, {
    trpc: {
      auth: { requestMobileOtp: handlers.requestMobileOtp ?? (() => ({ devCode: undefined, sent: true })) },
      invite: {
        prepareRegistration: handlers.prepareRegistration ?? (() => ({ success: true })),
        validate: handlers.validate ?? (() => VALID),
      },
    },
  });
}

const codeInput = () => screen.getByRole("textbox", { name: /^Invite code/ });
const emailInput = () => screen.getByRole("textbox", { name: /^Your email/ });
const button = (name: string) => screen.getByRole("button", { name });

async function validateCode(code = "ISO-PENNY-7X2KQ9AB") {
  await userEvent.type(codeInput(), code);
  await userEvent.click(button("Validate"));
  await screen.findByText("Invited by Penny");
}

beforeEach(() => {
  testRouter.setLocation("/join");
});

describe("/join with an invite code", () => {
  it("asks for a code before checking anything", async () => {
    const view = renderJoin();
    await userEvent.click(button("Validate"));
    expect(await screen.findByText("Enter your invite code")).toBeTruthy();
    expect(view.callsTo("invite.validate")).toEqual([]);
  });

  it("checks the code from the link and says who sent the invite", async () => {
    testRouter.setLocation("/join", "code=ISO-PENNY-7X2KQ9AB");
    const view = renderJoin();
    expect((codeInput() as HTMLInputElement).value).toBe("ISO-PENNY-7X2KQ9AB");

    await userEvent.click(button("Validate"));

    expect(await screen.findByText("Invited by Penny")).toBeTruthy();
    expect(view.callsTo("invite.validate")).toEqual([{ code: "ISO-PENNY-7X2KQ9AB" }]);
    expect(emailInput()).toBeTruthy();
  });

  it("refuses a code that cannot be used, and forgets the message as the code is edited", async () => {
    renderJoin({ validate: () => USED_UP });
    await userEvent.type(codeInput(), "ISO-NOPE");
    await userEvent.click(button("Validate"));

    expect(await screen.findByText(CODE_NOT_USABLE)).toBeTruthy();
    expect(codeInput().getAttribute("aria-invalid")).toBe("true");
    expect(screen.queryByRole("textbox", { name: /^Your email/ })).toBeNull();

    await userEvent.type(codeInput(), "X");
    expect(screen.queryByText(CODE_NOT_USABLE)).toBeNull();
  });

  it("says when the code could not be checked at all", async () => {
    renderJoin({
      validate: () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await userEvent.type(codeInput(), "ISO-PENNY");
    await userEvent.click(button("Validate"));
    expect(await screen.findByText(NETWORK_ERROR_MESSAGE)).toBeTruthy();
  });

  it("asks for a usable email before registering the invite", async () => {
    const view = renderJoin();
    await validateCode();

    await userEvent.click(button("Email me a sign-in code"));
    expect(await screen.findByText("Enter your email address")).toBeTruthy();

    await userEvent.type(emailInput(), "ann@nowhere");
    await userEvent.click(button("Sign up with Google"));
    expect(await screen.findByText("Enter a valid email address, like you@example.com")).toBeTruthy();

    expect(view.callsTo("invite.prepareRegistration")).toEqual([]);
    expect(testSession.signInCalls).toEqual([]);
  });

  it("registers the invite for the email, sends a code and moves to the code step", async () => {
    const view = renderJoin();
    await validateCode(" ISO-PENNY-7X2KQ9AB ");
    await userEvent.type(emailInput(), " ann@example.com ");

    await userEvent.click(button("Email me a sign-in code"));

    expect(await screen.findByText("Enter your code")).toBeTruthy();
    expect(screen.getByText("ann@example.com")).toBeTruthy();
    expect(view.callsTo("invite.prepareRegistration")).toEqual([{ code: "ISO-PENNY-7X2KQ9AB", email: "ann@example.com" }]);
    expect(view.callsTo("auth.requestMobileOtp")).toEqual([{ email: "ann@example.com" }]);
    // The code can no longer be changed under the registration.
    expect(codeInput().hasAttribute("readonly")).toBe(true);
    expect(button("Validate").hasAttribute("disabled")).toBe(true);

    await userEvent.click(button("Use a different email"));
    expect((emailInput() as HTMLInputElement).value).toBe("ann@example.com");
  });

  it("says when the invite ran out while signing up, and drops the email form", async () => {
    let checks = 0;
    renderJoin({
      prepareRegistration: () => {
        throw trpcError("BAD_REQUEST", "Invalid or exhausted invite code.");
      },
      validate: () => (++checks === 1 ? VALID : USED_UP),
    });
    await validateCode();
    await userEvent.type(emailInput(), "ann@example.com");

    await userEvent.click(button("Email me a sign-in code"));

    expect(await screen.findByText(INVITE_GONE)).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /^Your email/ })).toBeNull();
  });

  it("shows the server's reason when the invite is still good", async () => {
    const view = renderJoin({
      requestMobileOtp: () => {
        throw trpcError("TOO_MANY_REQUESTS", "Too many codes requested. Try again in 15 minutes.");
      },
    });
    await validateCode();
    await userEvent.type(emailInput(), "ann@example.com");

    await userEvent.click(button("Email me a sign-in code"));

    expect((await screen.findByTestId("join-error")).textContent).toBe(
      "Too many codes requested. Try again in 15 minutes.",
    );
    expect(screen.queryByText("Enter your code")).toBeNull();
    // Only a BAD_REQUEST could mean the invite ran out: not checked again.
    expect(view.callsTo("invite.validate")).toHaveLength(1);
  });

  it("registers the invite, then hands over to Google", async () => {
    const view = renderJoin();
    await validateCode();
    await userEvent.type(emailInput(), "ann@example.com");

    await userEvent.click(button("Sign up with Google"));

    await waitFor(() =>
      expect(testSession.signInCalls).toEqual([{ options: { callbackUrl: "/app/events" }, provider: "google" }]),
    );
    expect(view.callsTo("invite.prepareRegistration")).toEqual([{ code: "ISO-PENNY-7X2KQ9AB", email: "ann@example.com" }]);
  });

  it("does not go to Google when the invite could not be registered", async () => {
    renderJoin({
      prepareRegistration: () => {
        throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      },
    });
    await validateCode();
    await userEvent.type(emailInput(), "ann@example.com");

    await userEvent.click(button("Sign up with Google"));

    expect((await screen.findByTestId("join-error")).textContent).toBe(
      "We couldn't start your sign-up. Please try again.",
    );
    expect(testSession.signInCalls).toEqual([]);
    expect(button("Sign up with Google").hasAttribute("disabled")).toBe(false);
  });

  it("says when Google could not be reached", async () => {
    testSession.onSignIn = () => Promise.reject(new TypeError("Failed to fetch"));
    renderJoin();
    await validateCode();
    await userEvent.type(emailInput(), "ann@example.com");

    await userEvent.click(button("Sign up with Google"));

    expect((await screen.findByTestId("join-error")).textContent).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("explains a refused sign-in code by the invite having run out", async () => {
    let checks = 0;
    testSession.onSignIn = () =>
      Promise.resolve({ code: "credentials", error: "CredentialsSignin", ok: false, status: 401, url: null });
    renderJoin({ validate: () => (++checks <= 1 ? VALID : USED_UP) });
    await validateCode();
    await userEvent.type(emailInput(), "ann@example.com");
    await userEvent.click(button("Email me a sign-in code"));
    await screen.findByText("Enter your code");

    await userEvent.click(screen.getAllByLabelText("Digit of your 6-digit sign-in code")[0]!);
    await userEvent.keyboard("123456");

    expect(await screen.findByText(INVITE_GONE)).toBeTruthy();
    expect(screen.queryByText("Enter your code")).toBeNull();
  });

  it("keeps the usual message for a wrong code while the invite is still good", async () => {
    testSession.onSignIn = () =>
      Promise.resolve({ code: "credentials", error: "CredentialsSignin", ok: false, status: 401, url: null });
    renderJoin();
    await validateCode();
    await userEvent.type(emailInput(), "ann@example.com");
    await userEvent.click(button("Email me a sign-in code"));
    await screen.findByText("Enter your code");

    await userEvent.click(screen.getAllByLabelText("Digit of your 6-digit sign-in code")[0]!);
    await userEvent.keyboard("123456");

    expect((await screen.findByTestId("otp-error")).textContent).toMatch(/^That code isn't right/);
  });

  it("explains that an invite is needed when sent here by sign-up", () => {
    testRouter.setLocation("/join", "error=invite_required");
    renderJoin();
    expect(screen.getByText("Invite required")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Request an invite" }).getAttribute("href")).toBe("/waitlist");
    expect(screen.getByRole("link", { name: "Sign in" }).getAttribute("href")).toBe("/login");
  });
});

describe("/join after a waitlist approval", () => {
  it("names the approved address and signs in with Google, with no code to enter", async () => {
    testRouter.setLocation("/join", "waitlist=approved&email=ann%40example.com");
    const view = renderJoin();

    expect(screen.getByText("Your waitlist application has been approved!")).toBeTruthy();
    expect(screen.getByText("Sign in with the Google account that matches ann@example.com")).toBeTruthy();
    expect(screen.queryByRole("textbox", { name: /^Invite code/ })).toBeNull();

    await userEvent.click(button("Sign up with Google"));

    await waitFor(() =>
      expect(testSession.signInCalls).toEqual([{ options: { callbackUrl: "/app/events" }, provider: "google" }]),
    );
    expect(view.calls).toEqual([]);
  });

  it("falls back to general wording without an address, and says when Google could not be reached", async () => {
    testRouter.setLocation("/join", "waitlist=approved");
    testSession.onSignIn = () => Promise.reject(new TypeError("Failed to fetch"));
    renderJoin();

    expect(screen.getByText("Sign in with the Google account that matches the email you applied with.")).toBeTruthy();
    await userEvent.click(button("Sign up with Google"));

    expect((await screen.findByTestId("join-error")).textContent).toBe(NETWORK_ERROR_MESSAGE);
  });
});
