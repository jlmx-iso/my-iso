"use client";

import { useEffect } from "react";

import type { ViewSource } from "~/_utils/viewSources";

type ViewBeaconProps = {
    kind: "profile" | "event";
    id: string;
    /** Decided by the server from the page request's referrer. */
    source: ViewSource;
    /** Issued by the server with `source`; without it the view counts under "other". */
    token: string;
};

/**
 * Targets this page load has already reported, per UTC day: a remount or a
 * return visit the same day asks once; a tab left open into the next day
 * asks again, as the server would count it again.
 */
const sent = new Set<string>();

/**
 * Reports one view of a profile or event page for its owner's insights
 * (POST /api/views), once the page is on screen. The server decides whether
 * it counts (once a day per viewer, never the owner, rate limited); the
 * answer is always empty. Renders nothing.
 */
export default function ViewBeacon({ kind, id, source, token }: ViewBeaconProps) {
    useEffect(() => {
        const key = `${new Date().toISOString().slice(0, 10)}|${kind}:${id}`;
        if (sent.has(key)) return;
        sent.add(key);
        void fetch("/api/views", {
            body: JSON.stringify({ id, kind, source, token }),
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            keepalive: true,
            method: "POST",
        }).catch(() => undefined);
    }, [kind, id, source, token]);
    return null;
}
