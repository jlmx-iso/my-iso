"use client";
import { ActionIcon, Divider, NavLink, Popover, Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { IconLogout, IconSettings, IconUser } from "@tabler/icons-react";
import { type Session } from "next-auth";
import { signOut } from "next-auth/react";
import { useFeatureFlagEnabled } from "posthog-js/react";

import { LoginButton } from "./LoginButton";

import { Avatar } from "~/app/_components/Avatar";
import { FeatureFlags } from "~/app/_lib";
import colors from "~/app/theme/colors";


type UserProfileButtonProps = {
    session: Session | null;
};

export const UserProfileButton = ({ session }: UserProfileButtonProps) => {
    const isAppDisabled = useFeatureFlagEnabled(FeatureFlags.IS_APP_DISABLED);
    const [opened, { close, open }] = useDisclosure(false);

    const toggleOpened = () => {
        if (opened) {
            close();
        } else {
            open();
        }
    }

    if (isAppDisabled) {
        return null;
    }
    if (!session || !session.user) {
        return (
            <LoginButton />
        );
    }
    return (
        <Popover width={300} trapFocus position="bottom" offset={{ crossAxis: -130, mainAxis: 10 }} shadow="md" opened={opened}>
            <Popover.Target>
                <ActionIcon onClick={toggleOpened} radius="xl" size="lg" variant="subtle">
                    <Avatar
                        src={session.user.profilePic}
                        name={session.user.name ?? ""}
                        size="md"
                    />
                </ActionIcon>
            </Popover.Target>
            <Popover.Dropdown>
                <Text ta="end">Hi, {session.user.name}!</Text>
                <Divider my="md" />
                <NavLink
                    href="/app/profile"
                    label="Profile"
                    leftSection={<IconUser color={colors.orange![4]} />}
                />
                <NavLink
                    href="/app/settings"
                    label="Settings"
                    leftSection={<IconSettings color={colors.orange![4]} />}
                />
                <NavLink
                    component="button"
                    label="Log Out"
                    leftSection={<IconLogout color={colors.orange![4]} />}
                    onClick={() => signOut()}
                />
            </Popover.Dropdown>
        </Popover>
    )
};