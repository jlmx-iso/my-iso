// using mantine ui library, this is the navbar component for the app homepage built in nextjs. 
// The logo is a link to the homepage and should be in the top left corner.
// If the user is signed out, they will see log in and sign up buttons.
// They will also see "Home", "Pricing", and "About" buttons.
// If the user is signed in, they will see "Home", "Pricing", "About", and "Dashboard" buttons.
// The navbar will also display the user's profile picture and name.
// The user can click on their profile picture to go to their dashboard.

import React from "react";
import Link from "next/link";
import { Avatar, Container, Group }  from "@mantine/core";
import { getServerAuthSession } from "~/server/auth";
import Image from "next/image";
import logo from "../../../public/img/logo.webp"
import { signIn } from "next-auth/react";

export default async function Navbar() {
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
      {!session?.user ? (
        <Link href="/login">
          Log in
        </Link>
      ) : (
        <Avatar
          src={session.user.profilePic}
          alt={session.user.firstName + " " + session.user.lastName}
          radius="xl"
          />
      )}
    </Container>
  );
}