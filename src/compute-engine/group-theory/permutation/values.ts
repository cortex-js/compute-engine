/**
 * Permutation values for the group-theory kernel.
 *
 * This module holds the element representation (`PermutationValue`), the
 * finite set the elements act on (`PermutationAction`), the degree limit, and
 * the two basic operations, product and inverse. The other kernel modules
 * (`element-operations.ts`, `groups.ts`, `orbits.ts`, the stabilizer chain)
 * build on it. The kernel modules do not import the compute engine: they work
 * on plain arrays and integers.
 *
 * Validation happens once. `PermutationValue.fromImages()` checks external
 * data (for example the list read from a MathJSON `Permutation` expression)
 * and makes a copy. After that, the kernel trusts its own values: a product or
 * an inverse of two valid bijections is a bijection, so these results are
 * built without a second check.
 *
 * Conventions used in all the kernel modules:
 * - Points are the positive integers 1, 2, 3, ....
 * - A permutation is stored as an image array: `images[p - 1]` is the image
 *   of the point `p`.
 * - A point past the end of the array is fixed. The array never ends with a
 *   fixed point, so the identity is the empty array and two equal
 *   permutations have equal arrays.
 * - Products use the right action: `composePermutations(a, b)` applies `a`
 *   first and then `b`.
 */

// The trusted constructor. It is set in a static block of `PermutationValue`,
// so it can call the private constructor. It is not exported: only this
// module can make a value without the checks of `fromImages()`. Products and
// inverses of valid bijections are bijections, so they use it.
let fromValidatedImages: (images: number[]) => PermutationValue;

/**
 * The largest degree (the length of an image array, or the size of an
 * action) that the kernel accepts. It limits memory before an external array
 * is read. It does not limit the order of a group: a group of degree 100 can
 * have more than 10^150 elements.
 */
export const DEFAULT_PERMUTATION_DEGREE_LIMIT = 100_000;

/**
 * Options that the caller passes to every kernel operation.
 *
 * `maxDegree` lowers the degree limit for this call. It must be an integer
 * from 0 to `DEFAULT_PERMUTATION_DEGREE_LIMIT`.
 *
 * `check` is called at intervals during long loops. It can throw to cancel
 * the operation (for example on a timeout). The kernel does not catch this
 * error: it reaches the caller unchanged.
 */
export interface PermutationWork {
  readonly maxDegree?: number;
  /** Caller cancellation must propagate unchanged. */
  readonly check?: () => void;
}

/**
 * The error for invalid input or an exceeded degree limit. `code` is a
 * stable identifier such as `invalid-permutation-image` or
 * `permutation-degree-limit`, and is also the message. The library operators
 * convert it to an error expression.
 */
export class PermutationInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationInputError';
  }
}

/**
 * Return the degree limit for this call: `work.maxDegree`, or
 * `DEFAULT_PERMUTATION_DEGREE_LIMIT` when it is not given.
 *
 * Throws `invalid-permutation-degree-limit` when `maxDegree` is not a safe
 * integer, is negative, or is larger than the default. A caller can lower the
 * limit, but cannot raise it.
 *
 * Bound allocation before reading external images; a degree bound is not an
 * order bound.
 */
export function degreeLimit(work: PermutationWork = {}): number {
  const limit = work.maxDegree ?? DEFAULT_PERMUTATION_DEGREE_LIMIT;
  if (
    !Number.isSafeInteger(limit) ||
    limit < 0 ||
    limit > DEFAULT_PERMUTATION_DEGREE_LIMIT
  )
    throw new PermutationInputError('invalid-permutation-degree-limit');
  return limit;
}

/**
 * Poll long image walks at bounded intervals without a callback on every
 * point. `work.check` is called when the loop index is a multiple of 1024
 * (index 0 included).
 */
function tick(i: number, work: PermutationWork): void {
  if ((i & 1023) === 0) work.check?.();
}

