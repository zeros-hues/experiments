'use client';

/**
 * Ink-wash rendering pipeline for the login ocean scene.
 *
 * Exports:
 *   INK                   grayscale palette constants plus the single accent
 *   createToonRampTexture stepped gradient map for toon banding
 *   createInkToonMaterial MeshToonMaterial with a stepped fresnel rim
 *   useInkToonMaterial    hook wrapping the above with disposal
 *   <InkWashAtmosphere /> scene background color plus exponential fog
 *   <InkWashEffects />    film grain and vignette post pass
 *
 * Packages required:
 *   three, @react-three/fiber, postprocessing, @react-three/postprocessing
 *   (@react-three/drei is used by later parts, not by this file)
 */

import { useEffect, useMemo } from 'react';
import * as THREE from 'three';
import { EffectComposer, Noise, Vignette } from '@react-three/postprocessing';
import { BlendFunction } from 'postprocessing';

/**
 * Monochrome ink-wash palette. Everything in the scene draws from the
 * grayscale ramp. `accent` is reserved for light sources only (the hero
 * fish's lure, a faint glow) and must never appear on a body, plant, or UI.
 */
export const INK = {
  abyss: '#0A0B0D',
  deep: '#16181B',
  mid: '#3B3F45',
  haze: '#6E7278',
  pale: '#B8B6AE',
  bone: '#F1EEE6',
  accent: '#F0C879',
} as const;

/**
 * Builds the tiny gradient map that gives MeshToonMaterial its stepped
 * bands. Width = number of bands (clamped 2..5). NearestFilter is what
 * makes the bands hard instead of interpolated.
 * The curve biases toward wide shadow bands and a thin highlight band,
 * which is the Silt look: mostly dark mass, one crisp lit edge.
 */
export function createToonRampTexture(
  bands = 3,
  floor = 0.16,
  ceil = 1.0
): THREE.DataTexture {
  const width = Math.max(2, Math.min(Math.round(bands), 5));
  const data = new Uint8Array(width * 4);
  for (let i = 0; i < width; i++) {
    const t = width === 1 ? 1 : i / (width - 1);
    const v = Math.round(255 * (floor + (ceil - floor) * Math.pow(t, 1.6)));
    data[i * 4 + 0] = v;
    data[i * 4 + 1] = v;
    data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const texture = new THREE.DataTexture(data, width, 1, THREE.RGBAFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export interface InkToonOptions {
  /** Base albedo, normally a value from INK. */
  color?: THREE.ColorRepresentation;
  /** Number of toon bands, 2 or 3 for this aesthetic. */
  bands?: number;
  /** Rim tint. Near-black darkens edges (default); INK.pale would halo. */
  rimColor?: THREE.ColorRepresentation;
  /** 0..1 blend of the rim over the shaded color. */
  rimStrength?: number;
  /** Fresnel window: rim begins where 1 - dot(view, normal) passes this. */
  rimStart?: number;
  /** Fresnel window end, full rim at grazing angles. */
  rimEnd?: number;
  /** Emissive, used only for accent light sources like the hero lure. */
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
}

/**
 * A MeshToonMaterial with the stepped ramp plus a fresnel rim injected via
 * onBeforeCompile. The rim itself is quantized to half steps so it reads
 * as an inked edge, not an airbrushed glow. Fog is respected because the
 * rim is applied to outgoingLight before the fog chunk runs.
 * Live-tweak the rim through material.userData.rimUniforms.
 */
export function createInkToonMaterial(
  options: InkToonOptions = {}
): THREE.MeshToonMaterial {
  const {
    color = INK.mid,
    bands = 3,
    rimColor = INK.abyss,
    rimStrength = 0.85,
    rimStart = 0.55,
    rimEnd = 0.92,
    emissive = 0x000000,
    emissiveIntensity = 0,
  } = options;

  const material = new THREE.MeshToonMaterial({
    color: new THREE.Color(color),
    gradientMap: createToonRampTexture(bands),
    emissive: new THREE.Color(emissive),
    emissiveIntensity,
    fog: true,
  });

  const rimUniforms = {
    uRimColor: { value: new THREE.Color(rimColor) },
    uRimStrength: { value: rimStrength },
    uRimStart: { value: rimStart },
    uRimEnd: { value: rimEnd },
  };

  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, rimUniforms);

    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <common>',
      [
        '#include <common>',
        'uniform vec3 uRimColor;',
        'uniform float uRimStrength;',
        'uniform float uRimStart;',
        'uniform float uRimEnd;',
      ].join('\n')
    );

    const rimChunk = [
      '{',
      '  float rimFacing = saturate(dot(normalize(vViewPosition), normalize(normal)));',
      '  float rim = smoothstep(uRimStart, uRimEnd, 1.0 - rimFacing);',
      '  rim = floor(rim * 2.0 + 0.5) * 0.5;',
      '  outgoingLight = mix(outgoingLight, uRimColor, rim * uRimStrength);',
      '}',
    ].join('\n');

    // three r154+ uses opaque_fragment; older versions used output_fragment.
    const outputToken = shader.fragmentShader.includes(
      '#include <opaque_fragment>'
    )
      ? '#include <opaque_fragment>'
      : '#include <output_fragment>';
    shader.fragmentShader = shader.fragmentShader.replace(
      outputToken,
      rimChunk + '\n' + outputToken
    );
  };

  material.userData.rimUniforms = rimUniforms;
  return material;
}

