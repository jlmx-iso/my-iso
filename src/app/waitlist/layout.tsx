import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Join the Waitlist",
  description:
    "Request an invite to ISO — the photographer second shooter network. Be first to connect with photographers in Austin, Denver, and more.",
  openGraph: {
    title: "Join the ISO Waitlist",
    description:
      "Request early access to the photographer network connecting leads with second shooters.",
  },
};

export default function WaitlistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
