"use client";

import { Anchor, Group, HoverCard, Title } from "@mantine/core";
import { Avatar } from "../_server_components/Avatar";

type UserBadgeProps = {
    user: {
        userId: string;
        name: string;
        avatar?: string | null;
    };
};

export default function UserBadge({ user: { userId, name, avatar } }: UserBadgeProps) {
    return (
        <Anchor c="dark" href={`/app/photographer/${userId}`} w="fit-content">
            <HoverCard>
                <HoverCard.Target>
                    <Group mb="lg" align="flex-start" justify="flex-start">
                        <Avatar src={avatar} alt={name} size="lg" />
                        <Title fw="bold" order={4} td={"underlined"}>{name}</Title>
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