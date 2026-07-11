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

/**
 * Create a `mulberry32` PRNG stream from a 32-bit integer seed.
 *
 * `mulberry32` is a small, fast, well-distributed generator. Each call to the
 * returned function advances the internal state and returns the next value in
 * [0, 1). Used by `ComputeEngine.randomSeed` to give `Random()` a
 * deterministic, reproducible stream.
 *
 * NOT bit-compatible with any other RNG (e.g. Desmos); any well-distributed
 * deterministic sequence is all we need.
 *
 * @param seed A 32-bit unsigned integer seed.
 * @returns A function drawing successive uniforms in [0, 1).
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Hash a string (or number) seed to a 32-bit unsigned integer, so a
 * string `randomSeed` can drive an integer-seeded PRNG stream. Uses the
 * FNV-1a hash. Deterministic across hosts for the same input.
 */
export function hashSeed(seed: number | string): number {
  if (typeof seed === 'number') {
    // Fold a finite number to a 32-bit integer. Non-finite → 0.
    if (!Number.isFinite(seed)) return 0;
    // Mix the bit pattern of the double so fractional seeds decorrelate.
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, seed);
    return (buf.getUint32(0) ^ buf.getUint32(4)) >>> 0;
  }
  let h = 2166136261 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
