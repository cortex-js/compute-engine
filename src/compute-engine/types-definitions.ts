import type { OneOf } from '../common/one-of.js';
import type {
  EffectLabel,
  EffectSet,
  Type,
  TypeString,
} from '../common/type/types.js';
import type { BoxedType } from '../common/type/boxed-type.js';
import type { LatexString } from './latex-syntax/types.js';
import type {
  Expression,
  ExpressionInput,
  OperatorCompileHandler,
} from './types-expression.js';
import type {
  EvaluateOptions as KernelEvaluateOptions,
  ExplainVerbosity,
  Rule as KernelRule,
  BoxedRule as KernelBoxedRule,
  BoxedRuleSet as KernelBoxedRuleSet,
  Scope as KernelScope,
} from './types-kernel-evaluation.js';

/**
 * Compute engine surface used by definition callbacks.
 *
 * This interface is augmented by `types-engine.ts` with the concrete
 * `IComputeEngine` members to avoid type-layer circular dependencies.
 *
 * @category Compute Engine
 */
// eslint-disable-next-line @typescript-eslint/no-empty-object-type
export interface ComputeEngine {}

type EvaluateOptions = KernelEvaluateOptions;

/**
 * The `options` argument passed to an `evaluate` / `evaluateAsync` handler.
 *
 * @category Definitions
 */
export type EvaluateHandlerOptions = Partial<EvaluateOptions> & {
  engine: ComputeEngine;

  /**
   * The canonical expression node being evaluated.
   *
   * Its `ops` are the **raw** operands: canonical and bound, but
   * **pre-numericization** — the same objects the `type` handler sees. The
   * handler's first parameter, by contrast, holds the *evaluated* operands,
   * which under `numericApproximation` have already been turned into floats.
   *
   * That makes this the handler's only access to the operands' exactness. For
   * example `Power` reads the exact rational `p/q` of its exponent from
   * `expression.op2` to decide the branch of a negative base — under `.N()`
   * the exponent it receives as an operand is a double, from which `p/q`
   * can only be guessed.
   *
   * **`expression.ops[i]` is NOT in general the provenance of `ops[i]`.** The
   * evaluated operands come from `holdMap`, which reindexes them: it FLATTENS
   * an associative operator (`f(a, f(b, c))` arrives as three operands, one
   * more than the node has), it UNWRAPS `ReleaseHold` (so `expression.ops[i]`
   * is the wrapper, not what was evaluated), and it DROPS an operand whose
   * evaluation yields nothing. The correspondence holds only for a
   * non-associative operator with no `ReleaseHold` and no dropped operand — so
   * a handler that indexes into `expression.ops` must treat
   * `expression.ops.length !== ops.length` as "no provenance" and fall back to
   * what it can compute from the evaluated operands alone.
   *
   * **On a `lazy: true` operator there is no contrast to draw**: `holdMap`
   * returns the operands unchanged, so the handler's first parameter is raw
   * and held too — and, on the box/parse routes, not even canonicalized (see
   * the lazy-operator trap in `CLAUDE.md`: such a handler must canonicalize
   * each held operand it consumes).
   *
   * Read-only: do not mutate it, and do not assume it is present (a handler
   * invoked outside the evaluation driver may not receive one).
   */
  expression?: Expression;
};

type Rule = KernelRule<Expression, ExpressionInput, ComputeEngine>;
type BoxedRule = KernelBoxedRule<Expression, ComputeEngine>;
type BoxedRuleSet = KernelBoxedRuleSet<Expression, ComputeEngine>;
type Scope = KernelScope<BoxedDefinition>;

/**
 * A bound symbol (i.e. one with an associated definition) has either a type
 * (e.g. ∀ x ∈ ℝ), a value (x = 5) or both (π: value = 3.14... type = 'real').
 *
 * @category Definitions
 */
export type ValueDefinition = BaseDefinition & {
  holdUntil: 'never' | 'evaluate' | 'N';

  type: Type | TypeString | BoxedType;

  /** If true, the type is inferred, and could be adjusted later
   * as more information becomes available or if the symbol is explicitly
   * declared.
   */
  inferred: boolean;

  /** Annotation provenance on the EFFECTS axis of a function-typed
   * declaration (`docs/EFFECTS-MODEL.md`, "Annotation provenance") — the
   * effects-axis analog of `inferred`.
   *
   * True when the author STATED the arrow's effects: a non-empty specifier
   * (`(number) scope -> number`), or the `pure` keyword — which denotes the
   * same empty set a bare arrow does, so the type alone cannot tell them
   * apart. A bare arrow leaves effects on the inferred track: assigning a
   * body re-stamps them freely. A stated set is a CONTRACT: every assigned
   * body must satisfy `inferred ⊆ declared`.
   *
   * Set by `ce.declare()` from the parsed declaration; not normally written
   * by hand.
   */
  effectsDeclared: boolean;

  /** `value` can be a JS function since for some constants, such as
   * `Pi`, the actual value depends on the `precision` setting of the
   * `ComputeEngine` and possible other environment settings */
  value:
    | LatexString
    | ExpressionInput
    | ((ce: ComputeEngine) => Expression | null);

  eq: (a: Expression) => boolean | undefined;
  neq: (a: Expression) => boolean | undefined;
  cmp: (a: Expression) => '=' | '>' | '<' | undefined;

  collection: CollectionHandlers;

  /**
   * Custom evaluation handler for subscripted expressions of this symbol.
   * Called when evaluating `Subscript(symbol, index)`.
   *
   * @param subscript - The subscript expression (already evaluated)
   * @param options - Contains the compute engine and evaluation options
   * @returns The evaluated result, or `undefined` to fall back to symbolic form
   */
  subscriptEvaluate?: (
    subscript: Expression,
    options: { engine: ComputeEngine; numericApproximation?: boolean }
  ) => Expression | undefined;
};

/**
 * Definition for a sequence declared with `ce.declareSequence()`.
 *
 * A sequence is defined by base cases and a recurrence relation.
 *
 * @example
 * ```typescript
 * // Fibonacci sequence
 * ce.declareSequence('F', {
 *   base: { 0: 0, 1: 1 },
 *   recurrence: 'F_{n-1} + F_{n-2}',
 * });
 * ce.parse('F_{10}').evaluate();  // → 55
 * ```
 *
 * @category Definitions
 */
export interface SequenceDefinition {
  /**
   * Index variable name for single-index sequences, default 'n'.
   * For multi-index sequences, use `variables` instead.
   */
  variable?: string;

  /**
   * Index variable names for multi-index sequences.
   * Example: `['n', 'k']` for Pascal's triangle `P\_{n,k}`
   *
   * If provided, this takes precedence over `variable`.
   */
  variables?: string[];

  /**
   * Base cases as index → value mapping.
   *
   * For single-index sequences, use numeric keys:
   * ```typescript
   * base: { 0: 0, 1: 1 }  // F_0 = 0, F_1 = 1
   * ```
   *
   * For multi-index sequences, use comma-separated string keys:
   * ```typescript
   * base: {
   *   '0,0': 1,    // Exact: P_{0,0} = 1
   *   'n,0': 1,    // Pattern: P_{n,0} = 1 for all n
   *   'n,n': 1,    // Pattern: P_{n,n} = 1 (diagonal)
   * }
   * ```
   *
   * Pattern keys use variable names to match any value. When the same
   * variable appears multiple times (e.g., 'n,n'), the indices must be equal.
   */
  base: Record<number | string, number | Expression>;

  /** Recurrence relation as LaTeX string or Expression */
  recurrence: string | Expression;

  /** Whether to memoize computed values (default: true) */
  memoize?: boolean;

  /**
   * Valid index domain constraints.
   *
   * For single-index sequences:
   * ```typescript
   * domain: { min: 0, max: 100 }
   * ```
   *
   * For multi-index sequences, use per-variable constraints:
   * ```typescript
   * domain: { n: { min: 0 }, k: { min: 0 } }
   * ```
   */
  domain?:
    | { min?: number; max?: number }
    | Record<string, { min?: number; max?: number }>;

  /**
   * Constraint expression for multi-index sequences.
   * The expression should evaluate to a boolean/numeric value.
   * If it evaluates to false or 0, the subscript is considered out of domain.
   *
   * Example: `'k <= n'` for Pascal's triangle (only valid when k ≤ n)
   */
  constraints?: string | Expression;
}

