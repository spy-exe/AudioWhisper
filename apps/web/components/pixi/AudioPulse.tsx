"use client";

import { useEffect, useRef } from "react";
import type { Application, Graphics, Ticker } from "pixi.js";

import { useReducedMotion } from "@/hooks/useReducedMotion";

interface AudioPulseProps {
  /** 0..1 — ambient hum at rest, full energy while dragging/transcribing. */
  intensity?: number;
  /** 0..1 real job progress — when provided, a sweep line reflects actual completion instead
   * of being purely decorative. */
  progress?: number;
  disabled?: boolean;
  className?: string;
}

const BAR_COUNT = 56;
const MAX_DPR = 2;

/** PixiJS is a 2D WebGL/WebGPU renderer — far cheaper than a 3D particle scene, which matters
 * here because these two surfaces (drag feedback, live processing) run *while* the RTX is
 * actually busy transcribing. Three.js is reserved for a single marquee scene elsewhere
 * (see components/three/HeroScene.tsx) instead of being sprinkled in as generic decoration. */
export function AudioPulse({ intensity = 0.25, progress, disabled = false, className }: AudioPulseProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const intensityRef = useRef(intensity);
  const progressRef = useRef(progress);
  const reducedMotion = useReducedMotion(disabled);

  useEffect(() => {
    intensityRef.current = intensity;
  }, [intensity]);
  useEffect(() => {
    progressRef.current = progress;
  }, [progress]);

  useEffect(() => {
    if (reducedMotion || !containerRef.current) return;
    const host = containerRef.current;
    let destroyed = false;
    let app: Application | null = null;
    let ticker: (() => void) | null = null;

    (async () => {
      const { Application, Graphics, Container } = await import("pixi.js");

      const instance = new Application();
      await instance.init({
        resizeTo: host,
        antialias: true,
        backgroundAlpha: 0,
        resolution: Math.min(window.devicePixelRatio || 1, MAX_DPR),
        autoDensity: true,
        powerPreference: "low-power",
      });
      if (destroyed) {
        instance.destroy(true, { children: true });
        return;
      }
      app = instance;
      host.appendChild(instance.canvas);

      const colorA = { r: 0x5b, g: 0x8c, b: 0xff };
      const colorB = { r: 0x6c, g: 0xf2, b: 0xc4 };
      const lerpColor = (t: number) => {
        const r = Math.round(colorA.r + (colorB.r - colorA.r) * t);
        const g = Math.round(colorA.g + (colorB.g - colorA.g) * t);
        const b = Math.round(colorA.b + (colorB.b - colorA.b) * t);
        return (r << 16) + (g << 8) + b;
      };

      const barsContainer = new Container();
      instance.stage.addChild(barsContainer);
      const bars: Graphics[] = [];
      const phases = new Array(BAR_COUNT).fill(0).map(() => Math.random() * Math.PI * 2);
      const jitter = new Array(BAR_COUNT).fill(0).map(() => 0.6 + Math.random() * 0.4);
      for (let i = 0; i < BAR_COUNT; i++) {
        const bar = new Graphics();
        barsContainer.addChild(bar);
        bars.push(bar);
      }

      const sweep = new Graphics();
      instance.stage.addChild(sweep);

      let elapsed = 0;
      const onTick = (ticker: Ticker) => {
        elapsed += ticker.deltaTime / 60;
        const w = instance.screen.width;
        const h = instance.screen.height;
        const gap = w / BAR_COUNT;
        const barWidth = Math.max(1.5, gap * 0.55);
        const amp = intensityRef.current;

        for (let i = 0; i < BAR_COUNT; i++) {
          const bar = bars[i];
          if (!bar) continue;
          const t = i / (BAR_COUNT - 1);
          const wave =
            Math.sin(elapsed * 1.8 + (phases[i] ?? 0)) * 0.5 +
            Math.sin(elapsed * 3.1 * (jitter[i] ?? 1) + (phases[i] ?? 0) * 1.7) * 0.3 +
            0.5;
          const barHeight = Math.max(2, wave * h * 0.42 * (0.15 + amp * 0.85));
          bar.clear();
          bar.roundRect(i * gap + (gap - barWidth) / 2, h / 2 - barHeight / 2, barWidth, barHeight, barWidth / 2);
          bar.fill({ color: lerpColor(t), alpha: 0.35 + amp * 0.55 });
        }

        sweep.clear();
        const p = progressRef.current;
        if (p !== undefined && p > 0) {
          const x = w * Math.min(1, p);
          sweep.rect(0, 0, x, h);
          sweep.fill({ color: 0x6cf2c4, alpha: 0.06 });
          sweep.rect(x - 1, 0, 2, h);
          sweep.fill({ color: 0x6cf2c4, alpha: 0.5 });
        }
      };

      instance.ticker.add(onTick);

      const onVisibility = () => {
        if (document.visibilityState === "visible") instance.ticker.start();
        else instance.ticker.stop();
      };
      document.addEventListener("visibilitychange", onVisibility);

      ticker = () => {
        instance.ticker.remove(onTick);
        document.removeEventListener("visibilitychange", onVisibility);
      };
    })();

    return () => {
      destroyed = true;
      ticker?.();
      if (app) {
        app.destroy(true, { children: true });
        app = null;
      }
      host.replaceChildren();
    };
  }, [reducedMotion]);

  if (reducedMotion) {
    return (
      <div
        aria-hidden
        className={className}
        style={{
          background:
            "radial-gradient(60% 60% at 50% 50%, color-mix(in srgb, var(--color-accent) 16%, transparent), transparent)",
        }}
      />
    );
  }

  return <div ref={containerRef} aria-hidden className={className} />;
}
