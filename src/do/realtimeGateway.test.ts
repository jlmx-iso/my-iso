import { describe, expect, it, vi } from "vitest";

import { handleRealtimeRequest } from "./realtimeGateway";
import type { CloudflareEnv } from "../../cloudflare-env";


const ORIGIN = "https://myiso.app";
const THREAD_ID = "cm3x9thread0000000000000a";
const USER_ID = "user-1";

/** Minimal stand-ins for the D1 and Durable Object bindings. */
function makeEnv({ isParticipant = true, dbError }: { dbError?: Error; isParticipant?: boolean } = {}) {
  const first = vi.fn(async () => {
    if (dbError) throw dbError;
    return isParticipant ? { 1: 1 } : null;
  });
  const bind = vi.fn(() => ({ first }));
  const prepare = vi.fn(() => ({ bind }));
  const roomFetch = vi.fn(async (_url: string, _init?: RequestInit) => new Response("room"));
  const idFromName = vi.fn((name: string) => `id:${name}`);
  const get = vi.fn(() => ({ fetch: roomFetch }));

  const env = { CHAT_ROOM: { get, idFromName }, DB: { prepare } } as unknown as CloudflareEnv;
  return { bind, env, get, idFromName, prepare, roomFetch };
}

function upgradeRequest(
  { headers = {}, method = "GET", query = `?threadId=${THREAD_ID}` }:
  { headers?: Record<string, string>; method?: string; query?: string } = {},
) {
  return new Request(`${ORIGIN}/api/messages/ws${query}`, {
    headers: { Cookie: "authjs.session-token=secret", Origin: ORIGIN, Upgrade: "websocket", ...headers },
    method,
  });
}

const signedIn = vi.fn(async () => USER_ID);
const anonymous = vi.fn(async () => null);

describe("handleRealtimeRequest", () => {
  it("hands a participant's upgrade to the thread's room", async () => {
    const { bind, env, idFromName, prepare, roomFetch } = makeEnv();

    const response = await handleRealtimeRequest(upgradeRequest(), env, signedIn);

    expect(await response.text()).toBe("room");
    expect(idFromName).toHaveBeenCalledWith(THREAD_ID);
    // Membership is checked with bound parameters, never interpolation.
    expect(prepare).toHaveBeenCalledWith(expect.stringContaining('"_MessageThreadToUser"'));
    expect(prepare).toHaveBeenCalledWith(expect.not.stringContaining(THREAD_ID));
    expect(bind).toHaveBeenCalledWith(THREAD_ID, USER_ID);
    expect(roomFetch).toHaveBeenCalledOnce();
  });

  it("does not forward cookies or other request headers to the room", async () => {
    const { env, roomFetch } = makeEnv();

    await handleRealtimeRequest(upgradeRequest(), env, signedIn);

    const [url, init] = roomFetch.mock.calls[0] ?? [];
    expect(url).toBe(`${ORIGIN}/api/messages/ws?threadId=${THREAD_ID}`);
    expect(init?.headers).toEqual({ Upgrade: "websocket" });
  });

  it("returns 401 without a session, before touching D1 or the room", async () => {
    const { env, get, prepare } = makeEnv();

    const response = await handleRealtimeRequest(upgradeRequest(), env, anonymous);

    expect(response.status).toBe(401);
    expect(prepare).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("returns 403 for a signed-in user who is not a participant", async () => {
    const { env, get } = makeEnv({ isParticipant: false });

    const response = await handleRealtimeRequest(upgradeRequest(), env, signedIn);

    expect(response.status).toBe(403);
    expect(get).not.toHaveBeenCalled();
  });

  it.each([
    "https://evil.example",
    "http://myiso.app",
    "https://myiso.app.evil.example",
    "null",
  ])("returns 403 for the foreign origin %s without authenticating", async (origin) => {
    const { env, get } = makeEnv();
    const authenticate = vi.fn(async () => USER_ID);

    const response = await handleRealtimeRequest(
      upgradeRequest({ headers: { Origin: origin } }),
      env,
      authenticate,
    );

    expect(response.status).toBe(403);
    expect(authenticate).not.toHaveBeenCalled();
    expect(get).not.toHaveBeenCalled();
  });

  it("accepts a request without an Origin header (non-browser client)", async () => {
    const { env, roomFetch } = makeEnv();
    const request = new Request(`${ORIGIN}/api/messages/ws?threadId=${THREAD_ID}`, {
      headers: { Upgrade: "websocket" },
    });

    await handleRealtimeRequest(request, env, signedIn);

    expect(roomFetch).toHaveBeenCalledOnce();
  });

  it.each([
    ["missing", ""],
    ["empty", "?threadId="],
    ["too long", `?threadId=${"a".repeat(65)}`],
    ["SQL metacharacters", `?threadId=${encodeURIComponent("x' OR '1'='1")}`],
    ["a path", `?threadId=${encodeURIComponent("../../etc")}`],
  ])("returns 400 for a %s threadId without authenticating", async (_label, query) => {
    const { env, prepare } = makeEnv();
    const authenticate = vi.fn(async () => USER_ID);

    const response = await handleRealtimeRequest(upgradeRequest({ query }), env, authenticate);

    expect(response.status).toBe(400);
    expect(authenticate).not.toHaveBeenCalled();
    expect(prepare).not.toHaveBeenCalled();
  });

  it("answers an authorised plain GET with 426 so clients can probe access", async () => {
    const { env, get } = makeEnv();

    const response = await handleRealtimeRequest(
      upgradeRequest({ headers: { Upgrade: "" } }),
      env,
      signedIn,
    );

    expect(response.status).toBe(426);
    expect(get).not.toHaveBeenCalled();
  });

  it("answers an unauthorised plain GET with the same 401/403 as an upgrade", async () => {
    const plain = () => upgradeRequest({ headers: { Upgrade: "" } });

    expect((await handleRealtimeRequest(plain(), makeEnv().env, anonymous)).status).toBe(401);
    expect(
      (await handleRealtimeRequest(plain(), makeEnv({ isParticipant: false }).env, signedIn)).status,
    ).toBe(403);
  });

  it("rejects other methods", async () => {
    const { env } = makeEnv();

    const response = await handleRealtimeRequest(upgradeRequest({ method: "POST" }), env, signedIn);

    expect(response.status).toBe(405);
  });

  it("returns 503 when the participant lookup fails", async () => {
    const { env, get } = makeEnv({ dbError: new Error("D1 is down") });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const response = await handleRealtimeRequest(upgradeRequest(), env, signedIn);

    expect(response.status).toBe(503);
    expect(get).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
