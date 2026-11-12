"use client";

import { Group } from "@mantine/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { unreadBadgeLabel, unreadConversationsLabel } from "~/_utils/unread";
import { useUnreadConversations } from "~/app/_hooks/useUnreadMessages";

import classes from "./NavLinks.module.css";

const MESSAGES_HREF = "/app/messages";

type NavLink = {
    href: string;
    label: string;
};

type NavLinksProps = {
    links: NavLink[];
};

export default function NavLinks({ links }: NavLinksProps) {
    const pathname = usePathname();
    // Only the signed-in navigation has a Messages link to badge.
    const unread = useUnreadConversations(links.some((link) => link.href === MESSAGES_HREF));

    return (
        <Group component="nav" aria-label="Main" gap={4} wrap="nowrap">
            {links.map((link) => {
                // "/#features" style links never match a pathname.
                const isActive = !link.href.includes("#") && pathname.startsWith(link.href);
                return (
                    <Link
                        key={link.href}
                        href={link.href}
                        className={classes.link}
                        aria-current={isActive ? "page" : undefined}
                    >
                        {link.label}
                        {link.href === MESSAGES_HREF && unread > 0 && (
                            <span className={classes.badge} data-testid="nav-unread">
                                <span aria-hidden>{unreadBadgeLabel(unread)}</span>
                                <span className="sr-only">, {unreadConversationsLabel(unread)}</span>
                            </span>
                        )}
                    </Link>
                );
            })}
        </Group>
    );
}
