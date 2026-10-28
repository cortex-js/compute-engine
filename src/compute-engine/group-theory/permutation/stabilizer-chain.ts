/**
 * Stabilizer chains for permutation groups, built with an incremental,
 * deterministic Schreier–Sims algorithm.
 *
 * Conventions. Points are the integers 1..n of the action. Permutations act on
 * the right: `composePermutations(a, b)` applies `a` first, then `b`. For a
 * permutation `g`, the image of point `p` is `g.images[p - 1] ?? p`, because
 * trailing fixed points are not stored.
 *
 * The chain. A chain is a list of levels 0..L-1. Level i has:
 * - a base point `b_i`;
 * - a strong generator list `S_i`. Every generator in `S_i` fixes the base
 *   points `b_0`..`b_{i-1}`, and `S_{i+1}` is a subset of `S_i`. Let `H_i` be
 *   the group that `S_i` generates;
 * - the orbit of `b_i` under `H_i`, stored as a tree. Orbit entry 0 is `b_i`.
 *   Entry k > 0 records the orbit index of its parent and the label (an index
 *   into `S_i`) of the generator that maps the parent point to this point.
 *   The parent index is always smaller than k.
 *
 * The transversal element `u_k` of level i is the product of the generator
 * labels on the tree path from entry 0 to entry k. It maps `b_i` to orbit
 * entry k. Transversal elements are not stored. They are rebuilt from the tree
 * when they are needed, and a bounded cache keeps recent ones.
 *
 * When the chain is complete, `H_0` is the input group G and `H_{i+1}` is the
 * full stabilizer of `b_i` in `H_i`. Then the order of G is the product of the
 * orbit sizes, and a permutation g is in G exactly when sifting g gives the
 * identity. To sift g, for each level i in order: find the orbit index k of
 * the image of `b_i` under the current residue, and multiply the residue on
 * the right by the inverse of `u_k`. After level i the residue fixes
 * `b_0`..`b_i`. If the image is not in the orbit, the sift stops there and g
 * is not in the group that the chain describes.
 *
 * The algorithm (`buildCertificate()`):
 * 1. Sift each input generator. A residue that is not the identity becomes a
 *    new strong generator (function `add`).
 * 2. Repeat: at some level d, take one orbit edge (point `p` at entry i,
 *    active generator `s`, image `p^s` at entry j) that is not yet processed,
 *    and sift its Schreier generator `u_i * s * u_j^-1` through levels d+1 and
 *    below. This element fixes `b_0`..`b_d`. A residue that is not the
 *    identity becomes a new strong generator.
 * 3. Stop when every orbit edge of every level is processed, or when the
 *    product of the orbit sizes is n!, which is the largest possible order.
 *
 * Correctness follows from Schreier's lemma: if `S_d` generates `H_d` and the
 * `u_k` are the transversal elements of the orbit of `b_d`, the Schreier
 * generators `u_i * s * u_j^-1` (s in `S_d`) generate the stabilizer of `b_d`
 * in `H_d`. When every Schreier generator of level d sifts to the identity
 * through levels d+1 and below, each one is a product of transversal elements
 * of those levels, so it is in `H_{d+1}`. `H_{d+1}` is also contained in the
 * stabilizer, because its generators fix `b_d`. So the two groups are equal.
 *
 * Resources. Every operation is charged to a `ChainWork` ledger, which counts
 * work units, stored image slots, orbit points and orbit edges against the
 * limits in `PermutationChainLimits`. A limit that is reached throws a
 * `PermutationChainLimitError`. The caller's `check()` callback is called on
 * every charge, so cancellation can stop the computation at any step.
 *
 * Proofs. `buildCertificate()` can also record, for each strong generator, a
 * word in the input generators that produces it. `verifyPermutationChain()`
 * checks such a certificate independently of the builder. This is a
 * diagnostic test oracle. Ordinary queries do not record proofs.
 */
import {
  PermutationValue,
  PermutationInputError,
  assertPermutationFits,
  degreeLimit,
  composePermutations,
  inversePermutation,
} from './values.js';
import {
  PermutationGroupValue,
  permutationGroupLimits,
  type PermutationGroupWork,
} from './groups.js';

/**
 * Resource limits for one chain construction or one query. Each limit throws a
 * `PermutationChainLimitError` with the code given below when it is exceeded.
 */
export interface PermutationChainLimits {
  /**
   * Total work units. One unit is charged per elementary step. A product, an
   * inverse or a key costs one unit plus the length of the longest image
   * array that it reads.
   * Code `permutation-chain-work-limit`.
   */
  readonly maxWork: number;
  /** Number of base points. Code `permutation-chain-level-limit`. */
  readonly maxLevels?: number;
  /**
   * Number of recorded proof steps. Diagnostic verifier only; production
   * queries record no proofs. Code `permutation-chain-proof-limit`.
   */
  readonly maxProofSteps?: number;
  /**
   * Number of (orbit point, generator) pairs examined while orbits grow.
   * Code `permutation-chain-orbit-edge-limit`.
   */
  readonly maxOrbitEdges?: number;
  /**
   * Total number of orbit points over all levels.
   * Code `permutation-chain-orbit-point-limit`.
   */
  readonly maxOrbitPoints?: number;
  /**
   * Live generator images, orbit-tree slots and cached transversal images.
   * Cached transversal images are released first when space is needed.
   * Code `permutation-chain-storage-limit`.
   */
  readonly maxStoredImages?: number;
}
/**
 * A resource limit was reached. The `code` names the limit. The computation
 * stops and returns no partial result.
 */
export class PermutationChainLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationChainLimitError';
  }
}

/**
 * Return `value` if it is a safe integer in 0..cap. Otherwise throw a
 * `PermutationInputError` with code `invalid-permutation-chain-<name>-limit`.
 */
function bound(value: number, cap: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > cap)
    throw new PermutationInputError(`invalid-permutation-chain-${name}-limit`);
  return value;
}
/**
 * Normalize resource policy before allocating trees or starting group work.
 * Fill in the default of each optional limit and reject a value outside its
 * fixed cap. The result has every field set, so a cache key that includes it
 * does not depend on how the caller spelled the defaults.
 */
export function permutationChainLimits(requested: PermutationChainLimits) {
  if (!requested)
    throw new PermutationInputError('invalid-permutation-chain-limits');
  return {
    maxWork: bound(requested.maxWork, 50_000_000, 'work'),
    maxLevels: bound(requested.maxLevels ?? 256, 256, 'level'),
    maxOrbitEdges: bound(
      requested.maxOrbitEdges ?? 1_000_000,
      50_000_000,
      'orbit-edge'
    ),
    maxProofSteps: bound(requested.maxProofSteps ?? 100_000, 100_000, 'proof'),
    maxOrbitPoints: bound(
      requested.maxOrbitPoints ?? 100_000,
      100_000,
      'orbit-point'
    ),
    maxStoredImages: bound(
      requested.maxStoredImages ?? 1_000_000,
      100_000_000,
      'storage'
    ),
  };
}

/**
 * Work is cumulative; storage counts live arrays. Scratch transversal entries
 * are evicted before permanent reservations. Every charged operation also checks
 * cancellation, including a lookup satisfied by the cache.
 *
 * One ledger belongs to one top-level operation: a chain construction, a
 * sift, a verification or a group query. Storage has two kinds:
 * - permanent: values passed to `retain()` and slots passed to `reserve()`.
 *   They stay charged until the operation ends. `buildCertificate()` subtracts
 *   its construction-only slots by hand when it finishes.
 * - scratch: cached transversal elements. They are charged while they are in
 *   the cache, and `reserve()` evicts them, oldest first, before it reports a
 *   storage limit.
 *
 * A nested query (for example, a chain built inside a subgroup test) runs
 * with its own ledger, limited by `remaining()` of the outer one. The outer
 * ledger then adds the nested totals once (see `chainInSession()` and
 * `containsInSession()`).
 */