/**
 * Status of a sequence definition.
 * @category Definitions
 */
export interface SequenceStatus {
  /**
   * Status of the sequence:
   * - 'complete': Both base case(s) and recurrence defined
   * - 'pending': Waiting for base case(s) or recurrence
   * - 'not-a-sequence': Symbol is not a sequence
   */
  status: 'complete' | 'pending' | 'not-a-sequence';

  /** Whether at least one base case is defined */
  hasBase: boolean;

  /** Whether a recurrence relation is defined */
  hasRecurrence: boolean;

  /**
   * Keys of defined base cases.
   * For single-index: numeric indices (e.g., [0, 1])
   * For multi-index: string keys including patterns (e.g., ['0,0', 'n,0', 'n,n'])
   */
  baseIndices: (number | string)[];

  /** Index variable name if recurrence is defined (single-index) */
  variable?: string;

  /** Index variable names if recurrence is defined (multi-index) */
  variables?: string[];
}

/**
 * Information about a defined sequence for introspection.
 * @category Definitions
 */
export interface SequenceInfo {
  /** The sequence name */
  name: string;

  /** Index variable name for single-index sequences (e.g., `"n"`) */
  variable?: string;

  /** Index variable names for multi-index sequences (e.g., `["n", "k"]`) */
  variables?: string[];

  /**
   * Base case keys.
   * For single-index: numeric indices
   * For multi-index: string keys including patterns
   */
  baseIndices: (number | string)[];

  /** Whether memoization is enabled */
  memoize: boolean;

  /**
   * Domain constraints.
   * For single-index: `{ min?, max? }`
   * For multi-index: per-variable constraints
   */
  domain:
    | { min?: number; max?: number }
    | Record<string, { min?: number; max?: number }>;

  /** Number of cached values */
  cacheSize: number;

  /** Whether this is a multi-index sequence */
  isMultiIndex: boolean;
}

/**
 * Result from an OEIS lookup operation.
 * @category OEIS
 */
export interface OEISSequenceInfo {
  /** OEIS sequence ID (e.g., 'A000045') */
  id: string;

  /** Sequence name/description */
  name: string;

  /** First several terms of the sequence */
  terms: number[];

  /** Formula or recurrence (if available) — the first formula line */
  formula?: string;

  /** All free-text formula lines, as returned by OEIS (if available) */
  formulas?: string[];

  /** Comments about the sequence */
  comments?: string[];

  /** URL to the OEIS page */
  url: string;
}

/**
 * Options for OEIS operations.
 * @category OEIS
 */
export interface OEISOptions {
  /** Request timeout in milliseconds (default: 10000) */
  timeout?: number;

  /** Maximum number of results to return for lookups (default: 5) */
  maxResults?: number;
}

/**
 * An OEIS-attributed closed-form proposal produced by `ce.interpret()`.
 *
 * The `expression` has been *verified* to reproduce every extracted sample
 * exactly. Attribution (`id`, `name`, `url`, `formula`) is mandatory: OEIS data
 * is CC BY-NC, so a candidate must always carry a link back to its source.
 *
 * @category OEIS
 */
export interface OEISCandidate {
  /** The parsed and sample-verified closed-form expression. */
  expression: Expression;

  /** OEIS sequence ID (e.g., 'A000217'). */
  id: string;

  /** Sequence name/description. */
  name: string;

  /** URL to the OEIS page. */
  url: string;

  /** The free-text OEIS formula line the expression was parsed from. */
  formula: string;
}

/**
 * Result of `ce.interpret()`: the sync-recognized form of the input (the same
 * value the `Interpret` head returns), plus any OEIS-attributed candidates.
 *
 * @category OEIS
 */
export interface InterpretResult {
  /** The recognized expression, or the input unchanged when nothing fired. */
  expression: Expression;

  /** Verified, OEIS-attributed closed-form proposals (possibly empty). */
  candidates: OEISCandidate[];
}

/**
 * Definition record for a function.
 * @category Definitions
 *
 */
