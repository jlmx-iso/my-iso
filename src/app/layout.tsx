import "~/styles/globals.css";
import '@mantine/core/styles.css';
import '@mantine/carousel/styles.css';
import '@mantine/dropzone/styles.css';
import '@mantine/dates/styles.css';

import { Center, ColorSchemeScript, MantineProvider } from '@mantine/core';
import { Analytics } from "@vercel/analytics/react"
import { SpeedInsights } from "@vercel/speed-insights/next"
import { Inter } from "next/font/google";
import { cookies } from "next/headers";

import AppShell from "./_components/AppShell";
import { MobileNav, Navbar } from "./_components/NavBar";
import { CSPostHogProvider } from './providers';
import theme from "./theme";

import { TRPCReactProvider } from "~/trpc/react";


const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata = {
  description: "The Photographer Second Shooter Network",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
  title: "ISO",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookieStore = await cookies();

  return (
    <html lang="en">
      <head>
        <ColorSchemeScript />
      </head>
      <body className={`font-sans ${inter.variable}`}>
        <CSPostHogProvider>
          <MantineProvider theme={theme}>
            <TRPCReactProvider cookies={cookieStore.toString()}>
              <AppShell navbar={<Navbar />} mobileNav={<MobileNav />}>
                <Center py={96} w="100%">
                  {children}
                </Center>
              </AppShell>
            </TRPCReactProvider>
          </MantineProvider>
        </CSPostHogProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
