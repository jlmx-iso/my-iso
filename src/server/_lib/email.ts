import { Resend } from "resend";

import { Result, logger } from "~/_utils";
import { env } from "~/env";

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
    renderReferralInviteEmail,
} from "./emails";

type SendEmail = {
    email: string;
    subject: string;
    html: string;
}

type SendEmailError = Error & { errorCode?: number };

/**
 * Resend client - edge compatible email service
 *
 * SETUP REQUIRED:
 * 1. Sign up at https://resend.com
 * 2. Get your API key from dashboard
 * 3. Set RESEND_API_KEY environment variable
 * 4. Verify your sending domain (required for production)
 *
 * IMPACT IF NOT CONFIGURED:
 * - User registration will fail (can't send verification emails)
 * - Password reset won't work
 * - No transactional emails will be sent
 *
 * ALTERNATIVES:
 * - Implement admin-approval flow instead of email verification
 * - Use a different edge-compatible email service
 * - Disable email features temporarily for development
 */
const resend = env.RESEND_API_KEY ? new Resend(env.RESEND_API_KEY) : null;

/**
 * Send email using Resend (edge-compatible)
 * Migrated from Postmark for Cloudflare Workers compatibility
 *
 * @returns Result.ok if sent successfully, Result.err if RESEND_API_KEY not set or send fails
 */
export const sendEmail = async ({ email, subject, html }: SendEmail): Promise<Result<{ success: boolean }, SendEmailError>> => {
    try {
        if (!resend) {
            const error = new Error(
                "RESEND_API_KEY is not configured. " +
                "Email functionality is disabled. " +
                "See src/server/_lib/email.ts for setup instructions."
            ) as SendEmailError;
            return Result.err(error);
        }

        const response = await resend.emails.send({
            from: env.EMAIL_FROM,
            to: email,
            subject: subject,
            html: html,
        });

        if (response.error) {
            const error = new Error(response.error.message) as SendEmailError;
            return Result.err(error);
        }

        return Result.ok({ success: true });
    } catch (error: unknown) {
        return Result.err(error as Error);
    }
}

// ---------------------------------------------------------------------------
// Template registry — maps template names to their render functions
// ---------------------------------------------------------------------------

/* eslint-disable @typescript-eslint/no-explicit-any */
const templateRenderers: Record<string, (props: any) => Promise<string>> = {
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
    "referral-invite": renderReferralInviteEmail,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

export type TemplateName = keyof typeof templateRenderers;

type SendTemplateEmail = {
    email: string;
    subject: string;
    template: string;
    props: Record<string, unknown>;
};

/**
 * Send a template-based email using React Email templates.
 *
 * Renders the specified template with the given props, then sends
 * via the existing Resend transport.
 *
 * @param email     - Recipient email address
 * @param subject   - Email subject line
 * @param template  - Template name (e.g. "welcome", "booking-applied")
 * @param props     - Props to pass to the React Email template component
 *
 * @returns Result.ok if sent, Result.err on render or send failure
 */
export const sendTemplateEmail = async ({
    email,
    subject,
    template,
    props,
}: SendTemplateEmail): Promise<Result<{ success: boolean }, SendEmailError>> => {
    try {
        const renderer = templateRenderers[template];
        if (!renderer) {
            const error = new Error(
                `Unknown email template: "${template}". ` +
                `Available templates: ${Object.keys(templateRenderers).join(", ")}`
            ) as SendEmailError;
            return Result.err(error);
        }

        logger.debug("Rendering email template", { template, email });
        const html = await renderer(props);

        return sendEmail({ email, subject, html });
    } catch (error: unknown) {
        logger.error("Failed to render email template", {
            template,
            email,
            error: error instanceof Error ? error.message : String(error),
        });
        return Result.err(error as Error);
    }
};