/**
 * A readonly bijection with finite support on the positive integers.
 *
 * `images[p - 1]` is the image of the point `p`. Every point larger than
 * `images.length` is fixed. The constructor removes trailing fixed points,
 * so the last entry of a non-empty array is never equal to its own position.
 * Thus the identity has the empty array, and two values are the same
 * permutation exactly when their arrays are equal. Code that needs an
 * identity key (for example `enumeratePermutationGroup()`) uses
 * `images.join(',')`.
 *
 * A value does not know the size of the set it acts on: `[2, 1]` is the same
 * value in S2 and in S5. A `PermutationAction` supplies that size.
 *
 * There are two ways to make a value: `fromImages()`, which validates
 * external data, and the module-private `fromValidatedImages()`, which trusts
 * its argument.
 */
export class PermutationValue {
  readonly images: readonly number[];

  // Takes ownership of `images` and removes trailing fixed points in place.
  // The caller must pass a new array that is a valid bijection on 1..length.
  private constructor(images: number[]) {
    while (images.length && images[images.length - 1] === images.length)
      images.pop();
    this.images = images;
  }
  static {
    fromValidatedImages = (images) => new PermutationValue(images);
  }

  /**
   * Validate external images once in O(n), copying them before
   * normalization.
   *
   * `images` must be an array of length `n` that holds each integer from 1
   * to `n` exactly once. The input array is not changed and is not kept.
   *
   * Throws `PermutationInputError` with one of these codes:
   * - `invalid-permutation-degree-limit`: `work.maxDegree` is not valid.
   * - `expected-permutation-images`: `images` is not an array.
   * - `permutation-degree-limit`: `n` is larger than the degree limit. This
   *   check is done before any element is read.
   * - `invalid-permutation-image`: an entry is not a safe integer from 1 to
   *   `n`. A hole in a sparse array reads as `undefined` and fails here.
   * - `duplicate-permutation-image`: two entries are equal.
   *
   * Every entry is in 1..n and no entry repeats, so the array is a
   * bijection of 1..n.
   */
  static fromImages(
    images: unknown,
    work: PermutationWork = {}
  ): PermutationValue {
    const limit = degreeLimit(work);
    work.check?.();
    if (!Array.isArray(images))
      throw new PermutationInputError('expected-permutation-images');
    const length = images.length;
    if (length > limit)
      throw new PermutationInputError('permutation-degree-limit');
    const seen = new Uint8Array(length);
    const copy: number[] = [];
    for (let i = 0; i < length; i++) {
      tick(i, work);
      const point: unknown = images[i];
      if (
        typeof point !== 'number' ||
        !Number.isSafeInteger(point) ||
        point < 1 ||
        point > length
      )
        throw new PermutationInputError('invalid-permutation-image');
      if (seen[point - 1])
        throw new PermutationInputError('duplicate-permutation-image');
      seen[point - 1] = 1;
      copy.push(point);
    }
    while (copy.length && copy[copy.length - 1] === copy.length) {
      tick(copy.length, work);
      copy.pop();
    }
    return new PermutationValue(copy);
  }

  /**
   * The largest point that the permutation moves, or 0 for the identity.
   * This is the length of the stored image array, because the array has no
   * trailing fixed points. Points below it can also be fixed: `[1, 3, 2]`
   * has `supportDegree` 3 and fixes 1.
   */
  get supportDegree(): number {
    return this.images.length;
  }
}

/**
 * The finite action retains fixed points removed from element storage.
 *
 * A `PermutationAction` of degree `d` is the set of points 1..d. The degree
 * is part of a group: the orbits of a group on 1..5 include the fixed points
 * up to 5, which the image arrays of its elements do not record. A degree of
 * 0 (the empty set) is valid.
 *
 * Throws `PermutationInputError`:
 * - `invalid-permutation-action-degree` when `degree` is not a non-negative
 *   safe integer;
 * - `permutation-degree-limit` when `degree` is larger than the degree limit.
 */
export class PermutationAction {
  readonly degree: number;
  constructor(degree: unknown, work: PermutationWork = {}) {
    const limit = degreeLimit(work);
    work.check?.();
    if (
      typeof degree !== 'number' ||
      !Number.isSafeInteger(degree) ||
      degree < 0
    )
      throw new PermutationInputError('invalid-permutation-action-degree');
    if (degree > limit)
      throw new PermutationInputError('permutation-degree-limit');
    this.degree = degree;
  }
}

