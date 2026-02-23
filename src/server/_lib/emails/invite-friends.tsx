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

type InviteFriendsEmailProps = {
  firstName: string;
  inviteLink: string;
  inviteCode: string;
  unsubscribeUrl?: string;
};

export function InviteFriendsEmail({
  firstName,
  inviteLink,
  inviteCode,
  unsubscribeUrl,
}: InviteFriendsEmailProps) {
  return (
    <Layout
      preview="You have invites to share — bring your favorite photographers to ISO."
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>Invite your people, {firstName}.</Heading>

      <Text style={paragraph}>
        ISO is built on trust. The best communities grow through people who
        genuinely know and vouch for each other — and that starts with you.
      </Text>

      <Text style={paragraph}>
        You have a limited number of invites. Use them on photographers you
        know and respect — people who&apos;d make this community better.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "8px" }}>
          Your invite code
        </Text>
        <Text style={{ ...calloutText, fontSize: "20px", fontWeight: "700", fontFamily: "monospace", letterSpacing: "2px" }}>
          {inviteCode}
        </Text>
        <Text style={{ ...calloutText, marginTop: "8px" }}>
          Or share this link:{" "}
          <Link href={inviteLink} style={linkStyle}>
            {inviteLink}
          </Link>
        </Text>
      </Section>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={inviteLink}>
          Share Your Invite
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderInviteFriendsEmail(
  props: InviteFriendsEmailProps,
): Promise<string> {
  return render(<InviteFriendsEmail {...props} />);
}
