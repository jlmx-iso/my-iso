import {
  Button,
  Heading,
  Section,
  Text,
  Link,
} from "@react-email/components";
import { render } from "@react-email/render";

import { Layout } from "./components/Layout";
import {
  heading,
  paragraph,
  ctaButton,
  signature,
  ctaSection,
  linkStyle,
} from "./components/styles";

type InactiveLastChanceEmailProps = {
  firstName: string;
  loginUrl: string;
  preferencesUrl: string;
  unsubscribeUrl?: string;
};

export function InactiveLastChanceEmail({
  firstName,
  loginUrl,
  preferencesUrl,
  unsubscribeUrl,
}: InactiveLastChanceEmailProps) {
  return (
    <Layout
      preview="We miss you on ISO"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>We miss you, {firstName}</Heading>

      <Text style={paragraph}>
        It's been a month since you've been on ISO, and we'll be honest — we
        notice when someone goes quiet. Not in a creepy way. In a "we hope
        you're doing great work out there" kind of way.
      </Text>

      <Text style={paragraph}>
        If ISO isn't what you needed, that's okay. We're always making it
        better, and what you see today is different from what you saw when
        you signed up. New features, more photographers, and a growing
        community of people who love what they do.
      </Text>

      <Text style={paragraph}>
        If you'd like to come back and take a fresh look, we'd love to have
        you. If not, no hard feelings — you can adjust how often you hear
        from us below.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={loginUrl}>
          Take Another Look
        </Button>
      </Section>

      <Text style={{ ...paragraph, fontSize: "14px", textAlign: "center" }}>
        Getting too many emails?{" "}
        <Link href={preferencesUrl} style={linkStyle}>
          Adjust your email frequency
        </Link>
      </Text>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderInactiveLastChanceEmail(
  props: InactiveLastChanceEmailProps
): Promise<string> {
  return render(<InactiveLastChanceEmail {...props} />);
}
