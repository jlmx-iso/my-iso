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

type BookingAcceptedEmailProps = {
  applicantFirstName: string;
  ownerName: string;
  eventTitle: string;
  eventDate: string;
  eventLocation: string;
  eventUrl: string;
  unsubscribeUrl?: string;
};

export function BookingAcceptedEmail({
  applicantFirstName,
  ownerName,
  eventTitle,
  eventDate,
  eventLocation,
  eventUrl,
  unsubscribeUrl,
}: BookingAcceptedEmailProps) {
  return (
    <Layout
      preview={`You're booked for ${eventTitle}!`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>You're booked!</Heading>

      <Text style={paragraph}>
        Congrats {applicantFirstName} — {ownerName} accepted your application.
        You're officially on the roster.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "8px" }}>
          Booking Details
        </Text>
        <Text style={calloutText}>
          <strong>Event:</strong> {eventTitle}
          <br />
          <strong>Date:</strong> {eventDate}
          <br />
          <strong>Location:</strong> {eventLocation}
        </Text>
      </Section>

      <Text style={paragraph}>
        We recommend reaching out to {ownerName} to confirm any final
        details — gear, timing, parking, you name it. A quick message goes
        a long way.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={eventUrl}>
          View Event Details
        </Button>
      </Section>
    </Layout>
  );
}

export async function renderBookingAcceptedEmail(
  props: BookingAcceptedEmailProps
): Promise<string> {
  return render(<BookingAcceptedEmail {...props} />);
}
