import { PermutationValue } from './values.js';
import { PermutationGroupValue, type PermutationGroupWork } from './groups.js';
import {
  PermutationStabilizerChain,
  permutationChainLimits,
  permutationGroupRelation,
  permutationPointStabilizer,
  type PermutationChainLimits,
} from './stabilizer-chain.js';

/**
 * Bounded reuse of completed stabilizer chains. The owner controls the session lifetime.
 *
 * A stabilizer chain (built by Schreier-Sims) is the costly part of the
 * order, membership, stabilizer and subgroup queries. This class keeps the
 * completed chains of recent queries so that a later query on the same
 * group can use them again. The MathJSON adapter makes one session for each
 * engine that loads the library. The kernel functions do not import this
 * class: they receive `chain()` as an optional provider function.
 *
 * Memory bound: at most 8 chains, and at most 1,000,000 stored images in
 * total, counted with the `storedImagesCharged` value of each chain. When a
 * new chain does not fit, the least recently used chains are removed first.
 * A chain is not kept when its key is longer than 100,000 characters or when
 * it alone charges more than 1,000,000 images.
 *
 * A cached chain gives the same result as a new one. The callers charge the
 * work of the chain (`workUsed`) to the query budget also when the chain
 * comes from the cache, so a query reaches a limit or not independently of
 * the cache.
 */
export class PermutationQuerySession {
  /** Completed chains by key, in order of last use (oldest first). */
  readonly #chains = new Map<string, PermutationStabilizerChain>();
  /** Sum of `storedImagesCharged` over the chains in `#chains`. */
  #images = 0;

  /**
   * Return a completed chain for `group`, from the cache or new.
   *
   * The cache key holds what decides the chain itself:
   *
   * - the requested first base point (`firstBase`), because the stabilizer
   *   query puts that point first and reads the second level;
   * - the receiving degree and generator limits of `work`;
   * - the action degree and the image list of each generator, in order.
   *
   * The chain limits are not in the key, so a chain built by one query is
   * found by another query on the same group, also by a nested query that
   * passes its remaining budget. A cached chain is returned only when
   * `chain.fits(limits)`: a construction under `limits` would succeed and
   * give the same chain with the same costs. Otherwise the chain is built
   * again under `limits`, which gives the same answer or limit error as a
   * query without the cache. So a query with smaller limits does not get a
   * chain that it could not build itself, and the costs that the caller
   * charges for a cached chain are the costs of its own construction.
   *
   * Throws the kernel errors of `PermutationStabilizerChain.compute()` when
   * a limit is reached; a failed chain is not cached.
   */
  chain(
    group: PermutationGroupValue,
    requested: PermutationChainLimits,
    work: PermutationGroupWork = {},
    firstBase?: number
  ): PermutationStabilizerChain {
    const limits = permutationChainLimits(requested);
    // Check the group against the receiving limits of this caller, also when
    // the chain comes from the cache.
    const received = new PermutationGroupValue(
      group.generators,
      group.action,
      work
    );
    // The receiving policy is part of the key; the chain limits are checked
    // with `fits()` below. A warm query cannot bypass a smaller work,
    // storage, degree or generator bound supplied by its caller.
    const key = JSON.stringify([
      firstBase ?? null,
      work.maxDegree ?? null,
      work.maxGenerators ?? null,
      work.maxGeneratorImages ?? null,
      received.action.degree,
      received.generators.map((g) => g.images),
    ]);
    work.check?.();
    // A chain whose construction the storage limit changed (see
    // `storageLimited`) fits only its own limits. It is cached under a second
    // key that adds those limits, so that it does not replace the entry of
    // `key`, which fits more requests, and so that a repeated query with the
    // same small storage limit still finds it.
    const exactKey = key + JSON.stringify(limits);
    const touch = (entry: string) => {
      const value = this.#chains.get(entry);
      if (!value?.fits(limits)) return undefined;
      // Insert the entry again to mark it as the most recently used.
      this.#chains.delete(entry);
      this.#chains.set(entry, value);
      return value;
    };
    const hit = touch(key) ?? touch(exactKey);
    if (hit) return hit;
    // A cached chain that does not fit `limits` stays in the cache until a
    // new construction succeeds. A query whose limits are too small then
    // fails with its limit error and does not remove a chain that other
    // queries can use.
    const chain = PermutationStabilizerChain.compute(
      received,
      limits,
      work,
      firstBase
    );
    const target = chain.storageLimited ? exactKey : key;
    if (target.length <= 100000 && chain.storedImagesCharged <= 1000000) {
      // The new chain replaces a cached chain of the same key that did not
      // fit the limits of this query.
      const replaced = this.#chains.get(target);
      if (replaced) {
        this.#images -= replaced.storedImagesCharged;
        this.#chains.delete(target);
      }
      // Remove the oldest entries until there is space for one more chain
      // and for its images.
      while (
        this.#chains.size >= 8 ||
        this.#images + chain.storedImagesCharged > 1000000
      ) {
        const oldest = this.#chains.keys().next().value!;
        this.#images -= this.#chains.get(oldest)!.storedImagesCharged;
        this.#chains.delete(oldest);
      }
      this.#chains.set(target, chain);
      this.#images += chain.storedImagesCharged;
    }
    return chain;
  }

  /**
   * Reuse completed chains for both groups while preserving combined budgets.
   *
   * `permutationGroupRelation()` charges both chains and the membership
   * tests to one budget. See that function for the meaning of each `query`.
   */
  relation(
    parent: PermutationGroupValue,
    candidate: PermutationGroupValue,
    query: 'subgroup' | 'index' | 'equal' | 'normal',
    limits: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ) {
    return permutationGroupRelation(
      parent,
      candidate,
      query,
      limits,
      work,
      (group, requested, policy, base) =>
        this.chain(group, requested, policy, base)
    );
  }

  /**
   * A requested first base is part of the cache identity.
   *
   * The subgroup of `group` that fixes `point`. The chain is built with
   * `point` as its first base point, so its chain is cached apart from the
   * chain of an order or membership query on the same group.
   */
  stabilizer(
    group: PermutationGroupValue,
    point: number,
    limits: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ) {
    return permutationPointStabilizer(
      group,
      point,
      limits,
      work,
      (value, requested, policy, base) =>
        this.chain(value, requested, policy, base)
    );
  }

  /** The group order: the product of the orbit lengths of the chain levels. */
  order(
    group: PermutationGroupValue,
    limits: PermutationChainLimits,
    work: PermutationGroupWork = {}
  ): bigint {
    return this.chain(group, limits, work).order;
  }

  /**
   * Whether `value` is in `group`: sift `value` through the chain; it is a
   * member when the residue is the identity.
   */
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
