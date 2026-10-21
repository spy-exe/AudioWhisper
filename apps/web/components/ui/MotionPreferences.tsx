"use client";
import { MotionConfig } from "motion/react";
import { useEffect, type ReactNode } from "react";
import { useSettings } from "@/contexts/SettingsContext";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { MotionPreferenceContext } from "@/hooks/useMotionPreference";

export function MotionPreferences({ children }: { children: ReactNode }) {
  const { settings } = useSettings();
  const effectsOff = settings?.visual_effects_enabled === false;
  const reduced = useReducedMotion(effectsOff);
  useEffect(() => {
    document.documentElement.dataset.reducedMotion = String(reduced);
  }, [reduced]);
  return (
    <MotionPreferenceContext.Provider value={reduced}>
      <MotionConfig reducedMotion={reduced ? "always" : "user"}>{children}</MotionConfig>
    </MotionPreferenceContext.Provider>
  );
}
