/**
 * The generator behind the random family — `Random`, `RandomChoice`,
 * `RandomSample`, `RandomShuffle` — and the `WithRandomSeed` frames that seed
 * them. See `docs/RANDOMNESS-MODEL.md` for the model, and
 * `docs/plans/2026-07-25-random-signature-redesign.md` for the design record.
 *
 * The n-th draw of a frame is `hash(seed, n)` — a PURE function of the seed and
 * the draw index, computed with PCG3D over pure u32 arithmetic. Because there
 * is no mutable stream state and no 64-bit integer arithmetic, every target
 * (the interpreter, the JavaScript compile target, GLSL and WGSL) is a
 * TRANSCRIPTION of one algorithm rather than an independent reimplementation,
 * which is what makes the cross-target parity contract of `RANDOMNESS-MODEL.md`
 * §4 hold.
 */

/**
 * Cap on the number of elements a random operator will eagerly materialize.
 * An unbounded eager allocation is an uncatchable heap-OOM, so operators refuse
 * past this bound rather than attempt it.
 */
export const MAX_RANDOM_ELEMENT_COUNT = 1_000_000;

//
// ─── Block-scoped seeding: PCG3D counter-based draws ────────────────────────
//
// See `docs/plans/2026-07-25-random-signature-redesign.md` §2 and §4. The
// n-th draw of a `WithRandomSeed` frame is a PURE function of the seed and the
// draw index: `hash(seed, n)`, with no mutable stream state. That is what lets
// the interpreter, the JS target and (as f32) the GPU targets agree.
//
// The seed→stream mapping is a CROSS-VERSION CONTRACT: changing any constant
// or operation order below re-randomizes every stored document. It is pinned
// by `test/compute-engine/random-vectors.test.ts`.
//

/**
 * A block-scoped random seed frame: a 64-bit seed carried as two u32 words,
 * plus the index of the next draw (a mutable counter, consumed as
 * `next++ >>> 0` — u32, wrapping mod 2³²).
 */
export type RandomSeedFrame = {
  seedLo: number;
  seedHi: number;
  next: number;
};

/**
 * PCG3D — Jarzynski & Olano, *Hash Functions for GPU Rendering*, JCGT 2020,
 * §6. Transcribed verbatim from the paper's GLSL listing:
 *
 * ```glsl
 * uint3 pcg3d(uint3 v) {
 *     v = v * 1664525u + 1013904223u;
 *     v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
 *     v ^= v >> 16u;
 *     v.x += v.y*v.z; v.y += v.z*v.x; v.z += v.x*v.y;
 *     return v;
 * }
 * ```
 *
 * Pure u32 arithmetic, so it is a transcription (not a reimplementation) on
 * every target: JS uses `Math.imul` for the 32-bit multiplies and `>>> 0` to
 * stay in u32 space. The cross-multiply-adds are SEQUENTIAL — `v.y += v.z*v.x`
 * reads the `v.x` just updated.
 *
 * @returns the three u32 output words `[w0, w1, w2]`.
 */
export function pcg3d(
  v0: number,
  v1: number,
  v2: number
): [number, number, number] {
  let x = (Math.imul(v0, 1664525) + 1013904223) >>> 0;
  let y = (Math.imul(v1, 1664525) + 1013904223) >>> 0;
  let z = (Math.imul(v2, 1664525) + 1013904223) >>> 0;

  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;

  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;

  x = (x + Math.imul(y, z)) >>> 0;
  y = (y + Math.imul(z, x)) >>> 0;
  z = (z + Math.imul(x, y)) >>> 0;

  return [x, y, z];
}

/**
 * The raw PCG3D words backing the `n`-th draw of the frame `(seedLo, seedHi)`.
 * `w2` is unused by the f64 and f32 presentations, but is returned so a third
 * party can verify a reimplementation against the paper.
 */
export function pcg3dWords(
  seedLo: number,
  seedHi: number,
  n: number
): [number, number, number] {
  return pcg3d(seedLo >>> 0, seedHi >>> 0, n >>> 0);
}

/**
 * The `n`-th draw of the frame seeded `(seedLo, seedHi)`, as an IEEE float64
 * in `[0, 1)` — the f64 tier presentation of §2:
 *
 * ```
 * (w0 * 2^21 + (w1 >>> 11)) * 2^-53
 * ```
 *
 * 53 mantissa bits, exact power-of-two scaling. Draws are float64 regardless
 * of the engine's precision mode, so high-precision evaluation reproduces the
 * same stream.
 *
 * The GPU tier presents the SAME `w0` as `(w0 >>> 8) * 2^-24`, so the two
 * tiers agree to within 2⁻²⁴ by construction.
 */
export function frameDraw(seedLo: number, seedHi: number, n: number): number {
  const [w0, w1] = pcg3dWords(seedLo, seedHi, n);
  return (w0 * 2 ** 21 + (w1 >>> 11)) * 2 ** -53;
}

/**
 * Fold a seed into the two u32 words of a `RandomSeedFrame` — **normative**
 * (§4), pinned by the §8 stability vectors.
 *
 * - A finite real is written as an f64 (`DataView.setFloat64`, big-endian —
 *   the `DataView` default) and read back as two words: `seedLo` is the high
 *   word, `seedHi` the low word. There is NO XOR: the retired `hashSeed` folded
 *   the two halves together and discarded half the information, which is
 *   exactly what made seeds differing only in low mantissa bits collide.
 * - `-0` is normalized to `0` first: the raw bytes differ in the sign bit, but
 *   `-0 === 0` everywhere else in the language, so distinct streams would be a
 *   trap.
 * - A non-finite seed THROWS: callers translate it into a structured error.
 *   (The retired `hashSeed` silently mapped them to `0`, sharing one stream
 *   between `NaN`, `+∞` and `-∞`.)
 * - A string is folded by two FNV-1a runs over its UTF-16 code units (each
 *   16-bit unit XORed whole, then multiplied by the FNV prime `16777619`),
 *   differing only in the offset basis: `0x811C9DC5` (the standard 32-bit
 *   basis) for `seedLo`, `0xCBF29CE4` (the high word of the 64-bit basis
 *   `0xCBF29CE484222325`) for `seedHi`.
 */
export function foldSeed(seed: number | string): [number, number] {
  if (typeof seed === 'number') {
    if (!Number.isFinite(seed))
      throw new Error(`Invalid random seed: ${seed} is not a finite real`);
    // Normalize -0 to 0 (`Object.is(seed, -0)`), so both fold identically.
    const value = seed === 0 ? 0 : seed;
    const buf = new DataView(new ArrayBuffer(8));
    buf.setFloat64(0, value); // big-endian (the DataView default)
    return [buf.getUint32(0) >>> 0, buf.getUint32(4) >>> 0];
  }

  let lo = 0x811c9dc5 >>> 0;
  let hi = 0xcbf29ce4 >>> 0;
  for (let i = 0; i < seed.length; i++) {
    const unit = seed.charCodeAt(i);
    lo = Math.imul(lo ^ unit, 16777619) >>> 0;
    hi = Math.imul(hi ^ unit, 16777619) >>> 0;
  }
  return [lo, hi];
}