/** Hook form of createInkToonMaterial with automatic disposal. */
export function useInkToonMaterial(
  options: InkToonOptions = {}
): THREE.MeshToonMaterial {
  const {
    color = INK.mid,
    bands = 3,
    rimColor = INK.abyss,
    rimStrength = 0.85,
    rimStart = 0.55,
    rimEnd = 0.92,
    emissive = 0x000000,
    emissiveIntensity = 0,
  } = options;

  const material = useMemo(
    () =>
      createInkToonMaterial({
        color,
        bands,
        rimColor,
        rimStrength,
        rimStart,
        rimEnd,
        emissive,
        emissiveIntensity,
      }),
    // Options are primitives or color representations passed by value.
    [color, bands, rimColor, rimStrength, rimStart, rimEnd, emissive, emissiveIntensity]
  );

  useEffect(() => {
    return () => {
      (material.gradientMap as THREE.Texture | null)?.dispose();
      material.dispose();
    };
  }, [material]);

  return material;
}

export interface InkWashAtmosphereProps {
  /** Fog and background color. Keep them identical so geometry dissolves. */
  color?: string;
  /**
   * FogExp2 density. 0.045 swallows detail past roughly 25 world units.
   * This doubles as the LOD horizon in Part 7: anything past full-fog
   * distance can be skipped or simplified.
   */
  density?: number;
}

/**
 * Scene background plus exponential fog, matched in color so distant
 * geometry dissolves into the backdrop with no visible horizon line.
 * Drop directly inside <Canvas>.
 */
export function InkWashAtmosphere({
  color = INK.deep,
  density = 0.045,
}: InkWashAtmosphereProps) {
  return (
    <>
      <color attach="background" args={[color]} />
      <fogExp2 attach="fog" args={[color, density]} />
    </>
  );
}

export interface InkWashEffectsProps {
  /** Grain strength. 0.10 is barely there, 0.25 is heavy stock footage. */
  grainOpacity?: number;
  /** Edge darkening amount for the vignette. */
  vignetteDarkness?: number;
  /** Set false to skip the whole composer (reduced-motion or low power). */
  enabled?: boolean;
}

/**
 * Post-processing pass: animated film grain plus a soft vignette.
 * postprocessing's Noise effect re-randomizes every frame on its own,
 * so the grain crawls like film stock with zero per-frame JS cost.
 * Drop inside <Canvas> after the scene contents.
 */
export function InkWashEffects({
  grainOpacity = 0.14,
  vignetteDarkness = 0.55,
  enabled = true,
}: InkWashEffectsProps) {
  if (!enabled) return null;
  return (
    <EffectComposer multisampling={0}>
      <Noise
        premultiply
        blendFunction={BlendFunction.SOFT_LIGHT}
        opacity={grainOpacity}
      />
      <Vignette eskil={false} offset={0.28} darkness={vignetteDarkness} />
    </EffectComposer>
  );
}
