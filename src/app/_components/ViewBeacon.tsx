"use client";

import { useEffect } from "react";

import type { ViewSource } from "~/_utils/viewSources";

type ViewBeaconProps = {
    kind: "profile" | "event";
    id: string;
    /** Decided by the server from the page request's referrer. */
    source: ViewSource;
};

/** Targets this page load has already reported: a remount or a return visit asks once. */
const sent = new Set<string>();

/**
 * Reports one view of a profile or event page for its owner's insights
 * (POST /api/views), once the page is on screen. The server decides whether
 * it counts (once per browser per day, never the owner, rate limited); the
 * answer is always empty. Renders nothing.
 */
export default function ViewBeacon({ kind, id, source }: ViewBeaconProps) {
    useEffect(() => {
        const key = `${kind}:${id}`;
        if (sent.has(key)) return;
        sent.add(key);
        void fetch("/api/views", {
            body: JSON.stringify({ id, kind, source }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            method: "POST",
        }).catch(() => undefined);
    }, [kind, id, source]);
    return null;
}
