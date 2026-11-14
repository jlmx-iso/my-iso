"use client";

import { Alert, Loader } from "@mantine/core";
import { IconCheck, IconClock, IconInfoCircle } from "@tabler/icons-react";
import { usePathname, useRouter } from "next/navigation";

import { type CheckoutReturn, checkoutBannerState } from "~/_utils/checkoutStatus";
import { useSubscriptionConfirmation } from "~/app/_hooks/useSubscriptionConfirmation";

type CheckoutBannerProps = {
  /** Parsed `?checkout=` value. */
  checkout: CheckoutReturn;
  /** Whether the server-side subscription record is active. */
  isSubscriptionActive: boolean;
};

/**
 * Tells a member returning from Stripe Checkout what happened. After a
 * success it keeps checking until the subscription is active, so the page
 * never sits on "Free" right after paying.
 */
export default function CheckoutBanner({ checkout, isSubscriptionActive }: CheckoutBannerProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { attempts, isActive } = useSubscriptionConfirmation({
    enabled: checkout === "success",
    initialIsActive: isSubscriptionActive,
  });
  const state = checkoutBannerState({ attempts, checkout, isSubscriptionActive: isActive });

  // Dismissing drops ?checkout= so the banner does not return on reload.
  const dismiss = () => router.replace(pathname, { scroll: false });

  return (
    // Always rendered so screen readers announce the banner and its changes.
    <div role="status" data-testid="checkout-banner" data-state={state}>
      {state === "confirmed" && (
        <Alert
          mb="md"
          color="teal"
          icon={<IconCheck size={18} />}
          title="You're on Pro"
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={dismiss}
        >
          Payment received and your subscription is active. Thanks for backing ISO.
        </Alert>
      )}
      {state === "confirming" && (
        <Alert mb="md" color="teal" icon={<Loader size={18} color="teal" />} title="Confirming your payment…">
          Thanks! We&apos;re activating Pro on your account. This usually takes a few seconds.
        </Alert>
      )}
      {state === "delayed" && (
        <Alert
          mb="md"
          color="tan"
          icon={<IconClock size={18} />}
          title="Your payment is still being confirmed"
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={dismiss}
        >
          This is taking longer than usual. You won&apos;t be charged twice: refresh this page in a minute, and
          contact us if your plan still says Free.
        </Alert>
      )}
      {state === "canceled" && (
        <Alert
          mb="md"
          color="gray"
          icon={<IconInfoCircle size={18} />}
          title="Checkout canceled"
          withCloseButton
          closeButtonLabel="Dismiss"
          onClose={dismiss}
        >
          You weren&apos;t charged and you&apos;re still on the Free plan. You can upgrade whenever you&apos;re ready.
        </Alert>
      )}
    </div>
  );
}
