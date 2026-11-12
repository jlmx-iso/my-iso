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
