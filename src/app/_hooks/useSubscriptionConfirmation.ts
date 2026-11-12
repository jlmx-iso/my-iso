"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { CHECKOUT_MAX_ATTEMPTS, CHECKOUT_RETRY_DELAY_MS } from "~/_utils/checkoutStatus";
import { api } from "~/trpc/react";

/**
 * After a successful checkout the Stripe webhook may not have landed yet, so
 * the page can still say "Free". While `enabled` and not yet active, this
 * re-syncs the subscription from Stripe a few times with a short delay, and
 * refreshes the server-rendered page as soon as it turns active.
 */
export function useSubscriptionConfirmation({
  enabled,
  initialIsActive,
}: {
  enabled: boolean;
  initialIsActive: boolean;
}) {
  const router = useRouter();
  const { mutateAsync: syncStatus } = api.subscription.syncStatus.useMutation();
  const [isActive, setIsActive] = useState(initialIsActive);
  const [attempts, setAttempts] = useState(0);

  const shouldRetry = enabled && !isActive && attempts < CHECKOUT_MAX_ATTEMPTS;

  useEffect(() => {
    if (!shouldRetry) return;
    let cancelled = false;

    const timer = setTimeout(() => {
      syncStatus()
        .then((subscription) => {
          if (cancelled) return;
          if (subscription?.isActive) {
            setIsActive(true);
            router.refresh();
          } else {
            setAttempts((current) => current + 1);
          }
        })
        .catch(() => {
          if (!cancelled) setAttempts((current) => current + 1);
        });
      // The first check runs straight away; later ones wait.
    }, attempts === 0 ? 0 : CHECKOUT_RETRY_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [attempts, router, shouldRetry, syncStatus]);

  return { attempts, isActive: isActive || initialIsActive };
}
