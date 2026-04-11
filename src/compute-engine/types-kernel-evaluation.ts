/**
 * Types associated with the evaluation (and more generally manipulation) of Expressions in the
 * context of a ComputeEngine instance.
 *
 * These are 'kernel' types which do not make assumptions about the shape of for example Expression
 * and ComputeEngine where these are used.
 * To be imported only by other 'types-*' files.
 */
import type { MathJsonSymbol } from '../math-json';
import type { TypeReference } from '../common/type/types';
import type { BoxedType } from '../common/type/boxed-type';
import type { LatexString } from './latex-syntax/types';
import type {
  BoxedSubstitution,
  CanonicalOptions,
  PatternMatchOptions,
  ReplaceOptions,
} from './types-kernel-serialization';

/** @category Assumptions */
export interface Assumption<Expr = unknown, CE = unknown> {
  isPositive: boolean | undefined;
  isNonNegative: boolean | undefined;
  isNegative: boolean | undefined;
  isNonPositive: boolean | undefined;

  isNumber: boolean | undefined;
  isInteger: boolean | undefined;
  isRational: boolean | undefined;
  isReal: boolean | undefined;
  isComplex: boolean | undefined;
  isImaginary: boolean | undefined;

  isFinite: boolean | undefined;
  isInfinite: boolean | undefined;
  isNaN: boolean | undefined;
  isZero: boolean | undefined;

  matches(t: BoxedType): boolean | undefined;

  isGreater(other: Expr): boolean | undefined;
  isGreaterEqual(other: Expr): boolean | undefined;
  isLess(other: Expr): boolean | undefined;
  isLessEqual(other: Expr): boolean | undefined;
  isEqual(other: Expr): boolean | undefined;

  toExpression(ce: CE, x: MathJsonSymbol): Expr;
}

/** @category Assumptions */
export interface ExpressionMapInterface<U, Expr = unknown> {
  has(expr: Expr): boolean;
  get(expr: Expr): U | undefined;
  set(expr: Expr, value: U): void;
  delete(expr: Expr): void;
  clear(): void;
  [Symbol.iterator](): IterableIterator<[Expr, U]>;
  entries(): IterableIterator<[Expr, U]>;
}

/** @category Assumptions */
export type AssumeResult =
  | 'internal-error'
  | 'not-a-predicate'
  | 'contradiction'
  | 'tautology'
  | 'ok';

/** Options for `Expression.evaluate()`
 *
 * @category Boxed Expression
 */
export type EvaluateOptions = {
  /**
   * If `true`, the evaluation returns a numeric approximation of the expression,
   * when possible.
   *
   * If `false`, the evaluation returns an exact value, when possible.
   *
   * **Default**: `false`
   */
  numericApproximation: boolean;

  /**
   * If `false`, and the result is a lazy collection, the collection remains
   * lazy and is not materialized.
   *
   * If `true`, and the collection is finite, it is fully materialized.
   *
   * If an integer, evaluate at most that many elements.
   *
   * If a pair of integers `[n, m]`, and the collection is finite, evaluate
   * the first `n` and last `m` elements.
   *
   * **Default**: `false`
   */
  materialization: boolean | number | [number, number];

  /** Cancellation signal for long-running evaluations. */
  signal: AbortSignal;
};

/** Options for `Expression.simplify()`
 *
 * @category Boxed Expression
 */

export type SimplifyOptions<
  Expr = unknown,
  SemiExpr = unknown,
  CE = unknown,
> = {
  /**
   * The set of rules to apply. If `null`, use no rules. If not provided,
   * use the default simplification rules.
   */
  rules?:
    | null
    | Rule<Expr, SemiExpr, CE>
    | ReadonlyArray<BoxedRule<Expr, CE> | Rule<Expr, SemiExpr, CE>>
    | BoxedRuleSet<Expr, CE>;

  /**
   * Use this cost function to determine if a simplification is worth it.
   *
   * If not provided, `ce.costFunction`, the cost function of the engine is
   * used.
   */
  costFunction?: (expr: Expr) => number;

  /**
   * The simplification strategy to use.
   *
   * - `'default'`: Use standard simplification rules (default)
   * - `'fu'`: Use the Fu algorithm for trigonometric simplification.
   *   This is more aggressive for trig expressions and may produce
   *   different results than the default strategy.
   *
   *   **Note:** When using the `'fu'` strategy, the `costFunction` and `rules`
   *   options are ignored. The Fu algorithm uses its own specialized cost
   *   function that prioritizes minimizing the number of trigonometric
   *   functions. Standard simplification is applied before and after the
   *   Fu transformations using the engine's default rules.
   */
  strategy?: 'default' | 'fu';
};

