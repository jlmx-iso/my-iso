// @vitest-environment happy-dom
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { renderWithProviders } from "~/test/dom/render";

import BillingActions from "./BillingActions";

const PRICING = { annualPrice: 99, isFoundingPrice: false, monthlyPrice: 10, standardMonthlyPrice: 10 };

describe("BillingActions", () => {
  it("says how Pro renews next to the button that starts it, monthly or yearly", async () => {
    renderWithProviders(<BillingActions mode="checkout" portalLabel="Manage subscription" pricing={PRICING} />);
    expect(screen.getByTestId("renewal-terms").textContent).toBe(
      "Renews automatically every month at $10 until you cancel. Cancel anytime in Settings → Current plan → Manage subscription.",
    );
    await userEvent.click(screen.getByRole("radio", { name: "Annual" }));
    expect(screen.getByTestId("renewal-terms").textContent).toMatch(/every year at \$99 until you cancel/);
  });

  it("says so for a resubscription too", () => {
    renderWithProviders(<BillingActions mode="resubscribe" portalLabel="Manage subscription" pricing={PRICING} />);
    expect(screen.getByTestId("renewal-terms").textContent).toMatch(/^Renews automatically every month/);
  });
});
