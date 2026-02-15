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
  ctaSection,
} from "./components/styles";

type BookingAppliedEmailProps = {
  ownerFirstName: string;
  applicantName: string;
  eventTitle: string;
  eventUrl: string;
  unsubscribeUrl?: string;
};

export function BookingAppliedEmail({
  ownerFirstName,
  applicantName,
  eventTitle,
  eventUrl,
  unsubscribeUrl,
}: BookingAppliedEmailProps) {
  return (
    <Layout
      preview={`${applicantName} wants to shoot with you!`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>Someone wants to shoot with you!</Heading>

      <Text style={paragraph}>
        Hey {ownerFirstName}, great news — {applicantName} has applied to your
        event.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "4px" }}>
          Event
        </Text>
        <Text style={calloutText}>{eventTitle}</Text>
      </Section>

      <Text style={paragraph}>
        Head over to your event page to review their profile and portfolio.
        The sooner you respond, the more likely they are to be available.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={eventUrl}>
          Review Application
        </Button>
      </Section>
    </Layout>
  );
}

export async function renderBookingAppliedEmail(
  props: BookingAppliedEmailProps
): Promise<string> {
  return render(<BookingAppliedEmail {...props} />);
}
