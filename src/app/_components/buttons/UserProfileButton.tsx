"use client";
import { Group, Avatar } from "@mantine/core";
import Link from "next/link";
import { type Session } from "next-auth";
import { useFeatureFlagEnabled } from "posthog-js/react";
import { FeatureFlags } from "~/app/_lib";
import { LoginButton } from "./LoginButton";
import { LogoutButton } from "./LogoutButton";

type UserProfileButtonProps = {
    session: Session | null;
};

export const UserProfileButton = ({ session }: UserProfileButtonProps) => {
    const isAppDisabled = useFeatureFlagEnabled(FeatureFlags.IS_APP_DISABLED);
    if (isAppDisabled) {
        return null;
    }
    if (!session || !session.user) {
        return (
            <LoginButton />
        );
    }
    return (
        <Group>
            <Link href="/app/profile">
                <Avatar
                    src={session.user.profilePic}
                    alt={session.user.firstName + " " + session.user.lastName}
                    radius="xl"
                />
            </Link>
            <LogoutButton />
        </Group>
    )
};