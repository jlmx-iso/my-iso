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

type BookingCompletedEmailProps = {
  firstName: string;
  partnerName: string;
  eventTitle: string;
  reviewUrl: string;
  unsubscribeUrl?: string;
};

export function BookingCompletedEmail({
  firstName,
  partnerName,
  eventTitle,
  reviewUrl,
  unsubscribeUrl,
}: BookingCompletedEmailProps) {
  return (
    <Layout
      preview={`How'd it go at ${eventTitle}?`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>How'd it go?</Heading>

      <Text style={paragraph}>
        Hey {firstName}, hope the shoot went well! {eventTitle} with{" "}
        {partnerName} is wrapped up, and we'd love to hear how it went.
      </Text>

      <Section style={calloutBox}>
        <Text style={calloutText}>
          Reviews help the entire ISO community. They help photographers
          find great collaborators and they help event organizers build
          trust. A quick, honest review takes less than a minute.
        </Text>
      </Section>

      <Text style={paragraph}>
        What was working with {partnerName} like? Were they professional,
        prepared, and easy to work with? Your review helps others make
        better decisions — and it helps {partnerName} grow.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={reviewUrl}>
          Leave a Review
        </Button>
      </Section>
    </Layout>
  );
}

export async function renderBookingCompletedEmail(
  props: BookingCompletedEmailProps
): Promise<string> {
  return render(<BookingCompletedEmail {...props} />);
}
