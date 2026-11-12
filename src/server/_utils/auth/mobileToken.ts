import { SignJWT, jwtVerify } from "jose";

import { env } from "~/env";

/**
 * Bearer tokens for the mobile app.
 *
 * They are signed with a key derived from AUTH_SECRET (HKDF-SHA-256 with a
 * fixed label), never with AUTH_SECRET itself: the raw secret is Auth.js's
 * key material for web session cookies, and one key must not serve two
 * token formats. `iss` and `aud` are set and verified so that no other JWT
 * minted under the same secret, now or later, is accepted here.
 */

export const MOBILE_TOKEN_ISSUER = "my-iso";
export const MOBILE_TOKEN_AUDIENCE = "my-iso:mobile";
export const MOBILE_TOKEN_TTL_SECONDS = 24 * 60 * 60;

/** HKDF `info`: changing it invalidates every issued token. */
export const MOBILE_TOKEN_KEY_LABEL = "my-iso/mobile-bearer-jwt/v1";
const ALGORITHM = "HS256";

const encoder = new TextEncoder();

let signingKey: Promise<CryptoKey> | undefined;

function getSigningKey(): Promise<CryptoKey> {
  signingKey ??= (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      encoder.encode(env.AUTH_SECRET),
      "HKDF",
      false,
      ["deriveKey"],
    );
    return crypto.subtle.deriveKey(
      {
        hash: "SHA-256",
        info: encoder.encode(MOBILE_TOKEN_KEY_LABEL),
        name: "HKDF",
        salt: new Uint8Array(32),
      },
      material,
      { hash: "SHA-256", length: 256, name: "HMAC" },
      false,
      ["sign", "verify"],
    );
  })();
  return signingKey;
}

/** Issues a 24-hour bearer token for `userId`. */
export async function signMobileToken(userId: string): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: ALGORITHM })
    .setSubject(userId)
    .setIssuer(MOBILE_TOKEN_ISSUER)
    .setAudience(MOBILE_TOKEN_AUDIENCE)
    .setIssuedAt()
    .setExpirationTime(`${MOBILE_TOKEN_TTL_SECONDS}s`)
    .sign(await getSigningKey());
}

/**
 * Returns the user id and expiry of a valid mobile token, or null for
 * anything else: wrong key, issuer, audience or algorithm, expired, or
 * missing `sub`/`exp`.
 */
export async function verifyMobileToken(
  token: string,
): Promise<{ expiresAt: Date; userId: string } | null> {
  try {
    const { payload } = await jwtVerify(token, await getSigningKey(), {
      algorithms: [ALGORITHM],
      audience: MOBILE_TOKEN_AUDIENCE,
      issuer: MOBILE_TOKEN_ISSUER,
      requiredClaims: ["sub", "exp"],
    });
    if (typeof payload.sub !== "string" || typeof payload.exp !== "number") {
      return null;
    }
    return { expiresAt: new Date(payload.exp * 1000), userId: payload.sub };
  } catch {
    return null;
  }
}
