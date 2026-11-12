"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { type ConfirmationState, afterCheck, checkDelay, shouldCheckAgain } from "~/_utils/checkoutStatus";
import { api } from "~/trpc/react";

/**
 * After a successful checkout the Stripe webhook may not have landed yet, so
 * the page can still say "Free". While `enabled` and not yet on Pro, this
 * re-syncs the subscription from Stripe a few times with a short delay, and
 * refreshes the server-rendered page as soon as the member has Pro access
 * (`hasProAccess` in the answer). The steps themselves are in
 * ~/_utils/checkoutStatus.
 */
export function useSubscriptionConfirmation({
  enabled,
  initialIsActive,
}: {
  enabled: boolean;
  /** Whether the server-rendered page already found Pro access. */
  initialIsActive: boolean;
}) {
  const router = useRouter();
  const { mutateAsync: syncStatus } = api.subscription.syncStatus.useMutation();
  const [state, setState] = useState<ConfirmationState>({ attempts: 0, isActive: initialIsActive });

  const { attempts } = state;
  const checkAgain = shouldCheckAgain(state, enabled);

  useEffect(() => {
    if (!checkAgain) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      void syncStatus()
        .then(
          (subscription) => ({ ok: true as const, subscription }),
          () => ({ ok: false as const }),
        )
        .then((outcome) => {
          if (cancelled) return;
          setState((current) => afterCheck(current, outcome));
          // The page was rendered as Free: show it as Pro.
          if (afterCheck({ attempts, isActive: false }, outcome).isActive) router.refresh();
        });
    }, checkDelay(attempts));

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempts, checkAgain, router, syncStatus]);

  return { attempts, isActive: state.isActive || initialIsActive };
}
