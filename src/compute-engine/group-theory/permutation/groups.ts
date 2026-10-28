/**
 * Permutation groups given by generators, and a reference enumeration of
 * all their elements.
 *
 * This is a kernel module. It does not import the compute engine. A
 * `PermutationGroupValue` holds a list of generators and the action (the
 * points 1..degree) they act on. The orbit and stabilizer-chain modules take
 * a `PermutationGroupValue` as input.
 *
 * The generators were validated when they were made (see
 * `PermutationValue.fromImages()`). The constructor here checks only that
 * each generator fits the action and that the counts stay in the limits of
 * the caller.
 */
import {
  PermutationAction,
  PermutationValue,
  PermutationInputError,
  degreeLimit,
  assertPermutationFits,
  composePermutations,
  type PermutationWork,
} from './values.js';

/**
 * Options for group operations. They add two limits to `PermutationWork`:
 * - `maxGenerators`: the largest number of generators (at most 1024, the
 *   default);
 * - `maxGeneratorImages`: the largest sum of the `supportDegree` of all the
 *   generators (at most 1,000,000, the default).
 */
export interface PermutationGroupWork extends PermutationWork {
  readonly maxGenerators?: number;
  readonly maxGeneratorImages?: number;
}

/**
 * Return `value`, or `cap` when `value` is not given. A caller can lower a
 * limit but cannot raise it above `cap`.
 *
 * Throws `invalid-<name>` when the result is not a safe integer from
 * `minimum` to `cap`.
 */
function boundedLimit(
  value: number | undefined,
  cap: number,
  name: string,
  minimum = 0
): number {
  const limit = value ?? cap;
  if (!Number.isSafeInteger(limit) || limit < minimum || limit > cap)
    throw new PermutationInputError(`invalid-${name}`);
  return limit;
}

/**
 * Read and check the generator limits of `work`. Throws
 * `invalid-permutation-generator-limit` or
 * `invalid-permutation-generator-image-limit` when a requested limit is not
 * valid.
 */
export function permutationGroupLimits(work: PermutationGroupWork = {}) {
  return {
    maxGenerators: boundedLimit(
      work.maxGenerators,
      1024,
      'permutation-generator-limit'
    ),
    maxGeneratorImages: boundedLimit(
      work.maxGeneratorImages,
      1_000_000,
      'permutation-generator-image-limit'
    ),
  };
}

/**
 * A descriptor, not a canonical identity for the generated subgroup.
 *
 * The value is the list of generators, in the given order and with
 * repetitions, and the action. Two values with different generator lists can
 * describe the same group. A group question (order, membership) needs a
 * stabilizer chain or an enumeration.
 *
 * An empty generator list describes the trivial group on the action.
 *
 * The constructor throws `PermutationInputError`:
 * - `invalid-permutation-generator-limit`,
 *   `invalid-permutation-generator-image-limit` or
 *   `invalid-permutation-degree-limit` when a limit in `work` is not valid;
 * - `permutation-degree-limit` when the action or a generator is larger
 *   than the degree limit;
 * - `permutation-generator-limit` when there are more generators than
 *   `maxGenerators`;
 * - `permutation-outside-action` when a generator moves a point larger than
 *   `action.degree`;
 * - `permutation-generator-image-limit` when the sum of the `supportDegree`
 *   of the generators is larger than `maxGeneratorImages`.
 *
 * Other modules call this constructor again on an existing group, with
 * their own `work`, to apply the limits of the new caller ("receive" the
 * group). That costs O(number of generators); no image array is read.
 */
export class PermutationGroupValue {
  readonly #generators: readonly PermutationValue[];
  readonly #action: PermutationAction;

  constructor(
    generators: readonly PermutationValue[],
    action: PermutationAction,
    work: PermutationGroupWork = {}
  ) {
    const limits = permutationGroupLimits(work);
    work.check?.();
    if (action.degree > degreeLimit(work))
      throw new PermutationInputError('permutation-degree-limit');
    const length = generators.length;
    if (length > limits.maxGenerators)
      throw new PermutationInputError('permutation-generator-limit');
    const copy: PermutationValue[] = [];
    let images = 0;
    for (let i = 0; i < length; i++) {
      work.check?.();
      const generator = generators[i];
      assertPermutationFits(generator, action, work);
      images += generator.supportDegree;
      if (images > limits.maxGeneratorImages)
        throw new PermutationInputError('permutation-generator-image-limit');
      copy.push(generator);
    }
    // Preserve generator order and repetitions: they define the descriptor,
    // not a claim about a canonical or minimal generating set.
    this.#generators = copy;
    this.#action = action;
  }

  get generators(): readonly PermutationValue[] {
    return this.#generators;
  }
  get action(): PermutationAction {
    return this.#action;
  }
}

/**
 * Limits for `enumeratePermutationGroup()`. The caller must give
 * `maxElements` and `maxProducts`; the other two have defaults.
 *
 * - `maxElements`: the largest number of elements in the result, from 1 to
 *   10,000 (the identity counts).
 * - `maxProducts`: the largest number of products, from 0 to 100,000.
 * - `maxImageWork`: at most 5,000,000, the default.
 * - `maxStoredImages`: at most 1,000,000, the default.
 */
export interface PermutationClosureLimits {
  readonly maxElements: number;
  readonly maxProducts: number;
  /** Sum of the image-array widths of attempted products. */
  readonly maxImageWork?: number;
  /** Sum of normalized image-array lengths retained in the result. */
  readonly maxStoredImages?: number;
}

