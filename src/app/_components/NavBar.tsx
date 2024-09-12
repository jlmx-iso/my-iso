import { Container, Group } from "@mantine/core";
import Image from "next/image";
import Link from "next/link";


import { UserProfileButton } from "./buttons/UserProfileButton";
import logo from "../../../public/img/logo.webp"

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
    >
      <Group>
        <Link href="/">
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