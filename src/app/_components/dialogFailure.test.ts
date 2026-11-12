import { describe, expect, it, vi } from "vitest";

import { dialogLock, releaseDialogOnUnmount, routeFailure } from "./dialogFailure";

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

describe("releaseDialogOnUnmount", () => {
  it("releases the parent when the component goes away with its dialog open", () => {
    const release = vi.fn();
    let open = false;
    const cleanup = releaseDialogOnUnmount(() => open, release);
    open = true; // the dialog opened after the effect ran: the value at unmount counts
    cleanup();
    expect(release).toHaveBeenCalledOnce();
  });

  it("does nothing when the dialog was already closed (it said so itself)", () => {
    const release = vi.fn();
    releaseDialogOnUnmount(() => false, release)();
    expect(release).not.toHaveBeenCalled();
  });
});
