"use client";
import { Button } from "@mantine/core";
import Link from "next/link";
import { usePathname } from "next/navigation";

/** Header log-in button; pointless on the login page itself. */
export const LoginButton = () => {
    const pathname = usePathname();
    if (pathname === "/login") return null;

    return (
        <Button component={Link} href="/login" miw={80}>
            Log in
        </Button>
    );
};
