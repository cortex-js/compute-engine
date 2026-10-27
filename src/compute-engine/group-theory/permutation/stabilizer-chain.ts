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
  readonly maxProofSteps?: number;
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
    maxProofSteps: bound(requested.maxProofSteps ?? 100_000, 100_000, 'proof'),
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
  readonly generatorProofs: readonly number[];
  readonly orbit: readonly number[];
  readonly parents: readonly number[];
  readonly labels: readonly number[];
  readonly representatives: readonly PermutationValue[];
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
    generatorProofs: [],
    orbit: tree.points,
    parents: tree.parentIndices,
    labels: tree.generatorIndices,
    representatives: Object.freeze(representatives),
  });
}

/** A straight-line proof in the original, ordered input generators. */
export type PermutationProofStep =
  | { readonly kind: 'input'; readonly index: number }
  | { readonly kind: 'inverse'; readonly operand: number }
  | { readonly kind: 'product'; readonly left: number; readonly right: number };

export interface PermutationChainCertificate {
  readonly version: 1;
  readonly proof: readonly PermutationProofStep[];
  readonly levels: readonly PermutationChainLevel[];
}

function siftData(
  level: PermutationChainLevel,
  work: ChainWork
): ChainSiftData {
  const indices = new Map<number, number>();
  for (let i = 0; i < level.orbit.length; i++) {
    work.values.check?.();
    indices.set(level.orbit[i], i);
  }
  const inverses = level.representatives.map((p) => {
    const inverse = work.inverse(p);
    work.retain(inverse);
    return inverse;
  });
  return { indices, inverses: Object.freeze(inverses) };
}

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
    work.values.check?.();
    const level = levels[depth];
    const point = residue.images[level.base - 1] ?? level.base;
    const index = data[depth].indices.get(point);
    if (index === undefined) break;
    if (index !== 0) {
      residue = work.product(residue, data[depth].inverses[index]);
      factors.push({ depth, index });
    }
  }
  return { residue, depth, factors };
}

/**
 * Incremental deterministic Schreier-Sims. Only nontrivial sift residues enlarge
 * the strong generating set. Proof expressions are recorded lazily for those
 * additions, not for the much larger set of discarded Schreier generators.
 */
