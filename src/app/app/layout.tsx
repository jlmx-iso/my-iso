import { Container } from "@mantine/core";

import { Providers } from "./providers";

import { getServerAuthSession } from "~/server/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
    const session = await getServerAuthSession();
    return (
        <Container maw={1200} w="100%" px="2em">
            <Providers params={{ session }}>
                {children}
            </Providers>
        </Container>
    );
}