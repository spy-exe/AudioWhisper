"use client";

import { useEffect, useState } from "react";

/** Combines the OS-level `prefers-reduced-motion` media query with the app's own
 * "disable visual effects" setting, so either one is sufficient to quiet animation. */
export function useReducedMotion(forcedOff = false): boolean {
  const [prefersReduced, setPrefersReduced] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    setPrefersReduced(query.matches);
    const listener = (e: MediaQueryListEvent) => setPrefersReduced(e.matches);
    query.addEventListener("change", listener);
    return () => query.removeEventListener("change", listener);
  }, []);

  return forcedOff || prefersReduced;
}
