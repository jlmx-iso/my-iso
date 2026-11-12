import { Button, Container, Group, Stack, Text, ThemeIcon, Title } from "@mantine/core";
import { IconCameraOff, type IconProps } from "@tabler/icons-react";
import { type ForwardRefExoticComponent, type RefAttributes } from "react";

import { NextLink } from "~/app/_components/NextLink";

type NotFoundStateProps = {
  title: string;
  description: string;
  /** Primary way out. */
  action: { href: string; label: string };
  secondaryAction?: { href: string; label: string };
  icon?: ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>;
};

/** Shared "this does not exist" screen for the root and per-segment not-found pages. */
export default function NotFoundState({
  title,
  description,
  action,
  secondaryAction,
  icon: Icon = IconCameraOff,
}: NotFoundStateProps) {
  return (
    <Container size="sm" py={80}>
      <Stack align="center" gap="lg">
        <ThemeIcon size={72} radius="xl" variant="light" color="orange">
          <Icon size={36} aria-hidden />
        </ThemeIcon>
        <Title order={1} size="h2" ta="center">
          {title}
        </Title>
        <Text c="dimmed" ta="center" maw={420} style={{ lineHeight: 1.6 }}>
          {description}
        </Text>
        <Group justify="center">
          <Button component={NextLink} href={action.href}>
            {action.label}
          </Button>
          {secondaryAction && (
            <Button component={NextLink} href={secondaryAction.href} variant="default">
              {secondaryAction.label}
            </Button>
          )}
        </Group>
      </Stack>
    </Container>
  );
}
