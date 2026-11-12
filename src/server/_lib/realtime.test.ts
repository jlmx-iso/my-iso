import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCloudflareContext = vi.hoisted(() => vi.fn());
const mockLoggerError = vi.hoisted(() => vi.fn());

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: mockGetCloudflareContext,
}));
vi.mock("~/_utils", () => ({ logger: { error: mockLoggerError } }));

import { publishThreadMessage } from "./realtime";

const message = {
  content: "hello",
  createdAt: new Date("2026-01-01T10:00:00.000Z"),
  id: "m1",
  sender: { firstName: "Sarah", id: "user-1", lastName: "Chen", profilePic: null },
};

/** A Cloudflare context whose ChatRoom stub resolves or rejects `broadcast`. */
function makeContext(broadcast: (payload: string) => Promise<void>) {
  const pending: Promise<unknown>[] = [];
  const broadcastSpy = vi.fn(broadcast);
  const idFromName = vi.fn((name: string) => `id:${name}`);
  const get = vi.fn(() => ({ broadcast: broadcastSpy }));
  const waitUntil = vi.fn((promise: Promise<unknown>) => void pending.push(promise));

  mockGetCloudflareContext.mockReturnValue({
    ctx: { waitUntil },
    env: { CHAT_ROOM: { get, idFromName } },
  });
  return { broadcastSpy, get, idFromName, pending, waitUntil };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("publishThreadMessage", () => {
  it("broadcasts the message to the thread's room under waitUntil", async () => {
    const { broadcastSpy, get, idFromName, pending, waitUntil } = makeContext(async () => undefined);

    publishThreadMessage("thread-1", message);

    expect(idFromName).toHaveBeenCalledWith("thread-1");
    expect(get).toHaveBeenCalledWith("id:thread-1");
    expect(waitUntil).toHaveBeenCalledOnce();
    await Promise.all(pending);
    expect(JSON.parse(broadcastSpy.mock.calls[0]?.[0] ?? "")).toEqual({
      message: { ...message, createdAt: "2026-01-01T10:00:00.000Z" },
      type: "message",
    });
    expect(mockLoggerError).not.toHaveBeenCalled();
  });

  it("logs a failed broadcast instead of rejecting", async () => {
    const { pending } = makeContext(async () => {
      throw new Error("room unavailable");
    });

    expect(() => publishThreadMessage("thread-1", message)).not.toThrow();

    await expect(Promise.all(pending)).resolves.toBeDefined();
    expect(mockLoggerError).toHaveBeenCalledWith(
      "Failed to broadcast message to ChatRoom",
      expect.objectContaining({ threadId: "thread-1" }),
    );
  });

  it("logs instead of throwing when the room cannot be reached at all", () => {
    const { get } = makeContext(async () => undefined);
    get.mockImplementation(() => {
      throw new Error("binding misconfigured");
    });

    expect(() => publishThreadMessage("thread-1", message)).not.toThrow();
    expect(mockLoggerError).toHaveBeenCalledOnce();
  });

  it("is a no-op when the CHAT_ROOM binding is absent", () => {
    const waitUntil = vi.fn();
    mockGetCloudflareContext.mockReturnValue({ ctx: { waitUntil }, env: {} });

    expect(() => publishThreadMessage("thread-1", message)).not.toThrow();
    expect(waitUntil).not.toHaveBeenCalled();
  });

  it("is a no-op outside Cloudflare, where there is no context", () => {
    mockGetCloudflareContext.mockImplementation(() => {
      throw new Error("getCloudflareContext has been called without initOpenNextCloudflareForDev");
    });

    expect(() => publishThreadMessage("thread-1", message)).not.toThrow();
    expect(mockLoggerError).not.toHaveBeenCalled();
  });
});
