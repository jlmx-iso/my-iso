"use client";

import { useEffect, useRef, useState } from "react";

interface CountUpProps {
  /** Target number to count up to. */
  target: number;
  /** Suffix to display after the number (e.g. "+"). */
  suffix?: string;
  /** Prefix to display before the number (e.g. "$"). */
  prefix?: string;
  /** Whether to format the number with commas. Default true. */
  formatted?: boolean;
  /** Duration of the count animation in ms. Default 1600. */
  duration?: number;
}

/**
 * Counts up to `target` when scrolled into view. The server HTML (and the
 * reduced-motion and no-JavaScript experience) shows the final number; screen
 * readers always get the final number rather than the animation frames.
 */
export function CountUp({
  target,
  suffix = "",
  prefix = "",
  formatted = true,
  duration = 1600,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const [display, setDisplay] = useState(target);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    let frame = 0;
    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        observer.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const progress = Math.min((now - start) / duration, 1);
          // Ease-out cubic
          setDisplay(Math.round((1 - Math.pow(1 - progress, 3)) * target));
          if (progress < 1) frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
      },
      { threshold: 0.1 },
    );
    observer.observe(element);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [target, duration]);

  const format = (value: number) =>
    `${prefix}${formatted ? value.toLocaleString("en-US") : String(value)}${suffix}`;

  return (
    <span ref={ref}>
      <span aria-hidden>{format(display)}</span>
      <span className="sr-only">{format(target)}</span>
    </span>
  );
}
