import {
  Anchor,
  Box,
  Container,
  Divider,
  Group,
  SimpleGrid,
  Stack,
  Text,
} from "@mantine/core";
import Image from "next/image";

import logo from "../../../public/img/logo.webp";

const companyLinks = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/#pricing", label: "Pricing" },
];

const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
];

export function Footer() {
  return (
    <Box
      component="footer"
      mt={60}
      py="xl"
      style={{
        borderTop: "1px solid var(--mantine-color-default-border)",
      }}
    >
      <Container size="lg">
        <SimpleGrid cols={{ base: 1, sm: 3 }} spacing="xl" mb="xl">
          {/* Logo + tagline */}
          <Stack gap="xs">
            <Image
              src={logo}
              alt="ISO logo"
              style={{ height: "2rem", width: "auto", objectFit: "contain" }}
              width={100}
              height={36}
            />
            <Text size="sm" c="dimmed">
              The photographer second shooter network.
            </Text>
          </Stack>

          {/* Company links */}
          <Stack gap="xs">
            <Text size="sm" fw={600} tt="uppercase" c="dimmed">
              Company
            </Text>
            {companyLinks.map((link) => (
              <Anchor
                key={link.href}
                href={link.href}
                component="a"
                size="sm"
                c="dimmed"
                underline="hover"
              >
                {link.label}
              </Anchor>
            ))}
          </Stack>

          {/* Legal links */}
          <Stack gap="xs">
            <Text size="sm" fw={600} tt="uppercase" c="dimmed">
              Legal
            </Text>
            {legalLinks.map((link) => (
              <Anchor
                key={link.href}
                href={link.href}
                component="a"
                size="sm"
                c="dimmed"
                underline="hover"
              >
                {link.label}
              </Anchor>
            ))}
          </Stack>
        </SimpleGrid>

        <Divider mb="md" />

        <Group justify="center">
          <Text size="xs" c="dimmed">
            &copy; {new Date().getFullYear()} ISO. All rights reserved.
          </Text>
        </Group>
      </Container>
    </Box>
  );
}
