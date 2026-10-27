// Products and inverses of valid bijections are bijections; only this module can
// construct them without revalidating each image.
let fromValidatedImages: (images: number[]) => PermutationValue;

/** Bounds for explicit image arrays; this is not a group-order limit. */
export const DEFAULT_PERMUTATION_DEGREE_LIMIT = 100_000;

export interface PermutationWork {
  readonly maxDegree?: number;
  /** Caller cancellation must propagate unchanged. */
  readonly check?: () => void;
}

export class PermutationInputError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationInputError';
  }
}

/** Bound allocation before reading external images; a degree bound is not an order bound. */
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

/** Poll long image walks at bounded intervals without a callback on every point. */
function tick(i: number, work: PermutationWork): void {
  if ((i & 1023) === 0) work.check?.();
}

/** An readonly bijection with finite support on the positive integers. */
export class PermutationValue {
  readonly images: readonly number[];

  private constructor(images: number[]) {
    while (images.length && images[images.length - 1] === images.length)
      images.pop();
    this.images = images;
  }
  static {
    fromValidatedImages = (images) => new PermutationValue(images);
  }

  /** Validate external images once in O(n), copying them before normalization. */
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

  get supportDegree(): number {
    return this.images.length;
  }
}

/** The finite action retains fixed points removed from element storage. */
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

/** Apply receiving degree policy without rechecking an internal bijection. */
function requirePermutation(
  value: PermutationValue,
  work: PermutationWork
): void {
  if (value.supportDegree > degreeLimit(work))
    throw new PermutationInputError('permutation-degree-limit');
  work.check?.();
}

/** The action must include every moved point; trailing fixed points are implicit. */
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

/** Right action: i^(left*right) = (i^left)^right. */
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
    const middle = left.images[i - 1] ?? i;
    images.push(right.images[middle - 1] ?? middle);
  }
  return fromValidatedImages(images);
}

/** Reverse the image map in O(n); bijectivity assigns each inverse slot exactly once. */
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

/** Apply a valid permutation to a point in the explicit action, in constant time. */
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
