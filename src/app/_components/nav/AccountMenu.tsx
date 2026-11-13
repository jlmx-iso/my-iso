"use client";

import {
    Badge,
    Box,
    Button,
    Divider,
    Drawer,
    Group,
    Indicator,
    NavLink,
    Popover,
    Stack,
    Text,
    UnstyledButton,
} from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import {
    IconBell,
    IconCalendarStats,
    IconChartBar,
    IconHeartHandshake,
    IconLifebuoy,
    IconLogout,
    IconSettings,
    IconShieldCheck,
    IconUser,
    IconUserPlus,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { signOut } from "next-auth/react";
import { useState } from "react";

import { Avatar } from "~/app/_components/Avatar";
import { ColorSchemeControl } from "~/app/_components/theme/ColorSchemeControl";

import classes from "./AccountMenu.module.css";

export type AccountMenuUser = {
    name: string;
    profilePic?: string | null;
    /** Founders and ambassadors: show the waitlist admin entry. */
    canManageWaitlist?: boolean;
};

type AccountMenuProps = {
    user: AccountMenuUser;
    unreadCount: number;
};

const links = [
    { href: "/app/profile", icon: IconUser, label: "Profile" },
    { href: "/app/bookings", icon: IconCalendarStats, label: "Bookings" },
    { href: "/app/discover/matches", icon: IconHeartHandshake, label: "Matches" },
    { href: "/app/notifications", icon: IconBell, label: "Notifications" },
    { href: "/app/insights", icon: IconChartBar, label: "Insights" },
    { href: "/app/invites", icon: IconUserPlus, label: "Invites" },
    { href: "/app/settings", icon: IconSettings, label: "Settings" },
] as const;

/** Help, for everyone: the page offers priority support to Pro members and the contact route to others. */
const HELP_LINK = { href: "/app/support", icon: IconLifebuoy, label: "Help & support" } as const;

const ADMIN_LINK = { href: "/app/admin/waitlist", icon: IconShieldCheck, label: "Waitlist admin" } as const;

/** The account links for this member: the admin entry only for those it works for. */
function linksFor(user: AccountMenuUser) {
    return user.canManageWaitlist ? [...links, HELP_LINK, ADMIN_LINK] : [...links, HELP_LINK];
}

function unreadLabel(count: number) {
    return count > 99 ? "99+" : String(count);
}

function UnreadBadge({ count }: { count: number }) {
    if (count === 0) return null;
    return (
        <Badge size="sm" color="teal" circle={count < 10} aria-label={`${count} unread`}>
            {unreadLabel(count)}
        </Badge>
    );
}

/** System / Light / Dark, under a visible "Appearance" caption. */
function AppearanceSection({ size }: { size: "xs" | "sm" }) {
    return (
        <Box px={size === "xs" ? "sm" : 0} py={size === "xs" ? 4 : 0}>
            {/* The radio group carries the same name; the caption is for sighted users. */}
            <Text size="xs" c="dimmed" mb={6} aria-hidden>
                Appearance
            </Text>
            <ColorSchemeControl size={size} fullWidth />
        </Box>
    );
}

function useLogOut() {
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const logOut = () => {
        setIsLoggingOut(true);
        void signOut({ callbackUrl: "/" }).catch(() => setIsLoggingOut(false));
    };
    return { isLoggingOut, logOut };
}

/**
 * Desktop: avatar button with a dropdown of account links. A popover with
 * plain links and a button (a disclosure), which every screen reader handles,
 * rather than an ARIA menu.
 */
export function AccountDropdown({ user, unreadCount }: AccountMenuProps) {
    const [opened, { close, toggle }] = useDisclosure(false);
    const pathname = usePathname();
    const { isLoggingOut, logOut } = useLogOut();

    return (
        <Popover opened={opened} onChange={(next) => !next && close()} position="bottom-end" width={240} shadow="md" trapFocus returnFocus>
            <Popover.Target>
                <UnstyledButton
                    onClick={toggle}
                    aria-expanded={opened}
                    className={classes.trigger}
                    data-testid="account-menu-desktop"
                >
                    {/* Named by hidden text rather than aria-label: the avatar's
                        initials are decorative and must not be the name. */}
                    <span className="sr-only">Account menu</span>
                    <Avatar src={user.profilePic} name={user.name} alt="" size="md" self />
                </UnstyledButton>
            </Popover.Target>
            <Popover.Dropdown p="xs" aria-label="Account">
                <Text size="xs" c="dimmed" px="sm" py={6}>
                    Signed in as {user.name}
                </Text>
                <Box component="nav" aria-label="Account">
                    {linksFor(user).map((link) => (
                        <NavLink
                            key={link.href}
                            component={Link}
                            href={link.href}
                            label={link.label}
                            active={pathname === link.href}
                            aria-current={pathname === link.href ? "page" : undefined}
                            onClick={close}
                            leftSection={<link.icon size={18} stroke={1.75} />}
                            rightSection={
                                link.href === "/app/notifications" ? (
                                    <UnreadBadge count={unreadCount} />
                                ) : undefined
                            }
                            style={{ borderRadius: "var(--mantine-radius-sm)" }}
                        />
                    ))}
                </Box>
                <Divider my={6} />
                <AppearanceSection size="xs" />
                <Divider my={6} />
                <NavLink
                    component="button"
                    type="button"
                    label={isLoggingOut ? "Logging out…" : "Log out"}
                    leftSection={<IconLogout size={18} stroke={1.75} />}
                    onClick={logOut}
                    disabled={isLoggingOut}
                    style={{ borderRadius: "var(--mantine-radius-sm)" }}
                />
            </Popover.Dropdown>
        </Popover>
    );
}

/** Mobile: avatar button that opens a full-height account sheet. */
export function AccountDrawer({ user, unreadCount }: AccountMenuProps) {
    const [opened, { close, open }] = useDisclosure(false);
    const pathname = usePathname();
    const { isLoggingOut, logOut } = useLogOut();

    return (
        <>
            <UnstyledButton
                onClick={open}
                aria-haspopup="dialog"
                aria-expanded={opened}
                className={classes.trigger}
                data-testid="account-menu-mobile"
            >
                <span className="sr-only">
                    {unreadCount > 0
                        ? `Account menu, ${unreadCount} unread notifications`
                        : "Account menu"}
                </span>
                <Indicator
                    disabled={unreadCount === 0}
                    label={unreadLabel(unreadCount)}
                    size={16}
                    offset={4}
                    aria-hidden
                >
                    <Avatar src={user.profilePic} name={user.name} alt="" size="md" self />
                </Indicator>
            </UnstyledButton>

            <Drawer
                opened={opened}
                onClose={close}
                position="right"
                size={320}
                title="Account"
                closeButtonProps={{ "aria-label": "Close account menu" }}
                styles={{
                    body: {
                        paddingBottom: "calc(var(--mantine-spacing-md) + env(safe-area-inset-bottom, 0px))",
                    },
                    title: { fontWeight: 600 },
                }}
            >
                <Stack gap="md">
                    <Group gap="sm" wrap="nowrap">
                        <Avatar src={user.profilePic} name={user.name} alt="" size="lg" self />
                        <Box style={{ minWidth: 0 }}>
                            <Text fw={600} truncate>
                                {user.name}
                            </Text>
                            <Text size="sm" c="dimmed">
                                Signed in
                            </Text>
                        </Box>
                    </Group>
                    <Divider />
                    <Box component="nav" aria-label="Account">
                        {linksFor(user).map((link) => (
                            <NavLink
                                key={link.href}
                                component={Link}
                                href={link.href}
                                label={link.label}
                                active={pathname === link.href}
                                aria-current={pathname === link.href ? "page" : undefined}
                                onClick={close}
                                leftSection={<link.icon size={20} stroke={1.75} />}
                                rightSection={
                                    link.href === "/app/notifications" ? (
                                        <UnreadBadge count={unreadCount} />
                                    ) : undefined
                                }
                                py="sm"
                                style={{ borderRadius: "var(--mantine-radius-md)" }}
                            />
                        ))}
                    </Box>
                    <Divider />
                    <AppearanceSection size="sm" />
                    <Divider />
                    <Button
                        variant="default"
                        leftSection={<IconLogout size={18} />}
                        onClick={logOut}
                        loading={isLoggingOut}
                        fullWidth
                    >
                        Log out
                    </Button>
                </Stack>
            </Drawer>
        </>
    );
}
