"use client";
import { Button } from "@mantine/core";
import { signOut } from "next-auth/react";

export const LogoutButton = () => {
    return (
        <Button onClick={() => signOut()}>
            Log Out
        </Button>
    );
}