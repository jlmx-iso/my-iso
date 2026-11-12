// @vitest-environment happy-dom
import { screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { COMPANY, SUPPORT_EMAIL } from "~/_lib/site";
import { renderWithProviders } from "~/test/dom/render";

import LegalPage from "./LegalPage";
import { PRIVACY_INTRO, PRIVACY_SECTIONS, PRIVACY_UPDATED } from "./privacyPolicy";
import { SUBPROCESSORS, SUBPROCESSORS_INTRO, SUBPROCESSORS_UPDATED, subprocessorSections } from "./subprocessors";
import { TERMS_INTRO, TERMS_SECTIONS, TERMS_UPDATED } from "./termsOfService";

const pages = {
  privacy: () => (
    <LegalPage title="Privacy Policy" updated={PRIVACY_UPDATED} intro={PRIVACY_INTRO} sections={PRIVACY_SECTIONS} />
  ),
  serviceProviders: () => (
    <LegalPage
      title="Service providers"
      updated={SUBPROCESSORS_UPDATED}
      intro={SUBPROCESSORS_INTRO}
      sections={subprocessorSections()}
    />
  ),
  terms: () => <LegalPage title="Terms of Service" updated={TERMS_UPDATED} intro={TERMS_INTRO} sections={TERMS_SECTIONS} />,
};

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(Object.entries(pages))("the %s page", (_name, Page) => {
  it("is marked as a draft pending legal review", () => {
    renderWithProviders(<Page />);
    expect(screen.getByText(/Draft — pending legal review\./)).toBeTruthy();
    expect(screen.getByText(/A lawyer hasn't reviewed it yet/)).toBeTruthy();
  });

  it("names the company and marks unknown facts for the owner outside production", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "staging");
    const { container } = renderWithProviders(<Page />);
    expect(container.textContent).toContain(COMPANY.name);
    expect(container.querySelectorAll("[data-owner-todo]").length).toBeGreaterThan(0);
  });

  it("shows no owner marker in production, only the fallback wording", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_ENV", "production");
    const { container } = renderWithProviders(<Page />);
    expect(container.querySelectorAll("[data-owner-todo]")).toHaveLength(0);
    expect(container.textContent).not.toMatch(/TODO/);
  });

  it("numbers its sections as headings", () => {
    renderWithProviders(<Page />);
    expect(screen.getAllByRole("heading", { level: 2 })[0]?.textContent).toMatch(/^1\. /);
  });
});

describe("the privacy policy", () => {
  it("covers what the app does today", () => {
    const { container } = renderWithProviders(pages.privacy());
    const text = container.textContent ?? "";
    for (const fact of [
      "PostHog",
      "Session replay",
      "Global Privacy Control",
      "In the EU, the EEA, the UK, Switzerland, Canada and Brazil, or when we can't tell where you are, nothing is measured until you accept.",
      "We do not pass on your IP address",
      "first 600 characters of the bio",
      "no decision about you is made by automated means",
      "may be read by AI crawlers",
      "Download your data",
      "Delete account",
      "Deleted member",
      "iso_consent",
      "authjs.session-token",
      "iso_analytics_user",
      "Sign-in sessions end after 24 hours without use.",
      "separate right to object",
      "Information Commissioner's Office",
      "We have not sold or shared personal information in the past 12 months.",
      "Messages others sent you stay readable in the app.",
    ]) {
      expect(text, fact).toContain(fact);
    }
    expect(screen.getAllByRole("link", { name: SUPPORT_EMAIL })[0]?.getAttribute("href")).toBe(`mailto:${SUPPORT_EMAIL}`);
    expect(screen.getByRole("link", { name: "list of service providers" }).getAttribute("href")).toBe("/subprocessors");
    expect(screen.getAllByRole("table").length).toBe(2);
  });
});

describe("the terms", () => {
  it("cover copyright complaints, the founding price and professional use", () => {
    const { container } = renderWithProviders(pages.terms());
    const text = container.textContent ?? "";
    for (const fact of [
      "Copyright complaints",
      "We close the accounts of members who repeatedly infringe.",
      "A founding member price is an exception",
      "professional photographers acting in the course of their business",
      "letting search engines index it",
    ]) {
      expect(text, fact).toContain(fact);
    }
  });
});

describe("the service providers list", () => {
  it("has a section for every provider, and says who also acts as a controller", () => {
    const { container } = renderWithProviders(pages.serviceProviders());
    for (const processor of SUBPROCESSORS) {
      expect(screen.getByRole("heading", { name: new RegExp(processor.name.replace(/[.,]/g, "\\$&")) })).toBeTruthy();
    }
    expect(container.textContent).toContain("Workers Logs");
    expect(container.textContent).toContain("independent controllers");
    expect(SUBPROCESSORS.map((processor) => processor.name)).toEqual(
      expect.arrayContaining(["Cloudflare, Inc.", "PostHog, Inc.", "Stripe, Inc.", "Resend", "Cloudinary Ltd.", "Anthropic, PBC", "Google LLC", "Support mailbox"]),
    );
  });
});
