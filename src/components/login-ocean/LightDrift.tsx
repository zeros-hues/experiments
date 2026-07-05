'use client';

/**
 * Scene lighting plus drifting light shafts.
 *
 * The real lights are STATIC: one directional key (steep, from above,
 * bone-white) and a dim ambient. Nothing relights per frame. The drift
 * the eye perceives comes from a single translucent quad in the
 * background layer whose shader draws four vertical beams; each beam's
 * center wanders slowly with time (the "UV offset" approach from the
 * spec, done procedurally instead of with a texture). Additive, no
 * depth write, one draw call.
 *
 * Beam color is bone gray. The accent color stays reserved for the
 * hero's lure; sunlight in this world is colorless.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { INK } from './InkWashPipeline';
import { LAYERS } from './staging';

const vertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float uTime;
  uniform vec3 uColor;
  uniform float uIntensity;

  varying vec2 vUv;

  float beam(float x, float center, float halfWidth) {
    return smoothstep(halfWidth, 0.0, abs(x - center));
  }

  void main() {
    float x = vUv.x;
    float b = 0.0;
    b += beam(x, 0.20 + 0.030 * sin(uTime * 0.043 + 1.0), 0.050) * 0.9;
    b += beam(x, 0.38 + 0.026 * sin(uTime * 0.051 + 3.1), 0.030) * 0.7;
    b += beam(x, 0.56 + 0.034 * sin(uTime * 0.037 + 5.2), 0.065) * 1.0;
    b += beam(x, 0.76 + 0.028 * sin(uTime * 0.047 + 0.6), 0.038) * 0.8;

    // Shafts are born at the surface and dissolve downward.
    float fade = smoothstep(0.0, 0.3, vUv.y) * (0.3 + 0.7 * vUv.y);
    float a = b * fade * uIntensity;
    gl_FragColor = vec4(uColor * a, a);
  }
`;

export interface LightDriftProps {
  /** Overall shaft brightness. Keep low; they should be felt, not seen. */
  intensity?: number;
  /** Pass 0 to freeze the drift (prefers-reduced-motion). */
  motionScale?: number;
}

export function LightDrift({
  intensity = 0.32,
  motionScale = 1,
}: LightDriftProps) {
  const shaftMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        vertexShader,
        fragmentShader,
        uniforms: {
          uTime: { value: 0 },
          uColor: { value: new THREE.Color(INK.bone) },
          uIntensity: { value: intensity },
        },
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    [intensity]
  );

  useFrame((state) => {
    shaftMaterial.uniforms.uTime.value =
      state.clock.getElapsedTime() * motionScale;
  });

  return (
    <group>
      <ambientLight color={INK.pale} intensity={0.25} />
      <directionalLight
        position={[5, 14, -4]}
        color={INK.bone}
        intensity={2.2}
      />
      <mesh
        material={shaftMaterial}
        position={[-2, 4, LAYERS.background.z + 2]}
        rotation={[0, 0, 0.1]}
        renderOrder={-1}
      >
        <planeGeometry args={[44, 22]} />
      </mesh>
    </group>
  );
}
