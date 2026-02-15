"use client";
import { Button } from "@mantine/core";
import Link from "next/link";

export const LoginButton = () => {
    return (
        <Button component={Link} href="/login" miw={80}>
            Log In
        </Button>
    );
};
