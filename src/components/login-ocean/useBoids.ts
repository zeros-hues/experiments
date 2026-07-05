'use client';

/**
 * CPU-side flocking for the login ocean swarm.
 *
 * Architecture: createBoidsSim is a pure factory (deterministic given
 * fishCount + seed, testable headless without React), and useBoids is the
 * thin hook wrapper components consume. All per-fish state lives in flat
 * Float32Arrays; FishSwarm.tsx reads them each frame and writes a single
 * InstancedMesh's matrices. Nothing here allocates per frame.
 *
 * The hero (the day's largest fish) is not part of the flock. It swims an
 * analytic Lissajous wander, slower and calmer the larger it gets, and
 * ignores the pointer entirely: predators do not startle.
 *
 * Pointer force: repulsion by default. Attraction was considered and is
 * available by passing a negative pointerStrength, but attraction makes
 * the swarm mob the cursor, and the cursor spends most of its time on the
 * login card, so the fish would pile up behind the form exactly where the
 * scrim hides them. Repulsion parts the swarm as the pointer sweeps,
 * reads as prey fear, and pushes activity into the visible margins.
 *
 * Neighbor search is O(n^2) over at most 365 boids (~133k cheap inner
 * iterations, well under a millisecond); a spatial hash would only add
 * code here.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { deriveSeed, mulberry32 } from '../../lib/login-ocean/dateState';
import { getStagingVolume } from './staging';

export interface BoidsOptions {
  /** Total fish alive today (hero included), from getOceanDayState. */
  fishCount: number;
  /** Day seed from getOceanDayState. */
  seed: number;
  /** heroSizeScale from getOceanDayState; drives size, speed, spread. */
  sizeScale?: number;
  /** Pointer force. Positive repels (default), negative attracts. */
  pointerStrength?: number;
  /** Reference year length used to normalize spread; totalDays. */
  totalDays?: number;
}

export interface BoidsSim {
  /** Flock size, fishCount minus the hero. Can be 0 on 31 December. */
  swarmCount: number;
  /** xyz per boid. */
  positions: Float32Array;
  /** xyz per boid. */
  velocities: Float32Array;
  /** Per-boid uniform scale (sizeScale times seeded jitter). */
  scales: Float32Array;
  hero: {
    position: THREE.Vector3;
    quaternion: THREE.Quaternion;
    /** sizeScale times the hero bonus. */
    scale: number;
    /** Multiplier for the swim wiggle; < 1 means calmer. */
    calmness: number;
  };
  /** Where FishSwarm should intersect the pointer ray. */
  pointerPlaneZ: number;
  /** Staging volume, exposed for Part 5's layered placement to reuse. */
  boundsCenter: THREE.Vector3;
  boundsHalf: THREE.Vector3;
  /**
   * Advance the simulation. dt in seconds (clamp spikes before calling),
   * elapsed is total scene time, pointer is a world-space point on the
   * pointer plane or null when the pointer is off-canvas.
   */
  step: (dt: number, elapsed: number, pointer: THREE.Vector3 | null) => void;
}

const HERO_SCALE_BONUS = 1.6;