class ChainWork {
  /** Work units charged so far. Never decreases. */
  used = 0;
  /** Image slots now charged: permanent reservations plus cached scratch. */
  stored = 0;
  /** Orbit points created so far, over all levels. */
  points = 0;
  /** Orbit edges examined so far, over all levels. */
  edges = 0;
  /**
   * The largest storage total that any storage check asked for:
   * `stored + count` in `reserve()`, and `stored` plus the new entry when a
   * transversal element is cached. Every decision that depends on
   * `maxStoredImages` (an eviction, a cache entry that is not stored, a
   * storage-limit error) compares one of these totals with the limit. So
   * when `demand <= maxStoredImages`, no such decision happened, and a run
   * with any storage limit of at least `demand` makes the same steps.
   */
  demand = 0;
  readonly limits: ReturnType<typeof permutationChainLimits>;
  // `values` and `caller` are the same caller policy object. `values` is
  // passed to permutation operations (degree limit, cancellation), and
  // `caller` is passed to nested queries.
  readonly values: PermutationGroupWork;
  readonly caller: PermutationGroupWork;
  /** Values that already have a permanent charge, so they are charged once. */
  private readonly retained = new Set<PermutationValue>();
  /**
   * Cached transversal elements, by level and key. Key k > 0 is `u_k`, key
   * -k is its inverse. Key 0 is the identity and is never cached.
   */
  private readonly transversals = new Map<
    PermutationChainLevel,
    Map<number, PermutationValue>
  >();
  /** Cache entries in insertion order. Eviction removes the first entry. */
  private readonly cacheOrder: {
    level: PermutationChainLevel;
    key: number;
    value: PermutationValue;
  }[] = [];
  constructor(requested: PermutationChainLimits, work: PermutationGroupWork) {
    this.limits = permutationChainLimits(requested);
    this.caller = work;
    this.values = work;
  }
  /**
   * The limits that are still available, for a nested query. A nested query
   * that stays inside these limits cannot make the outer totals exceed the
   * outer limits when they are added back.
   */
  remaining(): PermutationChainLimits {
    return {
      ...this.limits,
      maxWork: this.limits.maxWork - this.used,
      maxStoredImages: this.limits.maxStoredImages - this.stored,
      maxOrbitPoints: this.limits.maxOrbitPoints - this.points,
      maxOrbitEdges: this.limits.maxOrbitEdges - this.edges,
    };
  }
  /**
   * Charge `count` work units. Call the caller's cancellation check first, so
   * that every charged step can be cancelled. Throws
   * `permutation-chain-work-limit` before the total exceeds `maxWork`.
   */
  tick(count = 1) {
    this.caller.check?.();
    if (this.used + count > this.limits.maxWork)
      throw new PermutationChainLimitError('permutation-chain-work-limit');
    this.used += count;
  }
  /**
   * Reserve permanent entries, evicting scratch products first. Throws
   * `permutation-chain-storage-limit` only when the cache is empty and the
   * reservation still does not fit.
   */
  reserve(count: number) {
    this.demand = Math.max(this.demand, this.stored + count);
    while (
      this.cacheOrder.length &&
      this.stored + count > this.limits.maxStoredImages
    )
      this.evict();
    if (this.stored + count > this.limits.maxStoredImages)
      throw new PermutationChainLimitError('permutation-chain-storage-limit');
    this.stored += count;
  }
  /**
   * Charge the images of `value` as permanent storage, once per object. Use
   * this for a value that the result keeps, such as a strong generator or a
   * sift factor. A strong generator is shared by several levels but is
   * charged once.
   */
  retain(value: PermutationValue) {
    if (this.retained.has(value)) return;
    // Transfer cached storage into output ownership instead of charging it twice.
    for (let i = this.cacheOrder.length - 1; i >= 0; i--) {
      const entry = this.cacheOrder[i];
      if (entry.value !== value) continue;
      this.cacheOrder.splice(i, 1);
      this.transversals.get(entry.level)!.delete(entry.key);
      this.stored -= value.supportDegree;
    }
    this.reserve(value.supportDegree);
    this.retained.add(value);
  }
  /** Remove the oldest cache entry and release its charge. */
  private evict() {
    const entry = this.cacheOrder.shift()!;
    this.transversals.get(entry.level)!.delete(entry.key);
    this.stored -= entry.value.supportDegree;
  }
  /**
   * Release all scratch storage. After this call, `stored` holds only the
   * permanent charges.
   */
  clearTransversals() {
    while (this.cacheOrder.length) this.evict();
  }
  /**
   * A string that identifies the permutation. Images are normalized (no
   * trailing fixed points), so two equal permutations give the same key.
   */
  key(value: PermutationValue) {
    this.tick(1 + value.supportDegree);
    return value.images.join(',');
  }
  /** `left` then `right` (right action). Not charged as storage. */
  product(left: PermutationValue, right: PermutationValue) {
    this.tick(1 + Math.max(left.supportDegree, right.supportDegree));
    return composePermutations(left, right, this.values);
  }
  inverse(value: PermutationValue) {
    this.tick(1 + value.supportDegree);
    return inversePermutation(value, this.values);
  }
  /**
   * Check receiving resource policy without revalidating mathematical values.
   * The group was validated when it was built, possibly under a larger
   * policy. This call applies the caller's degree, generator-count and
   * generator-image limits and throws a `PermutationInputError` if the group
   * exceeds one of them.
   */
  receive(group: PermutationGroupValue) {
    this.tick();
    if (group.action.degree > degreeLimit(this.values))
      throw new PermutationInputError('permutation-degree-limit');
    const caps = permutationGroupLimits(this.values);
    if (group.generators.length > caps.maxGenerators)
      throw new PermutationInputError('permutation-generator-limit');
    if (
      group.generators.reduce((n, g) => n + g.supportDegree, 0) >
      caps.maxGeneratorImages
    )
      throw new PermutationInputError('permutation-generator-image-limit');
    return group;
  }
  /**
   * Recover a transversal from stable parent edges. An uncached lookup costs
   * O(degree * path length). At most 16384 products are cached across all levels;
   * negative keys distinguish inverse representatives from forward ones.
   *
   * Return `u_index` of `level`, the element that maps the base point to
   * `level.orbit[index]`, or its inverse when `inverse` is true.
   *
   * The cache stays valid while the level grows: orbit entries are only
   * appended, and the parent and label of an entry never change once set, so
   * the path from an entry to the root, and therefore `u_index`, never
   * changes. The cache key is the orbit index, negated for an inverse.
   */
  representative(
    level: PermutationChainLevel,
    index: number,
    inverse = false
  ): PermutationValue {
    this.tick();
    if (index === 0) return IDENTITY;
    let cache = this.transversals.get(level);
    if (!cache) {
      cache = new Map();
      this.transversals.set(level, cache);
    }
    const key = inverse ? -index : index;
    const known = cache.get(key);
    if (known) return known;
    let value: PermutationValue;
    if (inverse) value = this.inverse(this.representative(level, index));
    else {
      // Walk up the tree until the root or a cached ancestor. Then multiply
      // the edge labels back down: if entry k has parent p and label s, then
      // `u_k = u_p * s`, because s maps orbit[p] to orbit[k]. Intermediate
      // ancestors are not cached.
      const path: number[] = [];
      let cursor = index;
      while (cursor !== 0 && !cache.has(cursor)) {
        this.tick();
        path.push(cursor);
        cursor = level.parents[cursor];
      }
      value = cache.get(cursor) ?? IDENTITY;
      for (let i = path.length - 1; i >= 0; i--)
        value = this.product(value, level.generators[level.labels[path[i]]]);
    }
    // Make space for the new entry: keep at most 16384 entries, and evict old
    // entries while the new one does not fit in the storage limit.
    this.demand = Math.max(this.demand, this.stored + value.supportDegree);
    while (
      this.cacheOrder.length &&
      (this.cacheOrder.length >= 16384 ||
        this.stored + value.supportDegree > this.limits.maxStoredImages)
    )
      this.evict();
    // Caching must not turn an otherwise feasible computation into a limit error.
    if (this.stored + value.supportDegree <= this.limits.maxStoredImages) {
      cache.set(key, value);
      this.cacheOrder.push({ level, key, value });
      this.stored += value.supportDegree;
    }
    return value;
  }
}
const IDENTITY = PermutationValue.fromImages([]);
/** Lookup data for sifting through one level. */
interface ChainSiftData {
  /** Map from an orbit point to its index in `orbit`. */
  indices: ReadonlyMap<number, number>;
}

