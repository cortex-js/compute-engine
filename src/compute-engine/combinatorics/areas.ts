// The runtime shape of the combinatorics library: an area is a domain and its
// statistics. A statistic is a row of a source table (`sources/`, Epsil text,
// read only by `scripts/combinatorics/generate.ts`), compiled into `compiled.ts`,
// plus an optional kernel (`kernels.ts`); porting one adds a row, not code.

import type { MathJsonExpression } from '../../math-json/types.js';
import type { Kernel } from './kernels.js';

/** The areas a host can load. */
export type CombinatoricsArea = 'permutations' | 'partitions';

/**
 * What a statistic is defined on. The elements are the engine's own lists, so
 * a domain is a type over `list<integer>` plus a check for what a type cannot
 * say (see `docs/combinatorics/COMBINATORICS.md`).
 */
export interface Domain {
  /** FindStat's name for the collection, as a match record cites it. */
  readonly collection: string;
  /** The type name, declared as an alias of `list<integer>`. */
  readonly type: string;
  /** Whether the integers are a member: the exact domain the type only bounds. */
  readonly accepts: (values: readonly number[]) => boolean;
  /**
   * The group-theory constructor whose value is also read as an element, by its
   * image list (`Permutation([2, 1])`), or `undefined`.
   */
  readonly alsoReads?: string;
}

/**
 * One statistic as the runtime reads it: its head, its FindStat identifier (if
 * it has one), the compiled Epsil function literal, and an optional kernel.
 */
export interface Statistic {
  readonly head: string;
  /** The FindStat statistic with the same value on every element tried. */
  readonly findstat?: string;
  /** The meaning: the Epsil definition as a MathJSON function literal. */
  readonly literal: MathJsonExpression;
  /** Optional TypeScript version of the definition, held equal to it by a test. */
  readonly fast?: Kernel;
}

export interface Area {
  readonly name: CombinatoricsArea;
  readonly domain: Domain;
  readonly statistics: readonly Statistic[];
}
