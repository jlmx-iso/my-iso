import { type User } from "@prisma/client";
import { db } from "~/server/db";
import { logger, Result } from "~/_utils";
import { UserVerificationErrors } from "~/_types/errors";


type CreateUserInput = {
    provider: "email" | "google" | "facebook";
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    companyName: string;
    location: string;
    website?: string;
    twitter?: string;
    instagram?: string;
    facebook?: string;
    youtube?: string;
    tiktok?: string;
    vimeo?: string;
};

const findUser = async (email: string) => {
    return db.user.findFirst({
        where: {
            email,
        },
    });
}

export const createUser = async (input: CreateUserInput): Promise<Result<User>> => {
    try {
        const user = await findUser(input.email);
        if (user?.id) {
            logger.error("User already exists", { user });
            return Result.err(new Error("User already exists"));
        }
    } catch (error: unknown) {
        logger.error("Error finding user", { error });
        return Result.err(new Error("Error finding user"));
    }
    const user = await db.user.create({
        data: {
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            phone: input.phone,
            accounts: {
                create: [
                    {
                        type: "email",
                        provider: input.provider,
                        providerAccountId: input.email,
                    }
                ],
            },
            photographer: {
                create: {
                    name: input.firstName + " " + input.lastName,
                    companyName: input.companyName,
                    location: input.location,
                    website: input.website,
                    twitter: input.twitter,
                    instagram: input.instagram,
                    facebook: input.facebook,
                    youtube: input.youtube,
                    tiktok: input.tiktok,
                    vimeo: input.vimeo,
                }
            },
        },
    }).then(
        (user: User) => {
            logger.info("YO!!!! User registered successfully", { user });
            return user;
        }
    ).catch((error: unknown) => {
        logger.error("Error registering user", { error });
        return new Error("Error registering user");
    });
    if ("email" in user) {
        return Result.ok(user);
    }
    return Result.err(user);
}

export const verifyUserEmail = async (token: string): Promise<Result<User["id"]>> => {
    try {
        const verificationToken = await db.verificationToken.findFirst({
            where: {
                token,
            },
        });
        if (!verificationToken) {
            logger.error(UserVerificationErrors.TOKEN_NOT_FOUND);
            return Result.err(new Error(UserVerificationErrors.TOKEN_NOT_FOUND));
        }
        if (verificationToken.expires < new Date()) {
            logger.error(UserVerificationErrors.TOKEN_EXPIRED, { userId: verificationToken.identifier });
            return Result.err(new Error(UserVerificationErrors.TOKEN_EXPIRED));
        }
        let user = await db.user.findFirst({
            where: {
                id: verificationToken.identifier,
            },
        });
        if (!user) {
            logger.error(UserVerificationErrors.USER_NOT_FOUND, { userId: verificationToken.identifier });
            return Result.err(new Error(UserVerificationErrors.USER_NOT_FOUND));
        }
        if (user.emailVerified) {
            logger.error(UserVerificationErrors.USER_ALREADY_VERIFIED, { user });
            return Result.err(new Error(UserVerificationErrors.USER_ALREADY_VERIFIED));
        }
        user = await db.user.update({
            where: {
                id: user.id,
            },
            data: {
                emailVerified: new Date(),
            },
        });
        return Result.ok(user.id);
    } catch (error: unknown) {
        logger.error("HI THERE Error verifying email", { error });
        return Result.err(new Error("Error verifying email"));
    }
}