export type OperatorDefinition = Partial<BaseDefinition> &
  Partial<OperatorDefinitionFlags> & {
    /**
     * The function signature, describing the type of the arguments and the
     * return type.
     *
     * If a `type` handler is provided, the return type of the function should
     * be a subtype of the return type in the signature.
     *
     */
    signature?: Type | TypeString | BoxedType;

    /**
     * If `true`, the `signature` is a starting point to be refined, not a
     * contract: assigning a function literal to this operator narrows the
     * signature from the literal's body, and calls type from the narrowed
     * signature.
     *
     * Declaring a `signature` normally pins it (`inferredSignature: false`),
     * which is what you want for a fixed API. Set this to `true` to vouch
     * that a name is an operator — so `f(x)` parses as an application rather
     * than a multiplication — while leaving its types to be inferred from the
     * body assigned later:
     *
     * ```js
     * ce.declare('q', { signature: '(unknown) -> unknown', inferredSignature: true });
     * ce.assign('q', ce.parse('t \\mapsto 2t+1'));
     * // signature is now `(unknown) -> finite_number`, so `q(x) < y` types
     * // `boolean` and compiles, while `q(L) < y` over a list `L` still types
     * // `list<boolean>` and fails closed.
     * ```
     *
     * A declaration that omits `signature` entirely behaves the same way.
     */
    inferredSignature?: boolean;

    /**
     * The `signature` was DERIVED from an annotated function literal at
     * `ce.assign()` time, not written by the author as a declaration.
     *
     * Such a signature is pinned (`inferredSignature: false`) so that calls
     * validate the annotated parameter types — but it is not a contract on the
     * NAME: a later untyped `ce.assign()` full-replaces it and re-infers from
     * the new literal (D6, "Assign always full-replaces"). A signature that
     * came from `ce.declare()` is sticky and keeps constraining every
     * re-assign.
     *
     * @internal
     */
    _derivedSignature?: boolean;

    /**
     * The type of the result (return type) based on the type of
     * the arguments.
     *
     * Should be a subtype of the type indicated by the signature.
     *
     * For example, if the signature is `(number) -> real`, the type of the
     * result could be `real` or `integer`, but not `complex`.
     *
     * :::info[Note]
     * Do not evaluate the arguments.
     *
     * However, the type of the arguments can be used to determine the type of
     * the result.
     * :::
     *
     */
    type?: (
      ops: ReadonlyArray<Expression>,
      options: {
        engine: ComputeEngine;
        /** Strip-before-validate override (§3.B): for a stripped parameter
         * position with an absent operand, the operand's `missing`-stripped
         * type; `undefined` where no override applies. A handler consults
         * `operandTypes[i]` before `ops[i].type`. */
        operandTypes?: ReadonlyArray<Type | undefined>;
      }
    ) => Type | TypeString | BoxedType | undefined;

    /** Return the sign of the function expression.
     *
     * If the sign cannot be determined, return `undefined`.
     *
     * When determining the sign, only literal values and the values of
     * symbols, if they are literals, should be considered.
     *
     * Do not evaluate the arguments.
     *
     * However, the type and sign of the arguments can be used to determine the
     * sign.
     *
     */
    sgn?: (
      ops: ReadonlyArray<Expression>,
      options: { engine: ComputeEngine }
    ) => Sign | undefined;

    /** The value of this expression is > 0, same as `isGreater(0)`
     *
     * @category Numeric Expression
     */
    readonly isPositive?: boolean | undefined;

    /** The value of this expression is >= 0, same as `isGreaterEqual(0)`
     *
     * @category Numeric Expression
     */
    readonly isNonNegative?: boolean | undefined;

    /** The value of this expression is &lt; 0, same as `isLess(0)`
     *
     * @category Numeric Expression
     */
    readonly isNegative?: boolean | undefined;

    /** The  value of this expression is &lt;= 0, same as `isLessEqual(0)`
     *
     * @category Numeric Expression
     */
    readonly isNonPositive?: boolean | undefined;

    /** Return `true` if the function expression is even, `false` if it is odd
     * and `undefined` if it is neither (for example if it is not a number,
     * or if it is a complex number).
     */
    even?: (
      ops: ReadonlyArray<Expression>,
      options: { engine: ComputeEngine }
    ) => boolean | undefined;

    /**
     * A number used to order arguments.
     *
     * Argument with higher complexity are placed after arguments with
     * lower complexity when ordered canonically in commutative functions.
     *
     * - Additive functions: 1000-1999
     * - Multiplicative functions: 2000-2999
     * - Root and power functions: 3000-3999
     * - Log functions: 4000-4999
     * - Trigonometric functions: 5000-5999
     * - Hypertrigonometric functions: 6000-6999
     * - Special functions (factorial, Gamma, ...): 7000-7999
     * - Collections: 8000-8999
     * - Inert and styling:  9000-9999
     * - Logic: 10000-10999
     * - Relational: 11000-11999
     *
     * **Default**: 100,000
     */
    complexity?: number;

    /**
     * Return the canonical form of the expression with the arguments `args`.
     *
     * The arguments (`args`) may not be in canonical form. If necessary, they
     * can be put in canonical form.
     *
     * This handler should validate the type and number of the arguments
     * (arity).
     *
     * If a required argument is missing, it should be indicated with a
     * `["Error", "'missing"]` expression. If more arguments than expected
     * are present, this should be indicated with an
     * `["Error", "'unexpected-argument'"]` error expression
     *
     * If the type of an argument is not compatible, it should be indicated
     * with an `incompatible-type` error.
     *
     * `["Sequence"]` expressions are not folded and need to be handled
     *  explicitly.
     *
     * If the function is associative, idempotent or an involution,
     * this handler should account for it. Notably, if it is commutative, the
     * arguments should be sorted in canonical order.
     *
     *
     * Values of symbols should not be substituted, unless they have
     * a `holdUntil` attribute of `"never"`.
     *
     * The handler should not consider the value or any assumptions about any
     * of the arguments that are symbols or functions (i.e. `arg.is(0)`,
     * `arg.isInteger`, etc...) since those may change over time.
     *
     * The result of the handler should be a canonical expression.
     *
     * If the arguments do not match, they should be replaced with an
     * appropriate `["Error"]` expression. If the expression cannot be put in
     * canonical form, the handler should return `null`.
     *
     */
    canonical?: (
      ops: ReadonlyArray<Expression>,
      options: { engine: ComputeEngine; scope: Scope | undefined }
    ) => Expression | null;

    /**
     * Evaluate a function expression.
     *
     * When the handler is invoked, the arguments have been evaluated, except
     * if the `lazy` option is set to `true`.
     *
     * It is not necessary to further simplify or evaluate the arguments.
     *
     * If performing numerical calculations and `options.numericalApproximation`
     * is `false` return an exact numeric value, for example return a rational
     * number or a square root, rather than a floating point approximation.
     * Use `ce.number()` to create the numeric value.
     *
     * If the expression cannot be evaluated, due to the values, types, or
     * assumptions about its arguments, return `undefined` or
     * an `["Error"]` expression.
     */
    evaluate?:
      | ((
          ops: ReadonlyArray<Expression>,
          options: EvaluateHandlerOptions
        ) => Expression | undefined)
      | Expression;

    /**
     * An asynchronous version of `evaluate`.
     *
     */
    evaluateAsync?: (
      ops: ReadonlyArray<Expression>,
      options: EvaluateHandlerOptions
    ) => Promise<Expression | undefined>;

    /** Dimensional analysis
     * @experimental
     */
    evalDimension?: (
      args: ReadonlyArray<Expression>,
      options: Partial<EvaluateOptions> & { engine: ComputeEngine }
    ) => Expression;

    /**
     * A custom compilation handler for this operator: emit target-language
     * source for a call to this operator. Takes precedence over the target's
     * built-in operator/function mapping and its broadcast lowering, so it can
     * override how a built-in operator compiles (e.g. a custom-tolerance `GCD`,
     * or a re-mapped `Add`/`Multiply`/`Power`/relational operator).
     *
     * It does NOT override the structural / control-flow heads, which have
     * their own bespoke lowering: `Sequence`, `Sum`, `Product`, `Function`,
     * `Declare`, `Assign`, `Return`, `Break`, `Continue`, `Loop`,
     * `Comprehension`, `If`, `Which`, `When`, `Match`, `Block`. A handler
     * declared on one of those heads is ignored.
     *
     * Return `undefined` (or an empty string) to fall back to the
     * default compilation (a `null` returned from untyped JavaScript is
     * tolerated and treated the same). See {@link OperatorCompileHandler}.
     */
    compile?: OperatorCompileHandler;

    /**
     * Custom equality handler.
     *
     * `prover` indicates the tier of the caller: `false` for the cheap
     * arithmetic tier (`eq()` / `.isEqual()`), `true` for the prover tier
     * (`eqIdentical()` / `.isIdenticallyEqual()`), and `undefined` when the
     * caller does not distinguish (e.g. `cmp()`). A handler that does
     * prover-tier work (sampling, expand/simplify, identity questions in the
     * free variables) must decline — return `undefined` — when
     * `prover === false`.
     */
    eq?: (
      a: Expression,
      b: Expression,
      prover?: boolean
    ) => boolean | undefined;
    neq?: (a: Expression, b: Expression) => boolean | undefined;

    collection?: CollectionHandlers;

    /**
     * For an operator that RETURNS a collection but has no `collection`
     * handlers (an EAGER producer — `Characters`, `Divisors`, `Eigenvalues`,
     * …): can `evaluate()` produce the collection's elements in the current
     * state?
     *
     * This is the operator's own decline test — the guard at the top of its
     * `evaluate` handler — exposed so the enumerability facet
     * (`isEnumerableCollection`) can answer without evaluating. Contract
     * (see `docs/plans/2026-08-11-eager-collection-enumerability.md`):
     *
     * - MUST be O(1), evaluation-free and side-effect free. An impure
     *   producer answers from its operands' facets, consuming no draws.
     * - `false` means evaluation WOULD decline — callers stay inert without
     *   paying for the evaluation.
     * - `true` is a hard promise that evaluation produces the collection. An
     *   operator whose success is not cheaply decidable (`Solve`,
     *   `FindRoot`) must return `undefined`, never `true`.
     * - The operand seen here is the CANONICAL operand, not the evaluated
     *   one. An unevaluated compound operand (`Divisors(n + 1)`) whose value
     *   cannot be read cheaply must yield `undefined` (undecidable), not
     *   `false` — only a definitively unavailable operand (a valueless
     *   symbol, a literal of the wrong kind) yields `false`. See
     *   `canEnumerateOperand` (`collection-utils.ts`) for the shared
     *   tri-state resolution.
     *
     * Ignored (never consulted) when the definition has `collection`
     * handlers — those own enumerability via `collection.isEnumerable`.
     */
    canEnumerate?: (expr: Expression) => boolean | undefined;

    /**
     * For an operator that RETURNS a collection but has no `collection`
     * handlers (an EAGER producer — `Sort`, `Chunk`, `Ordering`, …): how many
     * elements would `evaluate()` produce?
     *
     * The `count` twin of {@link canEnumerate}, and the honest replacement for
     * the broadcast count fallback: `count` reads the operands' agreed length
     * only for a `broadcastable` operator, where agreement IS the semantics
     * (`docs/BROADCAST-MODEL.md`). A reshaping operator's length is its own
     * business, so it must say so here or report `undefined`.
     *
     * Contract, mirroring `canEnumerate`:
     *
     * - MUST be O(1), evaluation-free and side-effect free. An impure producer
     *   (`RandomShuffle`) answers from its operands' facets, consuming ZERO
     *   draws.
     * - The operands seen here are the CANONICAL ones. Anything not cheaply
     *   knowable — a non-literal shape argument, an unknown source length —
     *   must report `undefined` (decline), never a guess.
     * - A returned number is a hard promise: it must equal
     *   `expr.evaluate().count`. When evaluation would DECLINE (an infinite or
     *   unknown-length source), report `undefined` — a count nobody can walk is
     *   worse than no count (Tycho item-169 ruling).
     *
     * Consulted only when the definition has no `collection.count` handler —
     * a declared `count` owns the answer, including its `undefined`.
     */
    elementCount?: (expr: Expression) => number | undefined;
  };