/**
 * Given an expression and set of wildcards, return a replacement expression.
 *
 * @category Rules
 */
export type RuleReplaceFunction<Expr = unknown> = (
  expr: Expr,
  wildcards: BoxedSubstitution<Expr>
) => Expr | undefined;

export type MatchConditionFunction<Expr = unknown> = (expr: Expr) => boolean;

/**
 * Check whether the wildcards of a successful pattern match satisfy a custom condition.
 *
 * @category Rules */
export type RuleConditionFunction<Expr = unknown, CE = unknown> = (
  wildcards: BoxedSubstitution<Expr>,
  ce: CE
) => boolean;

/** @category Rules */
export type RuleFunction<Expr = unknown> = (
  expr: Expr
) => undefined | Expr | RuleStep<Expr>;

/** @category Rules */
export type RuleStep<Expr = unknown> = {
  value: Expr;
  because: string; // id of the rule
};

/** @category Rules */
export type RuleSteps<Expr = unknown> = RuleStep<Expr>[];

/**
 * A rule describes how to transform an expression matching `match`
 * into a new expression produced by `replace`.
 *
 * - `x-1` \( \to \) `1-x`
 * - `(x+1)(x-1)` \( \to \) `x^2-1`
 *
 * Match and replace patterns can be provided as LaTeX strings or expressions.
 * Rules can also be implemented with callback functions.
 *
 * ## Wildcards
 *
 * In expression patterns:
 * - `_` matches one expression.
 * - `_x`, `_a`, ... match one expression and bind it by name.
 * - `__x` matches one or more expressions.
 * - `___x` matches zero or more expressions.
 *
 * ## Variations
 *
 * If `useVariations` is true, rules may match equivalent variants
 * (for example matching `x` against `a + x`).
 *
 * @category Rules
 */
export type Rule<Expr = unknown, SemiExpr = unknown, CE = unknown> =
  | string
  | RuleFunction<Expr>
  | {
      match?: LatexString | SemiExpr | Expr;
      replace:
        | LatexString
        | SemiExpr
        | RuleReplaceFunction<Expr>
        | RuleFunction<Expr>;
      /** Do the matched wildcards meet this condition? */
      condition?: LatexString | RuleConditionFunction<Expr, CE>;
      useVariations?: boolean;
      id?: string;
      onBeforeMatch?: (rule: Rule<Expr, SemiExpr, CE>, expr: Expr) => void;
      onMatch?: (
        rule: Rule<Expr, SemiExpr, CE>,
        expr: Expr,
        replace: Expr | RuleStep<Expr>
      ) => void;
    };

/** @category Rules */
export type BoxedRule<Expr = unknown, CE = unknown> = {
  readonly _tag: 'boxed-rule';

  match: undefined | Expr;

  replace: Expr | RuleReplaceFunction<Expr> | RuleFunction<Expr>;

  condition: undefined | RuleConditionFunction<Expr, CE>;

  useVariations?: boolean;
  id?: string;
  onBeforeMatch?: (rule: Rule<Expr, unknown, CE>, expr: Expr) => void;
  onMatch?: (
    rule: Rule<Expr, unknown, CE>,
    expr: Expr,
    replace: Expr | RuleStep<Expr>
  ) => void;
};

/** @category Rules */
export type BoxedRuleSet<Expr = unknown, CE = unknown> = {
  rules: ReadonlyArray<BoxedRule<Expr, CE>>;
};

/**
 * The argument of `ce.assign()` can be a primitive, an expression,
 * or a function that computes an expression from arguments.
 *
 * @category Compute Engine
 */
export type AssignValue<Expr = unknown, SemiExpr = unknown, CE = unknown> =
  | boolean
  | number
  | bigint
  | SemiExpr
  | ((
      args: ReadonlyArray<Expr>,
      options: EvaluateOptions & { engine: CE }
    ) => Expr)
  | undefined;

/** @category Definitions */
export type Scope<Binding = unknown> = {
  parent: Scope<Binding> | null;
  bindings: Map<string, Binding>;
  types?: Record<string, TypeReference>;
  /** When true, auto-declarations during canonicalization are promoted to parent scope. */
  noAutoDeclare?: boolean;
};

