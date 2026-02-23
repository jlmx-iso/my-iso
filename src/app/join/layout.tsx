import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join ISO",
  description:
    "Join ISO — the invite-only photographer network. Connect with second shooters for weddings, events, and sessions in Austin, Denver, and beyond.",
  openGraph: {
    title: "Join ISO — The Photographer Network",
    description:
      "Join the invite-only network connecting lead photographers with skilled second shooters.",
  },
};

export default function JoinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
