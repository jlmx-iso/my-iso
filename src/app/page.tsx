import {
  Badge,
  Box,
  Button,
  Container,
  Divider,
  Group,
  Paper,
  SimpleGrid,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCalendarEvent,
  IconCamera,
  IconCameraPlus,
  IconCheck,
  IconMessageCircle,
  IconPhoto,
  IconSearch,
  IconStar,
  IconUsers,
} from "@tabler/icons-react";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { FREE_PLAN, proPriceView } from "~/_utils/plans";
import {
  FadeInOnScroll,
  StaggerContainer,
} from "~/app/_components/animations";
import { NextLink } from "~/app/_components/NextLink";
import ProFeatures from "~/app/_components/plans/ProFeatures";
import { auth } from "~/auth";
import { getPricingForRole } from "~/server/_utils/pricing";
import { USER_ROLES } from "~/server/_utils/roles";

import { pageMetadata, SITE_DESCRIPTION } from "./_lib/siteMetadata";

export const metadata: Metadata = {
  ...pageMetadata({
    description: SITE_DESCRIPTION,
    path: "/",
    socialTitle: "ISO — The Photographer Network",
    title: "ISO — Find second shooters and photography gigs",
  }),
  // The root layout's template would append "| ISO" to a title that already
  // starts with the brand.
  title: { absolute: "ISO — Find second shooters and photography gigs" },
};

function HeroSection() {
  // Above the fold: rendered visible in the server HTML, never scroll-revealed.
  return (
    <Box py={60}>
      <Stack align="center" gap="lg" maw={720} mx="auto">
        <Badge size="lg" variant="light" radius="sm">
          The Photographer Network
        </Badge>
        <Title
          order={1}
          ta="center"
          style={{ fontSize: "clamp(2.25rem, 5vw, 3.5rem)", lineHeight: 1.15 }}
        >
          Never shoot alone{" "}
          <Text
            span
            inherit
            variant="gradient"
            // The original coral gradient: orange.5 to .8 on white, the salmon orange.3 to .2 on the dark page (both at least 3:1, large text).
            gradient={{ from: "var(--iso-hero-from)", to: "var(--iso-hero-to)", deg: 135 }}
          >
            again
          </Text>
        </Title>
        <Text
          c="dimmed"
          size="lg"
          ta="center"
          maw={540}
          style={{ lineHeight: 1.6 }}
        >
          ISO connects photographers with skilled second shooters for weddings,
          events, and sessions. Build your team and grow your network.
        </Text>
        <Group mt="md" justify="center">
          <Button component={NextLink} href="/join" size="lg" rightSection={<IconArrowRight size={18} />}>
            Join the Founding Class
          </Button>
          <Button component={NextLink} href="/login" size="lg" variant="default">
            Sign In
          </Button>
        </Group>
      </Stack>
    </Box>
  );
}

const steps = [
  {
    icon: IconCameraPlus,
    title: "Create your profile",
    description:
      "Show your portfolio, where you work and the kind of shoots you do, so the right photographers find you.",
  },
  {
    icon: IconSearch,
    title: "Find your match",
    description:
      "Search by name and city, or let Discover suggest photographers near you. Look at portfolios and reviews before you reach out.",
  },
  {
    icon: IconCalendarEvent,
    title: "Book & shoot",
    description:
      "Agree on the details in messages, accept the booking, and show up ready.",
  },
];

function HowItWorksSection() {
  return (
    <Box py={60}>
      <FadeInOnScroll>
        <Stack align="center" gap={8} mb={40}>
          <Text size="sm" fw={600} c="orange" tt="uppercase" style={{ letterSpacing: 1 }}>
            How it works
          </Text>
          <Title order={2} ta="center">
            Three steps to your next shoot
          </Title>
        </Stack>
      </FadeInOnScroll>
      <StaggerContainer stagger={0.15} className="grid-three-up">
        {steps.map((step, i) => (
          <Stack key={step.title} align="center" ta="center" gap="md">
            <Box pos="relative">
              <ThemeIcon size={56} radius="xl" variant="light">
                <step.icon size={28} aria-hidden />
              </ThemeIcon>
              <Text
                fw={700}
                size="xs"
                c="var(--iso-accent-text)"
                pos="absolute"
                top={-6}
                right={-6}
                style={{
                  background: "var(--iso-accent-surface-strong)",
                  borderRadius: "50%",
                  width: 22,
                  height: 22,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {i + 1}
              </Text>
            </Box>
            <Title order={3} size="h4">
              {step.title}
            </Title>
            <Text c="dimmed" size="sm" maw={280}>
              {step.description}
            </Text>
          </Stack>
        ))}
      </StaggerContainer>
    </Box>
  );
}

const features = [
  {
    icon: IconPhoto,
    title: "Portfolio showcase",
    description:
      "Display your best work with a clean, professional gallery. Let your images do the talking.",
  },
  {
    icon: IconUsers,
    title: "Get discovered",
    description:
      "Lead photographers find you in Discover and search, by name and city, and can see your work before they write.",
  },
  {
    icon: IconCalendarEvent,
    title: "Booking management",
    description:
      "Apply to events, accept or decline applications, and see where every booking stands in one place.",
  },
  {
    icon: IconMessageCircle,
    title: "Direct messaging",
    description:
      "Agree on the schedule, the gear and the rate before the big day, in one conversation.",
  },
  {
    icon: IconCamera,
    title: "Event discovery",
    description:
      "Browse open second-shooter calls near you, by date and location.",
  },
  {
    icon: IconStar,
    title: "Reviews & ratings",
    description:
      "Reviews come only from photographers you have completed a booking with: a track record other photographers trust.",
  },
];

function FeaturesSection() {
  return (
    <Box id="features" py={60}>
      <FadeInOnScroll>
        <Stack align="center" gap={8} mb={40}>
          <Text size="sm" fw={600} c="orange" tt="uppercase" style={{ letterSpacing: 1 }}>
            Features
          </Text>
          <Title order={2} ta="center">
            Everything you need to grow
          </Title>
          <Text c="dimmed" ta="center" maw={480}>
            ISO gives photographers the tools to find work, build teams, and
            deliver exceptional results.
          </Text>
        </Stack>
      </FadeInOnScroll>
      <StaggerContainer
        stagger={0.1}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
          gap: "var(--mantine-spacing-xl)",
        }}
      >
        {features.map((feature) => (
          <Paper key={feature.title} p="lg" radius="md" withBorder>
            <ThemeIcon size={40} radius="md" variant="light" mb="sm">
              <feature.icon size={22} aria-hidden />
            </ThemeIcon>
            <Title order={3} size="h5" mb={4}>
              {feature.title}
            </Title>
            <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
              {feature.description}
            </Text>
          </Paper>
        ))}
      </StaggerContainer>
    </Box>
  );
}

