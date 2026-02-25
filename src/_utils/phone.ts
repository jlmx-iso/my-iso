import { z } from "zod";

/** Strip all non-digit chars and remove a leading country code of 1. */
export function normalizePhone(value: string): string {
  const digits = value.replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
}

export function isValidPhone(value: string): boolean {
  return normalizePhone(value).length === 10;
}

/**
 * Zod schema for a required US phone number.
 * Accepts any common format (dashes, spaces, parens, +1 prefix).
 * Normalizes to 10 digits before storing.
 */
export const phoneSchema = z
  .string()
  .min(1, "Phone number is required")
  .refine(isValidPhone, "Enter a valid 10-digit US phone number")
  .transform(normalizePhone);

/**
 * Zod schema for an optional US phone number.
 * If provided, must be a valid US phone number.
 */
export const phoneSchemaOptional = z
  .string()
  .refine(isValidPhone, "Enter a valid 10-digit US phone number")
  .transform(normalizePhone)
  .optional();
