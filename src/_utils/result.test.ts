import { describe, expect, it } from "vitest";
import { Result } from "./result";

describe("Result", () => {
  describe("Result.ok", () => {
    it("sets isOk to true", () => {
      const r = Result.ok(42);
      expect(r.isOk).toBe(true);
    });

    it("sets isErr to false", () => {
      const r = Result.ok("hello");
      expect(r.isErr).toBe(false);
    });

    it("exposes the value", () => {
      const r = Result.ok({ x: 1 });
      expect(r.value).toEqual({ x: 1 });
    });

    it("works with null", () => {
      const r = Result.ok(null);
      expect(r.isOk).toBe(true);
      expect(r.value).toBeNull();
    });
  });

  describe("Result.err", () => {
    it("sets isErr to true", () => {
      const r = Result.err(new Error("boom"));
      expect(r.isErr).toBe(true);
    });

    it("sets isOk to false", () => {
      const r = Result.err("string error");
      expect(r.isOk).toBe(false);
    });

    it("exposes the error", () => {
      const err = new Error("something went wrong");
      const r = Result.err(err);
      expect(r.error).toBe(err);
    });

    it("works with arbitrary error values", () => {
      const r = Result.err(42);
      expect(r.error).toBe(42);
    });
  });

  describe("type narrowing", () => {
    it("allows accessing value after isOk check", () => {
      const r: Result<string, Error> = Result.ok("data");
      if (r.isOk) {
        expect(r.value).toBe("data");
      } else {
        throw new Error("should not reach here");
      }
    });

    it("allows accessing error after isErr check", () => {
      const err = new Error("fail");
      const r: Result<string, Error> = Result.err(err);
      if (r.isErr) {
        expect(r.error).toBe(err);
      } else {
        throw new Error("should not reach here");
      }
    });
  });
});
