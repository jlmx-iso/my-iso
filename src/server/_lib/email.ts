// Transactional email, sent through Cloudflare Email Service: the Worker's
// `send_email` binding named EMAIL (wrangler.toml, docs/DEPLOYMENT.md,
// "Email"). The binding is looked up per call, never held in the module.
//
// Without a binding (plain `next dev`, `next start`, unit tests) nothing is
// sent and the caller gets an "email not configured" error, as before. In
// local development only, the subject and a hash of the recipient are logged
// so a developer can see what would have gone out. Under `wrangler dev` the
// binding exists and is simulated by wrangler: nothing is delivered, and the
// message is written to a local file it names in its output.

import type { ExecutionContext, IncomingRequestCfProperties, SendEmail as EmailBinding } from "@cloudflare/workers-types";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { toPlainText } from "@react-email/render";

import { Result, logger } from "~/_utils";
import { env } from "~/env";
import { isCloudflareRuntime } from "~/server/_utils/clientIp";
import { hashEmail } from "~/server/_utils/hash";

import {
    renderWelcomeEmail,
    renderVerifyEmail,
    renderCompleteProfileEmail,
    renderUploadPortfolioEmail,
    renderFirstEventEmail,
    renderMakeConnectionEmail,
    renderCheckInEmail,
    renderInactiveEventsEmail,
    renderInactiveMissingEmail,
    renderInactiveLastChanceEmail,
    renderBookingAppliedEmail,
    renderBookingAcceptedEmail,
    renderBookingDeclinedEmail,
    renderBookingCompletedEmail,
    renderNewMessageEmail,
    renderReviewReceivedEmail,
    renderUpgradePitchEmail,
    renderInviteFriendsEmail,
    renderWaitlistApprovedEmail,
    renderWaitlistConfirmationEmail,
} from "./emails";

type SendEmail = {
    email: string;
    subject: string;
    html: string;
}

/**
 * Why a send failed. `code` is Email Service's error code (`E_...`, see
 * https://developers.cloudflare.com/email-service/api/send-emails/workers-api/),
 * or `E_NOT_CONFIGURED` when there is no binding. The message never contains
 * the recipient's address.
 */
type SendEmailError = Error & { code?: string };

export const EMAIL_NOT_CONFIGURED = "E_NOT_CONFIGURED";

/**
 * The recipient is on the account's suppression list (an earlier hard bounce
 * or complaint). Nothing about the app is broken and retrying will not help,
 * so it is logged as a warning, not as a fault.
 */
export const EMAIL_RECIPIENT_SUPPRESSED = "E_RECIPIENT_SUPPRESSED";

/** True when `error` says the recipient is suppressed (see above). */
export function isRecipientSuppressed(error: unknown): boolean {
    return error instanceof Error && (error as SendEmailError).code === EMAIL_RECIPIENT_SUPPRESSED;
}

/** The EMAIL binding, or null where there is none (`next dev`, tests). */
export function emailBinding(): EmailBinding | null {
    try {
        return getCloudflareContext<IncomingRequestCfProperties, ExecutionContext>().env.EMAIL ?? null;
    } catch {
        return null;
    }
}

function emailError(message: string, code: string): SendEmailError {
    return Object.assign(new Error(message), { code });
}

/** Email Service's code on a thrown error, if it has one. */
function errorCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("code" in error)) return undefined;
    const { code } = error;
    return typeof code === "string" && /^E_[A-Z_]+$/.test(code) ? code : undefined;
}

function isLocalDevelopment(): boolean {
    return env.NODE_ENV === "development" && !isCloudflareRuntime();
}

/**
 * Sends one email, HTML with a plain-text part derived from it.
 *
 * @returns Result.ok when Email Service accepted the message; Result.err
 * when there is no binding, or with the service's error code when it refused
 * the message. Never throws.
 */