function PricingPreviewSection() {
  // The same plan descriptions and prices as onboarding and Settings.
  const foundingPrice = proPriceView(getPricingForRole(USER_ROLES.FOUNDING_MEMBER), "monthly");
  return (
    <Box id="pricing" py={60}>
      <FadeInOnScroll>
        <Stack align="center" gap={8} mb={40}>
          <Text size="sm" fw={600} c="orange" tt="uppercase" style={{ letterSpacing: 1 }}>
            Pricing
          </Text>
          <Title order={2} ta="center">
            Start free, upgrade when you&apos;re ready
          </Title>
        </Stack>
      </FadeInOnScroll>
      <SimpleGrid cols={{ base: 1, sm: 2 }} spacing="xl" maw={640} mx="auto">
        <FadeInOnScroll direction="left" delay={0.1}>
          <Paper p="xl" radius="md" withBorder style={{ height: "100%" }}>
            <Title order={3} size="h4">
              {FREE_PLAN.name}
            </Title>
            <Group align="baseline" gap={4} my="sm">
              <Text fw={700} style={{ fontSize: "2rem" }}>
                $0
              </Text>
              <Text c="dimmed" size="sm">
                / month
              </Text>
            </Group>
            <Stack gap="xs" mb="lg">
              {FREE_PLAN.features.map((item) => (
                <Group key={item} gap="xs" wrap="nowrap">
                  <IconCheck size={16} color="var(--iso-success-icon)" aria-hidden />
                  <Text size="sm">{item}</Text>
                </Group>
              ))}
            </Stack>
            <Button component={NextLink} href="/join" variant="default" fullWidth>
              Get started
            </Button>
          </Paper>
        </FadeInOnScroll>
        <FadeInOnScroll direction="right" delay={0.2}>
          <Paper
            p="xl"
            radius="md"
            withBorder
            style={{
              borderColor: "var(--iso-accent-border)",
              background: "var(--iso-accent-surface)",
              height: "100%",
            }}
          >
            <Group justify="space-between" align="center">
              <Title order={3} size="h4">
                Pro
              </Title>
              <Badge size="sm" variant="light" color="tan">
                Founding Price
              </Badge>
            </Group>
            <Group align="baseline" gap={4} my="sm">
              <Text fw={700} style={{ fontSize: "2rem" }}>
                {foundingPrice.perMonth}
              </Text>
              {foundingPrice.regularPerMonth && (
                <Text c="dimmed" size="sm" td="line-through">
                  <span className="sr-only">Regular price </span>{foundingPrice.regularPerMonth}
                </Text>
              )}
              <Text c="dimmed" size="sm">
                / month
              </Text>
            </Group>
            <Box mb="lg">
              <ProFeatures pricing={{ isFoundingPrice: true }} />
            </Box>
            <Button component={NextLink} href="/join" fullWidth>
              Get started
            </Button>
          </Paper>
        </FadeInOnScroll>
      </SimpleGrid>
    </Box>
  );
}

function CtaSection() {
  return (
    <FadeInOnScroll>
      <Paper
        py={60}
        px="xl"
        radius="md"
        style={{
          background:
            "linear-gradient(135deg, var(--iso-accent-surface) 0%, var(--iso-accent-surface-strong) 100%)",
        }}
      >
        <Stack align="center" gap="lg" maw={540} mx="auto">
          <Title order={2} ta="center">
            Ready to find your next second shooter?
          </Title>
          <Text c="dimmed" ta="center">
            Join the founding class of photographers building their teams
            and booking more work on ISO.
          </Text>
          <Button component={NextLink} href="/join" size="lg" rightSection={<IconArrowRight size={18} />}>
            Join the founding class
          </Button>
        </Stack>
      </Paper>
    </FadeInOnScroll>
  );
}

export default async function Home() {
  const session = await auth();
  if (session?.user) {
    redirect("/app/events");
  }

  return (
    <Container size="lg" w="100%">
      <Stack gap={0}>
        <HeroSection />
        <Divider />
        <HowItWorksSection />
        <Divider />
        <FeaturesSection />
        <Divider />
        <PricingPreviewSection />
        <Divider />
        <CtaSection />
      </Stack>
    </Container>
  );
}
