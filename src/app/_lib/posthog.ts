import { logger } from "~/_utils";
import { env } from "~/env";

export type FeatureFlagData = {
    featureFlags: Record<string, boolean>
}

export type FlagValue = boolean | string | undefined

export type FlagsMatcher = Record<string, undefined | {
    name: FeatureFlags
    rewrite(value: FlagValue, urlPath: string): string
}>

export const FeatureFlags = {
    IS_APP_DISABLED: 'is_app_disabled',
} as const;

export type FeatureFlags = typeof FeatureFlags[keyof typeof FeatureFlags];

export const DISTINCT_ID_COOKIE_NAME = "distinct_id";


export async function getFeatureFlagVariant(
    distinctUserId: string,
    featureName: FeatureFlags
): Promise<FlagValue> {
    if (!distinctUserId) {
        throw new Error(`distinctUserId is required and it can't be empty`)
    }

    const res = await fetch(`${env.NEXT_PUBLIC_POSTHOG_HOST}/decide?v=3`, {
        body: JSON.stringify({
            api_key: env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY,
            distinct_id: distinctUserId,
        }),
        method: 'POST',
    })

    if (!res.ok) {
        throw new Error(
            `Fetch request to retrieve the ${featureName} flag status failed with: (${res.status}) ${res.statusText}`
        )
    }

    const data = await res.json() as FeatureFlagData;

    logger.info("Feature flags data", data)

    return data.featureFlags[featureName]
}