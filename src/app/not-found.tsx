import {
  Button,
  Container,
  Stack,
  Text,
  ThemeIcon,
  Title,
} from "@mantine/core";
import { IconCameraOff } from "@tabler/icons-react";

export default function NotFound() {
  return (
    <Container size="sm" py={80}>
      <Stack align="center" gap="lg">
        <ThemeIcon size={72} radius="xl" variant="light" color="orange">
          <IconCameraOff size={36} />
        </ThemeIcon>
        <Title order={1} ta="center">
          404 — Page not found
        </Title>
        <Text c="dimmed" ta="center" size="lg" maw={420} style={{ lineHeight: 1.6 }}>
          Looks like this page went out of focus.
        </Text>
        <Text c="dimmed" ta="center" size="sm" maw={420}>
          The page you are looking for does not exist or may have been moved.
        </Text>
        <Button component="a" href="/" size="lg" variant="filled">
          Back to home
        </Button>
      </Stack>
    </Container>
  );
}
