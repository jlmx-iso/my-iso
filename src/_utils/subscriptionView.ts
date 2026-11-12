/**
 * Turns the server's subscription state (`subscription.getStatus` /
 * `syncStatus`) into what Settings shows: which plan, one line about what
 * happens next and when, and a banner when something needs the member's
 * attention. WHICH billing action is offered (checkout, resubscribe, portal,
 * none) is billingModeFor's decision
 * (~/app/app/settings/_components/billingMode).
 *
 * Only the current fields are read (`hasProAccess`, `renewsAt`,
 * `accessEndsAt`, `canStartCheckout`, ...), never the deprecated
 * `isActive` / `isCanceled` / `expiresAt`.
 */
export type SubscriptionState = {
  accessEndsAt: Date | null;
  cancelAt: Date | null;
  cancelAtPeriodEnd: boolean;
  canStartCheckout: boolean;
  currentPeriodEnd: Date | null;
  hasProAccess: boolean;
  interval: string | null;
  isLifetime: boolean;
  isPastDue: boolean;
  plan: string | null;
  renewsAt: Date | null;
  status: string;
  /** Newer servers say why a subscription has no (or soon no) access. */
  billingIssue?: string | null;
  isDisputed?: boolean;
};

/** Whether the member is on Pro right now. The one test for "is Pro". */
export function hasProAccess(subscription: Pick<SubscriptionState, "hasProAccess"> | null | undefined): boolean {
  return subscription?.hasProAccess === true;
}

export type BillingIssue = "payment_failed" | "disputed" | "paused" | "incomplete" | "unknown_status";

export type SubscriptionSummary = {
  planName: "Free" | "Pro";
  /** "Monthly", "Yearly", "Founding price · Monthly"; null when there is nothing to say. */
  planDetail: string | null;
  /**
   * What happens next: `text` with `{date}` standing for `date`, to be
   * written in the reader's time zone.
   */
  line: { date: Date | null; text: string };
  /** Something is wrong with billing and the member can fix it. */
  banner: { actionLabel: string; body: string; date: Date | null; title: string; tone: "red" | "tan" } | null;
  /** Label of the portal button, when the portal is what is offered. */
  portalLabel: string;
};

const INTERVAL_LABELS: Record<string, string> = { month: "Monthly", year: "Yearly" };

