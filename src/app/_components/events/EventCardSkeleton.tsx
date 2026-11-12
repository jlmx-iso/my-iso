import { Group, Skeleton, Stack } from "@mantine/core";

/** Placeholder with the proportions of a feed EventCard. */
export default function EventCardSkeleton() {
    return (
        <Stack gap="sm">
            <Skeleton height={180} radius="md" />
            <Group wrap="nowrap" gap="sm">
                <Skeleton height={38} width={38} radius="xl" />
                <Skeleton height={14} radius="sm" width="40%" />
            </Group>
            <Skeleton height={20} radius="sm" width="65%" />
            <Skeleton height={14} radius="sm" width="90%" />
            <Group justify="space-between" mt={4}>
                <Skeleton height={20} radius="xl" width={180} />
                <Skeleton height={28} radius="sm" width={90} />
            </Group>
        </Stack>
    )
}
