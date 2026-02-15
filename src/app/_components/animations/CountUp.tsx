"use client";

import { useEffect, useRef, useState } from "react";
import { useInView } from "framer-motion";

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
  className?: string;
  style?: React.CSSProperties;
}

export function CountUp({
  target,
  suffix = "",
  prefix = "",
  formatted = true,
  duration = 1600,
  className,
  style,
}: CountUpProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });
  const [display, setDisplay] = useState(0);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isInView || hasAnimated.current) return;
    hasAnimated.current = true;

    const start = performance.now();

    function tick(now: number) {
      const elapsed = now - start;
      const progress = Math.min(elapsed / duration, 1);
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay(Math.round(eased * target));

      if (progress < 1) {
        requestAnimationFrame(tick);
      }
    }

    requestAnimationFrame(tick);
  }, [isInView, target, duration]);

  const formattedValue = formatted
    ? display.toLocaleString("en-US")
    : String(display);

  return (
    <span ref={ref} className={className} style={style}>
      {prefix}
      {formattedValue}
      {suffix}
    </span>
  );
}
