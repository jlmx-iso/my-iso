"use client";
import { Button } from "@mantine/core";
import { signIn } from "next-auth/react";

export const LoginButton = () => {
    return (
        <Button onClick={() => signIn()}>
            Log In
        </Button>
    );
}