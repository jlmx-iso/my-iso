import { Anchor, Container, Stack, Text, Title } from "@mantine/core";

import { NextLink } from "~/app/_components/NextLink";

/**
 * What a member sees once their account is closed (/account-deleted).
 * Public, and nothing about them is in the URL or on the page.
 *
 * `pending`: the account is closed and the profile hidden, but a later step
 * (Stripe, image deletion, ...) failed and the finish-deletions job will
 * complete it, so nothing is claimed that has not happened yet.
 */
export default function AccountDeletedNotice({
  confirmationEmail,
  pending = false,
}: {
  confirmationEmail: boolean;
  pending?: boolean;
}) {
  return (
    <Container size="sm" py={60}>
      <Stack gap="md">
        <Title order={1}>{pending ? "We're deleting your account" : "Your account has been deleted"}</Title>
        {pending ? (
          <Text>
            We&apos;re finishing deleting your account. Your profile is already hidden; the rest
            completes within the hour.{" "}
            {confirmationEmail && "We'll email you when it is done. "}Thanks for being part of ISO.
          </Text>
        ) : (
          <Text>
            Your profile and photos are gone from ISO, your events are hidden, and any Pro
            subscription has been cancelled.{" "}
            {confirmationEmail && "We've sent a confirmation to your email. "}Thanks for being part of ISO.
          </Text>
        )}
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
