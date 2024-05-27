import { db } from "~/server/db";
import { logger } from "~/_utils";

export const checkIfUserExists = async (email: string) => {
  const user = await db.user.findFirst({
    where: {
      email,
    },
  });

  logger.info("Checking if user exists", { userExists: !!user });

  return !!user;
}

export const generateVerificationCode = (): string => {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}