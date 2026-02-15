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
  signature,
  ctaSection,
} from "./components/styles";

type MakeConnectionEmailProps = {
  firstName: string;
  searchUrl: string;
  unsubscribeUrl?: string;
};

export function MakeConnectionEmail({
  firstName,
  searchUrl,
  unsubscribeUrl,
}: MakeConnectionEmailProps) {
  return (
    <Layout
      preview="Send a message to someone whose work you admire"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>
        Photography is better together
      </Heading>

      <Text style={paragraph}>
        Hey {firstName}, one of the things we love most about ISO is watching
        photographers connect. Some of the coolest collaborations, second
        shooters, and friendships have started with a simple message.
      </Text>

      <Text style={paragraph}>
        Find someone whose work catches your eye and send them a note. It
        doesn't have to be fancy — "Hey, I love your work, especially [that
        shot]" goes a long way. You'd be surprised how many people are just
        waiting for someone to reach out.
      </Text>

      <Text style={paragraph}>
        The photography community is small. The connections you make here
        can turn into referrals, collaborations, and real friendships.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={searchUrl}>
          Find Photographers
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderMakeConnectionEmail(
  props: MakeConnectionEmailProps
): Promise<string> {
  return render(<MakeConnectionEmail {...props} />);
}
