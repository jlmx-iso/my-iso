import type * as React from "react";
import {
  Button,
  Heading,
  Section,
  Text,
  Hr,
} from "@react-email/components";
import { render } from "@react-email/render";

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
};

export function UpgradePitchEmail({
  firstName,
  profileViews,
  bookingCount,
  messageCount,
  upgradeUrl,
  unsubscribeUrl,
}: UpgradePitchEmailProps) {
  return (
    <Layout
      preview={`You're getting popular on ISO, ${firstName}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>You're getting popular, {firstName}</Heading>

      <Text style={paragraph}>
        We've been watching your activity on ISO (in the best, least-creepy way
        possible), and you're on a roll.
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
        You're clearly building something here. ISO Pro can help you take it
        further.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "8px" }}>
          With ISO Pro, you get:
        </Text>
        <Text style={calloutText}>
          Priority placement in search results
          <br />
          Featured profile badge
          <br />
          Advanced analytics on your portfolio
          <br />
          Unlimited event applications
          <br />
          Early access to new features
        </Text>
      </Section>

      <Text style={paragraph}>
        No pressure — ISO will always have a free tier. But if you're serious
        about growing your photography business, Pro is built for people like
        you.
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
