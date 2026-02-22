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
  signature,
  ctaSection,
} from "./components/styles";

type CompleteProfileEmailProps = {
  firstName: string;
  profileUrl: string;
  unsubscribeUrl?: string;
};

export function CompleteProfileEmail({
  firstName,
  profileUrl,
  unsubscribeUrl,
}: CompleteProfileEmailProps) {
  return (
    <Layout
      preview="Photographers with complete profiles get 3x more bookings"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>
        Your profile is your first impression, {firstName}
      </Heading>

      <Text style={paragraph}>
        We see it all the time — photographers with complete profiles get 3x
        more bookings than those without. Your profile is how clients and
        collaborators decide whether to reach out.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "8px" }}>
          A strong profile includes:
        </Text>
        <Text style={calloutText}>
          A professional headshot or photo of you
          <br />
          A bio that shows your personality and style
          <br />
          Your location and the types of photography you do
          <br />
          Your rates or availability (even a range helps)
        </Text>
      </Section>

      <Text style={paragraph}>
        It doesn't have to be perfect — just real. People connect with
        authenticity, not polish.
      </Text>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={profileUrl}>
          Complete Your Profile
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderCompleteProfileEmail(
  props: CompleteProfileEmailProps
): Promise<string> {
  return render(<CompleteProfileEmail {...props} />);
}