/** Level i generators fix bases 0..i-1. Parent indices always decrease. */
export interface PermutationChainLevel {
  /** The base point of this level. */
  readonly base: number;
  /**
   * The strong generators of this level. They fix every base point of the
   * levels above this one. The list of level i+1 is a subset of the list of
   * level i: the same objects, in the same relative order.
   */
  readonly generators: readonly PermutationValue[];
  /**
   * For each generator, the index of the proof step that produces it, when
   * the chain was built with proof recording. Otherwise each entry is -1.
   */
  readonly generatorProofs: readonly number[];
  /** The orbit of `base`. Entry 0 is `base`. */
  readonly orbit: readonly number[];
  /**
   * For entry k > 0, the index of the orbit entry from which entry k was
   * reached. It is smaller than k. Entry 0 has parent -1.
   */
  readonly parents: readonly number[];
  /**
   * For entry k > 0, the index in `generators` of the generator that maps
   * `orbit[parents[k]]` to `orbit[k]`. Entry 0 has label -1.
   */
  readonly labels: readonly number[];
}

/** Mutable only during construction. scanned records completed Schreier edges. */
interface GrowingLevel extends PermutationChainLevel {
  generators: PermutationValue[];
  generatorProofs: number[];
  orbit: number[];
  parents: number[];
  labels: number[];
  /** Map from an orbit point to its index in `orbit`. */
  indices: Map<number, number>;
  /**
   * For orbit entry k, the number of entries of `active` whose Schreier
   * generator at entry k is processed. Generators are processed in the order
   * of `active`, so these are the first `scanned[k]` entries. Entry k is done
   * when `scanned[k] === active.length`.
   */
  scanned: number[];
  /**
   * Every orbit entry before this index is done. It only moves forward,
   * except that adding an active generator resets it to 0, because that
   * makes every entry pending again.
   */
  scanPoint: number;
  /**
   * Labels (indices into `generators`) of the active generators. The orbit is
   * closed under these generators, and only their Schreier generators are
   * processed. A generator is active at level i when the sift that produced
   * it started at level i or at a smaller level index. The other generators
   * (inactive) are words in the active ones, so they do not change the orbit
   * or the group. The `extend` closure in `buildCertificate()` gives the
   * proof.
   */
  active: number[];
}
/**
 * One step of a straight-line proof. Each step produces one permutation, and
 * steps refer to earlier steps by index: `input` is input generator `index`,
 * `inverse` is the inverse of step `operand`, and `product` is step `left`
 * followed by step `right`.
 */
export type PermutationProofStep =
  | { readonly kind: 'input'; readonly index: number }
  | { readonly kind: 'inverse'; readonly operand: number }
  | { readonly kind: 'product'; readonly left: number; readonly right: number };
/**
 * A chain with proofs. Each strong generator of each level refers to the
 * proof step that produces it from the input generators. Only the
 * diagnostic verifier uses this.
 */
export interface PermutationChainCertificate {
  readonly version: 1;
  readonly proof: readonly PermutationProofStep[];
  readonly levels: readonly PermutationChainLevel[];
}

/**
 * O(orbit size) lookup construction; no explicit transversals are retained.
 * Used for a finished level. A growing level keeps its own `indices` map up
 * to date instead.
 */
function siftData(
  level: PermutationChainLevel,
  work: ChainWork
): ChainSiftData {
  const indices = new Map<number, number>();
  for (let i = 0; i < level.orbit.length; i++) {
    work.tick();
    indices.set(level.orbit[i], i);
  }
  return { indices };
}
/**
 * Cancel each base image on the right. After level i the residue fixes bases
 * 0..i. A missing orbit image identifies where the strong set must grow.
 * Cost includes reconstruction of each needed transversal.
 *
 * Sift `value` through levels `start` and below. The caller guarantees that
 * `value` fixes the base points of the levels before `start`.
 *
 * Returns:
 * - `residue`: `value * u_{k_start}^-1 * ... * u_{k_d}^-1`, one factor per
 *   level that was passed. It fixes the base points of every level before
 *   `depth`.
 * - `depth`: the level where the sift stopped. It is `levels.length` when
 *   every level was passed, or the first level whose orbit does not contain
 *   the image of its base point. If the residue becomes the identity, the
 *   sift stops early and `depth` has no meaning.
 * - `factors`: the (level, orbit index) of each cancelled transversal, except
 *   identity ones. The proof recorder uses them.
 *
 * If the residue is the identity, `value` is a product of transversal
 * elements of the levels passed, so it is in `H_start` (the group of level
 * `start`). This holds even when the chain is not complete. Otherwise the
 * residue is in the group generated by `value` and those levels, and it fixes
 * the base points of the levels before `depth`, so it can be added to the
 * generator list of every level up to `depth`.
 * At level `depth` its base image is not in the orbit, so adding it there
 * makes that orbit larger.
 *
 * Cost: one sift step per level, each with one product and at most one
 * transversal rebuild.
 */
function reduce(
  value: PermutationValue,
  levels: readonly PermutationChainLevel[],
  data: readonly ChainSiftData[],
  start: number,
  work: ChainWork
) {
  let residue = value;
  const factors: { depth: number; index: number }[] = [];
  let depth = start;
  for (; depth < levels.length && residue.supportDegree; depth++) {
    work.tick();
    const level = levels[depth];
    const index = data[depth].indices.get(
      residue.images[level.base - 1] ?? level.base
    );
    if (index === undefined) break;
    // Index 0 means the residue already fixes this base point: the factor is
    // the identity, so skip the product.
    if (index !== 0) {
      residue = work.product(residue, work.representative(level, index, true));
      factors.push({ depth, index });
    }
  }
  return { residue, depth, factors };
}
/**
 * Incremental deterministic Schreier–Sims. A nonidentity sift residue enlarges
 * the failed level and all its ancestors. Its membership follows from the input
 * word and the cancelled transversals. Schreier's lemma gives completeness when
 * every orbit edge's Schreier generator sifts to identity through the suffix.
 *
 * Parent paths survive insertions. Previously processed Schreier generators
 * remain members of the enlarged suffix, so completed edges need no rescan.
 * Each insertion increases an orbit or adds a base. Permanent storage is
 * O(total orbit points + strong generator images + generator references).
 * Provenance is recorded only for the diagnostic certificate test oracle.
 *
 * Invariants that hold between steps of the main loop:
 * - The generators of level i fix the base points of levels 0..i-1, and the
 *   generators of level i+1 are a subset of those of level i. So `H_{i+1}`
 *   is a subgroup of the stabilizer of `b_i` in `H_i`.
 * - Every strong generator is in G. An input generator is in G, and a residue
 *   is a product of elements of G.
 * - The orbit of each level is closed under its active generators, which
 *   generate the same group as all its generators. So the orbit is the full
 *   orbit of `b_i` under `H_i`.
 * - Orbit entries, parents and labels are only appended. So a transversal
 *   element never changes once its entry exists.
 *
 * Why processed edges need no rescan. When the Schreier generator of an edge
 * of level d is processed, either it sifts to the identity, so it is a
 * product of transversal elements of levels d+1 and below and is in
 * `H_{d+1}`, or its residue is added to `S_{d+1}`, which again puts the
 * Schreier generator in `H_{d+1}`. The transversal elements of the edge do
 * not change, and `H_{d+1}` only grows. So the Schreier generator stays in
 * `H_{d+1}` until the end, which is what Schreier's lemma needs.
 *
 * Termination. Each new strong generator makes the orbit of the level where
 * its sift stopped larger, or adds a level. Orbits are bounded by the degree
 * and levels by the number of points, so the number of strong generators is
 * at most the total number of orbit points. Each level has
 * |orbit| * |active generators| edges, and each edge is processed once.
 *
 * Cost. Each processed edge that is not a tree edge costs two products and a
 * sift: O(levels) products of length at most the degree, plus transversal
 * rebuilds of O(degree * path length) each when they are not cached.
 *
 * `firstBase`, when given, is the base point of level 0. The point
 * stabilizer query uses it. `recordProof` makes the result a full certificate;
 * otherwise `proof` is empty and every `generatorProofs` entry is -1.
 */
