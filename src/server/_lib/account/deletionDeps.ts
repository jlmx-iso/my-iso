// The real outside world for account deletion: Stripe, Cloudinary, the chat
// rooms, PostHog and Cloudflare Email Service. Tests pass their own DeletionDeps; these are
// what the app and the job use.

import { env } from "~/env";
import { endBillingForClosedAccount } from "~/server/_billing/accountClosure";
import { getStripe } from "~/server/_billing/stripe";
import { emailBinding, isRecipientSuppressed, sendEmail } from "~/server/_lib/email";
import { renderAccountDeletedEmail } from "~/server/_lib/emails/account-deleted";

import { deleteCloudinaryImages } from "./cloudinaryDelete";
import type { DeletionDeps } from "./deletion";
import { erasePostHogPerson } from "./posthogErasure";
import { revokeRealtimeAccess } from "./realtime";

/** Whether the confirmation email can be sent at all (the EMAIL binding exists). */
export function canSendDeletionEmail(): boolean {
  return emailBinding() !== null;
}

export const accountDeletionDeps: DeletionDeps = {
  deleteImages: async (urls) => {
    await deleteCloudinaryImages(urls, {
      apiKey: env.CLOUDINARY_API_KEY,
      apiSecret: env.CLOUDINARY_API_SECRET,
      cloudName: env.CLOUDINARY_CLOUD_NAME,
    });
  },
  endBilling: (subscriptionId) => endBillingForClosedAccount(getStripe(), subscriptionId),
  eraseAnalytics: (userId) => erasePostHogPerson(userId),
  revokeRealtime: async (userId, threadIds) => {
    await revokeRealtimeAccess(userId, threadIds);
  },
  sendConfirmation: async ({ email, firstName }) => {
    // Loaded here: ~/_lib/site needs the public URL, which the jobs route
    // does not otherwise read.
    const { SUPPORT_EMAIL } = await import("~/_lib/site");
    const html = await renderAccountDeletedEmail({ firstName, supportEmail: SUPPORT_EMAIL });
    const result = await sendEmail({ email, html, subject: "Your ISO account has been deleted" });
    // A suppressed address is the recipient's mailbox, not a fault here;
    // sendEmail has logged it as a warning.
    if (result.isErr && !isRecipientSuppressed(result.error)) throw result.error;
  },
};
