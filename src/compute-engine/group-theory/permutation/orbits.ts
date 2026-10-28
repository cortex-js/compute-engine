/**
 * Orbits of a permutation group, Schreier trees, and transversals.
 *
 * This is a kernel module. It does not import the compute engine. The input
 * group was validated when it was made; each entry point receives it again
 * with the caller's `work` to apply the caller's limits (see `receive()`).
 *
 * The orbit of a point `r` is the set of images of `r` under all the
 * elements of the group. `PermutationOrbitTree` stores the orbit as a
 * Schreier tree: each point except the root records its parent point and
 * the generator that maps the parent to it. A group element that maps the
 * root to a point (a transversal element) is not stored. It is computed on
 * request by multiplying the generators on the tree path.
 *
 * The conventions are the ones of `values.ts`: points start at 1, and a
 * product `a * b` applies `a` first and then `b`.
 *
 * Two kinds of limit apply, each with a separate error code:
 * - `PermutationOrbitLimits` for the search (points found, generator
 *   applications);
 * - `PermutationTransversalLimits` for the group elements built from the
 *   tree (products, image work, stored images).
 * A limit error stops the work and returns no partial result.
 */
import {
  PermutationInputError,
  PermutationValue,
  applyPermutation,
  composePermutations,
  inversePermutation,
} from './values.js';
import { PermutationGroupValue, type PermutationGroupWork } from './groups.js';

/**
 * Limits for an orbit search. Both are required.
 * - `maxPoints`: 0 to 100,000.
 * - `maxEdges`: 0 to 1,000,000.
 */
export interface PermutationOrbitLimits {
  /** Total discovered points, shared across all orbits in a partition. */
  readonly maxPoints: number;
  /** Generator applications, including edges to already discovered points. */
  readonly maxEdges: number;
}

/**
 * Limits for the group elements built from an orbit tree. They apply to one
 * call of `representative()`, `inverseRepresentative()` or `transversal()`.
 * - `maxProducts` (required): 0 to 100,000 products.
 * - `maxImageWork`: the sum of the array widths that the products and the
 *   inverse walk read; at most 5,000,000, the default.
 * - `maxStoredImages`: the sum of the `supportDegree` of the returned
 *   elements; at most 1,000,000, the default.
 */
export interface PermutationTransversalLimits {
  readonly maxProducts: number;
  readonly maxImageWork?: number;
  readonly maxStoredImages?: number;
}

/**
 * The error for an exceeded orbit or transversal limit. `code` is one of
 * `permutation-orbit-point-limit`, `permutation-orbit-edge-limit`,
 * `permutation-transversal-product-limit`,
 * `permutation-transversal-image-work-limit` or
 * `permutation-transversal-storage-limit`. The error does not tell anything
 * about the size of the orbit: the search stopped before it completed.
 */
export class PermutationOrbitLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationOrbitLimitError';
  }
}

/**
 * Return `value` when it is a safe integer from 0 to `cap`. Otherwise throw
 * `invalid-permutation-<name>-limit`. A missing required value (`undefined`)
 * also throws.
 */
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

/**
 * Apply the caller's limits to a group that was made under other limits.
 * The `PermutationGroupValue` constructor checks the degree and the
 * generator counts again; it does not revalidate the image arrays.
 */
function receive(group: PermutationGroupValue, work: PermutationGroupWork) {
  return new PermutationGroupValue(group.generators, group.action, work);
}

/**
 * Throw `point-outside-permutation-action` unless `point` is a safe integer
 * from 1 to the degree of the action of `group`.
 */
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

/**
 * A partition shares these counters across its fixed and moved orbits.
 *
 * `point()` counts one discovered point and `edge()` counts one generator
 * application. Each throws `PermutationOrbitLimitError` before the count
 * would pass its limit.
 */
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

/**
 * A Schreier tree stored as three parallel arrays, one entry per orbit
 * point.
 *
 * - `points[i]` is a point of the orbit. `points[0]` is the root, and the
 *   points are in the order the search found them.
 * - `parents[i]` is the index (into `points`, not a point) of the parent of
 *   `points[i]`. It is -1 for the root.
 * - `labels[i]` is the index into the group's generator list of the
 *   generator `g` with `points[parents[i]]` mapped by `g` to `points[i]`.
 *   It is -1 for the root.
 *
 * Every parent index is smaller than the index of its child, so one forward
 * pass can build the transversal elements in order.
 */
interface OrbitData {
  readonly points: readonly number[];
  readonly parents: readonly number[];
  readonly labels: readonly number[];
}

/**
 * Breadth-first search for the orbit of `root`. Returns the Schreier tree
 * of the orbit.
 *
 * Parent indices precede their children; labels index forward generators.
 * Positive words suffice: each finite-order generator has its inverse among
 * its powers, so the inverse generators are not needed to reach the whole
 * orbit.
 *
 * Breadth-first order makes each tree path a shortest positive word in the
 * generators.
 *
 * Cost: O(points * generators) generator applications, each O(1). Charges
 * one `budget.point()` for the root and for each new point, and one
 * `budget.edge()` for every application, also when the image was already
 * found.
 */
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