/**
 * Metadata common to both symbols and functions.
 *
 * @category Definitions
 *
 */
export interface BaseDefinition {
  /**
   * If a string, a short description, about one line long.
   *
   * Otherwise, a list of strings, each string a paragraph.
   *
   * May contain Markdown.
   */
  description: string | string[];

  /**
   * Search keywords (synonyms, alternate names) used by
   * `ce.searchDefinitions()`. Not shown in documentation.
   */
  keywords?: string[];

  /** A list of examples of how to use this symbol or operator.
   *
   * Each example is a string, which can be a MathJSON expression or LaTeX, bracketed by `$` signs.
   * For example, `["Add", 1, 2]` or `$\\sin(\\pi/4)$`.
   */
  examples: string | string[];

  /** A URL pointing to more information about this symbol or operator. */
  url: string;

  /**
   * A short string representing an entry in a wikibase.
   *
   * For example `"Q167"` is the [wikidata entry](https://www.wikidata.org/wiki/Q167)
   * for the `Pi` constant.
   */
  wikidata: string;

  /** If true, the value or type of the definition cannot be changed */
  readonly isConstant?: boolean;
}

/** Options for `Expression.simplify()`
 *
 * @category Boxed Expression
 */
export type SimplifyOptions = {
  /**
   * The set of rules to apply. If `null`, use no rules. If not provided,
   * use the default simplification rules.
   */
  rules?: null | Rule | ReadonlyArray<BoxedRule | Rule> | BoxedRuleSet;

  /**
   * Use this cost function to determine if a simplification is worth it.
   *
   * If not provided, `ce.costFunction`, the cost function of the engine is
   * used.
   */
  costFunction?: (expr: Expression) => number;

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
   * - `'trig'`: Rewrite exponentials of an imaginary argument to
   *   trigonometric form via Euler's formula (`e^{iθ} → cos θ + i·sin θ`),
   *   then simplify. This is the opt-in inverse of the default behavior, which
   *   keeps `e^{iθ}` in exponential form for a symbolic angle `θ`.
   */
  strategy?: 'default' | 'fu' | 'trig';
};

/** Options for `Expression.explain()`
 *
 * In addition to the `SimplifyOptions` (honored when explaining a
 * `'simplify'` operation, so that `explain('simplify', options).result`
 * matches `simplify(options)`):
 *
 * - `verbosity`: `'default'` returns the curated step chain (bookkeeping
 *   steps filtered out); `'all'` returns the raw, uncurated chain.
 * - `variable`: the unknown, for the `'solve'` and `'D'` operations. For a
 *   system of equations (`explain('solve')` on a `List`/`And`), pass the
 *   unknowns as an array, in order.
 * - `order`: for the `'D'` operation only, the order of the derivative to
 *   explain (the n-th derivative with respect to `variable`). Defaults to `1`.
 *   Ignored when the receiver is already a `D(…)` expression (which encodes
 *   its own differentiation sequence).
 *
 * @category Boxed Expression
 */
export type ExplainOptions = SimplifyOptions & {
  verbosity?: ExplainVerbosity;
  variable?: string | string[];
  order?: number;
};

/**
 * A table mapping symbols to their definition.
 *
 * Symbols should be valid MathJSON symbols. In addition, the
 * following rules are recommended:
 *
 * - Use only latin letters, digits and `-`: `/[a-zA-Z0-9-]+/`
 * - The first character should be a letter: `/^[a-zA-Z]/`
 * - Functions and symbols exported from a library should start with an uppercase letter `/^[A-Z]/`
 *
 * @category Definitions
 *
 */

export type SymbolDefinition = OneOf<[ValueDefinition, OperatorDefinition]>;

/**
 * @category Definitions
 *
 */
export type SymbolDefinitions = Readonly<{
  [id: string]: Partial<SymbolDefinition>;
}>;

/**
 * A library bundles symbol/operator definitions with their LaTeX dictionary
 * entries and declares dependencies on other libraries.
 *
 * Use with the `libraries` constructor option to load standard or custom
 * libraries:
 *
 * ```ts
 * const ce = new ComputeEngine({
 *   libraries: ['core', 'arithmetic', {
 *     name: 'custom',
 *     requires: ['arithmetic'],
 *     definitions: { G: { value: 6.674e-11, type: 'real', isConstant: true } },
 *   }],
 * });
 * ```
 *
 * @category Definitions
 */
export interface LibraryDefinition {
  /** Library identifier */
  name: string;
  /** Libraries that must be loaded before this one */
  requires?: string[];
  /** Symbol and operator definitions */
  definitions?: SymbolDefinitions | SymbolDefinitions[];
}

/**
 * When a unitless value is passed to or returned from a trigonometric function,
 * the angular unit of the value.
 *
 * | Angular Unit | Description |
 * |:--------------|:-------------|
 * | `rad` | radians, 2π radians is a full circle |
 * | `deg` | degrees, 360 degrees is a full circle |
 * | `grad` | gradians, 400 gradians is a full circle |
 * | `turn` | turns, 1 turn is a full circle |
 *
 * To change the angular unit used by the Compute Engine, use:
 *
 * ```js
 * ce.angularUnit = 'deg';
 * ```
 *
 * @category Compute Engine
 */
export type AngularUnit = 'rad' | 'deg' | 'grad' | 'turn';

/** @category Numerics */
export type Sign =
  /** The expression is equal to 0 */
  | 'zero'

  /** The expression is > 0 */
  | 'positive'

  /** The expression is < 0 */
  | 'negative'

  /** The expression is >= 0 and isPositive is either false or undefined*/
  | 'non-negative'

  /** The expression is <= 0 and isNegative is either false or undefined*/
  | 'non-positive'

  /** The expression is not equal to 0 (possibly with an imaginary part) and isPositive, isNegative, isUnsigned are all false or undefined */
  | 'not-zero'

  /** The expression has an imaginary part or is NaN */
  | 'unsigned';

/**
 * These handlers are the primitive operations that can be performed on
 * all collections, indexed or not.
 *
 *  @category Definitions
 */
export interface BaseCollectionHandlers {
  /**
   * Return an iterator that iterates over the elements of the collection.
   *
   * The order in which the elements are returned is not defined. Requesting
   * two iterators on the same collection may return the elements in a
   * different order.
   *
   * @category Definitions
   */
  iterator: (
    collection: Expression
  ) => Iterator<Expression, undefined> | undefined;

  /** Return the number of elements in the collection.
   *
   * An empty collection has a count of 0.
   */
  count: (collection: Expression) => number | undefined;

  /** Optional flag to quickly check if the collection is empty, without having to count exactly how may elements it has (useful for lazy evaluation). */
  isEmpty?: (collection: Expression) => boolean | undefined;

  /** Optional flag to quickly check if the collection is finite, without having to count exactly how many elements it has (useful for lazy evaluation). */
  isFinite?: (collection: Expression) => boolean | undefined;

  /**
   * Optional predicate answering whether `iterator()` will actually produce
   * this collection's elements — the cheap way to tell an EMPTY collection
   * from one that merely cannot be walked, which are otherwise
   * indistinguishable (both yield nothing).
   *
   * Return `false` when the elements have no computable value in the current
   * state: symbolic bounds (`Range(a, b)`, `Linspace(a, 1, 3)`, a symbolic
   * repeat count), or a source that is itself not enumerable. Return
   * `undefined` only when it cannot be decided without evaluating.
   *
   * Implementations must be O(1) and must NOT consult `count`, `isEmpty` or
   * `isFinite` on themselves, nor walk the collection: a wrapper answers by
   * reading its source's `isEnumerableCollection`, so a chain costs one call
   * per level. (Reading the emptiness facets instead is exponential in the
   * chain depth — each read re-enters the next `isEmpty` down.)
   *
   * Default when the handler is ABSENT: `true` (an operator with a
   * `collection` block can enumerate its elements). A handler that IS declared
   * owns all three states — returning `undefined` from it means "cannot tell
   * cheaply" and does not fall back to the default.
   */
  isEnumerable?: (collection: Expression) => boolean | undefined;

