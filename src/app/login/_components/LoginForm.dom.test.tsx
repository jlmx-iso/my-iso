// @vitest-environment happy-dom
import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("next-auth/react", () => import("~/test/dom/session"));

import { renderWithProviders } from "~/test/dom/render";

import LoginForm from "./LoginForm";

describe("LoginForm", () => {
  it("explains that an account still being deleted cannot be used yet", () => {
    renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} authError="deletion_pending" />);
    expect(screen.getByTestId("login-error").textContent).toContain(
      "This account is still being deleted. Try again in a few minutes or contact support.",
    );
  });

  it("explains a refused Google account whose address Google has not verified", () => {
    renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} authError="email_unverified" />);
    expect(screen.getByTestId("login-error").textContent).toBe(
      "Your Google account's email address isn't verified. Verify it with Google, or sign in with an emailed code.",
    );
  });

  it("explains the Auth.js refusals it can name", () => {
    const { unmount } = renderWithProviders(
      <LoginForm callbackUrl="/app" signInRequired={false} authError="AccessDenied" />,
    );
    expect(screen.getByTestId("login-error").textContent).toContain("doesn't have access to ISO yet");
    unmount();

    renderWithProviders(<LoginForm callbackUrl="/app" signInRequired={false} authError="OAuthAccountNotLinked" />);
    expect(screen.getByTestId("login-error").textContent).toContain("already registered with a different sign-in method");
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
});
