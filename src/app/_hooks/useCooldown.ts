"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { startCooldown } from "~/_utils/cooldown";

/**
 * Countdown in whole seconds, for "resend in 30s" style controls.
 * `start()` (re)starts it; `remaining` reaches 0 when the action is allowed.
 */
export function useCooldown(seconds: number) {
  const [remaining, setRemaining] = useState(0);
  const stop = useRef<(() => void) | null>(null);

  const start = useCallback(() => {
    stop.current?.();
    stop.current = startCooldown(seconds, setRemaining);
  }, [seconds]);

  // Leaving the screen ends the countdown's timer.
  useEffect(() => () => stop.current?.(), []);

  return { remaining, start };
}