  /**
   * Optional predicate for operators whose collection-ness depends on their
   * operands, e.g. `When(value, cond)`, which is a collection exactly when
   * `value` is one.
   *
   * Returning `false` reports the expression as a scalar, as if it had no
   * collection handlers at all.
   *
   * Default: `true` (an operator with a `collection` block is a collection).
   */
  isCollection?: (collection: Expression) => boolean;

  /** Return `true` if the collection is lazy, `false` otherwise.
   * If the collection is lazy, it means that the elements are not
   * computed until they are needed, for example when iterating over the
   * collection.
   *
   * Default: `true`
   */
  isLazy?: (collection: Expression) => boolean;

  /**
   * Opt this operator's instances into per-instance element memoization: a
   * complete walk of an unmodified instance is served from a cached prefix
   * on subsequent walks (`boxed-expression/collection-element-memo.ts`).
   *
   * Set it on lazy operators that evaluate a function per element (`Map`,
   * `Filter`, `Tabulate`, …), where re-deriving an element is expensive.
   * Leave it off structural reindexers (`Take`, `Reverse`, `Zip`, …), which
   * re-serve their source's elements cheaply — when the source is itself a
   * flagged instance, the source's own memo already absorbs the cost.
   *
   * Default: `false`
   */
  elementMemo?: boolean;

  /**
   * Return `true` if the target expression is in the collection,
   * `false` otherwise.
   *
   * Return `undefined` if the membership cannot be determined.
   */
  contains?: (
    collection: Expression,
    target: Expression
  ) => boolean | undefined;

  /**
   * Return `true` if all the elements of `other` are in `collection`.
   * Both `collection` and `other` are collections.
   *
   * If strict is `true`, the subset must be strict, that is, `collection` must
   * have more elements than `other`.
   *
   * Return `undefined` if the subset relation cannot be determined.
   */
  subsetOf?: (
    collection: Expression,
    other: Expression,
    strict: boolean
  ) => boolean | undefined;

  /** Return the sign of all the elements of the collection. */
  eltsgn?: (collection: Expression) => Sign | undefined;

  /** Return the widest type of all the elements in the collection */
  elttype?: (collection: Expression) => Type | undefined;
}

/**
 * These additional collection handlers are applicable to indexed
 * collections only.
 *
 * The elements of an indexed collection can be accessed by index, and
 * the order of the elements is defined.
 *
 *  @category Definitions
 */
export interface IndexedCollectionHandlers {
  /**
   * Return the element at the specified index.
   *
   * The first element is `at(1)`, the last element is `at(-1)`.
   *
   * If the index is &lt;0, return the element at index `count() + index + 1`.
   *
   * The index can also be a string for example for records. The set of valid
   * keys is returned by the `keys()` handler.
   *
   * If the index is invalid, return `undefined`.
   */
  at: (
    collection: Expression,
    index: number | string
  ) => undefined | Expression;

  /**
   * Return the index of the first element that matches the predicate.
   *
   * If no element matches the predicate, return `undefined`.
   */
  indexWhere: (
    collection: Expression,
    predicate: (element: Expression) => boolean
  ) => number | undefined;
}

/**
 * The collection handlers are the primitive operations that can be
 * performed on collections, such as lists, sets, tuples, etc...
 *
 *  @category Definitions
 */
export type CollectionHandlers = BaseCollectionHandlers &
  Partial<IndexedCollectionHandlers>;

/**
 *
 * The definition for a value, represented as a tagged object literal.
 * @category Definitions
 *
 */
export type TaggedValueDefinition = {
  value: BoxedValueDefinition;
};

/**
 *
 * The definition for an operator, represented as a tagged object literal.
 *
 * @category Definitions
 *
 */
export type TaggedOperatorDefinition = {
  operator: BoxedOperatorDefinition;
};

/**
 * A definition can be either a value or an operator.
 *
 * It is collected in a tagged object literal, instead of being a simple union
 * type, so that the type of the definition can be changed while keeping
 * references to the definition in bound expressions.
 *
 * @category Definitions
 *
 */
export type BoxedDefinition = TaggedValueDefinition | TaggedOperatorDefinition;

/**
 * One recorded write to a definition's type (or an operator definition's
 * signature): the type the write installed, the mechanism that installed it,
 * and — for writes triggered by canonicalizing an expression — that
 * expression.
 *
 * Provenance can never live on `Type`/`BoxedType` objects themselves: parsed
 * types are interned, deep-frozen, and shared across engines (the
 * `TYPE_CACHE` in `common/type/parse.ts`), so two occurrences of `boolean`
 * are the same object. The history therefore lives on the per-engine
 * definition, next to `inferredType`.
 *
 * Design: `docs/plans/2026-08-13-inference-provenance-journal.md`, phase 1.
 *
 * @category Definitions
 */
export type TypeProvenanceEntry = {
  /** The type this write installed (for inference writes, the post-fold
   * result, not the raw evidence). */
  type: BoxedType;
  /** How the type was installed:
   * - `'declared'` — an explicit declaration (reserved: declarations
   *   currently record no entry; `inferredType === false` is the marker).
   * - `'auto-declared'` — the binding was *created* as a side effect of
   *   boxing a free symbol or a function parameter, before any evidence.
   * - `'inferred'` — an `infer()` write: narrowed from an argument use or
   *   widened from a result/value position.
   * - `'assumed'` — written by the assumptions machinery (`ce.assume`).
   * - `'value-derived'` — reserved: a type promoted from an assigned
   *   value currently records no entry; `inferredType === true` with a
   *   value is the marker. */
  kind: 'declared' | 'auto-declared' | 'inferred' | 'assumed' | 'value-derived';
  /** Which axis of the declaration contract the write touched. Phase 1
   * records only `'type'` (value types and operator signatures); the
   * effects axis (`effectsDeclared`) is the planned second user. */
  axis: 'type' | 'effects';
  /** The expression whose canonicalization triggered the write — the
   * enclosing `And(…)`, call, or arithmetic operation for an inference
   * write; the symbol occurrence itself for an auto-declaration. Kept as an
   * expression (not a rendered string): consumers compare it **by
   * containment** against the expression currently being canonicalized to
   * answer "was this written by the pass running now?" (first-boxing
   * binding-divergence fix, Tycho item 178). Containment, not identity: an
   * auto-declare cause is a symbol OCCURRENCE, so identity against the root
   * being canonicalized is always false — the discriminating test is "is
   * the cause a node within that tree". For an O(1) answer to the same
   * question, compare {@link epoch} instead. */
  cause?: Expression;
  /** The outermost-boxing epoch (`ce._boxingEpoch`) during which this entry
   * was recorded — the O(1) form of the "written by the pass running now?"
   * question: inside a boxing pass, `entry.epoch === ce._boxingEpoch` iff
   * the entry was recorded by that same pass. `undefined` when the write
   * happened outside any boxing operation (e.g. an assumption made between
   * evaluations, or a route that does not open an inference transaction);
   * consumers needing a verdict then fall back to the containment test on
   * {@link cause}.
   *
   * Pass granularity is a CONTRACT, not an implementation accident: within
   * one outermost pass every entry reads the same epoch, deliberately not
   * distinguishing "created a moment ago" from "created earlier in this
   * pass". The first-boxing binding-divergence fix (Tycho item 178) treats
   * same-pass bindings as shareable and relies on them comparing equal — a
   * finer-grained stamp would break that consumer, so do not "improve" the
   * resolution. */
  epoch?: number;
  /** Original-input span of the cause, when the parse that produced it
   * stamped one. Composed by the caller that knows the base offset — the
   * type parser only ever reports offsets local to the string it was
   * handed. Unset in phase 1. */
  span?: { start: number; end: number };
};

/**
 * @category Definitions
 *
 */
export interface BoxedBaseDefinition extends Partial<BaseDefinition> {
  /** If this is the definition of a collection, the set of primitive operations
   * that can be performed on this collection (counting the number of elements,
   * enumerating it, etc...).
   */
  collection?: CollectionHandlers;
}

/**
 *
 * @category Definitions
 */
export interface BoxedValueDefinition extends BoxedBaseDefinition {
  /** Release resources owned by this definition when its scope is disposed. */
  dispose(): void;

  /** Bumped on every semantic change to this definition (value write, type
   * change, disposal). Used to validate per-dependency caches.
   * @internal */
  _writeVersion: number;

