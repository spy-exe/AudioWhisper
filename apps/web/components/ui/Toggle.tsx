"use client";

import { motion } from "motion/react";
import { useMotionPreference } from "@/hooks/useMotionPreference";

interface ToggleProps {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}

export function Toggle({ label, checked, onChange }: ToggleProps) {
  const reduced = useMotionPreference();
  return (
    <label className="flex items-center justify-between gap-4 text-sm text-text-secondary">
      {label}
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative h-11 w-14 shrink-0 rounded-lg"
      >
        <motion.span aria-hidden className="absolute inset-x-0 inset-y-2 rounded-full border border-border"
          animate={{ backgroundColor: checked ? "var(--color-accent)" : "var(--color-surface-interactive)" }}
          transition={{ duration: reduced ? 0 : 0.2 }} />
        <motion.span
          aria-hidden
          className="absolute top-3 left-0 h-5 w-5 rounded-full bg-background shadow-sm"
          animate={{ x: checked ? 31 : 5 }}
          transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
        />
      </button>
    </label>
  );
}