/** @category Compute Engine */
export type EvalContext<Expr = unknown, Binding = unknown> = {
  lexicalScope: Scope<Binding>;
  assumptions: ExpressionMapInterface<boolean, Expr>;
  name: undefined | string;
};

/** Kernel-options for `Expression.transform()`
 *
 * @category Boxed Expression
 */
export type TransformOptions<
  Expr = unknown,
  SemiExpr = unknown,
  CE = unknown,
> = BaseTransformOptions<Expr, SemiExpr> &
  (
    | ReplaceTransformOptions<Expr>
    | CanonicalTransformOptions
    | StructuralTransformOptions
    | EvaluateTransformOptions
    | SimplifyTransformOptions<Expr, SemiExpr, CE>
  );

/** Available transformation types for `Expression.transform()`
 *
 * @category Boxed Expression */
export type Transformation =
  | 'structural'
  | 'canonical'
  | 'evaluate'
  | 'N'
  | 'simplify'
  | 'replace';

interface BaseTransformOptions<Expr = unknown, SemiExpr = unknown> {
  /** The specified transformation type. */
  type: string;

  /** Test candidate transform targets against a *pattern* (may contain wildcards); in contrast to
   * that of `'targets'.
   *
   * Specify an object to specify a pattern alongside applicable {@linkcode MatchOptions} (e.g.
   * `useVariations`, `matchPermutations`...), or a condition for testing wildcards
   *
   * Match-options assume `PatternMatchOptions` *defaults* in their absence.
   *
   * A *condition* may also be specified for vetting captured 'wildcards'
   *
   * (Mutually exclusive with `'targets'`). */
  match?: SemiExpr | LatexString | TransformMatchOptions<Expr, SemiExpr>;

  /** Specify *exact* (referential-identity) transformation targets (sub-expressions), or specify a
   * predicate for matching. Mutually exclusive with 'match' (pattern-based targeting).
   *
   * ::Note
   * The 'extended' matching routes available here are unique to *transform()* and facilitate
   * convenient and more expressive matching in the context of recursive traversal.*/
  targets?: Expr | Expr[] | MatchConditionFunction<Expr>;

  /** The _traversal_ direction for matching and therefore replacements (transformations) targets (**Default**: '*left-right*') */
  direction?: ReplaceOptions['direction'];
}

/** Specify a match-condition alongside an optional condition (usually specifiable only in context of
 * 'replace'), and 'transform'-applicable match options. */
type TransformMatchOptions<Expr = unknown, SemiExpr = unknown> = {
  pattern: LatexString | SemiExpr;
  condition?: LatexString | RuleConditionFunction<Expr>;
} & Pick<
  PatternMatchOptions<Expr>,
  'useVariations' | 'matchPermutations' | 'matchMissingTerms'
>;

/** Options for standard 'replace'.
 * Note that in the absence of a specified 'form', the default `expr.replace()` 'form'-computation
 * procedure is used (dependent on form of input; and recursive transformation of operands).
 */
interface ReplaceTransformOptions<Expr> extends Partial<
  Pick<ReplaceOptions, 'form'>
> {
  type: 'replace';

  /** Replace matched transformation targets using either a `LatexString`, `Expression`,
   * `RuleFunction`, or `RuleReplaceFunction`.
   *
   * Beware that *wildcards* in a given replacement only apply for standard pattern-matching
   * (non-available if matching with 'targets').
   */
  replace: Expr | LatexString | RuleReplaceFunction<Expr> | RuleFunction<Expr>;
}

interface CanonicalTransformOptions {
  type: 'canonical';

  /** The applied canonicalization degree (must have a 'degree' (fully-canonical or a
   * `CanonicalForm`)): inline with the aim of this transformation. */
  canonical: Exclude<CanonicalOptions, false>;
}

interface StructuralTransformOptions {
  type: 'structural';
}

interface EvaluateTransformOptions {
  type: 'evaluate' | 'N';
  // @note: only 'materialization' is relevant, because 'numericApproximation' decided by 'type'; and
  // 'signal' applicable only to an async call.

  evalOptions?: Pick<Partial<EvaluateOptions>, 'materialization'>;
}

interface SimplifyTransformOptions<Expr, SemiExpr, CE> {
  type: 'simplify';
  simplifyOptions?: SimplifyOptions<Expr, SemiExpr, CE>;
}
