import { db } from "~/server/db";
import { verifyPassword } from "./_utils/crypto";
import { logger } from "~/_utils";

export const authorizeUser = async (credentials: { username: string; password: string; }) => {
  logger.info("Authorizing user", credentials)
  const user = await db.user.findFirst({
    where: {
      email: credentials.username,
    },
    include: {
      accounts: true,
    },
  });

  if (!user) {
    logger.info("No user found");
    return null;
  }

  logger.info("User found", user);

  const account = user.accounts[0];

  logger.info("Account found", account);

  if (!account?.password) {
    return null;
  }

  const isPasswordValid = await verifyPassword(account.password, credentials.password);

  if (!isPasswordValid) {
    return null;
  }

  return {
    id: user.id,
    firstName: user.firstName,
    lastName: user.lastName,
    email: user.email,
  };
};

export const checkIfUserExists = async (email: string) => {
  const user = await db.user.findFirst({
    where: {
      email,
    },
  });

  logger.info("Checking if user exists", {userExists: !!user});

  return !!user;
}