/**
 * Explicit transversals have separate product, image-work and live-output
 * bounds.
 *
 * - `product(width)` counts one product and charges `width` (the larger
 *   `supportDegree` of the two factors) to the image work.
 * - `images(width)` charges image work without a product (used for an
 *   inverse).
 * - `retain(width)` charges the `supportDegree` of an element that is
 *   returned to the caller.
 *
 * Each method throws `PermutationOrbitLimitError` before a counter would
 * pass its limit. A new budget is made for each call, so the limits apply to
 * one call, not to the life of the tree.
 */
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

/**
 * A completed orbit with a compact, readonly forward Schreier tree.
 *
 * `compute()` explores the whole orbit of the root and keeps only the tree
 * arrays (see `OrbitData`): O(orbit size) integers, no group elements. The
 * methods that return group elements build them from the tree on each call
 * and do not cache them. The tree keeps the group it was built from, and
 * the generator indices refer to that group's generator list.
 *
 * `compute()` throws:
 * - `PermutationInputError` for invalid limits, for the checks of the
 *   `PermutationGroupValue` constructor, and with
 *   `point-outside-permutation-action` for a root outside the action;
 * - `PermutationOrbitLimitError` with `permutation-orbit-point-limit` or
 *   `permutation-orbit-edge-limit` when the search reaches a limit.
 */
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
  /** The orbit points in breadth-first order, starting with the root. */
  get points(): readonly number[] {
    return this.#data.points;
  }
  /**
   * Root has parent/label -1; every other parent precedes its child.
   * Entry `i` is an index into `points`, not a point.
   */
  get parentIndices(): readonly number[] {
    return this.#data.parents;
  }
  /**
   * Entry `i` is the index into `group.generators` of the generator that
   * maps the parent of `points[i]` to `points[i]`, or -1 for the root.
   */
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
   *
   * Returns a group element `u` that maps the root to `point`: the product
   * of the generators on the tree path from the root to `point`, applied in
   * that order. The root gives the identity.
   *
   * Cost: O(orbit size) to find the point, then one product of O(degree)
   * per edge of the path. Charges the transversal limits for this call only.
   *
   * Throws `PermutationInputError` with `point-outside-permutation-action`
   * when `point` is not in the action, and `PermutationOrbitLimitError` when
   * a transversal limit is reached.
   */
  representative(
    point: unknown,
    requested: PermutationTransversalLimits,
    work: PermutationGroupWork = {}
  ): PermutationValue | undefined {
    return this.reconstruct(point, requested, work, false);
  }

  /**
   * A representative carrying the target point back to the root.
   *
   * Returns the inverse of `representative(point)`. It costs the same,
   * plus one O(degree) inverse that is charged to the image work. Returns
   * `undefined` and throws in the same cases as `representative()`.
   */
  inverseRepresentative(
    point: unknown,
    requested: PermutationTransversalLimits,
    work: PermutationGroupWork = {}
  ): PermutationValue | undefined {
    return this.reconstruct(point, requested, work, true);
  }

  /**
   * Build the transversal element for `point` from the tree. The common
   * code of `representative()` and `inverseRepresentative()`.
   */
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
    // The tree has no index from point to position, so this is a linear
    // search.
    let index = -1;
    for (let i = 0; i < points.length; i++) {
      work.check?.();
      if (points[i] === point) {
        index = i;
        break;
      }
    }
    if (index < 0) return undefined;
    // Walk from the point up to the root and collect the generator indices.
    // `path` is in reverse order: the last entry is the generator next to
    // the root.
    const path: number[] = [];
    while (index > 0) {
      work.check?.();
      path.push(labels[index]);
      index = parents[index];
    }
    // Multiply from the root side, so the first generator is applied first
    // and the result maps the root to the point.
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

  /**
   * Complete right-coset representatives for the root's point stabilizer.
   *
   * Returns one pair `[point, u]` for each orbit point, in the order of
   * `points`, where `u` maps the root to `point`. The first pair is the root
   * with the identity. The elements that map the root to `point` are
   * exactly the right coset `Stab(root) * u`, so the list has one
   * representative for each right coset.
   *
   * Each element is the element of its parent times one generator. The
   * parent comes first in `points`, so one forward pass builds every element
   * with one product. Cost: (orbit size - 1) products of O(degree) each.
   * All the elements are kept in the result, so `maxStoredImages` limits the
   * total memory. The result is not cached: each call builds it again.
   *
   * Throws `PermutationOrbitLimitError` when a transversal limit is reached,
   * and `PermutationInputError` for invalid limits or for the checks of the
   * `PermutationGroupValue` constructor.
   */
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

/**
 * Partition the entire explicit action, including fixed points, under one
 * budget.
 *
 * Returns the orbits of the group on 1..degree. The orbits are sorted by
 * their least point, and that point is the first entry of each orbit. The
 * other points of an orbit are in breadth-first order, not sorted. A fixed
 * point is an orbit of length 1. Example: the group generated by `[2, 1]`
 * on degree 3 gives `[[1, 2], [3]]`.
 *
 * Cost: O(degree * generators) generator applications in total. All the
 * orbits share one `OrbitBudget`, so `maxPoints` must be at least the
 * degree for the call to complete.
 *
 * Throws `PermutationOrbitLimitError` when a limit is reached, and
 * `PermutationInputError` for invalid limits or for the checks of the
 * `PermutationGroupValue` constructor.
 */
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
