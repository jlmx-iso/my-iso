"use client";

import { ActionIcon, Group } from "@mantine/core";
import { IconSearch } from "@tabler/icons-react";
import Link from "next/link";

import { api } from "~/trpc/react";

import { AccountDrawer, AccountDropdown, type AccountMenuUser } from "./AccountMenu";
import { NotificationBell } from "./NotificationBell";
import { LoginButton } from "../buttons/LoginButton";

type HeaderActionsProps = {
    user: AccountMenuUser | null;
};

/**
 * Right-hand side of the header. Signed out: the log-in button. Signed in:
 * notifications and the account menu on desktop; search and the account sheet
 * on phones, where the tab bar holds the main sections.
 */
export function HeaderActions({ user }: HeaderActionsProps) {
    const { data } = api.notification.getUnreadCount.useQuery(undefined, {
        enabled: !!user,
        refetchInterval: 30000,
        refetchIntervalInBackground: false,
    });
    const unreadCount = data?.count ?? 0;

    if (!user) return <LoginButton />;

    return (
        <>
            <Group gap="sm" visibleFrom="sm" wrap="nowrap">
                <NotificationBell unreadCount={unreadCount} />
                <AccountDropdown user={user} unreadCount={unreadCount} />
            </Group>
            <Group gap="xs" hiddenFrom="sm" wrap="nowrap">
                <ActionIcon
                    component={Link}
                    href="/app/search"
                    variant="subtle"
                    color="gray"
                    size="xl"
                    radius="xl"
                    aria-label="Search"
                >
                    <IconSearch size={24} stroke={1.5} />
                </ActionIcon>
                <AccountDrawer user={user} unreadCount={unreadCount} />
            </Group>
        </>
    );
}
