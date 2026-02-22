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

type WelcomeEmailProps = {
  firstName: string;
  profileUrl: string;
  unsubscribeUrl?: string;
};

export function WelcomeEmail({
  firstName,
  profileUrl,
  unsubscribeUrl,
}: WelcomeEmailProps) {
  return (
    <Layout
      preview={`Welcome to ISO, ${firstName}. You're in.`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>You're in, {firstName}.</Heading>

      <Text style={paragraph}>
        Welcome to ISO. We built this for photographers like you — people who
        care about their craft and want to connect with others who feel the same
        way.
      </Text>

      <Text style={paragraph}>
        ISO is a place to find your next shoot, build real connections, and let
        your work speak for itself. No algorithms deciding who sees your photos.
        No pay-to-play. Just photographers helping photographers.
      </Text>

      <Text style={paragraph}>Here's what you can do right away:</Text>

      <Text style={paragraph}>
        <strong>Build your profile</strong> — Show the world who you are and
        what you shoot.
        <br />
        <strong>Upload your portfolio</strong> — Let your images do the talking.
        <br />
        <strong>Browse events</strong> — Find shoots, meetups, and open calls
        near you.
        <br />
        <strong>Connect</strong> — Reach out to photographers whose work you
        admire.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={profileUrl}>
          Complete Your Profile
        </Button>
      </Section>

      <Text style={paragraph}>
        We're a small team — just us, Penny and Jordan — and we read every
        single reply to these emails. If you have questions, ideas, or just want
        to say hi, hit reply. We mean it.
      </Text>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderWelcomeEmail(
  props: WelcomeEmailProps
): Promise<string> {
  return render(<WelcomeEmail {...props} />);
}
