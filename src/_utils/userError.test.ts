import { describe, expect, it } from "vitest";

import {
  GENERIC_ERROR_MESSAGE,
  NETWORK_ERROR_MESSAGE,
  RATE_LIMIT_MESSAGE,
  SESSION_EXPIRED_MESSAGE,
  userFacingError,
} from "./userError";

const trpcError = (message: string, code: string, zodError: unknown = null) =>
  Object.assign(new Error(message), { data: { code, zodError } });

describe("userFacingError", () => {
  it("replaces browser network failures with friendly copy", () => {
    expect(userFacingError(new TypeError("Failed to fetch"))).toBe(NETWORK_ERROR_MESSAGE);
    expect(userFacingError(new Error("NetworkError when attempting to fetch resource."))).toBe(
      NETWORK_ERROR_MESSAGE,
    );
    expect(userFacingError(new Error("Load failed"))).toBe(NETWORK_ERROR_MESSAGE);
  });

  it("passes through messages the server wrote for the user", () => {
    expect(userFacingError(trpcError("That handle is already taken.", "CONFLICT"))).toBe(
      "That handle is already taken.",
    );
    expect(userFacingError(trpcError("Invite code is invalid", "BAD_REQUEST"))).toBe(
      "Invite code is invalid",
    );
  });

  it("never shows Zod validation dumps", () => {
    const zodMessage = JSON.stringify([{ code: "too_small", path: ["bio"], message: "Too small" }]);
    expect(userFacingError(trpcError(zodMessage, "BAD_REQUEST", { fieldErrors: {} }))).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(userFacingError(trpcError(zodMessage, "BAD_REQUEST"), "Check the form.")).toBe(
      "Check the form.",
    );
  });

  it("never shows internal errors", () => {
    expect(
      userFacingError(trpcError("Invalid `prisma.user.update()` invocation", "INTERNAL_SERVER_ERROR")),
    ).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingError(trpcError("D1_ERROR: no such column", "BAD_REQUEST"))).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(userFacingError(new Error("Cannot read properties of undefined"))).toBe(
      GENERIC_ERROR_MESSAGE,
    );
  });

  it("maps auth and rate-limit codes", () => {
    expect(userFacingError(trpcError("UNAUTHORIZED", "UNAUTHORIZED"))).toBe(SESSION_EXPIRED_MESSAGE);
    expect(userFacingError(trpcError("", "TOO_MANY_REQUESTS"))).toBe(RATE_LIMIT_MESSAGE);
    expect(
      userFacingError(trpcError("Please wait a minute before requesting another code.", "TOO_MANY_REQUESTS")),
    ).toBe("Please wait a minute before requesting another code.");
  });

  it("uses the fallback for unknown values", () => {
    expect(userFacingError(undefined)).toBe(GENERIC_ERROR_MESSAGE);
    expect(userFacingError({ nope: true }, "Could not save.")).toBe("Could not save.");
  });
});
