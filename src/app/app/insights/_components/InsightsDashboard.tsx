"use client";

import {
    Alert,
    Anchor,
    Box,
    Button,
    CopyButton,
    Group,
    Paper,
    SegmentedControl,
    SimpleGrid,
    Skeleton,
    Stack,
    Table,
    Text,
    ThemeIcon,
    Title,
} from "@mantine/core";
import { IconAlertCircle, IconCheck, IconEyeOff, IconLink, IconPhotoPlus } from "@tabler/icons-react";
import Link from "next/link";
import { useState } from "react";

import { INSIGHT_RANGES, type InsightRange, VIEW_SOURCE_LABELS } from "~/_utils/viewSources";
import LocalDate from "~/app/_components/LocalDate";
import { type RouterOutputs, api } from "~/trpc/react";

import DailyViewsChart from "./DailyViewsChart";
import { formatUtcDay } from "./formatDay";

type Insights = RouterOutputs["insights"]["getSummary"];
type Compared = Insights["eventViews"];

type InsightsDashboardProps = {
    /** The member's shareable profile address, for "Copy your profile link". */
    profileUrl: string;
};

const number = (value: number) => value.toLocaleString("en-US");

/** "+12% vs previous 30 days"; plain words when there is nothing to compare with. */
export function changeLabel(compared: Compared, days: number): string {
    if (compared.previous === null) return "No earlier period to compare with yet";
    if (compared.changePercent === null) return compared.value > 0 ? `New: none in the previous ${days} days` : `Same as the previous ${days} days`;
    if (compared.changePercent === 0) return `Same as the previous ${days} days`;
    const sign = compared.changePercent > 0 ? "+" : "−";
    return `${sign}${Math.abs(compared.changePercent)}% vs previous ${days} days`;
}

function Stat({ label, caption, compared, days, testId }: { label: string; caption: string; compared: Compared; days: number; testId: string }) {
    const tone = compared.changePercent === null || compared.changePercent === 0 ? "dimmed" : compared.changePercent > 0 ? "teal.8" : "dimmed";
    return (
        <Paper withBorder radius="md" p="md" data-testid={testId}>
            <Text size="xs" c="dimmed" fw={600} tt="uppercase" style={{ letterSpacing: 0.4 }}>
                {label}
            </Text>
            <Text fz={28} fw={700} lh={1.2} mt={4}>
                {number(compared.value)}
            </Text>
            <Text size="xs" c="dimmed" mt={2}>{caption}</Text>
            <Text size="xs" c={tone} fw={500} mt={6} data-testid={`${testId}-change`}>
                {changeLabel(compared, days)}
            </Text>
        </Paper>
    );
}

/** Where profile views came from, as labelled bars of one hue, most first. */
function Sources({ sources, total }: { sources: Insights["profileViews"]["sources"]; total: number }) {
    return (
        <Stack gap="xs" component="ul" m={0} p={0} style={{ listStyle: "none" }} data-testid="view-sources">
            {sources.map(({ count, source }) => {
                const share = total > 0 ? Math.round((count / total) * 100) : 0;
                return (
                    <Box component="li" key={source}>
                        <Group justify="space-between" gap="xs" wrap="nowrap">
                            <Text size="sm">{VIEW_SOURCE_LABELS[source]}</Text>
                            <Text size="sm" fw={600}>
                                {number(count)}
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
        <Table.ScrollContainer minWidth={280}>
            <Table verticalSpacing="xs" data-testid="top-events">
                <Table.Thead>
                    <Table.Tr>
                        <Table.Th>Event</Table.Th>
                        <Table.Th ta="right">Views</Table.Th>
                        <Table.Th ta="right">Applied</Table.Th>
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
                            <Table.Td ta="right">{number(event.views)}</Table.Td>
                            <Table.Td ta="right">{number(event.applications)}</Table.Td>
                        </Table.Tr>
                    ))}
                </Table.Tbody>
            </Table>
        </Table.ScrollContainer>
    );
}

/** No profile views in the period: say so plainly, and offer the two things that bring views. */
function NoViewsYet({ days, profileUrl }: { days: number; profileUrl: string }) {
    return (
        <Stack align="center" gap="sm" py="lg" ta="center" data-testid="insights-empty">
            <ThemeIcon size={48} radius="xl" variant="light" color="gray">
                <IconEyeOff size={24} aria-hidden />
            </ThemeIcon>
            <Text fw={600}>No profile views yet in the last {days} days</Text>
            <Text size="sm" c="dimmed" maw={420}>
                Photographers find you through search, your events and links you share. A full portfolio and a shared link
                are the quickest ways to be found.
            </Text>
            <Group gap="sm" justify="center">
                <Button component={Link} href="/app/profile" size="sm" leftSection={<IconPhotoPlus size={16} aria-hidden />}>
                    Add portfolio images
                </Button>
                <CopyButton value={profileUrl}>
                    {({ copied, copy }) => (
                        <Button
                            variant="default"
                            size="sm"
                            onClick={copy}
                            leftSection={copied ? <IconCheck size={16} aria-hidden /> : <IconLink size={16} aria-hidden />}
                            aria-live="polite"
                        >
                            {copied ? "Link copied" : "Copy your profile link"}
                        </Button>
                    )}
                </CopyButton>
            </Group>
        </Stack>
    );
}

function DashboardSkeleton() {
    return (
        <Stack gap="lg" aria-hidden>
            <SimpleGrid cols={{ base: 2, md: 4 }} spacing="sm">
                {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} h={120} radius="md" />)}
            </SimpleGrid>
            <Skeleton h={230} radius="md" />
        </Stack>
    );
}

