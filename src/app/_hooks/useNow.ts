"use client";

import { useEffect, useState } from "react";

/**
 * The current time as state, refreshed every `everyMs`. For anything on
 * screen that depends on "now" (is this event over? can this booking be
 * completed yet?): rendering stays pure, and the screen catches up by itself
 * when the moment passes while the page is open.
 */
export function useNow(everyMs = 60_000): Date {
    const [now, setNow] = useState(() => new Date());

    useEffect(() => {
        const timer = setInterval(() => setNow(new Date()), everyMs);
        return () => clearInterval(timer);
    }, [everyMs]);

    return now;
}
