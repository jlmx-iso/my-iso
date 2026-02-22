"use client";

import { type ReactNode } from "react";
import { motion } from "framer-motion";

interface FadeInOnScrollProps {
  children: ReactNode;
  delay?: number;
  /** Vertical distance in pixels to translate from. Default 24. */
  y?: number;
  /** Animation duration in seconds. Default 0.6. */
  duration?: number;
  /** Slide direction — "up" (default), "left", or "right". */
  direction?: "up" | "left" | "right";
  className?: string;
}

export function FadeInOnScroll({
  children,
  delay = 0,
  y = 24,
  duration = 0.6,
  direction = "up",
  className,
}: FadeInOnScrollProps) {
  const initialOffset = {
    up: { opacity: 0, y },
    left: { opacity: 0, x: -y },
    right: { opacity: 0, x: y },
  };

  const animateTarget = {
    up: { opacity: 1, y: 0 },
    left: { opacity: 1, x: 0 },
    right: { opacity: 1, x: 0 },
  };

  return (
    <motion.div
      initial={initialOffset[direction]}
      whileInView={animateTarget[direction]}
      viewport={{ once: true, amount: 0.1 }}
      transition={{
        duration,
        delay,
        ease: [0.25, 0.1, 0.25, 1],
      }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
