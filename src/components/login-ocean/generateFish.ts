/**
 * Procedural fish generator for the login ocean scene.
 *
 * One generator, not 365 assets. Everything derives from the day seed via
 * the deterministic PRNG in dateState.ts. Calling generateFish twice with
 * the same (seed, index) yields byte-identical geometry.
 *
 * Convention:
 *   index 0  the hero fish: exaggerated jaw, always carries the lure.
 *   index 1  the swarm breed: Part 4 renders ONE InstancedMesh that shares
 *            this single geometry across every swarm fish. Per-fish variety
 *            comes from instance scale and the shader, not new geometry.
 *
 * Pure module: imports three for BufferGeometry, no React, no browser APIs.
 * The geometry is built with the body axis along +X (nose at +X, tail at
 * -X), swimming direction +X, so orienting a fish is a simple lookAt.
 *
 * Silhouette-first: identity is carried by proportion (girth bias, jaw,
 * fin sweep, tail fork), not surface detail. Stripes are a shader flag in
 * materialParams, never a texture map.
 */

import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { deriveSeed, mulberry32 } from '../../lib/login-ocean/dateState';

export interface FishMaterialParams {
  /** Grayscale hex, sampled from the breed's PRNG stream. */
  baseColor: string;
  /** Toon bands for the ink ramp. */
  bands: number;
  /** Stripe count along the body. 0 disables stripes entirely. */
  stripeFrequency: number;
  /** 0..1 stripe blend strength. */
  stripeStrength: number;
  /** Radians, offsets the stripe pattern. */
  stripePhase: number;
  /** Whether this fish carries the glowing lure (hero only). */
  hasLure: boolean;
  /** The one accent color in the scene. Only ever used for the lure. */
  lureColor: string;
}

export interface GeneratedFish {
  /** Body, fins, jaw and teeth merged into one non-indexed geometry. */
  geometry: THREE.BufferGeometry;
  /** Separate lure geometry (hero only), rendered with an unlit material. */
  lureGeometry: THREE.BufferGeometry | null;
  /** Local-space position of the lure bulb, for attaching a point light. */
  lureOffset: THREE.Vector3;
  materialParams: FishMaterialParams;
  /** Approximate local-space extents before any instance scaling. */
  dimensions: { length: number; height: number };
}

const RING_COUNT = 26;
const RADIAL_SEGMENTS = 10;
const ACCENT = '#F0C879';

interface TriSink {
  positions: number[];
  bodyT: number[];
}

function pushTriangle(
  sink: TriSink,
  a: THREE.Vector3,
  b: THREE.Vector3,
  c: THREE.Vector3,
  t: number
): void {
  sink.positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  sink.bodyT.push(t, t, t);
}

/**
 * Triangle fan used for every fin and the jaw: rays from an origin sweep
 * between two edge directions, with a radius function shaping the
 * silhouette (fork, taper, bulge). Cheap, and reads perfectly as an inked
 * silhouette under the toon ramp.
 */
function pushFinFan(
  sink: TriSink,
  origin: THREE.Vector3,
  edgeA: THREE.Vector3,
  edgeB: THREE.Vector3,
  radius: (u: number) => number,
  segments: number,
  bodyT: number
): void {
  const dirA = edgeA.clone().normalize();
  const dirB = edgeB.clone().normalize();
  let prev: THREE.Vector3 | null = null;
  for (let k = 0; k <= segments; k++) {
    const u = k / segments;
    const dir = dirA
      .clone()
      .multiplyScalar(1 - u)
      .addScaledVector(dirB, u)
      .normalize();
    const point = origin.clone().addScaledVector(dir, radius(u));
    if (prev) pushTriangle(sink, origin, prev, point, bodyT);
    prev = point;
  }
}

