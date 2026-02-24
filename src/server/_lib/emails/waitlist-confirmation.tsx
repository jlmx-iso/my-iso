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

type WaitlistConfirmationEmailProps = {
  name: string;
};

export function WaitlistConfirmationEmail({
  name,
}: WaitlistConfirmationEmailProps) {
  return (
    <Layout preview="You're on the ISO waitlist — we'll be in touch.">
      <Heading style={heading}>You&apos;re on the list, {name}.</Heading>

      <Text style={paragraph}>
        We&apos;ve received your application and reserved your spot on the ISO
        waitlist. We review applications manually, so approval typically takes
        anywhere from a few days to a few weeks.
      </Text>

      <Text style={paragraph}>
        When a spot opens up and your application is approved, you&apos;ll get
        an email from us with a link to create your account. Keep an eye on
        your inbox.
      </Text>

      <Text style={paragraph}>
        Thanks for your interest — we&apos;re looking forward to seeing your
        work.
      </Text>

      <Text style={signature}>— Penny & Jordan</Text>
    </Layout>
  );
}

export async function renderWaitlistConfirmationEmail(
  props: WaitlistConfirmationEmailProps,
): Promise<string> {
  return render(<WaitlistConfirmationEmail {...props} />);
}