export function createBoidsSim({
  fishCount,
  seed,
  sizeScale = 1,
  pointerStrength = 6,
  totalDays = 365,
}: BoidsOptions): BoidsSim {
  const swarmCount = Math.max(fishCount - 1, 0);
  const rng = mulberry32(deriveSeed(seed, 700_001));

  // Staging volume from staging.ts: dense years spread wide, sparse
  // late-year fish concentrate closer to the camera. Placement density
  // changes with the date; the camera (CameraRig.tsx) never does.
  const volume = getStagingVolume(fishCount, totalDays, sizeScale);
  const boundsCenter = new THREE.Vector3(
    volume.center.x,
    volume.center.y,
    volume.center.z
  );
  const boundsHalf = new THREE.Vector3(
    volume.half.x,
    volume.half.y,
    volume.half.z
  );

  const positions = new Float32Array(swarmCount * 3);
  const velocities = new Float32Array(swarmCount * 3);
  const scales = new Float32Array(swarmCount);
  const wanderFreq = new Float32Array(swarmCount * 2);
  const wanderPhase = new Float32Array(swarmCount * 2);

  const maxSpeed = 1.5 * Math.pow(sizeScale, 0.35);
  const minSpeed = maxSpeed * 0.35;
  const maxAccel = maxSpeed * 3;

  // Interaction radii grow with body size so big fish keep proportional
  // personal space.
  const sepR2 = (0.9 * sizeScale) ** 2;
  const alignR2 = (2.3 * sizeScale) ** 2;
  const cohR2 = (3.4 * sizeScale) ** 2;
  const pointerRadius = 4.5;

  for (let i = 0; i < swarmCount; i++) {
    positions[i * 3 + 0] = boundsCenter.x + (rng() * 2 - 1) * boundsHalf.x;
    positions[i * 3 + 1] = boundsCenter.y + (rng() * 2 - 1) * boundsHalf.y;
    positions[i * 3 + 2] = boundsCenter.z + (rng() * 2 - 1) * boundsHalf.z;
    const heading = rng() * Math.PI * 2;
    const speed = minSpeed + rng() * (maxSpeed - minSpeed);
    velocities[i * 3 + 0] = Math.cos(heading) * speed;
    velocities[i * 3 + 1] = (rng() * 2 - 1) * speed * 0.2;
    velocities[i * 3 + 2] = Math.sin(heading) * speed;
    scales[i] = sizeScale * (0.7 + rng() * 0.45);
    wanderFreq[i * 2 + 0] = 0.3 + rng() * 0.5;
    wanderFreq[i * 2 + 1] = 0.3 + rng() * 0.5;
    wanderPhase[i * 2 + 0] = rng() * Math.PI * 2;
    wanderPhase[i * 2 + 1] = rng() * Math.PI * 2;
  }

  // Hero wander: analytic Lissajous, irrational-ish frequency ratios so
  // the path never visibly loops. Bigger fish, slower sweep.
  const heroRng = mulberry32(deriveSeed(seed, 700_002));
  const heroSlowdown = 1 / (1 + 0.3 * (sizeScale - 1));
  const heroFreq = [
    (0.05 + heroRng() * 0.03) * heroSlowdown,
    (0.09 + heroRng() * 0.04) * heroSlowdown,
    (0.06 + heroRng() * 0.03) * heroSlowdown,
  ];
  const heroPhase = [
    heroRng() * Math.PI * 2,
    heroRng() * Math.PI * 2,
    heroRng() * Math.PI * 2,
  ];
  const heroAmp = new THREE.Vector3(
    boundsHalf.x * 0.55,
    boundsHalf.y * 0.35,
    boundsHalf.z * 0.35
  );
  const heroCenter = new THREE.Vector3(
    volume.heroCenter.x,
    volume.heroCenter.y,
    volume.heroCenter.z
  );

  const hero = {
    position: heroCenter.clone(),
    quaternion: new THREE.Quaternion(),
    scale: sizeScale * HERO_SCALE_BONUS,
    calmness: Math.max(0.35, Math.min(1.2 * heroSlowdown, 1)),
  };

  // Reused temporaries; step() never allocates.
  const heroVel = new THREE.Vector3();
  const xAxis = new THREE.Vector3();
  const yAxis = new THREE.Vector3();
  const zAxis = new THREE.Vector3();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const basis = new THREE.Matrix4();
  const targetQuat = new THREE.Quaternion();
  const TWO_PI = Math.PI * 2;

  function headingToQuaternion(
    vx: number,
    vy: number,
    vz: number,
    out: THREE.Quaternion
  ): void {
    // The fish nose points along local +X (generateFish convention), so
    // build an orthonormal basis with X = heading and no roll.
    xAxis.set(vx, vy, vz);
    if (xAxis.lengthSq() < 1e-8) xAxis.set(1, 0, 0);
    xAxis.normalize();
    zAxis.crossVectors(xAxis, worldUp);
    if (zAxis.lengthSq() < 1e-6) zAxis.set(0, 0, 1);
    zAxis.normalize();
    yAxis.crossVectors(zAxis, xAxis);
    basis.makeBasis(xAxis, yAxis, zAxis);
    out.setFromRotationMatrix(basis);
  }

  function step(
    dt: number,
    elapsed: number,
    pointer: THREE.Vector3 | null
  ): void {
    const pr2 = pointerRadius * pointerRadius;

    for (let i = 0; i < swarmCount; i++) {
      const ix = i * 3;
      const px = positions[ix];
      const py = positions[ix + 1];
      const pz = positions[ix + 2];

      let sepX = 0, sepY = 0, sepZ = 0;
      let aliX = 0, aliY = 0, aliZ = 0, aliN = 0;
      let cohX = 0, cohY = 0, cohZ = 0, cohN = 0;

      for (let j = 0; j < swarmCount; j++) {
        if (j === i) continue;
        const jx = j * 3;
        const dx = positions[jx] - px;
        const dy = positions[jx + 1] - py;
        const dz = positions[jx + 2] - pz;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 >= cohR2) continue;
        cohX += positions[jx];
        cohY += positions[jx + 1];
        cohZ += positions[jx + 2];
        cohN++;
        if (d2 < alignR2) {
          aliX += velocities[jx];
          aliY += velocities[jx + 1];
          aliZ += velocities[jx + 2];
          aliN++;
        }
        if (d2 < sepR2 && d2 > 1e-6) {
          const inv = 1 / d2;
          sepX -= dx * inv;
          sepY -= dy * inv;
          sepZ -= dz * inv;
        }
      }

      let ax = sepX * 1.6;
      let ay = sepY * 1.6;
      let az = sepZ * 1.6;
      if (aliN > 0) {
        ax += (aliX / aliN - velocities[ix]) * 0.55;
        ay += (aliY / aliN - velocities[ix + 1]) * 0.55;
        az += (aliZ / aliN - velocities[ix + 2]) * 0.55;
      }
      if (cohN > 0) {
        ax += (cohX / cohN - px) * 0.12;
        ay += (cohY / cohN - py) * 0.12;
        az += (cohZ / cohN - pz) * 0.12;
      }

      // Soft box: quadratic push back once outside the staging volume.
      const ox = (px - boundsCenter.x) / boundsHalf.x;
      const oy = (py - boundsCenter.y) / boundsHalf.y;
      const oz = (pz - boundsCenter.z) / boundsHalf.z;
      if (Math.abs(ox) > 1) ax -= (Math.abs(ox) - 1) * Math.sign(ox) * maxSpeed * 2.5;
      if (Math.abs(oy) > 1) ay -= (Math.abs(oy) - 1) * Math.sign(oy) * maxSpeed * 2.5;
      if (Math.abs(oz) > 1) az -= (Math.abs(oz) - 1) * Math.sign(oz) * maxSpeed * 2.5;

      if (pointer) {
        const dx = px - pointer.x;
        const dy = py - pointer.y;
        const dz = pz - pointer.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 < pr2 && d2 > 1e-6) {
          const d = Math.sqrt(d2);
          const falloff = (pointerRadius - d) / pointerRadius;
          const f = (pointerStrength * falloff) / d;
          ax += dx * f;
          ay += dy * f;
          az += dz * f;
        }
      }

      // Idle wander so a becalmed flock never freezes into a lattice.
      ax += Math.sin(elapsed * wanderFreq[i * 2] + wanderPhase[i * 2]) * 0.25;
      ay +=
        Math.sin(elapsed * wanderFreq[i * 2 + 1] + wanderPhase[i * 2 + 1]) *
        0.12;
      az +=
        Math.cos(elapsed * wanderFreq[i * 2] + wanderPhase[i * 2 + 1]) * 0.25;

      const a2 = ax * ax + ay * ay + az * az;
      if (a2 > maxAccel * maxAccel) {
        const s = maxAccel / Math.sqrt(a2);
        ax *= s;
        ay *= s;
        az *= s;
      }

      let vx = velocities[ix] + ax * dt;
      let vy = velocities[ix + 1] + ay * dt;
      let vz = velocities[ix + 2] + az * dt;
      const v2 = vx * vx + vy * vy + vz * vz;
      if (v2 > maxSpeed * maxSpeed) {
        const s = maxSpeed / Math.sqrt(v2);
        vx *= s;
        vy *= s;
        vz *= s;
      } else if (v2 < minSpeed * minSpeed && v2 > 1e-8) {
        const s = minSpeed / Math.sqrt(v2);
        vx *= s;
        vy *= s;
        vz *= s;
      }
      velocities[ix] = vx;
      velocities[ix + 1] = vy;
      velocities[ix + 2] = vz;
      positions[ix] = px + vx * dt;
      positions[ix + 1] = py + vy * dt;
      positions[ix + 2] = pz + vz * dt;
    }

    // Hero: analytic position, analytic derivative for heading, smoothed
    // orientation so the big body never twitches.
    const hx =
      heroCenter.x + heroAmp.x * Math.sin(TWO_PI * heroFreq[0] * elapsed + heroPhase[0]);
    const hy =
      heroCenter.y + heroAmp.y * Math.sin(TWO_PI * heroFreq[1] * elapsed + heroPhase[1]);
    const hz =
      heroCenter.z + heroAmp.z * Math.sin(TWO_PI * heroFreq[2] * elapsed + heroPhase[2]);
    heroVel.set(
      heroAmp.x * TWO_PI * heroFreq[0] * Math.cos(TWO_PI * heroFreq[0] * elapsed + heroPhase[0]),
      heroAmp.y * TWO_PI * heroFreq[1] * Math.cos(TWO_PI * heroFreq[1] * elapsed + heroPhase[1]),
      heroAmp.z * TWO_PI * heroFreq[2] * Math.cos(TWO_PI * heroFreq[2] * elapsed + heroPhase[2])
    );
    hero.position.set(hx, hy, hz);
    headingToQuaternion(heroVel.x, heroVel.y, heroVel.z, targetQuat);
    hero.quaternion.slerp(targetQuat, 1 - Math.exp(-2.5 * dt));
  }

  return {
    swarmCount,
    positions,
    velocities,
    scales,
    hero,
    pointerPlaneZ: boundsCenter.z,
    boundsCenter,
    boundsHalf,
    step,
  };
}

/** Hook wrapper. Rebuilds the sim only when the day (or tuning) changes. */
export function useBoids(options: BoidsOptions): BoidsSim {
  const {
    fishCount,
    seed,
    sizeScale = 1,
    pointerStrength = 6,
    totalDays = 365,
  } = options;
  return useMemo(
    () =>
      createBoidsSim({ fishCount, seed, sizeScale, pointerStrength, totalDays }),
    [fishCount, seed, sizeScale, pointerStrength, totalDays]
  );
}
