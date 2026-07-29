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
 * `Math.imul`, hoisted to a direct function reference.
 *
 * NOT a style preference — a 100x hot-path difference when the engine runs
 * inside a secondary V8 context (`vm.createContext`), which is what a jest
 * test file, a sandboxed worker, or an embedder-supplied realm is. V8 inlines
 * `Math.imul(...)` to the machine instruction only when `Math` is the NATIVE
 * context's; reached through another context's global it degrades to a
 * property load plus a call — measured on node 22 / V8 12.4 at ~880 ms per
 * 1e7 calls in a `vm` context versus ~9 ms in the main realm, and ~7 s under
 * jest, which layers its own wrapper on top. Binding the function once here
 * removes the per-call lookup: the same 1e7 calls drop to ~40 ms.
 *
 * It matters here and not elsewhere because `pcg3d` is the per-DRAW hash: a
 * 1e7-sample Monte-Carlo estimate calls it 1e7 times, six `imul` each. Keep
 * every hot-path use below on this alias.
 */
const imul = Math.imul;

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
  let x = (imul(v0, 1664525) + 1013904223) >>> 0;
  let y = (imul(v1, 1664525) + 1013904223) >>> 0;
  let z = (imul(v2, 1664525) + 1013904223) >>> 0;

  x = (x + imul(y, z)) >>> 0;
  y = (y + imul(z, x)) >>> 0;
  z = (z + imul(x, y)) >>> 0;

  x = (x ^ (x >>> 16)) >>> 0;
  y = (y ^ (y >>> 16)) >>> 0;
  z = (z ^ (z >>> 16)) >>> 0;

  x = (x + imul(y, z)) >>> 0;
  y = (y + imul(z, x)) >>> 0;
  z = (z + imul(x, y)) >>> 0;

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

//
// ─── Derived sub-streams ────────────────────────────────────────────────────
//
// `docs/plans/2026-07-28-derived-substreams.md`. The stochastic ESTIMATORS —
// Monte-Carlo integration, the sampled equality probe — need to replay under a
// `WithRandomSeed` frame without drawing FROM it: they consume 1e4–1e7
// samples, and the sampling loop is deadline-truncated, so routing them
// through `ce._random()` would make the frame's own counter depend on how many
// samples happened to run, i.e. on wall-clock time.
//
// A derived sub-stream is therefore a PRIVATE counter whose seed is a pure
// function of the frame's seed and a caller-supplied tag. The frame's `next`
// is READ, never advanced: an integral consumes ZERO frame indices, so adding
// or removing one cannot shift a sibling `Random()` draw.
//

/**
 * Successive uniforms in `[0, 1)`. Deterministic when derived from a frame,
 * live (`Math.random`) when derived outside one.
 */
export type RandomSubstream = () => number;

/**
 * A private counter-based stream seeded from `frame` and `tag`.
 *
 * - **Framed**: the sub-stream's seed words are `pcg3dWords(seedLo, seedHi,
 *   tag)`, and its draws are `frameDraw(lo', hi', n)` for a private `n`
 *   starting at 0. The frame is not mutated — `next` is not even read, so two
 *   sub-streams derived with the same tag from the same frame are IDENTICAL
 *   regardless of how many draws the frame has taken. That is the
 *   reordering-insensitivity the design is for.
 * - **Unframed**: `Math.random`. There is no ambient seed to derive from, so
 *   an unframed estimator stays live — `RANDOMNESS-MODEL.md` §1, and the §8
 *   ruling that the unseeded arm is exempt from parity.
 *
 * `tag` identifies WHICH sub-stream: callers pass a structural hash of the
 * expression being estimated (`expr.hash`), so the same integral in the same
 * frame always samples the same points. Only the low 32 bits matter (`>>> 0`).
 *
 * **Stability**: the `(seed, tag) → stream` mapping is a persistence surface,
 * pinned by `random-vectors.test.ts` for fixed literal inputs — changing any
 * operation here re-randomizes every seeded estimate. The TAG VALUES are
 * deliberately NOT pinned: `expr.hash` is free to change, and a hash change is
 * accepted to shift seeded estimates (design doc §3.1). Never write a test
 * that hardcodes what a seeded estimate evaluates to.
 */
export function deriveSubstream(
  frame: RandomSeedFrame | undefined,
  tag: number
): RandomSubstream {
  if (frame === undefined) return Math.random;
  const [lo, hi] = pcg3dWords(frame.seedLo, frame.seedHi, tag >>> 0);
  let n = 0;
  return () => frameDraw(lo, hi, n++ >>> 0);
}

/**
 * Combine several structural hashes into one sub-stream tag.
 *
 * An estimator is usually identified by more than one expression — an
 * integrand plus its limits, the two sides of an equality probe — and every
 * call site must combine them the SAME way, or "the same integral samples the
 * same points" quietly stops holding between paths. This is that one way.
 *
 * Order-sensitive (`31 * h + x`, the conventional polynomial mix), so
 * `∫f dx dy` and `∫f dy dx` get distinct streams — they are distinct
 * computations.
 *
 * Lives here, in a leaf module with no engine imports, rather than in
 * `boxed-expression/utils.ts`: `stochastic-equal.ts` deliberately avoids
 * importing `utils.ts` to stay out of the `compare → stochastic-equal →
 * compile-expression → base-compiler → utils` cycle, and it is one of the two
 * callers.
 */
export function mixTags(...hashes: number[]): number {
  let h = 0;
  for (const x of hashes) h = (imul(h, 31) + (x | 0)) | 0;
  return h >>> 0;
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
    lo = imul(lo ^ unit, 16777619) >>> 0;
    hi = imul(hi ^ unit, 16777619) >>> 0;
  }
  return [lo, hi];
}
