import { Heading, Section, Text } from "@react-email/components";
import { render } from "@react-email/render";

import { Layout } from "./components/Layout";
import { calloutBox, heading, paragraph, smallText } from "./components/styles";

type MobileOtpEmailProps = {
  code: string;
};

export function MobileOtpEmail({ code }: MobileOtpEmailProps) {
  return (
    <Layout preview={`${code} is your ISO sign-in code`}>
      <Heading style={heading}>Your sign-in code</Heading>

      <Text style={paragraph}>
        Enter this code in the ISO app to sign in. It expires in 10 minutes.
      </Text>

      <Section style={calloutBox}>
        <Text
          style={{
            fontSize: "36px",
            fontWeight: "700",
            letterSpacing: "12px",
            textAlign: "center",
            margin: "0",
            color: "#F97316",
          }}
        >
          {code}
        </Text>
      </Section>

      <Text style={smallText}>
        If you didn't request this code, you can safely ignore this email.
      </Text>
    </Layout>
  );
}

export async function renderMobileOtpEmail(
  props: MobileOtpEmailProps
): Promise<string> {
  return render(<MobileOtpEmail {...props} />);
}
