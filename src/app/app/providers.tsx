"use client";

import { type Session } from "next-auth";
import { SessionProvider } from "next-auth/react";

export function Providers({ children, params: { session } }: { children: React.ReactNode, params: { session: Session | null } }) {
    return (
        <SessionProvider session={session}>
            {children}
        </SessionProvider>
    );
}