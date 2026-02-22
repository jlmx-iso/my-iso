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
  smallText,
  ctaSection,
} from "./components/styles";

type VerifyEmailProps = {
  verificationUrl: string;
  unsubscribeUrl?: string;
};

export function VerifyEmail({
  verificationUrl,
  unsubscribeUrl,
}: VerifyEmailProps) {
  return (
    <Layout
      preview="Verify your email address for ISO"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>Verify your email</Heading>

      <Text style={paragraph}>
        Click the button below to verify your email address and get started on
        ISO.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={verificationUrl}>
          Verify Email Address
        </Button>
      </Section>

      <Text style={smallText}>
        If the button doesn't work, copy and paste this link into your browser:
      </Text>
      <Text style={smallText}>
        <Link href={verificationUrl} style={{ color: "#F97316", wordBreak: "break-all" }}>
          {verificationUrl}
        </Link>
      </Text>

      <Text style={smallText}>
        This link will expire in 24 hours. If you didn't create an ISO account,
        you can safely ignore this email.
      </Text>
    </Layout>
  );
}

export async function renderVerifyEmail(
  props: VerifyEmailProps
): Promise<string> {
  return render(<VerifyEmail {...props} />);
}
