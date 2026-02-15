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

type NewMessageEmailProps = {
  recipientFirstName: string;
  senderName: string;
  messagePreview: string;
  conversationUrl: string;
  unsubscribeUrl?: string;
};

export function NewMessageEmail({
  recipientFirstName,
  senderName,
  messagePreview,
  conversationUrl,
  unsubscribeUrl,
}: NewMessageEmailProps) {
  return (
    <Layout
      preview={`New message from ${senderName}`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>
        You have a new message
      </Heading>

      <Text style={paragraph}>
        Hey {recipientFirstName}, {senderName} sent you a message on ISO.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontStyle: "italic" }}>
          "{messagePreview}"
        </Text>
      </Section>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={conversationUrl}>
          View Conversation
        </Button>
      </Section>
    </Layout>
  );
}

export async function renderNewMessageEmail(
  props: NewMessageEmailProps
): Promise<string> {
  return render(<NewMessageEmail {...props} />);
}
