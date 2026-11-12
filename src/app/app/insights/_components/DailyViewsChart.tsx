"use client";

import { Box, Group, Text } from "@mantine/core";
import { useState } from "react";

import { formatUtcDay } from "./formatDay";

type DailyViewsChartProps = {
    /** One entry per day, oldest first. */
    daily: ReadonlyArray<{ day: string; count: number }>;
};

const HEIGHT = 160;
/** Space under the plot for the first and last day's labels. */
const AXIS = 22;
const GAP = 2;

/**
 * Profile views per day as columns: one series, one hue (the theme's
 * orange), a recessive baseline and gridline, the highest value labelled.
 * Hovering or focusing a column shows its day and count; the same numbers
 * are in a table for screen readers.
 */
export default function DailyViewsChart({ daily }: DailyViewsChartProps) {
    const [active, setActive] = useState<number | null>(null);
    const peakCount = Math.max(0, ...daily.map((entry) => entry.count));
    const max = Math.max(1, peakCount);
    const peak = daily.reduce((best, entry, index) => (entry.count > (daily[best]?.count ?? 0) ? index : best), 0);
    const width = 100 / Math.max(1, daily.length);
    const shown = active ?? (daily[peak]?.count ? peak : null);
    const shownEntry = shown === null ? undefined : daily[shown];
    const first = daily[0];
    const last = daily.at(-1);

    return (
        <Box>
            <Group justify="space-between" mb={6} h={20} wrap="nowrap">
                <Text size="xs" c="dimmed" aria-live="polite">
                    {shownEntry
                        ? `${formatUtcDay(shownEntry.day)}: ${shownEntry.count} ${shownEntry.count === 1 ? "view" : "views"}${active === null ? " (busiest day)" : ""}`
                        : "No views in this period yet"}
                </Text>
                <Text size="xs" c="dimmed">Most in a day: {peakCount}</Text>
            </Group>
            <Box pos="relative" h={HEIGHT + AXIS} onMouseLeave={() => setActive(null)} data-testid="daily-views-chart">
                <svg
                    width="100%"
                    height={HEIGHT}
                    viewBox={`0 0 100 ${HEIGHT}`}
                    preserveAspectRatio="none"
                    aria-hidden
                    style={{ display: "block", overflow: "visible" }}
                >
                    {/* Gridline at the peak, baseline at zero: recessive. */}
                    <line x1={0} x2={100} y1={0.5} y2={0.5} stroke="var(--mantine-color-gray-2)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    <line x1={0} x2={100} y1={HEIGHT - 0.5} y2={HEIGHT - 0.5} stroke="var(--mantine-color-gray-4)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
                    {daily.map((entry, index) => {
                        const barHeight = entry.count === 0 ? 0 : Math.max(3, (entry.count / max) * (HEIGHT - 4));
                        return (
                            <rect
                                key={entry.day}
                                x={index * width}
                                width={width}
                                y={HEIGHT - barHeight}
                                height={barHeight}
                                rx={0}
                                fill={index === active ? "var(--mantine-color-orange-7)" : "var(--mantine-color-orange-5)"}
                                stroke="var(--mantine-color-body)"
                                strokeWidth={GAP}
                                vectorEffect="non-scaling-stroke"
                            />
                        );
                    })}
                </svg>
                {/* Hit targets: the full column height, wider than the bar. */}
                <Box pos="absolute" inset={0} h={HEIGHT} style={{ display: "flex" }}>
                    {daily.map((entry, index) => (
                        <Box
                            key={entry.day}
                            style={{ flex: 1, cursor: "default" }}
                            onMouseEnter={() => setActive(index)}
                            onTouchStart={() => setActive(index)}
                            title={`${formatUtcDay(entry.day)}: ${entry.count}`}
                        />
                    ))}
                </Box>
                <Group justify="space-between" mt={4} wrap="nowrap">
                    <Text size="xs" c="dimmed">{first ? formatUtcDay(first.day) : ""}</Text>
                    <Text size="xs" c="dimmed">{last ? formatUtcDay(last.day) : ""}</Text>
                </Group>
            </Box>
            <table className="sr-only">
                <caption>Profile views per day</caption>
                <thead>
                    <tr>
                        <th scope="col">Day</th>
                        <th scope="col">Views</th>
                    </tr>
                </thead>
                <tbody>
                    {daily.map((entry) => (
                        <tr key={entry.day}>
                            <td>{formatUtcDay(entry.day)}</td>
                            <td>{entry.count}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </Box>
    );
}
