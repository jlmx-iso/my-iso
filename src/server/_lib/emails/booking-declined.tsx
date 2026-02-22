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
  ctaSection,
} from "./components/styles";

type BookingDeclinedEmailProps = {
  applicantFirstName: string;
  eventTitle: string;
  browseEventsUrl: string;
  unsubscribeUrl?: string;
};

export function BookingDeclinedEmail({
  applicantFirstName,
  eventTitle,
  browseEventsUrl,
  unsubscribeUrl,
}: BookingDeclinedEmailProps) {
  return (
    <Layout
      preview={`Update on your application for ${eventTitle}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>Update on your application</Heading>

      <Text style={paragraph}>
        Hey {applicantFirstName}, we wanted to let you know that the organizer
        of {eventTitle} has gone in a different direction for this one.
      </Text>

      <Text style={paragraph}>
        These things happen — it's rarely about you or your work. Sometimes
        the organizer is looking for a very specific style, has a budget
        constraint, or already had someone in mind. Don't let it slow you
        down.
      </Text>

      <Text style={paragraph}>
        There are always new events being posted, and the right one is out
        there. Keep shooting, keep applying, and keep putting your work out
        there.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={browseEventsUrl}>
          Browse More Events
        </Button>
      </Section>
    </Layout>
  );
}

export async function renderBookingDeclinedEmail(
  props: BookingDeclinedEmailProps
): Promise<string> {
  return render(<BookingDeclinedEmail {...props} />);
}
