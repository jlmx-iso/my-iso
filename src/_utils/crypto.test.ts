import { describe, expect, it } from "vitest";

import {
  decryptMessage,
  decryptThreadKey,
  encryptMessage,
  encryptThreadKey,
  exportPrivateKeyJwk,
  exportPublicKeyJwk,
  exportThreadKeyRaw,
  generateKeyPair,
  generateThreadKey,
  importPrivateKeyJwk,
  importPublicKeyJwk,
  importThreadKeyRaw,
} from "./crypto";

describe("message encryption (AES-256-GCM)", () => {
  it("round-trips plaintext, including non-ASCII text", async () => {
    const threadKey = await generateThreadKey();
    const plaintext = "Second shooter needed — Saturday 4pm 📷";

    const ciphertext = await encryptMessage(threadKey, plaintext);

    expect(ciphertext).not.toContain(plaintext);
    await expect(decryptMessage(threadKey, ciphertext)).resolves.toBe(plaintext);
  });

  it("uses a fresh IV, so the same plaintext encrypts differently each time", async () => {
    const threadKey = await generateThreadKey();

    const first = await encryptMessage(threadKey, "hello");
    const second = await encryptMessage(threadKey, "hello");

    expect(first).not.toBe(second);
  });

  it("rejects ciphertext encrypted under a different thread key", async () => {
    const ciphertext = await encryptMessage(await generateThreadKey(), "hello");

    await expect(
      decryptMessage(await generateThreadKey(), ciphertext),
    ).rejects.toThrow();
  });

  it("rejects tampered ciphertext", async () => {
    const threadKey = await generateThreadKey();
    const ciphertext = await encryptMessage(threadKey, "hello");
    const bytes = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff;
    const tampered = btoa(String.fromCharCode(...bytes));

    await expect(decryptMessage(threadKey, tampered)).rejects.toThrow();
  });
});

describe("thread key import/export", () => {
  it("re-imports an exported raw thread key that decrypts existing messages", async () => {
    const threadKey = await generateThreadKey();
    const ciphertext = await encryptMessage(threadKey, "hello");

    const raw = await exportThreadKeyRaw(threadKey);
    const imported = await importThreadKeyRaw(raw);

    expect(raw.byteLength).toBe(32);
    await expect(decryptMessage(imported, ciphertext)).resolves.toBe("hello");
  });
});

describe("thread key wrapping (ECDH P-256)", () => {
  it("wraps a thread key so only the recipient's private key unwraps it", async () => {
    const recipient = await generateKeyPair();
    const recipientPublicJwk = await exportPublicKeyJwk(recipient.publicKey);
    const threadKey = await generateThreadKey();
    const ciphertext = await encryptMessage(threadKey, "hello");

    const wrapped = await encryptThreadKey(threadKey, recipientPublicJwk);
    const unwrapped = await decryptThreadKey(wrapped, recipient.privateKey);

    await expect(decryptMessage(unwrapped, ciphertext)).resolves.toBe("hello");
  });

  it("cannot be unwrapped with another user's private key", async () => {
    const recipient = await generateKeyPair();
    const stranger = await generateKeyPair();
    const wrapped = await encryptThreadKey(
      await generateThreadKey(),
      await exportPublicKeyJwk(recipient.publicKey),
    );

    await expect(decryptThreadKey(wrapped, stranger.privateKey)).rejects.toThrow();
  });

  it("works with a private key restored from its JWK backup", async () => {
    const recipient = await generateKeyPair();
    const restoredPrivateKey = await importPrivateKeyJwk(
      await exportPrivateKeyJwk(recipient.privateKey),
    );
    const restoredPublicKey = await importPublicKeyJwk(
      await exportPublicKeyJwk(recipient.publicKey),
    );
    const threadKey = await generateThreadKey();
    const ciphertext = await encryptMessage(threadKey, "hello");

    const wrapped = await encryptThreadKey(
      threadKey,
      await exportPublicKeyJwk(restoredPublicKey),
    );
    const unwrapped = await decryptThreadKey(wrapped, restoredPrivateKey);

    await expect(decryptMessage(unwrapped, ciphertext)).resolves.toBe("hello");
  });
});