/**
 * Apply receiving degree policy without rechecking an internal bijection.
 *
 * A value can be valid under the default limit and still be too large for a
 * caller that passes a smaller `work.maxDegree`. This check is O(1): it reads
 * only `supportDegree`.
 */
function requirePermutation(
  value: PermutationValue,
  work: PermutationWork
): void {
  if (value.supportDegree > degreeLimit(work))
    throw new PermutationInputError('permutation-degree-limit');
  work.check?.();
}

/**
 * The action must include every moved point; trailing fixed points are
 * implicit.
 *
 * Accepts the value when `supportDegree <= action.degree`: `[2, 1]` fits an
 * action of degree 5, and `[1, 3, 2]` does not fit an action of degree 2.
 *
 * Throws `PermutationInputError`:
 * - `permutation-degree-limit` when the value or the action is larger than
 *   the degree limit of `work`;
 * - `permutation-outside-action` when the value moves a point larger than
 *   `action.degree`.
 */
export function assertPermutationFits(
  value: PermutationValue,
  action: PermutationAction,
  work: PermutationWork = {}
): void {
  requirePermutation(value, work);
  if (action.degree > degreeLimit(work))
    throw new PermutationInputError('permutation-degree-limit');
  if (value.supportDegree > action.degree)
    throw new PermutationInputError('permutation-outside-action');
}

/**
 * Right action: i^(left*right) = (i^left)^right.
 *
 * The product applies `left` first and then `right`. For example, with
 * `left = [2, 1]` (swap 1 and 2) and `right = [1, 3, 2]` (swap 2 and 3), the
 * point 1 goes to 2 under `left`, then to 3 under `right`, and the result is
 * `[3, 1, 2]`.
 *
 * Cost: O(n), where n is the larger `supportDegree`. A point past the end of
 * either array is fixed by that factor. The result is not validated again,
 * because a product of bijections is a bijection.
 *
 * This function does not check the degree limit of `work`. The caller
 * checks it when it receives the factors.
 */
export function composePermutations(
  left: PermutationValue,
  right: PermutationValue,
  work: PermutationWork = {}
): PermutationValue {
  work.check?.();
  const n = Math.max(left.supportDegree, right.supportDegree);
  const images: number[] = [];
  for (let i = 1; i <= n; i++) {
    tick(i, work);
    // `?? i` and `?? middle`: a point past the end of an array is fixed.
    const middle = left.images[i - 1] ?? i;
    images.push(right.images[middle - 1] ?? middle);
  }
  return fromValidatedImages(images);
}

/**
 * Reverse the image map in O(n); bijectivity assigns each inverse slot
 * exactly once.
 *
 * If `p` goes to `q`, the inverse sends `q` to `p`. The inverse has the same
 * `supportDegree` as the input, so the new array has no holes and no
 * trailing fixed point. Like `composePermutations()`, this function does not
 * check the degree limit of `work`.
 */
export function inversePermutation(
  value: PermutationValue,
  work: PermutationWork = {}
): PermutationValue {
  work.check?.();
  const images = new Array<number>(value.supportDegree);
  for (let i = 0; i < value.supportDegree; i++) {
    tick(i, work);
    images[value.images[i] - 1] = i + 1;
  }
  return fromValidatedImages(images);
}

/**
 * Apply a valid permutation to a point in the explicit action, in constant
 * time.
 *
 * Returns the image of `point`. A point in the action but past the end of
 * the image array is fixed, so it is returned unchanged.
 *
 * Throws `PermutationInputError`:
 * - the codes of `assertPermutationFits()` when the value or the action does
 *   not meet the limits;
 * - `point-outside-permutation-action` when `point` is not a safe integer
 *   from 1 to `action.degree`.
 */
export function applyPermutation(
  value: PermutationValue,
  point: unknown,
  action: PermutationAction,
  work: PermutationWork = {}
): number {
  assertPermutationFits(value, action, work);
  if (
    typeof point !== 'number' ||
    !Number.isSafeInteger(point) ||
    point < 1 ||
    point > action.degree
  )
    throw new PermutationInputError('point-outside-permutation-action');
  return value.images[point - 1] ?? point;
}