function buildCertificate(
  group: PermutationGroupValue,
  work: ChainWork,
  firstBase?: number,
  recordProof = false
): PermutationChainCertificate {
  // `data[i].indices` is the same Map object as `levels[i].indices`, so a
  // sift always sees the current orbit.
  const levels: GrowingLevel[] = [],
    data: ChainSiftData[] = [];
  // Proof recording state. It stays empty unless `recordProof` is true.
  // `proofOf` maps a strong generator object to the proof step that
  // produces it. `representativeProofs` maps (level, orbit index) to the
  // proof step that produces `u_index`.
  const proof: PermutationProofStep[] = [];
  const proofOf = new Map<PermutationValue, number>();
  const representativeProofs = new Map<
    PermutationChainLevel,
    Map<number, number>
  >();
  /** Add a proof step and return its index. Throws `permutation-chain-proof-limit`. */
  const append = (step: PermutationProofStep): number => {
    work.tick();
    if (proof.length >= work.limits.maxProofSteps)
      throw new PermutationChainLimitError('permutation-chain-proof-limit');
    proof.push(step);
    return proof.length - 1;
  };
  const productProof = (left: number, right: number) =>
    append({ kind: 'product', left, right });
  const inverseProof = (operand: number) =>
    append({ kind: 'inverse', operand });
  // Provenance follows the same stable path as a reconstructed transversal.
  // Return the proof step of `u_index` (index > 0). It uses the rule
  // `u_k = u_parent * label generator`, as `ChainWork.representative()` does.
  // Unlike that cache, this one keeps every node on the path and is not
  // bounded; it exists only in diagnostic builds.
  const representativeProof = (
    level: PermutationChainLevel,
    index: number
  ): number => {
    let cached = representativeProofs.get(level);
    if (!cached) {
      cached = new Map();
      representativeProofs.set(level, cached);
    }
    const path: number[] = [];
    let cursor = index;
    while (cursor !== 0 && !cached.has(cursor)) {
      work.tick();
      path.push(cursor);
      cursor = level.parents[cursor];
    }
    // The root has no proof step: `u_0` is the identity. The first edge
    // below the root uses the generator's proof step directly.
    let result = cursor === 0 ? undefined : cached.get(cursor);
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i],
        generator = proofOf.get(level.generators[level.labels[node]])!;
      result =
        result === undefined ? generator : productProof(result, generator);
      cached.set(node, result);
    }
    return result!;
  };
  // Orbit, parent, label, lookup and scan entries account for five slots per point.
  // Append `point` to the orbit of `level`, reached from orbit entry `parent`
  // by generator `label`. The scan entry is released when construction ends;
  // the other four slots stay charged to the chain. Throws
  // `permutation-chain-orbit-point-limit` when the total number of orbit
  // points over all levels would exceed `maxOrbitPoints`.
  const addPoint = (
    level: GrowingLevel,
    point: number,
    parent: number,
    label: number
  ) => {
    if (work.points >= work.limits.maxOrbitPoints)
      throw new PermutationChainLimitError(
        'permutation-chain-orbit-point-limit'
      );
    work.reserve(5);
    work.points++;
    level.indices.set(point, level.orbit.length);
    level.orbit.push(point);
    level.parents.push(parent);
    level.labels.push(label);
    level.scanned.push(0);
  };
  // Append a level with base point `base`, no generators and the orbit
  // `[base]`. The caller adds a generator to it at once, so no finished level
  // has an empty generator list. Throws `permutation-chain-level-limit`.
  const newLevel = (base: number) => {
    if (levels.length >= work.limits.maxLevels)
      throw new PermutationChainLimitError('permutation-chain-level-limit');
    const level: GrowingLevel = {
      base,
      generators: [],
      generatorProofs: [],
      orbit: [],
      parents: [],
      labels: [],
      indices: new Map(),
      scanned: [],
      scanPoint: 0,
      active: [],
    };
    addPoint(level, base, -1, -1);
    levels.push(level);
    data.push({ indices: level.indices });
  };
  /**
   * Old points need only the added generator; new points need all generators.
   * Every new edge is charged once. Existing parent paths are never replaced.
   *
   * Add `generator` to the generator list of `level`, with proof step `node`.
   * When `active` is true, also make it active and close the orbit under the
   * active generators again. The old orbit is already closed under the old
   * active generators, so an old point needs only the new generator. A point
   * that is added during this call needs every active generator. A new point
   * gets its parent and label here, and they never change afterwards.
   *
   * Why an inactive generator does not change the orbit. Let `A_i` be the
   * active generators and `S_i` all the generators of level i. By induction,
   * `A_i` and `S_i` generate the same group. A residue added with `active`
   * false at level i comes from an edge of a level d >= i. It is a product of
   * the Schreier generator of that edge, which is a word in `A_d`, and of
   * transversal elements of levels d+1 and below, which are words in their
   * active generators. Because d >= i and the generator lists are nested, all
   * of those generators are in `S_i`. So the residue is in the group of
   * `S_i`, which is the group of `A_i`, and the orbit is already closed
   * under it.
   *
   * Throws `permutation-chain-generator-limit` or
   * `permutation-chain-generator-image-limit` when the generator list of this
   * level would exceed the caller's `maxGenerators` or `maxGeneratorImages`,
   * and `permutation-chain-orbit-edge-limit` when the total number of
   * examined (point, generator) pairs exceeds `maxOrbitEdges`.
   *
   * Cost: one work unit per examined pair, plus the new orbit points.
   */
  const extend = (
    level: GrowingLevel,
    generator: PermutationValue,
    node: number,
    active: boolean
  ) => {
    const oldSize = level.orbit.length,
      label = level.generators.length;
    const caps = permutationGroupLimits(work.values);
    if (label >= caps.maxGenerators)
      throw new PermutationChainLimitError('permutation-chain-generator-limit');
    if (
      level.generators.reduce(
        (sum, value) => sum + value.supportDegree,
        generator.supportDegree
      ) > caps.maxGeneratorImages
    )
      throw new PermutationChainLimitError(
        'permutation-chain-generator-image-limit'
      );
    // Two slots: the generator reference and its proof entry. The images of
    // the generator are charged once, by `retain()` in `add`.
    work.reserve(2);
    level.generators.push(generator);
    level.generatorProofs.push(node);
    // At ancestors above the generating Schreier edge, this residue is already
    // a word in their generators. Retain the strong-set reference but do not
    // reprocess an orbit that is already closed under that word.
    if (!active) return;
    work.reserve(1);
    level.active.push(label);
    // Every entry now has an unprocessed Schreier edge for the new generator.
    level.scanPoint = 0;
    // `level.orbit.length` is read on each pass, so points appended inside
    // the loop are also visited. This is a breadth-first closure.
    for (let i = 0; i < level.orbit.length; i++)
      for (
        let k = i < oldSize ? level.active.length - 1 : 0;
        k < level.active.length;
        k++
      ) {
        const j = level.active[k];
        work.tick();
        if (++work.edges > work.limits.maxOrbitEdges)
          throw new PermutationChainLimitError(
            'permutation-chain-orbit-edge-limit'
          );
        const point = level.orbit[i],
          target = level.generators[j].images[point - 1] ?? point;
        if (!level.indices.has(target)) addPoint(level, target, i, j);
      }
  };
  // A sift either proves membership or yields one strong generator.
  // Sift `value` from level `start`; `value` must fix the base points of
  // the levels before `start`. Return false if the residue is the identity.
  // Otherwise add the residue as a strong generator to levels 0..depth (the
  // level where the sift stopped), adding a new level first when the sift
  // passed every level, and return true. `provenance` returns the proof step
  // of `value`; it is called only when proofs are recorded.
  //
  // Why the residue is a valid new strong generator. It is a product of
  // `value` and transversal elements, all in G, so it is in G. It fixes the
  // base points of levels 0..depth-1, so it may join the generator lists of
  // levels 0..depth without breaking the "fixes earlier base points" rule.
  // At level `depth` it maps the base point outside the current orbit, so
  // that orbit grows. When no level was left, it moves some point, so a new
  // level with a moved base point records it.
  const add = (
    value: PermutationValue,
    provenance: () => number,
    start: number
  ): boolean => {
    const result = reduce(value, levels, data, start, work);
    if (!result.residue.supportDegree) return false;
    let node = -1;
    if (recordProof) {
      // Mirror `reduce`: multiply by the inverse of each cancelled
      // transversal element, in the same order.
      node = provenance();
      for (const factor of result.factors)
        node = productProof(
          node,
          inverseProof(representativeProof(levels[factor.depth], factor.index))
        );
      proofOf.set(result.residue, node);
    }
    work.retain(result.residue); // Ancestor levels share these images.
    if (result.depth === levels.length) {
      // Normalized support ends at a moved point. Choosing it avoids a scan
      // through a potentially long fixed prefix and keeps bases deterministic.
      newLevel(result.residue.supportDegree);
    }
    // At levels `start`..depth the generator is active. At levels before
    // `start` it is already a word in their active generators (see `extend`).
    for (let i = 0; i <= result.depth; i++)
      extend(levels[i], result.residue, node, i >= start);
    return true;
  };
  // A trivial group gets no levels, even with `firstBase`. Otherwise the
  // first input generator that is not the identity adds a generator to this
  // level, because every sift of an input generator starts at level 0.
  if (firstBase !== undefined && group.generators.some((g) => g.supportDegree))
    newLevel(firstBase);
  // Step 1: sift the input generators. Each one is active at every level it
  // reaches, because its sift starts at level 0.
  for (let i = 0; i < group.generators.length; i++)
    add(group.generators[i], () => append({ kind: 'input', index: i }), 0);
  // A faithful action on n points has order at most n!. Each nested orbit
  // contributes a factor to a proven lower bound, even before completion.
  // Equality proves that every stabilizer is complete, without more sifts.
  //
  // The lower bound: `H_{i+1}` is a subgroup of the stabilizer of `b_i` in
  // `H_i`, and the orbit of `b_i` is the full `H_i`-orbit, so
  // |H_i| = |orbit_i| * |stabilizer| >= |orbit_i| * |H_{i+1}|. With the last
  // group trivial, |H_0| >= the product of the orbit sizes. Also `H_0` is a
  // subgroup of G, and |G| <= n!. If the product equals n!, every inequality
  // is an equality, so `H_{i+1}` is the full stabilizer at every level and
  // the chain is complete. This case is the full symmetric group, for which
  // processing every Schreier edge would cost the most. The factorial is
  // computed only for n <= 256, so its size stays bounded.
  let upperBound: bigint | undefined;
  if (group.action.degree <= 256) {
    upperBound = 1n;
    for (let i = 2; i <= group.action.degree; i++) {
      work.tick();
      upperBound *= BigInt(i);
    }
  }
  const complete = () =>
    upperBound !== undefined &&
    levels.reduce((order, level) => order * BigInt(level.orbit.length), 1n) ===
      upperBound;
  // The level where the search for the next pending edge starts.
  let nextDepth = 0;
  // Resume pending edges fairly across levels. Finishing a deep suffix before
  // processing higher levels can waste sifts against an incomplete strong set. Tree edges give the
  // identity Schreier generator directly and do not require a permutation product.
  //
  // Step 2: each pass of the outer loop processes at most one Schreier edge.
  // It searches the levels in round-robin order from `nextDepth`, takes the
  // first pending edge, and sets `nextDepth` to the level after it. The loop
  // ends when no level has a pending edge, or when the order bound proves the
  // chain complete.
  for (;;) {
    if (complete()) break;
    let pending = false;
    for (let offset = 0; offset < levels.length; offset++) {
      const depth = (nextDepth + offset) % levels.length;
      const level = levels[depth];
      // Skip the entries whose edges are all processed.
      while (
        level.scanPoint < level.orbit.length &&
        level.scanned[level.scanPoint] === level.active.length
      )
        level.scanPoint++;
      if (level.scanPoint === level.orbit.length) continue;
      pending = true;
      nextDepth = (depth + 1) % levels.length;
      // The edge is (entry i, next unprocessed active generator). It is
      // marked processed now: whatever the sift finds, the Schreier
      // generator will be in `H_{depth+1}` afterwards.
      const i = level.scanPoint,
        label = level.active[level.scanned[i]++],
        generator = level.generators[label];
      // The orbit is closed under active generators, so the image is present.
      const point = level.orbit[i],
        j = level.indices.get(generator.images[point - 1] ?? point)!;
      work.tick();
      // A tree edge: entry j was reached from entry i by this generator, so
      // `u_j = u_i * generator` and the Schreier generator is the identity.
      if (level.parents[j] === i && level.labels[j] === label) break;
      // The Schreier generator `u_i * generator * u_j^-1` maps `b_depth` to
      // itself and fixes the earlier base points, so its sift starts at the
      // next level.
      const candidate = work.product(
        work.product(work.representative(level, i), generator),
        work.representative(level, j, true)
      );
      add(
        candidate,
        () => {
          let node = proofOf.get(generator)!;
          if (i !== 0) node = productProof(representativeProof(level, i), node);
          if (j !== 0)
            node = productProof(
              node,
              inverseProof(representativeProof(level, j))
            );
          return node;
        },
        depth + 1
      );
      break;
    }
    if (!pending) break;
  }
  work.clearTransversals();
  // Construction-only scan cursors and active-generator lists are released.
  // This subtracts one slot per orbit point (its `scanned` entry, reserved
  // by `addPoint`) and one slot per active label (reserved by `extend`).
  // After this, `stored` is the permanent storage of the chain: retained
  // generator images, four slots per orbit point and two per generator
  // reference.
  work.stored -= levels.reduce(
    (sum, level) => sum + level.orbit.length + level.active.length,
    0
  );
  // Copy out the public fields only. The arrays are shared, not copied, and
  // no code changes them after this point.
  return {
    version: 1,
    proof,
    levels: levels.map(
      ({ base, generators, generatorProofs, orbit, parents, labels }) => ({
        base,
        generators,
        generatorProofs,
        orbit,
        parents,
        labels,
      })
    ),
  };
}

