'use client';

/**
 * Kelp: instanced ribbon blades swaying in the vertex shader, plus the
 * seabed plane they grow from. One InstancedMesh, one draw call, zero
 * per-frame CPU cost (the only per-frame work is one uTime uniform).
 *
 * Sway is sin-based, driven by height-along-blade squared (rooted at the
 * base, whipping at the tip) plus a faster low-amplitude ripple running
 * up the blade, with per-instance phase from gl_InstanceID so no two
 * blades move in sync.
 *
 * Distribution choice: STATIC across days, seeded by a fixed constant
 * rather than the date. The seabed is the stage; it should read as the
 * same permanent place all year while only the fauna changes. (Reseeding
 * from the date would be a one-line change: pass the day seed instead of
 * KELP_SEED.)
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { mulberry32 } from '../../lib/login-ocean/dateState';
import { createInkToonMaterial, INK } from './InkWashPipeline';

const KELP_SEED = 0x6b656c70;
const SEABED_Y = -6;

function createKelpMaterial(motionScale: number): THREE.MeshToonMaterial {
  const material = createInkToonMaterial({
    color: '#22252A',
    bands: 2,
    rimStrength: 0.7,
  });
  material.side = THREE.DoubleSide;

  const uniforms = {
    uTime: { value: 0 },
    uSwayAmp: { value: 0.55 * motionScale },
    uSwayFreq: { value: 0.35 },
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
          'attribute float aBladeT;',
          'uniform float uTime;',
          'uniform float uSwayAmp;',
          'uniform float uSwayFreq;',
        ].join('\n')
      )
      .replace(
        '#include <begin_vertex>',
        [
          '#include <begin_vertex>',
          'float kelpPhase = 0.0;',
          '#ifdef USE_INSTANCING',
          'kelpPhase = float(gl_InstanceID) * 2.39;',
          '#endif',
          'float rooted = aBladeT * aBladeT;',
          'float sway = sin(uTime * uSwayFreq * 6.2832 + kelpPhase);',
          'float ripple = sin(uTime * uSwayFreq * 15.0 + aBladeT * 5.0 + kelpPhase) * 0.18;',
          'transformed.x += (sway + ripple) * uSwayAmp * rooted;',
          'transformed.z += (sway * 0.35) * uSwayAmp * rooted;',
        ].join('\n')
      );
  };

  material.userData.kelpUniforms = uniforms;
  return material;
}

export interface KelpProps {
  /** Blade count across the full depth range. */
  count?: number;
  /** Pass 0 to still the sway (prefers-reduced-motion). */
  motionScale?: number;
}

export function Kelp({ count = 42, motionScale = 1 }: KelpProps) {
  // Blade: a thin segmented ribbon, base at local y = 0, with aBladeT
  // (0 base, 1 tip) baked in for the shader bend.
  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(0.34, 5, 1, 10);
    geo.translate(0, 2.5, 0);
    const uv = geo.getAttribute('uv');
    const bladeT = new Float32Array(uv.count);
    for (let i = 0; i < uv.count; i++) bladeT[i] = uv.getY(i);
    geo.setAttribute('aBladeT', new THREE.BufferAttribute(bladeT, 1));
    return geo;
  }, []);

  const material = useMemo(
    () => createKelpMaterial(motionScale),
    [motionScale]
  );

  const seabedMaterial = useMemo(
    () => createInkToonMaterial({ color: INK.abyss, bands: 2, rimStrength: 0 }),
    []
  );

  useEffect(() => {
    return () => {
      geometry.dispose();
      material.dispose();
      seabedMaterial.dispose();
    };
  }, [geometry, material, seabedMaterial]);

  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Static placement: written once, never touched again.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    const rng = mulberry32(KELP_SEED);
    const matrix = new THREE.Matrix4();
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    const yAxis = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < count; i++) {
      pos.set(
        (rng() * 2 - 1) * 20,
        SEABED_Y,
        -4 - rng() * 16 // spans foreground (-4) to background (-20)
      );
      quat.setFromAxisAngle(yAxis, rng() * Math.PI * 2);
      scl.set(0.7 + rng() * 0.6, 0.5 + rng() * 1.2, 1);
      matrix.compose(pos, quat, scl);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }, [count]);

  useFrame((state) => {
    (
      material.userData.kelpUniforms as { uTime: { value: number } }
    ).uTime.value = state.clock.getElapsedTime();
  });

  return (
    <group>
      <instancedMesh
        ref={meshRef}
        args={[geometry, material, count]}
        // Blades bend in the vertex shader; a static bounding box would
        // cull swaying tips at the frame edge.
        frustumCulled={false}
      />
      <mesh
        material={seabedMaterial}
        position={[0, SEABED_Y - 0.1, -14]}
        rotation={[-Math.PI / 2, 0, 0]}
      >
        <planeGeometry args={[100, 60]} />
      </mesh>
    </group>
  );
}
