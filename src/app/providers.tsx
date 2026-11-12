'use client'

import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import { useEffect } from 'react'

import { consentCapabilities, readBrowserConsent } from '~/_lib/consent'

export type AnalyticsUser = {
    email?: string | null
    id: string
    name?: string | null
}

/**
 * Ties PostHog's visitor to the signed-in user.
 *
 * The distinct id is the user id, never the email address. Email and name
 * are attached as person properties only with explicit analytics consent.
 * When nobody is signed in any more, the identity is reset so the next
 * person on this browser does not inherit it.
 *
 * PostHog itself is initialised in src/instrumentation-client.ts; without a
 * project token it is not loaded and this does nothing.
 */
function useAnalyticsIdentity(user: AnalyticsUser | null) {
    const id = user?.id ?? null
    const email = user?.email ?? null
    const name = user?.name ?? null

    useEffect(() => {
        if (!posthog.__loaded) return

        const capabilities = consentCapabilities(readBrowserConsent())
        if (!capabilities.capture) return

        if (id === null) {
            if (posthog._isIdentified()) posthog.reset()
            return
        }

        if (capabilities.personProperties) {
            posthog.identify(id, { ...(email ? { email } : {}), ...(name ? { name } : {}) })
        } else {
            // A repeat call with the same id sends nothing.
            posthog.identify(id)
        }
    }, [id, email, name])
}

export function CSPostHogProvider({
    children,
    user = null,
}: {
    children: React.ReactNode
    user?: AnalyticsUser | null
}) {
    useAnalyticsIdentity(user)
    return <PostHogProvider client={posthog}>{children}</PostHogProvider>
}
