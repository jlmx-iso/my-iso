import { z } from "zod";

import {
  HANDLE_CHARACTERS,
  HANDLE_MAX_LENGTH,
  HANDLE_MIN_LENGTH,
  RESERVED_HANDLES,
} from "~/_utils/handle";

// The rule itself lives in ~/_utils/handle, shared with the forms.
export { HANDLE_MAX_LENGTH, HANDLE_MIN_LENGTH, RESERVED_HANDLES };

/**
 * A profile handle: lowercased, 3-30 characters of a-z, 0-9 and underscore,
 * not a reserved word. A leading "@" is tolerated and dropped. Uniqueness is
 * enforced by the database (User.handle is unique).
 */
export const handleInput = z
  .string()
  .trim()
  .transform((value) => value.replace(/^@/, "").toLowerCase())
  .pipe(
    z
      .string()
      .min(HANDLE_MIN_LENGTH, `Handle must be at least ${HANDLE_MIN_LENGTH} characters.`)
      .max(HANDLE_MAX_LENGTH, `Handle must be at most ${HANDLE_MAX_LENGTH} characters.`)
      .regex(HANDLE_CHARACTERS, "Handle may only contain letters, numbers and underscores.")
      .refine((value) => !RESERVED_HANDLES.has(value), "That handle is not available."),
  );
