/**
 * Opt-in instrumentation for the engine's memoization layers, gated on the
 * `CE_CACHE_STATS` environment variable (env-gated like `CE_DEBUG_BINDINGS`
 * and `CE_MEMO_PARANOID`). A measuring aid, not a semantic mode: with the
 * flag unset — the default — every hook is a single branch on the
 * `CACHE_STATS` module constant and nothing is recorded.
 *
 * What it answers: how often does a `_anyVersion` bump invalidate a cache
 * entry SPURIOUSLY — the recompute returns the same answer, because the
 * write that bumped the counter was to a binding the node does not depend
 * on. That share (`missGenerationWasted / missGeneration`) bounds what a
 * finer-grained invalidation axis (per-definition dependency keys, as the
 * element memo already uses) could save on that cache class.
 *
 * Counter-bump totals (`bumps`) are recorded alongside for denominator
 * context: a bump itself is O(1) and evicts nothing — cost only
 * materializes as misses on subsequent reads.
 *
 * `missGenerationWasted` is a SUBSET of `missGeneration`, not a separate
 * outcome: a wasted miss is recorded as both.
 */

const CACHE_CLASSES = [
  'sgn', // BoxedFunction._sgn — generation key
  'type', // BoxedFunction._type — same key, plus the _typeGeneration fast path
  'effects', // BoxedFunction._effects — generation key, cycle-safe bespoke
  'lazyValue', // the lazy-collection evaluate memo — epoch + generation + scope
  'elementMemo', // collection-element-memo — epoch + per-dependency versions
  'collectionFacet', // count/isEmpty/isFinite facet memo — epoch + per-dependency versions
  'typeParse', // common/type/parse TYPE_CACHE — bounded, clear-all on overflow
] as const;
export type CacheClass = (typeof CACHE_CLASSES)[number];

const CACHE_EVENTS = [
  'hit', // generation-keyed entry served
  'hitConstant', // generation-independent entry served
  'hitFastPath', // `_typeGeneration` same-generation short-circuit
  'missCold', // no entry had ever been filled
  'missGeneration', // the generation key moved
  'missGenerationWasted', // …and the recompute produced the SAME answer
  'missEpoch', // `_worldVersion` moved
  'missScope', // ambient lexical-scope identity changed (lazyValue only)
  'missKeyShape', // entry key kind (constant vs generation) changed
  'missDependency', // a tracked dependency moved (elementMemo only)
  'declineCycle', // re-entrant/provisional read served uncached
  'declineStore', // settled-only or purity gate suppressed the write
  'evictClear', // bounded cache overflowed and dropped ALL entries (typeParse only)
] as const;
export type CacheEvent = (typeof CACHE_EVENTS)[number];

const BUMP_KINDS = [
  'generation',
  'mutationGeneration',
  'semanticEpoch',
  'valueWrite', // semantic value write on a definition
  'ephemeralValueWrite', // big-op/comprehension loop-index write
] as const;
export type BumpKind = (typeof BUMP_KINDS)[number];

/**
 * How an evaluation context was discarded.
 *
 * A CLEAN pop is one where no axis moved while the context was on the stack,
 * so the pop reverts nothing and must not advance the generation. That is what
 * keeps a read-only scoped probe — a comprehension count, a lazy emptiness
 * walk, which push and pop a context per read — from retiring every type and
 * sign cache in the engine. The clean share of all pops is therefore the
 * measure of whether such a probe still costs nothing, and it is compared
 * against a baseline whenever the write path gains a new bracket
 * (`engine-scope.ts`, `discardEvalContext`).
 */
const SCOPE_POP_KINDS = ['clean', 'dirty'] as const;
export type ScopePopKind = (typeof SCOPE_POP_KINDS)[number];

/** True when `CE_CACHE_STATS` is set (and not `'0'`) in the environment at
 * module load. Hot-path hooks test this constant before recording. */
export const CACHE_STATS: boolean = (() => {
  if (typeof process === 'undefined') return false;
  const flag = process.env?.CE_CACHE_STATS;
  return flag !== undefined && flag !== '0';
})();

/** True under the test runner (`NODE_ENV=test`, which jest sets) or when
 * `CE_CACHE_STATS` is set. The plain call counters the cost pins read
 * (`subtypeStats` in `common/type/subtype.ts`, `descriptorStats` in
 * `boxed-expression/operand-descriptor.ts`) are incremented only when this
 * is true, so a production hot path pays nothing for them. A test reads
 * them through the module export because an ES-module export cannot be
 * spied on. */
