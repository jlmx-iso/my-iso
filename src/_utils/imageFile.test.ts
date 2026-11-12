import { describe, expect, it } from "vitest";

import { ErrorReason } from "./errorReason";
import {
  IMAGE_ACCEPT,
  IMAGE_TOO_LARGE_MESSAGE,
  IMAGE_UPLOAD_FAILED_MESSAGE,
  IMAGE_WRONG_TYPE_MESSAGE,
  imageFileError,
  imageFileProblem,
  uploadErrorMessage,
} from "./imageFile";
import { MAX_IMAGE_BYTES } from "./limits";

const trpcError = (message: string, code: string, extra: Record<string, unknown> = {}) =>
  Object.assign(new Error(message), { data: { code, zodError: null, ...extra } });

describe("imageFileProblem", () => {
  it("accepts exactly what the server accepts", () => {
    expect(IMAGE_ACCEPT).toEqual(["image/jpeg", "image/png", "image/webp"]);
    for (const type of IMAGE_ACCEPT) {
      expect(imageFileProblem({ size: 1024, type })).toBeNull();
    }
    expect(imageFileProblem({ size: MAX_IMAGE_BYTES, type: "image/png" })).toBeNull();
  });

  it("refuses other types, including images the server cannot take", () => {
    for (const type of ["image/gif", "image/heic", "image/svg+xml", "application/pdf", ""]) {
      expect(imageFileProblem({ size: 1024, type })).toBe("wrong_type");
    }
    expect(imageFileError({ size: 1024, type: "image/gif" })).toBe(IMAGE_WRONG_TYPE_MESSAGE);
  });

  it("refuses a file over the size limit", () => {
    expect(imageFileProblem({ size: MAX_IMAGE_BYTES + 1, type: "image/jpeg" })).toBe("too_large");
    expect(imageFileError({ size: MAX_IMAGE_BYTES + 1, type: "image/jpeg" })).toBe(IMAGE_TOO_LARGE_MESSAGE);
  });
});

describe("uploadErrorMessage", () => {
  it("uses the picker's words for the two file problems the server reports", () => {
    expect(uploadErrorMessage(trpcError("Image is too large (maximum 5 MB).", "PAYLOAD_TOO_LARGE"))).toBe(
      IMAGE_TOO_LARGE_MESSAGE,
    );
    expect(
      uploadErrorMessage(
        trpcError("[]", "BAD_REQUEST", { zodError: { fieldErrors: { image: ["Image is too large (maximum 5 MB)."] }, formErrors: [] } }),
      ),
    ).toBe(IMAGE_TOO_LARGE_MESSAGE);
    expect(uploadErrorMessage(trpcError("Only JPEG, PNG and WebP images are supported.", "BAD_REQUEST"))).toBe(
      IMAGE_WRONG_TYPE_MESSAGE,
    );
  });

  it("passes on the portfolio-full message and rate-limit waits", () => {
    const full = "A portfolio can hold at most 60 images. Remove one to add another.";
    expect(uploadErrorMessage(trpcError(full, "BAD_REQUEST", { reason: ErrorReason.PORTFOLIO_FULL }))).toBe(full);
    expect(uploadErrorMessage(trpcError("Too many requests. Try again in 12 minutes.", "TOO_MANY_REQUESTS"))).toBe(
      "Too many requests. Try again in 12 minutes.",
    );
  });

  it("falls back to a plain failure message", () => {
    expect(uploadErrorMessage(trpcError("Cloudinary exploded", "INTERNAL_SERVER_ERROR"))).toBe(
      IMAGE_UPLOAD_FAILED_MESSAGE,
    );
    expect(uploadErrorMessage(new Error("boom"), "Photo not uploaded.")).toBe("Photo not uploaded.");
  });
});
