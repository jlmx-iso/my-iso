import {
  Button,
  Heading,
  Section,
  Text,
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
  ctaSection,
} from "./components/styles";

type InactiveMissingEmailProps = {
  firstName: string;
  loginUrl: string;
  unsubscribeUrl?: string;
};

export function InactiveMissingEmail({
  firstName,
  loginUrl,
  unsubscribeUrl,
}: InactiveMissingEmailProps) {
  return (
    <Layout
      preview="Photographers are looking for you on ISO"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>
        Photographers are looking for you
      </Heading>

      <Text style={paragraph}>
        Hey {firstName}, it's been a couple weeks since you've been on ISO,
        and we wanted you to know — the community is growing. New
        photographers are joining every day, events are being posted, and
        connections are being made.
      </Text>

      <Section style={calloutBox}>
        <Text style={calloutText}>
          Your profile is still live, and other photographers can see it.
          If someone reaches out, you'll want to be around to respond.
        </Text>
      </Section>

      <Text style={paragraph}>
        Even a quick visit to browse new events or check your messages can
        lead to your next big opportunity. The best gigs often come from
        being present.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={loginUrl}>
          Jump Back In
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderInactiveMissingEmail(
  props: InactiveMissingEmailProps
): Promise<string> {
  return render(<InactiveMissingEmail {...props} />);
}