function planDetailOf(subscription: SubscriptionState): string | null {
  const parts = [
    subscription.plan === "founding" ? "Founding price" : null,
    subscription.interval ? (INTERVAL_LABELS[subscription.interval] ?? null) : null,
  ].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const KNOWN_ISSUES: readonly BillingIssue[] = ["payment_failed", "disputed", "paused", "incomplete", "unknown_status"];

/** Why a subscription that exists gives no (or soon no) access, or null. */
export function billingIssueOf(subscription: SubscriptionState): BillingIssue | null {
  if (subscription.isLifetime) return null;
  const stated = KNOWN_ISSUES.find((issue) => issue === subscription.billingIssue);
  if (stated) return stated;
  if (subscription.isDisputed) return "disputed";
  if (subscription.isPastDue || subscription.status === "past_due" || subscription.status === "unpaid") {
    return "payment_failed";
  }
  if (subscription.status === "paused") return "paused";
  if (subscription.status === "incomplete") return "incomplete";
  // There is a subscription, it gives no access, and a new one cannot be
  // started: whatever its status, the portal is where it is sorted out.
  if (!subscription.hasProAccess && !subscription.canStartCheckout) return "unknown_status";
  return null;
}

function bannerFor(issue: BillingIssue, subscription: SubscriptionState): NonNullable<SubscriptionSummary["banner"]> {
  switch (issue) {
    case "payment_failed":
      return subscription.hasProAccess
        ? {
            actionLabel: "Fix payment",
            body: subscription.accessEndsAt
              ? "Update your card to keep Pro. Until it goes through you keep Pro, up to {date}."
              : "Update your card to keep Pro.",
            date: subscription.accessEndsAt,
            title: "Your last payment didn't go through",
            tone: "red",
          }
        : {
            actionLabel: "Fix payment",
            body: "Pro is switched off until a payment goes through. Update your card to get it back.",
            date: null,
            title: "Your payment didn't go through",
            tone: "red",
          };
    case "disputed":
      return {
        actionLabel: "Open billing",
        body: "A payment for your subscription was disputed with your bank, so Pro is on hold. Open billing to see the details, or contact us if this is a mistake.",
        date: null,
        title: "A payment is in dispute",
        tone: "red",
      };
    case "paused":
      return {
        actionLabel: "Resume in billing",
        body: "Your subscription is paused, so Pro is switched off. You can resume or end it in billing.",
        date: null,
        title: "Your subscription is paused",
        tone: "tan",
      };
    case "incomplete":
      return {
        actionLabel: "Finish payment",
        body: "Your subscription was started but the first payment hasn't gone through. Finish it in billing to switch Pro on.",
        date: null,
        title: "Your payment isn't finished",
        tone: "tan",
      };
    case "unknown_status":
      return {
        actionLabel: "Open billing",
        body: "Your subscription needs attention before Pro can be switched on. Open billing to see what's needed.",
        date: null,
        title: "Your subscription needs attention",
        tone: "tan",
      };
  }
}

export function subscriptionSummary(subscription: SubscriptionState | null | undefined): SubscriptionSummary {
  const free = {
    banner: null,
    line: { date: null, text: "You're on the Free plan." },
    planDetail: null,
    planName: "Free",
    portalLabel: "Manage subscription",
  } satisfies SubscriptionSummary;
  if (!subscription) return free;

  const pro = hasProAccess(subscription);
  const planName = pro ? "Pro" : "Free";

  if (subscription.isLifetime) {
    return {
      ...free,
      line: { date: null, text: "You have complimentary Pro access. There is nothing to pay or manage." },
      planDetail: "Complimentary",
      planName: "Pro",
    };
  }

  const issue = billingIssueOf(subscription);
  if (issue) {
    const banner = bannerFor(issue, subscription);
    return {
      banner,
      line: pro
        ? { date: subscription.accessEndsAt, text: subscription.accessEndsAt ? "Pro stays on until {date} while we retry your payment." : "Pro stays on while we retry your payment." }
        : { date: null, text: "Pro is switched off until this is sorted out." },
      planDetail: planDetailOf(subscription),
      planName,
      portalLabel: banner.actionLabel,
    };
  }

  if (pro) {
    const endsAt = subscription.accessEndsAt ?? subscription.cancelAt ?? (subscription.renewsAt ? null : subscription.currentPeriodEnd);
    // Set to end, or already cancelled with paid time left: it will not renew.
    if (subscription.cancelAtPeriodEnd || subscription.status === "canceled" || (!subscription.renewsAt && endsAt)) {
      return {
        banner: null,
        line: endsAt
          ? { date: endsAt, text: "Your subscription is canceled. You keep Pro until {date}, and you won't be charged again." }
          : { date: null, text: "Your subscription is canceled and won't renew. You keep Pro until the end of the period you paid for." },
        planDetail: planDetailOf(subscription),
        planName: "Pro",
        portalLabel: "Resume or manage",
      };
    }
    return {
      banner: null,
      line: subscription.renewsAt
        ? {
            date: subscription.renewsAt,
            text: subscription.status === "trialing" ? "Your trial is running. Your first payment is on {date}." : "Renews on {date}.",
          }
        : { date: null, text: "Your Pro subscription is active." },
      planDetail: planDetailOf(subscription),
      planName: "Pro",
      portalLabel: "Manage subscription",
    };
  }

  // No access and nothing wrong: a subscription that ended.
  // Only a date the server gives as the end of access: a period end or
  // cancellation date can lie in the future for a subscription that was cut
  // off early (refunded, never paid), and "ended on <a future date>" is wrong.
  const endedAt = subscription.accessEndsAt;
  return {
    ...free,
    line: endedAt
      ? { date: endedAt, text: "Your Pro subscription ended on {date}. You're on the Free plan." }
      : { date: null, text: "Your Pro subscription has ended. You're on the Free plan." },
  };
}
