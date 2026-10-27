import {
  PermutationAction,
  PermutationValue,
  PermutationInputError,
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
  // Recheck receiving limits even for an already validated host descriptor.
  const validated = new PermutationGroupValue(
    group.generators,
    group.action,
    work
  );
  const elements: PermutationValue[] = [PermutationValue.fromImages([], work)];
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
  return elements;
}
