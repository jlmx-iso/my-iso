import { getFeatureFlag } from "~/server/_lib/posthog";

export type FlagValue = boolean | string | undefined

export const FeatureFlags = {
    ADMIN_SCORING: 'admin-scoring',
    ASYMMETRIC_INVITES: 'asymmetric-invites',
    DISCOVER_INVITE_CTA: 'discover-invite-cta',
    EMAIL_SEQUENCES: 'email-sequences',
    FOUNDING_CLOSE: 'founding-close',
    FOUNDING_LANDING: 'founding-landing',
    INVITE_ONLY: 'invite-only',
    WAITLIST_REFERRALS: 'waitlist-referrals',
} as const;

export type FeatureFlags = typeof FeatureFlags[keyof typeof FeatureFlags];

/**
 * The value of a feature flag for `distinctUserId`, evaluated by PostHog on
 * the server: `true` or a variant name when on, `false` when the flag is
 * active and off for this id, `undefined` when there is no value (the flag
 * is missing or disabled, or PostHog was unreachable). Throws when PostHog
 * is not configured.
 *
 * The caller decides what is safe. Sign-up, for one, stays invite-only
 * unless the invite-only flag is explicitly `false` (see ~/auth).
 */
export async function getFeatureFlagVariant(
    distinctUserId: string,
    featureName: FeatureFlags
): Promise<FlagValue> {
    if (!distinctUserId) {
        throw new Error(`distinctUserId is required and it can't be empty`)
    }

    return getFeatureFlag(featureName, distinctUserId)
}
