import "~/styles/globals.css";
import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/dates/styles.css';
import '@mantine/notifications/styles.css';

import { ColorSchemeScript } from '@mantine/core';
import { Notifications } from '@mantine/notifications';
import { Inter } from "next/font/google";

import { SITE_URL } from "~/_lib/site";
import { auth } from "~/auth";
import { TRPCReactProvider } from "~/trpc/react";

import AppShell from "./_components/AppShell";
import { Footer } from "./_components/Footer";
import BottomTabBar from "./_components/nav/BottomTabBar";
import { Navbar } from "./_components/NavBar";
import { CSPostHogProvider } from './providers';
import { ThemeProvider } from "./theme/ThemeProvider";



const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata = {
  title: { default: "ISO", template: "%s | ISO" },
  description: "The Photographer Second Shooter Network",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    images: [
      {
        alt: "ISO — The Photographer Network",
        height: 630,
        url: "/api/og?title=ISO&subtitle=The+Photographer+Network",
        width: 1200,
      },
    ],
    type: "website",
    locale: "en_US",
    siteName: "ISO",
    title: "ISO — The Photographer Network",
    description:
      "Find skilled second shooters for weddings, events, and sessions. Build your team, grow your network.",
  },
  twitter: {
    card: "summary_large_image",
    title: "ISO — The Photographer Network",
    description:
      "Find skilled second shooters for weddings, events, and sessions.",
  },
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAuthed = !!session?.user;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <CSPostHogProvider
          user={
            session?.user
              ? { email: session.user.email, id: session.user.id, name: session.user.name }
              : null
          }
        >
          <ThemeProvider>
            <Notifications position="top-center" />
            <TRPCReactProvider>
              <AppShell
                header={<Navbar />}
                bottomNav={isAuthed ? <BottomTabBar /> : undefined}
                footer={<Footer />}
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
