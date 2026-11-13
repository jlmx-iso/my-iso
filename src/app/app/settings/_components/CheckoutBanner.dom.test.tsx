// @vitest-environment happy-dom
//
// Back from Stripe Checkout: after a success the banner says it is
// confirming and re-syncs the subscription (at once, then every few
// seconds, a bounded number of times) until the server says Pro, then
// refreshes the page and says so; if it never does, it says it is taking
// longer. A cancelled checkout says nothing was charged. Dismissing drops
// ?checkout= from the URL.

import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHECKOUT_MAX_ATTEMPTS, CHECKOUT_RETRY_DELAY_MS, type CheckoutReturn } from "~/_utils/checkoutStatus";
import { testRouter } from "~/test/dom/navigation";
import { renderWithProviders, trpcError, type TrpcHandlers } from "~/test/dom/render";

vi.mock("next/navigation", () => import("~/test/dom/navigation"));

import CheckoutBanner from "./CheckoutBanner";

type SyncStatus = NonNullable<NonNullable<TrpcHandlers["subscription"]>["syncStatus"]>;

const notYet = () => ({ hasProAccess: false }) as never;
const pro = () => ({ hasProAccess: true }) as never;

function renderBanner(checkout: CheckoutReturn, syncStatus: SyncStatus, isSubscriptionActive = false) {
  testRouter.setLocation("/app/settings", checkout ? `checkout=${checkout}` : "");
  return renderWithProviders(<CheckoutBanner checkout={checkout} isSubscriptionActive={isSubscriptionActive} />, {
    trpc: { subscription: { syncStatus } },
  });
}

const banner = () => screen.getByTestId("checkout-banner");

async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("CheckoutBanner", () => {
  it("confirms as soon as the subscription shows up, and refreshes the page once", async () => {
    let calls = 0;
    const view = renderBanner("success", () => (++calls < 3 ? notYet() : pro()));
    expect(banner().getAttribute("data-state")).toBe("confirming");
    expect(screen.getByText("Confirming your payment…")).toBeTruthy();

    await advance(0);
    expect(view.callsTo("subscription.syncStatus")).toHaveLength(1);
    await advance(CHECKOUT_RETRY_DELAY_MS - 1);
    expect(view.callsTo("subscription.syncStatus")).toHaveLength(1);
    await advance(1);
    expect(view.callsTo("subscription.syncStatus")).toHaveLength(2);
    expect(testRouter.refresh).not.toHaveBeenCalled();

    await advance(CHECKOUT_RETRY_DELAY_MS);
    expect(banner().getAttribute("data-state")).toBe("confirmed");
    expect(screen.getByText("You're on Pro")).toBeTruthy();
    expect(testRouter.refresh).toHaveBeenCalledTimes(1);

    await advance(10 * CHECKOUT_RETRY_DELAY_MS);
    expect(view.callsTo("subscription.syncStatus")).toHaveLength(3);
  });

  it("stops after the last attempt and says it is taking longer, failed requests included", async () => {
    let calls = 0;
    const view = renderBanner("success", () => {
      calls += 1;
      if (calls % 2 === 0) throw trpcError("INTERNAL_SERVER_ERROR", "Internal error");
      return notYet();
    });

    await advance(CHECKOUT_MAX_ATTEMPTS * CHECKOUT_RETRY_DELAY_MS);
    expect(view.callsTo("subscription.syncStatus")).toHaveLength(CHECKOUT_MAX_ATTEMPTS);
    expect(banner().getAttribute("data-state")).toBe("delayed");
    expect(screen.getByText("Your payment is still being confirmed")).toBeTruthy();

    await advance(10 * CHECKOUT_RETRY_DELAY_MS);
    expect(view.callsTo("subscription.syncStatus")).toHaveLength(CHECKOUT_MAX_ATTEMPTS);
    expect(testRouter.refresh).not.toHaveBeenCalled();
  });

  it("does not check when the page already found Pro", async () => {
    const view = renderBanner("success", pro, true);
    expect(screen.getByText("You're on Pro")).toBeTruthy();
    await advance(5 * CHECKOUT_RETRY_DELAY_MS);
    expect(view.calls).toEqual([]);
  });

  it("says a cancelled checkout charged nothing, without checking", async () => {
    const view = renderBanner("canceled", notYet);
    expect(screen.getByText("Checkout canceled")).toBeTruthy();
    await advance(5 * CHECKOUT_RETRY_DELAY_MS);
    expect(view.calls).toEqual([]);
  });

  it("shows nothing without a checkout, but keeps the live region", () => {
    renderBanner(null, notYet);
    expect(banner().getAttribute("role")).toBe("status");
    expect(banner().textContent).toBe("");
  });

  it("drops ?checkout= when dismissed", async () => {
    vi.useRealTimers();
    renderBanner("canceled", notYet);
    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(testRouter.replace).toHaveBeenCalledWith("/app/settings", { scroll: false });
  });

  it("stops checking when it goes away", async () => {
    const view = renderBanner("success", notYet);
    await advance(0);
    view.unmount();
    await advance(10 * CHECKOUT_RETRY_DELAY_MS);
    expect(view.callsTo("subscription.syncStatus")).toHaveLength(1);
  });
});
