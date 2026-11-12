import { beforeEach, describe, expect, it, vi } from "vitest";

const requestHeaders = vi.hoisted(() => ({ current: new Headers() }));

vi.mock("next/headers", () => ({
  headers: () => Promise.resolve(requestHeaders.current),
}));

import { NONCE_HEADER } from "./contentSecurityPolicy";
import { requestNonce } from "./requestNonce";

describe("requestNonce", () => {
  beforeEach(() => {
    requestHeaders.current = new Headers();
  });

  it("returns the nonce the middleware put on the request", async () => {
    requestHeaders.current = new Headers({
      cookie: "authjs.session-token=secret",
      [NONCE_HEADER]: "AAECAwQFBgcICQoLDA0ODw==",
    });
    await expect(requestNonce()).resolves.toBe("AAECAwQFBgcICQoLDA0ODw==");
  });

  it("is undefined when the middleware did not run (no script gets a nonce)", async () => {
    await expect(requestNonce()).resolves.toBeUndefined();
  });
});
