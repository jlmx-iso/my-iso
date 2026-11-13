import { Paper, Stack, Text, Title } from "@mantine/core";

import { ColorSchemeControl } from "~/app/_components/theme/ColorSchemeControl";

/** Settings, "Appearance": light, dark, or whatever the device uses. */
export default function AppearanceSettings() {
  return (
    <Stack gap="md">
      <Title order={2} size="h4">
        Appearance
      </Title>
      <Paper withBorder p="lg" radius="md">
        <Stack gap="sm" align="flex-start">
          <Text size="sm" c="dimmed">
            Choose light or dark, or follow your device&apos;s setting. Saved in this browser.
          </Text>
          <ColorSchemeControl />
        </Stack>
      </Paper>
    </Stack>
  );
}
