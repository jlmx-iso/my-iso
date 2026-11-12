import { Box, Container, Group } from "@mantine/core";
import Image from "next/image";
import Link from "next/link";

import { auth } from "~/auth";

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

export async function Navbar() {
    const session = await auth();
    const user = session?.user
        ? { name: session.user.name ?? "Your account", profilePic: session.user.profilePic }
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
