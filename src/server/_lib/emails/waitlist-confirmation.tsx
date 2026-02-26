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
  email: string;
  name?: string;
};

export function WaitlistConfirmationEmail({
  name,
}: WaitlistConfirmationEmailProps) {
  return (
    <Layout
      preview="You're on the ISO waitlist. We'll be in touch when a spot opens."
    >
      <Heading style={heading}>
        {name ? `${name}, you're on the list.` : "You're on the list."}
      </Heading>

      <Text style={paragraph}>
        Your spot on the ISO waitlist is reserved. We&apos;re glad you applied.
      </Text>

      <Text style={paragraph}>
        Approvals are reviewed manually, and spots open up as we grow. That
        typically means days to a few weeks depending on where things stand
        when you applied.
      </Text>

      <Text style={paragraph}>
        When a spot opens for you, you&apos;ll hear from us at{" "}
        hello@myiso.app, so keep an eye out.
      </Text>

      <Text style={paragraph}>
        Thanks for your patience. We&apos;re building something good here and
        we want the right people in the room.
      </Text>

      <Text style={signature}>Penny &amp; Jordan</Text>
    </Layout>
  );
}

export async function renderWaitlistConfirmationEmail(
  props: WaitlistConfirmationEmailProps,
): Promise<string> {
  return render(<WaitlistConfirmationEmail {...props} />);
}
