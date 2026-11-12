import { decodeJwt, decodeProtectedHeader, SignJWT } from "jose";
import { describe, expect, it } from "vitest";

import {
  MOBILE_TOKEN_AUDIENCE,
  MOBILE_TOKEN_ISSUER,
  MOBILE_TOKEN_KEY_LABEL,
  MOBILE_TOKEN_TTL_SECONDS,
  signMobileToken,
  verifyMobileToken,
} from "./mobileToken";

const rawSecret = new TextEncoder().encode(process.env.AUTH_SECRET);

/** The key the module derives, re-derived here to mint near-miss tokens. */
async function derivedKey(): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey("raw", rawSecret, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: new TextEncoder().encode(MOBILE_TOKEN_KEY_LABEL),
      name: "HKDF",
      salt: new Uint8Array(32),
    },
    material,
    { hash: "SHA-256", length: 256, name: "HMAC" },
    false,
    ["sign", "verify"],
  );
}

async function mint(claims: { aud?: string; exp?: number | null; iss?: string; sub?: string }) {
  const now = Math.floor(Date.now() / 1000);
  let jwt = new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setIssuedAt(now);
  if (claims.sub !== undefined) jwt = jwt.setSubject(claims.sub);
  if (claims.iss !== undefined) jwt = jwt.setIssuer(claims.iss);
  if (claims.aud !== undefined) jwt = jwt.setAudience(claims.aud);
  if (claims.exp !== null) jwt = jwt.setExpirationTime(claims.exp ?? now + 3600);
  return jwt.sign(await derivedKey());
}

const valid = { aud: MOBILE_TOKEN_AUDIENCE, iss: MOBILE_TOKEN_ISSUER, sub: "user-1" };

describe("mobile bearer token claims", () => {
  it("accepts a correctly keyed token with the right claims (control)", async () => {
    await expect(verifyMobileToken(await mint(valid))).resolves.toMatchObject({ userId: "user-1" });
  });

  it("rejects a wrong or missing audience", async () => {
    await expect(verifyMobileToken(await mint({ ...valid, aud: "my-iso:web" }))).resolves.toBeNull();
    await expect(verifyMobileToken(await mint({ ...valid, aud: undefined }))).resolves.toBeNull();
  });

  it("rejects a wrong or missing issuer", async () => {
    await expect(verifyMobileToken(await mint({ ...valid, iss: "someone-else" }))).resolves.toBeNull();
    await expect(verifyMobileToken(await mint({ ...valid, iss: undefined }))).resolves.toBeNull();
  });

  it("rejects an expired token and one without an expiry", async () => {
    const past = Math.floor(Date.now() / 1000) - 60;
    await expect(verifyMobileToken(await mint({ ...valid, exp: past }))).resolves.toBeNull();
    await expect(verifyMobileToken(await mint({ ...valid, exp: null }))).resolves.toBeNull();
  });

  it("rejects a token without a subject", async () => {
    await expect(verifyMobileToken(await mint({ ...valid, sub: undefined }))).resolves.toBeNull();
  });
});

describe("mobile bearer tokens", () => {
  it("issues a token that verifies and carries iss, aud, sub and a 24h expiry", async () => {
    const token = await signMobileToken("user-1");

    const claims = decodeJwt(token);
    expect(decodeProtectedHeader(token).alg).toBe("HS256");
    expect(claims.iss).toBe(MOBILE_TOKEN_ISSUER);
    expect(claims.aud).toBe(MOBILE_TOKEN_AUDIENCE);
    expect(claims.sub).toBe("user-1");
    expect((claims.exp ?? 0) - (claims.iat ?? 0)).toBe(MOBILE_TOKEN_TTL_SECONDS);
    // No personal data in the token.
    expect(Object.keys(claims).sort()).toEqual(["aud", "exp", "iat", "iss", "sub"]);

    const verified = await verifyMobileToken(token);
    expect(verified?.userId).toBe("user-1");
    expect(verified?.expiresAt.getTime()).toBe((claims.exp ?? 0) * 1000);
  });

  it("is not signed with the raw AUTH_SECRET", async () => {
    const token = await signMobileToken("user-1");
    const { jwtVerify } = await import("jose");
    await expect(jwtVerify(token, rawSecret)).rejects.toThrow();
  });

  it("rejects a token signed with the raw AUTH_SECRET (the old scheme)", async () => {
    const legacy = await new SignJWT({ email: "a@example.com", sub: "user-1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(rawSecret);

    await expect(verifyMobileToken(legacy)).resolves.toBeNull();
  });

  it("rejects a raw-secret token even with the right issuer and audience", async () => {
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-1")
      .setIssuer(MOBILE_TOKEN_ISSUER)
      .setAudience(MOBILE_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime("24h")
      .sign(rawSecret);

    await expect(verifyMobileToken(forged)).resolves.toBeNull();
  });

  it("rejects garbage and unsigned tokens", async () => {
    await expect(verifyMobileToken("not-a-jwt")).resolves.toBeNull();

    const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
    const body = Buffer.from(
      JSON.stringify({
        aud: MOBILE_TOKEN_AUDIENCE,
        exp: Math.floor(Date.now() / 1000) + 3600,
        iss: MOBILE_TOKEN_ISSUER,
        sub: "user-1",
      }),
    ).toString("base64url");
    await expect(verifyMobileToken(`${header}.${body}.`)).resolves.toBeNull();
  });
});
