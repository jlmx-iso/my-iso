import { afterEach, describe, expect, it, vi } from "vitest";

import { logger, toLoggable } from "./logger";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("toLoggable", () => {
  it("serialises an Error with name, message and stack", () => {
    const error = new TypeError("boom");
    const result = toLoggable(error) as Record<string, unknown>;

    expect(result.name).toBe("TypeError");
    expect(result.message).toBe("boom");
    expect(result.stack).toContain("TypeError: boom");
    // The reason this exists: JSON.stringify alone drops everything.
    expect(JSON.stringify(error)).toBe("{}");
    expect(JSON.stringify(result)).toContain("boom");
  });

  it("keeps the cause chain and own properties such as error codes", () => {
    const cause = new Error("connection reset");
    const error = Object.assign(new Error("query failed", { cause }), { code: "P2002" });

    expect(toLoggable(error)).toMatchObject({
      cause: { message: "connection reset", name: "Error" },
      code: "P2002",
      message: "query failed",
    });
  });

  it("serialises errors nested in objects and arrays", () => {
    const result = toLoggable({ attempts: [new Error("first")], error: new Error("outer"), userId: "u1" });
    expect(result).toMatchObject({
      attempts: [{ message: "first" }],
      error: { message: "outer" },
      userId: "u1",
    });
  });

  it("handles values JSON cannot: bigint, cycles, functions, dates, depth", () => {
    const cyclic: Record<string, unknown> = { name: "loop" };
    cyclic.self = cyclic;
    const deep = { a: { b: { c: { d: { e: { f: { g: "too deep" } } } } } } };

    const result = toLoggable({
      at: new Date("2030-01-01T00:00:00Z"),
      big: 10n,
      cyclic,
      deep,
      fn: function named() {
        return 1;
      },
    });

    expect(() => JSON.stringify(result)).not.toThrow();
    expect(result).toMatchObject({
      at: "2030-01-01T00:00:00.000Z",
      big: "10",
      cyclic: { name: "loop", self: "[Circular]" },
      fn: "[Function named]",
    });
    expect(JSON.stringify(result)).toContain("[Truncated]");
    expect(JSON.stringify(result)).not.toContain("too deep");
  });

  it("passes primitives through", () => {
    expect(toLoggable("text")).toBe("text");
    expect(toLoggable(42)).toBe(42);
    expect(toLoggable(null)).toBeNull();
    expect(toLoggable(undefined)).toBeUndefined();
  });
});

describe("logger", () => {
  it("writes the error's message and stack, not an empty object", () => {
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => undefined);

    logger.error("Something failed", { error: new RangeError("out of range"), userId: "u1" });

    const output = String(errorLog.mock.calls[0]?.[0]);
    expect(output).toContain("Something failed");
    expect(output).toContain("out of range");
    expect(output).toContain("RangeError");
    expect(output).toContain("u1");
    expect(output).not.toContain('"error": {}');
  });

  it("uses the console method that matches the level", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const log = vi.spyOn(console, "log").mockImplementation(() => undefined);

    logger.warn("careful");
    logger.info("fyi");

    expect(warn).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledOnce();
  });
});
