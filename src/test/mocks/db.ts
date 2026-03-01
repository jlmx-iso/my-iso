import { vi } from "vitest";

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function makeMockDb() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db: any = {
    user: {
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    verificationToken: {
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    waitlist: {
      count: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      upsert: vi.fn(),
    },
    subscription: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    pendingInviteValidation: {
      upsert: vi.fn(),
    },
    $transaction: vi.fn(),
  };

  // Default: $transaction calls the callback with the db itself
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  db.$transaction.mockImplementation((cb: (tx: typeof db) => unknown) => cb(db));

  return db;
}

export const mockDb = makeMockDb();

/** Reset all mocks between tests and restore the $transaction default. */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
export function resetMockDb() {
  const models = Object.values(mockDb) as Array<Record<string, ReturnType<typeof vi.fn>> | ReturnType<typeof vi.fn>>;
  for (const model of models) {
    if (typeof model === "function") {
      model.mockReset();
    } else if (model && typeof model === "object") {
      for (const fn of Object.values(model)) {
        if (typeof fn === "function" && "mockReset" in fn) {
          fn.mockReset();
        }
      }
    }
  }
  // Restore $transaction default after reset
  // eslint-disable-next-line @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
  (mockDb.$transaction as ReturnType<typeof vi.fn>).mockImplementation(
    (cb: (tx: typeof mockDb) => unknown) => cb(mockDb),
  );
}
