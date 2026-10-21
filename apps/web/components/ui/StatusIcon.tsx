"use client";

/** Animated status glyph with a static equivalent for reduced motion. */

import { AnimatePresence, motion } from "motion/react";

import type { JobStatus } from "@/lib/types";
import { useMotionPreference } from "@/hooks/useMotionPreference";

type Family = "queued" | "working" | "transcribing" | "completed" | "failed" | "cancelled";

const FAMILY_BY_STATUS: Record<JobStatus, Family> = {
  queued: "queued",
  preparing: "working",
  extracting_audio: "working",
  loading_model: "working",
  transcribing: "transcribing",
  generating_exports: "working",
  completed: "completed",
  failed: "failed",
  cancelled: "cancelled",
};

const COLOR_BY_FAMILY: Record<Family, string> = {
  queued: "var(--color-text-muted)",
  working: "var(--color-accent)",
  transcribing: "var(--color-accent-spectral)",
  completed: "var(--color-success)",
  failed: "var(--color-danger)",
  cancelled: "var(--color-warning)",
};

interface StatusIconProps {
  status: JobStatus;
  size?: number;
  className?: string;
}

export function StatusIcon({ status, size = 20, className }: StatusIconProps) {
  const family = FAMILY_BY_STATUS[status];
  const color = COLOR_BY_FAMILY[family];
  const reduced = useMotionPreference();

  if (reduced) return (
    <span className={className} style={{ display: "inline-flex", width: size, height: size, color }} aria-hidden>
      <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        {family === "completed" ? <path d="M5 12.5l4.5 4.5L19 7" />
          : family === "failed" ? <path d="M7 7l10 10M17 7L7 17" />
          : family === "transcribing" ? <path d="M7 9v6m5-10v14m5-10v6" />
          : <><circle cx="12" cy="12" r="8" /><path d={family === "cancelled" ? "M7 17L17 7" : "M12 7v5l3 2"} /></>}
      </svg>
    </span>
  );

  return (
    <span
      className={className}
      style={{ display: "inline-flex", width: size, height: size, color }}
      aria-hidden
    >
      <AnimatePresence mode="wait" initial={false}>
        <motion.svg
          key={family}
          viewBox="0 0 24 24"
          width={size}
          height={size}
          initial={{ opacity: 0, scale: 0.6, rotate: -20 }}
          animate={{ opacity: 1, scale: 1, rotate: 0 }}
          exit={{ opacity: 0, scale: 0.6, rotate: 20 }}
          transition={{ type: "spring", stiffness: 400, damping: 22 }}
        >
          {family === "queued" && (
            <motion.circle
              cx="12"
              cy="12"
              r="5"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            />
          )}

          {family === "working" && (
            <motion.circle
              cx="12"
              cy="12"
              r="8"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeDasharray="14 10"
              animate={{ rotate: 360 }}
              transition={{ duration: 1.1, repeat: Infinity, ease: "linear" }}
              style={{ transformOrigin: "12px 12px" }}
            />
          )}

          {family === "transcribing" &&
            [0, 1, 2].map((i) => (
              <motion.rect
                key={i}
                x={7 + i * 5}
                y="8"
                width="2.6"
                height="8"
                rx="1.3"
                fill="currentColor"
                animate={{ scaleY: [0.4, 1, 0.4] }}
                transition={{
                  duration: 0.9,
                  repeat: Infinity,
                  ease: "easeInOut",
                  delay: i * 0.15,
                }}
                style={{ transformOrigin: "center" }}
              />
            ))}

          {family === "completed" && (
            <motion.path
              d="M5 12.5l4.5 4.5L19 7"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              initial={{ pathLength: 0 }}
              animate={{ pathLength: 1 }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          )}

          {family === "failed" && (
            <>
              <motion.line
                x1="7"
                y1="7"
                x2="17"
                y2="17"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.25 }}
              />
              <motion.line
                x1="17"
                y1="7"
                x2="7"
                y2="17"
                stroke="currentColor"
                strokeWidth="2.5"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.25, delay: 0.1 }}
              />
            </>
          )}

          {family === "cancelled" && (
            <>
              <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="2" />
              <motion.line
                x1="7"
                y1="17"
                x2="17"
                y2="7"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                initial={{ pathLength: 0 }}
                animate={{ pathLength: 1 }}
                transition={{ duration: 0.3 }}
              />
            </>
          )}
        </motion.svg>
      </AnimatePresence>
    </span>
  );
}

export const RiveStatusIcon = StatusIcon;