export const sendEmail = async (
    { email, subject, html }: SendEmail,
    binding: EmailBinding | null = emailBinding(),
): Promise<Result<{ success: boolean }, SendEmailError>> => {
    if (!binding) {
        if (isLocalDevelopment()) {
            // Development only: the subject can hold a sign-in code.
            logger.info("Email not sent: no EMAIL binding in local development", {
                recipient: await hashEmail(email),
                subject,
            });
        }
        return Result.err(emailError(
            "Email is not configured: there is no EMAIL send_email binding (docs/DEPLOYMENT.md).",
            EMAIL_NOT_CONFIGURED,
        ));
    }

    try {
        await binding.send({ from: env.EMAIL_FROM, html, subject, text: toPlainText(html), to: email });
        return Result.ok({ success: true });
    } catch (error: unknown) {
        // The service's own message can name the address: keep only its code.
        const code = errorCode(error) ?? "E_UNKNOWN";
        const metadata = { code, recipient: await hashEmail(email) };
        if (code === EMAIL_RECIPIENT_SUPPRESSED) {
            logger.warn("Email not sent: the recipient is suppressed", metadata);
        } else {
            logger.error("Email Service refused a message", metadata);
        }
        return Result.err(emailError(`Email Service refused the message (${code})`, code));
    }
}

// ---------------------------------------------------------------------------
// Template registry — maps template names to their render functions
// ---------------------------------------------------------------------------

const templateRenderers = {
    welcome: renderWelcomeEmail,
    "verify-email": renderVerifyEmail,
    "complete-profile": renderCompleteProfileEmail,
    "upload-portfolio": renderUploadPortfolioEmail,
    "first-event": renderFirstEventEmail,
    "make-connection": renderMakeConnectionEmail,
    "check-in": renderCheckInEmail,
    "inactive-events": renderInactiveEventsEmail,
    "inactive-missing": renderInactiveMissingEmail,
    "inactive-last-chance": renderInactiveLastChanceEmail,
    "booking-applied": renderBookingAppliedEmail,
    "booking-accepted": renderBookingAcceptedEmail,
    "booking-declined": renderBookingDeclinedEmail,
    "booking-completed": renderBookingCompletedEmail,
    "new-message": renderNewMessageEmail,
    "review-received": renderReviewReceivedEmail,
    "upgrade-pitch": renderUpgradePitchEmail,
    "invite-friends": renderInviteFriendsEmail,
    "waitlist-approved": renderWaitlistApprovedEmail,
    "waitlist-confirmation": renderWaitlistConfirmationEmail,
} satisfies Record<string, (props: never) => Promise<string>>;

export type TemplateName = keyof typeof templateRenderers;

/** The props the template `T` renders with. */
export type TemplateProps<T extends TemplateName> = Parameters<(typeof templateRenderers)[T]>[0];

function isTemplateName(name: string): name is TemplateName {
    return Object.hasOwn(templateRenderers, name);
}

type SendTemplateEmail<T extends TemplateName> = {
    email: string;
    subject: string;
    template: T;
    props: TemplateProps<T>;
};

/**
 * Send a template-based email using React Email templates.
 *
 * Renders the specified template with the given props, then sends it with
 * `sendEmail`.
 *
 * @param email     - Recipient email address
 * @param subject   - Email subject line
 * @param template  - Template name (e.g. "welcome", "booking-applied")
 * @param props     - Props of that template
 *
 * @returns Result.ok if sent, Result.err on render or send failure
 */
export const sendTemplateEmail = async <T extends TemplateName>({
    email,
    subject,
    template,
    props,
}: SendTemplateEmail<T>): Promise<Result<{ success: boolean }, SendEmailError>> => {
    // Checked at run time too: a name can come from untyped data (drip steps).
    const name: string = template;
    if (!isTemplateName(name)) {
        return Result.err(new Error(
            `Unknown email template: "${name}". ` +
            `Available templates: ${Object.keys(templateRenderers).join(", ")}`
        ));
    }
    try {
        // TypeScript cannot relate the lookup to T; `props` is typed by it.
        const renderer = templateRenderers[template] as (props: TemplateProps<T>) => Promise<string>;
        logger.debug("Rendering email template", { template });
        const html = await renderer(props);
        return await sendEmail({ email, subject, html });
    } catch (error: unknown) {
        logger.error("Failed to render email template", { error, template });
        return Result.err(error instanceof Error ? error : new Error(String(error)));
    }
};
