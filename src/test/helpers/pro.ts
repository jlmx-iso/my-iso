import type { TestDb } from "./sqlite";

const LEGACY_FLAGS = {
  isActive: true,
  isCanceled: false,
  isExpired: false,
  isPaused: false,
  isPending: false,
  isTrial: false,
} as const;

/**
 * Gives `userId` a settled, active Pro subscription row: one `proProcedure`
 * accepts without asking Stripe (it has been read from Stripe, as far as
 * the row says), and that the Pro badge and search placement count.
 */
export async function makePro(db: TestDb["db"], userId: string, overrides: { status?: string; cancelAt?: Date } = {}) {
  const now = new Date();
  return db.subscription.create({
    data: {
      ...LEGACY_FLAGS,
      cancelAt: overrides.cancelAt ?? null,
      cancelAtPeriodEnd: overrides.cancelAt !== undefined,
      isLifetime: false,
      standingSyncedAt: now,
      status: overrides.status ?? "active",
      stripeSyncedAt: now,
      subscriptionId: `sub_${userId}`,
      userId,
    },
  });
}
