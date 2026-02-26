import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { logger } from "~/_utils";
import { env } from "~/env";

const EC_PUBLIC_JWK_SCHEMA = z.record(z.string(), z.unknown()).refine(
  (v) =>
    v.kty === "EC" &&
    v.crv === "P-256" &&
    typeof v.x === "string" &&
    typeof v.y === "string",
  { message: "JWK must be an EC P-256 public key with x and y coordinates" },
);

const EC_PRIVATE_JWK_SCHEMA = z.record(z.string(), z.unknown()).refine(
  (v) =>
    v.kty === "EC" &&
    v.crv === "P-256" &&
    typeof v.x === "string" &&
    typeof v.y === "string" &&
    typeof v.d === "string",
  { message: "JWK must be an EC P-256 private key with x, y, and d" },
);

// ---------------------------------------------------------------------------
// Derive a per-user key-wrapping key (KWK) on the server using HKDF.
// The KWK is never stored — it is recomputed from KEY_WRAPPING_SECRET + userId.
// ---------------------------------------------------------------------------

const SALT_LENGTH = 32;

async function deriveKwk(userId: string, salt: Uint8Array): Promise<CryptoKey> {
  const masterKeyBytes = new TextEncoder().encode(env.KEY_WRAPPING_SECRET);
  const masterKey = await crypto.subtle.importKey("raw", masterKeyBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: new TextEncoder().encode(`private-key-wrapping:${userId}`),
      name: "HKDF",
      salt: salt as BufferSource,
    },
    masterKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

// Stored format: base64( 32-byte-salt || 12-byte-IV || AES-GCM-ciphertext )
async function encryptPrivateKey(userId: string, privateKeyJwk: Record<string, unknown>): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const kwk = await deriveKwk(userId, salt);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
  const ciphertext = await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, kwk, encoded);
  const combined = new Uint8Array(salt.byteLength + iv.byteLength + ciphertext.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.byteLength);
  combined.set(new Uint8Array(ciphertext), salt.byteLength + iv.byteLength);
  return uint8ToBase64(combined);
}

async function decryptPrivateKey(userId: string, stored: string): Promise<JsonWebKey> {
  const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));

  // Try new format first: 32-byte salt + 12-byte IV + ciphertext
  try {
    const salt = bytes.slice(0, SALT_LENGTH);
    const iv = bytes.slice(SALT_LENGTH, SALT_LENGTH + 12);
    const ciphertext = bytes.slice(SALT_LENGTH + 12);
    const kwk = await deriveKwk(userId, salt);
    const plain = await crypto.subtle.decrypt({ iv, name: "AES-GCM" }, kwk, ciphertext);
    return JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
  } catch {
    // Fall back to legacy format: 12-byte IV + ciphertext (zero salt)
    const iv = bytes.slice(0, 12);
    const ciphertext = bytes.slice(12);
    const kwk = await deriveKwk(userId, new Uint8Array(SALT_LENGTH));
    const plain = await crypto.subtle.decrypt({ iv, name: "AES-GCM" }, kwk, ciphertext);
    return JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
  }
}

// ---------------------------------------------------------------------------

export const keysRouter = createTRPCRouter({
  /** Returns the current user's ID (used by useE2EE hook to look up IndexedDB). */
  getCurrentUserId: protectedProcedure.query(({ ctx }) => ctx.session.user.id),

  /** Return the wrapped public key for a given user (so senders can encrypt thread keys). */
  getUserPublicKey: protectedProcedure
    .input(z.object({ userId: z.string() }))
    .query(async ({ ctx, input }) => {
      const user = await ctx.db.user.findUnique({
        select: { publicKey: true },
        where: { id: input.userId },
      });
      if (!user?.publicKey) return null;
      return JSON.parse(user.publicKey) as JsonWebKey;
    }),

  /** Restore decrypted private key JWK (sent over TLS; client stores in IDB). */
  restore: protectedProcedure.query(async ({ ctx }) => {
    try {
      const user = await ctx.db.user.findUnique({
        select: { encryptedPrivateKey: true },
        where: { id: ctx.session.user.id },
      });
      if (!user?.encryptedPrivateKey) return null;
      const privateKeyJwk = await decryptPrivateKey(ctx.session.user.id, user.encryptedPrivateKey);
      return { privateKeyJwk };
    } catch (error) {
      logger.error("Failed to restore private key", { error, userId: ctx.session.user.id });
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to restore private key" });
    }
  }),

  /** Store public key + server-wrapped private key for backup. Refuses overwrite if keys already exist. */
  setup: protectedProcedure
    .input(z.object({
      privateKeyJwk: EC_PRIVATE_JWK_SCHEMA,
      publicKeyJwk: EC_PUBLIC_JWK_SCHEMA,
    }))
    .mutation(async ({ ctx, input }) => {
      try {
        const existing = await ctx.db.user.findUnique({
          select: { publicKey: true },
          where: { id: ctx.session.user.id },
        });
        if (existing?.publicKey) {
          throw new TRPCError({ code: "CONFLICT", message: "Keys already exist. Re-authentication required to replace keys." });
        }

        const encryptedPrivateKey = await encryptPrivateKey(
          ctx.session.user.id,
          input.privateKeyJwk,
        );
        await ctx.db.user.update({
          data: {
            encryptedPrivateKey,
            publicKey: JSON.stringify(input.publicKeyJwk),
          },
          where: { id: ctx.session.user.id },
        });
        return { ok: true };
      } catch (error) {
        if (error instanceof TRPCError) throw error;
        logger.error("Failed to setup keys", { error, userId: ctx.session.user.id });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to store keys" });
      }
    }),
});
