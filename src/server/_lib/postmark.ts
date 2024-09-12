import { Client } from "postmark";

import { Result } from "~/_utils";
import { env } from "~/env";

type SendEmail = {
    email: string;
    subject: string;
    html: string;
}

type SendEmailError = Error & { errorCode?: number };

const client = new Client(env.POSTMARK_API_TOKEN);

export const sendEmail = async ({ email, subject, html }: SendEmail): Promise<Result<{ success: boolean }, SendEmailError>> => {
    try {
        const response = await client.sendEmail({
            From: env.EMAIL_FROM,
            HtmlBody: html,
            Subject: subject,
            To: email,
        });
        if (response.ErrorCode) {
            const error = new Error(response.Message) as SendEmailError;
            error.errorCode = response.ErrorCode;
            return Result.err(error);
        }
        return Result.ok({ success: true });
    } catch (error: unknown) {
        return Result.err(error as Error);
    }
}