import { describe, expect, it } from "vitest";

import { ErrorReason } from "./errorReason";
import {
  GENERIC_ERROR_MESSAGE,
  NEW_CONVERSATION_LIMIT_MESSAGE,
  NOT_MESSAGEABLE_MESSAGE,
  PORTFOLIO_FULL_MESSAGE,
  isClientError,
  isRateLimited,
  zodErrorFields,
  zodFieldErrors,
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

describe("userFacingError: validation errors", () => {
  const issues = (...messages: string[]) =>
    JSON.stringify(messages.map((message) => ({ code: "custom", message, path: ["field"] })));

  it("shows a message the server wrote for the user, from the flattened error", () => {
    const error = trpcError(issues("Handle must be at least 3 characters."), "BAD_REQUEST", {
      fieldErrors: { handle: ["Handle must be at least 3 characters."] },
      formErrors: [],
    });
    expect(userFacingError(error, "Fallback")).toBe("Handle must be at least 3 characters.");
  });

  it("reads a serialised Zod issue array when that is all there is", () => {
    expect(userFacingError(new Error(issues("Image is too large (maximum 5 MB).")), "Fallback")).toBe(
      "Image is too large (maximum 5 MB).",
    );
  });

  it("never shows Zod's own wording or the raw JSON", () => {
    const zodWords = "Too big: expected string to have <=2000 characters";
    const error = trpcError(issues(zodWords), "BAD_REQUEST", { fieldErrors: { content: [zodWords] }, formErrors: [] });
    expect(userFacingError(error, "Your comment is too long.")).toBe("Your comment is too long.");
    expect(userFacingError(new Error(issues("Invalid input: expected string, received undefined")))).toBe(
      GENERIC_ERROR_MESSAGE,
    );
    expect(zodFieldErrors(error)).toEqual({});
  });

  it("lists the fields a validation error is about", () => {
    const error = trpcError("[]", "BAD_REQUEST", { fieldErrors: { handle: ["x"], phone: ["y"] }, formErrors: [] });
    expect(zodErrorFields(error)).toEqual(["handle", "phone"]);
    expect(zodErrorFields(new Error("boom"))).toEqual([]);
  });
});

describe("userFacingError: error reasons and rate limits", () => {
  const reasoned = (message: string, code: string, reason: string) =>
    Object.assign(new Error(message), { data: { code, reason, zodError: null } });

  it("explains how to reach someone who cannot be messaged", () => {
    const error = reasoned("This person isn't accepting new messages.", "FORBIDDEN", ErrorReason.RECIPIENT_NOT_MESSAGEABLE);
    expect(userFacingError(error)).toBe(NOT_MESSAGEABLE_MESSAGE);
  });

  it("keeps the server's sentence for the daily conversation limit, which names the number", () => {
    const sentence = "You've started 20 new conversations today, which is the daily limit. You can still reply in your existing conversations, and start new ones tomorrow.";
    expect(userFacingError(reasoned(sentence, "TOO_MANY_REQUESTS", ErrorReason.NEW_CONVERSATION_LIMIT))).toBe(sentence);
    expect(userFacingError(reasoned("", "TOO_MANY_REQUESTS", ErrorReason.NEW_CONVERSATION_LIMIT))).toBe(
      NEW_CONVERSATION_LIMIT_MESSAGE,
    );
  });

  it("has copy for a full portfolio even without a server sentence", () => {
    expect(userFacingError(reasoned("", "BAD_REQUEST", ErrorReason.PORTFOLIO_FULL))).toBe(PORTFOLIO_FULL_MESSAGE);
  });

  it("shows a rate limit's wait time as the server gave it", () => {
    const error = trpcError("Too many requests. Try again in 12 minutes.", "TOO_MANY_REQUESTS");
    expect(userFacingError(error, "Fallback")).toBe("Too many requests. Try again in 12 minutes.");
    expect(isRateLimited(error)).toBe(true);
    expect(isRateLimited(trpcError("nope", "FORBIDDEN"))).toBe(false);
  });

  it("passes on the server's message for an oversized upload", () => {
    expect(userFacingError(trpcError("Image is too large (maximum 5 MB).", "PAYLOAD_TOO_LARGE"))).toBe(
      "Image is too large (maximum 5 MB).",
    );
  });
});

describe("isClientError", () => {
  const withStatus = (httpStatus: number) => Object.assign(new Error("x"), { data: { code: "X", httpStatus } });

  it("is true for 4xx answers only", () => {
    expect(isClientError(withStatus(400))).toBe(true);
    expect(isClientError(withStatus(429))).toBe(true);
    expect(isClientError(withStatus(500))).toBe(false);
    expect(isClientError(new TypeError("Failed to fetch"))).toBe(false);
  });
});
