import Link from "next/link";
import { Container, Group } from "@mantine/core";
import { getServerAuthSession } from "~/server/auth";
import Image from "next/image";
import logo from "../../../public/img/logo.webp"
import { UserProfileButton } from "../_components/buttons/UserProfileButton";

export async function Navbar() {
  const session = await getServerAuthSession();

  return (
    <Container
      size="lg"
      style={{
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        paddingTop: "1rem",
        paddingBottom: "1rem",
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
        <Link href="/">Home</Link>
        <Link href="/pricing">Pricing</Link>
        <Link href="/about">About</Link>
        <Link href="/contact">Contact</Link>
      </Group>
      <UserProfileButton session={session} />
    </Container>
  );
}