"use client";

import { type CSSProperties, Children, type ReactNode, useEffect, useRef, useState } from "react";

/**
 * Scroll reveals.
 *
 * The markup is rendered visible. The hidden "before" state lives in
 * `globals.css` and only applies once the inline script in the root layout has
 * set `data-reveal` on <html>, so the content is readable without JavaScript,
 * while it loads, and when the visitor prefers reduced motion.
 */

/** True once the element has scrolled into view (or cannot be observed). */
function useRevealed<T extends Element>() {
  const ref = useRef<T>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element || typeof IntersectionObserver === "undefined") {
      setRevealed(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setRevealed(true);
          observer.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return { ref, revealed };
}

type RevealStyle = CSSProperties & {
  "--reveal-x"?: string;
  "--reveal-y"?: string;
  "--reveal-delay"?: string;
  "--reveal-duration"?: string;
};

function revealStyle({
  delay,
  distance,
  direction,
  duration,
}: {
  delay: number;
  distance: number;
  direction: "up" | "left" | "right";
  duration: number;
}): RevealStyle {
  return {
    "--reveal-delay": `${Math.round(delay * 1000)}ms`,
    "--reveal-duration": `${Math.round(duration * 1000)}ms`,
    "--reveal-x": direction === "up" ? "0px" : `${direction === "left" ? -distance : distance}px`,
    "--reveal-y": direction === "up" ? `${distance}px` : "0px",
  };
}

interface FadeInOnScrollProps {
  children: ReactNode;
  /** Delay in seconds. */
  delay?: number;
  /** Distance in pixels to travel. Default 24. */
  y?: number;
  /** Animation duration in seconds. Default 0.6. */
  duration?: number;
  /** Slide direction — "up" (default), "left", or "right". */
  direction?: "up" | "left" | "right";
  className?: string;
  style?: CSSProperties;
}

/** Fades its children in when they scroll into view. For below-the-fold content only. */
export function FadeInOnScroll({
  children,
  delay = 0,
  y = 24,
  duration = 0.6,
  direction = "up",
  className,
  style,
}: FadeInOnScrollProps) {
  const { ref, revealed } = useRevealed<HTMLDivElement>();

  return (
    <div
      ref={ref}
      className={className ? `reveal ${className}` : "reveal"}
      data-revealed={revealed ? "" : undefined}
      style={{ ...revealStyle({ delay, direction, distance: y, duration }), ...style }}
    >
      {children}
    </div>
  );
}

interface StaggerContainerProps {
  children: ReactNode;
  /** Delay between each child animation in seconds. Default 0.12. */
  stagger?: number;
  /** Vertical distance for child fade-in. Default 24. */
  y?: number;
  /** Duration for each child animation in seconds. Default 0.6. */
  duration?: number;
  className?: string;
  style?: CSSProperties;
}

/** Reveals its children one after another when the container scrolls into view. */
export function StaggerContainer({
  children,
  stagger = 0.12,
  y = 24,
  duration = 0.6,
  className,
  style,
}: StaggerContainerProps) {
  const { ref, revealed } = useRevealed<HTMLDivElement>();

  return (
    <div ref={ref} className={className} style={style}>
      {Children.map(children, (child, index) => (
        <div
          className="reveal"
          data-revealed={revealed ? "" : undefined}
          style={revealStyle({ delay: index * stagger, direction: "up", distance: y, duration })}
        >
          {child}
        </div>
      ))}
    </div>
  );
}
