import {
  PermutationInputError,
  PermutationValue,
  applyPermutation,
  composePermutations,
  inversePermutation,
} from './values.js';
import { PermutationGroupValue, type PermutationGroupWork } from './groups.js';

export interface PermutationOrbitLimits {
  /** Total discovered points, shared across all orbits in a partition. */
  readonly maxPoints: number;
  /** Generator applications, including edges to already discovered points. */
  readonly maxEdges: number;
}

export interface PermutationTransversalLimits {
  readonly maxProducts: number;
  readonly maxImageWork?: number;
  readonly maxStoredImages?: number;
}

export class PermutationOrbitLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationOrbitLimitError';
  }
}

function limit(value: number, cap: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > cap)
    throw new PermutationInputError(`invalid-permutation-${name}-limit`);
  return value;
}

export function permutationOrbitLimits(requested: PermutationOrbitLimits) {
  if (!requested)
    throw new PermutationInputError('invalid-permutation-orbit-limits');
  return {
    maxPoints: limit(requested.maxPoints, 100_000, 'orbit-point'),
    maxEdges: limit(requested.maxEdges, 1_000_000, 'orbit-edge'),
  };
}

export function permutationTransversalLimits(
  requested: PermutationTransversalLimits
) {
  if (!requested)
    throw new PermutationInputError('invalid-permutation-transversal-limits');
  return {
    maxProducts: limit(requested.maxProducts, 100_000, 'transversal-product'),
    maxImageWork: limit(
      requested.maxImageWork ?? 5_000_000,
      5_000_000,
      'transversal-image-work'
    ),
    maxStoredImages: limit(
      requested.maxStoredImages ?? 1_000_000,
      1_000_000,
      'transversal-storage'
    ),
  };
}

function receive(group: PermutationGroupValue, work: PermutationGroupWork) {
  return new PermutationGroupValue(group.generators, group.action, work);
}

function pointInAction(
  group: PermutationGroupValue,
  point: unknown
): asserts point is number {
  if (
    typeof point !== 'number' ||
    !Number.isSafeInteger(point) ||
    point < 1 ||
    point > group.action.degree
  )
    throw new PermutationInputError('point-outside-permutation-action');
}

/** A partition shares these counters across its fixed and moved orbits. */
class OrbitBudget {
  private points = 0;
  private edges = 0;
  constructor(
    private readonly limits: ReturnType<typeof permutationOrbitLimits>
  ) {}
  point() {
    if (this.points >= this.limits.maxPoints)
      throw new PermutationOrbitLimitError('permutation-orbit-point-limit');
    this.points++;
  }
  edge() {
    if (this.edges >= this.limits.maxEdges)
      throw new PermutationOrbitLimitError('permutation-orbit-edge-limit');
    this.edges++;
  }
}

interface OrbitData {
  readonly points: readonly number[];
  readonly parents: readonly number[];
  readonly labels: readonly number[];
}

/** Parent indices precede their children; labels index forward generators. */
/** Breadth-first search costs O(points * generators). Parent indices precede children. Positive words suffice: each finite-order generator has its inverse among its powers. */
function explore(
  group: PermutationGroupValue,
  root: number,
  budget: OrbitBudget,
  work: PermutationGroupWork
): OrbitData {
  budget.point();
  const points = [root],
    parents = [-1],
    labels = [-1];
  const seen = new Set<number>(points);
  for (let cursor = 0; cursor < points.length; cursor++) {
    work.check?.();
    for (let label = 0; label < group.generators.length; label++) {
      work.check?.();
      budget.edge();
      const image = applyPermutation(
        group.generators[label],
        points[cursor],
        group.action,
        work
      );
      if (seen.has(image)) continue;
      budget.point();
      seen.add(image);
      points.push(image);
      parents.push(cursor);
      labels.push(label);
    }
  }
  // Only a completely explored frontier establishes an orbit.
  return {
    points: points,
    parents: parents,
    labels: labels,
  };
}

/** Explicit transversals have separate product, image-work and live-output bounds. */
class TransversalBudget {
  private products = 0;
  private imageWork = 0;
  private storedImages = 0;
  constructor(
    private readonly limits: ReturnType<typeof permutationTransversalLimits>
  ) {}
  product(width: number) {
    if (this.products >= this.limits.maxProducts)
      throw new PermutationOrbitLimitError(
        'permutation-transversal-product-limit'
      );
    this.images(width);
    this.products++;
  }
  images(width: number) {
    if (this.imageWork + width > this.limits.maxImageWork)
      throw new PermutationOrbitLimitError(
        'permutation-transversal-image-work-limit'
      );
    this.imageWork += width;
  }
  retain(width: number) {
    if (this.storedImages + width > this.limits.maxStoredImages)
      throw new PermutationOrbitLimitError(
        'permutation-transversal-storage-limit'
      );
    this.storedImages += width;
  }
}

