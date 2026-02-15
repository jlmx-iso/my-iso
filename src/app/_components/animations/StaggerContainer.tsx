"use client";

import { type ReactNode, Children } from "react";
import { motion } from "framer-motion";

interface StaggerContainerProps {
  children: ReactNode;
  /** Delay between each child animation. Default 0.12s. */
  stagger?: number;
  /** Vertical distance for child fade-in. Default 24. */
  y?: number;
  /** Duration for each child animation. Default 0.6s. */
  duration?: number;
  className?: string;
  style?: React.CSSProperties;
}

const containerVariants = (stagger: number) => ({
  hidden: {},
  visible: {
    transition: {
      staggerChildren: stagger,
    },
  },
});

const childVariants = (y: number, duration: number) => ({
  hidden: { opacity: 0, y },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration,
      ease: [0.25, 0.1, 0.25, 1] as [number, number, number, number],
    },
  },
});

export function StaggerContainer({
  children,
  stagger = 0.12,
  y = 24,
  duration = 0.6,
  className,
  style,
}: StaggerContainerProps) {
  return (
    <motion.div
      variants={containerVariants(stagger)}
      initial="hidden"
      whileInView="visible"
      viewport={{ once: true, amount: 0.1 }}
      className={className}
      style={style}
    >
      {Children.map(children, (child) => (
        <motion.div variants={childVariants(y, duration)}>{child}</motion.div>
      ))}
    </motion.div>
  );
}
