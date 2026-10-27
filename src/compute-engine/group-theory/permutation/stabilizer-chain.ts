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

export interface PermutationChainLimits {
  readonly maxWork: number;
  readonly maxLevels?: number;
  /** Diagnostic verifier only; production queries record no proofs. */
  readonly maxProofSteps?: number;
  readonly maxOrbitEdges?: number;
  readonly maxOrbitPoints?: number;
  /** Live generator images, orbit-tree slots and cached transversal images. */
  readonly maxStoredImages?: number;
}
export class PermutationChainLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationChainLimitError';
  }
}
export class PermutationChainInvariantError extends Error {}

function bound(value: number, cap: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > cap)
    throw new PermutationInputError(`invalid-permutation-chain-${name}-limit`);
  return value;
}
/** Normalize resource policy before allocating trees or starting group work. */
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
 */
class ChainWork {
  used = 0;
  stored = 0;
  points = 0;
  edges = 0;
  readonly limits: ReturnType<typeof permutationChainLimits>;
  readonly values: PermutationGroupWork;
  readonly caller: PermutationGroupWork;
  private readonly retained = new Set<PermutationValue>();
  private readonly transversals = new Map<
    PermutationChainLevel,
    Map<number, PermutationValue>
  >();
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
  remaining(): PermutationChainLimits {
    return {
      ...this.limits,
      maxWork: this.limits.maxWork - this.used,
      maxStoredImages: this.limits.maxStoredImages - this.stored,
      maxOrbitPoints: this.limits.maxOrbitPoints - this.points,
      maxOrbitEdges: this.limits.maxOrbitEdges - this.edges,
    };
  }
  tick(count = 1) {
    this.caller.check?.();
    if (this.used + count > this.limits.maxWork)
      throw new PermutationChainLimitError('permutation-chain-work-limit');
    this.used += count;
  }
  /** Reserve permanent entries, evicting scratch products first. */
  reserve(count: number) {
    while (
      this.cacheOrder.length &&
      this.stored + count > this.limits.maxStoredImages
    )
      this.evict();
    if (this.stored + count > this.limits.maxStoredImages)
      throw new PermutationChainLimitError('permutation-chain-storage-limit');
    this.stored += count;
  }
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
  private evict() {
    const entry = this.cacheOrder.shift()!;
    this.transversals.get(entry.level)!.delete(entry.key);
    this.stored -= entry.value.supportDegree;
  }
  clearTransversals() {
    while (this.cacheOrder.length) this.evict();
  }
  key(value: PermutationValue) {
    this.tick(1 + value.supportDegree);
    return value.images.join(',');
  }
  product(left: PermutationValue, right: PermutationValue) {
    this.tick(1 + Math.max(left.supportDegree, right.supportDegree));
    return composePermutations(left, right, this.values);
  }
  inverse(value: PermutationValue) {
    this.tick(1 + value.supportDegree);
    return inversePermutation(value, this.values);
  }
  /** Check receiving resource policy without revalidating mathematical values. */
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
interface ChainSiftData {
  indices: ReadonlyMap<number, number>;
}

/** Level i generators fix bases 0..i-1. Parent indices always decrease. */
export interface PermutationChainLevel {
  readonly base: number;
  readonly generators: readonly PermutationValue[];
  readonly generatorProofs: readonly number[];
  readonly orbit: readonly number[];
  readonly parents: readonly number[];
  readonly labels: readonly number[];
}

/** Mutable only during construction. scanned records completed Schreier edges. */
interface GrowingLevel extends PermutationChainLevel {
  generators: PermutationValue[];
  generatorProofs: number[];
  orbit: number[];
  parents: number[];
  labels: number[];
  indices: Map<number, number>;
  scanned: number[];
  scanPoint: number;
  active: number[];
}
export type PermutationProofStep =
  | { readonly kind: 'input'; readonly index: number }
  | { readonly kind: 'inverse'; readonly operand: number }
  | { readonly kind: 'product'; readonly left: number; readonly right: number };
export interface PermutationChainCertificate {
  readonly version: 1;
  readonly proof: readonly PermutationProofStep[];
  readonly levels: readonly PermutationChainLevel[];
}

/** O(orbit size) lookup construction; no explicit transversals are retained. */
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
 */
function buildCertificate(
  group: PermutationGroupValue,
  work: ChainWork,
  firstBase?: number,
  recordProof = false
): PermutationChainCertificate {
  const levels: GrowingLevel[] = [],
    data: ChainSiftData[] = [];
  const proof: PermutationProofStep[] = [];
  const proofOf = new Map<PermutationValue, number>();
  const representativeProofs = new Map<
    PermutationChainLevel,
    Map<number, number>
  >();
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
    work.reserve(2);
    level.generators.push(generator);
    level.generatorProofs.push(node);
    // At ancestors above the generating Schreier edge, this residue is already
    // a word in their generators. Retain the strong-set reference but do not
    // reprocess an orbit that is already closed under that word.
    if (!active) return;
    work.reserve(1);
    level.active.push(label);
    level.scanPoint = 0;
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
  const add = (
    value: PermutationValue,
    provenance: () => number,
    start: number
  ): boolean => {
    const result = reduce(value, levels, data, start, work);
    if (!result.residue.supportDegree) return false;
    let node = -1;
    if (recordProof) {
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
    for (let i = 0; i <= result.depth; i++)
      extend(levels[i], result.residue, node, i >= start);
    return true;
  };
  if (firstBase !== undefined && group.generators.some((g) => g.supportDegree))
    newLevel(firstBase);
  for (let i = 0; i < group.generators.length; i++)
    add(group.generators[i], () => append({ kind: 'input', index: i }), 0);
  // A faithful action on n points has order at most n!. Each nested orbit
  // contributes a factor to a proven lower bound, even before completion.
  // Equality proves that every stabilizer is complete, without more sifts.
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
  let nextDepth = 0;
  // Resume pending edges fairly across levels. Finishing a deep suffix before
  // processing higher levels can waste sifts against an incomplete strong set. Tree edges give the
  // identity Schreier generator directly and do not require a permutation product.
  for (;;) {
    if (complete()) break;
    let pending = false;
    for (let offset = 0; offset < levels.length; offset++) {
      const depth = (nextDepth + offset) % levels.length;
      const level = levels[depth];
      while (
        level.scanPoint < level.orbit.length &&
        level.scanned[level.scanPoint] === level.active.length
      )
        level.scanPoint++;
      if (level.scanPoint === level.orbit.length) continue;
      pending = true;
      nextDepth = (depth + 1) % levels.length;
      const i = level.scanPoint,
        label = level.active[level.scanned[i]++],
        generator = level.generators[label];
      const point = level.orbit[i],
        j = level.indices.get(generator.images[point - 1] ?? point)!;
      work.tick();
      if (level.parents[j] === i && level.labels[j] === label) break;
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
  work.stored -= levels.reduce(
    (sum, level) => sum + level.orbit.length + level.active.length,
    0
  );
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
      const key = work.key(g);
      if (actual.has(key) || (parentGenerators && !parentGenerators.has(key)))
        return false;
      actual.add(key);
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
  for (let depth = levels.length - 1; depth >= 0; depth--) {
    const level = levels[depth];
    for (let i = 0; i < level.orbit.length; i++) {
      for (const generator of level.generators) {
        work.values.check?.();
        const point = level.orbit[i];
        const target = generator.images[point - 1] ?? point;
        const j = data[depth].indices.get(target);
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

/** Diagnostic test oracle: validate provenance and Schreier closure independently of the builder. */
export function verifyPermutationChain(
  group: PermutationGroupValue,
  certificate: PermutationChainCertificate,
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {}
): boolean {
  const ledger = new ChainWork(requested, work);
  return verify(ledger.receive(group), certificate, ledger);
}

export interface PermutationSiftResult {
  readonly member: boolean;
  readonly residue: PermutationValue;
  /** g = residue * factors[0] * ... * factors[last], in multiplication order. */
  readonly factors: readonly PermutationValue[];
  readonly workUsed: number;
  readonly storedImagesCharged: number;
}

/** Completed strong generating set built by incremental Schreier–Sims. */
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
    this.#levels = buildCertificate(this.#group, ledger, firstBase).levels;
    this.#siftData = this.#levels.map((level) => siftData(level, ledger));
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
  }
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
  /** Diagnostic only: reconstruct provenance for the independent test oracle. */
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
  get order() {
    return this.#order;
  }
  get workUsed() {
    return this.#workUsed;
  }
  get storedImagesCharged() {
    return this.#storedImagesCharged;
  }
  get orbitEdges() {
    return this.#orbitEdges;
  }
  get orbitPoints() {
    return this.#orbitPoints;
  }
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
      if (index === undefined) break;
      const t = ledger.representative(level, index);
      residue = ledger.product(
        residue,
        ledger.representative(level, index, true)
      );
      ledger.retain(t);
      factors.push(t);
    }
    ledger.clearTransversals();
    ledger.retain(residue);
    return {
      member: residue.supportDegree === 0,
      residue,
      factors: factors.reverse(),
      workUsed: ledger.used,
      storedImagesCharged: ledger.stored,
    };
  }
}

/** Optional owner-provided cache; the pure kernel has no engine or session import. */
export type PermutationChainProvider = (
  group: PermutationGroupValue,
  limits: PermutationChainLimits,
  work: PermutationGroupWork,
  firstBase?: number
) => PermutationStabilizerChain;

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
/** Charge nested work once; release temporary sift output between membership tests. */
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
/** Membership is equivalent to an identity residue in a completed stabilizer chain. */
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

/** Explicitly compare subgroups in the same finite action, not abstract isomorphism. */
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

/** Pairwise generator commutation implies commutation of all their words; O(k² n) image work. */
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

/** Put the requested point first in the base; the next level generates its full stabilizer. */
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
