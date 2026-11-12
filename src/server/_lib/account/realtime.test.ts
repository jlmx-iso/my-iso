import { describe, expect, it, vi } from "vitest";

import type { ChatRoomNamespace } from "~/types/chatRoom";

import { chatRoomBinding, REVOKE_CHUNK, revokeRealtimeAccess } from "./realtime";

function fakeRooms(closedPerRoom: (threadId: string) => number) {
  const revoked: Array<{ threadId: string; userId: string }> = [];
  const rooms = {
    get: (id: { threadId: string }) => ({
      revokeUser: vi.fn(async (userId: string) => {
        revoked.push({ threadId: id.threadId, userId });
        return closedPerRoom(id.threadId);
      }),
    }),
    idFromName: (threadId: string) => ({ threadId }),
  } as unknown as ChatRoomNamespace;
  return { revoked, rooms };
}

describe("revokeRealtimeAccess", () => {
  it("asks every thread's room to close the member's sockets, in chunks", async () => {
    const threadIds = Array.from({ length: REVOKE_CHUNK + 3 }, (_, i) => `t${i}`);
    const { revoked, rooms } = fakeRooms((threadId) => (threadId === "t0" ? 2 : 0));

    await expect(revokeRealtimeAccess("user_1", threadIds, rooms)).resolves.toBe(2);
    expect(revoked).toHaveLength(threadIds.length);
    expect(new Set(revoked.map((call) => call.userId))).toEqual(new Set(["user_1"]));
  });

  it("throws when a room cannot be reached, so the step is retried", async () => {
    const rooms = {
      get: () => ({ revokeUser: async () => Promise.reject(new Error("DO unavailable")) }),
      idFromName: (threadId: string) => threadId,
    } as unknown as ChatRoomNamespace;
    await expect(revokeRealtimeAccess("user_1", ["t1"], rooms)).rejects.toThrow("DO unavailable");
  });

  it("does nothing without the binding (next dev, tests)", async () => {
    expect(chatRoomBinding()).toBeNull();
    await expect(revokeRealtimeAccess("user_1", ["t1"])).resolves.toBe(0);
  });
});
