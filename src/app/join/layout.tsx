import { pageMetadata } from "~/app/_lib/siteMetadata";

export const metadata = pageMetadata({
  description:
    "Join ISO — the invite-only photographer network. Connect with second shooters for weddings, events, and sessions in Austin, Denver, and beyond.",
  path: "/join",
  socialTitle: "Join ISO — The Photographer Network",
  title: "Join ISO",
});

export default function JoinLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
