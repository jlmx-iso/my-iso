import { Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";

import { Layout } from "./components/Layout";
import { calloutBox, calloutText, heading, paragraph } from "./components/styles";

type SupportRequestEmailProps = {
  /** The member's account id: enough to find them, and no more. */
  memberId: string;
  subject: string;
  message: string;
};

/**
 * A Pro member's support request, to the support inbox. Carries the
 * member's id rather than their name or address (look them up by id); the
 * text is theirs, escaped by React.
 */
export function SupportRequestEmail({ memberId, subject, message }: SupportRequestEmailProps) {
  return (
    <Layout preview={`Pro support request: ${subject}`}>
      <Heading style={heading}>Pro support request</Heading>
      <Text style={paragraph}>
        Member id: <strong>{memberId}</strong>
      </Text>
      <Text style={paragraph}>
        Subject: <strong>{subject}</strong>
      </Text>
      <Section style={calloutBox}>
        <Text style={{ ...calloutText, whiteSpace: "pre-wrap" }}>{message}</Text>
      </Section>
    </Layout>
  );
}

export async function renderSupportRequestEmail(props: SupportRequestEmailProps): Promise<string> {
  return render(<SupportRequestEmail {...props} />);
}
