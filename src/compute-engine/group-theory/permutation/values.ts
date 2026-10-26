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

export const PERMUTATION_DOMAIN = Object.freeze({
  kind: 'positive-integer-permutations' as const,
  version: 1 as const,
});

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

function tick(i: number, work: PermutationWork): void {
  if ((i & 1023) === 0) work.check?.();
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new PermutationInputError('invalid-permutation-descriptor');
  return value as Record<string, unknown>;
}

function readDescriptor(
  value: unknown,
  kind: string,
  payload: string
): Record<string, unknown> {
  const data = record(value);
  const domain = record(data.domain);
  if (
    data.kind !== kind ||
    data.version !== 1 ||
    domain.kind !== PERMUTATION_DOMAIN.kind ||
    domain.version !== 1 ||
    Object.keys(domain).some((k) => k !== 'kind' && k !== 'version') ||
    Object.keys(data).some(
      (k) => !['kind', 'version', 'domain', payload].includes(k)
    )
  )
    throw new PermutationInputError('incompatible-permutation-domain');
  return data;
}
/** An immutable bijection with finite support on the positive integers. */
export class PermutationValue {
  readonly #images: readonly number[];

  constructor(images: unknown, work: PermutationWork = {}) {
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
    this.#images = Object.freeze(copy);
    Object.freeze(this);
  }

  static is(value: unknown): value is PermutationValue {
    return typeof value === 'object' && value !== null && #images in value;
  }

  get images(): readonly number[] {
    return this.#images;
  }
  get domain(): typeof PERMUTATION_DOMAIN {
    return PERMUTATION_DOMAIN;
  }
  get supportDegree(): number {
    return this.#images.length;
  }

  toJSON() {
    return {
      kind: 'permutation',
      version: 1,
      domain: PERMUTATION_DOMAIN,
      images: this.#images,
    };
  }

  static fromJSON(
    value: unknown,
    work: PermutationWork = {}
  ): PermutationValue {
    const data = readDescriptor(value, 'permutation', 'images');
    return new PermutationValue(data.images, work);
  }
}

/** The finite action retains fixed points removed from element storage. */
export class PermutationAction {
  readonly #degree: number;
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
    this.#degree = degree;
    Object.freeze(this);
  }
  static is(value: unknown): value is PermutationAction {
    return typeof value === 'object' && value !== null && #degree in value;
  }
  toJSON() {
    return {
      kind: 'permutation-action',
      version: 1,
      domain: PERMUTATION_DOMAIN,
      degree: this.#degree,
    };
  }
  static fromJSON(
    value: unknown,
    work: PermutationWork = {}
  ): PermutationAction {
    const data = readDescriptor(value, 'permutation-action', 'degree');
    return new PermutationAction(data.degree, work);
  }
  get degree(): number {
    return this.#degree;
  }
  get domain(): typeof PERMUTATION_DOMAIN {
    return PERMUTATION_DOMAIN;
  }
}

function requirePermutation(
  value: unknown,
  work: PermutationWork
): asserts value is PermutationValue {
  if (!PermutationValue.is(value))
    throw new PermutationInputError('incompatible-permutation-domain');
  if (value.supportDegree > degreeLimit(work))
    throw new PermutationInputError('permutation-degree-limit');
  work.check?.();
}

export function assertPermutationFits(
  value: PermutationValue,
  action: PermutationAction,
  work: PermutationWork = {}
): void {
  requirePermutation(value, work);
  if (!PermutationAction.is(action))
    throw new PermutationInputError('incompatible-permutation-domain');
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
  requirePermutation(left, work);
  requirePermutation(right, work);
  const n = Math.max(left.supportDegree, right.supportDegree);
  const images: number[] = [];
  for (let i = 1; i <= n; i++) {
    tick(i, work);
    const middle = left.images[i - 1] ?? i;
    images.push(right.images[middle - 1] ?? middle);
  }
  return new PermutationValue(images, work);
}

export function inversePermutation(
  value: PermutationValue,
  work: PermutationWork = {}
): PermutationValue {
  requirePermutation(value, work);
  const images = new Array<number>(value.supportDegree);
  for (let i = 0; i < value.supportDegree; i++) {
    tick(i, work);
    images[value.images[i] - 1] = i + 1;
  }
  return new PermutationValue(images, work);
}

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
