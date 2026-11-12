import {
  Anchor,
  Box,
  Button,
  Container,
  Divider,
  List,
  ListItem,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconMail } from "@tabler/icons-react";

import { SUPPORT_EMAIL } from "~/_lib/site";
import { NextLink } from "~/app/_components/NextLink";
import { pageMetadata } from "~/app/_lib/siteMetadata";

export const metadata = pageMetadata({
  description:
    "Questions about ISO, your account or an invite? Email the team.",
  path: "/contact",
  socialTitle: "Contact ISO",
  title: "Contact",
});

const MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent("ISO support")}`;

/**
 * How to reach us. There is deliberately no form here: email is the one
 * channel that is read, so the page says so and makes writing a useful
 * message easy.
 */
export default function ContactPage() {
  return (
    <Container size="sm" w="100%">
      <Box py={60}>
        <Stack align="center" gap="lg" mb={40}>
          <Text size="sm" fw={600} c="var(--iso-accent-text)" tt="uppercase" style={{ letterSpacing: 1 }}>
            Contact
          </Text>
          <Title order={1} ta="center">
            Get in touch
          </Title>
          <Text c="dimmed" size="lg" ta="center" maw={520} style={{ lineHeight: 1.6 }}>
            Questions about your account, a booking, billing or an invite?
            Email us and a person on the team will read it.
          </Text>
        </Stack>

        <Paper p={{ base: "lg", sm: "xl" }} radius="md" withBorder data-testid="contact-card">
          <Stack gap="lg">
            <Stack gap="sm" align="flex-start">
              <ThemeIcon size={44} radius="md" variant="light">
                <IconMail size={24} aria-hidden />
              </ThemeIcon>
              <Title order={2} size="h4">
                Email us
              </Title>
              <Anchor
                href={MAILTO}
                fw={600}
                size="lg"
                underline="always"
                style={{ overflowWrap: "anywhere" }}
                data-testid="support-email"
              >
                {SUPPORT_EMAIL}
              </Anchor>
              <Button component="a" href={MAILTO} leftSection={<IconMail size={18} aria-hidden />} w={{ base: "100%", xs: "auto" }}>
                Write an email
              </Button>
            </Stack>

            <Divider />

            <Stack gap="xs">
              <Title order={2} size="h5">
                What to include
              </Title>
              <Text size="sm" c="dimmed">
                The more of this we have, the sooner we can help:
              </Text>
              <List size="sm" spacing={6}>
                <ListItem>The email address you use to sign in to ISO.</ListItem>
                <ListItem>What you were trying to do, and what happened instead.</ListItem>
                <ListItem>The page you were on, and a screenshot if you can.</ListItem>
                <ListItem>The reference code, if an error screen showed one.</ListItem>
              </List>
              <Text size="sm" c="dimmed">
                Please don&apos;t send sign-in codes or card details: we will never ask for them.
              </Text>
            </Stack>

            <Divider />

            <Text size="sm">
              Not a member yet?{" "}
              <Anchor component={NextLink} href="/waitlist" fw={600} underline="always">
                Request an invite
              </Anchor>
              . Managing a subscription? Use{" "}
              <Anchor component={NextLink} href="/app/settings" fw={600} underline="always">
                Settings
              </Anchor>
              .
            </Text>
          </Stack>
        </Paper>
      </Box>
    </Container>
  );
}
