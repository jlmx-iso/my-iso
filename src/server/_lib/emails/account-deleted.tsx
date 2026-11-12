import { Heading, Text } from "@react-email/components";
import { render } from "@react-email/render";

import { Layout } from "./components/Layout";
import { heading, paragraph, smallText } from "./components/styles";

type AccountDeletedEmailProps = {
  firstName: string;
  supportEmail: string;
};

export function AccountDeletedEmail({ firstName, supportEmail }: AccountDeletedEmailProps) {
  return (
    <Layout preview="Your ISO account has been deleted.">
      <Heading style={heading}>Your account has been deleted</Heading>

      <Text style={paragraph}>
        {firstName ? `${firstName}, as` : "As"} you asked, your ISO account has been deleted. Your
        profile, portfolio, photos and events are gone, and any Pro subscription has been
        cancelled, so you will not be charged again.
      </Text>

      <Text style={paragraph}>
        Messages you sent stay in the conversations of the people who received them, shown as
        coming from a deleted member. Our privacy policy explains what else is kept, and why.
      </Text>

      <Text style={smallText}>
        If you did not ask for this, write to {supportEmail} right away.
      </Text>
    </Layout>
  );
}

export async function renderAccountDeletedEmail(props: AccountDeletedEmailProps): Promise<string> {
  return render(<AccountDeletedEmail {...props} />);
}
