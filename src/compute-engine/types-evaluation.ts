import type { MathJsonSymbol } from '../math-json';
import type { TypeReference } from '../common/type/types';
import type { BoxedType } from '../common/type/boxed-type';
import type { LatexString } from './latex-syntax/types';
import type { BoxedExpression, SemiBoxedExpression } from './types-expression';
import type { BoxedSubstitution } from './types-serialization';
import type { BoxedDefinition } from './types-definitions';
import type { IComputeEngine as ComputeEngine } from './types-engine';

/** @category Assumptions */
export interface Assumption {
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

  isGreater(other: BoxedExpression): boolean | undefined;
  isGreaterEqual(other: BoxedExpression): boolean | undefined;
  isLess(other: BoxedExpression): boolean | undefined;
  isLessEqual(other: BoxedExpression): boolean | undefined;
  isEqual(other: BoxedExpression): boolean | undefined;

  toExpression(ce: ComputeEngine, x: MathJsonSymbol): BoxedExpression;
}

/** @category Assumptions */
export interface ExpressionMapInterface<U> {
  has(expr: BoxedExpression): boolean;
  get(expr: BoxedExpression): U | undefined;
  set(expr: BoxedExpression, value: U): void;
  delete(expr: BoxedExpression): void;
  clear(): void;
  [Symbol.iterator](): IterableIterator<[BoxedExpression, U]>;
  entries(): IterableIterator<[BoxedExpression, U]>;
}

/** @category Assumptions */
export type AssumeResult =
  | 'internal-error'
  | 'not-a-predicate'
  | 'contradiction'
  | 'tautology'
  | 'ok';

/** Options for `BoxedExpression.evaluate()`
 *
 * @category Boxed Expression
 */
export type EvaluateOptions = {
  /**
   * If `true`, the evaluation will return a numeric approximation
   * of the expression, if possible.
   * If `false`, the evaluation will return an exact value, if possible.
   * Defaults to `false`.
   */
  numericApproximation: boolean;
  /**
   * If `false`, and the result of the expression is a lazy collection,
   * the collection will not be evaluated and will remain lazy.
   *
   * If `true` and the expression is a finite lazy collection,
   * the collection will be evaluated and returned as a non-lazy collection.
   *
   * If an integer, the collection will be evaluated up to that many elements.
   *
   * If a pair of integers `[n,m]`, and the collection is finite, the first `n`
   * elements will be evaluated, and the last `m` elements will be evaluated.
   *
   * Defaults to `false`.
   */
  materialization: boolean | number | [number, number];
  signal: AbortSignal;
  withArguments: Record<MathJsonSymbol, BoxedExpression>;
};

/**
 * Given an expression and set of wildcards, return a new expression.
 *
 * For example:
 *
 * ```ts
 * {
 *    match: '_x',
 *    replace: (expr, {_x}) => { return ['Add', 1, _x] }
 * }
 * ```
 *
 * @category Rules */
export type RuleReplaceFunction = (
  expr: BoxedExpression,
  wildcards: BoxedSubstitution
) => BoxedExpression | undefined;

/** @category Rules */
export type RuleConditionFunction = (
  wildcards: BoxedSubstitution,
  ce: ComputeEngine
) => boolean;

/** @category Rules */
export type RuleFunction = (
  expr: BoxedExpression
) => undefined | BoxedExpression | RuleStep;

/** @category Rules */
export type RuleStep = {
  value: BoxedExpression;
  because: string; // id of the rule
};

/** @category Rules */
export type RuleSteps = RuleStep[];

/**
 * A rule describes how to modify an expression that matches a pattern `match`
 * into a new expression `replace`.
 *
 * - `x-1` \( \to \) `1-x`
 * - `(x+1)(x-1)` \( \to \) `x^2-1`
 *
 * The patterns can be expressed as LaTeX strings or `SemiBoxedExpression`'s.
 * Alternatively, match/replace logic may be specified by a `RuleFunction`, allowing both custom
 * logic/conditions for the match, and either a *BoxedExpression* (or `RuleStep` if being
 * descriptive) for the replacement.
 *
 * As a shortcut, a rule can be defined as a LaTeX string: `x-1 -> 1-x`.
 * The expression to the left of `->` is the `match` and the expression to the
 * right is the `replace`. When using LaTeX strings, single character variables
 * are assumed to be wildcards. The rule LHS ('match') and RHS ('replace') may also be supplied
 * separately: in this case following the same rules.
 *
 * When using MathJSON expressions, anonymous wildcards (`_`) will match any
 * expression. Named wildcards (`_x`, `_a`, etc...) will match any expression
 * and bind the expression to the wildcard name.
 *
 * In addition the sequence wildcard (`__1`, `__a`, etc...) will match
 * a sequence of one or more expressions, and bind the sequence to the
 * wildcard name.
 *
 * Sequence wildcards are useful when the number of elements in the sequence
 * is not known in advance. For example, in a sum, the number of terms is
 * not known in advance. ["Add", 0, `__a`] will match two or more terms and
 * the `__a` wildcard will be a sequence of the matchign terms.
 *
 * If `exact` is false, the rule will match variants.
 *
 * For example 'x' will match 'a + x', 'x' will match 'ax', etc...
 *
 * For simplification rules, you generally want `exact` to be true, but
 * to solve equations, you want it to be false. Default to true.
 *
 * When set to false, infinite recursion is possible.
 *
 * @category Rules
 */

