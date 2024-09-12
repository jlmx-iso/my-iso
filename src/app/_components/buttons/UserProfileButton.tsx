"use client";
import { Group } from "@mantine/core";
import Link from "next/link";
import { type Session } from "next-auth";
import { useFeatureFlagEnabled } from "posthog-js/react";

import { LoginButton } from "./LoginButton";
import { LogoutButton } from "./LogoutButton";

import { Avatar } from "~/app/_components/Avatar";
import { FeatureFlags } from "~/app/_lib";


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
                    name={session.user.name ?? ""}
                    size="md"
                />
            </Link>
            <LogoutButton />
        </Group>
    )
};