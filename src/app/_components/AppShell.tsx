"use client";
import { Burger, Center, Group, AppShell as MantineAppShell } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";

type AppShellProps = {
    navbar: React.ReactNode;
    mobileNav: React.ReactNode;
    children: React.ReactNode;
};

export default function AppShell({ children, navbar, mobileNav }: AppShellProps) {
    const [opened, { toggle }] = useDisclosure();
    return (
        <MantineAppShell
            header={{ height: { base: 0, sm: 60 } }}
            navbar={{ breakpoint: 'sm', collapsed: { desktop: true, mobile: !opened }, width: 300 }}
            padding="md"
        >
            <MantineAppShell.Header withBorder={false}>
                <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" m="sm" />
                <Group visibleFrom="sm">
                    {navbar}
                </Group>
            </MantineAppShell.Header>
            <MantineAppShell.Navbar py={0} px={4} mt="3em">
                {mobileNav}
            </MantineAppShell.Navbar>
            <Center>
                {children}
            </Center>
        </MantineAppShell>
    );
}