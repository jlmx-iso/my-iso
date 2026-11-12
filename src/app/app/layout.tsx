import { Container } from "@mantine/core";
import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { auth } from "~/auth";
import { api } from "~/trpc/server";

import { OnboardingCheck } from "./_components/OnboardingCheck";
import { Providers } from "./providers";

// The signed-in app is private: keep it out of search results.
export const metadata: Metadata = {
    robots: { follow: false, index: false },
};

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    // Defence in depth: the middleware already redirects anonymous visitors.
    if (!session?.user) redirect("/login");

    const caller = await api();
    const photographer = await caller.photographer.getByUserId({ userId: session.user.id });
    const needsOnboarding = !photographer;

    return (
        // The app shell already pads the page; no extra gutter on phones.
        <Container maw={1200} w="100%" px={{ base: 0, sm: "md" }}>
            <Providers params={{ session }}>
                <OnboardingCheck needsOnboarding={needsOnboarding}>
                    {children}
                </OnboardingCheck>
            </Providers>
        </Container>
    );
}
