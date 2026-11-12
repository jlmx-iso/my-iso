import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureServerException: vi.fn(),
  logger: { debug: vi.fn(), error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock("~/server/_lib/posthog", () => ({ captureServerException: mocks.captureServerException }));
vi.mock("~/_utils", () => ({ logger: mocks.logger }));

import { reportBillingError } from "./report";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reportBillingError", () => {
  it("logs and sends the original error to error tracking, with plain context only", () => {
    const cause = new Error("No such customer");
    reportBillingError("Stripe webhook could not be processed", {
      attempt: 2,
      error: cause,
      eventId: "evt_1",
      eventType: "invoice.paid",
      livemode: false,
      payload: { customer_email: "a@b.co" },
      userId: null,
    });

    expect(mocks.logger.error).toHaveBeenCalledWith(
      "Stripe webhook could not be processed",
      expect.objectContaining({ area: "billing", eventId: "evt_1" }),
    );
    expect(mocks.captureServerException).toHaveBeenCalledExactlyOnceWith(cause, {
      extra: {
        attempt: 2,
        eventId: "evt_1",
        eventType: "invoice.paid",
        livemode: false,
        message: "Stripe webhook could not be processed",
        userId: null,
      },
      source: "billing",
    });
    // Nested objects (possible payloads) are not attached.
    expect(JSON.stringify(mocks.captureServerException.mock.calls)).not.toContain("a@b.co");
  });

  it("reports the message itself when there is no error object", () => {
    reportBillingError("Missing price id", { plan: "founding" });
    const [error, context] = mocks.captureServerException.mock.calls[0] as [Error, { source: string }];
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Missing price id");
    expect(context.source).toBe("billing");
  });

  it("never throws, even if error tracking does", () => {
    mocks.captureServerException.mockImplementation(() => {
      throw new Error("tracking is down");
    });
    expect(() => reportBillingError("Stripe is down")).not.toThrow();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      "Could not report billing error",
      expect.objectContaining({ area: "billing" }),
    );
  });
});
