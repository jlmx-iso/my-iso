export const UserVerificationErrors = {
    TOKEN_EXPIRED: "Token expired",
    TOKEN_NOT_FOUND: "Token not found",
    USER_ALREADY_VERIFIED: "User already verified",
    USER_NOT_FOUND: "User not found",
} as const;

export type UserVerificationErrors = typeof UserVerificationErrors;