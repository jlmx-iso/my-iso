import { pageMetadata } from "~/app/_lib/siteMetadata";

export const metadata = pageMetadata({
  description:
    "Request an invite to ISO — the photographer second shooter network. Be first to connect with photographers in Austin, Denver, and more.",
  path: "/waitlist",
  socialTitle: "Join the ISO Waitlist",
  title: "Join the Waitlist",
});

export default function WaitlistLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
