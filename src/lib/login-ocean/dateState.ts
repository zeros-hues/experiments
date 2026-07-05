/**
 * Deterministic date-driven state for the admin login ocean scene.
 *
 * Pure module: no React, no Three.js, no browser APIs. Every export is a
 * pure function of its inputs, so this file is directly unit-testable.
 *
 * The story encoded here: on 1 January the year starts with one fish per
 * day in the year. Each day one fish is eaten, and the survivors absorb
 * its mass, so the remaining fish grow. On the last day of the year a
 * single whale-sized creature remains.
 */

export interface OceanDayState {
  /** Ordinal day within the current year, 1-based (1 Jan = 1). */
  dayOfYear: number;
  /** Real number of days in this year (365 or 366, computed, not assumed). */
  totalDays: number;
  /** Fish remaining today: totalDays - dayOfYear + 1. Never below 1. */
  fishCount: number;
  /**
   * Mass-conserving size multiplier relative to a day-1 fish.
   * Total mass is constant, so each survivor's volume is
   * totalDays / fishCount times a day-1 fish, and linear size is the
   * cube root of that. Day 1 = 1.0, last day of the year ~= 7.15.
   */
  heroSizeScale: number;
  /** 32-bit unsigned seed hashed from the local date key. */
  seed: number;
  /** Local date as YYYY-MM-DD, the exact string the seed was hashed from. */
  dateKey: string;
}

export function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

export function getDaysInYear(year: number): number {
  return isLeapYear(year) ? 366 : 365;
}

/**
 * Ordinal day of the year for the date's LOCAL calendar day.
 * The local year/month/day are read first, then the arithmetic is done in
 * UTC space so daylight-saving shifts can never make a day 23 or 25 hours
 * long and skew the floor().
 */
export function getDayOfYear(date: Date): number {
  const startOfYearUtc = Date.UTC(date.getFullYear(), 0, 1);
  const dayUtc = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return Math.floor((dayUtc - startOfYearUtc) / 86_400_000) + 1;
}

/** Local date formatted as YYYY-MM-DD. This string is the seed source. */
export function formatDateKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * FNV-1a 32-bit hash with a murmur3-style finalizer.
 * The finalizer matters: without it, consecutive dates ("2026-07-05" vs
 * "2026-07-06") hash to nearby values and the PRNG streams look similar
 * across days. With it, one changed character avalanches the whole seed.
 */
export function hashStringToSeed(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * Mulberry32: tiny, fast, deterministic PRNG.
 * Returns a function yielding floats in [0, 1). Same seed, same sequence,
 * on every platform. Use this everywhere instead of Math.random() for
 * anything date-dependent (breed, per-fish parameters, boid start state).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Derive an independent per-entity seed from the day seed and an index.
 * Lets fish i own its own PRNG stream: consuming a different number of
 * random values for fish 3 can never shift what fish 4 looks like.
 */
export function deriveSeed(seed: number, index: number): number {
  let h = (seed + Math.imul(index + 1, 0x9e3779b9)) >>> 0;
  h ^= h >>> 16;
  h = Math.imul(h, 0x21f0aaad);
  h ^= h >>> 15;
  h = Math.imul(h, 0x735a2d97);
  h ^= h >>> 15;
  return h >>> 0;
}

/**
 * The single entry point the scene consumes.
 * Pass `new Date()` on the client, or a date built from a server-provided
 * YYYY-MM-DD string when avoiding a hydration flash.
 */
export function getOceanDayState(date: Date): OceanDayState {
  const totalDays = getDaysInYear(date.getFullYear());
  const dayOfYear = Math.min(Math.max(getDayOfYear(date), 1), totalDays);
  const fishCount = totalDays - dayOfYear + 1;
  const heroSizeScale = Math.cbrt(totalDays / fishCount);
  const dateKey = formatDateKey(date);
  const seed = hashStringToSeed(dateKey);
  return { dayOfYear, totalDays, fishCount, heroSizeScale, seed, dateKey };
}

/** Rebuild a local Date from a YYYY-MM-DD key (for the SSR-prop pattern). */
export function parseDateKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split('-').map(Number);
  return new Date(y, m - 1, d);
}
