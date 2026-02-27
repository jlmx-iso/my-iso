import { Group, Skeleton, Stack } from "@mantine/core";

export default function UserBadgeSkeleton() {
    return (
        <Group wrap="nowrap">
            <Skeleton height={50} width={50} radius="xl" />
            <Stack gap={6} style={{ flex: 1 }}>
                <Skeleton height={16} radius="sm" width="60%" />
                <Skeleton height={12} radius="sm" width="40%" />
            </Stack>
        </Group>
    )
}