/** Lofts the body: spine curve, elliptical cross-section, girth profile. */
function buildBodyGeometry(
  curve: THREE.CatmullRomCurve3,
  length: number,
  girth: number,
  girthBias: number,
  girthSharpness: number,
  flatten: number
): THREE.BufferGeometry {
  const positions: number[] = [];
  const bodyT: number[] = [];
  const indices: number[] = [];
  const up = new THREE.Vector3(0, 1, 0);

  for (let i = 0; i <= RING_COUNT; i++) {
    const t = i / RING_COUNT;
    const center = curve.getPoint(t);
    const tangent = curve.getTangent(t).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, up).normalize();
    const ringUp = new THREE.Vector3().crossVectors(side, tangent).normalize();

    const shifted = Math.pow(t, girthBias);
    const profile = Math.pow(
      Math.max(Math.sin(Math.PI * shifted), 0),
      girthSharpness
    );
    const ry = profile * girth;
    const rz = ry * flatten;

    for (let j = 0; j < RADIAL_SEGMENTS; j++) {
      const theta = (j / RADIAL_SEGMENTS) * Math.PI * 2;
      const p = center
        .clone()
        .addScaledVector(ringUp, Math.cos(theta) * ry)
        .addScaledVector(side, Math.sin(theta) * rz);
      positions.push(p.x, p.y, p.z);
      bodyT.push(t);
    }
  }

  for (let i = 0; i < RING_COUNT; i++) {
    for (let j = 0; j < RADIAL_SEGMENTS; j++) {
      const jn = (j + 1) % RADIAL_SEGMENTS;
      const a = i * RADIAL_SEGMENTS + j;
      const b = i * RADIAL_SEGMENTS + jn;
      const c = (i + 1) * RADIAL_SEGMENTS + j;
      const d = (i + 1) * RADIAL_SEGMENTS + jn;
      indices.push(a, c, b, b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(positions, 3)
  );
  geometry.setAttribute('aBodyT', new THREE.Float32BufferAttribute(bodyT, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry.toNonIndexed();
}

export function generateFish(seed: number, index: number): GeneratedFish {
  const rng = mulberry32(deriveSeed(seed, index));
  const range = (lo: number, hi: number) => lo + rng() * (hi - lo);
  const isHero = index === 0;

  // Breed parameters, all consumed in a fixed order so the stream stays
  // stable if values are tweaked. Do not reorder these reads.
  const length = range(1.7, 2.5);
  const girth = length * range(0.14, 0.24);
  const girthBias = range(0.6, 1.05); // < 1 shifts the mass toward the head
  const girthSharpness = range(0.6, 1.0);
  const flatten = range(0.45, 0.75); // lateral compression
  const spineWaveAmp = length * range(0.015, 0.06);
  const spineWavePhase = range(0, Math.PI * 2);
  const jawSize = length * range(0.07, 0.16) * (isHero ? 1.5 : 1);
  const toothCount = Math.floor(range(3, 9));
  const tailLength = length * range(0.18, 0.34);
  const tailSpread = range(0.5, 1.1);
  const tailFork = range(0, 0.55);
  const dorsalHeight = girth * range(0.6, 1.6);
  const dorsalPos = range(0.32, 0.5);
  const pectoralSize = girth * range(0.7, 1.3);
  const striped = rng() < 0.45;
  const stripeFrequency = striped ? Math.floor(range(3, 11)) : 0;
  const stripeStrength = range(0.35, 0.7);
  const stripePhase = range(0, Math.PI * 2);
  const grayLightness = range(0.24, 0.6);

  const half = length / 2;
  const spinePoints: THREE.Vector3[] = [];
  for (let i = 0; i < 5; i++) {
    const t = i / 4;
    spinePoints.push(
      new THREE.Vector3(
        half - t * length,
        Math.sin(t * Math.PI * 1.5 + spineWavePhase) * spineWaveAmp,
        0
      )
    );
  }
  const curve = new THREE.CatmullRomCurve3(spinePoints);

  const body = buildBodyGeometry(
    curve,
    length,
    girth,
    girthBias,
    girthSharpness,
    flatten
  );

  const extras: TriSink = { positions: [], bodyT: [] };

  // Tail fin: fan sweeping from upper-back to lower-back, forked by
  // shortening the middle rays.
  const tailTip = curve.getPoint(1);
  pushFinFan(
    extras,
    tailTip,
    new THREE.Vector3(-1, tailSpread, 0),
    new THREE.Vector3(-1, -tailSpread, 0),
    (u) => tailLength * (1 - tailFork * Math.sin(Math.PI * u)),
    7,
    1
  );

  // Dorsal fin on the spine's back.
  const dorsalBase = curve.getPoint(dorsalPos);
  dorsalBase.y += girth * 0.75;
  pushFinFan(
    extras,
    dorsalBase,
    new THREE.Vector3(0.5, 1, 0),
    new THREE.Vector3(-0.9, 0.6, 0),
    (u) => dorsalHeight * Math.pow(Math.sin(Math.PI * (0.2 + 0.8 * u)), 0.7),
    5,
    dorsalPos
  );

  // Pectoral fins, one per side, swept back and down.
  for (const sideSign of [1, -1]) {
    const base = curve.getPoint(0.26);
    base.z += sideSign * girth * flatten * 0.8;
    pushFinFan(
      extras,
      base,
      new THREE.Vector3(-0.4, -0.3, sideSign * 0.9),
      new THREE.Vector3(-1, -0.15, sideSign * 0.35),
      () => pectoralSize,
      4,
      0.26
    );
  }

  // Lower jaw: a downward-forward wedge under the nose. Its size is the
  // single strongest breed identifier in silhouette.
  const nose = curve.getPoint(0);
  const mouthCorner = curve.getPoint(0.1);
  mouthCorner.y -= girth * 0.35;
  pushFinFan(
    extras,
    mouthCorner,
    new THREE.Vector3(1, 0.15, 0),
    new THREE.Vector3(0.7, -0.7, 0),
    () => jawSize,
    4,
    0.05
  );

  // Teeth: thin triangles rising from the jaw line toward the nose.
  for (let k = 0; k < toothCount; k++) {
    const u = (k + 0.5) / toothCount;
    const rootA = mouthCorner
      .clone()
      .lerp(nose, u)
      .add(new THREE.Vector3(0, jawSize * 0.15, 0));
    const rootB = rootA.clone().add(new THREE.Vector3(jawSize * 0.12, 0, 0));
    const tip = rootA
      .clone()
      .add(new THREE.Vector3(jawSize * 0.06, jawSize * 0.35, 0));
    pushTriangle(extras, rootA, rootB, tip, 0.03);
  }

  const extrasGeometry = new THREE.BufferGeometry();
  extrasGeometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(extras.positions, 3)
  );
  extrasGeometry.setAttribute(
    'aBodyT',
    new THREE.Float32BufferAttribute(extras.bodyT, 1)
  );
  extrasGeometry.computeVertexNormals();

  const geometry = mergeGeometries([body, extrasGeometry], false);
  body.dispose();
  extrasGeometry.dispose();

  // Lure: hero only. A thin stalk arcing forward from the brow with a
  // small bulb, kept as separate geometry so it can take the unlit accent
  // material while the body stays on the ink toon material.
  let lureGeometry: THREE.BufferGeometry | null = null;
  const lureOffset = new THREE.Vector3(
    nose.x + length * 0.08,
    nose.y + girth * 1.35,
    0
  );
  if (isHero) {
    const bulbRadius = girth * 0.16;
    const bulb = new THREE.SphereGeometry(bulbRadius, 10, 8);
    bulb.translate(lureOffset.x, lureOffset.y, lureOffset.z);
    const stalk = new THREE.CylinderGeometry(
      bulbRadius * 0.2,
      bulbRadius * 0.35,
      girth * 1.1,
      5
    );
    stalk.rotateZ(0.5);
    stalk.translate(
      (lureOffset.x + nose.x) / 2 - length * 0.03,
      nose.y + girth * 0.8,
      0
    );
    lureGeometry = mergeGeometries([bulb, stalk], false);
    bulb.dispose();
    stalk.dispose();
  }

  const gray = new THREE.Color().setHSL(0, 0, grayLightness);

  return {
    geometry,
    lureGeometry,
    lureOffset,
    materialParams: {
      baseColor: '#' + gray.getHexString(),
      bands: 3,
      stripeFrequency,
      stripeStrength,
      stripePhase,
      hasLure: isHero,
      lureColor: ACCENT,
    },
    dimensions: {
      length: length + tailLength,
      height: girth * 2 + dorsalHeight,
    },
  };
}
