import type { OneOf } from '../common/one-of.js';
import type {
  EffectLabel,
  EffectSet,
  Type,
  TypeResolver,
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
/**
 * A three-valued fact about an operand: `true` (provably yes), `false`
 * (provably no), `undefined` (not decidable from what the descriptor knows).
 *
 * @category Definitions
 */
export type Tri = boolean | undefined;

/**
 * The facts a `type` handler in the `'types'` shape may read about one
 * operand, beside the operand's type. Every fact is derived from pure
 * sources — the operand's type, a literal's value, a symbol's held value or
 * recorded assumptions, structural reads — never by canonicalizing,
 * declaring, or evaluating anything.
 *
 * The set is deliberately minimal: a fact earns a field only when the
 * operand's TYPE cannot carry it. Anything the type proves is read off
 * `OperandDescriptor.type` directly — an error operand's type IS `'error'`
 * (so there is no `valid` field), and a literal's value, sign, and
 * finiteness normally travel in its value-carrying type. Each field below
 * merges the type channel with the pure value channel, so a handler reads
 * ONE place and never re-derives the combination; the doc of each field
 * names the residue that justifies it.
 *
 * @category Definitions
 */
export type OperandFacts = {
  /** `true` for a `finite_*`-typed operand or a finite number literal;
   * `false` for an operand whose type is below `infinity` or `nan` — which
   * covers the signed pair `non_finite_number`, the unsigned `~oo` and the
   * NaN marker — and for a `±∞`/`NaN` literal; `undefined` otherwise
   * (including every non-number operand). Treating a NaN operand as an
   * unknown-finiteness generic point would let a total-real-function
   * handler unsoundly claim a finite result for `f(NaN)`. */
  readonly finite: Tri;
  /** The operand's sign, from pure sources only: a number literal's value,
   * a symbol's held numeric value or recorded assumption, the sign a
   * ranged TYPE proves (`real<0..> & !0` is positive), or — for a function
   * application — its operator's `sgn` handler, a pure family by contract
   * (see `OperatorDefinition.sgn`; the audit behind the contract is
   * recorded at open item O7 of
   * `docs/plans/2026-08-22-type-handlers-on-types.md`).
   * Beyond the type: a held numeric value (`a := 5` keeps the declared
   * type `integer` — assigned symbols are checked, never narrowed), an
   * assumption whose bound no machine number represents (`assume(x > 1/3)`
   * records the sign but declines the range, leaving the type bare
   * `real`), and a compound proof through operand signs (`Divide`'s
   * handler recurses; `Sign(p)` with `assume(p > 0)` is positive). */
  readonly sgn?: Sign;
  /** The operand has no free variables (the `isConstant` structural fact —
   * never derivable from a type). */
  readonly closed: Tri;
  /** Is the operand a collection? `true` when its type proves it (a
   * collection-shaped type, `string` included) or the operand value is
   * enumerable; `false` when the type is provably disjoint from
   * `collection<any>`; `undefined` for top types and `broadcastable<T>`.
   * Beyond the type: per-instance collection capability (an operator whose
   * collection-ness is decided from its operands, or an enumerable value
   * whose type alone does not prove the shape). */
  readonly collection: Tri;
  /** Meaningful only when `collection` is not `false`. Beyond the type: a
   * value's enumerable-cardinality facet where the type carries no
   * dimensions. */
  readonly finiteCollection: Tri;
  /** Supports index-based access (`indexed_collection<any>` by type, or the
   * operand's indexed-collection capability). */
  readonly indexed: Tri;
  /** A statically known fixed shape (a dimensioned list type's dimensions).
   * Absent when no static shape is known. A computed convenience — today
   * derived from the type alone, kept as a field because the matrix-family
   * handlers read it constantly and a literal-`List` channel can join it
   * later. */
  readonly shape?: readonly number[];
};

/**
 * An inert, expression-free structural view of an operand, for `type`
 * handlers in the `'types'` shape that need more than the operand's type
 * (is it a symbol? a string literal? an application of which operator?).
 * Children appear as descriptors, so a handler can recurse without ever
 * holding an expression.
 *
 * @category Definitions
 */
export type OperandStructure =
  | {
      kind: 'symbol';
      name: string;
      /** Present (`true`) when the symbol's recorded type was INFERRED
       * (subject to revision) rather than declared — the fact the
       * `Multiply` and `List`-fold handlers consult when deciding how much
       * to trust an operand's type. Lives on the structure node, not in
       * `OperandFacts`: it is a property of this symbol, not of a type. */
      inferred?: boolean;
    }
  | { kind: 'string'; text: string }
  | { kind: 'number'; literal?: 0 | 1 }
  | {
      kind: 'application';
      head: string;
      children: ReadonlyArray<OperandDescriptor>;
    }
  | {
      kind: 'function-literal';
      parameters: ReadonlyArray<{ name: string; annotated?: Type }>;
      body: OperandStructure;
    }
  | { kind: 'tuple'; arity: number }
  | { kind: 'list-literal'; shape: readonly number[] };

/**
 * What a `type` handler in the `'types'` shape receives in place of an
 * operand expression: the operand's handler-visible type (a number
 * literal's value-carrying type included), a set of three-valued facts,
 * and an optional on-demand structural view. Descriptors carry no
 * expression, so a handler cannot canonicalize, declare, or evaluate its
 * operands while deriving a type — which is the point of the shape: type
 * derivation must not modify engine state.
 *
 * Built by `describe()` (from a real operand) and `describeType()` (from a
 * type alone) in `boxed-expression/operand-descriptor.ts`; the design is
 * `docs/plans/2026-08-22-type-handlers-on-types.md` §5.1.
 *
 * @category Definitions
 */
export type OperandDescriptor = {
  /** The operand's handler-visible type. For a number literal this is its
   * value-carrying type (`21`, `real<0.5..0.5>`); for an absent
   * operand at a missing-stripped parameter position, the operand's
   * `missing`-stripped type. */
  readonly type: Type;
  readonly facts: OperandFacts;
  /** A structural view of the operand, or `undefined` when no structural
   * facts are available (synthetic descriptors; structure kinds not yet in
   * the vocabulary). Pure and memoized; safe to call repeatedly. */
  readonly structureOf?: () => OperandStructure | undefined;
};

/**
 * The definition view a `'types'`-shape `type` handler gets from
 * `PureEngineView.lookupDefinition`: the tagged value/operator halves with
 * every own property readonly. The shallow `Readonly` is compile-time
 * protection against the direct field writes a type handler must never
 * perform (`def.operator.signature = …`); the runtime purity guard remains
 * the dynamic enforcement for anything the type system cannot see.
 *
 * @category Definitions
 */
export type ReadonlyDefinitionView = {
  readonly value?: Readonly<BoxedValueDefinition>;
  readonly operator?: Readonly<BoxedOperatorDefinition>;
};

/**
 * The read-only slice of the engine available to a `type` handler in the
 * `'types'` shape: enough to parse and resolve types, and to look up a
 * definition — none of the mutating surface (`declare`, `assign`, `box`,
 * `parse`, `evaluate`), and the definition lookup answers a read-only view
 * ({@link ReadonlyDefinitionView}). The full `ComputeEngine` satisfies this
 * interface structurally, so the restriction is compile-time only; the
 * runtime purity guard (`CE_TYPE_PURITY_GUARD`, always on under test) is
 * what enforces it dynamically.
 *
 * @category Definitions
 */
export interface PureEngineView {
  type(type: Type | TypeString | BoxedType): BoxedType;
  readonly _typeResolver: TypeResolver;
  lookupDefinition(id: string): ReadonlyDefinitionView | undefined;
}

/**
 * The context argument of a `type` handler in the `'types'` shape.
 *
 * A `derive(operator, operands)` member — the recursive entry point a
 * handler such as `Map` needs to type an application it does not have in
 * hand — is part of the design
 * (`docs/plans/2026-08-22-type-handlers-on-types.md` §5.2) and will be
 * added when those handlers migrate; it is absent until then.
 *
 * @category Definitions
 */
export type TypeHandlerContext = {
  engine: PureEngineView;
};

/**
 * The legacy `type` handler shape: a function of the operand EXPRESSIONS.
 *
 * @category Definitions
 */
export type OperatorTypeHandlerOnExpressions = (
  ops: ReadonlyArray<Expression>,
  options: {
    engine: ComputeEngine;
    /** Strip-before-validate override (§3.B of the missing-value typing
     * design): for a stripped parameter position with an absent operand,
     * the operand's `missing`-stripped type; `undefined` where no override
     * applies. A handler consults `operandTypes[i]` before `ops[i].type`. */
    operandTypes?: ReadonlyArray<Type | undefined>;
  }
) => Type | TypeString | BoxedType | undefined;

/**
 * The `type` handler shape selected by `typeHandlerKind: 'types'`: a
 * function of operand DESCRIPTORS. Such a handler never sees an operand
 * expression, so deriving a type cannot declare, canonicalize, or evaluate
 * anything — the state-purity contract of
 * `docs/plans/2026-08-22-type-handlers-on-types.md`.
 *
 * @category Definitions
 */
export type OperatorTypeHandlerOnTypes = (
  operands: ReadonlyArray<OperandDescriptor>,
  context: TypeHandlerContext
) => Type | TypeString | BoxedType | undefined;

/**
 * The two `type`-handler shapes, discriminated by the `typeHandlerKind`
 * flag — the flag selects the shape; the shape is never guessed from the
 * handler's parameter count. Omitting the flag (every pre-existing
 * definition) keeps the legacy expressions shape.
 *
 * The flag travels WITH the handler: a definition update that supplies a
 * new `type` handler and omits `typeHandlerKind` resets the stored shape
 * to `'expressions'`, even when the previous handler was declared
 * `'types'`. When re-declaring a `'types'`-shape operator, always restate
 * the flag next to the handler — a descriptor-consuming handler filed
 * under the expressions shape is silently called with expressions and
 * derives wrong types.
 *
 * @category Definitions
 */
export type OperatorTypeHandlerVariant =
  | {
      typeHandlerKind?: 'expressions';

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
      type?: OperatorTypeHandlerOnExpressions;
    }
  | {
      typeHandlerKind: 'types';

      /**
       * The type of the result (return type) as a function of the operand
       * DESCRIPTORS — their types and facts, never the operand expressions.
       * See {@link OperatorTypeHandlerOnTypes}.
       */
      type?: OperatorTypeHandlerOnTypes;
    };

export type OperatorDefinition = Partial<BaseDefinition> &
  Partial<OperatorDefinitionFlags> &
  OperatorTypeHandlerVariant & {
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
     * // signature is now `(unknown) -> number`, so `q(x) < y` types
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
     * The handler must be a pure function of the operands — the type path
     * dispatches it while deriving an application's type. See the purity
     * contract on `OperatorDefinition.sgn`.
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
     * `Comprehension`, `If`, `When`, `Match`, `Block`. A handler
     * declared on one of those heads is ignored.
     *
     * Exception: `Which` IS overridable (it has no binding structure — its
     * operands are plain condition/value pairs a handler can compile through
     * the callback it is given). To customize how `Which` compiles while
     * keeping its stock evaluation semantics, attach the handler to the
     * engine's own definition rather than re-declaring the operator (a
     * re-declaration replaces the stock `evaluate`/`canonical` handlers):
     *
     * ```ts
     * const def = ce.lookupDefinition('Which');
     * if (def && 'operator' in def) def.operator.compile = myWhichHandler;
     * ```
     *
     * The override is per-engine (each `ComputeEngine` builds its own
     * standard-library definitions), and the decline contract applies: a
     * handler returning `undefined` falls back to the built-in `Which`
     * lowering, coercion and frame-protocol wrapping included.
     *
     * **Attaching in place is the supported route for EVERY operator the
     * engine already defines, not only `Which`.** Three things follow from
     * re-declaring instead, and all three are silent:
     *
     * - A re-declaration REPLACES the stock `evaluate`/`canonical` handlers.
     *   Spreading the captured definition (`ce.declare(op, {...orig, compile})`)
     *   is an attempt to carry them across by hand and is not equivalent —
     *   attaching to the definition `lookupDefinition` returns keeps them by
     *   construction, with nothing to carry.
     * - A re-declaration also replaces the definition's EFFECTS declaration,
     *   and that is what decides whether a compiled `Sum`/`Product` over a
     *   body mentioning the operator keeps its NaN early exit — the
     *   `if (acc !== acc) return NaN;` emitted between terms, valid because
     *   NaN absorbs `+` and `*`, so once the accumulator is NaN no later
     *   term can change the answer. An operator definition is GRANTED
     *   purity, so a re-declaration that states no effects keeps the exit.
     *   One that states any effects refuses it, since skipping terms would
     *   skip the effects too — and the lever is the effect SET, not the
     *   `pure` keyword: `pure` is a derived reading of `effects`, so
     *   `effects: ['random']` or an effect-annotated signature loses the
     *   exit exactly as `pure: false` does, while `effects: []` keeps it
     *   exactly as an unspecified definition does. For this exit, carrying
     *   a `compile` handler costs nothing by itself, whether it supplies
     *   source or declines for the target at hand: the gate reads the
     *   definition's declared effects, not who supplied the code. The one
     *   shape it cannot catch is a handler emitting effectful source under
     *   a definition that states no effects.
     *
     *   The exit this governs is the one the scalar `Sum`/`Product`
     *   lowering emits through `BaseCompiler.isEmissionSkippable`. An
     *   element-wise (collection-valued) body carries a separate,
     *   UNCONDITIONAL latch of the same spelling, emitted so that a
     *   length mismatch collapsing the fold to a scalar NaN cannot be
     *   broadcast back over the next term's shape. That latch does not
     *   consult the declared effects, so declaring effects does not buy
     *   back the later iterations of an element-wise body.
     * - Call-sharing is the one cost a handler still pays for being on a
     *   re-declared definition, and the declared effects do not govern it. A
     *   `compile` handler the engine did not install is a live-source
     *   splice the CSE harvest cannot analyse, so every node under that
     *   head is refused as a candidate and every callee body mentioning it
     *   is refused with it. A self-recursive body loses the binding that
     *   made its repeated self-call linear and compiles exponentially —
     *   measured ×4 per two levels of `R(i,x,y) = R(i-1,x,y) +
     *   0.5·S(x,y,R(i-1,x,y))`. Declaring `pure: true` on the
     *   re-declaration does NOT restore sharing. Attaching in place is
     *   exempt, because the definition is still the engine's own.
     *
     * The evaluate side is NOT symmetric with the decline contract above:
     * returning `undefined` from an `evaluate` handler leaves the expression
     * unevaluated rather than falling back, so a handler that means to
     * delegate must call the captured original explicitly.
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
     * (see `docs/COLLECTIONS-MODEL.md`):
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
/**
 * `Partial` distributed over the {@link SymbolDefinition} union, except that
 * the `typeHandlerKind: 'types'` discriminant stays REQUIRED on its arm.
 * A plain `Partial` would make the discriminant optional, at which point an
 * object literal with an unannotated `type: (ops) => …` handler matches both
 * handler shapes and TypeScript can no longer contextually type the
 * handler's parameters — every legacy definition in the library would stop
 * type-checking.
 */
type PartialSymbolDefinition<T = SymbolDefinition> = T extends {
  typeHandlerKind: 'types';
}
  ? Partial<T> & { typeHandlerKind: 'types' }
  : Partial<T>;

export type SymbolDefinitions = Readonly<{
  [id: string]: PartialSymbolDefinition;
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
   * Default: `false`. A collection is eager unless its definition says
   * otherwise: the elements of a `List` are already materialized operands,
   * so nothing is deferred. Lazy collections such as `Range` or `Map` declare
   * this handler to opt in.
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
   * Return `true` if all the elements of `collection` are in `other` — that
   * is, `collection` ⊆ `other`. The RECEIVER is the candidate subset, matching
   * the public `Expression.subsetOf(other, strict)` method that dispatches
   * here. Both `collection` and `other` are collections.
   *
   * If strict is `true`, the subset must be strict, that is, `other` must have
   * an element that `collection` does not.
   *
   * Return `undefined` if the subset relation cannot be determined. A handler
   * that cannot see far enough to answer must return `undefined` rather than
   * `false`: `false` is read as a proof that the relation does NOT hold.
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
   * The index can also be a string, for example for records. There is no
   * handler that enumerates the valid string keys: a handler that accepts
   * them decides which ones it recognizes, and returns `undefined` for the
   * rest.
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
 * Design: `docs/TYPE-SYSTEM.md`, phase 1.
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
   * - `'inferred'` — an `_infer()` write: narrowed from an argument use or
   *   widened from a result/value position.
   * - `'value-derived'` — reserved: a type promoted from an assigned
   *   value currently records no entry; `inferredType === true` with a
   *   value is the marker.
   *
   * There is deliberately no kind for an assumption: an assumption never
   * writes a type. It is a FACT the type READ merges into the declared type,
   * and the read heals on its own when the fact is retracted
   * (`docs/plans/2026-08-29-assumptions-as-facts-type.md` §2.5). */
  kind: 'declared' | 'auto-declared' | 'inferred' | 'value-derived';
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

  /** True once `dispose()` has run — the scope that owned this binding has
   * been discarded, so the definition names nothing any more. An assumption
   * recorded against it is about a value that no longer exists.
   * @internal */
  disposed: boolean;

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

  /** The current value of the symbol: the value an `assume(x = …)` puts in
   *  force for the current context if there is one, else the stored value.
   *  For constants, this is immutable.
   */
  value: Expression | undefined;

  /** The value STORED on this definition — what `assign()`, a
   *  `declare(name, { value })` or a library constant put here — with no
   *  assumed value overlaid on it. A definition is USER-VALUED when this is
   *  defined; an assumed value never lands here, so it cannot outlive the
   *  scope that assumed it.
   *  @internal */
  readonly storedValue: Expression | undefined;

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

  /** When the declaration's type was a bare collection constructor (`list`,
   * `set`, `dictionary`, `collection`, `indexed_collection` — the
   * `<unknown>` synonyms), the declared skeleton: the constructor is the
   * CONTRACT (assignments are validated against it and it never moves),
   * while `type` carries the element REFINEMENT the latest assignment
   * produced (`docs/INFERENCE_ROADMAP.md`, Phase 1, ruled 2026-08-18).
   * `undefined` for every other declaration.
   * @internal */
  _placeholderSkeleton: Type | undefined;

  /** Install an element refinement of the placeholder skeleton without
   * disturbing `_placeholderSkeleton` (the public `type` setter maintains
   * the skeleton on every explicit write and would clear it).
   * @internal */
  _setElementRefinement(t: BoxedType): void;

  /** Write the declared type, deriving it inside the write's fact-blind
   * bracket: the thunk and the write both run with the assumptions hidden, so
   * neither the stored type nor the decisions that chose it can carry a fact
   * that a later `forget()` retracts. The public {@link type} setter delegates
   * here.
   * @internal */
  _setType(thunk: () => Type | TypeString | BoxedType): void;

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

  /** Snapshot the coupled type/value slots for an exact later restore via
   * {@link _restoreTypeSlots}. The result is OPAQUE — it captures private
   * fields, including states the public setters cannot express — so it is
   * typed `unknown` and only meaningful when handed back unchanged.
   * @internal */
  _typeSlotSnapshot(): unknown;

  /** Restore the slots captured by {@link _typeSlotSnapshot}, verbatim and
   * setter-bypassing (the `type` setter is a computed view whose `unknown`
   * write wipes the value — a faithful restore cannot go through it).
   * Bumps `_writeVersion` rather than restoring it: monotone invalidation
   * counters only advance. Phase 2a of
   * `docs/TYPE-SYSTEM.md`.
   * @internal */
  _restoreTypeSlots(snapshot: unknown): void;

  /** Snapshot EVERY mutable field of this record for the checkpoint journal
   * (`checkpoint-journal.ts`), so that a restore can rewind a whole cell's
   * worth of arbitrary program writes IN PLACE. Wider than
   * {@link _typeSlotSnapshot}, which covers only the slots an inference
   * re-derivation moves. Opaque, for the same reason.
   * @internal */
  _checkpointSnapshot(): unknown;

  /** Restore the fields captured by {@link _checkpointSnapshot}, verbatim and
   * setter-bypassing. Never replaces the record object: live boxed
   * expressions hold it by identity.
   * @internal */
  _restoreCheckpointSnapshot(snapshot: unknown): void;

  /** The type known in the CURRENT state: {@link declaredType} narrowed by
   * everything the assumptions in force prove about this definition. Reading
   * it is what makes a fact visible; nothing derived from it may be STORED
   * (see {@link declaredType}). */
  type: BoxedType;

  /** The type this definition DECLARES — its contract, built from the
   * declaration and the stored value alone and never from an assumption.
   * A write must read this rather than {@link type}: a type derived from a
   * fact and then stored would outlive the fact it was proved from.
   * @internal */
  readonly declaredType: BoxedType;

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
 * Used as the value of the `scoped` flag of {@link OperatorDefinitionFlags} to
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
 * A shape of operand (or result) whose broadcast handling an operator's own
 * handlers provide, exempting it from the generic broadcast machinery. See
 * {@link OperatorDefinitionFlags.broadcastExemptions} for the meaning of
 * each label.
 * @category Definitions
 */
export type BroadcastExemption =
  | 'tensors'
  | 'tuples'
  | 'collection-result'
  | 'evaluated-operands'
  | 'whole-collection-compare'
  | 'single-collection-join';

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
   * Operand and result shapes whose broadcast handling this operator's OWN
   * handlers provide. The generic broadcast machinery — the pre- and
   * post-evaluation element-wise fan-out and the result-type lift — must not
   * apply to a shape listed here; the operator's `evaluate` and `type`
   * handlers give those operands their dedicated semantics instead.
   *
   * - `'tensors'`: tensor and matrix operands route to the operator's own
   *   tensor arms (e.g. the matrix PRODUCT for `Multiply`, not an
   *   element-wise Hadamard map).
   * - `'tuples'`: numeric tuples (points/vectors in ℝⁿ) are combined
   *   component-wise by the handler, never fanned into a `List`.
   * - `'collection-result'`: the type handler computes its own
   *   collection-shaped result types (e.g. `matrix + scalar` is a `matrix`);
   *   the generic result-type lift must not re-wrap them.
   * - `'evaluated-operands'`: the `evaluate` handler owns the element-wise
   *   treatment of operands that only become collections at evaluation; the
   *   generic post-evaluation broadcast arm must not re-map them.
   * - `'whole-collection-compare'`: two or more collection operands are
   *   compared as WHOLE values (a scalar boolean); only the
   *   collection-vs-scalar case broadcasts element-wise.
   * - `'single-collection-join'`: a lone collection operand is consumed
   *   whole by the `evaluate` handler (e.g. joined), never mapped over.
   *
   * **Default**: `[]` — the generic broadcast machinery applies uniformly
   * whenever `broadcastable` is `true`.
   */
  broadcastExemptions: ReadonlyArray<BroadcastExemption>;

  /**
   * If `true`, this operator's `evaluate` handler runs even when the
   * expression is **invalid** — that is, when an operand is, or embeds, an
   * `Error` value.
   *
   * These are the non-strict *observers* of the error-propagation design
   * (`docs/LANGUAGE-MODEL.md`): operators that
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
   * If `true`, this operator DECIDES AT EVALUATION which of its held operands
   * to evaluate — `If` takes one arm, `Which` takes one clause, `And`/`Or`
   * stop at the decisive operand, `Coalesce` stops at the first present one.
   *
   * **Only valid on a `lazy` operator** (asserted in
   * `_BoxedOperatorDefinition`). A strict operator's operands are all
   * evaluated before its handler runs, so there is nothing left for it to
   * select, and the deferred absorption this flag turns on would only stop
   * its operand errors from bubbling.
   *
   * The consequence for the error model: an `Error` in an operand such an
   * operator does not choose is DEAD CODE, so it must not make the
   * application fail. `If(True, 5, <error>)` evaluates to `5`
   * (`docs/ERROR-MODEL.md` §3, the demanded-operands rule). Absorption is
   * therefore deferred past the handler for these operators instead of
   * happening before it, and an error the handler DID demand still bubbles,
   * because it comes back embedded in the handler's result.
   *
   * The obligation this places on the handler: an operand it demands and
   * finds to be an error must be RETURNED, not thrown on and not swallowed.
   * `If` and `Which` answer their condition's error explicitly for that
   * reason. Do not set this flag on an operator that demands all of its
   * operands — pre-absorption is both correct and cheaper there — and do not
   * set it on an operator whose handler quietly answers something else (a
   * `Nothing`, a rebuilt node) when an operand it demanded is unusable.
   *
   * **Default**: `false`
   */
  selectsOperands: boolean;

  /**
   * Whether every argument of an application MUST be written with its
   * parameter's name (`Person(firstName: "Alan", age: 42)`).
   *
   * A positional call to such an operator is rejected with
   * `argument-names-required`, naming the parameters in order so the author
   * can add the names. Names make the call order-free, so a named call may
   * list the arguments in any order.
   *
   * The one operator class that sets it today is the object-type constructor:
   * an object type's fields are often several of the same type (`Person` has
   * two adjacent `string` fields), and a positional call that transposed two
   * of them would be accepted silently and produce a wrong object with no
   * error anywhere (`docs/TYPE_SYSTEM_ROADMAP.md` Appendix B, "Declaring an
   * object type", ruling B11).
   *
   * The check runs in the canonicalization seam that normalizes named
   * arguments (`box.ts`), because that is the last point at which named and
   * positional calls are still distinguishable: normalization rewrites a
   * named call into declaration order, after which the handlers see the same
   * operands either way.
   *
   * **Default**: `false`
   */
  namedArgumentsRequired: boolean;

  /**
   * How this operator treats an absent (`Missing`) operand, per the
   * missing-value typing design
   * (`docs/TYPE-SYSTEM.md`). The
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

  /**
   * How this operator treats a `NaN` argument, per Contract B of
   * `docs/ERROR-MODEL.md` §4 (ratified 2026-08-27). Symmetric with
   * `missingBehavior`:
   *
   * - `'propagate'` — a `NaN` in the slot makes the application evaluate to
   *   `NaN`.
   * - `'handle'` — the handler sees the `NaN` and answers in its own
   *   codomain (membership predicates: `IsPrime(NaN)` → `False`). Always an
   *   explicit opt-in — a boolean codomain never implies the handler
   *   understands `NaN`.
   * - `'reject'` — a `NaN` in the slot is a contract violation → `Error`
   *   (an index, a digit count, a dimension).
   *
   * A single value applies to every parameter slot; an array gives per-slot
   * values (a hole falls back to the derived default).
   *
   * If undeclared, the *resolved* per-slot policy is derived mechanically
   * from the signature — see
   * {@link BoxedOperatorDefinition.resolvedNanBehaviorAt}. While the slot's
   * declared carrier still ADMITS `nan` (bare `number`, `any`, a union with
   * `nan`), the policy channel is inert: `NaN` is an ordinary domain member
   * there and the handler owns it, which is the status quo for every
   * operator that has not yet migrated to a precise Contract B carrier.
   */
  nanBehavior?:
    | 'reject'
    | 'propagate'
    | 'handle'
    | ReadonlyArray<'reject' | 'propagate' | 'handle' | undefined>;

  /**
   * The partiality declaration of Contract B (`docs/ERROR-MODEL.md` §4):
   * does membership in the carrier types prove success?
   *
   * - `'total'` — every argument inside the carriers has a successful
   *   result, on the numeric route as well (the value's float image is
   *   representable). A strong claim; opt in only when it is true.
   * - `'may-marker'` — a domain or numeric-route failure is possible
   *   without naming the condition. **The default when omitted** — the
   *   sound assumption for every operator.
   *
   * An operator that can NAME its domain condition declares `definedWhen`
   * instead; declaring both `partiality: 'total'` and `definedWhen` is a
   * definition error.
   */
  partiality?: 'total' | 'may-marker';

  /**
   * The named *mathematical* domain condition of Contract B: the arguments
   * for which this operator has a value (`Mod`: the divisor is not zero).
   * `false` routes to the codomain marker channel (rule 4 of
   * `docs/ERROR-MODEL.md` §2), never to `Error`; `undefined` means the
   * condition cannot be decided for these arguments (unbound symbols).
   * Declaring it supersedes `partiality` (the partiality IS this
   * predicate).
   */
  definedWhen?: (ops: ReadonlyArray<Expression>) => boolean | undefined;

  /**
   * A *contract* precondition of Contract B: a well-formedness requirement
   * on the arguments that is not a mathematical domain condition
   * (`MatrixMultiply`: the inner dimensions agree; an option value in
   * range). `false` routes to the `Error` channel (rule 6 of
   * `docs/ERROR-MODEL.md` §2); `undefined` means undecidable for these
   * arguments.
   */
  requires?: (ops: ReadonlyArray<Expression>) => boolean | undefined;

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

  /**
   * If `true`, `match()` tries permutations of the operands when a pattern
   * uses this operator — WITHOUT the canonical operand sort that
   * `commutative` implies. For an operator whose VALUE is commutative but
   * whose operand ORDER is part of the program (the short-circuit
   * `And`/`Or`: evaluation is left-to-right and the canonical form
   * preserves written order), this restores permutation matching on its
   * own, so a rule pattern `p ∧ ¬p` still hits `¬p ∧ p`.
   *
   * **Default**: the value of `commutative`.
   */
  commutativeMatch: boolean;

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
   * once at registration (see the `effects` flag of {@link OperatorDefinitionFlags} and the
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
   * `true` when the AUTHOR supplied the `effects` flag of {@link OperatorDefinitionFlags} or
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
   * `drawsRandom` getter of {@link OperatorDefinitionFlags}.
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

  /** Write the signature, deriving it inside the write's fact-blind bracket:
   * the thunk and the write both run with the assumptions hidden, so a stored
   * arrow never encodes a proof the next `forget()` retracts. The public
   * {@link signature} setter delegates here.
   * @internal */
  _setSignature(thunk: () => BoxedType): void;

  /**
   * The *resolved* missing-value behavior (§3.A of the missing-value typing
   * design): the declared `missingBehavior` flag of {@link OperatorDefinitionFlags}
   * when present, otherwise
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

  /**
   * The *resolved* NaN policy for parameter position `i` (Contract B,
   * `docs/ERROR-MODEL.md` §4). An explicit `nanBehavior` declaration wins.
   * Otherwise, while the slot's declared carrier admits `nan` (bare
   * `number`, an inferred signature, a union with `nan`) the answer is
   * `'inert'` — `NaN` is an ordinary domain member and the handler owns
   * it. For a precise carrier that excludes `nan`, the derived default is
   * `'propagate'` when the carrier is a subtype of `complex` that is not a
   * subtype of `integer` and the result type is numeric, `'reject'`
   * otherwise. Recomputed from the current signature — never cached.
   */
  resolvedNanBehaviorAt(
    i: number
  ): 'reject' | 'propagate' | 'handle' | 'inert';

  /**
   * The *resolved* partiality of the declaration (Contract B): the
   * declared `partiality`, `'defined-when'` when a `definedWhen` predicate
   * is declared, and the sound `'may-marker'` default when nothing is.
   */
  readonly resolvedPartiality: 'total' | 'may-marker' | 'defined-when';

  /** True if operand position `i` may INVOKE a function-valued operand — the
   * per-position reader for the `invokes` flag of {@link OperatorDefinitionFlags}.
   * Missing
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

  /** The `Function` literal this definition was created from, verbatim —
   * `undefined` for a built-in operator, which has no body. Where
   * {@link lambda} is a canonicalized, structured VIEW for consumers, this is
   * the literal itself, the input the effects walk
   * (`inferFunctionLiteralEffects`) takes: re-deriving a definition's effect
   * set outside this module (the conformance-widening guard in
   * `engine-protocols.ts`) means re-running that walk over exactly the same
   * expression the install ran it over.
   * @internal */
  _lambdaLiteral?: Expression;

  /** Which shape the `type` handler takes: `'expressions'` (the legacy
   * shape — a function of the operand expressions) or `'types'` (a function
   * of operand descriptors, which cannot touch engine state). The flag is
   * what the dispatch reads; the handler's parameter count is never
   * inspected. */
  readonly typeHandlerKind: 'expressions' | 'types';

  /** If present, this handler can be used to more precisely determine the
   * return type based on the type of the arguments. The arguments themselves
   * should *not* be evaluated, only their types should be used.
   *
   * The shape of the stored handler is recorded by {@link typeHandlerKind};
   * a caller must dispatch on that flag before invoking it.
   */
  type?: OperatorTypeHandlerOnExpressions | OperatorTypeHandlerOnTypes;

  /** If present, this handler can be used to determine the sign of the
   *  return value of the function, based on the sign and type of its
   *  arguments.
   *
   * The arguments themselves should *not* be evaluated, only their types and
   * sign should be used.
   *
   * This can be used in some case for example to determine when certain
   * simplifications are valid.
   *
   * The handler MUST be a pure function of the operands: no evaluation
   * (`.evaluate()`, `.N()` — including indirectly, through helpers that
   * numericize a bound or probe a collection element), no canonicalization
   * of new expressions, no declarations. The type path dispatches `sgn`
   * handlers while deriving an application's type (the `sgn` operand fact),
   * so a handler that changes engine state invalidates the very caches the
   * derivation is filling. Audit record: open item O7 of
   * `docs/plans/2026-08-22-type-handlers-on-types.md`.
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
  _update(def: OperatorDefinition): void;

  /** Re-attach the definition's effect set to its signature after the
   * signature object was REPLACED by type inference. The two are one source of
   * truth and must never disagree.
   * @internal */
  _resyncEffects(): void;

  /** A lazily-evaluated override of this definition's effect set, or
   * `undefined` when the set is simply what was declared or inferred at
   * install time.
   *
   * Installed on protocol DISPATCHERS — whose effect set is the union of the
   * inferred effects of the registered conforming implementations of a BARE
   * requirement, and therefore changes as conformances register
   * (`docs/TYPE_SYSTEM_ROADMAP.md`, Appendix B, "Changing a field is an
   * effect") — and on lambda-backed definitions whose body inference
   * consulted such a union. The closure owns its own memoization and
   * re-entrancy guard; the `effects` / `pure` / `drawsRandom` / `signature`
   * accessors consult it before answering.
   * @internal */
  _deriveEffects: (() => EffectSet | undefined) | undefined;

  /** Opaque snapshot of every field a provisional re-derivation
   * (`installRebuiltLiteral` calling `_update({ evaluate })` on a
   * pre-existing definition) can mutate, for an exact restore by an
   * inference rollback frame — see
   * {@link _restoreRederivationSnapshot}. The result captures private
   * fields, so peeking or constructing one outside the implementation is
   * meaningless.
   * @internal */
  _rederivationSnapshot(): unknown;

  /** Restore the fields captured by {@link _rederivationSnapshot},
   * verbatim and identity-preserving (no effect re-sync: the captured
   * signature/effect pair was consistent when snapshotted).
   * @internal */
  _restoreRederivationSnapshot(snapshot: unknown): void;

  /** Snapshot EVERY mutable field of this record for the checkpoint journal
   * (`checkpoint-journal.ts`). Wider than {@link _rederivationSnapshot},
   * which covers only what an `{ evaluate }`-only update can touch: a
   * checkpoint has to rewind a full redefinition. Opaque, for the same
   * reason.
   * @internal */
  _checkpointSnapshot(): unknown;

  /** Restore the fields captured by {@link _checkpointSnapshot}, verbatim
   * and identity-preserving.
   * @internal */
  _restoreCheckpointSnapshot(snapshot: unknown): void;
}