  /**
    * If the symbol has a value, it is held as indicated in the table below.
    * A green checkmark indicate that the symbol is substituted.

  <div className="symbols-table">

  | Operation     | `"never"` | `"evaluate"` | `"N"` |
  | :---          | :-----:   | :----:      | :---:  |
  | `canonical()` |    (X)    |              |       |
  | `evaluate()`  |    (X)    |     (X)      |       |
  | `"N()"`       |    (X)    |     (X)      |  (X)  |

  </div>

    * Some examples:
    * - `ImaginaryUnit` has `holdUntil: 'never'`: it is substituted during canonicalization
    * - `x` has `holdUntil: 'evaluate'` (variables)
    * - `Pi` has `holdUntil: 'N'` (special numeric constant)
    *
    * **Default:** `evaluate`
    */
  holdUntil: 'never' | 'evaluate' | 'N';

  /** The current value of the symbol. For constants, this is immutable.
   *  The definition object is the single source of truth — there is no
   *  separate evaluation-context values map.
   */
  value: Expression | undefined;

  /**
   * True if the current value refers to the symbol itself (a degenerate
   * self-referential binding, e.g. `a := a + 1` over an unbound `a`). Such a
   * binding forms a cycle: resolving the value would re-resolve the symbol
   * forever. When set, the symbol is treated as unbound during resolution so
   * that `evaluate()`/`.N()`/collection queries stay symbolic instead of
   * overflowing the stack. Computed once when the value is assigned.
   */
  readonly isSelfReferential: boolean;

  eq?: (a: Expression) => boolean | undefined;
  neq?: (a: Expression) => boolean | undefined;
  cmp?: (a: Expression) => '=' | '>' | '<' | undefined;

  /**
   * True if the type has been inferred. An inferred type can be updated as
   * more information becomes available.
   *
   * A type that is not inferred, but has been set explicitly, cannot be updated.
   */
  inferredType: boolean;

  /** History of writes to this definition's type: which type each write
   * installed, by which mechanism, and — for inference writes — the
   * expression whose canonicalization triggered it. Appended only when a
   * write actually changes the type (no-op re-inferences are skipped by the
   * write sites), so the list stays short; it is capped, keeping the oldest
   * entry and the most recent ones. `undefined` until the first recorded
   * write — an explicitly declared type has no entry (its provenance is the
   * declaration itself, `inferredType === false`), and a type promoted from
   * an assigned value has none either (`inferredType === true` with a
   * value). Used by diagnostics to name the site that committed a
   * conflicting type ("inferred from its use in `And(x, y)`").
   * @internal */
  _typeProvenance: TypeProvenanceEntry[] | undefined;

  /** Annotation provenance on the EFFECTS axis — the effects-axis analog of
   * {@link inferredType} (`docs/EFFECTS-MODEL.md`, "Annotation provenance").
   *
   * True when the declaration STATED the arrow's effects (a non-empty
   * specifier, or the `pure` keyword). False for a bare arrow, which leaves
   * effects on the inferred track: an assigned body's inferred effects are
   * accepted and re-stamped, never checked against the declaration. */
  effectsDeclared: boolean;

  /** True when the un-applied-operator repair created this binding.
   * @internal */
  _isDevolvedShadow: true | undefined;

  type: BoxedType;

  /**
   * Custom evaluation handler for subscripted expressions of this symbol.
   * Called when evaluating `Subscript(symbol, index)`.
   */
  subscriptEvaluate?: (
    subscript: Expression,
    options: { engine: ComputeEngine; numericApproximation?: boolean }
  ) => Expression | undefined;
}

/**
 * A located binding site: where, inside an operator expression, one of that
 * operator's **bound variables** sits, and how to declare it.
 *
 * @category Definitions
 */
export type BindingSite = {
  /** The operand-index chain from the operator node to the symbol: `[1]` is
   * the second operand, `[2, 0]` the first operand of the third. */
  path: readonly number[];

  /** The type to declare the bound variable with. Defaults to `'unknown'`. */
  type?: TypeString;

  /**
   * The site belongs to an iterator **clause** (an indexing set), so its
   * binding is visible only from its own operand onward: in
   * `Comprehension(b, Element(i, [j, j+1]), Element(j, [10, 20]))` the first
   * clause's collection resolves `j` in the ENCLOSING scope — "later clauses
   * see earlier bindings", not the reverse. An operand *before* the first
   * clause (the body) sees every binding.
   *
   * Without the flag a site is visible to the whole node, which is what a
   * non-clause binder (`Series`' expansion variable, a function literal's
   * parameters) wants.
   */
  clauseLocal?: boolean;
};

/**
 * Locate an operator's binding sites among its operands.
 *
 * Used as the value of the {@link OperatorDefinitionFlags.scoped} flag to
 * declare that an operator is a *binder*: the framework mints the operator's
 * scope, declares each site's symbol in it before the `canonical` handler
 * runs, and rebinds the sites (and same-named occurrences elsewhere in the
 * expression) to that scope afterwards. This is what makes the parse,
 * `ce.box()` and `ce.function()` routes agree about which binding a bound
 * variable denotes.
 *
 * `phase: 'pre'` runs on the RAW operands, before the `canonical` handler; it
 * may return fewer sites than `'post'` — return nothing rather than guess.
 * `phase: 'post'` runs on the handler's RESULT operands and is authoritative.
 *
 * @category Definitions
 */
export type BindingSiteSelector = (
  ops: ReadonlyArray<Expression>,
  phase: 'pre' | 'post'
) => readonly BindingSite[];

/**
 * An operator definition can have some flags to indicate specific
 * properties of the operator.
 * @category Definitions
 */
