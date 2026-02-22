import { Box, Container, Divider, Stack, Text, Title } from "@mantine/core";

export const metadata = {
  title: "Privacy Policy",
  description: "ISO Privacy Policy.",
  openGraph: {
    title: "Privacy Policy",
    description: "Read the ISO Privacy Policy.",
  },
  twitter: {
    title: "Privacy Policy",
    description: "Read the ISO Privacy Policy.",
  },
};

const sections = [
  {
    title: "1. Information We Collect",
    content:
      "We collect information you provide when creating an account (name, email, location), content you upload (portfolio images, profile details), and usage data (pages visited, features used). We also collect technical information such as browser type and IP address.",
  },
  {
    title: "2. How We Use Your Information",
    content:
      "We use your information to operate and improve ISO, connect you with other photographers, personalize your experience, send important updates about your account, and analyze usage patterns to make the platform better.",
  },
  {
    title: "3. Information Sharing",
    content:
      "Your public profile information (name, portfolio, location) is visible to other ISO users. We do not sell your personal information to third parties. We may share data with service providers who help us operate the platform (hosting, analytics, email), and we may disclose information if required by law.",
  },
  {
    title: "4. Data Security",
    content:
      "We use industry-standard security measures to protect your data, including encryption in transit and at rest. However, no method of transmission over the internet is 100% secure, and we cannot guarantee absolute security.",
  },
  {
    title: "5. Your Rights",
    content:
      "You can access, update, or delete your personal information through your account settings. You can request a copy of your data or ask us to delete your account by contacting us at support@myiso.app.",
  },
  {
    title: "6. Cookies & Analytics",
    content:
      "We use cookies and similar technologies to keep you logged in, remember your preferences, and understand how you use ISO. We use analytics tools to measure and improve our service.",
  },
  {
    title: "7. Changes to This Policy",
    content:
      "We may update this Privacy Policy from time to time. We will notify you of significant changes via email or an in-app notice. Your continued use of ISO after changes constitutes acceptance of the updated policy.",
  },
  {
    title: "8. Contact",
    content:
      "If you have questions about this Privacy Policy, please contact us at support@myiso.app.",
  },
];

export default function PrivacyPage() {
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
          <Title order={1}>Privacy Policy</Title>
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
