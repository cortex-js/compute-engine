import type { Expression, ExpressionInput } from './types-expression';

import type {
  BoxedSubstitution as KernelBoxedSubstitution,
  CanonicalForm,
  CanonicalOptions,
  FormOption,
  Hold,
  JsonSerializationOptions,
  Metadata,
  PatternMatchOptions as KernelPatternMatchOptions,
  ReplaceOptions,
  Substitution as KernelSubstitution,
} from './types-kernel-serialization';

export type {
  Hold,
  JsonSerializationOptions,
  ReplaceOptions,
  CanonicalForm,
  CanonicalOptions,
  FormOption,
  Metadata,
};

/**
 * A substitution describes the values of the wildcards in a pattern so that
 * the pattern is equal to a target expression.
 *
 * A substitution can also be considered a more constrained version of a
 * rule whose `match` is always a symbol.
 *
 * @category Pattern Matching
 */
export type Substitution<T = ExpressionInput> = KernelSubstitution<T>;

/**
 * @category Pattern Matching
 */
export type BoxedSubstitution<T = Expression> = KernelBoxedSubstitution<T>;

/**
 * Control how a pattern is matched to an expression.
 *
 * @category Pattern Matching
 */
export type PatternMatchOptions<T = Expression> =
  KernelPatternMatchOptions<T>;
