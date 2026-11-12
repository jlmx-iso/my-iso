"use client";
import { AppShell as MantineAppShell } from "@mantine/core";
import { usePathname } from "next/navigation";

import { isAppPath } from "./nav/appPath";

type AppShellProps = {
    header: React.ReactNode;
    /** Phone tab bar; only rendered inside the signed-in app. */
    bottomNav?: React.ReactNode;
    /** Footer for the public marketing pages. */
    marketingFooter: React.ReactNode;
    /** Slim footer for the signed-in app. */
    appFooter: React.ReactNode;
    /** The consent banner: right after the skip link in the tab order. */
    consent?: React.ReactNode;
    children: React.ReactNode;
};

const TAB_BAR_HEIGHT = "calc(var(--tab-bar-height) + env(safe-area-inset-bottom, 0px))";

export default function AppShell({ children, header, bottomNav, marketingFooter, appFooter, consent }: AppShellProps) {
    const pathname = usePathname();
    const inApp = isAppPath(pathname);
    // Not during onboarding: every tab would bounce straight back to it.
    const showBottomNav = inApp && !!bottomNav && !pathname.startsWith("/app/onboarding");

    return (
        <MantineAppShell
            header={{ height: 60 }}
            footer={{ height: { base: showBottomNav ? TAB_BAR_HEIGHT : 0, sm: 0 } }}
            padding="md"
        >
            <a href="#main-content" className="skip-link">
                Skip to content
            </a>
            {consent && <div data-above-tab-bar={showBottomNav ? "true" : "false"}>{consent}</div>}
            <MantineAppShell.Header withBorder={false}>
                {header}
            </MantineAppShell.Header>
            {showBottomNav && (
                <MantineAppShell.Footer hiddenFrom="sm" withBorder={false}>
                    {bottomNav}
                </MantineAppShell.Footer>
            )}
            <MantineAppShell.Main
                id="main-content"
                tabIndex={-1}
                style={{ display: "flex", flexDirection: "column", outline: "none" }}
            >
                <div style={{ flex: 1, minWidth: 0 }}>{children}</div>
                {inApp ? appFooter : marketingFooter}
            </MantineAppShell.Main>
        </MantineAppShell>
    );
}
