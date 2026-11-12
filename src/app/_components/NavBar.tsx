import { Box, Container, Group } from "@mantine/core";
import Image from "next/image";
import Link from "next/link";

import { auth } from "~/auth";

import { LoginButton } from "./buttons/LoginButton";
import { UserProfileButton } from "./buttons/UserProfileButton";
import MobileSearchButton from "./nav/MobileSearchButton";
import NavLinks from "./nav/NavLinks";
import { NotificationBell } from "./nav/NotificationBell";
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

export async function Navbar() {
    const session = await auth();
    const isAuthed = !!session?.user;

    return (
        <Container size="lg" w="100%" h="100%">
            <Group h="100%" justify="space-between" wrap="nowrap">
                {/* Logo */}
                <Link href="/">
                    <Image
                        priority
                        src={logo}
                        alt="ISO logo"
                        style={{ height: "2.25rem", width: "auto" }}
                        width={100}
                        height={100}
                    />
                </Link>

                {/* Desktop nav links — hidden on mobile */}
                <Box visibleFrom="sm">
                    <NavLinks links={isAuthed ? authLinks : publicLinks} />
                </Box>

                {/* Right side: notification bell + avatar (desktop) or login button */}
                <Box visibleFrom="sm">
                    <Group gap="sm">
                        {isAuthed && <NotificationBell />}
                        <UserProfileButton session={session} />
                    </Group>
                </Box>

                {/* Mobile: search for signed-in users (the other sections are in
                    the bottom tab bar), login button otherwise */}
                <Box hiddenFrom="sm">
                    {isAuthed ? (
                        <MobileSearchButton />
                    ) : (
                        <LoginButton />
                    )}
                </Box>
            </Group>
        </Container>
    );
}
