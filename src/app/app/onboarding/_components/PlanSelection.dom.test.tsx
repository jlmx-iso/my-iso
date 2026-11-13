// @vitest-environment happy-dom
//
// The plan step of onboarding: Free goes straight on, Pro opens Stripe
// Checkout for the chosen interval. A member who already has a subscription
// is sent on instead, a second click while checkout opens is not an error,
// and any other failure says nothing was charged.

import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

import { ErrorReason } from "~/_utils/errorReason";
import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import { PlanSelection } from "./PlanSelection";

type Checkout = NonNullable<NonNullable<TrpcHandlers["subscription"]>["createCheckoutSession"]>;

const FOUNDING = { annualPrice: 99, isFoundingPrice: true, monthlyPrice: 10, standardMonthlyPrice: 15 };
const STANDARD = { annualPrice: 150, isFoundingPrice: false, monthlyPrice: 15, standardMonthlyPrice: 15 };
const CHECKOUT_FAILED =
  "We couldn't start checkout. You haven't been charged. Please try again, or start free and upgrade later.";

let assign: Mock<(url: string | URL) => void>;

beforeEach(() => {
  assign = vi.fn<(url: string | URL) => void>();
  vi.spyOn(window.location, "assign").mockImplementation(assign);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function renderPlans(createCheckoutSession: Checkout, pricing = FOUNDING) {
  return renderWithProviders(<PlanSelection pricing={pricing} />, { trpc: { subscription: { createCheckoutSession } } });
}

const upgrade = () => screen.getByRole("button", { name: "Upgrade to Pro — $10/mo" });

describe("PlanSelection", () => {
  it("lets a member start free", () => {
    renderPlans(() => ({ url: null }) as never);
    expect(screen.getByRole("link", { name: "Start free" }).getAttribute("href")).toBe("/app/onboarding/complete");
  });

  it("opens checkout for the chosen interval", async () => {
    const view = renderPlans(() => ({ url: "https://checkout.stripe.com/c/pay/cs_test_1" }) as never);
    await userEvent.click(screen.getByRole("radio", { name: /Annual/ }));

    await userEvent.click(screen.getByRole("button", { name: "Upgrade to Pro — $99/year" }));

    await waitFor(() => expect(assign).toHaveBeenCalledWith("https://checkout.stripe.com/c/pay/cs_test_1"));
    expect(view.callsTo("subscription.createCheckoutSession")).toEqual([
      { billingInterval: "annual", successPath: "/app/onboarding/complete?plan=pro" },
    ]);
  });

  it("shows the founding price with the regular one struck through, and the standard price without", () => {
    const view = renderPlans(() => ({ url: null }) as never);
    expect(screen.getByTestId("founding-badge")).toBeTruthy();
    expect(screen.getByText("Your founding price stays while you stay subscribed")).toBeTruthy();
    expect(screen.getByText("Regular price")).toBeTruthy();
    view.unmount();

    renderPlans(() => ({ url: null }) as never, STANDARD);
    expect(screen.queryByTestId("founding-badge")).toBeNull();
    expect(screen.getByTestId("pro-price").textContent).toBe("$15/month");
  });

  it("sends a member who already has Pro on, without an error", async () => {
    renderPlans(() => {
      throw trpcError("CONFLICT", "You already have a subscription.", { reason: ErrorReason.SUBSCRIPTION_EXISTS });
    });
    await userEvent.click(upgrade());
    await waitFor(() => expect(testRouter.replace).toHaveBeenCalledWith("/app/onboarding/complete?plan=pro"));
    expect(screen.getByRole("alert").textContent).toBe("");
  });

  it("treats a second click while checkout opens as nothing to report", async () => {
    renderPlans(() => {
      throw trpcError("CONFLICT", "A checkout is already being created.");
    });
    await userEvent.click(upgrade());
    await waitFor(() => expect(upgrade().hasAttribute("data-loading")).toBe(false));
    expect(screen.getByRole("alert").textContent).toBe("");
    expect(assign).not.toHaveBeenCalled();
  });

  it("says nothing was charged when checkout cannot start", async () => {
    renderPlans(() => {
      throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
    });
    await userEvent.click(upgrade());
    expect(await screen.findByText(CHECKOUT_FAILED)).toBeTruthy();
  });

  it("says so when the server gives no checkout address", async () => {
    renderPlans(() => ({ url: null }) as never);
    await userEvent.click(upgrade());
    expect(
      await screen.findByText("We couldn't start checkout. Please try again, or start free and upgrade later."),
    ).toBeTruthy();
    expect(assign).not.toHaveBeenCalled();
  });
});
