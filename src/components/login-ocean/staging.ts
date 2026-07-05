/**
 * Staging for the login ocean: the fixed camera definition, the depth
 * layers, and the date-driven placement volume.
 *
 * Core principle (the anti-zoom rule): the camera NEVER moves in response
 * to fishCount. The date changes what is placed where inside a fixed
 * frame: many small fish spread wide across mid and background layers,
 * few large fish concentrate closer in, at true scale, retreating into
 * fog when they grow huge. Any camera motion is a tiny constant idle
 * drift (CameraRig.tsx), identical on 1 January and 31 December.
 *
 * Pure module: plain numbers only, no React, no Three.js, so the sim,
 * the camera rig, and Part 6's set dressing all share one source of
 * truth and this file stays unit-testable.
 */

/** Fixed camera. FOV is a constant; there is no content-driven zoom. */
export const CAMERA = {
  position: [0, 0.4, 4] as const,
  fov: 48,
  near: 0.1,
  far: 60,
} as const;

/**
 * Depth layers for set dressing and parallax. Pointer parallax shifts
 * each layer opposite the pointer, foreground most, so the frame reads
 * as a diorama with real depth rather than a flat painting.
 * Strengths are world-unit offsets at full pointer deflection.
 */
export const LAYERS = {
  /** Distant silhouettes, light shafts. Nearly still. */
  background: { z: -18, parallax: 0.1 },
  /** The swarm and hero live around here (see getStagingVolume). */
  mid: { z: -9, parallax: 0.28 },
  /** Kelp tips, close bubbles. Moves the most. */
  foreground: { z: -4, parallax: 0.6 },
} as const;

export type LayerName = keyof typeof LAYERS;

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

export interface StagingVolume {
  /** 1 on 1 January, 0 on the last day. */
  yearFrac: number;
  /** Horizontal spread multiplier derived from yearFrac. */
  spread: number;
  /** Swarm volume center. Drifts slightly camera-ward late in the year. */
  center: Vec3Like;
  /** Swarm volume half-extents. */
  half: Vec3Like;
  /**
   * Hero wander center. Small heroes swim just ahead of the swarm;
   * giants retreat into the fog proportionally to their size so the
   * late-year whale reads as a distant leviathan filling the haze, not
   * a mesh clipping the lens.
   */
  heroCenter: Vec3Like;
}

const clamp01 = (v: number) => Math.min(Math.max(v, 0), 1);

/**
 * Date-driven placement within the fixed frame. Density and position
 * change with the day; the camera does not.
 */
export function getStagingVolume(
  fishCount: number,
  totalDays: number,
  sizeScale: number
): StagingVolume {
  const swarmCount = Math.max(fishCount - 1, 0);
  const yearFrac = clamp01(swarmCount / (totalDays - 1 || 1));
  const spread = 0.45 + 0.55 * Math.sqrt(yearFrac);
  const center = { x: 0, y: 0, z: -9 + (1 - yearFrac) * 2.5 };
  const half = {
    x: 11 * spread + 2.5,
    y: 4.5 * spread + 1.5,
    z: 5.5 * spread + 1.5,
  };
  const heroCenter = {
    x: 0,
    y: 0,
    z: center.z + 1.5 - (sizeScale - 1) * 1.2,
  };
  return { yearFrac, spread, center, half, heroCenter };
}
