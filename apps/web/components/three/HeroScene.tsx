"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { Suspense, useEffect, useRef, useState } from "react";
import type { Group } from "three";

import { useReducedMotion } from "@/hooks/useReducedMotion";

import { SpectralField } from "./SpectralField";

const MAX_DPR = 1.75;

/**
 * The single marquee Three.js moment in this app — a slow-orbiting ambient scene reserved for
 * the home page hero, where nothing else is competing for the GPU. Every other surface that
 * used to carry decorative 3D (upload feedback, live processing) now uses PixiJS instead,
 * which is dramatically cheaper and — because progress/drag state actually drives it — tied to
 * what the product is doing rather than being decoration for its own sake.
 */
function OrbitRig({ children }: { children: React.ReactNode }) {
  const group = useRef<Group>(null);
  useFrame((state) => {
    if (group.current) {
      group.current.rotation.y = Math.sin(state.clock.elapsedTime * 0.04) * 0.25;
      group.current.position.y = Math.sin(state.clock.elapsedTime * 0.3) * 0.15;
    }
  });
  return <group ref={group}>{children}</group>;
}

export function HeroScene({ className }: { className?: string }) {
  const [visible, setVisible] = useState(true);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, []);

  if (reducedMotion) {
    return (
      <div
        aria-hidden
        className={className}
        style={{
          background:
            "radial-gradient(55% 55% at 50% 35%, color-mix(in srgb, var(--color-accent-violet) 16%, transparent), transparent)",
        }}
      />
    );
  }

  return (
    <div aria-hidden className={className}>
      {visible && (
        <Canvas
          dpr={[1, MAX_DPR]}
          frameloop="always"
          camera={{ position: [0, 3.4, 7], fov: 42 }}
          gl={{ antialias: false, powerPreference: "low-power" }}
        >
          <Suspense fallback={null}>
            <fog attach="fog" args={["#14161b", 6, 13]} />
            <ambientLight intensity={0.7} />
            <OrbitRig>
              <SpectralField intensity={0.3} speed={0.6} colorA="#5b8cff" colorB="#9b8cff" />
            </OrbitRig>
          </Suspense>
        </Canvas>
      )}
    </div>
  );
}
