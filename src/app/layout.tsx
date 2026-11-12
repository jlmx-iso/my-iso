import "~/styles/globals.css";
import '@mantine/core/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/dates/styles.css';

import { ColorSchemeScript } from '@mantine/core';
import { Inter } from "next/font/google";
import { cookies } from "next/headers";

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
  metadataBase: new URL("https://myiso.app"),
  alternates: {
    canonical: "/",
  },
  openGraph: {
    images: [
      {
        alt: "ISO — The Photographer Network",
        height: 630,
        url: "https://myiso.app/api/og?title=ISO&subtitle=The+Photographer+Network",
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
  const [cookieStore, session] = await Promise.all([cookies(), auth()]);
  const isAuthed = !!session?.user;

  return (
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <head>
        <ColorSchemeScript />
      </head>
      <body>
        <CSPostHogProvider>
          <ThemeProvider>
            <TRPCReactProvider cookies={cookieStore.toString()}>
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