export type Rule =
  | string
  | RuleFunction
  | {
      match?: LatexString | SemiBoxedExpression | BoxedExpression;
      replace:
        | LatexString
        | SemiBoxedExpression
        | RuleReplaceFunction
        | RuleFunction;
      condition?: LatexString | RuleConditionFunction;
      useVariations?: boolean; // Default to false
      id?: string; // Optional, for debugging or filtering
      onBeforeMatch?: (rule: Rule, expr: BoxedExpression) => void;
      onMatch?: (
        rule: Rule,
        expr: BoxedExpression,
        replace: BoxedExpression | RuleStep
      ) => void; // For debugging, called when rule matches
    };

/**
 *
 * If the `match` property is `undefined`, all expressions match this rule
 * and `condition` should also be `undefined`. The `replace` property should
 * be a `BoxedExpression` or a `RuleFunction`, and further filtering can be
 * done in the `replace` function.
 *
 * @category Rules
 */
export type BoxedRule = {
  /** @internal */
  readonly _tag: 'boxed-rule';

  match: undefined | BoxedExpression;

  replace: BoxedExpression | RuleReplaceFunction | RuleFunction;

  condition: undefined | RuleConditionFunction;

  useVariations?: boolean; // If true, the rule will match variations, for example
  // 'x' will match 'a + x', 'x' will match 'ax', etc...
  // Default to false.

  id?: string; // For debugging

  onBeforeMatch?: (rule: Rule, expr: BoxedExpression) => void;
  onMatch?: (
    rule: Rule,
    expr: BoxedExpression,
    replace: BoxedExpression | RuleStep
  ) => void; // For debugging, called when rule matches
};

/**
 * To create a BoxedRuleSet use the `ce.rules()` method.
 *
 * Do not create a `BoxedRuleSet` directly.
 *
 * @category Rules
 */
export type BoxedRuleSet = { rules: ReadonlyArray<BoxedRule> };

/**
 * The argument of `ce.assign()` is a value that can be assigned to a variable.
 * It can be a primitive value, a boxed expression, or a function that
 * takes a list of arguments and returns a boxed expression.
 * @category Compute Engine */
export type AssignValue =
  | boolean
  | number
  | bigint
  | SemiBoxedExpression
  | ((
      args: ReadonlyArray<BoxedExpression>,
      options: EvaluateOptions & { engine: ComputeEngine }
    ) => BoxedExpression)
  | undefined;

/**
 * A lexical scope is a table mapping symbols to their definitions. The
 * symbols are the names of the variables, unknowns and functions in the scope.
 *
 * The lexical scope is used to resolve the metadata about symbols, such as
 * their type, whether they are constant, etc...
 *
 * It does not resolve the values of the symbols, since those depend on the
 * evaluation context. For example, the local variables of a recursive function
 * will have the same lexical scope, but different values in each evaluation
 * context.
 *
 * @category Definitions
 */
export type Scope = {
  parent: Scope | null;
  bindings: Map<string, BoxedDefinition>;
  types?: Record<string, TypeReference>;
};

/**
 * An evaluation context is a set of bindings mapping symbols to their
 * values. It also includes a reference to the lexical scope of the
 * context, as well as a set of assumptions about the values of the
 * symbols.
 *
 *
 * Eval contexts are arranged in a stack structure. When a new context is
 * created, it is pushed on the top of the stack.
 *
 * A new eval context is created when a function expression that needs to track
 * its own local variables and named arguments is evaluated. This kind of
 * function is a "scoped" function, meaning that it has its own local variables
 * and named arguments.
 *
 * For example, the `Sum` function creates a new eval context to track the local
 * variable used as the index of the sum.
 *
 * The eval context stack is used to resolve the value of symbols.
 *
 * When a scoped recursive function is called, a new context is created for each
 * recursive call.
 *
 * In contrast, the lexical scope is used to resolve the metadata about
 * symbols, such as their type, whether they are constant, etc... A new
 * scope is not created for recursive calls, since the metadata
 * does not change, only the values of the symbols change.
 *
 * The name of the eval context is used to print a "stack trace" for
 * debugging.
 *
 * @category Compute Engine
 */
export type EvalContext = {
  lexicalScope: Scope;
  assumptions: ExpressionMapInterface<boolean>;
  values: Record<string, BoxedExpression | undefined>;
  name: undefined | string;
};
