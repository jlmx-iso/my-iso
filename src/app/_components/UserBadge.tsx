"use client";

import { Anchor, Group, HoverCard, Title } from "@mantine/core";

import { Avatar } from "./Avatar";

type UserBadgeProps = {
    user: {
        userId: string;
        name: string;
        avatar?: string | null;
    };
};

export default function UserBadge({ user: { userId, name, avatar } }: UserBadgeProps) {
    return (
        <Anchor c="dark" href={`/app/photographer/${userId}`} w="fit-content" underline="never">
            <HoverCard>
                <HoverCard.Target>
                    <Group gap="sm" align="center">
                        <Avatar src={avatar} alt={name} name={name} size="md" />
                        <Title fw={600} order={5}>{name}</Title>
                    </Group>
                </HoverCard.Target>
                {/* TODO: Add profile card on hover */}
                {/* <HoverCard.Dropdown>
                    <p>View profile</p>
                </HoverCard.Dropdown> */}
            </HoverCard>
        </Anchor>
    );
}