export type OperatorDefinitionFlags = {
  /**
   * If `true`, the arguments to this operator are not automatically
   * evaluated. The default is `false` (the arguments are evaluated).
   *
   * This can be useful for example for operators that take symbolic
   * expressions as arguments, such as `Declare` or `Integrate`.
   *
   * This is also useful for operators that take an argument that is
   * potentially an infinite collection.
   *
   * It will be up to the `evaluate()` handler to evaluate the arguments as
   * needed. This is convenient to pass symbolic expressions as arguments
   * to operators without having to explicitly use a `Hold` expression.
   *
   * This also applies to the `canonical()` handler.
   *
   */
  lazy: boolean;

  /**
   * If `true`, the operator requires a new lexical scope when canonicalized.
   * This will allow it to declare variables that are not visible outside
   * the function expression using the operator.
   *
   * A **binding-site selector** may be given instead of `true`: the operator
   * then also declares *which of its operands are its bound variables*, and
   * the framework binds them in the operator's own scope (see
   * {@link BindingSiteSelector}). A selector implies a scope, so the
   * inconsistent state "binding sites without a scope" is unrepresentable and
   * `scoped` remains the complete inventory of scope-creating operators.
   *
   * **Default**: `false`
   */
  scoped: boolean | BindingSiteSelector;

  /**  If `true`, the operator is applied element by element to lists, matrices
   * (`["List"]` or `["Tuple"]` expressions) and equations (relational
   * operators).
   *
   * **Default**: `false`
   */
  broadcastable: boolean;

  /**
   * If `true`, this operator's `evaluate` handler runs even when the
   * expression is **invalid** — that is, when an operand is, or embeds, an
   * `Error` value.
   *
   * These are the non-strict *observers* of the error-propagation design
   * (`docs/plans/2026-07-31-error-propagation-design.md` §2): operators that
   * INSPECT their operands (`Match`, `Type`, `IsError`) or that are
   * application plumbing deciding what to do with an error operand (`Apply`,
   * `Pipe`). Every other operator freezes to its inert self when an operand
   * carries an error, which is what stops an error at the first strict
   * consumer.
   *
   * **Default**: `false`
   */
  inspectsErrors: boolean;

  /**
   * How this operator treats an absent (`Missing`) operand, per the
   * missing-value typing design
   * (`docs/plans/2026-07-22-missing-value-typing-design.md`, §3.A). The
   * declarable states are:
   *
   * - `'propagate'` — the signature is implicitly lifted `(A) -> B` to
   *   `(A | missing) -> B`; an absent operand cell yields `NaN` in the
   *   corresponding numeric result cell (arithmetic, transcendentals,
   *   `Power`/`Root`).
   * - `'handle'` — the operator owns its `Missing` result and runtime (`At`,
   *   the reducers, `Coalesce`, `IsMissing`, `Equal`).
   * - `'reject'` — an absent operand is an error, enforced in both strict and
   *   non-strict modes.
   *
   * If undeclared, the *resolved* behavior is `'propagate'` when the signature
   * is declared (not inferred) and every parameter type is numeric, otherwise
   * `'pass-through'` (no strip, ordinary validation). See
   * {@link BoxedOperatorDefinition.resolvedMissingBehavior}.
   */
  missingBehavior?: 'reject' | 'propagate' | 'handle';

  /**
   * Which parameter positions strip a `missing` arm before validation (§3.A).
   * `'all'` (the default where the resolved behavior is `propagate`/`handle`)
   * strips every position; a `number[]` strips only the listed 0-based
   * positions. Consumed identically by validation, typing, and the runtime
   * gate.
   */
  missingStrip: 'all' | number[];

  /** If `true`, `["f", ["f", a], b]` simplifies to `["f", a, b]`
   *
   * **Default**: `false`
   */
  associative: boolean;

  /** If `true`, `["f", a, b]` equals `["f", b, a]`. The canonical
   * version of the function will order the arguments.
   *
   * **Default**: `false`
   */
  commutative: boolean;

  /**
   * If `commutative` is `true`, the order of the arguments is determined by
   * this function.
   *
   * If the function is not provided, the arguments are ordered by the
   * default order of the arguments.
   *
   */
  commutativeOrder: ((a: Expression, b: Expression) => number) | undefined;

  /** If `true`, when the operator is univariate, `["f", ["Multiply", x, c]]`
   * simplifies to `["Multiply", ["f", x], c]` where `c` is constant
   *
   * When the operator is multivariate, multiplicativity is considered only on
   * the first argument: `["f", ["Multiply", x, y], z]` simplifies to
   * `["Multiply", ["f", x, z], ["f", y, z]]`
   *
   * Default: `false`
   */

  /** If `true`, `["f", ["f", x]]` simplifies to `["f", x]`.
   *
   * **Default**: `false`
   */
  idempotent: boolean;

  /** If `true`, `["f", ["f", x]]` simplifies to `x`.
   *
   * **Default**: `false`
   */
  involution: boolean;

  /** If `true`, the value of this operator is always the same for a given
   * set of arguments and it has no side effects.
   *
   * An expression using this operator is pure if the operator and all its
   * arguments are pure.
   *
   * For example `Sin` is pure, `Random` isn't.
   *
   * This information may be used to cache the value of expressions.
   *
   * **Default:** `true`
   *
   * As an **authoring input** this flag is sugar for an effect set, translated
   * once at registration (see {@link OperatorDefinitionFlags.effects} and the
   * truth table in `docs/EFFECTS-MODEL.md`, "One source of truth"). As
   * **readable state on a boxed definition** it is a *derived* getter: "no
   * impurity label is present in the operator's effect set".
   */
  pure: boolean;

  /**
   * The latent effects of applying this operator — the precise surface the
   * `pure` / `drawsRandom` flags are sugar for. See `docs/EFFECTS-MODEL.md`.
   *
   * `'any'` is the top ("unknown effects"); an array of labels is a finite
   * set; absent means **pure** (the empty set). May equivalently be written in
   * the specifier slot of a signature string —
   * `'(integer) random -> integer'`.
   *
   * Giving both this field (or an effect-annotated signature) and legacy
   * `pure` / `drawsRandom` flags that disagree is a **registration error**,
   * never silent precedence.
   */
  effects: EffectSet | undefined;

  /**
   * Annotation provenance (`docs/EFFECTS-MODEL.md`, "Annotation provenance"):
   * `true` when the AUTHOR supplied {@link OperatorDefinitionFlags.effects} or
   * an effect-bearing signature specifier, `false` when the effect set came
   * from the body inference.
   *
   * A **declared** set is a contract: a user function's inferred effects must
   * be a subset of it, or the definition is not installed. An inferred set is
   * not checked against itself. The legacy `pure` / `drawsRandom` flags do NOT
   * set this — they are an override, not a contract.
   *
   * The bit lives on the definition, not in the type AST, which keeps its
   * single optional `effects` field ("absent = pure").
   */
  effectsDeclared: boolean;

  /**
   * The **frame protocol** this operator delimits — the runtime role that is
   * NOT an effect of its own (a delimiter absorbs the effects of its body
   * rather than emitting them). Kind-valued, not boolean: `'seed'` — the
   * random-stream frame delimited by `WithRandomSeed` — is the only kind
   * today, and a future `WithClock` would name its own.
   *
   * Consumed by the frame kind's obligation protocol (for `'seed'`: the
   * pending-draw walk in `library/core.ts`), and by the derived
   * {@link OperatorDefinitionFlags.drawsRandom} getter.
   *
   * **Default:** none
   */
  frameProtocol: 'seed' | undefined;

  /**
   * Which operand positions may **invoke** a function-valued operand
   * (`docs/EFFECTS-MODEL.md`, "Projection and discharge"). A position that
   * does not invoke merely *stores* or *selects* the value, so it contributes
   * only the effects of *producing* the operand, never the operand's latent
   * (arrow) effects — `List(randomF)` is pure to build, and the effect
   * surfaces at whatever application later invokes an element.
   *
   * Two spellings, mirroring {@link discharges}' operand-index-map convention:
   *
   * - a **boolean**, uniform over every position: `false` for the pure
   *   containers and constructors (`List`, `Tuple`, the structural
   *   constructors), for the storing writers (`Assign`, `Declare`) and for the
   *   selecting conditionals (`If`, `Which`);
   * - a **map** from 0-based operand index to a boolean, for an operator that
   *   invokes at some positions and stores at others. **Missing indices
   *   default to `true`** — the conservative answer.
   *
   * **Default:** `true`
   */
  invokes: boolean | { readonly [operandIndex: number]: boolean };

  /**
   * The effects this operator **absorbs** rather than re-emits, per operand
   * position: a map from 0-based operand index to the labels discharged at
   * that position (`docs/EFFECTS-MODEL.md`, "Projection and discharge").
   *
   * `WithRandomSeed` is the canonical discharger: `{ 1: ['random'] }` on its
   * held body position, so `WithRandomSeed(42, Random())` computes the empty
   * set while `WithRandomSeed(42, Block(Assign(x, 1), Random()))` computes
   * `{scope}`.
   *
   * The discharge set must be a subset of the position's accepted-effects
   * **bound** — a function parameter's signature arrow, or (for a held
   * position) a declared bound on the held evaluation, which defaults to
   * `{any}`, making every finite discharge admissible today.
   *
   * What is discharged, and what is not: only the **latent** set of an eager
   * function-valued operand (the effects that fire if the operator invokes it)
   * and the effects of a **held, may-evaluate** operand — evaluation that
   * happens *under* the operator. The effects of *producing* an eager operand
   * are never dischargeable: they fire when the operand is evaluated,
   * whatever the operator then does with the result.
   *
   * Discharging from an operand whose effects are `'any'` yields an internal
   * **co-finite** value ¬D (see `common/type/effects.ts`).
   *
   * **Default:** discharge nothing — propagation is the sound default.
   */
  discharges:
    | { readonly [operandIndex: number]: readonly EffectLabel[] }
    | undefined;

  /**
   * How a **held** (`lazy`) operand position is treated by the projection rule
   * (`docs/EFFECTS-MODEL.md`, "Projection and discharge", the held-operand
   * clause):
   *
   * - `'evaluate'` (the default for `lazy` positions) — **may-evaluate**: the
   *   operand is not evaluated at application time, but the operator may
   *   evaluate it *under* itself (a `Sum` body, the `WithRandomSeed` body), so
   *   it contributes its own effects, minus whatever the position discharges.
   * - `'quote'` — the operator **never** evaluates the content (`Hold`):
   *   contribution ∅, so `Hold(Random())` is pure.
   * - `'release'` — the operator **forces** a quote (`ReleaseHold`): the
   *   projection strips one quote layer and recurses into the content, which
   *   is where the effects `Hold` deferred resurface. A symbol operand is
   *   resolved through its current binding.
   *
   * **Default:** `'evaluate'`
   */
  holdClass: 'evaluate' | 'quote' | 'release';

  /** If `true`, evaluating this operator consumes draws from the engine's
   * random stream (`Random`, `RandomShuffle`, …, and `WithRandomSeed`, which
   * manages the stream's frame).
   *
   * Narrower than `pure: false`, which also covers side effects with no
   * randomness (`Assign`, `Declare`, `Assume`). `WithRandomSeed` consults it
   * to decide whether a partially-evaluated body still OWES draws to its
   * seed frame — a surviving `Assign` is impure but owes nothing to the
   * stream.
   *
   * **Default:** `false`
   *
   * As an **authoring input** this flag is sugar for the `random` effect
   * label. As **readable state on a boxed definition** it is a *derived*
   * getter: `random ∈ effects ∨ frameProtocol === 'seed'`.
   */
  drawsRandom: boolean;

  /** If `true`, evaluating this operator READS the engine's random frame
   * without consuming any of its indices — the stochastic estimators
   * (Monte-Carlo integration), which sample through a derived sub-stream
   * (`ce._substream`).
   *
   * Orthogonal to `drawsRandom`, and both are consulted by `WithRandomSeed`'s
   * pending gate: an estimator that could NOT finish (a bound or parameter is
   * still unbound) must keep the seed frame, or the deferred completion
   * samples live — the same silent seeded→unseeded conversion `drawsRandom`
   * prevents for `Random`. It must not be spelled `drawsRandom: true`, which
   * would additionally make the estimator consume frame indices and shift
   * every sibling draw.
   *
   * A **peer runtime field, untouched by the effect-flag migration**: an
   * estimator's nondeterminism is confined below its reported error bound, so
   * it is approximation error, not an effect (the noise-floor convention). It
   * is neither translated to a label nor derived from one.
   *
   * An estimator that COMPLETED owes the frame nothing; its node is gone, so
   * the gate never sees it.
   *
   * **Default:** `false`
   */
  readsRandomFrame: boolean;
};

