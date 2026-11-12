import "~/styles/globals.css";
import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';

import { ColorSchemeScript } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";

import { auth } from "~/auth";
import { TRPCReactProvider } from "~/trpc/react";

import { REVEAL_SCRIPT } from "./_components/animations/revealScript";
import AppShell from "./_components/AppShell";
import { AppFooter, Footer } from "./_components/Footer";
import BottomTabBar from "./_components/nav/BottomTabBar";
import { Navbar } from "./_components/NavBar";
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL, defaultOpenGraph } from "./_lib/siteMetadata";
import { CSPostHogProvider } from './providers';
import { ThemeProvider } from "./theme/ThemeProvider";



const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: {
    default: "ISO — Find second shooters and photography gigs",
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  metadataBase: new URL(SITE_URL),
  openGraph: {
    ...defaultOpenGraph,
    title: "ISO — The Photographer Network",
    description: SITE_DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "ISO — The Photographer Network",
    description:
      "Find skilled second shooters for weddings, events, and sessions.",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // Let the page draw under the notch/home indicator; the tab bar and sheets
  // pad themselves with env(safe-area-inset-*).
  viewportFit: "cover",
  // Shrink the layout (not just the visual viewport) when the on-screen
  // keyboard opens, so the message composer stays in view.
  interactiveWidget: "resizes-content",
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAuthed = !!session?.user;

  return (
    // The app is light-only. The colour scheme attribute is in the server HTML
    // (not just set by ColorSchemeScript) because Mantine's colour variables
    // hang off it: without it, a page viewed with JavaScript off has no
    // button or badge colours.
    <html
      lang="en"
      className={inter.variable}
      data-mantine-color-scheme="light"
      data-scroll-behavior="smooth"
      suppressHydrationWarning
    >
      <head>
        <ColorSchemeScript forceColorScheme="light" />
        <script dangerouslySetInnerHTML={{ __html: REVEAL_SCRIPT }} />
      </head>
      <body>
        <CSPostHogProvider>
          <ThemeProvider>
            {/* Top of the screen: clear of the phone tab bar and of the buttons
                at the bottom of dialogs (offsets in globals.css). */}
            <Notifications position="top-center" limit={3} containerWidth={440} zIndex={1000} />
            <TRPCReactProvider>
              <AppShell
                header={<Navbar />}
                bottomNav={isAuthed ? <BottomTabBar /> : undefined}
                marketingFooter={<Footer />}
                appFooter={<AppFooter />}
              >
                {children}
              </AppShell>
            </TRPCReactProvider>
          </ThemeProvider>
        </CSPostHogProvider>
      </body>
    </html>
  );
}
