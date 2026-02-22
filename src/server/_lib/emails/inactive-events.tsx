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
  colors,
  ctaSection,
} from "./components/styles";

type EventSummary = {
  title: string;
  date: string;
  location: string;
  url: string;
};

type InactiveEventsEmailProps = {
  firstName: string;
  events: EventSummary[];
  browseEventsUrl: string;
  unsubscribeUrl?: string;
};

export function InactiveEventsEmail({
  firstName,
  events,
  browseEventsUrl,
  unsubscribeUrl,
}: InactiveEventsEmailProps) {
  return (
    <Layout
      preview={`New events near you, ${firstName}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>New events near you</Heading>

      <Text style={paragraph}>
        Hey {firstName}, a few new events popped up that we thought you'd want
        to know about.
      </Text>

      {events.map((event, index) => (
        <Section key={index} style={eventCard}>
          <Text style={eventTitle}>{event.title}</Text>
          <Text style={eventDetail}>
            {event.date} &middot; {event.location}
          </Text>
          <Button
            href={event.url}
            style={{
              color: colors.orange,
              fontSize: "14px",
              fontWeight: "600",
              textDecoration: "none",
            }}
          >
            View Details &rarr;
          </Button>
          {index < events.length - 1 && (
            <Hr style={{ borderColor: colors.gray200, marginTop: "16px" }} />
          )}
        </Section>
      ))}

      <Section style={ctaSection}>
        <Button style={ctaButton} href={browseEventsUrl}>
          Browse All Events
        </Button>
      </Section>
    </Layout>
  );
}

export async function renderInactiveEventsEmail(
  props: InactiveEventsEmailProps
): Promise<string> {
  return render(<InactiveEventsEmail {...props} />);
}

const eventCard: React.CSSProperties = {
  padding: "16px 0",
};

const eventTitle: React.CSSProperties = {
  fontSize: "16px",
  fontWeight: "600",
  color: colors.gray900,
  margin: "0 0 4px",
};

const eventDetail: React.CSSProperties = {
  fontSize: "14px",
  color: colors.gray500,
  margin: "0 0 8px",
};
