import { Card, Group, Skeleton, Stack } from "@mantine/core";

/**
 * Placeholder with the shape of a feed EventCard (date tile, title, details,
 * description, poster, actions), in a card of its own so a loading feed
 * looks like the feed it becomes.
 */
export default function EventCardSkeleton() {
    return (
        <Card withBorder radius="md" p="md" h="100%" data-testid="event-card-skeleton">
            <Stack gap="sm">
                <Group gap="md" align="flex-start" wrap="nowrap">
                    <Skeleton height={68} width={56} radius="md" style={{ flexShrink: 0 }} />
                    <Stack gap={8} style={{ flex: 1 }}>
                        <Skeleton height={20} radius="sm" width="80%" />
                        <Skeleton height={14} radius="sm" width="95%" />
                        <Skeleton height={14} radius="sm" width="45%" />
                    </Stack>
                </Group>
                <Skeleton height={12} radius="sm" width="100%" />
                <Skeleton height={12} radius="sm" width="70%" />
                <Group justify="space-between" wrap="nowrap">
                    <Group gap="sm" wrap="nowrap">
                        <Skeleton height={38} width={38} radius="xl" />
                        <Skeleton height={14} radius="sm" width={110} />
                    </Group>
                    <Skeleton height={12} radius="sm" width={90} />
                </Group>
                <Group justify="space-between" mt={4}>
                    <Skeleton height={26} radius="sm" width={100} />
                    <Skeleton height={30} radius="md" width={80} />
                </Group>
            </Stack>
        </Card>
    )
}
