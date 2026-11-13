"use client";

import { Group, type MantineColorScheme, type MantineSize, SegmentedControl, useMantineColorScheme } from "@mantine/core";
import { type Icon, IconDeviceDesktop, IconMoon, IconSun } from "@tabler/icons-react";
import { useSyncExternalStore } from "react";

export const COLOR_SCHEME_OPTIONS = [
    { icon: IconDeviceDesktop, label: "System", value: "auto" },
    { icon: IconSun, label: "Light", value: "light" },
    { icon: IconMoon, label: "Dark", value: "dark" },
] as const satisfies readonly { icon: Icon; label: string; value: MantineColorScheme }[];

const subscribeNothing = () => () => undefined;

/**
 * False while the server HTML is being hydrated, true after. The stored
 * choice is only known in the browser (Mantine reads localStorage when the
 * provider first renders there), so until hydration is over no option is
 * shown as chosen: the server and the first client render agree, and there
 * is no hydration mismatch.
 */
function useHydrated(): boolean {
    return useSyncExternalStore(
        subscribeNothing,
        () => true,
        () => false,
    );
}

type ColorSchemeControlProps = {
    size?: MantineSize;
    fullWidth?: boolean;
};

/**
 * System / Light / Dark. A radio group named "Appearance" (Mantine's
 * SegmentedControl is native radio inputs: arrow keys move the choice, and
 * screen readers announce the one that is checked). The choice is kept by
 * MantineProvider's default localStorage manager, and the root layout's
 * ColorSchemeScript applies it before the first paint of every later page.
 */
export function ColorSchemeControl({ size = "sm", fullWidth = false }: ColorSchemeControlProps) {
    const { colorScheme, setColorScheme } = useMantineColorScheme();
    const hydrated = useHydrated();
    const iconSize = size === "xs" ? 14 : 16;

    return (
        // "" (no option) until hydrated: the control stays controlled, with
        // nothing checked, rather than falling back to its first option.
        <SegmentedControl<MantineColorScheme | "">
            aria-label="Appearance"
            size={size}
            fullWidth={fullWidth}
            value={hydrated ? colorScheme : ""}
            onChange={(value) => {
                if (value) setColorScheme(value);
            }}
            data={COLOR_SCHEME_OPTIONS.map((option) => ({
                label: (
                    <Group gap={6} wrap="nowrap" justify="center">
                        <option.icon size={iconSize} stroke={1.75} aria-hidden />
                        <span>{option.label}</span>
                    </Group>
                ),
                value: option.value,
            }))}
        />
    );
}
