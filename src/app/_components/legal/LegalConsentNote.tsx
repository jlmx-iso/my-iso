import { Anchor, Text } from "@mantine/core";

import { NextLink } from "~/app/_components/NextLink";

/** Under the sign-in, sign-up and waitlist forms: what continuing means. */
export default function LegalConsentNote() {
  return (
    <Text size="xs" c="dimmed" ta="center" mt="sm" data-testid="legal-consent-note">
      By continuing you agree to the{" "}
      <Anchor component={NextLink} href="/terms" size="xs">
        Terms
      </Anchor>{" "}
      and acknowledge the{" "}
      <Anchor component={NextLink} href="/privacy" size="xs">
        Privacy Policy
      </Anchor>
      .
    </Text>
  );
}
