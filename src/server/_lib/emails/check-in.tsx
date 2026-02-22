import {
  Heading,
  Text,
} from "@react-email/components";
import { render } from "@react-email/render";

import { Layout } from "./components/Layout";
import {
  heading,
  paragraph,
  signature,
} from "./components/styles";

type CheckInEmailProps = {
  firstName: string;
  unsubscribeUrl?: string;
};

export function CheckInEmail({
  firstName,
  unsubscribeUrl,
}: CheckInEmailProps) {
  return (
    <Layout
      preview={`Hey ${firstName}, how's it going on ISO?`}
      unsubscribeUrl={unsubscribeUrl}
    >
      <Heading style={heading}>Hey {firstName}, how's it going?</Heading>

      <Text style={paragraph}>
        It's been a couple weeks since you joined ISO, and we wanted to check
        in. Real quick — no sales pitch, no "engagement metrics." Just us
        asking.
      </Text>

      <Text style={paragraph}>
        How's your experience been so far? Finding what you're looking for?
        Anything confusing or frustrating? We're building this thing as we go,
        and honest feedback from photographers like you is what makes it better.
      </Text>

      <Text style={paragraph}>
        Seriously — just hit reply. This goes straight to our inbox. Jordan
        usually responds within a few hours (Penny's faster, but don't tell
        him that).
      </Text>

      <Text style={paragraph}>
        We hope ISO is helping you find shoots, make connections, and do more
        of the work you love. If it's not, we want to know why.
      </Text>

      <Text style={signature}>— Penny & Jordan</Text>
      <Text style={{ ...paragraph, fontSize: "13px", color: "#9CA3AF", marginTop: "4px" }}>
        P.S. — Yes, we really do read every reply. Try us.
      </Text>
    </Layout>
  );
}

export async function renderCheckInEmail(
  props: CheckInEmailProps
): Promise<string> {
  return render(<CheckInEmail {...props} />);
}
