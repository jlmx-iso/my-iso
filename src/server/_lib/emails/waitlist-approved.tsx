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

type WaitlistApprovedEmailProps = {
  name: string;
  joinUrl: string;
  unsubscribeUrl?: string;
};

export function WaitlistApprovedEmail({
  name,
  joinUrl,
  unsubscribeUrl,
}: WaitlistApprovedEmailProps) {
  return (
    <Layout
      preview={`You're in, ${name}! Your spot on ISO is ready.`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>You&apos;re in, {name}.</Heading>

      <Text style={paragraph}>
        We reviewed your application and we&apos;d love to have you as part of
        the founding class of ISO.
      </Text>

      <Text style={paragraph}>
        ISO is an invite-only photographer network where leads find second
        shooters and second shooters find gigs. You&apos;re joining a small,
        curated group of photographers who are building something special
        together.
      </Text>

      <Text style={paragraph}>
        Click below to create your account and get started.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={joinUrl}>
          Join ISO
        </Button>
      </Section>

      <Text style={paragraph}>
        Welcome aboard. We can&apos;t wait to see your work.
      </Text>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderWaitlistApprovedEmail(
  props: WaitlistApprovedEmailProps,
): Promise<string> {
  return render(<WaitlistApprovedEmail {...props} />);
}
