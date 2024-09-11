import { Container } from "@mantine/core";

export default function AppLayout({ children }: { children: React.ReactNode }) {
    return (
        <Container maw={1200} w="100%" px="2em" py="2em">
            {children}
        </Container>
    );
}