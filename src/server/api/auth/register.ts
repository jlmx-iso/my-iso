import { type User } from "@prisma/client"
import { db } from "~/server/db"
import { hashPassword } from "./_utils/crypto";
import { logger, Result } from "~/_utils";
import { type FormattedUser, formatUser } from "./_utils";

type UserDetails = Pick<User, "email" | "firstName" | "lastName" | "phone"> & { password: string }

export const registerUser = async (userDetails: UserDetails): Promise<Result<FormattedUser, {message: string, error: Error}>> => {
  // hash the password
  // save the account
  // save the user
  // return the user details

  const hashedPassword = await hashPassword(userDetails.password);

  if (hashedPassword.isErr) {
    logger.error("Failed to hash password", { error: hashedPassword.error });
    return Result.err({ message: "Failed to hash password", error: hashedPassword.error });
  }

  let user: User;
  try {
    user = await db.user.create({
      data: {
        email: userDetails.email,
        firstName: userDetails.firstName,
        lastName: userDetails.lastName,
        phone: userDetails.phone,
      },
    });

  } catch (error) {
    logger.error("Failed to create user", { error });
    return Result.err({ message: "Failed to create user", error: error as Error});
  }

  try {
    await db.account.create({
      data: {
        password: hashedPassword.value,
        userId: user.id,
        type: "local",
        provider: "credentials",
        providerAccountId: user.email,
      },
    });
  } catch (error) {
    logger.error("Failed to create account", { error });
    return Result.err({ message: "Failed to create account", error: error as Error});
  }

  return Result.ok(formatUser(user));
}