import {
  Button,
  Heading,
  Section,
  Text,
  Link,
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
  linkStyle,
  ctaSection,
} from "./components/styles";

type ReferralInviteEmailProps = {
  firstName: string;
  referralLink: string;
  referralCode: string;
  unsubscribeUrl?: string;
};

export function ReferralInviteEmail({
  firstName,
  referralLink,
  referralCode,
  unsubscribeUrl,
}: ReferralInviteEmailProps) {
  return (
    <Layout
      preview="Know someone who'd love ISO? Share your referral link."
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>Know someone who'd love ISO?</Heading>

      <Text style={paragraph}>
        Hey {firstName}, you've been doing great work on ISO, and we think
        you probably know other photographers who'd love it here too.
      </Text>

      <Text style={paragraph}>
        The best communities grow through word of mouth. If you know someone
        who's looking for shoots, collaborators, or just a better way to
        connect with other photographers, send them your way.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "8px" }}>
          Your referral link
        </Text>
        <Text style={calloutText}>
          <Link href={referralLink} style={linkStyle}>
            {referralLink}
          </Link>
        </Text>
        <Text style={{ ...calloutText, marginTop: "8px" }}>
          Your code: <strong>{referralCode}</strong>
        </Text>
      </Section>

      <Text style={paragraph}>
        Share it however you'd like — text, email, carrier pigeon. When
        someone signs up with your link, good things happen for both of
        you.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={referralLink}>
          Copy Your Referral Link
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderReferralInviteEmail(
  props: ReferralInviteEmailProps
): Promise<string> {
  return render(<ReferralInviteEmail {...props} />);
}
