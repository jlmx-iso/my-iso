"use client";

import { Box, Group, Text } from "@mantine/core";
import { type KeyboardEvent, useRef, useState } from "react";

import { formatUtcDay } from "./formatDay";

type DailyViewsChartProps = {
    /** One entry per day, oldest first. */
    daily: ReadonlyArray<{ day: string; count: number }>;
};

const HEIGHT = 160;
const GAP = 2;

const label = (entry: { day: string; count: number }) =>
    `${formatUtcDay(entry.day)}: ${entry.count} ${entry.count === 1 ? "view" : "views"}`;

/** Which column a key moves to from `index`, or null for any other key. */
export function nextColumn(key: string, index: number, length: number): number | null {
    switch (key) {
        case "ArrowLeft":
        case "ArrowDown":
            return Math.max(0, index - 1);
        case "ArrowRight":
        case "ArrowUp":
            return Math.min(length - 1, index + 1);
        case "Home":
            return 0;
        case "End":
            return length - 1;
        default:
            return null;
    }
}

/**
 * Profile views per day as columns: one series, one hue (the theme's
 * orange), a recessive baseline and gridline, the busiest day named.
 * Hovering, touching or focusing a column shows its day and count above
 * the plot. From the keyboard the columns are one tab stop; the arrow
 * keys, Home and End move between days. The same numbers are in a table
 * for screen readers.
 */
export default function DailyViewsChart({ daily }: DailyViewsChartProps) {
    const [active, setActive] = useState<number | null>(null);
    const [focusIndex, setFocusIndex] = useState(Math.max(0, daily.length - 1));
    const columns = useRef<Array<HTMLDivElement | null>>([]);
    const peakCount = Math.max(0, ...daily.map((entry) => entry.count));
    const max = Math.max(1, peakCount);
    const peak = daily.findIndex((entry) => entry.count === peakCount);
    const width = 100 / Math.max(1, daily.length);
    const shown = active ?? (peakCount > 0 ? peak : null);
    const shownEntry = shown === null ? undefined : daily[shown];
    const first = daily[0];
    const last = daily.at(-1);

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>, index: number) => {
        const next = nextColumn(event.key, index, daily.length);
        if (next === null) return;
        event.preventDefault();
        setFocusIndex(next);
        setActive(next);
        columns.current[next]?.focus();
    };

    return (
        <Box>
            <Group justify="space-between" mb={6} h={20} wrap="nowrap">
                <Text size="xs" c="dimmed" aria-live="polite" data-testid="chart-readout">
                    {shownEntry ? `${label(shownEntry)}${active === null ? " (busiest day)" : ""}` : ""}
                </Text>
                <Text size="xs" c="dimmed">Most in a day: {peakCount}</Text>
            </Group>
            <Box pos="relative" h={HEIGHT} onMouseLeave={() => setActive(null)} data-testid="daily-views-chart">
                <svg
                    width="100%"
                    height={HEIGHT}
                    viewBox={`0 0 100 ${HEIGHT}`}
                    preserveAspectRatio="none"
                    aria-hidden
                    style={{ display: "block", overflow: "visible" }}
                >
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
                                fill={index === active ? "var(--mantine-color-orange-7)" : "var(--mantine-color-orange-5)"}
                                stroke="var(--mantine-color-body)"
                                strokeWidth={GAP}
                                vectorEffect="non-scaling-stroke"
                            />
                        );
                    })}
                </svg>
                {/* Hit targets: the full column height, wider than the bar. */}
                <Box pos="absolute" inset={0} style={{ display: "flex" }} role="group" aria-label="Profile views per day">
                    {daily.map((entry, index) => (
                        <Box
                            key={entry.day}
                            ref={(element: HTMLDivElement | null) => {
                                columns.current[index] = element;
                            }}
                            role="img"
                            aria-label={label(entry)}
                            tabIndex={index === focusIndex ? 0 : -1}
                            className="chart-column"
                            style={{ flex: 1 }}
                            onMouseEnter={() => setActive(index)}
                            onTouchStart={() => setActive(index)}
                            onFocus={() => setActive(index)}
                            onBlur={() => setActive(null)}
                            onKeyDown={(event) => onKeyDown(event, index)}
                        />
                    ))}
                </Box>
            </Box>
            <Group justify="space-between" mt={4} wrap="nowrap">
                <Text size="xs" c="dimmed">{first ? formatUtcDay(first.day) : ""}</Text>
                <Text size="xs" c="dimmed">{last ? formatUtcDay(last.day) : ""}</Text>
            </Group>
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
