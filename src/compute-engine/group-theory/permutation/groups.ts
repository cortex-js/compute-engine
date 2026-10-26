import {
  PermutationAction,
  PermutationValue,
  PermutationInputError,
  PERMUTATION_DOMAIN,
  degreeLimit,
  assertPermutationFits,
  composePermutations,
  type PermutationWork,
} from './values.js';

export interface PermutationGroupWork extends PermutationWork {
  readonly maxGenerators?: number;
  readonly maxGeneratorImages?: number;
}

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

/** A descriptor, not a canonical identity for the generated subgroup. */
export class PermutationGroupValue {
  readonly #generators: readonly PermutationValue[];
  readonly #action: PermutationAction;

  constructor(
    generators: unknown,
    action: PermutationAction,
    work: PermutationGroupWork = {}
  ) {
    const limits = permutationGroupLimits(work);
    work.check?.();
    if (!PermutationAction.is(action))
      throw new PermutationInputError('incompatible-permutation-domain');
    if (action.degree > degreeLimit(work))
      throw new PermutationInputError('permutation-degree-limit');
    if (!Array.isArray(generators))
      throw new PermutationInputError('expected-permutation-generators');
    const length = generators.length;
    if (length > limits.maxGenerators)
      throw new PermutationInputError('permutation-generator-limit');
    const copy: PermutationValue[] = [];
    let images = 0;
    for (let i = 0; i < length; i++) {
      work.check?.();
      const generator: unknown = generators[i];
      if (!PermutationValue.is(generator))
        throw new PermutationInputError('invalid-permutation-generator');
      assertPermutationFits(generator, action, work);
      images += generator.supportDegree;
      if (images > limits.maxGeneratorImages)
        throw new PermutationInputError('permutation-generator-image-limit');
      copy.push(generator);
    }
    // Preserve generator order and repetitions: they define the descriptor,
    // not a claim about a canonical or minimal generating set.
    this.#generators = Object.freeze(copy);
    this.#action = action;
    Object.freeze(this);
  }

  static is(value: unknown): value is PermutationGroupValue {
    return typeof value === 'object' && value !== null && #generators in value;
  }
  get generators(): readonly PermutationValue[] {
    return this.#generators;
  }
  get action(): PermutationAction {
    return this.#action;
  }
  get domain(): typeof PERMUTATION_DOMAIN {
    return PERMUTATION_DOMAIN;
  }

  toJSON() {
    return {
      kind: 'permutation-group',
      version: 1,
      action: this.#action.toJSON(),
      generators: this.#generators.map((x) => x.toJSON()),
    };
  }
  static fromJSON(
    value: unknown,
    work: PermutationGroupWork = {}
  ): PermutationGroupValue {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new PermutationInputError('invalid-permutation-group-descriptor');
    const data = value as Record<string, unknown>;
    if (
      data.kind !== 'permutation-group' ||
      data.version !== 1 ||
      Object.keys(data).some(
        (k) => !['kind', 'version', 'action', 'generators'].includes(k)
      )
    )
      throw new PermutationInputError('invalid-permutation-group-descriptor');
    const limits = permutationGroupLimits(work);
    const action = PermutationAction.fromJSON(data.action, work);
    if (!Array.isArray(data.generators))
      throw new PermutationInputError('expected-permutation-generators');
    const length = data.generators.length;
    if (length > limits.maxGenerators)
      throw new PermutationInputError('permutation-generator-limit');
    const generators: PermutationValue[] = [];
    let images = 0;
    for (let i = 0; i < length; i++) {
      work.check?.();
      const item: unknown = data.generators[i];
      if (
        item &&
        typeof item === 'object' &&
        'images' in item &&
        Array.isArray(item.images)
      ) {
        images += item.images.length;
        if (images > limits.maxGeneratorImages)
          throw new PermutationInputError('permutation-generator-image-limit');
      }
      generators.push(PermutationValue.fromJSON(item, work));
    }
    return new PermutationGroupValue(generators, action, work);
  }
}

export interface PermutationClosureLimits {
  readonly maxElements: number;
  readonly maxProducts: number;
  /** Sum of the image-array widths of attempted products. */
  readonly maxImageWork?: number;
  /** Sum of normalized image-array lengths retained in the result. */
  readonly maxStoredImages?: number;
}

/** Resource exhaustion carries no partial list or mathematical conclusion. */
export class PermutationClosureLimitError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'PermutationClosureLimitError';
  }
}

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
 */
export function enumeratePermutationGroup(
  group: PermutationGroupValue,
  requested: PermutationClosureLimits,
  work: PermutationGroupWork = {}
): readonly PermutationValue[] {
  const limits = permutationClosureLimits(requested);
  if (!PermutationGroupValue.is(group))
    throw new PermutationInputError('invalid-permutation-group');
  // Recheck receiving limits even for an already validated host descriptor.
  const validated = new PermutationGroupValue(
    group.generators,
    group.action,
    work
  );
  const elements: PermutationValue[] = [new PermutationValue([], work)];
  const seen = new Set<string>(['']);
  let products = 0,
    imageWork = 0,
    storedImages = 0;
  for (let cursor = 0; cursor < elements.length; cursor++) {
    work.check?.();
    for (const generator of validated.generators) {
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
  return Object.freeze(elements);
}
