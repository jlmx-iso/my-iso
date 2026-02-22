import { Box, Container, Divider, Stack, Text, Title } from "@mantine/core";

export const metadata = {
  title: "Terms of Service",
  description: "ISO Terms of Service.",
  openGraph: {
    title: "Terms of Service",
    description: "Read the ISO Terms of Service.",
  },
  twitter: {
    title: "Terms of Service",
    description: "Read the ISO Terms of Service.",
  },
};

const sections = [
  {
    title: "1. Acceptance of Terms",
    content:
      "By accessing or using ISO, you agree to be bound by these Terms of Service. If you do not agree to these terms, please do not use our platform.",
  },
  {
    title: "2. Account Registration",
    content:
      "You must provide accurate and complete information when creating an account. You are responsible for maintaining the security of your account credentials and for all activity that occurs under your account.",
  },
  {
    title: "3. User Content",
    content:
      "You retain ownership of content you upload to ISO, including photos and portfolio materials. By posting content, you grant ISO a non-exclusive license to display and distribute that content within the platform. You are solely responsible for ensuring you have the right to share any content you upload.",
  },
  {
    title: "4. Acceptable Use",
    content:
      "You agree to use ISO only for its intended purpose of connecting photographers. You may not use the platform for spam, harassment, fraud, or any illegal activity. ISO reserves the right to suspend or terminate accounts that violate these guidelines.",
  },
  {
    title: "5. Bookings & Payments",
    content:
      "ISO facilitates connections between photographers. Any agreements, bookings, or payments between users are the responsibility of those users. ISO is not a party to contracts formed between photographers on the platform.",
  },
  {
    title: "6. Termination",
    content:
      "You may close your account at any time. ISO may suspend or terminate your access to the platform at our discretion, including for violation of these terms. Upon termination, your right to use the platform ceases immediately.",
  },
  {
    title: "7. Limitation of Liability",
    content:
      "ISO is provided \"as is\" without warranties of any kind. To the fullest extent permitted by law, ISO shall not be liable for any indirect, incidental, or consequential damages arising from your use of the platform.",
  },
  {
    title: "8. Changes to Terms",
    content:
      "We may update these terms from time to time. We will notify users of significant changes via email or an in-app notice. Continued use of ISO after changes constitutes acceptance of the updated terms.",
  },
  {
    title: "9. Contact",
    content:
      "If you have questions about these Terms of Service, please contact us at support@myiso.app.",
  },
];

export default function TermsPage() {
  return (
    <Container size="md" w="100%">
      <Box py={60}>
        <Stack gap="lg" mb={40}>
          <Text
            size="sm"
            fw={600}
            c="orange"
            tt="uppercase"
            style={{ letterSpacing: 1 }}
          >
            Legal
          </Text>
          <Title order={1}>Terms of Service</Title>
          <Text c="dimmed" size="sm">
            Last updated: February 2026. This is placeholder content and should
            be reviewed by legal counsel before launch.
          </Text>
        </Stack>

        <Divider mb="xl" />

        <Stack gap="xl">
          {sections.map((section) => (
            <div key={section.title}>
              <Title order={3} mb="xs">
                {section.title}
              </Title>
              <Text c="dimmed" style={{ lineHeight: 1.7 }}>
                {section.content}
              </Text>
            </div>
          ))}
        </Stack>
      </Box>
    </Container>
  );
}
