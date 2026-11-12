import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { type AcceptedImageType, MAX_IMAGE_BYTES } from "~/_utils/limits";
import { env } from "~/env";

/**
 * Validation for images uploaded as base64 through tRPC, and for image URLs
 * the app stores or fetches.
 */

export { MAX_IMAGE_BYTES };

/** Base64 length of MAX_IMAGE_BYTES, plus room for a `data:` URL prefix. */
export const MAX_IMAGE_BASE64_LENGTH = Math.ceil(MAX_IMAGE_BYTES / 3) * 4;
const MAX_IMAGE_INPUT_LENGTH = MAX_IMAGE_BASE64_LENGTH + 64;

export type ImageMime = AcceptedImageType;

export type ValidImage = {
  /** Bare base64 payload (no `data:` prefix). */
  base64: string;
  byteLength: number;
  /** Detected from the file's leading bytes, never taken from the client. */
  mime: ImageMime;
};

/** Cheap first line of defence: rejects oversized strings before any decoding. */
export const base64ImageInput = z.string().min(1).max(MAX_IMAGE_INPUT_LENGTH, {
  message: "Image is too large (maximum 5 MB).",
});

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((byte, index) => bytes[offset + index] === byte);
}

/** Identifies JPEG, PNG and WebP by their magic bytes. */
export function sniffImageType(bytes: Uint8Array): ImageMime | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  // "RIFF" <4-byte size> "WEBP"
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) {
    return "image/webp";
  }
  return null;
}

export type ImageRejection = "empty" | "not-base64" | "too-large" | "unsupported-type";

/**
 * Checks an uploaded image: well-formed base64, at most MAX_IMAGE_BYTES once
 * decoded, and really a JPEG, PNG or WebP. Accepts a bare base64 string or a
 * `data:` URL (whose declared type is ignored).
 */
export function parseBase64Image(
  input: string,
): { image: ValidImage; ok: true } | { ok: false; reason: ImageRejection } {
  const comma = input.startsWith("data:") ? input.indexOf(",") : -1;
  const base64 = (comma >= 0 ? input.slice(comma + 1) : input).trim();

  if (base64.length === 0) return { ok: false, reason: "empty" };
  if (base64.length > MAX_IMAGE_BASE64_LENGTH) return { ok: false, reason: "too-large" };
  if (base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64)) {
    return { ok: false, reason: "not-base64" };
  }

  const padding = base64.endsWith("==") ? 2 : base64.endsWith("=") ? 1 : 0;
  const byteLength = (base64.length / 4) * 3 - padding;
  if (byteLength > MAX_IMAGE_BYTES) return { ok: false, reason: "too-large" };

  // 16 base64 characters are the first 12 bytes: enough for every signature.
  const head = Uint8Array.from(atob(base64.slice(0, 16)), (char) => char.charCodeAt(0));
  const mime = sniffImageType(head);
  if (!mime) return { ok: false, reason: "unsupported-type" };

  return { image: { base64, byteLength, mime }, ok: true };
}

const REJECTION_MESSAGES: Record<ImageRejection, string> = {
  empty: "No image was provided.",
  "not-base64": "The image could not be read.",
  "too-large": "Image is too large (maximum 5 MB).",
  "unsupported-type": "Only JPEG, PNG and WebP images are supported.",
};

/** `parseBase64Image` for procedures: returns the image or throws a tRPC error. */
export function requireValidImage(input: string): ValidImage {
  const result = parseBase64Image(input);
  if (result.ok) return result.image;
  throw new TRPCError({
    code: result.reason === "too-large" ? "PAYLOAD_TOO_LARGE" : "BAD_REQUEST",
    message: REJECTION_MESSAGES[result.reason],
  });
}

/**
 * True only for an https URL of an image delivered from this app's own
 * Cloudinary cloud. This is the single allowlist for image URLs that are
 * stored on a profile or event, and for URLs the server fetches itself (the
 * Open Graph image route), which would otherwise be a request-forgery vector.
 */
export function isOwnCloudinaryUrl(
  value: string,
  cloudName: string = env.CLOUDINARY_CLOUD_NAME,
): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (
    cloudName.length > 0 &&
    url.protocol === "https:" &&
    url.hostname === "res.cloudinary.com" &&
    url.port === "" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname.startsWith(`/${cloudName}/image/upload/`)
  );
}

/** A stored image URL supplied by a client: must be on our Cloudinary cloud. */
export const ownImageUrlInput = z
  .string()
  .max(500)
  .refine((value) => isOwnCloudinaryUrl(value), {
    message: "Image must be uploaded through the app.",
  });

/** Website links: absolute http(s) URLs only (no javascript:, data:, etc.). */
export const websiteUrlInput = z
  .string()
  .trim()
  .max(500)
  .refine(
    (value) => {
      try {
        const url = new URL(value);
        return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
      } catch {
        return false;
      }
    },
    { message: "Website must be a valid http(s) URL." },
  );
