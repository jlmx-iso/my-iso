import { z } from "zod";

/**
 * Handles appear in URLs (/photographer/<handle>), so the names of routes
 * and of roles someone could impersonate are not available.
 */
export const RESERVED_HANDLES: ReadonlySet<string> = new Set([
  "about",
  "account",
  "admin",
  "administrator",
  "api",
  "app",
  "auth",
  "billing",
  "contact",
  "dashboard",
  "discover",
  "events",
  "help",
  "home",
  "invite",
  "invites",
  "iso",
  "join",
  "login",
  "logout",
  "me",
  "messages",
  "moderator",
  "myiso",
  "new",
  "null",
  "official",
  "onboarding",
  "photographer",
  "photographers",
  "pricing",
  "privacy",
  "register",
  "root",
  "search",
  "security",
  "settings",
  "signin",
  "signup",
  "staff",
  "support",
  "system",
  "team",
  "terms",
  "undefined",
  "verify",
  "waitlist",
  "webhooks",
  "www",
]);

export const HANDLE_MIN_LENGTH = 3;
export const HANDLE_MAX_LENGTH = 30;

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
      .regex(/^[a-z0-9_]+$/, "Handle may only contain letters, numbers and underscores.")
      .refine((value) => !RESERVED_HANDLES.has(value), "That handle is not available."),
  );