/**
 * Independent verification: provenance proves every strong generator lies in G;
 * tree edges prove representative membership; orbit closure and Schreier sifting
 * prove each next subgroup is the complete stabilizer. Input-generator sifting
 * proves the reverse inclusion. No equality with an unreduced Schreier set is used.
 *
 * The checks, in order:
 * 1. Replay the proof. Each step must refer only to earlier steps or to an
 *    input generator, so every proven value is in G.
 * 2. Check the shape of each level: distinct base points in 1..n; the orbit
 *    starts at the base and has no repeated point; each tree edge (parent,
 *    label) really maps the parent point to the entry; each generator is
 *    not the identity, equals the value of its proof step, fixes the earlier
 *    base points, and also appears in the previous level's list.
 * 3. For each level, from the last to the first, check that the orbit is
 *    closed under all the generators of the level, and that every Schreier
 *    generator sifts to the identity through the levels after it. By
 *    Schreier's lemma, each level's group is then the full stabilizer.
 * 4. Sift each input generator from level 0, so G is a subgroup of `H_0`.
 *
 * Returns false for a certificate that fails a check, and throws a
 * `PermutationChainLimitError` when a limit is reached. Malformed input is
 * checked field by field, because a certificate can come from outside.
 */
function verify(
  group: PermutationGroupValue,
  certificate: PermutationChainCertificate,
  work: ChainWork
): boolean {
  if (
    !certificate ||
    certificate.version !== 1 ||
    !Array.isArray(certificate.proof) ||
    !Array.isArray(certificate.levels)
  )
    return false;
  const { proof, levels } = certificate;
  if (levels.length > work.limits.maxLevels)
    throw new PermutationChainLimitError('permutation-chain-level-limit');
  if (proof.length > work.limits.maxProofSteps)
    throw new PermutationChainLimitError('permutation-chain-proof-limit');
  // `proven[k]` is the value of proof step k. `reference(i)` is true when i
  // is the index of an earlier step.
  const proven: PermutationValue[] = [];
  const reference = (i: number) =>
    Number.isSafeInteger(i) && i >= 0 && i < proven.length;
  for (const step of proof) {
    work.values.check?.();
    if (!step) return false;
    let value: PermutationValue;
    if (step.kind === 'input') {
      if (
        !Number.isSafeInteger(step.index) ||
        step.index < 0 ||
        step.index >= group.generators.length
      )
        return false;
      value = group.generators[step.index];
    } else if (step.kind === 'inverse') {
      if (!reference(step.operand)) return false;
      value = work.inverse(proven[step.operand]);
    } else if (step.kind === 'product') {
      if (!reference(step.left) || !reference(step.right)) return false;
      value = work.product(proven[step.left], proven[step.right]);
    } else return false;
    work.retain(value);
    proven.push(value);
  }
  // `previous` holds the base points of the levels already checked.
  // `parentGenerators` holds the keys of the previous level's generators,
  // and is undefined for level 0.
  const previous: number[] = [];
  const data: ChainSiftData[] = [];
  let parentGenerators: Set<string> | undefined;
  let points = 0;
  for (const level of levels) {
    work.values.check?.();
    if (
      !level ||
      !Array.isArray(level.generators) ||
      !Array.isArray(level.generatorProofs) ||
      !Array.isArray(level.orbit) ||
      !Array.isArray(level.parents) ||
      !Array.isArray(level.labels)
    )
      return false;
    if (
      !Number.isSafeInteger(level.base) ||
      level.base < 1 ||
      level.base > group.action.degree ||
      previous.includes(level.base)
    )
      return false;
    const n = level.orbit.length;
    points += n;
    if (points > work.limits.maxOrbitPoints)
      throw new PermutationChainLimitError(
        'permutation-chain-orbit-point-limit'
      );
    if (
      !n ||
      level.orbit[0] !== level.base ||
      level.parents.length !== n ||
      level.labels.length !== n ||
      level.generatorProofs.length !== level.generators.length ||
      !level.generators.length
    )
      return false;
    const cap = permutationGroupLimits(work.values);
    if (level.generators.length > cap.maxGenerators)
      throw new PermutationChainLimitError('permutation-chain-generator-limit');
    let images = 0;
    const actual = new Set<string>();
    for (let i = 0; i < level.generators.length; i++) {
      const g = level.generators[i],
        node = level.generatorProofs[i];
      if (!g || !Array.isArray(g.images)) return false;
      assertPermutationFits(g, group.action, work.values);
      images += g.supportDegree;
      if (images > cap.maxGeneratorImages)
        throw new PermutationChainLimitError(
          'permutation-chain-generator-image-limit'
        );
      if (
        !g.supportDegree ||
        !reference(node) ||
        work.key(proven[node]) !== work.key(g)
      )
        return false;
      // No repeated generator in a level, and the lists are nested, so
      // `H_{i+1}` is a subgroup of `H_i`.
      const key = work.key(g);
      if (actual.has(key) || (parentGenerators && !parentGenerators.has(key)))
        return false;
      actual.add(key);
      // The generator must fix every earlier base point.
      for (const point of previous) {
        work.values.check?.();
        if ((g.images[point - 1] ?? point) !== point) return false;
      }
    }
    const seen = new Set<number>();
    for (let i = 0; i < n; i++) {
      work.values.check?.();
      const point = level.orbit[i];
      if (
        !Number.isSafeInteger(point) ||
        point < 1 ||
        point > group.action.degree ||
        seen.has(point)
      )
        return false;
      if (i === 0) {
        if (level.parents[i] !== -1 || level.labels[i] !== -1) return false;
      } else {
        // A parent before the entry makes every tree path finite, and the
        // edge check makes each rebuilt `u_i` map the base point to entry i.
        const parent = level.parents[i],
          label = level.labels[i];
        if (
          !Number.isSafeInteger(parent) ||
          parent < 0 ||
          parent >= i ||
          !Number.isSafeInteger(label) ||
          label < 0 ||
          label >= level.generators.length
        )
          return false;
        if (
          (level.generators[label].images[level.orbit[parent] - 1] ??
            level.orbit[parent]) !== point
        )
          return false;
      }
      seen.add(point);
    }
    data.push(siftData(level, work));
    parentGenerators = actual;
    previous.push(level.base);
  }
  // Work from the trivial tail upwards; no unverified suffix proves membership.
  // Every check must pass, so the order does not change the result. It
  // matches the induction: when level `depth` is checked, the levels after
  // it already describe their groups correctly.
  for (let depth = levels.length - 1; depth >= 0; depth--) {
    const level = levels[depth];
    for (let i = 0; i < level.orbit.length; i++) {
      for (const generator of level.generators) {
        work.values.check?.();
        const point = level.orbit[i];
        const target = generator.images[point - 1] ?? point;
        const j = data[depth].indices.get(target);
        // The orbit is not closed under this generator.
        if (j === undefined) return false;
        const schreier = work.product(
          work.product(work.representative(level, i), generator),
          work.representative(level, j, true)
        );
        if (
          reduce(schreier, levels, data, depth + 1, work).residue.supportDegree
        )
          return false;
      }
    }
  }
  return group.generators.every(
    (g) => !reduce(g, levels, data, 0, work).residue.supportDegree
  );
}

