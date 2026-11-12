import { Anchor, Container, Stack, Text, Title } from "@mantine/core";

import { NextLink } from "~/app/_components/NextLink";

/**
 * What a member sees once their account is gone (/account-deleted). Public,
 * and nothing about them is in the URL or on the page.
 */
export default function AccountDeletedNotice({ confirmationEmail }: { confirmationEmail: boolean }) {
  return (
    <Container size="sm" py={60}>
      <Stack gap="md">
        <Title order={1}>Your account has been deleted</Title>
        <Text>
          Your profile and photos are gone from ISO, your events are hidden, and any Pro
          subscription has been cancelled.{" "}
          {confirmationEmail && "We've sent a confirmation to your email. "}Thanks for being part of ISO.
        </Text>
        <Text size="sm" c="dimmed">
          What is kept, and why, is in the{" "}
          <Anchor component={NextLink} href="/privacy" size="sm">
            privacy policy
          </Anchor>
          .
        </Text>
      </Stack>
    </Container>
  );
}
