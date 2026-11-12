/**
 * How a dialog that is sending a request behaves, and where its failure goes.
 *
 * While a request is in flight a dialog cannot be dismissed: no Escape, no
 * overlay click, no close button (spread `dialogLock(busy)` into the Modal,
 * and ignore `onClose` while busy). Its failure is then shown inside it.
 *
 * If the dialog is gone anyway when the failure arrives (closed some other
 * way, or the screen changed under it), the failure must not be dropped:
 * it is shown as a toast, and anything that has to be refreshed is
 * refreshed at once, since there is no dialog left to wait for.
 */

/** Modal props that keep a dialog open while `busy`. */
export function dialogLock(busy: boolean) {
  return { closeOnClickOutside: !busy, closeOnEscape: !busy, withCloseButton: !busy } as const;
}

export type FailureRoute = {
  /** Where the message goes. */
  show: "dialog" | "toast";
  /** Whether to refetch, and when: right away, once the dialog is closed, or not at all. */
  refresh: "now" | "on-close" | "no";
};

/**
 * Where a failed request's message goes, and when to refresh.
 *
 * `dialogOpen` is whether the dialog is still open when the failure
 * arrives (read from a ref, not from the render that sent the request).
 * `stale` is whether the failure means what is on screen is out of date.
 * With the dialog open, refreshing waits until it closes: a refresh can
 * move or remount what the dialog belongs to and take it, and its
 * explanation, away.
 */
export function routeFailure({ dialogOpen, stale }: { dialogOpen: boolean; stale: boolean }): FailureRoute {
  if (dialogOpen) return { refresh: stale ? "on-close" : "no", show: "dialog" };
  return { refresh: stale ? "now" : "no", show: "toast" };
}
