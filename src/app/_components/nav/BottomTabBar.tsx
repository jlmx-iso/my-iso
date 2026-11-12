"use client";

import {
    IconCalendarEvent,
    IconCalendarStats,
    IconHeartHandshake,
    IconMessageCircle,
    IconUser,
} from "@tabler/icons-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { unreadBadgeLabel, unreadConversationsLabel } from "~/_utils/unread";
import { useUnreadConversations } from "~/app/_hooks/useUnreadMessages";

import classes from "./BottomTabBar.module.css";

const tabs = [
    { href: "/app/events", icon: IconCalendarEvent, label: "Events" },
    { href: "/app/discover", icon: IconHeartHandshake, label: "Discover" },
    { href: "/app/messages", icon: IconMessageCircle, label: "Messages" },
    { href: "/app/bookings", icon: IconCalendarStats, label: "Bookings" },
    { href: "/app/profile", icon: IconUser, label: "Profile" },
] as const;

/** Phone navigation. Sits above the home indicator (safe-area inset). */
export default function BottomTabBar() {
    const pathname = usePathname();
    const unread = useUnreadConversations();

    return (
        <nav aria-label="Main" className={classes.bar}>
            {tabs.map((tab) => {
                const isActive = pathname.startsWith(tab.href);
                return (
                    <Link
                        key={tab.href}
                        href={tab.href}
                        className={classes.tab}
                        aria-current={isActive ? "page" : undefined}
                    >
                        <span className={classes.icon}>
                            <tab.icon size={22} stroke={isActive ? 2 : 1.5} aria-hidden />
                            {tab.href === "/app/messages" && unread > 0 && (
                                <span className={classes.badge} aria-hidden data-testid="tab-unread">
                                    {unreadBadgeLabel(unread)}
                                </span>
                            )}
                        </span>
                        <span>
                            {tab.label}
                            {tab.href === "/app/messages" && unread > 0 && (
                                <span className="sr-only">, {unreadConversationsLabel(unread)}</span>
                            )}
                        </span>
                    </Link>
                );
            })}
        </nav>
    );
}