/** A completed orbit with a compact, readonly forward Schreier tree. */
export class PermutationOrbitTree {
  readonly #group: PermutationGroupValue;
  readonly #data: OrbitData;
  private constructor(
    group: PermutationGroupValue,
    root: unknown,
    requested: PermutationOrbitLimits,
    work: PermutationGroupWork
  ) {
    const limits = permutationOrbitLimits(requested);
    this.#group = receive(group, work);
    pointInAction(this.#group, root);
    this.#data = explore(this.#group, root, new OrbitBudget(limits), work);
  }
  static compute(
    group: PermutationGroupValue,
    root: unknown,
    requested: PermutationOrbitLimits,
    work: PermutationGroupWork = {}
  ): PermutationOrbitTree {
    return new PermutationOrbitTree(group, root, requested, work);
  }
  get points(): readonly number[] {
    return this.#data.points;
  }
  /** Root has parent/label -1; every other parent precedes its child. */
  get parentIndices(): readonly number[] {
    return this.#data.parents;
  }
  get generatorIndices(): readonly number[] {
    return this.#data.labels;
  }
  get root(): number {
    return this.#data.points[0];
  }
  get group(): PermutationGroupValue {
    return this.#group;
  }

  /**
   * A positive generator word carries root to point. Undefined proves that a
   * valid action point is outside this complete orbit, not outside the group.
   */
  representative(
    point: unknown,
    requested: PermutationTransversalLimits,
    work: PermutationGroupWork = {}
  ): PermutationValue | undefined {
    return this.reconstruct(point, requested, work, false);
  }

  /** A representative carrying the target point back to the root. */
  inverseRepresentative(
    point: unknown,
    requested: PermutationTransversalLimits,
    work: PermutationGroupWork = {}
  ): PermutationValue | undefined {
    return this.reconstruct(point, requested, work, true);
  }

  private reconstruct(
    point: unknown,
    requested: PermutationTransversalLimits,
    work: PermutationGroupWork,
    inverse: boolean
  ): PermutationValue | undefined {
    const budget = new TransversalBudget(
      permutationTransversalLimits(requested)
    );
    const group = receive(this.#group, work);
    pointInAction(group, point);
    const { points, parents, labels } = this.#data;
    let index = -1;
    for (let i = 0; i < points.length; i++) {
      work.check?.();
      if (points[i] === point) {
        index = i;
        break;
      }
    }
    if (index < 0) return undefined;
    const path: number[] = [];
    while (index > 0) {
      work.check?.();
      path.push(labels[index]);
      index = parents[index];
    }
    let result = PermutationValue.fromImages([], work);
    for (let i = path.length - 1; i >= 0; i--) {
      work.check?.();
      const generator = group.generators[path[i]];
      budget.product(Math.max(result.supportDegree, generator.supportDegree));
      result = composePermutations(result, generator, work);
    }
    if (inverse) {
      budget.images(result.supportDegree);
      result = inversePermutation(result, work);
    }
    budget.retain(result.supportDegree);
    return result;
  }

  /** Complete right-coset representatives for the root's point stabilizer. */
  transversal(
    requested: PermutationTransversalLimits,
    work: PermutationGroupWork = {}
  ): readonly (readonly [number, PermutationValue])[] {
    const budget = new TransversalBudget(
      permutationTransversalLimits(requested)
    );
    const group = receive(this.#group, work);
    const { points, parents, labels } = this.#data;
    const representatives = [PermutationValue.fromImages([], work)];
    const result: (readonly [number, PermutationValue])[] = [
      [points[0], representatives[0]] as const,
    ];
    for (let i = 1; i < points.length; i++) {
      work.check?.();
      const parent = representatives[parents[i]],
        generator = group.generators[labels[i]];
      budget.product(Math.max(parent.supportDegree, generator.supportDegree));
      const value = composePermutations(parent, generator, work);
      budget.retain(value.supportDegree);
      representatives.push(value);
      result.push([points[i], value] as const);
    }
    return result;
  }
}

/** Partition the entire explicit action, including fixed points, under one budget. */
export function permutationOrbits(
  group: PermutationGroupValue,
  requested: PermutationOrbitLimits,
  work: PermutationGroupWork = {}
): readonly (readonly number[])[] {
  const budget = new OrbitBudget(permutationOrbitLimits(requested));
  const validated = receive(group, work);
  const seen = new Set<number>();
  const result: (readonly number[])[] = [];
  for (let root = 1; root <= validated.action.degree; root++) {
    work.check?.();
    if (seen.has(root)) continue;
    const orbit = explore(validated, root, budget, work).points;
    for (const point of orbit) {
      work.check?.();
      seen.add(point);
    }
    result.push(orbit);
  }
  return result;
}
