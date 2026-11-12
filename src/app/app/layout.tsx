import { Container } from "@mantine/core";
import { redirect } from "next/navigation";

import { auth } from "~/auth";
import { api } from "~/trpc/server";

import { OnboardingCheck } from "./_components/OnboardingCheck";
import { Providers } from "./providers";


export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    // Defence in depth: the middleware already redirects anonymous visitors.
    if (!session?.user) redirect("/login");

    const caller = await api();
    const photographer = await caller.photographer.getByUserId({ userId: session.user.id });
    const needsOnboarding = !photographer;

    return (
        <Container maw={1200} w="100%" px="2em">
            <Providers params={{ session }}>
                <OnboardingCheck needsOnboarding={needsOnboarding}>
                    {children}
                </OnboardingCheck>
            </Providers>
        </Container>
    );
}