/** A Pro member's numbers for the chosen period. */
export default function InsightsDashboard({ profileUrl }: InsightsDashboardProps) {
    const [days, setDays] = useState<InsightRange>(30);
    const summary = api.insights.getSummary.useQuery({ days }, { placeholderData: (previous) => previous });
    const data = summary.data;

    return (
        <Stack gap="lg">
            <Group justify="space-between" align="center" gap="sm">
                <Text size="sm" c="dimmed" aria-live="polite">
                    {data ? `${formatUtcDay(data.from)} to ${formatUtcDay(data.to)}, through yesterday*` : "Loading…"}
                </Text>
                <SegmentedControl
                    value={String(days)}
                    onChange={(value) => setDays(Number(value) as InsightRange)}
                    data={INSIGHT_RANGES.map((range) => ({ label: `${range} days`, value: String(range) }))}
                    aria-label="Period"
                    size="md"
                    // 44px tall segments: a fingertip's target on phones.
                    styles={{ label: { alignItems: "center", display: "flex", justifyContent: "center", minHeight: 44 } }}
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
                    <SimpleGrid cols={{ base: 1, xs: 2, md: 4 }} spacing="sm">
                        <Stat label="Profile views" caption="Times your profile was opened" compared={data.profileViews} days={days} testId="stat-profile-views" />
                        <Stat label="Event views" caption="Times your events were opened" compared={data.eventViews} days={days} testId="stat-event-views" />
                        <Stat label="Applications" caption="Applications to your events" compared={data.applications} days={days} testId="stat-applications" />
                        <Stat label="New conversations" caption="Photographers who messaged you first" compared={data.conversationsStarted} days={days} testId="stat-conversations" />
                    </SimpleGrid>

                    <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
                        <Group justify="space-between" align="baseline" mb="sm" gap="xs">
                            <Title order={2} size="h5">Profile views per day</Title>
                            {data.countingSince > data.from && (
                                <Text size="xs" c="dimmed" data-testid="counting-since">
                                    Counting started on {formatUtcDay(data.countingSince)}
                                </Text>
                            )}
                        </Group>
                        {data.profileViews.value === 0 ? (
                            <NoViewsYet days={days} profileUrl={profileUrl} />
                        ) : (
                            <DailyViewsChart daily={data.profileViews.daily} />
                        )}
                    </Paper>

                    <SimpleGrid cols={{ base: 1, md: 2 }} spacing="lg">
                        {data.profileViews.value > 0 && (
                            <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
                                <Title order={2} size="h5">Where your views came from</Title>
                                <Text size="xs" c="dimmed" mb="sm">
                                    {number(data.profileViews.value)} {data.profileViews.value === 1 ? "view" : "views"}, by the part of ISO (or the web)
                                    they came from. Sources with fewer than 3 views are counted under &ldquo;Other&rdquo;.
                                </Text>
                                <Sources sources={data.profileViews.sources} total={data.profileViews.value} />
                            </Paper>
                        )}
                        <Paper withBorder radius="md" p={{ base: "md", sm: "lg" }}>
                            <Title order={2} size="h5">Your events</Title>
                            <Text size="xs" c="dimmed" mb="sm">Views and applications received in this period, most viewed first.</Text>
                            <TopEvents events={data.topEvents} />
                        </Paper>
                    </SimpleGrid>

                    <Text size="xs" c="dimmed">
                        Counts only: ISO does not record who viewed you. Each browser counts once a day per page; your own visits
                        and automated traffic are not counted.
                    </Text>
                    <Text size="xs" c="dimmed" data-testid="utc-footnote">
                        * Days run midnight to midnight UTC, so a late-evening view may land on the next day. Every number on
                        this page stops at the end of yesterday: today is added once it is over.
                    </Text>
                </Stack>
            )}
        </Stack>
    );
}
