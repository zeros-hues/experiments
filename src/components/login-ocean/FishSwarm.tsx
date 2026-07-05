'use client';

/**
 * The swarm renderer: one InstancedMesh for every non-hero fish (a single
 * draw call regardless of count), plus the hero rendered through <Fish />
 * so it keeps its lure and accent light.
 *
 * Per frame:
 *   1. intersect the pointer ray with a fixed-depth plane,
 *   2. advance the boids sim,
 *   3. write instance matrices (position, heading quaternion, scale),
 *   4. tick the shared material's uTime for the vertex swim wiggle.
 */

import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { generateFish } from './generateFish';
import { Fish, createFishMaterial, type FishUniforms } from './Fish';
import { useBoids } from './useBoids';

export interface FishSwarmProps {
  /** Day seed from getOceanDayState. */
  seed: number;
  /** Fish alive today (hero included), from getOceanDayState. */
  fishCount: number;
  /** heroSizeScale from getOceanDayState. */
  sizeScale?: number;
  /** totalDays from getOceanDayState, normalizes the staging spread. */
  totalDays?: number;
  /**
   * Flip to attraction if you want to test it. Default false: repulsion.
   * See the tradeoff note at the top of useBoids.ts.
   */
  pointerAttraction?: boolean;
}

export function FishSwarm({
  seed,
  fishCount,
  sizeScale = 1,
  totalDays = 365,
  pointerAttraction = false,
}: FishSwarmProps) {
  const sim = useBoids({
    fishCount,
    seed,
    sizeScale,
    totalDays,
    pointerStrength: pointerAttraction ? -3 : 6,
  });

  // One geometry for the whole swarm: the breed of the day, index 1.
  const breed = useMemo(() => generateFish(seed, 1), [seed]);
  const material = useMemo(
    () => createFishMaterial(breed.materialParams),
    [breed]
  );

  useEffect(() => {
    return () => {
      breed.geometry.dispose();
      material.dispose();
    };
  }, [breed, material]);

  const meshRef = useRef<THREE.InstancedMesh>(null);
  const heroRef = useRef<THREE.Group>(null);

  // Reused temporaries; the frame loop never allocates.
  const temps = useMemo(
    () => ({
      matrix: new THREE.Matrix4(),
      quat: new THREE.Quaternion(),
      pos: new THREE.Vector3(),
      scl: new THREE.Vector3(),
      xAxis: new THREE.Vector3(),
      yAxis: new THREE.Vector3(),
      zAxis: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      basis: new THREE.Matrix4(),
      pointerHit: new THREE.Vector3(),
      pointerPlane: new THREE.Plane(
        new THREE.Vector3(0, 0, 1),
        -sim.pointerPlaneZ
      ),
    }),
    [sim]
  );

  useFrame((state, delta) => {
    // Clamp dt: after a tab switch, delta can be seconds long and would
    // slingshot every boid out of the volume in one integration step.
    const dt = Math.min(delta, 0.05);
    const elapsed = state.clock.getElapsedTime();

    // Pointer ray against the fixed-depth plane; null when it misses.
    state.raycaster.setFromCamera(state.pointer, state.camera);
    const hit = state.raycaster.ray.intersectPlane(
      temps.pointerPlane,
      temps.pointerHit
    );

    sim.step(dt, elapsed, hit);

    const mesh = meshRef.current;
    if (mesh) {
      for (let i = 0; i < sim.swarmCount; i++) {
        const ix = i * 3;
        temps.pos.set(
          sim.positions[ix],
          sim.positions[ix + 1],
          sim.positions[ix + 2]
        );
        // Nose is +X: build a roll-free basis from the velocity heading.
        temps.xAxis.set(
          sim.velocities[ix],
          sim.velocities[ix + 1],
          sim.velocities[ix + 2]
        );
        if (temps.xAxis.lengthSq() < 1e-8) temps.xAxis.set(1, 0, 0);
        temps.xAxis.normalize();
        temps.zAxis.crossVectors(temps.xAxis, temps.up);
        if (temps.zAxis.lengthSq() < 1e-6) temps.zAxis.set(0, 0, 1);
        temps.zAxis.normalize();
        temps.yAxis.crossVectors(temps.zAxis, temps.xAxis);
        temps.basis.makeBasis(temps.xAxis, temps.yAxis, temps.zAxis);
        temps.quat.setFromRotationMatrix(temps.basis);
        temps.scl.setScalar(sim.scales[i]);
        temps.matrix.compose(temps.pos, temps.quat, temps.scl);
        mesh.setMatrixAt(i, temps.matrix);
      }
      mesh.instanceMatrix.needsUpdate = true;
    }

    (material.userData.fishUniforms as FishUniforms).uTime.value = elapsed;

    if (heroRef.current) {
      heroRef.current.position.copy(sim.hero.position);
      heroRef.current.quaternion.copy(sim.hero.quaternion);
    }
  });

  return (
    <group>
      {sim.swarmCount > 0 && (
        <instancedMesh
          key={`${seed}-${sim.swarmCount}`}
          ref={meshRef}
          args={[breed.geometry, material, sim.swarmCount]}
          // Instances span the whole staging volume; per-instance culling
          // does not exist and a stale bounding sphere would blink the
          // swarm out at the frame edges.
          frustumCulled={false}
        />
      )}
      <group ref={heroRef}>
        <Fish
          seed={seed}
          index={0}
          scale={sim.hero.scale}
          calmness={sim.hero.calmness}
        />
      </group>
    </group>
  );
}