/**
 * Diagnostic test oracle: validate provenance and Schreier closure independently of the builder.
 * Returns true when `certificate` is a complete stabilizer chain of `group`.
 * Every Schreier generator of every level is sifted, so the cost is higher
 * than a construction that stops early.
 */
export function verifyPermutationChain(
  group: PermutationGroupValue,
  certificate: PermutationChainCertificate,
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {}
): boolean {
  const ledger = new ChainWork(requested, work);
  return verify(ledger.receive(group), certificate, ledger);
}

/** The result of `PermutationStabilizerChain.sift()`. */
export interface PermutationSiftResult {
  /** True when the residue is the identity, that is, g is in the group. */
  readonly member: boolean;
  /**
   * What is left of g after the sift. It fixes the base points of every
   * level that the sift passed.
   */
  readonly residue: PermutationValue;
  /** g = residue * factors[0] * ... * factors[last], in multiplication order. */
  readonly factors: readonly PermutationValue[];
  /** Work units charged by this sift. */
  readonly workUsed: number;
  /** Image slots of the residue and factors, charged by this sift. */
  readonly storedImagesCharged: number;
}

/**
 * Completed strong generating set built by incremental Schreier–Sims.
 *
 * The chain is built once, in the constructor, and does not change. Its
 * totals (`workUsed`, `storedImagesCharged`, `orbitPoints`, `orbitEdges`)
 * record what construction cost, so that a caller who reuses a cached chain
 * can charge the same cost again (see `chainInSession()`). The input
 * generators are charged as stored images too, because the chain keeps them.
 */
