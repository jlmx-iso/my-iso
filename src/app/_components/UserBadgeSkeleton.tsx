import { Group, Skeleton } from "@mantine/core";

export default function UserBadgeSkeleton() {
    return (
        <Group>
            <Skeleton height={50} radius="xl" />
            <Skeleton height={20} radius="xl" width="50%" />
        </Group>
    )
};