import { PermutationValue, PermutationInputError } from './values.js';
import { PermutationGroupValue, type PermutationGroupWork } from './groups.js';
import {
  PermutationStabilizerChain,
  permutationChainLimits,
  type PermutationChainLimits,
} from './stabilizer-chain.js';

/** Bounded reuse of completed certificates. The owner controls the session lifetime. */
export class PermutationQuerySession {
  readonly #chains = new Map<string, PermutationStabilizerChain>();
  #images = 0;

  chain(
    group: PermutationGroupValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ): PermutationStabilizerChain {
    const limits = permutationChainLimits(requested);
    if (!PermutationGroupValue.is(group))
      throw new PermutationInputError('invalid-permutation-group');
    const received = new PermutationGroupValue(
      group.generators,
      group.action,
      work
    );
    // All resource settings are part of the key. A warm query cannot bypass a
    // smaller work, storage, degree or generator bound supplied by its caller.
    const key = JSON.stringify([
      limits,
      work.maxDegree ?? null,
      work.maxGenerators ?? null,
      work.maxGeneratorImages ?? null,
      received.action.degree,
      received.generators.map((g) => g.images),
    ]);
    work.check?.();
    const cached = this.#chains.get(key);
    if (cached) {
      this.#chains.delete(key);
      this.#chains.set(key, cached);
      return cached;
    }
    const chain = PermutationStabilizerChain.compute(received, limits, work);
    if (key.length <= 100000 && chain.storedImagesCharged <= 1000000) {
      while (
        this.#chains.size >= 8 ||
        this.#images + chain.storedImagesCharged > 1000000
      ) {
        const oldest = this.#chains.keys().next().value!;
        this.#images -= this.#chains.get(oldest)!.storedImagesCharged;
        this.#chains.delete(oldest);
      }
      this.#chains.set(key, chain);
      this.#images += chain.storedImagesCharged;
    }
    return chain;
  }

  order(
    group: PermutationGroupValue,
    limits: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ): bigint {
    return this.chain(group, limits, work).order;
  }

  contains(
    group: PermutationGroupValue,
    value: PermutationValue,
    limits: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ): boolean {
    const bounds = permutationChainLimits(limits);
    const chain = this.chain(group, bounds, work);
    // Reserve construction's logical cost even on cache hits, so a query's
    // success under its declared budget does not depend on cache warmth.
    return chain.sift(
      value,
      {
        ...bounds,
        maxWork: bounds.maxWork - chain.workUsed,
        maxStoredImages: bounds.maxStoredImages - chain.storedImagesCharged,
      },
      work
    ).member;
  }
}
