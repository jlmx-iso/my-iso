import { logger, Result } from "~/_utils";
import { db } from "~/server/db";
import { generateVerificationCode } from "../_utils";

export const createVerificationToken = async ({ identifier, token }: { identifier: string; token?: string; }): Promise<Result<string>> => {
    if (!token) {
        token = generateVerificationCode();
    }
    try {
        const result = await db.verificationToken.create({
            data: {
                token,
                identifier,
                expires: new Date(Date.now() + 1000 * 60 * 60 * 24), // 24 hours
            },
        });
        return Result.ok(result.token);
    } catch (error: unknown) {
        logger.error("Error creating verification token", { error });
        return Result.err(new Error("Error creating verification token"));
    }
};