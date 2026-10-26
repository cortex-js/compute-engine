import {
  PermutationValue,
  PermutationInputError,
  assertPermutationFits,
  composePermutations,
  inversePermutation,
} from './values.js';
import {
  PermutationGroupValue,
  permutationGroupLimits,
  type PermutationGroupWork,
} from './groups.js';
import { PermutationOrbitTree } from './orbits.js';

export interface PermutationChainLimits {
  readonly maxWork: number;
  readonly maxLevels?: number;
  readonly maxOrbitPoints?: number;
  /** Cumulative retained generator and representative image entries. */
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
export function permutationChainLimits(requested: PermutationChainLimits) {
  if (!requested)
    throw new PermutationInputError('invalid-permutation-chain-limits');
  return {
    maxWork: bound(requested.maxWork, 50_000_000, 'work'),
    maxLevels: bound(requested.maxLevels ?? 256, 256, 'level'),
    maxOrbitPoints: bound(
      requested.maxOrbitPoints ?? 100_000,
      100_000,
      'orbit-point'
    ),
    maxStoredImages: bound(
      requested.maxStoredImages ?? 1_000_000,
      1_000_000,
      'storage'
    ),
  };
}

/** One ledger is shared by construction and verification, including nested kernels. */
class ChainWork {
  used = 0;
  stored = 0;
  points = 0;
  readonly limits: ReturnType<typeof permutationChainLimits>;
  readonly values: PermutationGroupWork;
  readonly caller: PermutationGroupWork;
  constructor(requested: PermutationChainLimits, work: PermutationGroupWork) {
    this.limits = permutationChainLimits(requested);
    this.caller = work;
    this.values = {
      ...work,
      check: () => {
        this.tick();
        work.check?.();
      },
    };
  }
  remaining(): PermutationChainLimits {
    return {
      ...this.limits,
      maxWork: this.limits.maxWork - this.used,
      maxStoredImages: this.limits.maxStoredImages - this.stored,
      maxOrbitPoints: this.limits.maxOrbitPoints - this.points,
    };
  }
  tick(count = 1) {
    if (this.used + count > this.limits.maxWork)
      throw new PermutationChainLimitError('permutation-chain-work-limit');
    this.used += count;
  }
  retain(p: PermutationValue) {
    if (this.stored + p.supportDegree > this.limits.maxStoredImages)
      throw new PermutationChainLimitError('permutation-chain-storage-limit');
    this.stored += p.supportDegree;
  }
  key(p: PermutationValue) {
    this.tick(1 + p.supportDegree);
    return p.images.join(',');
  }
  product(a: PermutationValue, b: PermutationValue) {
    this.tick(1 + Math.max(a.supportDegree, b.supportDegree));
    return composePermutations(a, b, this.values);
  }
  inverse(p: PermutationValue) {
    this.tick(1 + p.supportDegree);
    return inversePermutation(p, this.values);
  }
  receive(group: PermutationGroupValue) {
    if (!PermutationGroupValue.is(group))
      throw new PermutationInputError('invalid-permutation-group');
    return new PermutationGroupValue(
      group.generators,
      group.action,
      this.values
    );
  }
}

interface ChainSiftData {
  indices: ReadonlyMap<number, number>;
  inverses: readonly PermutationValue[];
}

export interface PermutationChainLevel {
  readonly base: number;
  readonly generators: readonly PermutationValue[];
  readonly orbit: readonly number[];
  readonly parents: readonly number[];
  readonly labels: readonly number[];
  readonly representatives: readonly PermutationValue[];
}

function uniqueGenerators(
  generators: readonly PermutationValue[],
  work: ChainWork
): PermutationValue[] {
  const seen = new Set<string>();
  const result: PermutationValue[] = [];
  const cap = permutationGroupLimits(work.values);
  let images = 0;
  for (const p of generators) {
    work.values.check?.();
    if (p.supportDegree === 0) continue;
    const key = work.key(p);
    if (seen.has(key)) continue;
    if (result.length >= cap.maxGenerators)
      throw new PermutationChainLimitError('permutation-chain-generator-limit');
    images += p.supportDegree;
    if (images > cap.maxGeneratorImages)
      throw new PermutationChainLimitError(
        'permutation-chain-generator-image-limit'
      );
    work.retain(p);
    seen.add(key);
    result.push(p);
  }
  return result;
}

function makeLevel(
  group: PermutationGroupValue,
  base: number,
  work: ChainWork
): PermutationChainLevel {
  const tree = PermutationOrbitTree.compute(
    group,
    base,
    {
      maxPoints: work.limits.maxOrbitPoints - work.points,
      maxEdges: 1_000_000,
    },
    work.values
  );
  work.points += tree.points.length;
  const representatives = [new PermutationValue([], work.values)];
  for (let i = 1; i < tree.points.length; i++) {
    work.values.check?.();
    const p = work.product(
      representatives[tree.parentIndices[i]],
      group.generators[tree.generatorIndices[i]]
    );
    work.retain(p);
    representatives.push(p);
  }
  return Object.freeze({
    base,
    generators: group.generators,
    orbit: tree.points,
    parents: tree.parentIndices,
    labels: tree.generatorIndices,
    representatives: Object.freeze(representatives),
  });
}

/** Schreier's lemma: t_x s t_(x^s)^-1 generates the complete point stabilizer. */
function schreierGenerators(
  level: PermutationChainLevel,
  work: ChainWork,
  siftData?: ChainSiftData[]
): PermutationValue[] {
  const indices = new Map<number, number>();
  for (let i = 0; i < level.orbit.length; i++) {
    work.values.check?.();
    indices.set(level.orbit[i], i);
  }
  const inverses = level.representatives.map((p) => {
    const inv = work.inverse(p);
    work.retain(inv);
    return inv;
  });
  siftData?.push({ indices, inverses: Object.freeze(inverses) });
  const seen = new Set<string>();
  const result: PermutationValue[] = [];
  const cap = permutationGroupLimits(work.values);
  let images = 0;
  for (let i = 0; i < level.orbit.length; i++) {
    for (const s of level.generators) {
      work.values.check?.();
      const x = level.orbit[i],
        y = s.images[x - 1] ?? x;
      const j = indices.get(y);
      if (j === undefined)
        throw new PermutationChainInvariantError('Orbit is not closed');
      const candidate = work.product(
        work.product(level.representatives[i], s),
        inverses[j]
      );
      if (!candidate.supportDegree) continue;
      const key = work.key(candidate);
      if (seen.has(key)) continue;
      if (result.length >= cap.maxGenerators)
        throw new PermutationChainLimitError(
          'permutation-chain-generator-limit'
        );
      images += candidate.supportDegree;
      if (images > cap.maxGeneratorImages)
        throw new PermutationChainLimitError(
          'permutation-chain-generator-image-limit'
        );
      work.retain(candidate);
      seen.add(key);
      result.push(candidate);
    }
  }
  return result;
}

function buildLevels(
  group: PermutationGroupValue,
  work: ChainWork,
  siftData: ChainSiftData[]
): readonly PermutationChainLevel[] {
  const levels: PermutationChainLevel[] = [];
  let generators = uniqueGenerators(group.generators, work);
  while (generators.length) {
    work.values.check?.();
    if (levels.length >= work.limits.maxLevels)
      throw new PermutationChainLimitError('permutation-chain-level-limit');
    // Any moved point strictly decreases the next stabilizer subgroup.
    let base = 1;
    while (
      generators.every((g) => {
        work.values.check?.();
        return (g.images[base - 1] ?? base) === base;
      })
    )
      base++;
    const level = makeLevel(
      new PermutationGroupValue(generators, group.action, work.values),
      base,
      work
    );
    levels.push(level);
    generators = schreierGenerators(level, work, siftData);
  }
  return Object.freeze(levels);
}

/**
 * Verify a full Schreier certificate by tree edges and closure, independently
 * of the builder's traversal and base choice. This deliberately accepts complete
 * Schreier generating sets, not arbitrary reduced BSGS certificates.
 */
function verify(
  group: PermutationGroupValue,
  levels: readonly PermutationChainLevel[],
  work: ChainWork
): boolean {
  if (!Array.isArray(levels) || levels.length > work.limits.maxLevels)
    throw new PermutationInputError('invalid-permutation-chain-certificate');
  let expected = new Set(
    group.generators.filter((p) => p.supportDegree).map((p) => work.key(p))
  );
  const previous: number[] = [];
  let points = 0;
  for (const level of levels) {
    work.values.check?.();
    if (
      !level ||
      !Array.isArray(level.generators) ||
      !Array.isArray(level.orbit) ||
      !Array.isArray(level.parents) ||
      !Array.isArray(level.labels) ||
      !Array.isArray(level.representatives)
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
      level.representatives.length !== n
    )
      return false;
    const received = new PermutationGroupValue(
      level.generators,
      group.action,
      work.values
    );
    const actual = new Set<string>();
    for (const g of received.generators) {
      if (!g.supportDegree) return false;
      const key = work.key(g);
      if (actual.has(key) || !expected.has(key)) return false;
      actual.add(key);
      for (const p of previous) {
        work.values.check?.();
        if ((g.images[p - 1] ?? p) !== p) return false;
      }
    }
    if (actual.size !== expected.size || !actual.size) return false;
    const indices = new Map<number, number>();
    for (let i = 0; i < n; i++) {
      work.values.check?.();
      const point = level.orbit[i],
        t = level.representatives[i];
      if (
        !Number.isSafeInteger(point) ||
        point < 1 ||
        point > group.action.degree ||
        indices.has(point)
      )
        return false;
      assertPermutationFits(t, group.action, work.values);
      work.retain(t);
      if ((t.images[level.base - 1] ?? level.base) !== point) return false;
      if (i === 0) {
        if (
          t.supportDegree ||
          level.parents[i] !== -1 ||
          level.labels[i] !== -1
        )
          return false;
      } else {
        const parent = level.parents[i],
          label = level.labels[i];
        if (
          !Number.isSafeInteger(parent) ||
          parent < 0 ||
          parent >= i ||
          !Number.isSafeInteger(label) ||
          label < 0 ||
          label >= received.generators.length
        )
          return false;
        if (
          work.key(
            work.product(
              level.representatives[parent],
              received.generators[label]
            )
          ) !== work.key(t)
        )
          return false;
      }
      indices.set(point, i);
    }
    // Reachability follows from the tree; closure proves that no orbit point is omitted.
    const next = new Set<string>();
    for (let i = 0; i < n; i++) {
      for (const s of received.generators) {
        work.values.check?.();
        const x = level.orbit[i],
          y = s.images[x - 1] ?? x;
        const j = indices.get(y);
        if (j === undefined) return false;
        const h = work.product(
          work.product(level.representatives[i], s),
          work.inverse(level.representatives[j])
        );
        if (h.supportDegree) {
          const key = work.key(h);
          if (!next.has(key)) work.retain(h);
          next.add(key);
        }
      }
    }
    expected = next;
    previous.push(level.base);
  }
  return expected.size === 0;
}

export function verifyPermutationChain(
  group: PermutationGroupValue,
  levels: readonly PermutationChainLevel[],
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {}
): boolean {
  const ledger = new ChainWork(requested, work);
  return verify(ledger.receive(group), levels, ledger);
}

export interface PermutationSiftResult {
  readonly member: boolean;
  readonly residue: PermutationValue;
  /** g = residue * factors[0] * ... * factors[last], in multiplication order. */
  readonly factors: readonly PermutationValue[];
  readonly workUsed: number;
  readonly storedImagesCharged: number;
}

/** Only computation followed by verification can construct this value. */
export class PermutationStabilizerChain {
  readonly #group: PermutationGroupValue;
  readonly #levels: readonly PermutationChainLevel[];
  readonly #order: bigint;
  readonly #siftData: readonly ChainSiftData[];
  readonly #workUsed: number;
  readonly #storedImagesCharged: number;
  readonly #orbitPoints: number;
  private constructor(
    group: PermutationGroupValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork
  ) {
    const ledger = new ChainWork(requested, work);
    this.#group = ledger.receive(group);
    const siftData: ChainSiftData[] = [];
    this.#levels = buildLevels(this.#group, ledger, siftData);
    if (!verify(this.#group, this.#levels, ledger))
      throw new PermutationChainInvariantError(
        'Constructed chain failed verification'
      );
    this.#siftData = Object.freeze(siftData);
    let order = 1n;
    for (const level of this.#levels) {
      ledger.values.check?.();
      order *= BigInt(level.orbit.length);
    }
    this.#order = order;
    this.#workUsed = ledger.used;
    this.#storedImagesCharged = ledger.stored;
    this.#orbitPoints = ledger.points;
    Object.freeze(this);
  }
  static compute(
    group: PermutationGroupValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ) {
    return new PermutationStabilizerChain(group, requested, work);
  }
  static is(value: unknown): value is PermutationStabilizerChain {
    return typeof value === 'object' && value !== null && #levels in value;
  }
  get group() {
    return this.#group;
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
      const t = level.representatives[index];
      residue = ledger.product(residue, data.inverses[index]);
      factors.push(t);
    }
    ledger.retain(residue);
    return Object.freeze({
      member: residue.supportDegree === 0,
      residue,
      factors: Object.freeze(factors.reverse()),
      workUsed: ledger.used,
      storedImagesCharged: ledger.stored,
    });
  }
}

function chainInSession(group: PermutationGroupValue, ledger: ChainWork) {
  const chain = PermutationStabilizerChain.compute(
    group,
    ledger.remaining(),
    ledger.caller
  );
  ledger.tick(chain.workUsed);
  ledger.stored += chain.storedImagesCharged;
  ledger.points += chain.orbitPoints;
  return chain;
}
function containsInSession(
  chain: PermutationStabilizerChain,
  value: PermutationValue,
  ledger: ChainWork
) {
  const result = chain.sift(value, ledger.remaining(), ledger.caller);
  ledger.tick(result.workUsed);
  ledger.stored += result.storedImagesCharged;
  return result.member;
}
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
  work: PermutationGroupWork = {}
): boolean | bigint {
  const ledger = new ChainWork(requested, work);
  const G = ledger.receive(parent),
    H = ledger.receive(candidate);
  if (G.action.degree !== H.action.degree)
    throw new PermutationInputError('incompatible-permutation-actions');
  const gChain = chainInSession(G, ledger);
  for (const h of H.generators) {
    ledger.values.check?.();
    if (!containsInSession(gChain, h, ledger)) {
      if (query === 'index')
        throw new PermutationInputError('not-a-permutation-subgroup');
      return false;
    }
  }
  if (query === 'subgroup') return true;
  const hChain = chainInSession(H, ledger);
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

export function permutationPointStabilizer(
  group: PermutationGroupValue,
  point: number,
  requested: PermutationChainLimits,
  work: PermutationGroupWork = {}
): PermutationGroupValue {
  const ledger = new ChainWork(requested, work);
  const received = ledger.receive(group);
  const level = makeLevel(received, point, ledger);
  return new PermutationGroupValue(
    schreierGenerators(level, ledger),
    received.action,
    ledger.values
  );
}
