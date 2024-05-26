import "~/styles/globals.css";
import '@mantine/core/styles.css';

import { MantineProvider, ColorSchemeScript, Center } from '@mantine/core';
import { Inter } from "next/font/google";
import { cookies } from "next/headers";

import { TRPCReactProvider } from "~/trpc/react";
import { Navbar } from "~/app/_server_components";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
});

export const metadata = {
  title: "ISO",
  description: "The Photographer Second Shooter Network",
  icons: [{ rel: "icon", url: "/favicon.ico" }],
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
        <MantineProvider>
          <TRPCReactProvider cookies={cookies().toString()}>
            <header>
              <Navbar />
            </header>
            <Center>
              {children}
            </Center>
          </TRPCReactProvider>
        </MantineProvider>
      </body>
    </html>
  );
}
