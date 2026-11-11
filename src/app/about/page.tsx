import {
  Avatar,
  Box,
  Button,
  Container,
  Divider,
  Paper,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import {
  IconArrowRight,
  IconCamera,
  IconHeart,
  IconUsers,
} from "@tabler/icons-react";

import {
  CountUp,
  FadeInOnScroll,
  StaggerContainer,
} from "~/app/_components/animations";

export const metadata = {
  title: "About",
  description: "Learn about ISO — the photographer second shooter network.",
  openGraph: {
    title: "About ISO",
    description:
      "Learn about ISO — the photographer second shooter network built by photographers, for photographers.",
  },
  twitter: {
    title: "About ISO",
    description:
      "Learn about ISO — the photographer second shooter network built by photographers, for photographers.",
  },
};

const values = [
  {
    icon: IconCamera,
    title: "Built by photographers",
    description:
      "We understand the hustle because we've lived it. ISO is designed around the workflows and challenges real photographers face every day.",
  },
  {
    icon: IconUsers,
    title: "Community-driven",
    description:
      "ISO isn't a faceless marketplace. It's a network where photographers support each other, share knowledge, and grow together.",
  },
  {
    icon: IconHeart,
    title: "Quality over quantity",
    description:
      "We focus on meaningful connections between photographers who share standards and professionalism, not just filling slots.",
  },
];

const stats = [
  { value: 500, suffix: "+", label: "Photographers" },
  { value: 1200, suffix: "+", label: "Events booked" },
  { value: 50, suffix: "+", label: "Cities" },
];

const team = [
  {
    name: "Penny Lamoreaux",
    role: "Founder & CEO",
    bio: "Wedding photographer turned product builder. Started ISO after one too many last-minute second shooter searches.",
    initials: "PL",
  },
  {
    name: "Jordan Lamoreaux",
    role: "Lead Engineer",
    bio: "Full-stack developer and photographer. Believes great software should feel invisible.",
    initials: "JL",
  },
];

export default function AboutPage() {
  return (
    <Container size="lg" w="100%">
      <Stack gap={0}>
        {/* Mission */}
        <Box py={60}>
          <Stack align="center" gap="lg" maw={640} mx="auto">
            <FadeInOnScroll>
              <Text
                size="sm"
                fw={600}
                c="orange"
                tt="uppercase"
                ta="center"
                style={{ letterSpacing: 1 }}
              >
                About ISO
              </Text>
            </FadeInOnScroll>
            <FadeInOnScroll delay={0.1}>
              <Title order={1} ta="center">
                Connecting photographers, one shoot at a time
              </Title>
            </FadeInOnScroll>
            <FadeInOnScroll delay={0.2}>
              <Text c="dimmed" size="lg" ta="center" style={{ lineHeight: 1.6 }}>
                ISO is the second shooter network built for photographers who want
                to do their best work. Whether you&apos;re a lead photographer
                looking for reliable backup or a second shooter ready to book more
                gigs, ISO makes the connection simple.
              </Text>
            </FadeInOnScroll>
            <FadeInOnScroll delay={0.3}>
              <Text c="dimmed" ta="center" style={{ lineHeight: 1.6 }}>
                We started ISO because finding a great second shooter shouldn&apos;t
                mean scrolling through Facebook groups or cold-DMing strangers on
                Instagram. Photographers deserve a dedicated space to find, vet,
                and book the right people for every shoot.
              </Text>
            </FadeInOnScroll>
          </Stack>
        </Box>

        {/* Values */}
        <Box py={60}>
          <FadeInOnScroll>
            <Stack align="center" gap={8} mb={40}>
              <Text
                size="sm"
                fw={600}
                c="orange"
                tt="uppercase"
                style={{ letterSpacing: 1 }}
              >
                What makes us different
              </Text>
              <Title order={2} ta="center">
                A network that gets it
              </Title>
            </Stack>
          </FadeInOnScroll>
          <StaggerContainer
            stagger={0.12}
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 260px), 1fr))",
              gap: "var(--mantine-spacing-xl)",
            }}
          >
            {values.map((value) => (
              <Paper key={value.title} p="lg" radius="md" withBorder>
                <ThemeIcon size={40} radius="md" variant="light" mb="sm">
                  <value.icon size={22} />
                </ThemeIcon>
                <Text fw={500} mb={4}>
                  {value.title}
                </Text>
                <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                  {value.description}
                </Text>
              </Paper>
            ))}
          </StaggerContainer>
        </Box>

        {/* Our Story */}
        <Box py={60}>
          <FadeInOnScroll>
            <Stack align="center" gap={8} mb={40}>
              <Text
                size="sm"
                fw={600}
                c="orange"
                tt="uppercase"
                style={{ letterSpacing: 1 }}
              >
                Our story
              </Text>
              <Title order={2} ta="center">
                From frustration to a platform
              </Title>
            </Stack>
          </FadeInOnScroll>
          <Stack gap="md" maw={640} mx="auto">
            <FadeInOnScroll>
              <Text c="dimmed" style={{ lineHeight: 1.7 }}>
                ISO started in 2024 when our founder, Jordan, spent an entire
                weekend scrambling to find a second shooter for a wedding three
                days out. The lead had bailed, Facebook groups were a dead end, and
                the clock was ticking. The shoot went fine — but the process was
                broken.
              </Text>
            </FadeInOnScroll>
            <FadeInOnScroll delay={0.1}>
              <Text c="dimmed" style={{ lineHeight: 1.7 }}>
                That experience sparked a question: why isn&apos;t there a
                dedicated place for photographers to find and book each other? Not
                a generic freelancer marketplace. Not a social media group. A
                purpose-built network where photographers can search by location,
                specialty, and availability — and actually trust who they&apos;re
                booking.
              </Text>
            </FadeInOnScroll>
            <FadeInOnScroll delay={0.2}>
              <Text c="dimmed" style={{ lineHeight: 1.7 }}>
                Today, ISO is that network. We&apos;re still small, still
                scrappy, and still building — but every feature we ship is shaped
                by photographers who use the platform every day.
              </Text>
            </FadeInOnScroll>
          </Stack>
        </Box>

        <Divider />

        {/* Stats */}
        <Box py={60}>
          <StaggerContainer
            stagger={0.15}
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 160px), 1fr))",
              gap: "var(--mantine-spacing-xl)",
            }}
          >
            {stats.map((stat) => (
              <Stack key={stat.label} align="center" gap={4}>
                <Text
                  fw={700}
                  style={{ fontSize: "2.5rem" }}
                  variant="gradient"
                  gradient={{ from: "orange.5", to: "orange.8", deg: 135 }}
                >
                  <CountUp
                    target={stat.value}
                    suffix={stat.suffix}
                    formatted={stat.value >= 1000}
                  />
                </Text>
                <Text c="dimmed" size="sm">
                  {stat.label}
                </Text>
              </Stack>
            ))}
          </StaggerContainer>
        </Box>

        <Divider />

        {/* Team */}
        <Box py={60}>
          <FadeInOnScroll>
            <Stack align="center" gap={8} mb={40}>
              <Text
                size="sm"
                fw={600}
                c="orange"
                tt="uppercase"
                style={{ letterSpacing: 1 }}
              >
                The team
              </Text>
              <Title order={2} ta="center">
                People behind the lens
              </Title>
            </Stack>
          </FadeInOnScroll>
          <StaggerContainer
            stagger={0.15}
            style={{
              display: "grid",
              gridTemplateColumns:
                "repeat(auto-fit, minmax(min(100%, 280px), 1fr))",
              gap: "var(--mantine-spacing-xl)",
              maxWidth: 640,
              marginInline: "auto",
            }}
          >
            {team.map((member) => (
              <Paper key={member.name} p="lg" radius="md" withBorder ta="center">
                <Stack align="center" gap="sm">
                  <Avatar size={64} radius="xl" color="orange">
                    {member.initials}
                  </Avatar>
                  <div>
                    <Text fw={500}>{member.name}</Text>
                    <Text size="sm" c="orange">
                      {member.role}
                    </Text>
                  </div>
                  <Text size="sm" c="dimmed" style={{ lineHeight: 1.6 }}>
                    {member.bio}
                  </Text>
                </Stack>
              </Paper>
            ))}
          </StaggerContainer>
        </Box>

        <Divider />

        {/* CTA */}
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
                Ready to join the network?
              </Title>
              <Text c="dimmed" ta="center">
                Create your free account and start connecting with photographers
                in your area.
              </Text>
              <Button
                component="a"
                href="/join"
                size="lg"
                rightSection={<IconArrowRight size={18} />}
              >
                Get Started
              </Button>
            </Stack>
          </Paper>
        </FadeInOnScroll>
      </Stack>
    </Container>
  );
}
