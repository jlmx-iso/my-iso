"use client";

import { Alert, Anchor, Box, Button, Group, Paper, SegmentedControl, SimpleGrid, Skeleton, Stack, Table, Text, Title } from "@mantine/core";
import { IconAlertCircle } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";

import { INSIGHT_RANGES, type InsightRange, VIEW_SOURCE_LABELS } from "~/_utils/viewSources";
import LocalDate from "~/app/_components/LocalDate";
import { type RouterOutputs, api } from "~/trpc/react";

import DailyViewsChart from "./DailyViewsChart";

type Insights = RouterOutputs["insights"]["getSummary"];

function plural(count: number, one: string, other: string) {
    return `${count.toLocaleString("en-US")} ${count === 1 ? one : other}`;
}

function Stat({ label, value, testId }: { label: string; value: number; testId: string }) {
    return (
        <Paper withBorder radius="md" p="md" data-testid={testId}>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: 0.4 }}>
                {label}
            </Text>
            <Text fz={28} fw={700} lh={1.2} mt={4}>
                {value.toLocaleString("en-US")}
            </Text>
        </Paper>
    );
}

/** Where profile views came from, as labelled bars of one hue, most first. */
function Sources({ sources, total }: { sources: Insights["profileViews"]["sources"]; total: number }) {
    if (sources.length === 0) {
        return <Text size="sm" c="dimmed">Nobody has opened your profile in this period yet.</Text>;
    }
    return (
        <Stack gap="xs" component="ul" m={0} p={0} style={{ listStyle: "none" }} data-testid="view-sources">
            {sources.map(({ count, source }) => {
                const share = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                    <Box component="li" key={source}>
                        <Group justify="space-between" gap="xs" wrap="nowrap">
                            <Text size="sm">{VIEW_SOURCE_LABELS[source]}</Text>
                            <Text size="sm" fw={600}>
                                {count.toLocaleString("en-US")}
                                <Text span size="xs" c="dimmed" fw={400}> · {share}%</Text>
                            </Text>
                        </Group>
                        <Box h={8} mt={4} bg="gray.1" style={{ borderRadius: 4, overflow: "hidden" }} aria-hidden>
                            <Box h="100%" w={`${Math.max(2, share)}%`} bg="orange.5" style={{ borderRadius: 4 }} />
                        </Box>
                    </Box>
                );
            })}
        </Stack>
    );
}

function TopEvents({ events }: { events: Insights["topEvents"] }) {
    if (events.length === 0) {
        return (
            <Text size="sm" c="dimmed">
                No views or applications on your events in this period. <Anchor component={Link} href="/app/events">Post an event</Anchor> to find a second shooter.
            </Text>
        );
    }
    return (
        <Table.ScrollContainer minWidth={360}>
            <Table verticalSpacing="xs" data-testid="top-events">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Event</Table.Th>
                        <Table.Th ta="right">Views</Table.Th>
                        <Table.Th ta="right">Applications</Table.Th>
                    </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                    {events.map((event) => (
                        <Table.Tr key={event.id}>
                            <Table.Td>
                                <Anchor component={Link} href={`/app/events/${event.id}`} size="sm" fw={600} className="tap-link">
                                    {event.title}
                                </Anchor>
                                <Text size="xs" c="dimmed"><LocalDate date={event.date} /></Text>
                            </Table.Td>
                            <Table.Td ta="right">{event.views.toLocaleString("en-US")}</Table.Td>
                            <Table.Td ta="right">{event.applications.toLocaleString("en-US")}</Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Table.ScrollContainer>
    );
}

function DashboardSkeleton() {
    return (
        <Stack gap="lg" aria-hidden>
            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
                {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} h={86} radius="md" />)}
            </SimpleGrid>
            <Skeleton h={230} radius="md" />
        </Stack>
    );
}

/** A Pro member's numbers for the chosen period. */
export default function InsightsDashboard() {
    const [days, setDays] = useState<InsightRange>(30);
    const summary = api.insights.getSummary.useQuery({ days }, { placeholderData: (previous) => previous });
    const data = summary.data;

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="center" gap="sm">
                <Text size="sm" c="dimmed" aria-live="polite">
                    {data ? `Last ${data.days} days, counted in UTC days.` : "Loading…"}
                </Text>
                <SegmentedControl
                    value={String(days)}
                    onChange={(value) => setDays(Number(value) as InsightRange)}
                    data={INSIGHT_RANGES.map((range) => ({ label: `${range} days`, value: String(range) }))}
                    aria-label="Period"
                    size="md"
                    data-testid="insights-range"
                />
            </Group>

            {summary.isError && !data ? (
                <Alert color="red" icon={<IconAlertCircle size={18} aria-hidden />} title="Your insights could not be loaded">
                    <Stack gap="xs" align="flex-start">
                        <Text size="sm">{summary.error.message}</Text>
                        <Button size="sm" variant="light" color="red" onClick={() => void summary.refetch()}>
                            Try again
                        </Button>
                    </Stack>
                </Alert>
            ) : !data ? (
                <DashboardSkeleton />
            ) : (
                <Stack gap="lg" style={{ opacity: summary.isPlaceholderData ? 0.6 : 1, transition: "opacity 150ms" }}>
                    <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
                        <Stat label="Profile views" value={data.profileViews.total} testId="stat-profile-views" />
                        <Stat label="Event views" value={data.eventViews} testId="stat-event-views" />
                        <Stat label="Applications" value={data.applications} testId="stat-applications" />
                        <Stat label="New conversations" value={data.conversationsStarted} testId="stat-conversations" />
                    </SimpleGrid>

                    <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
                        <Title order={2} size="h5" mb="sm">Profile views per day</Title>
                        <DailyViewsChart daily={data.profileViews.daily} />
                    </Paper>

                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                        <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
                            <Title order={2} size="h5">Where your views came from</Title>
                            <Text size="xs" c="dimmed" mb="sm">
                                {plural(data.profileViews.total, "view", "views")}, by the part of ISO (or the web) they came from.
                            </Text>
                            <Sources sources={data.profileViews.sources} total={data.profileViews.total} />
                        </Paper>
                        <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
                            <Title order={2} size="h5">Your events</Title>
                            <Text size="xs" c="dimmed" mb="sm">Views and applications in this period, most viewed first.</Text>
                            <TopEvents events={data.topEvents} />
                        </Paper>
                    </SimpleGrid>

                    <Text size="xs" c="dimmed">
                        Counts only: ISO does not record who viewed you. Your own visits and automated traffic are not counted.
                        &ldquo;New conversations&rdquo; are conversations someone else started with you.
                    </Text>
                </Stack>
            )}
        </Stack>
    );
}