/**
 * A traversable, public view of a user-defined function literal
 * (`f(x) := …`, `x ↦ …`, or `ce.assign('f', lambda)`): its parameters and
 * its body as a boxed expression. Returned by
 * {@link BoxedOperatorDefinition.lambda}.
 *
 * @category Definitions
 */
export type LambdaDefinition = {
  /** The declared parameters, in order. `type` is `undefined` for a bare
   * (unannotated) parameter such as the `x` in `f(x) := x^2`. */
  parameters: ReadonlyArray<{ name: string; type: Type | undefined }>;

  /** The body of the function as a boxed expression, ready to traverse. This
   * is the canonical (scoped `Block`) body; any return-type ascription is
   * included. */
  body: Expression;
};

/**
 *
 * The definition includes information specific about an operator, such as
 * handlers to canonicalize or evaluate a function expression with this
 * operator.
 *
 * @category Definitions
 *
 */
export interface BoxedOperatorDefinition
  extends BoxedBaseDefinition, OperatorDefinitionFlags {
  /** Normalized from the declaration's `scoped` flag: `true` when the operator
   * creates a lexical scope, whether it was declared `true` or as a
   * binding-site selector. */
  scoped: boolean;

  /** The binding-site selector of the declaration's `scoped` flag, when one
   * was given. `undefined` for `scoped: true` (a scope with no syntactic
   * bound variables) and for an unscoped operator. */
  bindingSites?: BindingSiteSelector;

  complexity: number;

  /** If true, the signature was inferred from usage and may be modified
   * as more information becomes available.
   */
  inferredSignature: boolean;

  /** History of writes to this definition's signature — the operator-side
   * analog of {@link BoxedValueDefinition._typeProvenance}, with the same
   * append-on-change and capping rules.
   * @internal */
  _typeProvenance: TypeProvenanceEntry[] | undefined;

  /** See {@link OperatorDefinition._derivedSignature}: the pinned signature
   * came from an annotated function literal at assign time, not from an
   * author's declaration.
   * @internal */
  _derivedSignature: boolean;

  /** The type of the arguments and return value of this function */
  signature: BoxedType;

  /**
   * The *resolved* missing-value behavior (§3.A of the missing-value typing
   * design): the declared {@link missingBehavior} when present, otherwise
   * `'propagate'` for a declared all-numeric signature and `'pass-through'`
   * for everything else. Recomputed from the current signature — never cached
   * across a signature mutation.
   */
  readonly resolvedMissingBehavior:
    | 'reject'
    | 'propagate'
    | 'handle'
    | 'pass-through';

  /** True if a `missing` arm is stripped from parameter position `i` before
   * validation (§3.A). Only `propagate`/`handle` operators strip; `missingStrip`
   * selects the positions. */
  stripsMissingAt(i: number): boolean;

  /** True if operand position `i` may INVOKE a function-valued operand — the
   * per-position reader for {@link OperatorDefinitionFlags.invokes}. Missing
   * map indices default to `true`. Every consumer of the metadata goes
   * through this accessor (or {@link invokesNone}), never the raw field. */
  invokesAt(i: number): boolean;

  /** True when NO operand position invokes — the cheap operator-level
   * pre-gate for the latent half of the projection rule. */
  readonly invokesNone: boolean;

  /** If this operator definition was created from a user-defined function
   * literal (`f(x) := …`, `x ↦ …`, `ce.assign('f', lambda)`), a structured
   * view of it for traversal and classification: the parameters and the body
   * as a boxed expression. `undefined` for built-in operators.
   *
   * The return shape and per-argument types are also available via
   * {@link signature}; this accessor additionally exposes the body so a
   * consumer can resolve a function reference structurally — without
   * re-parsing or textually inlining its source.
   */
  readonly lambda: LambdaDefinition | undefined;

  /** If present, this handler can be used to more precisely determine the
   * return type based on the type of the arguments. The arguments themselves
   * should *not* be evaluated, only their types should be used.
   */
  type?: (
    ops: ReadonlyArray<Expression>,
    options: {
      engine: ComputeEngine;
      /** Stripped operand types conveyed by the missing-value strip (§3.B).
       * A handler consults `operandTypes[i]` before `ops[i].type`. */
      operandTypes?: ReadonlyArray<Type | undefined>;
    }
  ) => Type | TypeString | BoxedType | undefined;

  /** If present, this handler can be used to determine the sign of the
   *  return value of the function, based on the sign and type of its
   *  arguments.
   *
   * The arguments themselves should *not* be evaluated, only their types and
   * sign should be used.
   *
   * This can be used in some case for example to determine when certain
   * simplifications are valid.
   */
  sgn?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine }
  ) => Sign | undefined;

  /** See `OperatorDefinition.eq` for the meaning of `prover`. */
  eq?: (a: Expression, b: Expression, prover?: boolean) => boolean | undefined;
  neq?: (a: Expression, b: Expression) => boolean | undefined;

  /** The eager producer's enumerability precondition — see the
   * `canEnumerate` contract on {@link OperatorDefinition}. */
  canEnumerate?: (expr: Expression) => boolean | undefined;

  /** The eager producer's element count — see the `elementCount` contract on
   * {@link OperatorDefinition}. */
  elementCount?: (expr: Expression) => number | undefined;

  canonical?: (
    ops: ReadonlyArray<Expression>,
    options: { engine: ComputeEngine; scope: Scope | undefined }
  ) => Expression | null;

  evaluate?: (
    ops: ReadonlyArray<Expression>,
    options: EvaluateHandlerOptions
  ) => Expression | undefined;

  evaluateAsync?: (
    ops: ReadonlyArray<Expression>,
    options: EvaluateHandlerOptions
  ) => Promise<Expression | undefined>;

  evalDimension?: (
    ops: ReadonlyArray<Expression>,
    options: Partial<EvaluateOptions> & { engine: ComputeEngine }
  ) => Expression;

  compile?: OperatorCompileHandler;

  /** @internal */
  update(def: OperatorDefinition): void;

  /** Re-attach the definition's effect set to its signature after the
   * signature object was REPLACED by type inference. The two are one source of
   * truth and must never disagree.
   * @internal */
  _resyncEffects(): void;
}
