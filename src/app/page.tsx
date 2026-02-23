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
import { redirect } from "next/navigation";

import { auth } from "~/auth";
import {
  FadeInOnScroll,
  StaggerContainer,
  SmoothScroll,
} from "~/app/_components/animations";

function HeroSection() {
  return (
    <Box py={60}>
      <Stack align="center" gap="lg" maw={720} mx="auto">
        <FadeInOnScroll>
          <Badge size="lg" variant="light" radius="sm">
            The Photographer Network
          </Badge>
        </FadeInOnScroll>
        <FadeInOnScroll delay={0.1}>
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
              gradient={{ from: "orange.5", to: "orange.8", deg: 135 }}
            >
              again
            </Text>
          </Title>
        </FadeInOnScroll>
        <FadeInOnScroll delay={0.2}>
          <Text
            c="dimmed"
            size="lg"
            ta="center"
            maw={540}
            style={{ lineHeight: 1.6 }}
          >
            ISO connects photographers with skilled second shooters for weddings,
            events, and sessions. Build your team, grow your network, and deliver
            more for every client.
          </Text>
        </FadeInOnScroll>
        <FadeInOnScroll delay={0.3}>
          <Group mt="md">
            <Button component="a" href="/join" size="lg" rightSection={<IconArrowRight size={18} />}>
              Join the Founding Class
            </Button>
            <Button component="a" href="/login" size="lg" variant="default">
              Sign In
            </Button>
          </Group>
        </FadeInOnScroll>
      </Stack>
    </Box>
  );
}

const steps = [
  {
    icon: IconCameraPlus,
    title: "Create your profile",
    description:
      "Showcase your portfolio, set your rates, and list the services you offer. Let the right people find you.",
  },
  {
    icon: IconSearch,
    title: "Find your match",
    description:
      "Search by location, specialty, and availability. Browse portfolios and reviews to find your perfect fit.",
  },
  {
    icon: IconCalendarEvent,
    title: "Book & shoot",
    description:
      "Coordinate directly, confirm the details, and show up ready. ISO handles the connection so you can focus on the craft.",
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
      <StaggerContainer
        stagger={0.15}
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
          gap: "var(--mantine-spacing-xl)",
        }}
      >
        {steps.map((step, i) => (
          <Stack key={step.title} align="center" ta="center" gap="md">
            <Box pos="relative">
              <ThemeIcon size={56} radius="xl" variant="light">
                <step.icon size={28} />
              </ThemeIcon>
              <Text
                fw={700}
                size="xs"
                c="orange"
                pos="absolute"
                top={-6}
                right={-6}
                style={{
                  background: "var(--mantine-color-orange-0)",
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
            <Title order={4} fw={500}>
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
    title: "Client connections",
    description:
      "Get discovered by lead photographers and clients looking for your exact skill set and style.",
  },
  {
    icon: IconCalendarEvent,
    title: "Booking management",
    description:
      "Track your availability, manage requests, and keep your schedule organized in one place.",
  },
  {
    icon: IconMessageCircle,
    title: "Direct messaging",
    description:
      "Coordinate shoot details, share mood boards, and align on expectations before the big day.",
  },
  {
    icon: IconCamera,
    title: "Event discovery",
    description:
      "Browse open calls for second shooters near you. Filter by event type, date, and pay.",
  },
  {
    icon: IconStar,
    title: "Reviews & ratings",
    description:
      "Build your reputation with verified reviews. Stand out with a track record clients trust.",
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
              <feature.icon size={22} />
            </ThemeIcon>
            <Text fw={500} mb={4}>
              {feature.title}
            </Text>
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
            <Text fw={600} size="lg">
              Basic
            </Text>
            <Group align="baseline" gap={4} my="sm">
              <Text fw={700} style={{ fontSize: "2rem" }}>
                $0
              </Text>
              <Text c="dimmed" size="sm">
                / month
              </Text>
            </Group>
            <Stack gap="xs" mb="lg">
              {[
                "Create your profile",
                "Browse second shooter listings",
                "Direct messaging",
              ].map((item) => (
                <Group key={item} gap="xs" wrap="nowrap">
                  <IconCheck size={16} color="var(--mantine-color-teal-5)" />
                  <Text size="sm">{item}</Text>
                </Group>
              ))}
            </Stack>
            <Button component="a" href="/join" variant="default" fullWidth>
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
              borderColor: "var(--mantine-color-orange-3)",
              background: "var(--mantine-color-orange-0)",
              height: "100%",
            }}
          >
            <Group justify="space-between" align="center">
              <Text fw={600} size="lg">
                Pro
              </Text>
              <Badge size="sm" variant="light" color="orange">
                Founding Price
              </Badge>
            </Group>
            <Group align="baseline" gap={4} my="sm">
              <Text fw={700} style={{ fontSize: "2rem" }}>
                $10
              </Text>
              <Text c="dimmed" size="sm" td="line-through">
                $19
              </Text>
              <Text c="dimmed" size="sm">
                / month
              </Text>
            </Group>
            <Stack gap="xs" mb="lg">
              {[
                "Everything in Basic",
                "Priority in search results",
                "Advanced booking tools",
                "Analytics dashboard",
              ].map((item) => (
                <Group key={item} gap="xs" wrap="nowrap">
                  <IconCheck size={16} color="var(--mantine-color-teal-5)" />
                  <Text size="sm">{item}</Text>
                </Group>
              ))}
            </Stack>
            <Button component="a" href="/join" fullWidth>
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
            "linear-gradient(135deg, var(--mantine-color-orange-0) 0%, var(--mantine-color-orange-1) 100%)",
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
          <Button component="a" href="/join" size="lg" rightSection={<IconArrowRight size={18} />}>
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
      <SmoothScroll />
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
