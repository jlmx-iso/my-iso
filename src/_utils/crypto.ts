/**
 * Client-only WebCrypto helpers for E2EE messaging.
 *
 * All operations use the browser's native SubtleCrypto API.
 * No secrets ever leave the client unencrypted.
 */

const ECDH_PARAMS: EcKeyGenParams = { name: "ECDH", namedCurve: "P-256" };
const AES_GCM_PARAMS = { name: "AES-GCM", length: 256 } as const;

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]!);
  }
  return btoa(binary);
}

// ---------------------------------------------------------------------------
// Key pair (ECDH P-256)
// ---------------------------------------------------------------------------

export async function generateKeyPair(): Promise<CryptoKeyPair> {
  return crypto.subtle.generateKey(ECDH_PARAMS, true, ["deriveKey", "deriveBits"]);
}

export async function exportPublicKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key);
}

export async function exportPrivateKeyJwk(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey("jwk", key);
}

export async function importPublicKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, true, []);
}

export async function importPrivateKeyJwk(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey("jwk", jwk, ECDH_PARAMS, false, ["deriveKey", "deriveBits"]);
}

// ---------------------------------------------------------------------------
// Thread key (AES-256-GCM)
// ---------------------------------------------------------------------------

export async function generateThreadKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(AES_GCM_PARAMS, true, ["encrypt", "decrypt"]);
}

export async function exportThreadKeyRaw(key: CryptoKey): Promise<ArrayBuffer> {
  return crypto.subtle.exportKey("raw", key);
}

export async function importThreadKeyRaw(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", raw, AES_GCM_PARAMS, true, ["encrypt", "decrypt"]);
}

// ---------------------------------------------------------------------------
// Message encryption/decryption (AES-256-GCM)
// Format: base64( 12-byte-IV || AES-GCM-ciphertext )
// ---------------------------------------------------------------------------

export async function encryptMessage(threadKey: CryptoKey, plaintext: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const ciphertext = await crypto.subtle.encrypt({ iv, name: "AES-GCM" }, threadKey, encoded);
  const combined = new Uint8Array(iv.byteLength + ciphertext.byteLength);
  combined.set(iv, 0);
  combined.set(new Uint8Array(ciphertext), iv.byteLength);
  return uint8ToBase64(combined);
}

export async function decryptMessage(threadKey: CryptoKey, encrypted: string): Promise<string> {
  const bytes = Uint8Array.from(atob(encrypted), (c) => c.charCodeAt(0));
  const iv = bytes.slice(0, 12);
  const ciphertext = bytes.slice(12);
  const plaintext = await crypto.subtle.decrypt({ iv, name: "AES-GCM" }, threadKey, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ---------------------------------------------------------------------------
// Thread key wrapping (ephemeral ECDH + HKDF + AES-KW)
// Format: base64( ephemeralPubRaw(65 bytes) || AES-KW-wrapped-thread-key )
// ---------------------------------------------------------------------------

async function deriveWrappingKey(
  ephemeralPrivate: CryptoKey,
  recipientPublic: CryptoKey,
): Promise<CryptoKey> {
  const sharedBits = await crypto.subtle.deriveBits(
    { name: "ECDH", public: recipientPublic },
    ephemeralPrivate,
    256,
  );
  // HKDF to derive a 256-bit AES-KW key
  const hkdfKey = await crypto.subtle.importKey("raw", sharedBits, "HKDF", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    {
      hash: "SHA-256",
      info: new TextEncoder().encode("thread-key-wrapping"),
      name: "HKDF",
      salt: new Uint8Array(32),
    },
    hkdfKey,
    { length: 256, name: "AES-KW" },
    false,
    ["wrapKey", "unwrapKey"],
  );
}

export async function encryptThreadKey(
  threadKey: CryptoKey,
  recipientPublicJwk: JsonWebKey,
): Promise<string> {
  const recipientPublic = await importPublicKeyJwk(recipientPublicJwk);
  const ephemeralPair = await generateKeyPair();
  const wrappingKey = await deriveWrappingKey(ephemeralPair.privateKey, recipientPublic);

  // Export ephemeral public key as raw (uncompressed, 65 bytes)
  const ephemeralPubRaw = new Uint8Array(
    await crypto.subtle.exportKey("raw", ephemeralPair.publicKey),
  );

  // Wrap the thread key
  const wrapped = new Uint8Array(
    await crypto.subtle.wrapKey("raw", threadKey, wrappingKey, "AES-KW"),
  );

  const combined = new Uint8Array(ephemeralPubRaw.byteLength + wrapped.byteLength);
  combined.set(ephemeralPubRaw, 0);
  combined.set(wrapped, ephemeralPubRaw.byteLength);
  return uint8ToBase64(combined);
}

export async function decryptThreadKey(
  encryptedKey: string,
  recipientPrivateKey: CryptoKey,
): Promise<CryptoKey> {
  const bytes = Uint8Array.from(atob(encryptedKey), (c) => c.charCodeAt(0));
  // Uncompressed P-256 public key = 65 bytes
  const ephemeralPubRaw = bytes.slice(0, 65);
  const wrapped = bytes.slice(65);

  const ephemeralPublic = await crypto.subtle.importKey(
    "raw",
    ephemeralPubRaw,
    ECDH_PARAMS,
    true,
    [],
  );
  const wrappingKey = await deriveWrappingKey(recipientPrivateKey, ephemeralPublic);

  return crypto.subtle.unwrapKey(
    "raw",
    wrapped,
    wrappingKey,
    "AES-KW",
    AES_GCM_PARAMS,
    true,
    ["encrypt", "decrypt"],
  );
}
