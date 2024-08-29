// app/providers.js
'use client'
import posthog from 'posthog-js'
import { PostHogProvider } from 'posthog-js/react'
import cookie from 'cookie-light'
import { env } from '~/env'

if (typeof window !== 'undefined') {
    const flags = cookie.get('bootstrapData');

    let bootstrapData = {}
    if (flags) {
        bootstrapData = JSON.parse(flags) as { featureFlags: Record<string, boolean> }
    }

    posthog.init(env.NEXT_PUBLIC_POSTHOG_PUBLIC_KEY, {
        api_host: env.NEXT_PUBLIC_POSTHOG_HOST,
        debug: false, // set to true to see debug logs
        bootstrap: bootstrapData,

    })
}

export function CSPostHogProvider({ children }: { children: React.ReactNode }) {
    return <PostHogProvider client={posthog}> {children} </PostHogProvider>
}