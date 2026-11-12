// Whether a session still belongs to a live account. Sessions are JWTs
// (Auth.js, 24 hours), so deleting an account cannot delete them: instead
// every session read asks this, and a deleted account's session ends at
// once (auth.ts, the `jwt` callback).

import { logger } from "~/_utils";
import type { ExtendedPrismaClient } from "~/server/_db/softDelete";

type UserLookup = Pick<ExtendedPrismaClient, "user">;

/**
 * False when the account is gone or being deleted (the soft-delete
 * extension hides a row with `isDeleted`, which is set the moment the
 * member asks: ./deletion.ts).
 *
 * A failed lookup answers true: a database blip must not sign everyone out.
 * The cost is that a session of an account deleted at that very moment
 * survives until the next successful check.
 */
export async function isAccountActive(db: UserLookup, userId: string): Promise<boolean> {
  try {
    return (await db.user.findUnique({ select: { id: true }, where: { id: userId } })) !== null;
  } catch (error) {
    logger.warn("Could not check whether the session's account is active", { error });
    return true;
  }
}
