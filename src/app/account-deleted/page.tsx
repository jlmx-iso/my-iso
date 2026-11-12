import type { Metadata } from "next";

import AccountDeletedNotice from "~/app/_components/AccountDeletedNotice";
import { canSendDeletionEmail } from "~/server/_lib/account/deletionDeps";

export const metadata: Metadata = {
  robots: { follow: false, index: false },
  title: "Account deleted",
};

export default function AccountDeletedPage() {
  return <AccountDeletedNotice confirmationEmail={canSendDeletionEmail()} />;
}
