"use client";

import { Anchor, Group } from "@mantine/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

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
        <Group gap={4}>
            {links.map((link) => {
                const isActive = pathname.startsWith(link.href);
                return (
                    <Anchor
                        key={link.href}
                        component={Link}
                        href={link.href}
                        px="md"
                        py={6}
                        fw={500}
                        fz="sm"
                        style={{
                            borderRadius: "var(--mantine-radius-xl)",
                            textDecoration: "none",
                            transition: "background-color 150ms ease",
                            ...(isActive
                                ? {
                                      backgroundColor: "var(--mantine-color-orange-1)",
                                      color: "var(--mantine-color-orange-7)",
                                  }
                                : {
                                      color: "var(--mantine-color-gray-7)",
                                  }),
                        }}
                        onMouseEnter={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            if (!isActive) {
                                e.currentTarget.style.backgroundColor =
                                    "var(--mantine-color-gray-1)";
                            }
                        }}
                        onMouseLeave={(e: React.MouseEvent<HTMLAnchorElement>) => {
                            if (!isActive) {
                                e.currentTarget.style.backgroundColor = "transparent";
                            }
                        }}
                    >
                        {link.label}
                    </Anchor>
                );
            })}
        </Group>
    );
}
