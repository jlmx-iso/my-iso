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

type UploadPortfolioEmailProps = {
  firstName: string;
  portfolioUrl: string;
  unsubscribeUrl?: string;
};

export function UploadPortfolioEmail({
  firstName,
  portfolioUrl,
  unsubscribeUrl,
}: UploadPortfolioEmailProps) {
  return (
    <Layout
      preview="Your work speaks louder than your bio"
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>
        Your work speaks louder than your bio
      </Heading>

      <Text style={paragraph}>
        Hey {firstName}, your profile is looking good — but a photographer
        without photos is like a musician without a playlist. Time to let your
        work do the talking.
      </Text>

      <Text style={paragraph}>
        Upload your best shots to your portfolio. These are what potential
        clients and collaborators will see first, so pick the images that
        represent the kind of work you want to be doing.
      </Text>

      <Section style={calloutBox}>
        <Text style={{ ...calloutText, fontWeight: "600", marginBottom: "8px" }}>
          Tips for a standout portfolio:
        </Text>
        <Text style={calloutText}>
          Lead with your strongest images
          <br />
          Show range, but stay cohesive
          <br />
          Quality over quantity — 8-12 great shots beat 50 okay ones
          <br />
          Include the type of work you want to get hired for
        </Text>
      </Section>

      <Section style={ctaSection}>
        <Button style={ctaButton} href={portfolioUrl}>
          Add Portfolio Images
        </Button>
      </Section>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderUploadPortfolioEmail(
  props: UploadPortfolioEmailProps
): Promise<string> {
  return render(<UploadPortfolioEmail {...props} />);
}
