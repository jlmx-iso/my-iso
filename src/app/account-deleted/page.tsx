import type { Metadata } from "next";

import AccountDeletedNotice from "~/app/_components/AccountDeletedNotice";
import { canSendDeletionEmail } from "~/server/_lib/account/deletionDeps";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Account deleted",
};

type PageProps = { searchParams: Promise<{ pending?: string | string[] }> };

export default async function AccountDeletedPage({ searchParams }: PageProps) {
  const { pending } = await searchParams;
  return <AccountDeletedNotice confirmationEmail={canSendDeletionEmail()} pending={pending === "1"} />;
}
