import { Group, Skeleton, Stack } from "@mantine/core";

import UserBadgeSkeleton from "../UserBadgeSkeleton";

type EventCardSkeletonProps = {
    variant?: "feed" | "hero";
};

export default function EventCardSkeleton({ variant = "feed" }: EventCardSkeletonProps) {
    const isHero = variant === "hero";

    return (
        <Stack gap="sm">
            <Skeleton height={isHero ? 280 : 180} radius="md" />
            <UserBadgeSkeleton />
            <Skeleton height={isHero ? 24 : 18} radius="sm" width="55%" />
            <Skeleton height={14} radius="sm" width="35%" />
            <Group justify="space-between" mt={4}>
                <Skeleton height={12} radius="sm" width={80} />
                <Skeleton height={28} radius="sm" width={90} />
            </Group>
        </Stack>
    )
}
