export const UserVerificationErrors = {
    USER_NOT_FOUND: "User not found",
    USER_ALREADY_VERIFIED: "User already verified",
    TOKEN_NOT_FOUND: "Token not found",
    TOKEN_EXPIRED: "Token expired",
} as const;

export type UserVerificationErrors = typeof UserVerificationErrors;