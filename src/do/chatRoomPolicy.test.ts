import { describe, expect, it } from "vitest";

import {
  admitSocket,
  MAX_SOCKETS_PER_ROOM,
  MAX_SOCKETS_PER_USER,
  partitionByExpiry,
  readConnection,
  REALTIME_EXPIRES_HEADER,
  REALTIME_USER_HEADER,
  userTag,
} from "./chatRoomPolicy";

const NOW = 1_800_000_000_000;

function headers(userId: string | null, expiresAt: string | null): Headers {
  const result = new Headers();
  if (userId !== null) result.set(REALTIME_USER_HEADER, userId);
  if (expiresAt !== null) result.set(REALTIME_EXPIRES_HEADER, expiresAt);
  return result;
}

describe("readConnection", () => {
  it("accepts an identity whose session is still valid", () => {
    expect(readConnection(headers("user-1", String(NOW + 1000)), NOW)).toEqual({
      attachment: { expiresAt: NOW + 1000, userId: "user-1" },
      ok: true,
    });
  });

  it("refuses a connection without an identity", () => {
    expect(readConnection(headers(null, String(NOW + 1000)), NOW)).toMatchObject({ ok: false, status: 400 });
    expect(readConnection(headers("user-1", null), NOW + 1)).toMatchObject({ ok: false });
    expect(readConnection(headers("user-1", "soon"), NOW)).toMatchObject({ ok: false, status: 400 });
  });

  it("refuses a connection whose session has expired", () => {
    expect(readConnection(headers("user-1", String(NOW)), NOW)).toMatchObject({ ok: false, status: 401 });
  });
});

describe("admitSocket", () => {
  it("admits sockets below both caps", () => {
    expect(admitSocket({ room: 0, user: 0 })).toBeNull();
    expect(admitSocket({ room: MAX_SOCKETS_PER_ROOM - 1, user: MAX_SOCKETS_PER_USER - 1 })).toBeNull();
  });

  it("refuses a user's socket beyond the per-user cap", () => {
    expect(admitSocket({ room: MAX_SOCKETS_PER_USER, user: MAX_SOCKETS_PER_USER })).toMatchObject({
      ok: false,
      status: 429,
    });
  });

  it("refuses any socket once the room is full", () => {
    expect(admitSocket({ room: MAX_SOCKETS_PER_ROOM, user: 0 })).toMatchObject({ ok: false, status: 429 });
  });
});

describe("partitionByExpiry", () => {
  const attachmentOf = (socket: { attachment: unknown }) => socket.attachment;

  it("selects expired sockets and reports the next expiry", () => {
    const live = { attachment: { expiresAt: NOW + 5000, userId: "a" } };
    const later = { attachment: { expiresAt: NOW + 9000, userId: "b" } };
    const expired = { attachment: { expiresAt: NOW - 1, userId: "c" } };
    const atBoundary = { attachment: { expiresAt: NOW, userId: "d" } };

    expect(partitionByExpiry([later, expired, live, atBoundary], attachmentOf, NOW)).toEqual({
      expired: [expired, atBoundary],
      nextExpiry: NOW + 5000,
    });
  });

  it("treats a socket without a valid attachment as expired", () => {
    const bare = { attachment: null };
    const malformed = { attachment: { userId: "a" } };
    expect(partitionByExpiry([bare, malformed], attachmentOf, NOW)).toEqual({
      expired: [bare, malformed],
      nextExpiry: null,
    });
  });
});

describe("userTag", () => {
  it("namespaces the user id", () => {
    expect(userTag("abc")).toBe("user:abc");
  });
});
