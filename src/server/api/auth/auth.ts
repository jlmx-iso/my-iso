import { db } from "~/server/db";
import { verifyPassword } from "./_utils/crypto";

export const authorizeUser = async (credentials: { username: string; password: string; }) => {
  const user = await db.user.findFirst({
    where: {
      email: credentials.username,
    },
    include: {
      accounts: true,
    },
  });

  if (!user) {
    return null;
  }

  const account = user.accounts[0];

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
}