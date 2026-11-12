"use client";

import { Group } from "@mantine/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

import classes from "./NavLinks.module.css";

type NavLink = {
    href: string;
    label: string;
};

type NavLinksProps = {
    links: NavLink[];
};

export default function NavLinks({ links }: NavLinksProps) {
    const pathname = usePathname();

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
                    </Link>
                );
            })}
        </Group>
    );
}
