// @vitest-environment happy-dom
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => import("~/test/dom/session"));

import { NETWORK_ERROR_MESSAGE } from "~/_utils/userError";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";
import { testSession } from "~/test/dom/session";

import LoginForm from "./LoginForm";

describe("LoginForm", () => {
  it("explains that an account still being deleted cannot be used yet", () => {
    renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} authError="deletion_pending" />);
    expect(screen.getByTestId("login-error").textContent).toContain(
      "This account is still being deleted. Try again in a few minutes or contact support.",
    );
  });

  it("says that continuing accepts the Terms and acknowledges the Privacy Policy", () => {
    renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} />);
    const note = screen.getByTestId("legal-consent-note");
    expect(note.textContent).toBe("By continuing you agree to the Terms and acknowledge the Privacy Policy.");
    expect(screen.getByRole("link", { name: "Terms" }).getAttribute("href")).toBe("/terms");
  });

  it("falls back to a general message for other errors", () => {
    renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} authError="Configuration" />);
    expect(screen.getByTestId("login-error").textContent).toContain("We couldn't sign you in.");
  });

  it("names the other auth errors in the member's terms", () => {
    const view = renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} authError="AccessDenied" />);
    expect(screen.getByTestId("login-error").textContent).toBe(
      "That account doesn't have access to ISO yet. Join with an invite code first.",
    );
    view.unmount();

    renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} authError="OAuthAccountNotLinked" />);
    expect(screen.getByTestId("login-error").textContent).toMatch(/already registered with a different sign-in method/);
  });

  it("says why it asks to sign in when a page needed it", () => {
    renderWithProviders(<LoginForm callbackUrl="/app/bookings" signInRequired />);
    expect(screen.getByText("Sign in to continue")).toBeTruthy();
    expect(screen.getByRole("link", { name: "Join" }).getAttribute("href")).toBe("/join");
  });
});

describe("LoginForm sign-in", () => {
  type RequestOtp = NonNullable<NonNullable<TrpcHandlers["auth"]>["requestMobileOtp"]>;

  function renderForm(requestMobileOtp: RequestOtp = () => ({ devCode: undefined, sent: true })) {
    return renderWithProviders(<LoginForm callbackUrl="/app/bookings" signInRequired={false} />, {
      trpc: { auth: { requestMobileOtp } },
    });
  }

  const emailField = () => screen.getByRole("textbox", { name: /^Email/ });

  it("checks the email before sending a code", async () => {
    const view = renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(await screen.findByText("Enter your email address")).toBeTruthy();

    await userEvent.type(emailField(), "ann@nowhere");
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));
    expect(await screen.findByText("Enter a valid email address, like you@example.com")).toBeTruthy();
    expect(view.calls).toEqual([]);
  });

  it("emails a code to the trimmed address and moves to the code step, and back", async () => {
    const view = renderForm();
    await userEvent.type(emailField(), "  ann@example.com ");
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));

    expect(await screen.findByText("Enter your code")).toBeTruthy();
    expect(view.callsTo("auth.requestMobileOtp")).toEqual([{ email: "ann@example.com" }]);

    await userEvent.click(screen.getByRole("button", { name: "Use a different email" }));
    expect(screen.getByRole("button", { name: "Send sign-in code" })).toBeTruthy();
  });

  it("says why no code was sent, and stays on the email step", async () => {
    renderForm(() => {
      throw trpcError("TOO_MANY_REQUESTS", "Too many codes requested. Try again in 15 minutes.");
    });
    await userEvent.type(emailField(), "ann@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send sign-in code" }));

    expect((await screen.findByTestId("login-error")).textContent).toBe("Too many codes requested. Try again in 15 minutes.");
    expect(screen.queryByText("Enter your code")).toBeNull();
  });

  it("hands over to Google with the destination", async () => {
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() =>
      expect(testSession.signInCalls).toEqual([{ options: { callbackUrl: "/app/bookings" }, provider: "google" }]),
    );
  });

  it("says when Google could not be reached", async () => {
    testSession.onSignIn = () => Promise.reject(new TypeError("Failed to fetch"));
    renderForm();
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await waitFor(() => expect(screen.getByTestId("login-error").textContent).toBe(NETWORK_ERROR_MESSAGE));
    expect(screen.getByRole("button", { name: "Sign in with Google" }).hasAttribute("data-loading")).toBe(false);
  });
});
