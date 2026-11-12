import {
  Button,
  Heading,
  Section,
  Text,
  Hr,
} from "@react-email/components";
import { render } from "@react-email/render";
import { Fragment } from "react";
import type * as React from "react";

import { PRO_PLAN, proFeaturesFor } from "~/_utils/plans";

import { Layout } from "./components/Layout";
import {
  heading,
  paragraph,
  ctaButton,
  calloutBox,
  calloutText,
  signature,
  colors,
  ctaSection,
} from "./components/styles";

type UpgradePitchEmailProps = {
  firstName: string;
  profileViews: number;
  bookingCount: number;
  messageCount: number;
  upgradeUrl: string;
  unsubscribeUrl?: string;
  /** Founding members are told their price stays while they stay subscribed. */
  isFoundingPrice?: boolean;
};

export function UpgradePitchEmail({
  firstName,
  profileViews,
  bookingCount,
  messageCount,
  upgradeUrl,
  unsubscribeUrl,
  isFoundingPrice = false,
}: UpgradePitchEmailProps) {
  return (
    <Layout
      preview={`You're getting popular on ISO, ${firstName}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>You&apos;re getting popular, {firstName}</Heading>

      <Text style={paragraph}>
        We&apos;ve been watching your activity on ISO (in the best, least-creepy way
        possible), and you&apos;re on a roll.
      </Text>

      {/* Stats */}
      <Section style={{ textAlign: "center", margin: "24px 0" }}>
        <Section style={statRow}>
          <Text style={statNumber}>{profileViews}</Text>
          <Text style={statLabel}>Profile Views</Text>
        </Section>
        <Hr style={{ borderColor: colors.gray200, margin: "8px 0" }} />
        <Section style={statRow}>
          <Text style={statNumber}>{bookingCount}</Text>
          <Text style={statLabel}>Bookings</Text>
        </Section>
        <Hr style={{ borderColor: colors.gray200, margin: "8px 0" }} />
        <Section style={statRow}>
          <Text style={statNumber}>{messageCount}</Text>
          <Text style={statLabel}>Messages</Text>
        </Section>
      </Section>

      <Text style={paragraph}>
        You&apos;re clearly building something here. If you&apos;d like to back
        ISO while it grows, there&apos;s ISO Pro.
      </Text>

      {/* The same list as the site (PRO_PLAN): what Pro gives today, and what
          is planned under its own heading, never as a current benefit. */}
      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "8px" }}>
          With ISO Pro today:
        </Text>
        <Text style={calloutText} data-section="pro-now">
          {proFeaturesFor({ isFoundingPrice }).map((feature, index) => (
            <Fragment key={feature}>
              {index > 0 && <br />}
              {feature}
            </Fragment>
          ))}
        </Text>
        {PRO_PLAN.comingSoon.length > 0 && (
          <>
            <Text style={{ ...calloutText, fontWeight: "600", margin: "16px 0 8px" }}>
              Coming soon (not yet available):
            </Text>
            <Text style={calloutText} data-section="pro-coming-soon">
              {PRO_PLAN.comingSoon.map((feature, index) => (
                <Fragment key={feature}>
                  {index > 0 && <br />}
                  {feature}
                </Fragment>
              ))}
            </Text>
          </>
        )}
      </Section>

      <Text style={paragraph}>
        No pressure: everything you use on ISO today is free, and the free plan
        is here to stay.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={upgradeUrl}>
          Learn About Pro
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderUpgradePitchEmail(
  props: UpgradePitchEmailProps
): Promise<string> {
  return render(<UpgradePitchEmail {...props} />);
}

const statRow: React.CSSProperties = {
  padding: "8px 0",
};

const statNumber: React.CSSProperties = {
  fontSize: "28px",
  fontWeight: "700",
  color: colors.orange,
  margin: "0",
  lineHeight: "1.2",
};

const statLabel: React.CSSProperties = {
  fontSize: "13px",
  color: colors.gray500,
  margin: "0",
  textTransform: "uppercase" as const,
  letterSpacing: "1px",
};
