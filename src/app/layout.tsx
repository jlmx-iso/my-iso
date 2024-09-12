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

import { CSPostHogProvider } from './providers';
import theme from "./theme";

import { Navbar } from "~/app/_components/NavBar";
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

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <ColorSchemeScript />
      </head>
      <body className={`font-sans ${inter.variable}`}>
        <CSPostHogProvider>
          <MantineProvider theme={theme}>
            <TRPCReactProvider cookies={cookies().toString()}>
              <header>
                <Navbar />
              </header>
              <Center>
                {children}
              </Center>
            </TRPCReactProvider>
          </MantineProvider>
        </CSPostHogProvider>
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
