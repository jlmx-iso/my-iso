/**
 * Limits the server enforces and the client shows (character counters,
 * upload hints, duration choices). Kept here, free of server imports, so
 * both sides read the same numbers.
 */

/** Longest comment on an event, in characters. */
export const MAX_COMMENT_LENGTH = 2000;

/** Longest message body, in characters. */
export const MAX_MESSAGE_LENGTH = 5000;

/** An event lasts a whole number of hours, from 1 to this many. */
export const MAX_EVENT_DURATION_HOURS = 72;

/** Largest uploaded image, in bytes once decoded. */
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/** The image types the server accepts (it checks the file's leading bytes). */
export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedImageType = (typeof ACCEPTED_IMAGE_TYPES)[number];

/** Portfolio images one photographer may have (deleted ones do not count). */
export const MAX_PORTFOLIO_IMAGES = 60;

/** Wrong guesses a sign-in code survives; the last one invalidates it. */
export const OTP_MAX_ATTEMPTS = 5;

/** How long an emailed sign-in code works. */
export const OTP_TTL_MINUTES = 10;

/** Bounds of `search.searchAll` paging: rows per request and how deep it goes. */
export const SEARCH_MAX_LIMIT = 50;
export const SEARCH_MAX_OFFSET = 1000;
