import { ErrorReason, getErrorReason } from "./errorReason";
import { ACCEPTED_IMAGE_TYPES, MAX_IMAGE_BYTES } from "./limits";
import { isRateLimited, trpcErrorCode, userFacingError } from "./userError";

/** For `<input accept>` and dropzones: exactly what the server accepts. */
export const IMAGE_ACCEPT: string[] = [...ACCEPTED_IMAGE_TYPES];
export const IMAGE_TYPES_LABEL = "JPEG, PNG or WebP";
export const MAX_IMAGE_MB = MAX_IMAGE_BYTES / 1024 ** 2;

export const IMAGE_WRONG_TYPE_MESSAGE = `That file type isn't supported. Choose a ${IMAGE_TYPES_LABEL} image.`;
export const IMAGE_TOO_LARGE_MESSAGE = `That image is larger than ${MAX_IMAGE_MB} MB. Choose a smaller one, or export it at a lower quality.`;
export const IMAGE_UPLOAD_FAILED_MESSAGE = "We couldn't upload that image. Please try again.";

export type ImageFileProblem = "wrong_type" | "too_large";

/** Checks a chosen file against the upload rules before anything is sent. */
export function imageFileProblem(file: { size: number; type: string }): ImageFileProblem | null {
  if (!IMAGE_ACCEPT.includes(file.type)) return "wrong_type";
  if (file.size > MAX_IMAGE_BYTES) return "too_large";
  return null;
}

/** Message for a file that fails `imageFileProblem`, or null when it is fine. */
export function imageFileError(file: { size: number; type: string }): string | null {
  const problem = imageFileProblem(file);
  if (problem === "wrong_type") return IMAGE_WRONG_TYPE_MESSAGE;
  if (problem === "too_large") return IMAGE_TOO_LARGE_MESSAGE;
  return null;
}

/**
 * Why an upload the server refused failed, in the same words the pickers use
 * for a file they refuse themselves.
 */
export function uploadErrorMessage(error: unknown, fallback: string = IMAGE_UPLOAD_FAILED_MESSAGE): string {
  if (getErrorReason(error) === ErrorReason.PORTFOLIO_FULL || isRateLimited(error)) {
    return userFacingError(error, fallback);
  }
  if (trpcErrorCode(error) === "PAYLOAD_TOO_LARGE") return IMAGE_TOO_LARGE_MESSAGE;
  const message = userFacingError(error, fallback);
  // The server's wording for the two file problems, mapped onto ours.
  if (/too large/i.test(message)) return IMAGE_TOO_LARGE_MESSAGE;
  if (/only jpeg, png and webp/i.test(message)) return IMAGE_WRONG_TYPE_MESSAGE;
  return message;
}
