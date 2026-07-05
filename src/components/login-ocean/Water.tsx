'use client';

/**
 * The water surface, seen from below: a displaced shader plane hanging
 * above the scene. Four summed directional sine waves (analytic normals
 * from their derivatives, no neighbor sampling), a fresnel term stepped
 * into toon bands so the sheen reads as ink, and scene fog via three's
 * standard fog chunks. Slow by design: full swell period around twenty
 * seconds, matching the camera's idle drift band.
 */

import { useMemo } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { INK } from './InkWashPipeline';

const vertexShader = /* glsl */ `
  uniform float uTime;
  uniform float uAmp;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vCrest;

  #include <fog_pars_vertex>

  // One directional sine wave; accumulates height and its gradient.
  void wave(vec2 dir, float k, float speed, float amp, vec2 p,
            inout float h, inout vec2 grad) {
    float ph = dot(dir, p) * k + uTime * speed;
    h += amp * sin(ph);
    grad += amp * k * dir * cos(ph);
  }

  void main() {
    vec2 p = position.xy; // plane local; the mesh is rotated flat
    float h = 0.0;
    vec2 grad = vec2(0.0);

    wave(normalize(vec2( 1.0,  0.30)), 0.50, 0.32, 0.42 * uAmp, p, h, grad);
    wave(normalize(vec2(-0.60, 1.0 )), 0.80, 0.26, 0.28 * uAmp, p, h, grad);
    wave(normalize(vec2( 0.85, -0.55)), 1.30, 0.45, 0.16 * uAmp, p, h, grad);
    wave(normalize(vec2(-0.20, -1.0 )), 2.10, 0.60, 0.09 * uAmp, p, h, grad);

    vCrest = h / uAmp;

    vec3 displaced = vec3(p, position.z + h);
    vec3 localNormal = normalize(vec3(-grad, 1.0));

    vWorldPos = (modelMatrix * vec4(displaced, 1.0)).xyz;
    vWorldNormal = normalize(mat3(modelMatrix) * localNormal);

    vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const fragmentShader = /* glsl */ `
  uniform vec3 uDeep;
  uniform vec3 uPale;
  uniform float uBands;

  varying vec3 vWorldPos;
  varying vec3 vWorldNormal;
  varying float vCrest;

  #include <fog_pars_fragment>

  void main() {
    vec3 n = normalize(vWorldNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    // abs() because the surface is viewed from underneath.
    float facing = abs(dot(viewDir, n));
    float fresnel = pow(1.0 - facing, 3.0);
    // Quantize the sheen into toon bands; crests add one soft lift.
    float stepped = floor(fresnel * uBands + 0.5) / uBands;
    float crest = smoothstep(0.35, 1.0, vCrest) * 0.12;
    vec3 color = mix(uDeep, uPale, clamp(stepped * 0.85 + crest, 0.0, 1.0));
    gl_FragColor = vec4(color, 1.0);
    #include <fog_fragment>
  }
`;

export interface WaterProps {
  /** World y of the surface plane. */
  height?: number;
  /** Peak wave amplitude in world units. Subtle by default. */
  amplitude?: number;
  /** Pass 0 to freeze the swell (prefers-reduced-motion). */
  motionScale?: number;
}

export function Water({
  height = 7.5,
  amplitude = 0.35,
  motionScale = 1,
}: WaterProps) {
  const material = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader,
      fragmentShader,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uAmp: { value: amplitude },
          uDeep: { value: new THREE.Color(INK.deep) },
          uPale: { value: new THREE.Color(INK.pale) },
          uBands: { value: 3 },
        },
      ]),
      side: THREE.DoubleSide,
      fog: true,
    });
    return mat;
  }, [amplitude]);

  const geometry = useMemo(() => {
    const geo = new THREE.PlaneGeometry(90, 50, 72, 40);
    return geo;
  }, []);

  useFrame((state) => {
    material.uniforms.uTime.value =
      state.clock.getElapsedTime() * motionScale;
  });

  return (
    <mesh
      geometry={geometry}
      material={material}
      position={[0, height, -12]}
      rotation={[-Math.PI / 2, 0, 0]}
      // The plane spans the whole scene; culling it by a stale bounding
      // box during camera drift would blink the ceiling out.
      frustumCulled={false}
    />
  );
}
