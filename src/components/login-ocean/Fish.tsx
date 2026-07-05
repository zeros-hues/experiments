'use client';

/**
 * R3F component for a single procedural fish, plus the shared fish
 * material factory that Part 4's InstancedMesh swarm reuses.
 *
 * <Fish /> is meant for the hero (one draw call, own geometry, lure and
 * accent point light). The swarm must NOT render one <Fish /> per fish;
 * FishSwarm.tsx feeds transforms into a single InstancedMesh using the
 * same createFishMaterial, which is instancing-aware (per-instance swim
 * phase via gl_InstanceID, WebGL2 only, which Part 7 guarantees).
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { createInkToonMaterial } from './InkWashPipeline';
import {
  generateFish,
  type FishMaterialParams,
  type GeneratedFish,
} from './generateFish';

export interface FishUniforms {
  uTime: { value: number };
  uWiggleAmp: { value: number };
  uSwimSpeed: { value: number };
  uWaveAlong: { value: number };
  uStripeFreq: { value: number };
  uStripeStrength: { value: number };
  uStripePhase: { value: number };
  uStripeDarken: { value: number };
}

/**
 * Ink toon material extended with:
 *  - stripe banding in the fragment stage, driven by the aBodyT attribute
 *    (0 at the nose, 1 at the tail) so patterns follow the body, and hard
 *    stepped so stripes match the toon aesthetic;
 *  - a vertex-stage swim wiggle: a sideways sine bend whose amplitude
 *    grows toward the tail. Zero per-frame CPU cost beyond one uniform.
 *
 * Advance the animation by ticking material.userData.fishUniforms
 * .uTime.value from useFrame (both <Fish /> and FishSwarm do this).
 */
export function createFishMaterial(
  params: FishMaterialParams
): THREE.MeshToonMaterial {
  const material = createInkToonMaterial({
    color: params.baseColor,
    bands: params.bands,
  });
  material.side = THREE.DoubleSide; // fins and jaw are single-layer fans

  const uniforms: FishUniforms = {
    uTime: { value: 0 },
    uWiggleAmp: { value: 0.07 },
    uSwimSpeed: { value: 2.4 },
    uWaveAlong: { value: 4.0 },
    uStripeFreq: { value: params.stripeFrequency },
    uStripeStrength: { value: params.stripeStrength },
    uStripePhase: { value: params.stripePhase },
    uStripeDarken: { value: 0.4 },
  };

  const chainRim = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    chainRim?.(shader, renderer);
    Object.assign(shader.uniforms, uniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'attribute float aBodyT;',
          'varying float vBodyT;',
          'uniform float uTime;',
          'uniform float uWiggleAmp;',
          'uniform float uSwimSpeed;',
          'uniform float uWaveAlong;',
        ].join('\n')
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'vBodyT = aBodyT;',
          'float swimPhase = 0.0;',
          '#ifdef USE_INSTANCING',
          'swimPhase = float(gl_InstanceID) * 1.71;',
          '#endif',
          'float bend = sin(uTime * uSwimSpeed + aBodyT * uWaveAlong + swimPhase);',
          'transformed.z += bend * uWiggleAmp * smoothstep(0.1, 1.0, aBodyT);',
        ].join('\n')
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        [
          '#include <common>',
          'varying float vBodyT;',
          'uniform float uStripeFreq;',
          'uniform float uStripeStrength;',
          'uniform float uStripePhase;',
          'uniform float uStripeDarken;',
        ].join('\n')
      )
      .replace(
        '#include <color_fragment>',
        [
          '#include <color_fragment>',
          'if (uStripeFreq > 0.5) {',
          '  float band = step(0.2, sin(vBodyT * uStripeFreq * 6.28318 + uStripePhase));',
          '  diffuseColor.rgb *= mix(1.0, uStripeDarken, band * uStripeStrength);',
          '}',
        ].join('\n')
      );
  };

  material.userData.fishUniforms = uniforms;
  return material;
}

export interface FishProps {
  /** Day seed from getOceanDayState. */
  seed: number;
  /** Breed index; 0 is the hero convention (lure, exaggerated jaw). */
  index?: number;
  scale?: number;
  position?: [number, number, number];
  rotation?: [number, number, number];
  /**
   * Hero fish swim calmer: this multiplies wiggle speed and amplitude.
   * Part 4 passes something like 0.45 for the late-year giant.
   */
  calmness?: number;
}

export function Fish({
  seed,
  index = 0,
  scale = 1,
  position = [0, 0, 0],
  rotation = [0, 0, 0],
  calmness = 1,
}: FishProps) {
  const fish: GeneratedFish = useMemo(
    () => generateFish(seed, index),
    [seed, index]
  );

  const material = useMemo(
    () => createFishMaterial(fish.materialParams),
    [fish]
  );

  const lureMaterial = useMemo(() => {
    if (!fish.materialParams.hasLure) return null;
    // Unlit and fog-exempt: the lure is the scene's single light source
    // and should punch through the ink haze.
    return new THREE.MeshBasicMaterial({
      color: fish.materialParams.lureColor,
      fog: false,
      toneMapped: false,
    });
  }, [fish]);

  const uniforms = material.userData.fishUniforms as FishUniforms;
  const lureRef = useRef<THREE.PointLight>(null);

  useEffect(() => {
    uniforms.uSwimSpeed.value = 2.4 * calmness;
    uniforms.uWiggleAmp.value = 0.07 * Math.min(calmness * 1.4, 1);
  }, [uniforms, calmness]);

  useFrame((state) => {
    uniforms.uTime.value = state.clock.getElapsedTime();
    if (lureRef.current) {
      // Slow breathing pulse on the lure light, seeded by nothing: it is
      // purely temporal, so determinism of the breed is unaffected.
      const pulse = 0.75 + 0.25 * Math.sin(state.clock.getElapsedTime() * 1.3);
      lureRef.current.intensity = 2.2 * pulse;
    }
  });

  useEffect(() => {
    return () => {
      fish.geometry.dispose();
      fish.lureGeometry?.dispose();
      material.dispose();
      lureMaterial?.dispose();
    };
  }, [fish, material, lureMaterial]);

  return (
    <group position={position} rotation={rotation} scale={scale}>
      <mesh geometry={fish.geometry} material={material} />
      {fish.lureGeometry && lureMaterial && (
        <>
          <mesh geometry={fish.lureGeometry} material={lureMaterial} />
          <pointLight
            ref={lureRef}
            position={fish.lureOffset}
            color={fish.materialParams.lureColor}
            intensity={2.2}
            distance={6 * scale}
            decay={2}
          />
        </>
      )}
    </group>
  );
}