/**
 * Resource exhaustion carries no partial list or mathematical conclusion.
 *
 * The enumeration throws this error when a limit of
 * `PermutationClosureLimits` is reached. It does not tell if the group is
 * larger than the limit: the work stopped before the answer was known.
 * `code` names the limit, for example `permutation-closure-element-limit`.
 */
export class PermutationClosureLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationClosureLimitError';
  }
}

/**
 * Check the requested closure limits and fill in the defaults. Throws
 * `PermutationInputError` with `invalid-permutation-closure-limits` when
 * `limits` is missing or a required field is not a number, and
 * `invalid-permutation-closure-<name>-limit` when a value is out of range.
 */
export function permutationClosureLimits(limits: PermutationClosureLimits) {
  if (
    !limits ||
    typeof limits.maxElements !== 'number' ||
    typeof limits.maxProducts !== 'number'
  )
    throw new PermutationInputError('invalid-permutation-closure-limits');
  return {
    maxElements: boundedLimit(
      limits.maxElements,
      10_000,
      'permutation-closure-element-limit',
      1
    ),
    maxProducts: boundedLimit(
      limits.maxProducts,
      100_000,
      'permutation-closure-product-limit'
    ),
    maxImageWork: boundedLimit(
      limits.maxImageWork,
      5_000_000,
      'permutation-closure-image-work-limit'
    ),
    maxStoredImages: boundedLimit(
      limits.maxStoredImages,
      1_000_000,
      'permutation-closure-storage-limit'
    ),
  };
}

/**
 * Bounded breadth-first closure for reference computations. Finite permutation
 * generators need only positive words: every inverse is a positive power.
 * A list is returned only after the entire frontier has been processed.
 *
 * The result starts with the identity. Each later element is
 * `composePermutations(e, g)` for an earlier element `e` and a generator
 * `g`, so the list is in breadth-first order of the shortest generator
 * word. The search ends when every element has been multiplied by every
 * generator. At that point the list is closed under products, so it is the
 * whole group.
 *
 * Elements are compared by the key `images.join(',')`. This is exact
 * because image arrays are normalized (no trailing fixed points).
 *
 * Cost: one product for each pair (element, generator), that is
 * |G| * (number of generators) products of O(degree) each.
 *
 * Throws `PermutationClosureLimitError` when one of these counters would go
 * past its limit:
 * - `permutation-closure-product-limit`: the number of products;
 * - `permutation-closure-image-work-limit`: the sum, over all products, of
 *   the larger `supportDegree` of the two factors. It is charged before
 *   the product is computed;
 * - `permutation-closure-element-limit`: the number of elements. It is
 *   charged only for a new element, so a group with exactly `maxElements`
 *   elements completes;
 * - `permutation-closure-storage-limit`: the sum of the `supportDegree` of
 *   the stored elements.
 *
 * Throws `PermutationInputError` for invalid limits and for the checks of
 * the `PermutationGroupValue` constructor.
 */
export function enumeratePermutationGroup(
  group: PermutationGroupValue,
  requested: PermutationClosureLimits,
  work: PermutationGroupWork = {}
): readonly PermutationValue[] {
  const limits = permutationClosureLimits(requested);
  // Recheck receiving limits even for an already validated host descriptor.
  const validated = new PermutationGroupValue(
    group.generators,
    group.action,
    work
  );
  return enumeratePermutationGroupWithLimits(validated, limits, work);
}

/**
 * Internal closure traversal shared by bounded representations. The caller has
 * validated the group and supplied finite, nonnegative limits (maxElements >= 1).
 * Public closure requests enter through enumeratePermutationGroup(), which also
 * applies that API's ceilings. A finite-table bridge instead shares its existing
 * work ceiling across closure and table construction.
 *
 * chargeProduct is called before every attempted product with max(1, width),
 * including repeated elements. It lets a surrounding computation charge this
 * traversal to the same ledger without counting cancellation polls as work.
 */
export function enumeratePermutationGroupWithLimits(
  group: PermutationGroupValue,
  limits: Required<PermutationClosureLimits>,
  work: PermutationGroupWork & {
    readonly chargeProduct?: (width: number) => void;
  } = {}
): readonly PermutationValue[] {
  const elements: PermutationValue[] = [PermutationValue.fromImages([], work)];
  const seen = new Set<string>(['']);
  let products = 0,
    imageWork = 0,
    storedImages = 0;
  for (let cursor = 0; cursor < elements.length; cursor++) {
    work.check?.();
    for (const generator of group.generators) {
      work.check?.();
      if (products >= limits.maxProducts)
        throw new PermutationClosureLimitError(
          'permutation-closure-product-limit'
        );
      const width = Math.max(
        elements[cursor].supportDegree,
        generator.supportDegree
      );
      if (imageWork + width > limits.maxImageWork)
        throw new PermutationClosureLimitError(
          'permutation-closure-image-work-limit'
        );
      products++;
      imageWork += width;
      const candidate = composePermutations(elements[cursor], generator, work);
      const key = candidate.images.join(',');
      if (seen.has(key)) continue;
      // A full list may still complete when the remaining products are repeats.
      if (elements.length >= limits.maxElements)
        throw new PermutationClosureLimitError(
          'permutation-closure-element-limit'
        );
      if (storedImages + candidate.supportDegree > limits.maxStoredImages)
        throw new PermutationClosureLimitError(
          'permutation-closure-storage-limit'
        );
      storedImages += candidate.supportDegree;
      seen.add(key);
      elements.push(candidate);
    }
  }
  return elements;
}
