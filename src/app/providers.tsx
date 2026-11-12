'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'

import { type AnalyticsUser, syncAnalyticsUser } from '~/_lib/analyticsBrowser'

export type { AnalyticsUser } from '~/_lib/analyticsBrowser'

/**
 * Provides PostHog to the tree and keeps its identity in step with the
 * signed-in user (id only; see `syncAnalyticsUser`). PostHog itself is
 * started in src/instrumentation-client.ts; when it is not running (no
 * project token, or the visitor refused analytics) this does nothing.
 */
export function CSPostHogProvider({
    children,
    user = null,
}: {
    children: React.ReactNode
    user?: AnalyticsUser | null
}) {
    const id = user?.id ?? null

    useEffect(() => {
        syncAnalyticsUser(id === null ? null : { id })
    }, [id])

    return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