export class PermutationStabilizerChain {
  readonly #group: PermutationGroupValue;
  readonly #requested: PermutationChainLimits;
  readonly #work: PermutationGroupWork;
  readonly #firstBase: number | undefined;
  readonly #levels: readonly PermutationChainLevel[];
  readonly #order: bigint;
  readonly #siftData: readonly ChainSiftData[];
  readonly #workUsed: number;
  readonly #storedImagesCharged: number;
  readonly #orbitPoints: number;
  readonly #orbitEdges: number;
  /** `ChainWork.demand` at the end of construction. */
  readonly #storageDemand: number;
  /**
   * True when the storage limit changed a step of construction (an
   * eviction or a cache entry that was not stored): `#storageDemand` was
   * above `maxStoredImages`. Such a chain can cost a different amount of
   * work under another storage limit.
   */
  readonly #storageLimited: boolean;
  /** The normalized limits of construction, as JSON, for an exact match. */
  readonly #limitsKey: string;
  private constructor(
    group: PermutationGroupValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork,
    firstBase?: number
  ) {
    const ledger = new ChainWork(requested, work);
    this.#group = ledger.receive(group);
    for (const generator of group.generators) ledger.retain(generator);
    this.#requested = requested;
    this.#work = work;
    this.#firstBase = firstBase;
    // No proof is recorded here. The `certificate` getter builds again with
    // proofs when a test asks for one.
    this.#levels = buildCertificate(this.#group, ledger, firstBase).levels;
    // The lookup maps replace the `indices` maps of the growing levels, whose
    // slots `addPoint` already charged, so they are not charged again.
    this.#siftData = this.#levels.map((level) => siftData(level, ledger));
    // The chain is complete, so the group order is the product of the orbit
    // sizes.
    let order = 1n;
    for (const level of this.#levels) {
      ledger.values.check?.();
      order *= BigInt(level.orbit.length);
    }
    this.#order = order;
    this.#workUsed = ledger.used;
    this.#storedImagesCharged = ledger.stored;
    this.#orbitPoints = ledger.points;
    this.#orbitEdges = ledger.edges;
    this.#storageDemand = ledger.demand;
    this.#storageLimited = ledger.demand > ledger.limits.maxStoredImages;
    this.#limitsKey = JSON.stringify(ledger.limits);
  }
  /**
   * Whether a construction of the same group, with the same first base and
   * the same receiving policy, under `requested` would succeed and give this
   * chain with the same costs. A cache can then return this chain for
   * `requested`: the answer, and the costs that the caller charges, are the
   * ones of a construction without the cache.
   *
   * Construction is deterministic. A limit other than `maxStoredImages`
   * only decides whether construction stops with a limit error, and each
   * check stops it when a total goes above its limit. So construction under
   * `requested` reaches the same end when each recorded total is at most its
   * limit: work, orbit points, orbit edges and levels.
   *
   * `maxStoredImages` can also change the steps: a smaller limit evicts more
   * transversal elements, which costs more work to build again. The steps
   * are the same when no storage check was decided by the limit, that is
   * when the storage demand of construction is at most both the original
   * limit and `requested`. When the original limit did decide a check, only
   * the same limits give the same steps.
   */
  fits(requested: PermutationChainLimits): boolean {
    const limits = permutationChainLimits(requested);
    if (JSON.stringify(limits) === this.#limitsKey) return true;
    return (
      !this.#storageLimited &&
      this.#storageDemand <= limits.maxStoredImages &&
      this.#workUsed <= limits.maxWork &&
      this.#orbitPoints <= limits.maxOrbitPoints &&
      this.#orbitEdges <= limits.maxOrbitEdges &&
      this.#levels.length <= limits.maxLevels
    );
  }
  /**
   * Build the chain of `group` within the `requested` limits. When
   * `firstBase` is given, it is the base point of level 0 (if the group is
   * not trivial), so that level 1 generates the stabilizer of that point.
   * Throws a `PermutationInputError` for a `firstBase` outside the action,
   * and a `PermutationChainLimitError` when a limit is reached.
   */
  static compute(
    group: PermutationGroupValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork = {},
    firstBase?: number
  ) {
    if (
      firstBase !== undefined &&
      (!Number.isSafeInteger(firstBase) ||
        firstBase < 1 ||
        firstBase > group.action.degree)
    )
      throw new PermutationInputError('point-outside-permutation-action');
    return new PermutationStabilizerChain(group, requested, work, firstBase);
  }
  get group() {
    return this.#group;
  }
  /**
   * Diagnostic only: reconstruct provenance for the independent test oracle.
   * Each read builds the chain again, with a new ledger and the original
   * limits, and records the proof. The levels have the same bases, orbits
   * and generators as `levels`, because construction is deterministic.
   * Proof steps cost work, so this build can reach a limit that the first
   * build did not reach.
   *
   * The original limits are the ones of the first construction. A chain
   * from `PermutationQuerySession` can be shared by queries with other
   * limits, so for such a chain they can be the limits of an earlier query.
   */
  get certificate() {
    return buildCertificate(
      this.#group,
      new ChainWork(this.#requested, this.#work),
      this.#firstBase,
      true
    );
  }
  get levels() {
    return this.#levels;
  }
  /** The order of the group: the product of the orbit sizes. */
  get order() {
    return this.#order;
  }
  /** Work units charged by construction. */
  get workUsed() {
    return this.#workUsed;
  }
  /** Permanent image slots that the chain keeps (scratch storage excluded). */
  get storedImagesCharged() {
    return this.#storedImagesCharged;
  }
  get orbitEdges() {
    return this.#orbitEdges;
  }
  get orbitPoints() {
    return this.#orbitPoints;
  }
  /**
   * True when the storage limit changed a step of construction. Such a
   * chain `fits()` only its own limits.
   */
  get storageLimited() {
    return this.#storageLimited;
  }
  /**
   * Sift `value` through every level, with a new ledger for the `requested`
   * limits. Unlike the internal `reduce`, this keeps every factor (including
   * identity factors at levels where the residue already fixes the base) so
   * that `value` can be written back as `residue * factors`. It also does
   * not stop when the residue becomes the identity; the later factors are
   * then the identity.
   *
   * Storage: each factor and the residue are charged with `retain()`, and
   * the transversal cache is released before the residue is charged, so
   * `storedImagesCharged` counts only the returned values.
   *
   * Cost: per level, one transversal element and its inverse (each rebuilt
   * in O(degree * path length) when not cached) and one product.
   */
  sift(
    value: PermutationValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ): PermutationSiftResult {
    const ledger = new ChainWork(requested, work);
    ledger.receive(this.#group);
    assertPermutationFits(value, this.#group.action, ledger.values);
    let residue = value;
    const factors: PermutationValue[] = [];
    for (let depth = 0; depth < this.#levels.length; depth++) {
      const level = this.#levels[depth],
        data = this.#siftData[depth];
      ledger.values.check?.();
      const point = residue.images[level.base - 1] ?? level.base;
      const index = data.indices.get(point);
      // The image is outside the orbit: `value` is not in the group.
      if (index === undefined) break;
      const t = ledger.representative(level, index);
      residue = ledger.product(
        residue,
        ledger.representative(level, index, true)
      );
      // `retain()` moves `t` out of the cache, so `clearTransversals()`
      // below does not release its charge.
      ledger.retain(t);
      factors.push(t);
    }
    ledger.clearTransversals();
    ledger.retain(residue);
    // The residue is `value * t_0^-1 * t_1^-1 * ...`, so
    // `value = residue * ... * t_1 * t_0`: reverse the list to get that order.
    return {
      member: residue.supportDegree === 0,
      residue,
      factors: factors.reverse(),
      workUsed: ledger.used,
      storedImagesCharged: ledger.stored,
    };
  }
}

/**
 * Optional owner-provided cache; the pure kernel has no engine or session import.
 * A provider returns a complete chain of `group`, built within `limits`, or
 * a cached chain of the same group and first base for which
 * `chain.fits(limits)` is true. The default provider is
 * `PermutationStabilizerChain.compute`.
 */
export type PermutationChainProvider = (
  group: PermutationGroupValue,
  limits: PermutationChainLimits,
  work: PermutationGroupWork,
  firstBase?: number
) => PermutationStabilizerChain;

/**
 * Get a chain inside an outer query and charge its cost to the outer
 * ledger, once. The chain is built (or looked up) with the outer ledger's
 * remaining limits, so the charges below cannot exceed the outer limits.
 * The full construction cost is charged even when the provider returns a
 * cached chain, so whether a query succeeds within its limits does not
 * depend on the state of a cache. The chain's storage stays charged until
 * the outer query ends, because the query keeps using the chain.
 */
function chainInSession(
  group: PermutationGroupValue,
  ledger: ChainWork,
  provider: PermutationChainProvider = PermutationStabilizerChain.compute,
  firstBase?: number
) {
  const chain = provider(group, ledger.remaining(), ledger.caller, firstBase);
  ledger.tick(chain.workUsed);
  ledger.reserve(chain.storedImagesCharged);
  ledger.points += chain.orbitPoints;
  ledger.edges += chain.orbitEdges;
  return chain;
}
/**
 * Charge nested work once; release temporary sift output between membership tests.
 * The sift runs with the outer remaining limits, so its own storage check
 * includes the outer storage. Only its work is added to the outer ledger.
 */
function containsInSession(
  chain: PermutationStabilizerChain,
  value: PermutationValue,
  ledger: ChainWork
) {
  const result = chain.sift(value, ledger.remaining(), ledger.caller);
  ledger.tick(result.workUsed);
  // Sift residues and factors are temporary; they are released before the next query.
  return result.member;
}
/**
 * Membership is equivalent to an identity residue in a completed stabilizer chain.
 * Builds the chain of `group` and sifts `value`. All costs are charged to
 * one ledger for the `requested` limits.
 */
export function permutationGroupContains(
  group: PermutationGroupValue,
  value: PermutationValue,
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {}
): boolean {
  const ledger = new ChainWork(requested, work);
  const received = ledger.receive(group);
  assertPermutationFits(value, received.action, ledger.values);
  return containsInSession(chainInSession(received, ledger), value, ledger);
}

/**
 * Explicitly compare subgroups in the same finite action, not abstract isomorphism.
 *
 * - `subgroup`: H is a subgroup of G exactly when every generator of H is
 *   in G.
 * - `index`: |G| / |H|. Throws `not-a-permutation-subgroup` when H is not a
 *   subgroup of G.
 * - `equal`: H is a subgroup of G and |H| = |G|.
 * - `normal`: H is a subgroup of G and `g^-1 * h * g` is in H for every
 *   generator g of G and h of H. This is enough: it gives
 *   `g^-1 H g ⊆ H`, and both sides have the same finite size, so
 *   `g^-1 H g = H`. Then `g H g^-1 = H` too, and every word in the
 *   generators of G maps H to itself.
 *
 * The chain of G is built first. The chain of H is built only for the
 * queries that need it.
 */
export function permutationGroupRelation(
  parent: PermutationGroupValue,
  candidate: PermutationGroupValue,
  query: 'subgroup' | 'index' | 'equal' | 'normal',
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {},
  provider?: PermutationChainProvider
): boolean | bigint {
  const ledger = new ChainWork(requested, work);
  const G = ledger.receive(parent),
    H = ledger.receive(candidate);
  if (G.action.degree !== H.action.degree)
    throw new PermutationInputError('incompatible-permutation-actions');
  const gChain = chainInSession(G, ledger, provider);
  for (const h of H.generators) {
    ledger.values.check?.();
    if (!containsInSession(gChain, h, ledger)) {
      if (query === 'index')
        throw new PermutationInputError('not-a-permutation-subgroup');
      return false;
    }
  }
  if (query === 'subgroup') return true;
  const hChain = chainInSession(H, ledger, provider);
  if (query === 'index') return gChain.order / hChain.order;
  if (query === 'equal') return gChain.order === hChain.order;
  // Right action: the product `inverse, h, g` is `g^-1 * h * g`.
  for (const g of G.generators) {
    const inverse = ledger.inverse(g);
    for (const h of H.generators) {
      ledger.values.check?.();
      const conjugate = ledger.product(ledger.product(inverse, h), g);
      if (!containsInSession(hChain, conjugate, ledger)) return false;
    }
  }
  return true;
}

/**
 * Pairwise generator commutation implies commutation of all their words; O(k² n) image work.
 * No stabilizer chain is needed. Here k is the number of generators and n
 * the degree.
 */
export function permutationGroupIsAbelian(
  group: PermutationGroupValue,
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {}
): boolean {
  const ledger = new ChainWork(requested, work);
  const G = ledger.receive(group);
  for (let i = 0; i < G.generators.length; i++) {
    for (let j = i + 1; j < G.generators.length; j++) {
      ledger.values.check?.();
      if (
        ledger.key(ledger.product(G.generators[i], G.generators[j])) !==
        ledger.key(ledger.product(G.generators[j], G.generators[i]))
      )
        return false;
    }
  }
  return true;
}

/**
 * Put the requested point first in the base; the next level generates its full stabilizer.
 * In a complete chain, `H_1` is the stabilizer of `b_0` in G. When the chain
 * has fewer than two levels, that stabilizer is trivial and the result has
 * no generators. The result generators are the strong generators of level
 * 1, not a minimal generating set.
 */
export function permutationPointStabilizer(
  group: PermutationGroupValue,
  point: number,
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {},
  provider?: PermutationChainProvider
): PermutationGroupValue {
  const ledger = new ChainWork(requested, work);
  const received = ledger.receive(group);
  const chain = chainInSession(received, ledger, provider, point);
  return new PermutationGroupValue(
    chain.levels[1]?.generators ?? [],
    received.action,
    ledger.values
  );
}
