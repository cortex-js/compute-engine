/**
 * Off switches for the engine's caches, for measurement only. The
 * environment variable `CE_CACHE_OFF` holds a comma-separated list of the
 * names in {@link CACHE_SWITCHES}, or `all`. A named cache then serves no
 * entry, so a timing run shows what the hits of that cache save. How a
 * switch does this depends on the cache, and each call of `cacheOff()` shows
 * it:
 *
 * - Most switches skip the look-up, and the cache still stores its entries
 *   (`appmemo`, `approx`, `dictionary`, `eagersource`, `effects`,
 *   `facet`, `lazyvalue`, `limitprobe`, `slice`, `typeparse`, and the
 *   look-up of `element` and of the zero verdicts of `contour`).
 * - `sgn` and `type` empty their cell before each read, unless a
 *   computation of the cell is in progress: a re-entrant read must still get
 *   the answer that ends a recursive read (`forgetSettledValue()`,
 *   `boxed-expression/cache.ts`). With `type` off, the type of a recursive
 *   function that is not trivial is computed again at each level of the
 *   recursion, which is exponential: the type of `F(m)` with
 *   `F := n ↦ If(n = 0, [1, 2], 2·F(n − 1))` takes more than a minute, and
 *   several workloads of the benchmark driver do not finish.
 * - Some switches bypass the cache completely, with no look-up and no store
 *   (`factor`, `materializedat`, `settingspayload`, `storedvalue`, the
 *   complex parts of `contour`, and the cells that `element` computes one
 *   index at a time). `shared` does not create the memo of the top-level
 *   evaluation.
 * - `mapcompile` deletes the entry before the look-up, so each call
 *   compiles again.
 * - `sequence` stops the store of the terms in the memo of the sequence.
 *
 * The parts of a cache that decide a result have no switch and stay on: the
 * "incomplete walk" answer of the facet memo and the terms of a sequence that
 * one read keeps. Two caches also define a result, and a run with their
 * switch off can give another result: the element memo gives one set of
 * random draws per collection instance, and the eager source values make
 * host code that does not state its purity run once per evaluation of a
 * view (with `eagersource` off, a host source that returns `[n, 10]` with
 * `n` counting its calls gives another `Sum(Reverse(src()))`, and is
 * called more often). The benchmark driver
 * (`benchmarks/evaluation-caches.ts`) prints a digest of the results of each
 * workload, so that a changed result of a workload shows. Its digests are
 * not a test of these two results: no workload calls host code, and the
 * random draws of `tycho-evaluate` (56 `RandomChoice` calls) are inside
 * `WithRandomSeed`, so they are seeded.
 *
 * The variable is read once, when this module loads, like `CE_CACHE_STATS`
 * (`cache-stats.ts`). A browser has no `process` object, so every cache is
 * on there. This module imports nothing, so that every module of the engine
 * can import it with no dependency cycle.
 *
 * The driver `benchmarks/evaluation-caches.ts` runs workloads with each
 * switch.
 */

/** The name of each cache that has an off switch. Each name is read by at
 * least one `cacheOff()` call in the source
 * (`test/compute-engine/cache-switches.test.ts` checks it). */
export const CACHE_SWITCHES = [
  'appmemo', // application memo of function literals (`function-utils.ts`)
  'approx', // approximations of the comparisons (`boxed-expression/compare.ts`)
  'contour', // contour zero and complex-parts memos (`symbolic/contour.ts`)
  'dictionary', // dictionary evaluation memo (`boxed-dictionary.ts`)
  'eagersource', // eager source values (`boxed-expression/eager-source-values.ts`)
  'effects', // effects cache of a function expression (`boxed-function.ts`)
  'element', // element memo of a lazy collection (`collection-element-memo.ts`)
  'facet', // count, isEmpty and isFinite memo (`boxed-function.ts`)
  'factor', // factor memo (`boxed-expression/factor.ts`)
  'lazyvalue', // lazy value memo of a collection view (`boxed-function.ts`)
  'limitprobe', // compiled probes of `Limit` (`symbolic/limit.ts`)
  'mapcompile', // compiled element function of `Map` (`library/map-auto-compile.ts`)
  'materializedat', // the evaluated collection that `at()` reads (`boxed-function.ts`)
  'sequence', // terms of a declared sequence kept across reads (`sequence.ts`)
  'settingspayload', // enclosure endpoints (`library/enclosure-arithmetic.ts`)
  'sgn', // sign cache of a function expression (`boxed-function.ts`)
  'shared', // memo of shared subexpressions (`shared-evaluation-memo.ts`)
  'slice', // bounds of a `Slice` (`library/collections.ts`)
  'storedvalue', // evaluated stored value of a symbol (`boxed-symbol.ts`)
  'type', // type cache of a function expression (`boxed-function.ts`)
  'typeparse', // parsed type strings (`common/type/parse.ts`)
] as const;
export type CacheSwitch = (typeof CACHE_SWITCHES)[number];

const OFF: ReadonlySet<string> = (() => {
  if (typeof process === 'undefined') return new Set<string>();
  return new Set(
    (process.env?.CE_CACHE_OFF ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
  );
})();

const ANY_OFF = OFF.size > 0;

/** True when the cache `name` is turned off by `CE_CACHE_OFF`. */
export function cacheOff(name: CacheSwitch): boolean {
  return ANY_OFF && (OFF.has(name) || OFF.has('all'));
}
