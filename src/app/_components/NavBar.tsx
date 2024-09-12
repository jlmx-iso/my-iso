import { Container, Divider, Group, NavLink, Stack } from "@mantine/core";
import { IconLogout, IconSettings, IconUser } from "@tabler/icons-react";
import Image from "next/image";
import Link from "next/link";

import { UserProfileButton } from "./buttons/UserProfileButton";
import logo from "../../../public/img/logo.webp"

import colors from "~/app/theme/colors";
import { getServerAuthSession } from "~/server/auth";


export async function Navbar() {
  const session = await getServerAuthSession();

  return (
    <Container
      size="lg"
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "space-between",
        paddingBottom: "1rem",
        paddingTop: "1rem",
      }}
      w="100%"
    >
      <Group w="100%">
        <Link href="/" style={{ paddingRight: 60 }}>
          <Image
            priority={true}
            src={logo}
            alt="ISO logo"
            style={{ height: "3rem", width: "auto" }}
            width={100}
            height={100}
          />
        </Link>
        {session?.user && (
          <>
            <Link href="/app/events">Events</Link>
            <Link href="/app/messages">Messages</Link>
          </>
        )}
      </Group>
      <UserProfileButton session={session} />
    </Container>
  );
}

export async function MobileNav() {
  const session = await getServerAuthSession();

  return (
    <Container
      size="lg"
      style={{
        alignItems: "center",
        display: "flex",
        justifyContent: "space-between",
        position: "fixed",
      }}
      w="100vw"
    >
      <Stack>
        <NavLink href="/" label="Home" />
        {session?.user && (
          <>
            <NavLink href="/app/events" label="Events" />
            <NavLink href="/app/messages" label="Messages" />
            <Divider />
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
              component={Link}
              label="Log Out"
              leftSection={<IconLogout color={colors.orange![4]} />}
              href="/api/auth/signout"
            />
          </>
        )}
      </Stack>
    </Container>
  );
}