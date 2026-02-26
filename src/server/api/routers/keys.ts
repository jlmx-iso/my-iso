import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, protectedProcedure } from "../trpc";
import { env } from "~/env";
import { logger } from "~/_utils";

// Validate that the JWK is an EC P-256 key with required fields
const EC_JWK_SCHEMA = z.record(z.string(), z.unknown()).refine(
  (v) =>
    v.kty === "EC" &&
    v.crv === "P-256" &&
    typeof v.x === "string" &&
    typeof v.y === "string",
  { message: "JWK must be an EC P-256 key with x and y coordinates" },
);

// ---------------------------------------------------------------------------
// Derive a per-user key-wrapping key (KWK) on the server using HKDF.
// The KWK is never stored — it is recomputed from KEY_WRAPPING_SECRET + userId.
// ---------------------------------------------------------------------------

async function deriveKwk(userId: string): Promise<CryptoKey> {
  const masterKeyBytes = new TextEncoder().encode(env.KEY_WRAPPING_SECRET);
  const masterKey = await crypto.subtle.importKey("raw", masterKeyBytes, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: new TextEncoder().encode(`private-key-wrapping:${userId}`),
      name: "HKDF",
      salt: new Uint8Array(32),
    },
    masterKey,
    { length: 256, name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}

async function encryptPrivateKey(userId: string, privateKeyJwk: Record<string, unknown>): Promise<string> {
  const kwk = await deriveKwk(userId);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(JSON.stringify(privateKeyJwk));
  const ciphertext = await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, kwk, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  let binary = "";
  for (let i = 0; i < combined.length; i++) {
    binary += String.fromCharCode(combined[i]!);
  }
  return btoa(binary);
}

async function decryptPrivateKey(userId: string, stored: string): Promise<JsonWebKey> {
  const kwk = await deriveKwk(userId);
  const bytes = Uint8Array.from(atob(stored), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plain = await crypto.subtle.decrypt({ iv, name: "AES-GCM" }, kwk, ciphertext);
  return JSON.parse(new TextDecoder().decode(plain)) as JsonWebKey;
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
      privateKeyJwk: EC_JWK_SCHEMA,
      publicKeyJwk: EC_JWK_SCHEMA,
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
        logger.error("Failed to setup keys", { error, userId: ctx.session.user.id });
        throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Failed to store keys" });
      }
    }),
});
