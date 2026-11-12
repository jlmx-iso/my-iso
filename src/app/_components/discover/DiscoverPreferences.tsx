"use client";

import {
  Alert,
  Button,
  Chip,
  Collapse,
  Group,
  NumberInput,
  Paper,
  Stack,
  Switch,
  Text,
} from "@mantine/core";
import { useId } from "@mantine/hooks";
import { IconAdjustments, IconCheck, IconEyeOff } from "@tabler/icons-react";
import { useState } from "react";

import { userFacingError } from "~/_utils/userError";
import { notify } from "~/app/_lib/notify";
import { type RouterOutputs, api } from "~/trpc/react";

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

type Preferences = RouterOutputs["discover"]["getPreferences"];

/** "Show me in Discover": saved the moment it is toggled. */
function VisibilitySwitch({ preferences }: { preferences: Preferences }) {
  const utils = api.useUtils();
  const update = api.discover.updatePreferences.useMutation({
    onError: (error) =>
      notify.error({
        message: userFacingError(error, "Your visibility wasn't changed. Please try again."),
        title: "Couldn't update visibility",
      }),
    onSuccess: (_data, variables) => {
      // Update the cached value at once, so the switch does not flick back to
      // its old position while the refetch is in flight.
      utils.discover.getPreferences.setData(undefined, (current) =>
        current ? { ...current, isDiscoverable: !!variables.isDiscoverable } : current,
      );
      void utils.discover.getPreferences.invalidate();
      notify.success({
        message: variables.isDiscoverable
          ? "Other photographers can now find and match with you."
          : "You're hidden. You can still browse, but nobody can match with you.",
        title: variables.isDiscoverable ? "You're visible in Discover" : "You're hidden from Discover",
      });
    },
  });
  // Show the requested state while the save is in flight.
  const checked = update.isPending ? !!update.variables?.isDiscoverable : preferences.isDiscoverable;

  return (
    <Stack gap="xs">
      <Switch
        label="Show me in Discover"
        description="Let other photographers see your profile here and match with you"
        checked={checked}
        disabled={update.isPending}
        onChange={(event) => update.mutate({ isDiscoverable: event.currentTarget.checked })}
        data-testid="discoverable-switch"
      />
      {!checked && (
        <Alert color="tan" icon={<IconEyeOff size={16} />} py="xs">
          You&apos;re hidden: nobody can find or match with you until you turn this on.
        </Alert>
      )}
    </Stack>
  );
}

function PreferencesForm({ preferences }: { preferences: Preferences }) {
  const utils = api.useUtils();
  const [seekingTypes, setSeekingTypes] = useState<string[]>(preferences.seekingTypes);
  const [budgetMin, setBudgetMin] = useState<number | null>(preferences.budgetMin);
  const [budgetMax, setBudgetMax] = useState<number | null>(preferences.budgetMax);

  const update = api.discover.updatePreferences.useMutation({
    onError: (error) =>
      notify.error({
        message: userFacingError(error, "Your preferences weren't saved. Please try again."),
        title: "Couldn't save preferences",
      }),
    onSuccess: () => {
      void utils.discover.getPreferences.invalidate();
      void utils.discover.getCardDeck.invalidate();
      notify.success({ message: "Discover will use them from now on.", title: "Preferences saved" });
    },
  });

  const budgetError =
    budgetMin !== null && budgetMax !== null && budgetMin > budgetMax
      ? "Max budget must be at least the min budget"
      : null;

  const hasChanges =
    [...seekingTypes].sort().join() !== [...preferences.seekingTypes].sort().join() ||
    budgetMin !== preferences.budgetMin ||
    budgetMax !== preferences.budgetMax;

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        if (budgetError) return;
        update.mutate({ budgetMax, budgetMin, seekingTypes });
      }}
    >
      <Stack gap="md">
        <fieldset style={{ border: 0, margin: 0, minWidth: 0, padding: 0 }}>
          <Text component="legend" size="sm" fw={500} mb="xs">
            Looking for
          </Text>
          <Chip.Group multiple value={seekingTypes} onChange={setSeekingTypes}>
            <Group gap="xs">
              {PHOTOGRAPHY_TYPES.map((type) => (
                <Chip key={type} value={type} variant="outline" tt="capitalize">
                  {type}
                </Chip>
              ))}
            </Group>
          </Chip.Group>
        </fieldset>

        <Group grow align="flex-start">
          <NumberInput
            label="Min budget"
            placeholder="$0"
            prefix="$"
            min={0}
            allowDecimal={false}
            value={budgetMin ?? ""}
            onChange={(value) => setBudgetMin(typeof value === "number" ? value : null)}
          />
          <NumberInput
            label="Max budget"
            placeholder="No max"
            prefix="$"
            min={0}
            allowDecimal={false}
            value={budgetMax ?? ""}
            onChange={(value) => setBudgetMax(typeof value === "number" ? value : null)}
            error={budgetError}
          />
        </Group>

        <Group>
          <Button
            type="submit"
            leftSection={<IconCheck size={16} />}
            loading={update.isPending}
            disabled={!hasChanges}
          >
            Save preferences
          </Button>
        </Group>
      </Stack>
    </form>
  );
}

/** Visibility switch plus the collapsible matching preferences. */
export default function DiscoverPreferences() {
  const [opened, setOpened] = useState(false);
  const panelId = useId();
  const { data: preferences } = api.discover.getPreferences.useQuery();

  if (!preferences) return null;

  return (
    <Paper withBorder radius="md" p="md" maw={640} mx="auto" w="100%">
      <Stack gap="sm">
        <VisibilitySwitch preferences={preferences} />
        <Button
          variant="subtle"
          color="gray"
          size="compact-sm"
          w="fit-content"
          leftSection={<IconAdjustments size={16} />}
          aria-expanded={opened}
          aria-controls={panelId}
          onClick={() => setOpened((current) => !current)}
        >
          {opened ? "Hide matching preferences" : "Matching preferences"}
        </Button>
        <Collapse expanded={opened} id={panelId}>
          {/* Keyed on the saved values so the form resets to them after a save. */}
          <PreferencesForm
            key={JSON.stringify([preferences.seekingTypes, preferences.budgetMin, preferences.budgetMax])}
            preferences={preferences}
          />
        </Collapse>
      </Stack>
    </Paper>
  );
}
