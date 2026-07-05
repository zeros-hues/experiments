'use client';

/**
 * Fixed camera plus idle drift, and the parallax layer wrapper.
 *
 * The camera is locked to CAMERA in staging.ts. The only motion is a
 * slow two-axis sway and a sub-degree roll whose frequencies match the
 * water swell (Part 6 uses the same band), so the frame breathes with
 * the ocean. None of it reads fishCount; day 1 and day 365 get the
 * identical camera. Depth perception comes from <ParallaxLayer>, which
 * shifts staged groups opposite the pointer, foreground more than
 * background, like a layered 2D diorama.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import * as THREE from 'three';
import { useFrame, useThree } from '@react-three/fiber';
import { CAMERA, LAYERS, type LayerName } from './staging';

export interface CameraRigProps {
  /**
   * Scales the idle drift; pass 0 for a perfectly static camera
   * (prefers-reduced-motion in Part 7). Never derived from fishCount.
   */
  driftScale?: number;
}

export function CameraRig({ driftScale = 1 }: CameraRigProps) {
  const camera = useThree((state) => state.camera);

  useEffect(() => {
    camera.position.set(...CAMERA.position);
    camera.rotation.set(0, 0, 0);
    if (camera instanceof THREE.PerspectiveCamera) {
      camera.fov = CAMERA.fov;
      camera.near = CAMERA.near;
      camera.far = CAMERA.far;
      camera.updateProjectionMatrix();
    }
  }, [camera]);

  useFrame(({ clock }) => {
    const t = clock.getElapsedTime();
    camera.position.x =
      CAMERA.position[0] + Math.sin(t * 0.11) * 0.16 * driftScale;
    camera.position.y =
      CAMERA.position[1] + Math.sin(t * 0.17 + 1.3) * 0.11 * driftScale;
    camera.position.z = CAMERA.position[2];
    camera.rotation.z = Math.sin(t * 0.07) * 0.004 * driftScale;
  });

  return null;
}

export interface ParallaxLayerProps {
  /** Named layer from staging.ts, or a custom strength via `strength`. */
  layer?: LayerName;
  /** World-unit offset at full pointer deflection; overrides `layer`. */
  strength?: number;
  /** Pass 0 via OceanScene when prefers-reduced-motion. */
  motionScale?: number;
  children: ReactNode;
}

/**
 * Wrap staged content: <ParallaxLayer layer="mid"><FishSwarm ... /></ParallaxLayer>.
 * The group eases toward its pointer-driven offset with an exponential
 * damp, so fast mouse moves swing the scene softly, never snap it.
 */
export function ParallaxLayer({
  layer = 'mid',
  strength,
  motionScale = 1,
  children,
}: ParallaxLayerProps) {
  const ref = useRef<THREE.Group>(null);
  const amount = (strength ?? LAYERS[layer].parallax) * motionScale;

  useFrame((state, delta) => {
    const group = ref.current;
    if (!group) return;
    const k = 1 - Math.exp(-3 * Math.min(delta, 0.1));
    group.position.x += (-state.pointer.x * amount - group.position.x) * k;
    group.position.y +=
      (-state.pointer.y * amount * 0.6 - group.position.y) * k;
  });

  return <group ref={ref}>{children}</group>;
}
