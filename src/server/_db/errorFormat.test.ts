import { afterEach, describe, expect, it } from "vitest";

import { withoutQueryArguments } from "~/_lib/posthogServer";
import { createTestDb, createTestUser, type TestDb } from "~/test/helpers/sqlite";

import { prismaErrorFormat } from "./errorFormat";

const SECRET = "my phone is 555-0100, bio: private";

let testDb: TestDb | undefined;

afterEach(async () => {
  await testDb?.close();
  testDb = undefined;
});

async function messageOf(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
  }
  throw new Error("expected the call to fail");
}

describe("prismaErrorFormat", () => {
  it("is minimal everywhere but development", () => {
    expect(prismaErrorFormat("production")).toBe("minimal");
    expect(prismaErrorFormat("test")).toBe("minimal");
    expect(prismaErrorFormat(undefined)).toBe("minimal");
    expect(prismaErrorFormat("development")).toBe("pretty");
  });

  it("keeps argument values out of a real client's request errors", async () => {
    testDb = await createTestDb({ errorFormat: prismaErrorFormat("production") });
    const { db } = testDb;
    const user = await createTestUser(db);

    const failures = [
      // No such row.
      await messageOf(() => db.user.update({ data: { phone: SECRET }, where: { id: "missing" } })),
      // Unique constraint.
      await messageOf(() =>
        db.user.create({ data: { email: user.email, firstName: SECRET, lastName: SECRET } }),
      ),
    ];

    expect(failures[0]).toContain("No record was found for an update");
    expect(failures[1]).toContain("Unique constraint failed");
    for (const message of failures) {
      expect(message).not.toContain("555-0100");
      expect(message).not.toContain(user.email);
    }
  });

  it("a validation error still prints the query; error tracking gets it without", async () => {
    testDb = await createTestDb({ errorFormat: prismaErrorFormat("production") });
    const { db } = testDb;
    const user = await createTestUser(db);

    let caught: unknown;
    try {
      await db.user.update({ data: { bogus: SECRET } as never, where: { id: user.id } });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(Error);
    // Prisma reprints the arguments whatever the format: why the reporter redacts.
    expect((caught as Error).message).toContain("555-0100");

    const reported = withoutQueryArguments(caught) as Error;
    expect(reported.name).toBe("PrismaClientValidationError");
    expect(reported.message).toContain("prisma.user.update()");
    expect(reported.message).toContain("Unknown argument `bogus`");
    expect(`${reported.message}\n${reported.stack ?? ""}`).not.toContain("555-0100");
    expect(reported.stack).toMatch(/\n\s+at /);
  });

  it("passes every other error through untouched", () => {
    const error = new Error("No record was found");
    expect(withoutQueryArguments(error)).toBe(error);
    expect(withoutQueryArguments("text")).toBe("text");
  });
});
