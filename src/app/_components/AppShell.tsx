"use client";
import { AppShell as MantineAppShell } from "@mantine/core";

type AppShellProps = {
    header: React.ReactNode;
    bottomNav?: React.ReactNode;
    footer?: React.ReactNode;
    children: React.ReactNode;
};

export default function AppShell({ children, header, bottomNav, footer }: AppShellProps) {
    return (
        <MantineAppShell
            header={{ height: 60 }}
            footer={{ height: { base: bottomNav ? 60 : 0, sm: 0 } }}
            padding="md"
        >
            <MantineAppShell.Header withBorder={false}>
                {header}
            </MantineAppShell.Header>
            {bottomNav && (
                <MantineAppShell.Footer hiddenFrom="sm">
                    {bottomNav}
                </MantineAppShell.Footer>
            )}
            <MantineAppShell.Main>
                {children}
                {footer}
            </MantineAppShell.Main>
        </MantineAppShell>
    );
}
