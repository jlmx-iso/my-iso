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

import PrivacyChoicesLink from "~/app/_components/consent/PrivacyChoicesLink";
import { NextLink } from "~/app/_components/NextLink";

import logo from "../../../public/img/logo.webp";

const companyLinks = [
  { href: "/about", label: "About" },
  { href: "/contact", label: "Contact" },
  { href: "/#pricing", label: "Pricing" },
];

const legalLinks = [
  { href: "/terms", label: "Terms of Service" },
  { href: "/privacy", label: "Privacy Policy" },
  { href: "/subprocessors", label: "Service providers" },
];

function FooterLinks({
  children,
  links,
  title,
}: {
  children?: React.ReactNode;
  links: typeof companyLinks;
  title: string;
}) {
  return (
    <Stack component="nav" aria-label={title} gap="xs">
      <Text size="sm" fw={600} tt="uppercase" c="dimmed">
        {title}
      </Text>
      {links.map((link) => (
        <Anchor
          key={link.href}
          component={NextLink}
          href={link.href}
          size="sm"
          c="dimmed"
          underline="hover"
          w="fit-content"
        >
          {link.label}
        </Anchor>
      ))}
      {children}
    </Stack>
  );
}

/** Footer of the public marketing pages. */
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
          <Stack gap="xs">
            <Image
              src={logo}
              alt="ISO"
              style={{ height: "2rem", width: "auto", objectFit: "contain", alignSelf: "flex-start" }}
              width={100}
              height={36}
            />
            <Text size="sm" c="dimmed">
              The photographer second shooter network.
            </Text>
          </Stack>
          <FooterLinks title="Company" links={companyLinks} />
          <FooterLinks title="Legal" links={legalLinks}>
            <PrivacyChoicesLink />
          </FooterLinks>
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

/**
 * Footer of the signed-in app: one quiet legal line on desktop. Phones have
 * the tab bar at the bottom of the screen instead.
 */
export function AppFooter() {
  return (
    <Box component="footer" visibleFrom="sm" h="var(--app-footer-height)">
      <Group justify="center" align="flex-end" gap="md" h="100%">
        <Text size="xs" c="dimmed">
          &copy; {new Date().getFullYear()} ISO
        </Text>
        {[...legalLinks, { href: "/contact", label: "Contact" }].map((link) => (
          <Anchor key={link.href} component={NextLink} href={link.href} size="xs" c="dimmed" underline="hover">
            {link.label}
          </Anchor>
        ))}
        <PrivacyChoicesLink size="xs" />
      </Group>
    </Box>
  );
}
