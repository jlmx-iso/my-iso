import { describe, expect, it } from "vitest";

import { dialogLock, routeFailure } from "./dialogFailure";

describe("dialogLock", () => {
  it("makes a busy dialog impossible to dismiss, and an idle one dismissable", () => {
    expect(dialogLock(true)).toEqual({ closeOnClickOutside: false, closeOnEscape: false, withCloseButton: false });
    expect(dialogLock(false)).toEqual({ closeOnClickOutside: true, closeOnEscape: true, withCloseButton: true });
  });
});

describe("routeFailure", () => {
  it("shows a failure in the dialog while it is open", () => {
    expect(routeFailure({ dialogOpen: true, stale: false })).toEqual({ refresh: "no", show: "dialog" });
  });

  it("waits for the dialog to close before refreshing stale data", () => {
    expect(routeFailure({ dialogOpen: true, stale: true })).toEqual({ refresh: "on-close", show: "dialog" });
  });

  it("toasts a failure whose dialog was closed mid-request, never dropping it", () => {
    expect(routeFailure({ dialogOpen: false, stale: false })).toEqual({ refresh: "no", show: "toast" });
  });

  it("refreshes at once when the dialog closed mid-request and the data is stale", () => {
    // Nothing is left to wait for: waiting for "on close" would leave the
    // card offering an action that fails again.
    expect(routeFailure({ dialogOpen: false, stale: true })).toEqual({ refresh: "now", show: "toast" });
  });
});
