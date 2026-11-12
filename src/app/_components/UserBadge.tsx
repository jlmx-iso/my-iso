import { Group, Text } from "@mantine/core";
import Link from "next/link";

import { Avatar } from "./Avatar";

type UserBadgeProps = {
    user: {
        userId: string;
        name: string;
        avatar?: string | null;
    };
};

/** Avatar and name linking to the person's in-app profile. */
export default function UserBadge({ user: { userId, name, avatar } }: UserBadgeProps) {
    return (
        <Link href={`/app/photographer/${userId}`} style={{ minWidth: 0 }} className="tap-link">
            <Group gap="sm" align="center" wrap="nowrap">
                <Avatar src={avatar} name={name} alt="" size="md" />
                <Text fw={600} truncate>{name}</Text>
            </Group>
        </Link>
    );
}
