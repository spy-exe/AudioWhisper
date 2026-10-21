"use client";

import { useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

interface SpectralFieldProps {
  intensity: number; // 0..1, drives displacement amplitude (idle hum -> active waveform)
  speed: number; // multiplier on animation rate; throttled during active transcription
  colorA: string;
  colorB: string;
}

const GRID_SIZE = 48;

export function SpectralField({ intensity, speed, colorA, colorB }: SpectralFieldProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const clockOffset = useRef(Math.random() * 1000);

  const { positions, basePositions, colors } = useMemo(() => {
    const count = GRID_SIZE * GRID_SIZE;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    const a = new THREE.Color(colorA);
    const b = new THREE.Color(colorB);

    let i = 0;
    for (let x = 0; x < GRID_SIZE; x++) {
      for (let z = 0; z < GRID_SIZE; z++) {
        const px = (x / (GRID_SIZE - 1) - 0.5) * 10;
        const pz = (z / (GRID_SIZE - 1) - 0.5) * 10;
        positions[i * 3] = px;
        positions[i * 3 + 1] = 0;
        positions[i * 3 + 2] = pz;

        const t = x / GRID_SIZE;
        const c = a.clone().lerp(b, t);
        colors[i * 3] = c.r;
        colors[i * 3 + 1] = c.g;
        colors[i * 3 + 2] = c.b;
        i += 1;
      }
    }
    return { positions, basePositions: positions.slice(), colors };
  }, [colorA, colorB]);

  useFrame((state) => {
    const points = pointsRef.current;
    if (!points) return;
    const time = state.clock.elapsedTime * speed + clockOffset.current;
    const posAttr = points.geometry.getAttribute("position") as THREE.BufferAttribute;

    for (let i = 0; i < GRID_SIZE * GRID_SIZE; i++) {
      const x = basePositions[i * 3] ?? 0;
      const z = basePositions[i * 3 + 2] ?? 0;
      const wave =
        Math.sin(x * 0.9 + time) * 0.5 +
        Math.cos(z * 0.7 + time * 1.3) * 0.5 +
        Math.sin((x + z) * 0.4 + time * 0.6) * 0.3;
      posAttr.setY(i, wave * (0.15 + intensity * 0.85));
    }
    posAttr.needsUpdate = true;
    points.rotation.y = Math.sin(time * 0.05) * 0.15;
  });

  return (
    <points ref={pointsRef}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.045} vertexColors transparent opacity={0.85} sizeAttenuation />
    </points>
  );
}
