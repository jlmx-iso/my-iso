"use client";

import {
  Badge,
  Button,
  Collapse,
  Group,
  NumberInput,
  Stack,
  Switch,
  Text,
  UnstyledButton,
} from "@mantine/core";
import { IconAdjustments, IconCheck } from "@tabler/icons-react";
import { useEffect, useState } from "react";

import { api } from "~/trpc/react";

const PHOTOGRAPHY_TYPES = [
  "wedding",
  "portrait",
  "event",
  "commercial",
  "fashion",
  "landscape",
  "sports",
  "product",
];

export default function DiscoverPreferences() {
  const [opened, setOpened] = useState(false);
  const { data: prefs, refetch } = api.discover.getPreferences.useQuery();
  const updateMutation = api.discover.updatePreferences.useMutation({
    onSuccess: () => void refetch(),
  });

  const [isDiscoverable, setIsDiscoverable] = useState(false);
  const [seekingTypes, setSeekingTypes] = useState<string[]>([]);
  const [budgetMin, setBudgetMin] = useState<number | null>(null);
  const [budgetMax, setBudgetMax] = useState<number | null>(null);

  useEffect(() => {
    if (prefs) {
      setIsDiscoverable(prefs.isDiscoverable);
      setSeekingTypes(prefs.seekingTypes);
      setBudgetMin(prefs.budgetMin);
      setBudgetMax(prefs.budgetMax);
    }
  }, [prefs]);

  const toggleType = (type: string) => {
    setSeekingTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  const handleSave = () => {
    updateMutation.mutate({
      isDiscoverable,
      seekingTypes,
      budgetMin,
      budgetMax,
    });
  };

  const hasChanges =
    prefs &&
    (isDiscoverable !== prefs.isDiscoverable ||
      JSON.stringify(seekingTypes) !== JSON.stringify(prefs.seekingTypes) ||
      budgetMin !== prefs.budgetMin ||
      budgetMax !== prefs.budgetMax);

  return (
    <Stack gap="xs">
      <UnstyledButton onClick={() => setOpened((o) => !o)}>
        <Group gap="xs">
          <IconAdjustments size={18} color="var(--mantine-color-dimmed)" />
          <Text size="sm" c="dimmed" fw={500}>
            Preferences
          </Text>
        </Group>
      </UnstyledButton>

      <Collapse in={opened}>
        <Stack gap="md" p="md" style={{
          borderRadius: "var(--mantine-radius-md)",
          border: "1px solid var(--mantine-color-gray-2)",
        }}>
          <Switch
            label="Make me discoverable"
            description="Allow others to see your profile in discover"
            checked={isDiscoverable}
            onChange={(e) => setIsDiscoverable(e.currentTarget.checked)}
            color="orange"
          />

          <Stack gap="xs">
            <Text size="sm" fw={500}>Looking for</Text>
            <Group gap="xs">
              {PHOTOGRAPHY_TYPES.map((type) => (
                <Badge
                  key={type}
                  variant={seekingTypes.includes(type) ? "filled" : "outline"}
                  color="orange"
                  size="lg"
                  style={{ cursor: "pointer", textTransform: "capitalize" }}
                  onClick={() => toggleType(type)}
                >
                  {type}
                </Badge>
              ))}
            </Group>
          </Stack>

          <Group grow>
            <NumberInput
              label="Min budget"
              placeholder="$0"
              prefix="$"
              min={0}
              value={budgetMin ?? ""}
              onChange={(val) => setBudgetMin(typeof val === "number" ? val : null)}
            />
            <NumberInput
              label="Max budget"
              placeholder="No max"
              prefix="$"
              min={0}
              value={budgetMax ?? ""}
              onChange={(val) => setBudgetMax(typeof val === "number" ? val : null)}
            />
          </Group>

          {hasChanges && (
            <Button
              color="orange"
              leftSection={<IconCheck size={16} />}
              onClick={handleSave}
              loading={updateMutation.isPending}
            >
              Save Preferences
            </Button>
          )}
        </Stack>
      </Collapse>
    </Stack>
  );
}
