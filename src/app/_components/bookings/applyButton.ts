/**
 * What the "apply" control on an event shows, from booking.hasApplied.
 * It follows what booking.applyToEvent would do: an application (the first,
 * or again after a withdrawal) is offered only while the event still takes
 * applications; otherwise the control is disabled and says why.
 */
export type ApplicationStatus = {
  /** Why the event takes no applications now; null when it does. */
  applyBlockedBy?: "event_not_found" | "event_started" | "event_filled" | null;
  /** The viewer's application was withdrawn and may be sent again. */
  canReapply?: boolean;
  hasApplied: boolean;
};

export type ApplyButtonState =
  | { kind: "apply"; label: "I'm Interested" | "Apply again" }
  | { kind: "disabled"; label: "Applied" | "Position filled" | "Event has started" | "No longer available" };

const BLOCKED_LABELS = {
  event_filled: "Position filled",
  event_not_found: "No longer available",
  event_started: "Event has started",
} as const;

export function applyButtonState({ applyBlockedBy, canReapply = false, hasApplied }: ApplicationStatus): ApplyButtonState {
  // An application that stands (or was declined, or cancelled after being
  // accepted) is what the viewer needs to know first.
  if (hasApplied && !canReapply) return { kind: "disabled", label: "Applied" };
  if (applyBlockedBy) return { kind: "disabled", label: BLOCKED_LABELS[applyBlockedBy] };
  return { kind: "apply", label: canReapply ? "Apply again" : "I'm Interested" };
}
