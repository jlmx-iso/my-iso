import {
  Box,
  Button,
  Container,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  TextInput,
  Textarea,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconClock, IconMail } from "@tabler/icons-react";

export const metadata = {
  title: "Contact",
  description: "Get in touch with the ISO team.",
  openGraph: {
    title: "Contact ISO",
    description:
      "Have a question or suggestion? Get in touch with the ISO team.",
  },
  twitter: {
    title: "Contact ISO",
    description:
      "Have a question or suggestion? Get in touch with the ISO team.",
  },
};

export default function ContactPage() {
  return (
    <Container size="lg" w="100%">
      <Box py={60}>
        <Stack align="center" gap="lg" maw={640} mx="auto" mb={40}>
          <Text
            size="sm"
            fw={600}
            c="orange"
            tt="uppercase"
            style={{ letterSpacing: 1 }}
          >
            Contact
          </Text>
          <Title order={1} ta="center">
            Get in touch
          </Title>
          <Text c="dimmed" size="lg" ta="center" style={{ lineHeight: 1.6 }}>
            Have a question, suggestion, or just want to say hello? We&apos;d
            love to hear from you.
          </Text>
        </Stack>

        <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl" maw={800} mx="auto">
          {/* Contact info */}
          <Stack gap="xl">
            <Paper p="lg" radius="md" withBorder>
              <Group gap="md" wrap="nowrap">
                <ThemeIcon size={40} radius="md" variant="light">
                  <IconMail size={22} />
                </ThemeIcon>
                <div>
                  <Text fw={500} mb={2}>
                    Email us
                  </Text>
                  <Text size="sm" c="dimmed">
                    support@myiso.app
                  </Text>
                </div>
              </Group>
            </Paper>
            <Paper p="lg" radius="md" withBorder>
              <Group gap="md" wrap="nowrap">
                <ThemeIcon size={40} radius="md" variant="light">
                  <IconClock size={22} />
                </ThemeIcon>
                <div>
                  <Text fw={500} mb={2}>
                    Response time
                  </Text>
                  <Text size="sm" c="dimmed">
                    We typically respond within 24 hours
                  </Text>
                </div>
              </Group>
            </Paper>
          </Stack>

          {/* Contact form (display only) */}
          <Paper p="lg" radius="md" withBorder>
            <form>
              <Stack gap="md">
                <TextInput label="Name" placeholder="Your name" />
                <TextInput
                  label="Email"
                  placeholder="you@example.com"
                  type="email"
                />
                <Textarea
                  label="Message"
                  placeholder="How can we help?"
                  minRows={4}
                />
                <Button type="button" fullWidth>
                  Send message
                </Button>
                <Text size="xs" c="dimmed" ta="center">
                  We&apos;ll get back to you within 24 hours.
                </Text>
              </Stack>
            </form>
          </Paper>
        </SimpleGrid>
      </Box>
    </Container>
  );
}