function buildCertificate(
  group: PermutationGroupValue,
  work: ChainWork,
  firstBase?: number
): PermutationChainCertificate {
  const levels: PermutationChainLevel[] = [];
  const data: ChainSiftData[] = [];
  const proof: PermutationProofStep[] = [];
  const proofOf = new Map<PermutationValue, number>();
  const representativeProofs = new WeakMap<
    PermutationChainLevel,
    Map<number, number>
  >();
  const append = (step: PermutationProofStep): number => {
    work.values.check?.();
    if (proof.length >= work.limits.maxProofSteps)
      throw new PermutationChainLimitError('permutation-chain-proof-limit');
    proof.push(Object.freeze(step));
    return proof.length - 1;
  };
  const productProof = (left: number, right: number) =>
    append({ kind: 'product', left, right });
  const inverseProof = (operand: number) =>
    append({ kind: 'inverse', operand });
  // The identity representative is omitted from products, so it needs no proof node.
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
    let current = index;
    while (current !== 0 && !cached.has(current)) {
      work.values.check?.();
      path.push(current);
      current = level.parents[current];
    }
    let result = current === 0 ? undefined : cached.get(current);
    for (let i = path.length - 1; i >= 0; i--) {
      const node = path[i];
      const generator = proofOf.get(level.generators[level.labels[node]])!;
      result =
        result === undefined ? generator : productProof(result, generator);
      cached.set(node, result);
    }
    return result!;
  };
  const rebuild = (depth: number, generators: readonly PermutationValue[]) => {
    const base = levels[depth].base;
    const level = makeLevel(
      new PermutationGroupValue(generators, group.action, work.values),
      base,
      work
    );
    levels[depth] = Object.freeze({
      ...level,
      generatorProofs: Object.freeze(generators.map((g) => proofOf.get(g)!)),
    });
    data[depth] = siftData(levels[depth], work);
  };
  const add = (
    value: PermutationValue,
    provenance: () => number,
    start: number
  ): boolean => {
    const result = reduce(value, levels, data, start, work);
    if (!result.residue.supportDegree) return false;
    let node = provenance();
    for (const factor of result.factors)
      node = productProof(
        node,
        inverseProof(representativeProof(levels[factor.depth], factor.index))
      );
    proofOf.set(result.residue, node);
    work.retain(result.residue);
    if (result.depth === levels.length) {
      if (levels.length >= work.limits.maxLevels)
        throw new PermutationChainLimitError('permutation-chain-level-limit');
      let base = 1;
      while ((result.residue.images[base - 1] ?? base) === base) {
        work.values.check?.();
        base++;
      }
      levels.push({
        base,
        generators: [],
        generatorProofs: [],
        orbit: [],
        parents: [],
        labels: [],
        representatives: [],
      });
    }
    // Every earlier subgroup must contain this new strong generator.
    for (let i = 0; i <= result.depth; i++) {
      const generators = [...levels[i].generators, result.residue];
      const cap = permutationGroupLimits(work.values);
      if (generators.length > cap.maxGenerators)
        throw new PermutationChainLimitError(
          'permutation-chain-generator-limit'
        );
      if (
        generators.reduce((n, g) => n + g.supportDegree, 0) >
        cap.maxGeneratorImages
      )
        throw new PermutationChainLimitError(
          'permutation-chain-generator-image-limit'
        );
      rebuild(i, generators);
    }
    return true;
  };
  if (
    firstBase !== undefined &&
    group.generators.some((g) => g.supportDegree)
  ) {
    if (work.limits.maxLevels === 0)
      throw new PermutationChainLimitError('permutation-chain-level-limit');
    levels.push({
      base: firstBase,
      generators: [],
      generatorProofs: [],
      orbit: [],
      parents: [],
      labels: [],
      representatives: [],
    });
    rebuild(0, []);
  }
  for (let i = 0; i < group.generators.length; i++)
    add(group.generators[i], () => append({ kind: 'input', index: i }), 0);

  let changed = true;
  while (changed) {
    changed = false;
    scan: for (let depth = levels.length - 1; depth >= 0; depth--) {
      const level = levels[depth];
      for (let i = 0; i < level.orbit.length; i++) {
        for (const generator of level.generators) {
          work.values.check?.();
          const point = level.orbit[i];
          const target = generator.images[point - 1] ?? point;
          const j = data[depth].indices.get(target)!;
          const candidate = work.product(
            work.product(level.representatives[i], generator),
            data[depth].inverses[j]
          );
          const provenance = () => {
            let node = proofOf.get(generator)!;
            if (i !== 0)
              node = productProof(representativeProof(level, i), node);
            if (j !== 0)
              node = productProof(
                node,
                inverseProof(representativeProof(level, j))
              );
            return node;
          };
          if (add(candidate, provenance, depth + 1)) {
            changed = true;
            break scan;
          }
        }
      }
    }
  }
  return Object.freeze({
    version: 1,
    proof: Object.freeze(proof),
    levels: Object.freeze(levels),
  });
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
      level.representatives.length !== n ||
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
      if (!PermutationValue.is(g)) return false;
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
      const point = level.orbit[i],
        t = level.representatives[i];
      if (
        !Number.isSafeInteger(point) ||
        point < 1 ||
        point > group.action.degree ||
        seen.has(point) ||
        !PermutationValue.is(t)
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
          label >= level.generators.length
        )
          return false;
        if (
          work.key(
            work.product(level.representatives[parent], level.generators[label])
          ) !== work.key(t)
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
          work.product(level.representatives[i], generator),
          data[depth].inverses[j]
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

/** Only computation followed by verification can construct this value. */
export class PermutationStabilizerChain {
  readonly #group: PermutationGroupValue;
  readonly #certificate: PermutationChainCertificate;
  readonly #levels: readonly PermutationChainLevel[];
  readonly #order: bigint;
  readonly #siftData: readonly ChainSiftData[];
  readonly #workUsed: number;
  readonly #storedImagesCharged: number;
  readonly #orbitPoints: number;
  private constructor(
    group: PermutationGroupValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork,
    firstBase?: number
  ) {
    if (!PermutationGroupValue.is(group))
      throw new PermutationInputError('invalid-permutation-group');
    const ledger = new ChainWork(requested, work);
    this.#group = ledger.receive(group);
    this.#certificate = buildCertificate(this.#group, ledger, firstBase);
    this.#levels = this.#certificate.levels;
    if (!verify(this.#group, this.#certificate, ledger))
      throw new PermutationChainInvariantError(
        'Constructed chain failed verification'
      );
    this.#siftData = Object.freeze(
      this.#levels.map((level) => siftData(level, ledger))
    );
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
    work: PermutationGroupWork = {},
    firstBase?: number
  ) {
    if (!PermutationGroupValue.is(group))
      throw new PermutationInputError('invalid-permutation-group');
    if (
      firstBase !== undefined &&
      (!Number.isSafeInteger(firstBase) ||
        firstBase < 1 ||
        firstBase > group.action.degree)
    )
      throw new PermutationInputError('point-outside-permutation-action');
    return new PermutationStabilizerChain(group, requested, work, firstBase);
  }
  static is(value: unknown): value is PermutationStabilizerChain {
    return typeof value === 'object' && value !== null && #levels in value;
  }
  get group() {
    return this.#group;
  }
  get certificate() {
    return this.#certificate;
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
  const chain = PermutationStabilizerChain.compute(
    received,
    ledger.remaining(),
    work,
    point
  );
  ledger.tick(chain.workUsed);
  return new PermutationGroupValue(
    chain.levels[1]?.generators ?? [],
    received.action,
    ledger.values
  );
}
