/**
 * Valid user roles for the invite system.
 *
 * - "standard" — default for users not yet in the invite system
 * - "founding_member" — joined via invite code during founding period
 * - "founder" — admin (Jordan, Penny)
 * - "ambassador" — trusted community member with admin-like access
 */
export const USER_ROLES = {
  STANDARD: "standard",
  FOUNDING_MEMBER: "founding_member",
  FOUNDER: "founder",
  AMBASSADOR: "ambassador",
} as const;

export type UserRole = (typeof USER_ROLES)[keyof typeof USER_ROLES];

/** Roles that grant founder/admin-level access */
export const ADMIN_ROLES: readonly UserRole[] = [
  USER_ROLES.FOUNDER,
  USER_ROLES.AMBASSADOR,
];

/** Special code used for waitlist-approved users (not tied to any invite code) */
export const WAITLIST_APPROVED_CODE = "WAITLIST_APPROVED";
