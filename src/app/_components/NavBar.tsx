import { Box, Container, Group } from "@mantine/core";
import Image from "next/image";
import Link from "next/link";

import { logger } from "~/_utils/logger";
import { auth } from "~/auth";
import { ADMIN_ROLES } from "~/server/_utils/roles";
import { db } from "~/server/db";

import { HeaderActions } from "./nav/HeaderActions";
import NavLinks from "./nav/NavLinks";
import logo from "../../../public/img/logo.webp";

const authLinks = [
    { href: "/app/events", label: "Events" },
    { href: "/app/discover", label: "Discover" },
    { href: "/app/search", label: "Search" },
    { href: "/app/messages", label: "Messages" },
    { href: "/app/bookings", label: "Bookings" },
];

const publicLinks = [
    { href: "/#features", label: "Features" },
    { href: "/#pricing", label: "Pricing" },
    { href: "/about", label: "About" },
];

/**
 * Whether to show the waitlist admin entry in the account menu. Only decides
 * what is shown: the admin procedures check the role themselves.
 */
async function canManageWaitlist(userId: string): Promise<boolean> {
    try {
        const user = await db.user.findUnique({ select: { role: true }, where: { id: userId } });
        return ADMIN_ROLES.some((role) => role === user?.role);
    } catch (error) {
        // The header must render whatever happens to this lookup.
        logger.warn("Could not read the member's role for the account menu", { error });
        return false;
    }
}

export async function Navbar() {
    const session = await auth();
    const user = session?.user
        ? {
            canManageWaitlist: await canManageWaitlist(session.user.id),
            name: session.user.name ?? "Your account",
            profilePic: session.user.profilePic,
        }
        : null;

    return (
        <Container size="lg" w="100%" h="100%">
            <Group h="100%" justify="space-between" wrap="nowrap">
                <Link href={user ? "/app/events" : "/"} aria-label="ISO home">
                    <Image
                        priority
                        src={logo}
                        alt=""
                        style={{ height: "2.25rem", width: "auto" }}
                        width={100}
                        height={100}
                    />
                </Link>

                {/* Desktop section links; phones use the bottom tab bar. */}
                <Box visibleFrom="sm">
                    <NavLinks links={user ? authLinks : publicLinks} />
                </Box>

                <HeaderActions user={user} />
            </Group>
        </Container>
    );
}
