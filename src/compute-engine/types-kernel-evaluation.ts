import type { MathJsonSymbol } from '../math-json.js';
import type { TypeReference } from '../common/type/types.js';
import type { BoxedType } from '../common/type/boxed-type.js';
import type { LatexString } from './latex-syntax/types.js';
import type { BoxedSubstitution } from './types-kernel-serialization.js';

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

/**
 * Given an expression and set of wildcards, return a replacement expression.
 *
 * @category Rules
 */
export type RuleReplaceFunction<Expr = unknown> = (
  expr: Expr,
  wildcards: BoxedSubstitution<Expr>
) => Expr | undefined;

/** @category Rules */
export type RuleConditionFunction<Expr = unknown, CE = unknown> = (
  wildcards: BoxedSubstitution<Expr>,
  ce: CE
) => boolean;

/** @category Rules */
export type RuleFunction<Expr = unknown> = (
  expr: Expr
) => undefined | Expr | RuleStep<Expr>;

/**
 * The purpose of a rule determines how its result is treated by
 * the simplification cost policy:
 *
 * - `'simplify'`: the result must pass the cost gate (the default;
 *   today's behavior — results that grow the expression are discarded).
 * - `'transform'`: a mathematically-preferred rewrite; exempt from the
 *   cost gate (accepted by `simplify()` even if structurally larger).
 * - `'expand'`: growth-by-design (series, argument expansion); skipped by
 *   `simplify()`, but reachable via `expr.replace()` and future expand APIs.
 *
 * @category Rules
 */
export type RulePurpose = 'simplify' | 'transform' | 'expand';

/** @category Rules */
export type RuleStep<Expr = unknown> = {
  value: Expr;
  because: string; // id of the rule
  /** The purpose of the rule that produced this step, stamped by
   * `applyRule` from the firing rule. */
  purpose?: RulePurpose;
};

/** @category Rules */
export type RuleSteps<Expr = unknown> = RuleStep<Expr>[];

/**
 * The operation that an `Explanation` traces. See `expr.explain()`.
 *
 * @category Rules
 */
export type ExplainOperation = 'simplify' | 'solve' | 'D';

/**
 * How much of the raw rule trace `expr.explain()` returns:
 *
 * - `'default'`: curated — bookkeeping steps (driver-internal markers) and
 *   no-op steps are filtered out.
 * - `'all'`: the raw, uncurated chain (for rule authors and debugging).
 *
 * @category Rules
 */
export type ExplainVerbosity = 'default' | 'all';

/**
 * One step of an `Explanation`: the expression state after the step was
 * applied, with a stable machine id and a default English description.
 *
 * The `id` is the public, frozen identifier of the rule or algorithmic
 * phase that produced the step; consumers key localization and custom copy
 * off it. See `expr.explain()`.
 *
 * @category Rules
 */
export type ExplainStep<Expr = unknown> = {
  /** The expression (or equation, for `solve`) after the step. */
  value: Expr;
  /** Stable machine id, e.g. `'power-of-product'`, `'fungrim:0010f3'`. */
  id: string;
  /** Default English description, e.g. `'Apply (ab)ⁿ = aⁿ·bⁿ'`. */
  description: string;
  /** The purpose of the rule that produced this step, if any. */
  purpose?: RulePurpose;
};

/**
 * A structured, JSON-able step-by-step explanation returned by
 * `expr.explain()`.
 *
 * @category Rules
 */
export type Explanation<Expr = unknown> = {
  operation: ExplainOperation;
  /** The canonical form of the expression `explain()` was called on: the
   * chain's step 0. */
  initial: Expr;
  /** The same value the plain method (`simplify()`, `solve()`, `D`)
   * returns. */
  result: Expr;
  steps: ExplainStep<Expr>[];
};

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
      condition?: LatexString | RuleConditionFunction<Expr, CE>;
      useVariations?: boolean;
      /** Dispatch hint: this rule can only ever apply to expressions whose
       *  operator is one of these. Used to index the rule; semantics are
       *  unchanged (the rule is simply never tried on other operators). */
      operators?: ReadonlyArray<string>;
      /** How the result of this rule is treated by the simplification cost
       *  policy. See {@linkcode RulePurpose}. **Default**: `'simplify'`. */
      purpose?: RulePurpose;
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
  /** Dispatch hint: this rule can only ever apply to expressions whose
   *  operator is one of these. Used to index the rule; semantics are
   *  unchanged (the rule is simply never tried on other operators). */
  operators?: ReadonlyArray<string>;
  /** How the result of this rule is treated by the simplification cost
   *  policy. See {@linkcode RulePurpose}. **Default**: `'simplify'`. */
  purpose?: RulePurpose;
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
      options: Partial<EvaluateOptions> & { engine: CE }
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
  /**
   * Names of symbols in this context whose *value* was installed by
   * `assume(x = …)` (as opposed to a user `declare()`/`assign()`). No-arg
   * `forget()` clears these value bindings — but must leave user-assigned
   * values intact — so their provenance is tracked here (SYM P2-10).
   */
  assumptionBindings?: Set<string>;
};
