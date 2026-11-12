"use client";

import { Button, SegmentedControl, Stack, Text } from "@mantine/core";
import { IconCreditCard, IconExternalLink } from "@tabler/icons-react";
import { useState } from "react";

import { ErrorReason, getErrorReason } from "~/_utils/errorReason";
import { type BillingInterval, type PlanPricing, proPriceView } from "~/_utils/plans";
import { trpcErrorCode, userFacingError } from "~/_utils/userError";
import LocalDate from "~/app/_components/LocalDate";
import { api } from "~/trpc/react";

import type { BillingMode } from "./billingMode";

type BillingActionsProps = {
  /** What the member's subscription calls for (see billingModeFor). */
  mode: BillingMode;
  /** With "resubscribe": until when the period already paid for lasts. */
  paidUntil?: Date | null;
  /** The portal button's label: "Manage subscription", "Fix payment", ... */
  portalLabel: string;
  pricing: PlanPricing;
  /** "Fix payment" is the page's primary action; "Manage subscription" is not. */
  portalIsPrimary?: boolean;
};

type Notice = { text: string; tone: "error" | "info" };

const CHECKOUT_FAILED = "We couldn't start checkout. You haven't been charged. Please try again.";
const PORTAL_FAILED = "We couldn't open billing. Please try again.";

/**
 * The one billing button: checkout for someone without a subscription, the
 * Stripe billing portal for anyone who has one (running, past due, paused,
 * unfinished). If the server knows better than this page did, the button
 * follows the server.
 */
export default function BillingActions({ mode: initialMode, paidUntil, portalLabel, pricing, portalIsPrimary = false }: BillingActionsProps) {
  const [notice, setNotice] = useState<Notice | null>(null);
  const [billingInterval, setBillingInterval] = useState<BillingInterval>("monthly");
  // Set when the server's answer shows the page was out of date.
  const [override, setOverride] = useState<BillingMode | null>(null);
  const mode = override ?? initialMode;

  const createPortal = api.subscription.createPortalSession.useMutation({
    onError: (error) => {
      // Nothing to manage after all: offer checkout.
      if (getErrorReason(error) === ErrorReason.NO_BILLING_ACCOUNT) setOverride("checkout");
      setNotice({ text: userFacingError(error, PORTAL_FAILED), tone: "error" });
    },
    onSuccess: (data) => {
      if (data.url) window.location.assign(data.url);
      else setNotice({ text: PORTAL_FAILED, tone: "error" });
    },
  });

  const createCheckout = api.subscription.createCheckoutSession.useMutation({
    onError: (error) => {
      if (getErrorReason(error) === ErrorReason.SUBSCRIPTION_EXISTS) {
        // There is a subscription this page did not know about: a second
        // checkout would be refused, the portal is where it is managed.
        setOverride("portal");
        setNotice({ text: "You already have a subscription. Opening billing so you can manage it…", tone: "info" });
        createPortal.mutate();
        return;
      }
      if (trpcErrorCode(error) === "CONFLICT") {
        // A second click (or tab) while the first request is still opening
        // checkout: nothing went wrong.
        setNotice({ text: "Checkout is already opening. One moment…", tone: "info" });
        return;
      }
      setNotice({ text: userFacingError(error, CHECKOUT_FAILED), tone: "error" });
    },
    onSuccess: (data) => {
      if (data.url) window.location.assign(data.url);
      else setNotice({ text: CHECKOUT_FAILED, tone: "error" });
    },
  });

  if (mode === "none") return null;

  const message = (
    // Always rendered so the message is announced when it appears.
    <div role={notice?.tone === "info" ? "status" : "alert"} data-testid="billing-notice">
      {notice && (
        <Text size="sm" c={notice.tone === "error" ? "red.8" : "gray.7"} maw={320}>
          {notice.text}
        </Text>
      )}
    </div>
  );

  if (mode === "portal") {
    return (
      <Stack gap="xs" align="flex-start" w={{ base: "100%", xs: "auto" }}>
        <Button
          onClick={() => {
            setNotice(null);
            createPortal.mutate();
          }}
          loading={createPortal.isPending}
          leftSection={<IconCreditCard size={18} aria-hidden />}
          rightSection={<IconExternalLink size={14} aria-hidden />}
          variant={portalIsPrimary ? "filled" : "default"}
          size="md"
          w={{ base: "100%", xs: "auto" }}
          data-testid="billing-portal"
        >
          {portalLabel}
        </Button>
        {message}
      </Stack>
    );
  }

  const price = proPriceView(pricing, billingInterval);

  return (
    <Stack gap="xs" align="flex-start" w={{ base: "100%", xs: "auto" }}>
      <SegmentedControl
        aria-label="Billing interval"
        // A fixed name: the generated one differs between server and client.
        name="billing-interval"
        value={billingInterval}
        onChange={(value) => setBillingInterval(value === "annual" ? "annual" : "monthly")}
        data={[
          { label: "Monthly", value: "monthly" },
          { label: "Annual", value: "annual" },
        ]}
        size="sm"
      />
      <Button
        onClick={() => {
          setNotice(null);
          createCheckout.mutate({ billingInterval, successPath: "/app/settings?checkout=success" });
        }}
        loading={createCheckout.isPending || createPortal.isPending}
        leftSection={<IconCreditCard size={18} aria-hidden />}
        size="md"
        w={{ base: "100%", xs: "auto" }}
        data-testid="billing-checkout"
      >
        {mode === "resubscribe" ? price.cta.replace("Upgrade to", "Resubscribe to") : price.cta}
      </Button>
      {mode === "resubscribe" && (
        // Not an upgrade: a second subscription, charged now.
        <Text size="xs" c="var(--iso-text-secondary)" maw={320} data-testid="resubscribe-note">
          This starts a new subscription and you are charged today.{" "}
          {paidUntil ? (
            <>
              You already have Pro until{" "}
              <time dateTime={new Date(paidUntil).toISOString()}>
                <LocalDate date={paidUntil} format="dateLong" />
              </time>
              ; that time is not added on.
            </>
          ) : (
            "The time left on your canceled subscription is not added on."
          )}
        </Text>
      )}
      {price.annualNote && (
        <Text size="xs" c="var(--iso-text-secondary)">
          {price.annualNote}
        </Text>
      )}
      {message}
    </Stack>
  );
}
