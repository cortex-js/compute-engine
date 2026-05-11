/**
 * Shared deterministic-PRNG helpers for Random/Shuffle/Sample.
 *
 * The hash matches the GLSL/WGSL formula used by the GPU compile target:
 *   fract(sin(seed * 12.9898) * 43758.5453)
 *
 * JS↔GLSL parity is approximate (fp64 vs fp32; Math.sin is not bit-portable).
 * Within a single host, the same seed always yields the same value.
 */

/**
 * Return a deterministic pseudorandom value in [0, 1) for the given seed.
 * Matches the GLSL `_gpu_random(seed)` hash to within fp32 precision.
 */
export function deterministicRandom(seed: number): number {
  const v = Math.sin(seed * 12.9898) * 43758.5453;
  return v - Math.floor(v);
}

/**
 * Advance the seed by a fixed amount so subsequent calls produce decorrelated
 * draws. Used by Shuffle/Sample to walk through the elements deterministically.
 * Uses a Weyl-sequence-style increment (golden-ratio fractional part).
 *
 * @param seed The current seed value.
 * @returns The next seed in the sequence.
 */
export function nextSeed(seed: number): number {
  // Increment by the fractional part of the golden ratio (low-discrepancy).
  // The exact constant doesn't matter; what matters is that it's irrational
  // and the increment moves the seed enough to break the local sin(x) cycle.
  return seed + 0.6180339887498949;
}
