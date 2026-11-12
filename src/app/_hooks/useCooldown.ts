"use client";

import { useCallback, useEffect, useState } from "react";

/**
 * Countdown in whole seconds, for "resend in 30s" style controls.
 * `start()` (re)starts it; `remaining` reaches 0 when the action is allowed.
 */
export function useCooldown(seconds: number) {
  const [endsAt, setEndsAt] = useState<number | null>(null);
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (endsAt === null) return;
    const update = () => {
      const left = Math.max(0, Math.ceil((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) setEndsAt(null);
    };
    const interval = setInterval(update, 250);
    return () => clearInterval(interval);
  }, [endsAt]);

  const start = useCallback(() => {
    setRemaining(seconds);
    setEndsAt(Date.now() + seconds * 1000);
  }, [seconds]);

  return { remaining, start };
}
