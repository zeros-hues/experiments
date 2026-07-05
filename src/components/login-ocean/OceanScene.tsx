'use client';

/**
 * OceanScene: the one component the admin login page imports.
 *
 * Assembles Parts 1 through 6 and owns every runtime guardrail:
 *
 *  - The login form always renders first: this component starts as a
 *    solid ink-colored div and only swaps in the canvas (or fallback
 *    image) after mount, so nothing here can block form interactivity
 *    or SSR.
 *  - The wrapper is aria-hidden and pointer-events: none. The canvas can
 *    never intercept a click, never enters the tab order, and never sits
 *    ahead of the username field. Pointer interaction still works via a
 *    passive window-level listener that writes into R3F's pointer state.
 *  - WebGL2 and prefers-reduced-motion are checked on mount; failing
 *    either renders the static fallback <img> instead of a canvas.
 *  - document.visibilitychange pauses the render loop entirely
 *    (frameloop switches to 'never') while the tab is hidden.
 *  - Low-power devices (few cores or a coarse pointer) run at a capped
 *    30fps via manual advance() stepping, and at reduced dpr.
 *  - Fog as LOD: staging keeps all placement inside the fog horizon
 *    (InkWashAtmosphere density 0.045 dissolves everything past ~25
 *    units; the far plane is 60), so no geometry or shading budget is
 *    ever spent on detail the fog would swallow anyway.
 *
 * SSR pattern to avoid a date flash: have a Server Component compute
 * formatDateKey(new Date()) at request time and pass it as `dateKey`.
 * Without the prop, the client's own clock is used.
 */

import { useEffect, useMemo, useState } from 'react';
import { Canvas, useThree } from '@react-three/fiber';
import {
  getOceanDayState,
  parseDateKey,
} from '../../lib/login-ocean/dateState';
import { INK, InkWashAtmosphere, InkWashEffects } from './InkWashPipeline';
import { CameraRig, ParallaxLayer } from './CameraRig';
import { CAMERA } from './staging';
import { FishSwarm } from './FishSwarm';
import { Water } from './Water';
import { LightDrift } from './LightDrift';
import { Kelp } from './Kelp';

function supportsWebGL2(): boolean {
  try {
    const canvas = document.createElement('canvas');
    return canvas.getContext('webgl2') !== null;
  } catch {
    return false;
  }
}

function isLowPowerDevice(): boolean {
  const fewCores =
    typeof navigator.hardwareConcurrency === 'number' &&
    navigator.hardwareConcurrency <= 4;
  const coarsePointer = window.matchMedia('(pointer: coarse)').matches;
  return fewCores || coarsePointer;
}

/**
 * The canvas is pointer-events: none so the form always wins; R3F's own
 * pointer events therefore never fire. This feeds the same state.pointer
 * that FishSwarm's raycast and ParallaxLayer read, from window moves.
 */
function WindowPointer() {
  const pointer = useThree((state) => state.pointer);
  const gl = useThree((state) => state.gl);
  useEffect(() => {
    const el = gl.domElement;
    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      pointer.set(
        ((e.clientX - rect.left) / rect.width) * 2 - 1,
        -((e.clientY - rect.top) / rect.height) * 2 + 1
      );
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, [gl, pointer]);
  return null;
}

/** Drives frames at a fixed rate while the Canvas frameloop is 'never'. */
function FrameCap({ fps }: { fps: number }) {
  const advance = useThree((state) => state.advance);
  useEffect(() => {
    const id = window.setInterval(() => {
      advance(performance.now());
    }, 1000 / fps);
    return () => window.clearInterval(id);
  }, [advance, fps]);
  return null;
}

export interface OceanSceneProps {
  /**
   * YYYY-MM-DD from a Server Component (formatDateKey(new Date()) at
   * request time) to avoid any flash; falls back to the client clock.
   */
  dateKey?: string;
  /**
   * Static fallback for no-WebGL2 or reduced-motion visitors: one
   * pre-composed grainy frame in the same aesthetic. Supply a 2560x1440
   * JPEG or WebP (quality ~70 is plenty under the grain), monochrome
   * with the grain baked in; it is object-fit: cover, so the center
   * must survive cropping on narrow screens.
   */
  fallbackSrc?: string;
  /** Extra classes for the wrapper (positioning comes from Part 8). */
  className?: string;
}

type SceneMode = 'pending' | 'live' | 'fallback';

export function OceanScene({
  dateKey,
  fallbackSrc = '/images/login-ocean-fallback.jpg',
  className = '',
}: OceanSceneProps) {
  const [mode, setMode] = useState<SceneMode>('pending');
  const [hidden, setHidden] = useState(false);
  const [lowPower, setLowPower] = useState(false);

  // Feature detection only after mount: SSR renders the plain ink div,
  // the form hydrates and is interactive regardless of what happens here.
  useEffect(() => {
    const reducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)'
    ).matches;
    if (reducedMotion || !supportsWebGL2()) {
      setMode('fallback');
      return;
    }
    setLowPower(isLowPowerDevice());
    setMode('live');
  }, []);

  useEffect(() => {
    const onVisibility = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);
    return () =>
      document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  const dayState = useMemo(
    () => getOceanDayState(dateKey ? parseDateKey(dateKey) : new Date()),
    [dateKey]
  );

  // 'never' + FrameCap = manual 30fps stepping; 'never' alone = paused.
  const frameloop = hidden ? 'never' : lowPower ? 'never' : 'always';

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none select-none overflow-hidden ${className}`}
      style={{ backgroundColor: INK.deep }}
    >
      {mode === 'fallback' && (
        <img
          src={fallbackSrc}
          alt=""
          draggable={false}
          className="h-full w-full object-cover"
        />
      )}
      {mode === 'live' && (
        <Canvas
          frameloop={frameloop}
          camera={{
            position: [...CAMERA.position],
            fov: CAMERA.fov,
            near: CAMERA.near,
            far: CAMERA.far,
          }}
          dpr={[1, lowPower ? 1.25 : 1.75]}
          gl={{
            antialias: false, // the grain pass hides aliasing anyway
            alpha: false,
            stencil: false,
            powerPreference: 'default',
          }}
          style={{ pointerEvents: 'none' }}
        >
          <InkWashAtmosphere />
          <CameraRig />
          <LightDrift />
          <Water />
          <ParallaxLayer layer="mid">
            <FishSwarm
              seed={dayState.seed}
              fishCount={dayState.fishCount}
              sizeScale={dayState.heroSizeScale}
              totalDays={dayState.totalDays}
            />
          </ParallaxLayer>
          <ParallaxLayer layer="foreground">
            <Kelp />
          </ParallaxLayer>
          <InkWashEffects enabled={!lowPower} />
          <WindowPointer />
          {lowPower && !hidden && <FrameCap fps={30} />}
        </Canvas>
      )}
    </div>
  );
}
