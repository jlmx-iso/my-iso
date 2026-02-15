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
  secondaryButton,
  signature,
  ctaSection,
  colors,
} from "./components/styles";

type FirstEventEmailProps = {
  firstName: string;
  createEventUrl: string;
  browseEventsUrl: string;
  unsubscribeUrl?: string;
};

export function FirstEventEmail({
  firstName,
  createEventUrl,
  browseEventsUrl,
  unsubscribeUrl,
}: FirstEventEmailProps) {
  return (
    <Layout
      preview="Post your first event or browse open calls near you"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>Ready to shoot, {firstName}?</Heading>

      <Text style={paragraph}>
        Events are the heart of ISO. Whether you're looking for your next gig
        or want to organize a shoot, this is where it happens.
      </Text>

      <Hr style={{ borderColor: colors.gray200, margin: "24px 0" }} />

      {/* Path A: Create an event */}
      <Text style={{ ...paragraph, fontWeight: "600", fontSize: "18px" }}>
        Looking for photographers?
      </Text>
      <Text style={paragraph}>
        Post an event and let photographers come to you. Wedding, portrait
        session, creative project, meetup — whatever you need, there are
        photographers in your area ready to work.
      </Text>
      <Section style={ctaSection}>
        <Button style={ctaButton} href={createEventUrl}>
          Post an Event
        </Button>
      </Section>

      <Hr style={{ borderColor: colors.gray200, margin: "24px 0" }} />

      {/* Path B: Browse events */}
      <Text style={{ ...paragraph, fontWeight: "600", fontSize: "18px" }}>
        Looking for work?
      </Text>
      <Text style={paragraph}>
        Browse open calls and events near you. Apply to the ones that match
        your style and availability. Some of the best collaborations start
        with a simple "I'm interested."
      </Text>
      <Section style={ctaSection}>
        <Button style={secondaryButton} href={browseEventsUrl}>
          Browse Events
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderFirstEventEmail(
  props: FirstEventEmailProps
): Promise<string> {
  return render(<FirstEventEmail {...props} />);
}
