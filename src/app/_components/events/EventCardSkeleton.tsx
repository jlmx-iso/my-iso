import { Skeleton } from "@mantine/core";

import UserBadgeSkeleton from "../UserBadgeSkeleton";

export default function EventCardSkeleton() {
    return (
        <>
            <UserBadgeSkeleton />
            <Skeleton height={200} radius="xl" />
            <Skeleton height={20} radius="xl" width="50%" />
            <Skeleton height={20} radius="xl" width="30%" />
        </>
    )
}