export const COUNT_STATS: boolean =
  CACHE_STATS ||
  (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');

type CacheCounters = Record<CacheEvent, number>;

function emptyCounters(): CacheCounters {
  const c = {} as CacheCounters;
  for (const ev of CACHE_EVENTS) c[ev] = 0;
  return c;
}

const stats: Record<CacheClass, CacheCounters> = (() => {
  const s = {} as Record<CacheClass, CacheCounters>;
  for (const cls of CACHE_CLASSES) s[cls] = emptyCounters();
  return s;
})();

const bumps: Record<BumpKind, number> = (() => {
  const b = {} as Record<BumpKind, number>;
  for (const k of BUMP_KINDS) b[k] = 0;
  return b;
})();

const scopePops: Record<ScopePopKind, number> = (() => {
  const p = {} as Record<ScopePopKind, number>;
  for (const k of SCOPE_POP_KINDS) p[k] = 0;
  return p;
})();

export function recordCache(cls: CacheClass, ev: CacheEvent): void {
  stats[cls][ev] += 1;
}

export function recordBump(kind: BumpKind): void {
  bumps[kind] += 1;
}

export function recordScopePop(kind: ScopePopKind): void {
  scopePops[kind] += 1;
}

// The instrumented mirror of `cachedValue()` used to live here, as a
// stats-recording clone of that function. It was folded INTO `cachedValue()`
// itself (`boxed-expression/cache.ts`, the optional `stats` argument) once the
// helper grew object-version dependency tracking: a clone would have had to
// mirror the hit validation, the hit-time dependency merge, the
// payload-contains-an-object refusal and the throw-commits-nothing rule, and a
// mirror that drifts is a correctness hole that only appears under
// `CE_CACHE_STATS`. One implementation, one behavior, stats on or off.

export type CacheStatsSnapshot = {
  caches: Record<CacheClass, CacheCounters>;
  bumps: Record<BumpKind, number>;
  scopePops: Record<ScopePopKind, number>;
};

export function cacheStatsSnapshot(): CacheStatsSnapshot {
  return structuredClone({ caches: stats, bumps, scopePops });
}

export function resetCacheStats(): void {
  for (const cls of CACHE_CLASSES)
    for (const ev of CACHE_EVENTS) stats[cls][ev] = 0;
  for (const k of BUMP_KINDS) bumps[k] = 0;
  for (const k of SCOPE_POP_KINDS) scopePops[k] = 0;
}

/** Human-readable report: per-cache reads, hit rate, miss breakdown, and the
 * wasted share of generation misses; counter bumps at the end. */
export function formatCacheStats(): string {
  const lines: string[] = [];
  const pct = (n: number, d: number): string =>
    d === 0 ? '—' : ((100 * n) / d).toFixed(1) + '%';

  for (const cls of CACHE_CLASSES) {
    const c = stats[cls];
    const hits = c.hit + c.hitConstant + c.hitFastPath;
    const misses =
      c.missCold +
      c.missGeneration +
      c.missEpoch +
      c.missScope +
      c.missKeyShape +
      c.missDependency;
    const reads = hits + misses + c.declineCycle;
    if (reads === 0 && c.declineStore === 0) continue;

    lines.push(`${cls}: ${reads} reads, hit ${pct(hits, reads)}`);
    lines.push(
      `  hits: gen ${c.hit}, constant ${c.hitConstant}` +
        (c.hitFastPath ? `, fast-path ${c.hitFastPath}` : '')
    );
    const parts: string[] = [];
    if (c.missCold) parts.push(`cold ${c.missCold}`);
    if (c.missGeneration)
      parts.push(
        `generation ${c.missGeneration} (wasted ${c.missGenerationWasted} = ` +
          `${pct(c.missGenerationWasted, c.missGeneration)})`
      );
    if (c.missEpoch) parts.push(`epoch ${c.missEpoch}`);
    if (c.missScope) parts.push(`scope ${c.missScope}`);
    if (c.missKeyShape) parts.push(`key-shape ${c.missKeyShape}`);
    if (c.missDependency) parts.push(`dependency ${c.missDependency}`);
    if (parts.length > 0) lines.push(`  misses: ${parts.join(', ')}`);
    if (c.declineCycle || c.declineStore)
      lines.push(
        `  declines: cycle ${c.declineCycle}, store ${c.declineStore}`
      );
    if (c.evictClear)
      lines.push(`  overflow clears: ${c.evictClear} (whole cache dropped)`);
  }

  lines.push(
    `bumps: generation ${bumps.generation}, ` +
      `mutation ${bumps.mutationGeneration}, ` +
      `epoch ${bumps.semanticEpoch}, ` +
      `value-writes ${bumps.valueWrite} ` +
      `(+${bumps.ephemeralValueWrite} ephemeral)`
  );
  lines.push(
    `scope pops: clean ${scopePops.clean}, dirty ${scopePops.dirty} ` +
      `(clean ${pct(scopePops.clean, scopePops.clean + scopePops.dirty)})`
  );
  return lines.join('\n');
}
