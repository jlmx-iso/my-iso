import { describe, expect, it } from "vitest";

import { MAX_QUERY_RETRIES, shouldRetryQuery } from "./queryRetry";

const trpcError = (code: string, httpStatus: number) =>
  Object.assign(new Error(code), { data: { code, httpStatus } });

describe("shouldRetryQuery", () => {
  it.each([
    ["BAD_REQUEST", 400],
    ["UNAUTHORIZED", 401],
    ["FORBIDDEN", 403],
    ["NOT_FOUND", 404],
    ["CONFLICT", 409],
    ["PAYLOAD_TOO_LARGE", 413],
    ["TOO_MANY_REQUESTS", 429],
  ])("never asks again after %s", (code, status) => {
    expect(shouldRetryQuery(0, trpcError(code, status))).toBe(false);
  });

  it("retries server errors and network failures a couple of times", () => {
    for (const error of [trpcError("INTERNAL_SERVER_ERROR", 500), new TypeError("Failed to fetch")]) {
      expect(shouldRetryQuery(0, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES - 1, error)).toBe(true);
      expect(shouldRetryQuery(MAX_QUERY_RETRIES, error)).toBe(false);
    }
  });
});
