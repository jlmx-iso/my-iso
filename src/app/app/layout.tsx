import { Container } from "@mantine/core";

import { OnboardingCheck } from "./_components/OnboardingCheck";
import { Providers } from "./providers";

import { auth } from "~/auth";
import { api } from "~/trpc/server";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();

    let needsOnboarding = false;
    if (session?.user?.id) {
        const caller = await api();
        const photographer = await caller.photographer.getByUserId({ userId: session.user.id });
        needsOnboarding = !photographer;
    }

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
