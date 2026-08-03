import type { MathJsonExpression } from '../../math-json/types.js';
import type {
  SimplifyOptions,
  ExplainOperation,
  ExplainOptions,
  Explanation,
  ReplaceOptions,
  PatternMatchOptions,
  Expression,
  BoxedBaseDefinition,
  BoxedOperatorDefinition,
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  IComputeEngine as ComputeEngine,
  Metadata,
  Rule,
  Sign,
  Substitution,
  BoxedDefinition,
  Scope,
  BoxedValueDefinition,
  ExpressionInput,
  FunctionInterface,
} from '../global-types.js';

import {
  broadcastLengthMismatch,
  isBroadcastableCollection,
  isBroadcastCollectionType,
  isFiniteIndexedCollection,
  isFixedShapeCollection,
  isKnownFinitenessBroadcast,
  isLinearAlgebraCollection,
  isNumericTuple,
  couldBeCollectionOperand,
  isPossiblyCollectionTyped,
  isTuple,
  isUnknownLengthBroadcast,
  lazyBroadcastMapIfNeeded,
  lazyMapNumericApproximation,
  zip,
} from '../collection-utils.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import {
  validElementMemo,
  elementMemoRecordingStream,
  elementMemoAt,
  elementMemoParanoid,
  enterParanoidCheck,
  exitParanoidCheck,
} from './collection-element-memo.js';
import {
  isNumber,
  isFunction,
  isString,
  isSymbol,
  isContinuationOperand,
} from './type-guards.js';
import {
  armHasValueParam,
  overloadArms,
  resolveOverload,
  triStateSelect,
} from './overload.js';
import { candidateShape } from './tensor-view.js';
import type {
  EffectLabel,
  FunctionSignature,
  NumericPrimitiveType,
} from '../../common/type/types.js';
import { Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';
import { isSubtype } from '../../common/type/subtype.js';
import { NUMERIC_TYPES } from '../../common/type/primitive.js';
import {
  absorbNumericAbsence,
  broadcastElementType,
  broadcastResultType,
  broadcastShapedResultType,
  functionResult,
  isSignatureType,
  narrow,
  numericMissingSlot,
  stripMissingFromType,
  typeContainsMissing,
  widen,
} from '../../common/type/utils.js';
import { NumericValue } from '../numeric-value/types.js';
import type { BigDecimal } from '../../big-decimal/index.js';

import { findUnivariateRoots } from './solve.js';
import { filterRootsByAssumptions } from './solve-domain.js';
import { solveSystem, solveOr } from './solve-system.js';
import { solveCongruence } from './solve-congruence.js';
import { replace } from './rules.js';
import { negate } from './negate.js';
import { simplifyValueBlind } from './simplify.js';
import { explainExpression } from './explain.js';
import { canonicalMultiply, mul, div, Product } from './arithmetic-mul-div.js';
import { add } from './arithmetic-add.js';
import { pow } from './arithmetic-power.js';
import { asSmallInteger } from './numerics.js';
import { gcd } from '../numerics/numeric.js';
import { _BoxedExpression } from './abstract-boxed-expression.js';
import { DEFAULT_COMPLEXITY, sortOperands } from './order.js';
import {
  hashCode,
  isOperatorDef,
  isValueDef,
  normalizedUnknownsForSolve,
} from './utils.js';
import { errorValue, isCollectionHead } from './error-value.js';
import { match } from './match.js';
import { factor } from './factor.js';
import { holdMap, holdMapAsync } from './hold.js';
import {
  positiveSign,
  nonNegativeSign,
  negativeSign,
  nonPositiveSign,
  sgn,
} from './sgn.js';
import { cachedValue, CachedValue } from './cache.js';
import { apply, lookupApplicable } from '../function-utils.js';
import { functionLiteralSignatureType } from './effects-inference.js';
import { isScalarType } from './function-literal.js';
import { applicationEffects, publicEffects } from './effects-of.js';
import type { ComputedEffects } from '../../common/type/effects.js';
import { isPureComputedEffects } from '../../common/type/effects.js';
import { checkDeadline } from '../../common/interruptible.js';
import {
  applyPoleOverride,
  isEligibleRealRewrite,
  onBranchCut,
} from '../function-properties/index.js';

/** When `materialization` is true, display 10 items if the collection is
 * infinite, otherwise 5 from the head and 5 from the tail
 */
const DEFAULT_MATERIALIZATION: [number, number] = [5, 5] as const;

/** Tick counter for the cooperative deadline checkpoint in
 * `_computeValue`/`_computeValueAsync`. Module-scoped (shared across
 * engines): the check reads the owning engine's deadline, the counter only
 * paces how often `Date.now()` is consulted. */
let _evalTick = 0;

/** Count of provisional (re-entrant) `_effectsOf` reads — see the cycle note
 * on `_effectsOf`. A computation that consumed one must not be frozen into
 * the memo. Monotonic; only ever compared before/after a computation. */
let _effectsProvisionalReads = 0;

/**
 * A boxed function expression represent an expression composed of an operator
 * (the name of the function) and a list of arguments. For example:
 * `["Add", 1, 2]` is a function expression with the operator "Add" and two
 * arguments 1 and 2.
 *
 * If canonical, it has a definition associated with it, based on the operator.
 *
 * The definition contains its signature and its evaluation handler.
 *
 */

export class BoxedFunction
  extends _BoxedExpression
  implements FunctionInterface
{
  override readonly _kind = 'function';

  // The operator of the function expression
  private readonly _operator: string;

  // The operands of the function expression
  private readonly _ops: ReadonlyArray<Expression>;

  // Only canonical expressions have an associated def (are bound)
  // If `null`, the expression is not bound, if `undefined`, the expression
  // is bound but no definition was found.
  private _def: BoxedDefinition | undefined | null;

  /** If the operator is scoped, the local scope associated with
   * the function expression
   */
  private _localScope: Scope | undefined;

  private _isStructural: boolean;

  private _hash: number | undefined;

  // Validity depends only on the (immutable) structure — the operator and
  // the operands' own validity — so it is computed once and cached. Without
  // the cache a parent's `isValid` re-walks every descendant on every query,
  // which is O(nodes × depth) for nested queries (Tycho item 75: 77% of a
  // large document import was spent in repeated `isValid` walks).
  private _isValid: boolean | undefined;

  // Cached properties of the expression
  private _value: CachedValue<Expression> = {
    value: null,
    generation: -1,
  };
  private _valueN: CachedValue<Expression> = {
    value: null,
    generation: -1,
  };
  private _sgn: CachedValue<Sign | undefined> = {
    value: null,
    generation: -1,
  };
  private _type: CachedValue<BoxedType | undefined> = {
    value: null,
    generation: -1,
  };
  /** The runtime effect channel (`effects-of.ts`). Generation-guarded like
   * `_type` and `_sgn`, and for a reason beyond speed: the projection resolves
   * a symbol operand through its CURRENT binding, so a reassignment — which
   * bumps `ce._generation` — must invalidate the answer. (`reset()` is an inert
   * stub and is NOT the invalidation mechanism.) `undefined` is a legitimate
   * cached value (the empty set); `null` is the miss marker.
   *
   * NOT managed through the shared `cachedValue` helper — see `_effectsOf`:
   * the projection can re-enter the same node through a binding cycle, and
   * `cachedValue`'s stamp-then-compute order returned the PREVIOUS
   * generation's value as current on the re-entrant read, freezing an
   * in-flight answer at the current generation. */
  private _effects: CachedValue<ComputedEffects> = {
    value: null,
    generation: -1,
  };

  /** Re-entrancy marker for `_effectsOf` — see the cycle note there. */
  private _effectsInFlight = false;

  /** The engine generation at which `_type` was last written or confirmed.
   * The cache KEY of `_type` (`undefined` for a pure constant, the generation
   * otherwise) costs a purity projection plus an `isConstant` subtree walk to
   * compute, so `get type` reads this first: within one generation both
   * `isPure` and `isConstant` are stable, so the key would come out exactly as
   * it did last time and `cachedValue` would hit — the recomputation cannot
   * change the answer. `-1` is "never computed" (generations start at 0). */
  private _typeGeneration = -1;

  constructor(
    ce: ComputeEngine,
    operator: string,
    ops: ReadonlyArray<Expression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      structural?: boolean;
      scope?: Scope;
    }
  ) {
    super(ce, options?.metadata);

    this._operator = operator;
    this._ops = ops;
    this._localScope = options?.scope;

    this._isStructural = options?.structural ?? false;
    if (options?.canonical || this._isStructural) this.bind();
  }

  // NOTE: this hash folds bound-variable NAMES (via each symbol operand's
  // name-keyed hash). That is sound because `isSame` compares bound
  // occurrences by name too (binding-identity equality, NOT
  // alpha-equivalence — see `same()` in compare.ts). If rename-invariant
  // equality is ever introduced, this hash must become alpha-invariant in the
  // same change, or equal expressions will hash differently and every hash
  // consumer (e.g. `match.ts` anchor bucketing) silently breaks.
  get hash(): number {
    if (this._hash !== undefined) return this._hash;

    let h = 0;
    for (const op of this._ops) h = ((h << 1) ^ op.hash) | 0;

    h = (h ^ hashCode(this._operator)) | 0;
    this._hash = h;
    return h;
  }

  /**
   * For function expressions, `infer()` infers the result type of the function
   * based on the provided type and inference mode.
   */
  infer(t: Type, inferenceMode?: 'narrow' | 'widen'): boolean {
    const def = this.operatorDefinition;
    if (!def || !def.inferredSignature) return false;

    // If the signature was inferred, refine it by narrowing the result
    if (def.signature.is('function')) {
      def.signature = new BoxedType(
        { kind: 'signature', result: t },
        this.engine._typeResolver
      );
    } else if (isSignatureType(def.signature.type)) {
      // Preserve the argument information when updating the result type
      const oldSig = def.signature.type;
      // A widen driven by a usage-site parameter constraint must not discard a
      // more precise inferred result: when the result already satisfies the
      // constraint (`vector<2>` used where `indexed_collection` is expected),
      // `widen(vector<2>, indexed_collection)` would coarsen it to the loose
      // constraint. Keep the precise type. (Narrowing is authoritative and is
      // left untouched.)
      if (inferenceMode !== 'narrow' && isSubtype(oldSig.result, t))
        return true;
      const nextSig: FunctionSignature = {
        kind: 'signature',
        args: oldSig.args,
        optArgs: oldSig.optArgs,
        variadicArg: oldSig.variadicArg,
        variadicMin: oldSig.variadicMin,
        result:
          inferenceMode === 'narrow'
            ? narrow(oldSig.result, t)
            : widen(oldSig.result, t),
      };
      // The effect specifier is part of the arrow and is not re-derivable from
      // the result-type inference: carry it across the rebuild.
      if (oldSig.effects !== undefined) nextSig.effects = oldSig.effects;
      def.signature = new BoxedType(nextSig, this.engine._typeResolver);
    }

    // The signature OBJECT was replaced. Re-attach the definition's effect set
    // so the arrow and the cached `_effects` the derived `pure`/`drawsRandom`
    // getters read stay in lockstep — otherwise an inferred `random` lambda
    // serializes pure the moment its result type is inferred.
    def._resyncEffects();

    this.engine._generation += 1;
    // Signature inference mutates a SHARED operator definition in place: a
    // semantic change other expressions may depend on.
    this.engine._mutationGeneration += 1;
    this.engine._semanticEpoch += 1;

    return true;
  }

  bind(): void {
    // Operator (function-application) position: an inner binding that
    // provably cannot be applied — a user symbol `N = 85` shadowing the
    // built-in `N` operator — defers to an outer applicable definition.
    this._def = lookupApplicable(
      this._operator,
      this._localScope ?? this.engine.context.lexicalScope
    );
  }

  reset(): void {
    // Note: a non-canonical expression is never bound
    // this._def = null;
  }

  get value(): Expression | undefined {
    return undefined;
  }

  get isCanonical(): boolean {
    return this._def !== undefined && this._def !== null && !this._isStructural;
  }

  /**
   * The runtime effect channel for this application — the projection rule of
   * `docs/EFFECTS-MODEL.md`, memoized behind the generation guard.
   *
   * Cycle-safe by construction, which the shared `cachedValue` helper is NOT:
   * the projection follows bindings, so a self-recursive definition's body
   * reaches its own nodes re-entrantly (body → self-application → the
   * binding's literal → body). `cachedValue` stamps the generation BEFORE
   * computing, so the re-entrant read saw a current-generation stamp with
   * the PREVIOUS generation's value still in the slot and returned it as
   * fresh — freezing an assign-time in-flight `'any'` (or, the unsound
   * direction, a stale pure) at the current generation, with the answer
   * depending on which node was read first. Here instead:
   *
   * - a re-entrant read answers `'any'` provisionally and marks the pass —
   *   conservative, never cached;
   * - the value is stamped only AFTER computing, and only when the
   *   computation consumed no provisional edge — a value derived from an
   *   in-flight `'any'` is returned but not frozen, so the next read
   *   recomputes it against settled answers.
   *
   * Nodes on a genuine cycle therefore recompute per read (bounded by the
   * body size); everything else caches exactly as before.
   * @internal
   */
  _effectsOf(): ComputedEffects {
    const generation = this.engine._generation;
    if (this._effects.generation === generation && this._effects.value !== null)
      return this._effects.value;

    if (this._effectsInFlight) {
      _effectsProvisionalReads += 1;
      return 'any';
    }

    this._effectsInFlight = true;
    const before = _effectsProvisionalReads;
    try {
      const value = applicationEffects(this);
      if (_effectsProvisionalReads === before) {
        this._effects.generation = generation;
        this._effects.value = value;
      }
      return value;
    } finally {
      this._effectsInFlight = false;
    }
  }

  /** A VIEW of the effect channel: "no impurity label in `effectsOf(expr)`"
   * (`docs/EFFECTS-MODEL.md`, "Runtime counterpart"). No longer independently
   * computed — the projection is strictly more precise than the old
   * `def.pure && every operand pure` rule: it resolves a symbol operand through
   * its binding (so `Map(xs, randomF)` is impure), and it stops at the two
   * boundaries where nothing is evaluated — a quote position (`Hold`) and a
   * `Function` literal, whose effects live on its own arrow. */
  get isPure(): boolean {
    return isPureComputedEffects(this._effectsOf());
  }

  /** The public view of the effect channel — see `publicEffects()`, which
   * erases the two internal distinctions (the co-finite form maps to `'any'`,
   * the stated-pure `[]` to `undefined`). */
  get effects(): ReadonlyArray<EffectLabel> | 'any' | undefined {
    return publicEffects(this._effectsOf());
  }

  get isConstant(): boolean {
    // Operands first: the walk stops at the first free variable, which is
    // cheaper than the effect projection `isPure` runs. Same conjunction,
    // both sides side-effect free.
    return this._ops.every((x) => x.isConstant) && this.isPure;
  }

  get json(): MathJsonExpression {
    const s = this.structural;
    const ops = isFunction(s) ? s.ops : this._ops;
    return [this._operator, ...ops.map((x) => x.json)];
  }

  get operator(): string {
    return this._operator;
  }

  get ops(): ReadonlyArray<Expression> {
    return this._ops;
  }

  get nops(): number {
    return this._ops.length;
  }

  get op1(): Expression {
    return this._ops[0] ?? this.engine.Nothing;
  }
  get op2(): Expression {
    return this._ops[1] ?? this.engine.Nothing;
  }
  get op3(): Expression {
    return this._ops[2] ?? this.engine.Nothing;
  }

  get isScoped(): boolean {
    return this._localScope !== undefined;
  }
  get localScope(): Scope | undefined {
    return this._localScope;
  }

  get isValid(): boolean {
    if (this._isValid !== undefined) return this._isValid;
    this._isValid =
      this._operator !== 'Error' && this._ops.every((x) => x?.isValid);
    return this._isValid;
  }

  /** Note: if the expression is not canonical, this will return a canonical
   * version of the expression in the current lexical scope.
   */
  get canonical(): Expression {
    if (this.isCanonical || !this.isValid) return this;
    return this.engine.function(this._operator, this._ops);
  }

  get structural(): Expression {
    if (this.isStructural) return this;
    const def = this.operatorDefinition;
    // Ellipsis fold barrier: an `Add`/`Multiply` with a direct
    // `ContinuationPlaceholder` operand is a notational object. Do not flatten
    // nested associative operands or sort — preserve source order and the
    // nested anchor structure (`2n`) in the serialized form.
    if (
      (def?.associative || def?.commutative) &&
      !this.ops.some((x) => isContinuationOperand(x))
    ) {
      // Flatten the arguments if they are the same as the operator
      const xs: Expression[] = this.ops.map((x) => x.structural);
      let ys: Expression[] = [];
      if (!def.associative) ys = xs;
      else {
        for (const x of xs) {
          if (isFunction(x, this.operator)) ys.push(...x.ops);
          else ys.push(x);
        }
      }
      return this.engine.function(
        this._operator,
        this.isValid ? sortOperands(this._operator, ys) : ys,
        {
          form: 'structural',
          metadata: {
            latex: this.verbatimLatex,
            sourceOffsets: this.sourceOffsets,
          },
        }
      );
    }
    return this.engine.function(
      this._operator,
      this.ops.map((x) => x.structural),
      {
        form: 'structural',
        metadata: {
          latex: this.verbatimLatex,
          sourceOffsets: this.sourceOffsets,
        },
      }
    );
  }

  get isStructural(): boolean {
    return this._isStructural;
  }

  toNumericValue(): [NumericValue, Expression] {
    console.assert(this.isCanonical || this.isStructural);

    const ce = this.engine;

    if (this.operator === 'Complex') {
      return [ce._numericValue({ re: this.op1.re, im: this.op2.re }), ce.One];
    }

    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let expr: Expression = this;

    //
    // Add
    //
    if (expr.operator === 'Add') {
      //  use factor() to factor out common factors
      expr = factor(expr);
      if (isNumber(expr)) {
        if (typeof expr.numericValue === 'number') {
          if (Number.isInteger(expr.numericValue))
            return [ce._numericValue(expr.numericValue), ce.One];
        } else if (expr.numericValue.isExact)
          return [expr.numericValue!, ce.One];
      }
      // if (expr.op !== 'Add') return expr.toNumericValue();
    }

    //
    // Negate
    //
    if (isFunction(expr, 'Negate')) {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.neg(), rest];
    }

    //
    // Multiply
    //
    if (isFunction(expr, 'Multiply')) {
      const rest: Expression[] = [];
      let coef = ce._numericValue(1);
      for (const arg of expr.ops) {
        const [c, r] = arg.toNumericValue();
        if (!c.isOne) coef = coef.mul(c);
        if (!r.isSame(1)) rest.push(r);
      }
      if (rest.length === 0) return [coef, ce.One];
      if (rest.length === 1) return [coef, rest[0]];
      return [coef, canonicalMultiply(ce, rest)];
    }

    //
    // Divide
    //
    if (isFunction(expr, 'Divide')) {
      const [coef1, numer] = expr.op1.toNumericValue();
      const [coef2, denom] = expr.op2.toNumericValue();
      const coef = coef1.div(coef2);
      if (denom.isSame(1)) return [coef, numer];
      return [coef, ce.function('Divide', [numer, denom])];
    }

    //
    // Power/Sqrt/Root
    //
    if (isFunction(expr, 'Power')) {
      // We can only extract a coef if the exponent is a literal
      if (!isNumber(expr.op2)) return [ce._numericValue(1), this];

      const [coef, base] = expr.op1.toNumericValue();
      if (coef.isOne) return [coef, this];

      // A canonical/structural Power never has a ½ exponent (it canonicalizes
      // to Sqrt), so only an integer exponent is extractable here.
      const exponent = asSmallInteger(expr.op2);
      if (exponent !== null)
        return [coef.pow(exponent), ce.function('Power', [base, expr.op2])];

      return [ce._numericValue(1), this];
    }

    if (isFunction(expr, 'Sqrt')) {
      const [coef, rest] = expr.op1.toNumericValue();
      // @fastpasth
      if (rest.isSame(1) || rest.isSame(0)) {
        if (coef.isOne || coef.isZero) return [coef, rest];
        return [coef.sqrt(), rest];
      }
      // √(k·u) = √k·√u only holds for k ≥ 0: for k < 0 it splits off a
      // constant imaginary phase, but the true value is region-dependent
      // (±i·√|k|·√|u| across u = 0). Fold the sign into the radicand
      // instead: √(k·u) = √|k|·√(−u).
      if (coef.sgn() === -1)
        return [coef.neg().sqrt(), ce.function('Sqrt', [rest.neg()])];
      return [coef.sqrt(), ce.function('Sqrt', [rest])];
    }

    if (isFunction(expr, 'Root')) {
      const exp = expr.op2.re;
      if (isNaN(exp) || expr.op2.im !== 0) return [ce._numericValue(1), this];

      const [coef, rest] = expr.op1.toNumericValue();
      // An even root of a negative coefficient cannot be extracted with
      // real arithmetic: NumericValue.root uses the real-root convention,
      // so (−u)^(1/4) would become −u^(1/4), which is not a 4th root of
      // −u (the −1 is the complex phase e^{iπ/4}). (A canonical Root never
      // has index 2 — that becomes Sqrt — so the Sqrt-style imaginary
      // extraction is not needed here.) This must run before the exactness
      // check below: NumericValue.root returns NaN here, and NaN reports as
      // exact.
      if (exp % 2 === 0 && coef.sgn() === -1)
        return [ce._numericValue(1), this];

      // Extracting an inexact root of an EXACT radicand leaks a float: it
      // either strands a symbolic remainder beside a float coefficient
      // (e.g. Root(2x,3) → ∛2·Root(x,3)) or, for a pure-number radicand,
      // floats the whole exact constant (Root(2,3) → 1.2599·Root(1,3)),
      // violating the exactness contract. Keep the whole radical symbolic
      // whenever the coefficient we would extract is inexact but the radicand
      // was exact. (A genuinely inexact radicand — a float — may still
      // numericize, since there is no exactness to preserve.)
      const root = coef.root(exp);
      if (!root.isExact && (!rest.isSame(1) || coef.isExact))
        return [ce._numericValue(1), this];
      return [root, ce.function('Root', [rest, expr.op2])];
    }

    //
    // Abs
    //
    if (isFunction(expr, 'Abs')) {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.abs(), ce.function('Abs', [rest])];
    }
    console.assert(expr.operator !== 'Complex');

    //
    // Exp/Log/Ln
    //
    // Exp and logarithms don't have numeric coefficients to extract.
    // Keep them symbolic - don't evaluate or expand.
    if (
      expr.operator === 'Exp' ||
      expr.operator === 'Log' ||
      expr.operator === 'Ln'
    )
      return [ce._numericValue(1), this];

    // @todo:  could consider others: Exp, trig functions

    return [ce._numericValue(1), expr];
  }

  /**
   * Note: the result is bound to the current scope, not the scope of the
   * original expression.
   * <!-- This may or may not be desirable -->
   */
  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): Expression {
    options ??= { canonical: undefined };

    // When the caller does not request a form, the receiver's form is
    // preserved: canonical → canonical, structural → structural, raw → raw.
    // A structural receiver must not be rebuilt canonical: that erases the
    // parse vocabulary structural form exists to preserve (`Subtract`,
    // `Divide`, `InvisibleOperator`, `Delimiter`, operand order) and folds its
    // exact literals. The operands are substituted shape-preservingly (see
    // `opOptions` below) and this node is boxed with `form: 'structural'`.
    const structuralForm =
      options.canonical === undefined && !this.isCanonical && this.isStructural;

    if (options.canonical === undefined)
      options = { canonical: structuralForm ? false : this.isCanonical };

    // A non-canonical (held) child of a canonical parent — e.g. the index
    // symbol of `Limits`, held by `lazy` so it is never canonicalized — must
    // stay raw: canonicalizing it here happens OUTSIDE its binding scope (an
    // index `i` would become the imaginary unit). The parent's canonical
    // handler receives it raw, as it did when the expression was first built.
    // (A raw symbol reports `isStructural: true`, so key on `isCanonical`.)
    // Under the structural arm each operand preserves its OWN form
    // (`canonical: undefined`): a structural operand stays structural — and
    // is returned by identity when nothing in it matched — while a held raw
    // operand stays raw.
    const opOptions = structuralForm ? { canonical: undefined } : options;
    const ops = this._ops.map((x) =>
      options!.canonical === true && !x.isCanonical
        ? x.subs(sub, { canonical: false })
        : x.subs(sub, opOptions)
    );

    const form = structuralForm
      ? 'structural'
      : options.canonical === true
        ? 'canonical'
        : options.canonical === false
          ? 'raw'
          : options.canonical;

    if (!ops.every((x) => x.isValid))
      return this.engine.function(this._operator, ops, { form: 'raw' });

    // Nothing in this subtree matched the substitution (every operand came
    // back identical) and the node is already in the requested form:
    // rebuilding it would re-canonicalize an unchanged tree. Return `this`.
    // (A `CanonicalForm[]` request is not a plain canonicalization, so it
    // always rebuilds.)
    if (
      (form === 'canonical' ? this.isCanonical : form === 'structural') &&
      ops.every((x, i) => x === this._ops[i])
    )
      return this;

    return this.engine.function(this._operator, ops, { form });
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: Partial<ReplaceOptions>
  ): Expression | null {
    return replace(this, rules, options).at(-1)?.value ?? null;
  }

  match(
    pattern: string | ExpressionInput,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  has(v: string | string[]): boolean {
    // Does the operator name match?
    if (typeof v === 'string') {
      if (this._operator === v) return true;
    } else if (v.includes(this._operator)) return true;

    // Do any of the operands match?
    return this._ops.some((x) => x.has(v));
  }

  /**
   * The nominal value of a `Measurement(value, error)`, or `undefined` for
   * every other operator.
   *
   * `Measurement` types as its nominal's scalar type (see `measurementType()`),
   * so `Integrate(…).N()` reports `finite_real` and `isNumber === true`. The
   * numeric read surface has to honor that: a head that claims to be a real
   * number and then answers `NaN` to every numeric accessor is not a strict
   * contract, it is an unfinished one — and the failure is silent, because a
   * consumer reading `.re` cannot tell a poisoned read from a genuine `NaN`.
   * So the numeric accessors below project the nominal; the uncertainty stays
   * reachable through `.ops`/`op2` (after an `isFunction()` narrow) and the
   * MathJSON. `re`/`im` are the channel, and they are sufficient: a
   * `Measurement` is a quadrature result, so its nominal is never an exact
   * number.
   *
   * Deliberately NOT projected, all three for the same reason — a `Measurement`
   * is a FUNCTION expression, and the number-literal surface belongs behind the
   * `isNumber()` guard, which narrows on expression kind:
   * - `numericValue`, declared only on `NumberLiteralInterface`. Projecting it
   *   would advertise an exact numeric representation this expression does not
   *   have, on a surface a `Measurement` cannot legitimately narrow to.
   * - `isNumberLiteral`, for the same reason — claiming it would hand callers a
   *   `BoxedNumber` interface this expression does not implement.
   * - `value`, documented as the expression itself for a literal and
   *   `undefined` for a symbolic expression; a `Measurement` is the latter.
   */
  private get _measurementNominal(): Expression | undefined {
    if (this._operator !== 'Measurement' || this._ops.length === 0)
      return undefined;
    return this._ops[0];
  }

  get re(): number {
    return this._measurementNominal?.re ?? super.re;
  }

  get im(): number {
    return this._measurementNominal?.im ?? super.im;
  }

  get bignumRe(): BigDecimal | undefined {
    return this._measurementNominal?.bignumRe ?? super.bignumRe;
  }

  get bignumIm(): BigDecimal | undefined {
    return this._measurementNominal?.bignumIm ?? super.bignumIm;
  }

  valueOf(): number | number[] | number[][] | number[][][] | string | boolean {
    return this._measurementNominal?.valueOf() ?? super.valueOf();
  }

  get sgn(): Sign | undefined {
    const nominal = this._measurementNominal;
    if (nominal) return nominal.sgn;

    // Operands first — see the note on the same conjunction in `get type`.
    const gen =
      this._ops.every((x) => x.isConstant) && this.isPure
        ? undefined
        : this.engine._generation;
    return cachedValue(this._sgn, gen, () => {
      if (!this.isValid || this.isNumber !== true) return undefined;
      return sgn(this);
    });
  }

  get isNaN(): boolean | undefined {
    if (!this.isNumber) return false;
    return undefined; // We don't know until we evaluate
  }

  get isInfinity(): boolean | undefined {
    if (!this.isNumber) return false;
    // Type fallback: the static type can prove non-finiteness where no
    // structural analysis can — e.g. `Ln(0)` types `non_finite_number`. That
    // type is exactly the signed infinities (PositiveInfinity,
    // NegativeInfinity — no NaN member, and no ComplexInfinity, which is
    // typed `complex`), so it entails "is infinite". The type is already
    // computed and cached at this point (consulted by `isNumber` on entry).
    const t = this.type;
    if (!t.isUnknown && isSubtype(t.type, 'non_finite_number')) return true;
    return undefined; // We don't know until we evaluate
  }

  // Not +- Infinity, not NaN
  get isFinite(): boolean | undefined {
    if (this.isNumber !== true) return false;
    if (this.isNaN === true || this.isInfinity === true) return false;

    // Propagate finiteness structurally through arithmetic heads of finite
    // operands. This lets finite symbolic constants like √π or 1/π report
    // `isFinite === true` before the expression is evaluated to a number,
    // rather than the conservative `undefined` returned by the fallthrough.
    // "Definitely nonzero" is established via a known sign, mirroring the
    // ∞/finite divide rule. (BoxedExpression has no `isZero` getter; the
    // public expression surface exposes the sign predicates, and a definite
    // sign — e.g. π is positive — entails nonzero.)
    const isNonZero = (x: Expression): boolean =>
      x.isPositive === true || x.isNegative === true;
    switch (this.operator) {
      case 'Abs':
        // |x| is finite iff x is finite (real or complex).
        return this.op1.isFinite;
      case 'Sqrt':
        // √x is finite iff x is finite (real or complex).
        return this.op1.isFinite;
      case 'Root': {
        // ⁿ√x is finite iff x is finite and the index n is finite & nonzero.
        const radicand = this.op1.isFinite;
        const index = this.op2.isFinite;
        if (radicand === false || index === false) return undefined;
        if (radicand === true && index === true && isNonZero(this.op2))
          return true;
        break;
      }
      case 'Power': {
        const base = this.op1.isFinite;
        const exp = this.op2.isFinite;
        // bᵉ of finite base and exponent is finite, except 0 to a non-positive
        // exponent (0⁰ indeterminate, 0⁻ⁿ infinite). Require either a
        // definitely-nonzero base or a definitely-positive exponent.
        if (base === true && exp === true) {
          if (isNonZero(this.op1)) return true;
          if (this.op2.isPositive === true) return true;
        }
        break;
      }
      case 'Divide': {
        // n/d is finite iff both are finite and the denominator is definitely
        // nonzero (could-be-zero denominators are left unknown).
        const num = this.op1.isFinite;
        const den = this.op2.isFinite;
        if (num === true && den === true && isNonZero(this.op2)) return true;
        break;
      }
    }

    // A type-provable non-finite expression (e.g. `Ln(0)`) never reaches here:
    // `isInfinity` consults the static type and the early-return above already
    // answered `false`. See `get isInfinity` for that type-consult site.
    if (this.isNaN === undefined || this.isInfinity === undefined)
      return undefined;
    return true;
  }

  // Internal negative-guard helpers (never return `true`): used only via
  // `this` within BoxedFunction. Not part of the public expression surface —
  // hence the `_` prefix. Use `.is(1)` / `.is(-1)` for a real equality check.
  get _isOne(): boolean | undefined {
    if (this.isNonPositive === true || this.isReal === false) return false;
    return undefined;
  }

  get _isNegativeOne(): boolean | undefined {
    if (this.isNonNegative === true || this.isReal === false) return false;
    return undefined;
  }

  // x > 0
  get isPositive(): boolean | undefined {
    return positiveSign(this.sgn);
  }

  // x >= 0
  get isNonNegative(): boolean | undefined {
    return nonNegativeSign(this.sgn);
  }

  // x < 0
  get isNegative(): boolean | undefined {
    return negativeSign(this.sgn);
  }

  // x <= 0
  get isNonPositive(): boolean | undefined {
    return nonPositiveSign(this.sgn);
  }

  get numerator(): Expression {
    return this.numeratorDenominator[0];
  }

  get denominator(): Expression {
    return this.numeratorDenominator[1];
  }

  get numeratorDenominator(): [Expression, Expression] {
    if (!(this.isCanonical || this.isStructural))
      return [this, this.engine.One];
    if (this.isNumber !== true)
      return [this.engine.Nothing, this.engine.Nothing];

    const operator = this.operator;
    if (operator === 'Divide') return [this.op1, this.op2];

    if (operator === 'Negate') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.neg(), denom];
    }

    if (operator === 'Power') {
      const [num, denom] = this.op1.numeratorDenominator;
      // A literal negative exponent belongs in the denominator:
      // `x^-2` → `[1, x^2]`. Without this a *bare* negative power reported a
      // denominator of `1`, while the same factor inside a `Multiply` (routed
      // through `Product.asNumeratorDenominator`, which splits on exponent
      // sign) reported `x^2` — so `1/x^2` and `y/x^2` disagreed. A symbolic
      // exponent keeps the old behavior: its sign is not decidable here.
      const exponent = this.op2;
      if (isNumber(exponent) && exponent.isNegative === true) {
        const e = exponent.neg();
        return [denom.pow(e), num.pow(e)];
      }
      return [num.pow(exponent), denom.pow(exponent)];
    }

    if (operator === 'Root') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.root(this.op2), denom.root(this.op2)];
    }

    if (operator === 'Sqrt') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.sqrt(), denom.sqrt()];
    }

    if (operator === 'Abs') {
      const [num, denom] = this.op1.numeratorDenominator;
      return [num.abs(), denom.abs()];
    }

    if (operator === 'Multiply')
      return new Product(this.engine, this.ops!).asNumeratorDenominator();

    if (operator === 'Add') {
      // @todo: we could try to factor out common factors
    }

    if (operator === 'Log' || operator === 'Ln') {
      // @todo: we could isolate the base
    }

    return [this, this.engine.One];
  }

  factors(): ReadonlyArray<Expression> {
    const op = this.operator;
    if (op === 'Multiply') {
      const result: Expression[] = [];
      for (const arg of this.ops) result.push(...arg.factors());
      return result;
    }
    if (op === 'Negate') {
      return [this.engine.number(-1), ...this.op1.factors()];
    }
    return [this];
  }

  toRational(): [number, number] | null {
    const op = this.operator;
    if (op === 'Divide' || op === 'Rational') {
      const num = this.op1.re;
      const den = this.op2.re;
      if (Number.isInteger(num) && Number.isInteger(den) && den !== 0) {
        const g = gcd(Math.abs(num), Math.abs(den));
        const sign = den < 0 ? -1 : 1;
        return [(sign * num) / g, (sign * den) / g];
      }
      return null;
    }
    if (op === 'Negate') {
      const r = this.op1.toRational();
      return r ? [-r[0], r[1]] : null;
    }
    return null;
  }

  //
  //
  // ALGEBRAIC OPERATIONS
  //

  neg(): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    return negate(this);
  }

  inv(): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    if (this._isOne) return this;
    if (this._isNegativeOne) return this;

    // 1/√u = √(1/u) only holds for u ≥ 0: on the negative real axis the
    // principal branch gives 1/√(-a) = -i/√a but √(-1/a) = +i/√a
    if (this.operator === 'Sqrt' && this.op1.isNonNegative === true)
      return this.op1.inv().sqrt();
    if (this.operator === 'Divide') return this.op2.div(this.op1);
    if (this.operator === 'Power') {
      const neg = this.op2.neg();
      if (neg.operator !== 'Negate') return this.op1.pow(neg);
      return this.engine.function('Power', [this.op1, neg]);
    }
    if (this.operator === 'Root') {
      // `root()` normalizes a negative index to the reciprocal-of-root form
      // (see the `e < 0` chokepoint there), so `x.root(-n)` yields
      // `Divide(1, Root(x, n))` — no negative-index `Root(a, -n)` (#13).
      const neg = this.op2.neg();
      if (neg.operator !== 'Negate') return this.op1.root(neg);
      return this.engine.function('Root', [this.op1, neg]);
    }
    if (this.operator === 'Exp') return this.engine.E.pow(this.op1.neg());
    if (this.operator === 'Rational') return this.op2.div(this.op1);
    if (this.operator === 'Negate') return this.op1.inv().neg();

    return this.engine._fn('Divide', [this.engine.One, this]);
  }

  abs(): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    if (this.operator === 'Abs' || this.operator === 'Negate') return this;
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | Expression): Expression {
    if (rhs === 0) return this;
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    return add(this, this.engine.expr(rhs));
  }

  mul(rhs: NumericValue | number | Expression): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    if (rhs === 0) return this.engine.Zero;
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();

    if (rhs instanceof NumericValue) {
      if (rhs.isZero) return this.engine.Zero;
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
    }

    return mul(this, this.engine.expr(rhs));
  }

  div(rhs: number | Expression): Expression {
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');
    return div(this, rhs);
  }

  pow(exp: number | Expression): Expression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(exp: number | Expression): Expression {
    if (
      !(this.isCanonical || this.isStructural) ||
      (typeof exp !== 'number' && !(exp.isCanonical || exp.isStructural))
    )
      throw new Error('Not canonical');

    const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

    if (e === 0) return this.engine.NaN;
    if (e === 1) return this;
    if (e === -1) return this.inv();
    if (e === 2) return this.engine.function('Sqrt', [this]);

    // root(a^b, c) -> a^(b/c)
    if (this.operator === 'Power' && e !== undefined) {
      const [base, power] = this.ops;
      return base.pow(power.div(e));
    }

    if (this.operator === 'Divide') {
      const [num, denom] = this.ops;
      return num.root(exp).div(denom.root(exp));
    }

    // (-x)^n = (-1)^n x^n
    if (this.operator === 'Negate') {
      if (e !== undefined) {
        if (e % 2 === 0) return this.op1.root(exp);
        return this.op1.root(exp).neg();
      }
    }

    // root(sqrt(a), c) -> root(a, 2*c)
    if (this.operator === 'Sqrt') {
      if (e !== undefined) return this.op1.root(e * 2);
      if (typeof exp !== 'number') return this.op1.root(exp.mul(2));
    }

    // root(root(a, b), c) -> root(a, b*c)
    if (this.operator === 'Root') {
      const [base, root] = this.ops;
      return base.root(root.mul(exp));
    }

    if (this.operator === 'Multiply') {
      const ops = this.ops.map((x) => x.root(exp));
      return mul(...ops);
    }

    if (this.isNumberLiteral) {
      const v = this.numericValue!;
      if (typeof v === 'number') {
        if (v < 0) return this.engine.NaN;
        if (v === 0) return this.engine.Zero;
        if (v === 1) return this.engine.One;
        if (e !== undefined) {
          const r = this.engine.number(Math.pow(v, 1 / e));
          if (!r.isFinite || r.isInteger) return r;
        }
      } else {
        if (v.isOne) return this.engine.One;
        if (v.isZero) return this.engine.Zero;
        if (e !== undefined) {
          const r = v.root(e);
          if (r.isExact) return this.engine.number(r);
        }
      }
    }

    // A negative root index denotes a reciprocal. Normalize to the
    // reciprocal-of-(positive-index)-root form so a negative-index root
    // (`Root(a, -n)`, which serializes as the nonstandard, unparseable
    // `\sqrt[-n]{a}`) is never produced. This makes negative unit-fraction
    // exponents uniform with `x^{-1/2} → 1/√x`: `x^{-1/3} → 1/∛x` rather than
    // `Root(x, -3)` (#13). Placed after the reduction cases above so nested
    // radicals still combine first (`1/∛√x → 1/Root(x, 6)`).
    if (e !== undefined && e < 0 && Number.isInteger(e))
      return this.engine._fn('Divide', [this.engine.One, this.root(-e)]);

    return this.engine._fn('Root', [this, this.engine.expr(exp)]);
  }

  sqrt(): Expression {
    return this.root(2);
  }

  ln(semiBase?: number | Expression): Expression {
    const base = semiBase ? this.engine.expr(semiBase) : undefined;
    if (!(this.isCanonical || this.isStructural))
      throw new Error('Not canonical');

    // Mathematica returns `Log[0]` as `-∞`
    if (this.isSame(0)) return this.engine.NegativeInfinity;

    // ln(exp(x)) = x (for natural log)
    // ln_c(exp(x)) = x / ln(c) (for other bases)
    if (this.operator === 'Exp') {
      if (!base) return this.op1; // natural log
      return this.op1.div(base.ln()); // log_c(e^x) = x / ln(c)
    }

    // ln_c(c) = 1
    if (base && this.isSame(base)) return this.engine.One;

    // ln(e) = 1
    // ln_c(e) = 1 / ln(c)
    if (this.isSame(this.engine.E)) {
      if (!base) return this.engine.One; // ln(e) = 1
      return this.engine.One.div(base.ln()); // log_c(e) = 1/ln(c)
    }

    // ln(e^x) = x (for natural log)
    // ln_c(e^x) = x / ln(c) (for other bases)
    if (this.operator === 'Power') {
      const [b, exp] = this.ops;
      if (b.isSame(this.engine.E)) {
        if (!base) return exp; // natural log: ln(e^x) = x
        return exp.div(base.ln()); // log_c(e^x) = x / ln(c)
      }
      // ln(bⁿ) → n·ln(b) is unconditionally sound when b ≥ 0.
      if (b.isNonNegative === true) return exp.mul(b.ln(base));
      // ln(b^{2k}) → 2k·ln(|b|) — sound for every real b (SYM P0-2); this was
      // the fail-open bug (`2·ln(b)` instead of `2·ln|b|`). Independent of the
      // branch cut. Requires a real-eligible base (bail on a declared-complex
      // one, SYM P0-4 / D4).
      if (exp.isEven === true && isEligibleRealRewrite(b))
        return exp.mul(this.engine._fn('Abs', [b]).ln(base));
      // ln(bⁿ) → n·ln(b) for a non-even exponent: the documented generic-real
      // convention (D4) — fire for a real-eligible base unless it is provably on
      // Ln's branch cut (the negative real axis, where the principal values
      // differ by a multiple of 2πi, e.g. ln(b³) = 3ln(b) is wrong at b = -3).
      // Three-valued (D3): `onBranchCut !== true` keeps the convention on
      // unknown-sign bases while blocking provably-negative ones; the
      // eligibility gate blocks a declared-complex base (SYM P0-4).
      if (
        isEligibleRealRewrite(b) &&
        onBranchCut(this.engine, 'Ln', b) !== true
      )
        return exp.mul(b.ln(base));
    }

    // ln_c(a^(1/b)) = ln_c(root(a, b)) = 1/b ln_c(a) — real-eligible base, not
    // provably on the cut (D3/D4 generic-real convention).
    if (this.operator === 'Root') {
      const [a, b] = this.ops;
      if (
        a.isNonNegative === true ||
        (isEligibleRealRewrite(a) && onBranchCut(this.engine, 'Ln', a) !== true)
      )
        return a.ln(base).div(b);
    }

    // ln_c(√a) = 1/2 ln_c(a) — sound on the whole plane (√ shares Ln's
    // principal branch, so ln(√a) and ½ln(a) agree even for a < 0).
    if (this.operator === 'Sqrt') return this.op1.ln(base).div(2);

    // ln_c(a/b) = ln_c(a) - ln_c(b) — both operands real-eligible and not
    // provably on the cut (D3/D4 generic-real convention). (Unconstrained
    // operands round-trip through the ln-combine rule, so this leaves `ln(x/y)`
    // unchanged; it drives `ln(1/x) → -ln(x)`.)
    if (this.operator === 'Divide') {
      const num = this.op1;
      const den = this.op2;
      if (
        (num.isNonNegative === true ||
          (isEligibleRealRewrite(num) &&
            onBranchCut(this.engine, 'Ln', num) !== true)) &&
        (den.isNonNegative === true ||
          (isEligibleRealRewrite(den) &&
            onBranchCut(this.engine, 'Ln', den) !== true))
      )
        return num.ln(base).sub(den.ln(base));
    }

    // log_base(x) for any base — keep the base instead of dropping it (a
    // non-integer base previously fell through to a base-less `Ln`).
    if (base !== undefined) {
      // ln_10(x) -> log(x)
      if (base.re === 10) return this.engine._fn('Log', [this]);
      // ln_n(x) -> log_n(x)
      return this.engine._fn('Log', [this, base]);
    }
    return this.engine._fn('Ln', [this]);
  }

  get complexity(): number | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!(this.isCanonical || this.isStructural)) return undefined;
    return this.operatorDefinition?.complexity ?? DEFAULT_COMPLEXITY;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    if (!this._def) return undefined;
    return isOperatorDef(this._def) ? this._def.operator : this._def.value;
  }

  get operatorDefinition(): BoxedOperatorDefinition | undefined {
    if (!this._def) return undefined;
    return isOperatorDef(this._def) ? this._def.operator : undefined;
  }

  get valueDefinition(): BoxedValueDefinition | undefined {
    if (!this._def) return undefined;
    return isValueDef(this._def) ? this._def.value : undefined;
  }

  get isNumber(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    return isSubtype(this.type.type, 'number');
  }

  get isInteger(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    return isSubtype(this.type.type, 'integer');
  }

  get isRational(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    // integers are rationals
    return isSubtype(this.type.type, 'rational');
  }

  get isReal(): boolean | undefined {
    if (this.type.isUnknown) return undefined;
    // rationals and integers are real
    return isSubtype(this.type.type, 'real');
  }

  get isFunctionExpression(): true {
    return true;
  }

  /** The type of the value of the function */
  get type(): BoxedType {
    const generation = this.engine._generation;
    // Fast path: the cache was already consulted at this generation, so the
    // key it was consulted with — which costs a purity projection and an
    // `isConstant` subtree walk — is necessarily the same one now. See
    // `_typeGeneration`.
    if (this._typeGeneration === generation && this._type.value !== null)
      return this._type.value ?? BoxedType.unknown;

    // `isConstant` is tested FIRST: it fails at the first free variable — the
    // overwhelmingly common case for a row being canonicalized — whereas
    // `isPure` runs the whole effect projection, which resolves symbol
    // operands through their bindings and can force a stored function
    // literal's arrow. Both are side-effect-free predicates, so the order is
    // free; only the cost differs.
    const gen =
      this._ops.every((x) => x.isConstant) && this.isPure
        ? undefined
        : this.engine._generation;
    const result =
      cachedValue(
        this._type,
        gen,
        () => new BoxedType(type(this), this.engine._typeResolver)
      ) ?? BoxedType.unknown;
    // Record the generation OBSERVED ON ENTRY: a computation that bumped the
    // generation (signature inference does) must leave the fast path closed.
    this._typeGeneration = generation;
    return result;
  }

  /** The shape of the tensor (dimensions), derived from the type */
  get shape(): number[] {
    const t = this.type.type;
    if (typeof t === 'object' && t.kind === 'list' && t.dimensions)
      return t.dimensions;
    return [];
  }

  /** The rank of the tensor (number of dimensions), derived from the type */
  get rank(): number {
    return this.shape.length;
  }

  simplify(options?: Partial<SimplifyOptions>): Expression {
    // A deadline is armed only by an enclosing `withTimeLimit` span; work
    // outside a span runs unbounded. The simplify main loop checks the
    // ambient deadline (`engine._deadlineFrame`) if one is in effect.
    return simplifyValueBlind(this, options).at(-1)?.value ?? this;
  }

  explain(operation?: ExplainOperation, options?: ExplainOptions): Explanation {
    return explainExpression(this, operation, options);
  }

  evaluate(options?: Partial<EvaluateOptions>): Expression {
    // A deadline is armed only by an enclosing `withTimeLimit` span; work
    // outside a span runs unbounded. Evaluation checkpoints the ambient
    // deadline (`engine._deadlineFrame`) if one is in effect.
    return this._computeValue(options)();
  }

  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<Expression> {
    return this._computeValueAsync(options)();
  }

  N(): Expression {
    return this.evaluate({ numericApproximation: true });
  }

  solve(
    vars?: Iterable<string> | string | Expression | Iterable<Expression>
  ):
    | null
    | ReadonlyArray<Expression>
    | Record<string, Expression>
    | Array<Record<string, Expression>> {
    const varNames = normalizedUnknownsForSolve(vars ?? this.unknowns);

    // Handle List or And of equations (system of equations)
    if (this.operator === 'List' || this.operator === 'And') {
      const result = solveSystem(this.engine, this.ops, varNames);
      if (result !== null) return result;
    }

    // Handle Or: solve each operand independently, merge results
    if (this.operator === 'Or') {
      return solveOr(this.ops, varNames);
    }

    // Existing univariate solving
    if (varNames.length !== 1) return null;

    // Linear congruence `Congruent(lhs, rhs, m)` in one unknown: emit the
    // parametric residue family. Decline (undefined) falls through to the
    // ordinary root finder.
    if (this.operator === 'Congruent') {
      const congruenceRoots = solveCongruence(this.engine, this, varNames[0]);
      if (congruenceRoots !== undefined)
        return filterRootsByAssumptions(
          this.engine,
          congruenceRoots,
          varNames[0]
        );
    }

    const roots = findUnivariateRoots(this, varNames[0]);
    if (roots === null) return null;
    // Route in-scope bound assumptions on the unknown through the same root
    // filter the domain pipeline uses: `assume(n > 0)` should drop the negative
    // root of `n^2 = 16`. Applied at this OUTER boundary (not inside the
    // recursive `findUnivariateRoots`, which re-enters with substituted
    // variables) so both `expr.solve('n')` and the `Solve` operator benefit.
    return filterRootsByAssumptions(this.engine, roots, varNames[0]);
  }

  get isCollection(): boolean {
    if (!this.isValid) return false;
    const def = this.baseDefinition?.collection;

    // A collection has at least a count handler and an iterator
    console.assert(
      !def || (def.count !== undefined && def.iterator !== undefined)
    );

    if (def === undefined) return false;
    // An operator whose collection-ness depends on its operands (e.g. `When`,
    // a collection only when the value it guards is one) opts out per-instance.
    return def.isCollection?.(this) ?? true;
  }

  /**
   * True if this instance explicitly opted out of being a collection via an
   * `isCollection` handler returning false (e.g. a `Tuple`-valued `When`).
   * Its remaining collection handlers are inert and must not be consulted.
   *
   * Note this is deliberately narrower than `!isCollection`: an *eager*
   * collection operator (e.g. `UnicodeScalars`) has no collection handlers at
   * all until it is evaluated, and must still go through the
   * materialize-then-iterate path in `each()`.
   */
  private get _optedOutOfCollection(): boolean {
    return this.baseDefinition?.collection?.isCollection?.(this) === false;
  }

  get isIndexedCollection(): boolean {
    if (!this.isValid) return false;
    const def = this.baseDefinition?.collection;

    // If there is no `at` handler, it is definitely not indexed
    if (!def?.at) return false;

    // An operator that opted out of being a collection for THIS instance is
    // not an indexed collection either — the handlers are present but inert,
    // and reporting otherwise contradicts `isCollection` (e.g. a `Tuple`-
    // valued `When`, which is deliberately not broadcast over).
    if (this._optedOutOfCollection) return false;

    // If there is an `at` handler, it _may_ be indexed.
    // We check the actual result type, e.g. Map has an at handler
    // (to access its keys), but can be indexed or not, depending on the
    // input collection

    return this.type.matches('indexed_collection');
  }

  get isLazyCollection(): boolean {
    if (!this.isValid) return false;
    if (this._optedOutOfCollection) return false;
    return this.baseDefinition?.collection?.isLazy?.(this) ?? false;
  }

  contains(rhs: Expression): boolean | undefined {
    if (this._optedOutOfCollection) return undefined;
    return this.baseDefinition?.collection?.contains?.(this, rhs);
  }

  get count(): number | undefined {
    if (this._optedOutOfCollection) return undefined;
    return this.operatorDefinition?.collection?.count?.(this);
  }

  get isEmptyCollection(): boolean | undefined {
    if (!this.isCollection) return undefined;
    return this.operatorDefinition?.collection?.isEmpty?.(this);
  }

  get isFiniteCollection(): boolean | undefined {
    if (!this.isCollection) return undefined;
    return this.operatorDefinition?.collection?.isFinite?.(this);
  }

  each(): Generator<Expression> {
    // An operator that opted out of being a collection for THIS instance has
    // inert handlers: enumerate nothing rather than iterate a scalar.
    if (this._optedOutOfCollection) return (function* () {})();

    // Element memo (Tycho item 126): a flagged lazy operator serves a
    // repeated walk of an unmodified instance from its cached elements
    // instead of re-evaluating the element function.
    const memoized = this.operatorDefinition?.collection?.elementMemo === true;
    const memoEngine = this.engine;
    if (memoized) {
      const cached = validElementMemo(this);
      // Serve only a COMPLETE cache — a partial prefix (fill-to-n path)
      // covers `at()` reads, not a whole-collection walk.
      if (cached?.complete) {
        // Paranoid canary (design §3, dependency-precise invalidation):
        // under CE_MEMO_PARANOID, cross-check the served cache against a
        // live re-walk. A divergence means a dependency-closure leak —
        // under precise invalidation that is a stale-serve correctness
        // bug, not a spurious refill. Pure bodies only: an impure body
        // (Random) legitimately differs on a re-walk by ruling. The
        // enter/exit latch prevents re-entry (the re-walk, `isPure`, or a
        // diagnostic serialization can reach `each()` again — `toString()`
        // MATERIALIZES a collection); messages deliberately avoid
        // serializing `this` for the same reason.
        if (elementMemoParanoid() && enterParanoidCheck()) {
          try {
            if (this.isPure) {
              const live =
                this.operatorDefinition?.collection?.iterator?.(this);
              if (live) {
                const cachedEls = cached.elements;
                let i = 0;
                let r = live.next();
                while (!r.done && i < cachedEls.length) {
                  console.assert(
                    r.value.isSame(cachedEls[i]),
                    `CE_MEMO_PARANOID: element memo diverged at index ${i + 1} of a ${this.operator} instance`
                  );
                  i++;
                  r = live.next();
                }
                console.assert(
                  r.done === true && i === cachedEls.length,
                  `CE_MEMO_PARANOID: element memo length diverged for a ${this.operator} instance`
                );
              }
            }
          } finally {
            exitParanoidCheck();
          }
        }
        const elements = cached.elements;
        return (function* () {
          let i = 0;
          for (const el of elements) {
            // Match the live path's deadline cadence — a capped cache can
            // still hold 100k elements.
            if ((++i & 0xff) === 0) checkDeadline(memoEngine._deadlineFrame);
            yield el;
          }
        })();
      }
    }

    let iter = this.operatorDefinition?.collection?.iterator?.(this);

    if (!iter) {
      // No lazy iterator of our own. An *eager* collection operator (e.g.
      // `UnicodeScalars(s)`, `Characters(s)`) only materializes a concrete
      // collection when evaluated; a lazy op that wraps such a source
      // (`Map`, `Filter`, `Reduce`, …) keeps it un-evaluated and would
      // otherwise iterate nothing. Evaluate once and iterate the materialized
      // result by building its iterator here (not via `evaluated.each()`),
      // so this branch is never re-entered — no recursion.
      const evaluated = this.evaluate();
      if (evaluated !== this)
        iter = evaluated.operatorDefinition?.collection?.iterator?.(evaluated);

      // Return an empty generator if no iterator is defined
      if (!iter) return (function* () {})();
    }

    const engine = this.engine;
    const source: Iterator<Expression, undefined> = (function* () {
      let result = iter.next();
      let i = 0;
      while (!result.done) {
        // Enumeration can be unbounded (infinite or very large lazy
        // collections): respect the engine evaluation deadline.
        if ((++i & 0xff) === 0) checkDeadline(engine._deadlineFrame);
        yield result.value;
        result = iter.next();
      }
      return undefined;
    })();

    // A memoized instance records this walk and commits it as the element
    // cache if (and only if) it is drained to completion. A provably
    // infinite instance (`Iterate`, a `Map` over an infinite `Range`) can
    // never complete a drain, so recording would be pure buffering waste —
    // skip it. (`undefined` finiteness still records: the drain may finish.)
    if (memoized && this.isFiniteCollection !== false)
      return elementMemoRecordingStream(this, source);

    return source as Generator<Expression>;
  }

  at(index: number): Expression | undefined {
    if (this._optedOutOfCollection) return undefined;
    const handler = this.operatorDefinition?.collection?.at;
    if (!handler) return undefined;

    // Centralize negative-index normalization so every collection `at`
    // handler gets a 1-based positive index. Most handlers reject `index < 1`
    // outright (e.g. `Range`, `Linspace`, `Zip`, `Scan`); only a handful
    // normalize negatives themselves. Normalizing here makes negative indexing
    // uniform (so `Last`, `At(xs, -1)`, and `Reverse`'s back-to-front walk all
    // work) without materializing infinite or unknown-length sources.
    let idx = index;
    if (index < 0) {
      // A negative index only makes sense for a finite collection with a known
      // count. Infinite or unknown-count sources stay undefined (no
      // materialization, no hang).
      if (this.isFiniteCollection !== true) return undefined;
      const count = this.count;
      if (count === undefined || !Number.isFinite(count)) return undefined;
      idx = count + 1 + index;
      if (idx < 1) return undefined;
    }

    // Element memo: serve from a covering cached prefix — AFTER negative
    // normalization, so `at(-1)` on a walked impure instance returns the
    // memoized last element rather than re-deriving (a fresh draw would
    // break one-instance-one-draw-set coherence). On a miss (or an
    // uncovered index) fall through to the handler's own random-access path
    // unchanged — a first `at(n)` is never converted into an O(n) fill.
    if (idx >= 1 && this.operatorDefinition?.collection?.elementMemo === true) {
      const cached = elementMemoAt(this, idx);
      if (cached !== undefined) return cached;
    }

    return handler(this, idx);
  }

  get(index: Expression | string): Expression | undefined {
    if (this._optedOutOfCollection) return undefined;
    if (typeof index === 'string')
      return this.operatorDefinition?.collection?.at?.(this, index);

    if (!isString(index)) return undefined;
    return this.operatorDefinition?.collection?.at?.(this, index.string);
  }

  indexWhere(predicate: (element: Expression) => boolean): number | undefined {
    if (this._optedOutOfCollection) return undefined;
    if (this.operatorDefinition?.collection?.indexWhere)
      return this.operatorDefinition.collection.indexWhere(this, predicate);
    if (!this.isIndexedCollection) return undefined;
    if (!this.isFiniteCollection) return undefined;
    // 1-based, matching the `indexWhere` collection handlers and `IndexOf`.
    let i = 1;
    for (const x of this.each()) {
      if (predicate(x)) return i;
      i += 1;
    }
    return undefined;
  }

  subsetOf(rhs: Expression, strict: boolean): boolean {
    if (this._optedOutOfCollection) return false;
    return (
      this.operatorDefinition?.collection?.subsetOf?.(this, rhs, strict) ??
      false
    );
  }

  /** Splice `Spread` operands (`f(...p)`) into the operand list.
   *
   * Returns `null` when no operand is a `Spread` (the common case, one cheap
   * scan); the spliced operand list when every spread argument evaluated to a
   * tuple; `this` when a spread argument has not (yet) resolved to a value
   * (the call stays symbolic — a `Spread` operand must never reach positional
   * parameter binding); or an error expression when it resolved to a definite
   * non-tuple value (only tuples spread — a `List` does not).
   */
  private _spliceSpreadOps(): ReadonlyArray<Expression> | Expression | null {
    if (!this._ops.some((x) => x.operator === 'Spread')) return null;
    const spliced: Expression[] = [];
    for (const x of this._ops) {
      if (x.operator !== 'Spread' || !isFunction(x) || x.nops !== 1) {
        spliced.push(x);
        continue;
      }
      // Exact evaluation deliberately: only the tuple STRUCTURE is needed
      // here; a `numericApproximation` option applies to the rebuilt call.
      const v = x.op1.canonical.evaluate();
      if (isFunction(v, 'Tuple')) spliced.push(...v.ops);
      else if (isNumber(v) || isString(v) || isFunction(v, 'List'))
        return this.engine.typeError('tuple', v.type, x.op1);
      else return this;
    }
    return spliced;
  }

  /**
   * The value of an INVALID expression — one whose tree embeds an `Error` —
   * or `undefined` to let the `evaluate` handler run anyway.
   * See `docs/plans/2026-07-31-error-propagation-design.md`.
   *
   * Three outcomes:
   *
   * - **Rung 2, function application**: a direct call `f(err)` of a USER
   *   function — a symbol bound to a `Function` literal (a value definition)
   *   or to an operator definition built from one (`f(x) := …`) — evaluates
   *   to the error itself (the first embedded one, for an operand that merely
   *   *embeds* an error like `"a" + 1`). `Apply`/`Pipe` reach the same rule
   *   through `apply()`. A built-in operator (`Sin(err)`, `err + 1`) is
   *   deliberately NOT an application: it stays inert until rung 3, which is
   *   also what keeps `x |> f` ≡ `f(x)` for every callee.
   * - **Observers** (`inspectsErrors`): the handler runs — `Match` decides on
   *   an error subject, `Type`/`IsError` report on it.
   * - **Rung 3, every other operator**: bubble as well (`err + 1` → err,
   *   `Sin(err)` → err) — error is the absorbing element of strict evaluation,
   *   and the bubbled value carries a breadcrumb of the frames it passed
   *   through (§2a).
   * - **Collections**: a collection-headed node — `List`, `Tuple`, `Set`,
   *   `Range`, `Take`, … — never bubbles its own operands' errors. An error
   *   in an element is a failure of that CELL, not of the container, so the
   *   collection freezes with the error in place and stays iterable. Keyed on
   *   collection-ness (the definition's `collection` handler block), not on
   *   laziness — see §6a.2.
   */
  private _invalidValue(): Expression | undefined {
    const def = this._def ?? undefined;
    if (def === undefined) return this;

    if (isValueDef(def)) {
      // A value-def head is a callee only when its value is a FUNCTION — the
      // same test `applyFunctionLiteral` makes. When it is not (`a := 5;
      // a(err)`), this is not an application at all: let the handler run so
      // the CALLEE problem is reported (`applyFunctionLiteral`'s `typeError`
      // path) rather than the argument's error.
      const value = def.value.isConstant
        ? def.value.value
        : this.engine._getSymbolValue(this._operator);
      if (!value?.type.matches('function')) return undefined;
      return this._firstOperandError() ?? this;
    }

    if (
      isOperatorDef(def) &&
      def.operator instanceof _BoxedOperatorDefinition &&
      def.operator._isLambda
    ) {
      const err = this._firstOperandError();
      if (err !== undefined) return err;
    }

    if (isOperatorDef(def) && def.operator.inspectsErrors) return undefined;

    // Rung 3: a collection freezes with the failed cell in place; everything
    // else bubbles.
    if (isCollectionHead(this)) return this;

    return this._firstOperandError() ?? this;
  }

  /** The error carried by the first operand that is — or embeds — one, with
   * this node pushed onto its breadcrumb (§2a). */
  private _firstOperandError(): Expression | undefined {
    for (let i = 0; i < this._ops.length; i++) {
      const err = errorValue(this._ops[i], {
        operator: this._operator,
        index: i + 1,
      });
      if (err !== undefined) return err;
    }
    return undefined;
  }

  _computeValue(options?: Partial<EvaluateOptions>): () => Expression {
    return () => {
      // Cooperative deadline checkpoint on the per-node evaluation path.
      // Specialized loops (collection enumeration, polynomial GCD, Rubi
      // matching) carry their own checks, but handler-driven evaluation —
      // e.g. a user-function body whose parameter substitution multiplies
      // the tree at every nesting level — never reaches them: without this
      // check such an evaluation exhausts the heap instead of honoring an
      // enclosing `withTimeLimit` span's deadline.
      if ((++_evalTick & 0x3ff) === 0)
        checkDeadline(this.engine._deadlineFrame);

      if (!this._def) return this;
      if (!this.isValid) {
        const invalid = this._invalidValue();
        if (invalid !== undefined) return invalid;
      }

      //
      // 0/ Splice spread arguments — `f(...p)` — before any application,
      // broadcast or hold logic (including user function literals in step
      // 1): the elements of a spread tuple are ordinary positional
      // arguments. Rebuilding through `ce.function` runs the arity/type
      // validation that was deferred at canonicalization.
      //
      const spliced = this._spliceSpreadOps();
      if (spliced !== null) {
        if (!Array.isArray(spliced)) return spliced as Expression;
        return this.engine
          .function(this.operator, spliced as Expression[])
          .evaluate(options);
      }

      const numericApproximation = options?.numericApproximation ?? false;

      const materialization = options?.materialization ?? false;

      //
      // 1/ Check if the operator is a function literal
      //

      if (isValueDef(this._def))
        return applyFunctionLiteral(this, this._def.value, options);

      const def = this._def.operator;

      //
      // 2/ Broadcast if applicable
      // Skip broadcasting for Add/Multiply with tensors - they have their own
      // element-wise handling in addTensors/mulTensors.
      // Add/Multiply also skip when some operand is a RAW function expression
      // that is not (yet) a collection: zipping it here would repeat it as a
      // scalar, and its per-element re-evaluation could expand into a
      // collection (e.g. `s(p_0)·PointList(…)`) — an N×N cartesian blow-up
      // instead of the elementwise zip. Those shapes broadcast soundly in
      // `add()`/`mul()`, which run on EVALUATED operands. (They are already
      // excluded from the post-evaluation steps 3b/4b for the same reason.)
      //
      // O(rank) candidate check (§D4.2 hot-path contract): dispatch must
      // never pay the O(cells) type computation per broadcast evaluation.
      // Kernel entries (addTensors/mulTensors) fully qualify + pack, and
      // DECLINE non-qualified candidates back to the generic broadcast path.
      const hasTensors = this.ops!.some((x) => candidateShape(x) !== null);
      const hasRawOperand =
        (this.operator === 'Add' || this.operator === 'Multiply') &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      if (
        def.broadcastable &&
        !hasRawOperand &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        !skipBroadcastForVectorOps(this.operator, hasTensors, this.ops!)
      ) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Sin(Filter(…))`, whose count is
        // `undefined`; the eager zip would truncate it to one element) — return
        // the lazy `Map` form (e.g. `Sin(Range(1,1e8))` → `Map(Range(1,1e8),
        // Sin)`) instead of materializing every element. Operands whose
        // collection-ness or size only resolves at evaluation (a symbolic-length
        // `Range`, an infinite `Cycle`) are not finite-reported here and are left
        // to the post-evaluation broadcast (step 4b) once their count is known.
        // Broadcast rulings (2026-07-24): operands lifted into every cell are
        // evaluated ONCE, and a length mismatch is an error, not a truncation.
        // Both run BEFORE the lazy form is built: the lazy `Map` zips to the
        // shortest source, so deferring them would make the SIZE of a
        // collection decide the semantics — a mismatch erroring under the eager
        // threshold and silently truncating above it.
        const bops = evaluateBroadcastLiftsOnce(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
        if (!items) return this.engine.Nothing;

        const results: Expression[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;
          results.push(this.engine._fn(this.operator, value).evaluate(options));
        }

        if (results.length === 0) return this.engine.Nothing;
        // Always wrap in a `List` — even a single-element broadcast — so the
        // value matches the `list<E>` broadcast type (the type handler never
        // unwraps a singleton). Mirrors the lambda broadcast in step 4b.
        return this.engine._fn('List', results);
      }

      //
      // 2b/ Broadcast user-defined function literals over indexed collections
      // When a function defined via `ce.assign('f', x \mapsto ...)` is applied
      // to a list (or other finite indexed collection) and the function's
      // parameters are scalar, map the function over the collection.
      // Note: tuples are excluded (`!isTuple`) — a `Tuple` is an atomic value
      // (a point/vector), bound whole to the parameter, never mapped over.
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        paramsAreScalar(def)
      ) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — map the lambda lazily.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (step 4b/3b) once their count resolves.
        // Broadcast rulings (2026-07-24) — see step 2 above (both run before
        // the lazy form, so size does not decide the semantics).
        const bops = evaluateBroadcastLiftsOnce(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
        if (items) {
          const results: Expression[] = [];
          while (true) {
            const { done, value } = items.next();
            if (done) break;
            results.push(
              this.engine._fn(this.operator, value).evaluate(options)
            );
          }
          return this.engine._fn('List', results);
        }
      }

      //
      // 3/ Handle evaluation of lazy collections
      //
      if (materialization !== false && !def.evaluate && this.isLazyCollection)
        return materialize(this, def, options);

      //
      // 3b/ `.N()` of an already-evaluated lazy `Map` (the hybrid-laziness
      // broadcast form): the `Map` has no `evaluate` handler, so without this
      // step the `numericApproximation` flag would be dropped and elements
      // would keep evaluating EXACTLY on access. Rewrap the mapping function
      // in `N` so elements float on access — laziness preserved. Runs after
      // step 3 so an explicit materialization still wins.
      //
      if (numericApproximation && !def.evaluate && this.isLazyCollection) {
        const nLazy = lazyMapNumericApproximation(this.engine, this);
        if (nLazy) return nLazy;
      }

      //
      // 4/ Evaluate the applicable operands in the current scope
      //
      const tail = holdMap(this, (x) => x.evaluate(options));

      //
      // 4a/ Missing-value behavior gate (§3.E of the missing-value typing
      // design). A `propagate` operator with an absent SCALAR operand
      // (`Missing`, or a `NaN`) yields `NaN` in the numeric result cell (I6
      // absorption) — but only when NO operand is a collection: a
      // scalar-vs-collection application (`Add(Missing, matrix)`) broadcasts
      // the absence per cell through the operator's own kernel (packing
      // demotion, tensor-view). Under an element-wise broadcast (step 2 above)
      // the gate re-enters per element (`Sin([1,Missing,3])` →
      // `[Sin(1), NaN, Sin(3)]`). A `reject` operator errors at an absent
      // operand in BOTH strict modes (the behavior gate, not validation).
      //
      if (def instanceof _BoxedOperatorDefinition) {
        const behavior = def.resolvedMissingBehavior;
        // The gate fires on the `Missing` SYMBOL only: a `NaN` operand already
        // propagates through numeric evaluation natively (and some operators —
        // e.g. `Rgb` — give a literal `NaN` operand a bespoke meaning), so it
        // must NOT be hijacked here.
        if (
          (behavior === 'propagate' || behavior === 'reject') &&
          tail.some((x) => isSymbol(x, 'Missing')) &&
          !tail.some((x) => x.isCollection)
        ) {
          if (behavior === 'reject')
            return this.engine.error([
              'unexpected-argument',
              this.engine.Missing.toString(),
            ]);
          return this.engine.NaN;
        }
      }

      //
      // 4b/ Broadcast over operands that only became collections *after*
      // evaluation — e.g. `Sqrt(Multiply(A, B))`, where the product evaluates
      // to a matrix. The pre-evaluation broadcast (step 2) misses these because
      // the raw operand is not yet a collection. `Add`/`Multiply` are excluded:
      // they have dedicated tensor handling (addTensors/mulTensors). This reuses
      // the already-evaluated `tail`, so scalar calls (`Sin(x)`) pay only a
      // cheap collection test.
      //
      // The same post-evaluation lift also fires for a user function literal
      // with scalar parameters (`ce.assign('k', x ↦ …)`) whose argument only
      // EVALUATES to a finite indexed collection (e.g. `k(lst(3))`, where
      // `lst(3)` reduces to `[3, -3]`). The pre-evaluation lambda broadcast
      // (step 2b) misses these because the raw operand is not yet a collection;
      // this maps ANY lambda body element-wise (not only arithmetic bodies that
      // broadcast internally), returning a `List` — matching the
      // `broadcastable<E>` application typing. Tuples stay atomic (`!isTuple`);
      // a collection-typed parameter makes `paramsAreScalar` false so the
      // argument binds whole.
      //
      const lambdaBroadcast =
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        paramsAreScalar(def);
      // For a LAZY operator the `tail` may still hold RAW operands whose
      // finiteness is unresolved (`Equal(Characters(s), Reverse(Characters(s)))`):
      // those must fold whole-collection, so the gate stays on the strict
      // `isKnownFinitenessBroadcast` (excludes `isFiniteCollection ===
      // undefined`). For a NON-lazy operator the operands reaching this gate are
      // already evaluated, so unknown finiteness is a genuinely-unresolved source
      // (a symbolic-length `Range`) — admit it too via `isUnknownLengthBroadcast`
      // so `Sin(Range(1,n))` lazifies into a `Map` like `Add(Range(1,n),1)` does.
      const isPostEvalBroadcastOperand = (x: Expression): boolean =>
        isKnownFinitenessBroadcast(x) ||
        (def.lazy !== true && isUnknownLengthBroadcast(x));
      if (
        (lambdaBroadcast ||
          (def.broadcastable &&
            this.operator !== 'Add' &&
            this.operator !== 'Multiply')) &&
        !skipBroadcastForVectorOps(this.operator, false, tail) &&
        tail.some(isPostEvalBroadcastOperand)
      ) {
        // Hybrid laziness: past the eager threshold — and for a materialized
        // infinite (`Cycle`) or uncountable-finite (`Filter`) source, gated by
        // `isKnownFinitenessBroadcast` so a not-yet-resolved operand held raw by
        // a lazy operator is left to fold — return the lazy `Map` form over the
        // already-evaluated `tail`.
        // Length-mismatch ruling (2026-07-24), before the lazy form so size
        // does not decide the semantics. `tail` is already evaluated, so the
        // purity half (evaluate lifted operands once) does not apply here.
        const mismatch = broadcastLengthMismatch(this.engine, tail);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          tail,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(tail);
        if (items) {
          const results: Expression[] = [];
          while (true) {
            const { done, value } = items.next();
            if (done) break;
            results.push(
              this.engine._fn(this.operator, value).evaluate(options)
            );
          }
          // A broadcast always yields a `List`, even for a single-element
          // collection, so the value matches the `list<E>` broadcast type.
          if (lambdaBroadcast) return this.engine._fn('List', results);
          if (results.length > 0) return this.engine._fn('List', results);
        }
      }

      //
      // 4c/ Thread over conditional values (`When`/`Which`) — lift the
      // conditional outward so arithmetic and function application flow
      // through it (design: docs/plans/2026-07-12-conditional-values-design.md,
      // "Threading rules"). Structurally the same lift as the broadcast steps
      // above; gated on `broadcastable` and reusing the evaluated `tail`, so a
      // scalar call pays only a cheap `isFunction` test. Logic operators are
      // excluded: Kleene logic is not strict (`And(Undefined, False)` stays
      // `False`), so lifting a guard out of them would be unsound. `Add`/
      // `Multiply` are NOT excluded (unlike step 4b): threading them before the
      // arithmetic evaluate handler is what stops a fold from silently dropping
      // a guard (`When − When`, `0·When`; see decision 5).
      //
      if (
        def.broadcastable &&
        !CONDITIONAL_THREADING_SKIP.has(this.operator) &&
        tail.some((x) => isFunction(x, 'When') || isFunction(x, 'Which'))
      ) {
        const threaded = threadConditional(
          this.engine,
          this.operator,
          tail,
          def.lazy === true,
          options
        );
        if (threaded) return threaded;
      }

      //
      // 5/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined;

      if (isScoped) {
        this.engine._pushEvalContext(this._localScope!);
      }

      //
      // 6/ Call the `evaluate` handler
      //
      let evalResult: Expression | undefined;
      try {
        evalResult = def.evaluate?.(tail, {
          numericApproximation,
          engine: this.engine,
          materialization: materialization,
          // The node itself, so a handler can reach its RAW (pre-numericized)
          // operands — `tail` has already been evaluated. See
          // `EvaluateHandlerOptions.expression`.
          expression: this,
        });
      } finally {
        if (isScoped) this.engine._popEvalContext();
      }

      // Fallback to a symbolic result if we could not evaluate. For a SCOPED
      // operator with NO evaluate handler (a lazy scoped collection —
      // `Comprehension`), whose operands did not change (all held), return
      // THIS instance rather than re-boxing: re-canonicalizing would create a
      // FRESH local scope with fresh bindings while the already-canonical
      // children keep their bindings into the original scope — a split that
      // makes the children blind to any value later installed in the new
      // scope (a comprehension walk's index values). All other operators must
      // keep re-boxing: the re-canonicalization of the tail is load-bearing
      // both for non-scoped operators (e.g. the broadcast/tensor contraction
      // of `Multiply` on operands that became collections) and for scoped
      // operators WITH a handler that declined (e.g. a symbolic `Sum`, whose
      // re-canonicalization performs big-op cleanups the rubi pipeline
      // depends on).
      const result =
        evalResult ??
        (isScoped &&
        def.evaluate === undefined &&
        this.isCanonical &&
        tail.every((x, i) => x === this._ops[i])
          ? this
          : this.engine.function(this._operator, tail));

      // 6b/ Pole-aware numeric evaluation: at a known pole, N() yields
      // ComplexInfinity rather than NaN/garbage (analytic-property store).
      if (numericApproximation)
        return applyPoleOverride(this.engine, this._operator, tail, result);
      return result;
    };
  }

  _computeValueAsync(
    options?: Partial<EvaluateOptions>
  ): () => Promise<Expression> {
    return async () => {
      // Cooperative deadline checkpoint — see `_computeValue`.
      if ((++_evalTick & 0x3ff) === 0)
        checkDeadline(this.engine._deadlineFrame);

      if (!this._def) return this;
      if (!this.isValid) {
        const invalid = this._invalidValue();
        if (invalid !== undefined) return invalid;
      }

      // 0/ Splice spread arguments — mirrors the sync path (the spread
      // argument itself resolves synchronously; the rebuilt call continues
      // async).
      const spliced = this._spliceSpreadOps();
      if (spliced !== null) {
        if (!Array.isArray(spliced)) return spliced as Expression;
        return this.engine
          .function(this.operator, spliced as Expression[])
          .evaluateAsync(options);
      }

      const numericApproximation = options?.numericApproximation ?? false;

      //
      // 1/ Check if the operator is a function literal
      //

      if (isValueDef(this._def))
        return applyFunctionLiteral(this, this._def.value, options);

      const def = this._def.operator;

      //
      // 2/ Broadcast if applicable
      // Add/Multiply skip when some operand is a RAW function expression that
      // is not (yet) a collection — zipping it as a repeated scalar
      // cartesian-explodes when it evaluates to a collection; `add()`/`mul()`
      // broadcast those soundly on EVALUATED operands (see the sync path).
      //
      // O(rank) candidate check (§D4.2 hot-path contract): dispatch must
      // never pay the O(cells) type computation per broadcast evaluation.
      // Kernel entries (addTensors/mulTensors) fully qualify + pack, and
      // DECLINE non-qualified candidates back to the generic broadcast path.
      const hasTensors = this.ops!.some((x) => candidateShape(x) !== null);
      const hasRawOperand =
        (this.operator === 'Add' || this.operator === 'Multiply') &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      if (
        def?.broadcastable &&
        !hasRawOperand &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        !skipBroadcastForVectorOps(this.operator, hasTensors, this.ops!)
      ) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — return the lazy `Map` form.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (mirrors the sync path).
        // Broadcast rulings (2026-07-24) — mirrors the sync path in step 2,
        // including running before the lazy form.
        const bops = await evaluateBroadcastLiftsOnceAsync(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
        if (!items) return this.engine.Nothing;

        const results: Promise<Expression>[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;

          results.push(
            this.engine._fn(this.operator, value).evaluateAsync(options)
          );
        }

        if (results.length === 0) return this.engine.Nothing;
        // Always wrap in a `List` — even a single-element broadcast — so the
        // value matches the `list<E>` broadcast type (mirrors the sync path).
        return Promise.all(results).then((resolved) =>
          this.engine._fn('List', resolved)
        );
      }

      //
      // 2b/ Broadcast user-defined function literals over indexed collections.
      // Mirrors the sync path in `_computeValue`.
      //
      if (
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        paramsAreScalar(def)
      ) {
        // Hybrid laziness: past the eager threshold — or for a provably-finite
        // collection of unknown size (`Filter`) — map the lambda lazily.
        // Symbolic-length/infinite sources are deferred to the post-evaluation
        // broadcast (step 4b/3b) once their count resolves.
        // Broadcast rulings (2026-07-24) — mirrors the sync path in step 2b,
        // including running before the lazy form.
        const bops = await evaluateBroadcastLiftsOnceAsync(this._ops!, options);
        const mismatch = broadcastLengthMismatch(this.engine, bops);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          bops,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(bops);
        if (items) {
          const results: Promise<Expression>[] = [];
          while (true) {
            const { done, value } = items.next();
            if (done) break;
            results.push(
              this.engine._fn(this.operator, value).evaluateAsync(options)
            );
          }
          return Promise.all(results).then((resolved) =>
            this.engine._fn('List', resolved)
          );
        }
      }

      //
      // 2c/ `.N()` of an already-evaluated lazy `Map` — mirrors the sync
      // path's step 3b (the async path has no materialization step, so this
      // runs unconditionally under `numericApproximation`).
      //
      if (numericApproximation && !def.evaluate && this.isLazyCollection) {
        const nLazy = lazyMapNumericApproximation(this.engine, this);
        if (nLazy) return nLazy;
      }

      //
      // 3/ Evaluate the applicable operands
      //

      // Resolve all the operand promises
      const tail = await holdMapAsync(
        this,
        async (x) => await x.evaluateAsync(options)
      );

      //
      // 3a/ Missing-value behavior gate (§3.E) — parity with the sync path's
      // step 4a. A `propagate` operator with an absent `Missing` scalar operand
      // (no collection operand) yields `NaN`; a `reject` operator errors.
      //
      if (def instanceof _BoxedOperatorDefinition) {
        const behavior = def.resolvedMissingBehavior;
        if (
          (behavior === 'propagate' || behavior === 'reject') &&
          tail.some((x) => isSymbol(x, 'Missing')) &&
          !tail.some((x) => x.isCollection)
        ) {
          if (behavior === 'reject')
            return this.engine.error([
              'unexpected-argument',
              this.engine.Missing.toString(),
            ]);
          return this.engine.NaN;
        }
      }

      //
      // 3b/ Broadcast over operands that only became collections after
      // evaluation (mirrors `_computeValue` step 4b, including the
      // post-evaluation lambda broadcast for scalar-parameter function
      // literals whose argument only becomes a collection after evaluation).
      //
      const lambdaBroadcast =
        def instanceof _BoxedOperatorDefinition &&
        def._isLambda &&
        paramsAreScalar(def);
      // Same post-eval finiteness refinement as the sync path (finding 3):
      // a lazy operator keeps the strict gate; a non-lazy one also admits an
      // unresolved-finiteness source (symbolic-length `Range`).
      const isPostEvalBroadcastOperand = (x: Expression): boolean =>
        isKnownFinitenessBroadcast(x) ||
        (def.lazy !== true && isUnknownLengthBroadcast(x));
      // The lazy `Map` returned here applies its mapping SYNCHRONOUSLY on
      // `at`/iteration, so take the lazy arm only when the per-element call is
      // sync-applicable: the operator has a synchronous `evaluate` handler, or
      // this is a function-literal application (`lambdaBroadcast`, always sync).
      // An operator with ONLY an `evaluateAsync` handler would otherwise yield
      // inert per-element results and bypass async cancellation, so it falls
      // through to the async materialization/inert behavior below.
      const isSyncApplicable = lambdaBroadcast || def.evaluate !== undefined;
      if (
        (lambdaBroadcast ||
          (def.broadcastable &&
            this.operator !== 'Add' &&
            this.operator !== 'Multiply')) &&
        isSyncApplicable &&
        !skipBroadcastForVectorOps(this.operator, false, tail) &&
        tail.some(isPostEvalBroadcastOperand)
      ) {
        // Hybrid laziness: past the eager threshold — and always for an
        // unknown/infinite-length source — return the lazy `Map` form over the
        // already-evaluated `tail` (mirrors the sync path).
        // Length-mismatch ruling (2026-07-24) — mirrors the sync step 4b,
        // before the lazy form; `tail` is already evaluated, so the purity half
        // does not apply.
        const mismatch = broadcastLengthMismatch(this.engine, tail);
        if (mismatch) return mismatch;

        const lazy = lazyBroadcastMapIfNeeded(
          this.engine,
          this.operator,
          tail,
          isBroadcastableCollection,
          numericApproximation
        );
        if (lazy) return lazy;

        const items = zip(tail);
        if (items) {
          const results: Promise<Expression>[] = [];
          while (true) {
            const { done, value } = items.next();
            if (done) break;
            results.push(
              this.engine._fn(this.operator, value).evaluateAsync(options)
            );
          }
          // A lambda broadcast always yields a `List` (mirroring step 2b).
          if (lambdaBroadcast)
            return Promise.all(results).then((resolved) =>
              this.engine._fn('List', resolved)
            );
          if (results.length > 0)
            return Promise.all(results).then((resolved) =>
              this.engine._fn('List', resolved)
            );
        }
      }

      // 4/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined;

      // This path holds its context across an `await` (see below), so by the
      // time it unwinds its frame is NOT necessarily on top: another
      // evaluation on the same engine may have pushed above it. Both popping
      // the top and unwinding by depth would then destroy a frame belonging to
      // something still running, disposing its bindings out from under it — so
      // capture the frame and remove it by IDENTITY instead.
      //
      // This keeps one evaluation from corrupting another's scope, but it does
      // not make concurrent async evaluation on a single engine *correct*: the
      // context stack is engine-global mutable state, so while this evaluation
      // is suspended its scope is the engine's current one, and anything else
      // entering the engine in that window — a second `evaluateAsync`, or plain
      // synchronous work from a timer or event handler — resolves against it.
      // Making that sound needs per-evaluation (task-local) context
      // propagation across every await in the async path, not just this one.
      // Until then: one engine per concurrent evaluation.
      if (isScoped) {
        this.engine._pushEvalContext(this._localScope!);
      }
      const localContext = isScoped ? this.engine.context : undefined;

      //
      // 5/ Call the `evaluate` handler
      //
      const engine = this.engine;

      let value: Expression | undefined;
      try {
        const opts: Partial<EvaluateOptions> & {
          engine: ComputeEngine;
          expression: Expression;
        } = {
          numericApproximation,
          engine,
          signal: options?.signal,
          materialization: options?.materialization,
          // See the matching comment (and `EvaluateHandlerOptions.expression`)
          // on the sync path.
          expression: this,
        };
        // AWAIT INSIDE THE `try`: an `evaluateAsync` handler returns at its
        // first suspension point, not at completion, so popping on the
        // handler's *return* tore the local scope down while the handler was
        // still running. Anything the resumed handler did then ran against
        // the enclosing scope: a big operator whose reduction outlives one
        // `runAsync` chunk (>16ms) assigned its loop index globally — leaking
        // it, clobbering an outer binding of the same name, and throwing
        // `Cannot assign a value to the constant "i"` for the commonest index
        // spelling of all, since global `i` is `ImaginaryUnit`. Holding the
        // context across the await is what makes the async lane's scoping
        // match the sync lane's.
        value = await (def.evaluateAsync?.(tail, opts) ??
          def.evaluate?.(tail, opts));
      } finally {
        if (localContext) this.engine._removeEvalContext(localContext);
      }

      // Handler-less scoped-operator no-operand-change identity: see the
      // matching comment in the sync path (avoids re-canonicalizing a lazy
      // scoped collection into a fresh, split-off local scope; every other
      // operator keeps the load-bearing re-box).
      const result =
        value ??
        (isScoped &&
        def.evaluate === undefined &&
        def.evaluateAsync === undefined &&
        this.isCanonical &&
        tail.every((x, i) => x === this._ops[i])
          ? this
          : engine.function(this._operator, tail));
      // 5b/ Pole-aware numeric evaluation (see the sync path).
      if (numericApproximation)
        return applyPoleOverride(engine, this._operator, tail, result);
      return result;
    };
  }
}

/**
 * Does `op` supply the CELLS of an element-wise broadcast (rather than being
 * lifted into every cell)? Mirrors the participation test at each broadcast
 * site: a tuple is an atomic value (a point/vector), never mapped over.
 */
function isBroadcastParticipant(op: Expression): boolean {
  return isFiniteIndexedCollection(op) && !isTuple(op);
}

/**
 * Evaluate the operands that are LIFTED into every cell, once.
 *
 * RULING (user-ratified 2026-07-24): broadcast operands are evaluated ONCE and
 * the operation then maps over cells — the NumPy/Julia/R model, in which
 * broadcasting is an operation on VALUES. `zip` repeats a lifted operand's
 * *expression* in every cell, so an impure scalar was drawn per element:
 * `L < Random()` produced a different number for each comparison, while the
 * arithmetic broadcast (`L + Random()`) had always drawn once. A per-cell draw
 * is written explicitly instead: `Map(L, l ↦ l < Random())`.
 *
 * Cell-supplying operands are left untouched — their elements ARE the values
 * being traversed, so `[Random(), Random()]` still draws per cell. Evaluation
 * can REVEAL a collection (a raw call returning a list), so participation is
 * re-derived from the returned operands by the caller, not from the originals.
 */
function evaluateBroadcastLiftsOnce(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): ReadonlyArray<Expression> {
  if (!ops.some((op) => !isBroadcastParticipant(op))) return ops;
  return ops.map((op) =>
    isBroadcastParticipant(op)
      ? op
      : normalizeLiftedAbsence(op, op.evaluate(options) ?? op)
  );
}

/** Async mirror of `evaluateBroadcastLiftsOnce`. */
async function evaluateBroadcastLiftsOnceAsync(
  ops: ReadonlyArray<Expression>,
  options: Partial<EvaluateOptions> | undefined
): Promise<ReadonlyArray<Expression>> {
  if (!ops.some((op) => !isBroadcastParticipant(op))) return ops;
  // Awaited together, not in sequence: the lifts are independent, and the sync
  // mirror evaluates them without ordering either.
  return await Promise.all(
    ops.map(async (op) =>
      isBroadcastParticipant(op)
        ? op
        : normalizeLiftedAbsence(op, (await op.evaluateAsync(options)) ?? op)
    )
  );
}

/**
 * Carry a numeric slot's absence convention across the evaluate-once
 * substitution.
 *
 * Substituting a lifted operand with its VALUE erases the declared type the
 * comparison handlers' absence read keys on: an operand typed `number | missing`
 * that evaluates to the `Missing` symbol must be read as `NaN` (IEEE), because
 * `NaN` is that slot's honest absence value (I6 domain normalization). Without
 * this, the same operand answered `False` as a scalar (`Less(1, x)`) and
 * `Missing` under a broadcast (`Less([1,2], x)`) — Kleene where the scalar path
 * is IEEE. `readComparisonAbsence` in `library/relational-operator.ts` applies
 * the identical rule on the non-broadcast path.
 */
function normalizeLiftedAbsence(
  original: Expression,
  evaluated: Expression
): Expression {
  if (!isSymbol(evaluated, 'Missing')) return evaluated;
  return numericMissingSlot(original.type.type)
    ? original.engine.NaN
    : evaluated;
}

/**
 * Vector-space operators over numeric tuples (points/vectors in ℝⁿ) must not
 * be broadcast into a List: they have dedicated component-wise handling in
 * `add`/`mul`/`negate`/`canonicalDivide`. This mirrors the tensor carve-out
 * (which stays limited to Add/Multiply). See
 * `docs/plans/2026-07-07-tuple-point-semantics.md`.
 */
function skipBroadcastForVectorOps(
  operator: string,
  hasTensors: boolean,
  ops: ReadonlyArray<Expression>
): boolean {
  if (hasTensors && (operator === 'Add' || operator === 'Multiply'))
    return true;
  // A matrix-valued operand that is NOT a raw tensor node — most often a SYMBOL
  // whose value is a matrix (`isTensor` keys on the node kind, so `hasTensors`
  // misses it), or any expression statically typed `matrix` — must also route to
  // the dedicated tensor handling (`addTensors`/`mulTensors`). Otherwise
  // element-wise broadcasting Hadamards two matrices where `Multiply` must
  // contract (the matrix product), diverging from the matrix-literal and
  // matrix-returning-application paths (which already reach `mulTensors`). Keyed
  // on the static type, so no value is resolved on the scalar hot path; a
  // `vector<n>` operand does not match `matrix`, so vector Hadamard is unchanged.
  if (
    (operator === 'Add' || operator === 'Multiply') &&
    ops.some((x) => x.type.matches('matrix'))
  )
    return true;
  if (
    (operator === 'Add' ||
      operator === 'Multiply' ||
      operator === 'Negate' ||
      operator === 'Subtract' ||
      operator === 'Divide') &&
    ops.some((x) => isTuple(x))
  )
    return true;
  // `Equal`/`NotEqual` broadcast only in the list-vs-scalar case (Desmos
  // `L[d=4]`). When two or more operands are collections, keep the whole-list
  // (structural/mathematical) equality semantics — `Equal(L, M)` stays a scalar
  // boolean rather than a list of element-wise comparisons. Any collection
  // counts, not just finite indexed ones: `Equal(Set(…), List(…))` must not
  // broadcast over the list either. See
  // docs/plans/2026-07-07-desmos-list-filtering.md (highest-risk item).
  //
  // An operand that may only BECOME a collection at evaluation — a top-typed
  // application such as `q(2)` declared `(number) -> unknown`, or a
  // `broadcastable<T>` node — counts too (Tycho item 41): fanning the literal
  // out pre-evaluation while the opaque operand later evaluates to a
  // collection compounded two broadcasts into a cartesian nest
  // (`L(1) = [1,2]` → 2×2 lists of booleans) instead of the documented
  // whole-collection boolean. Skipping defers to the `Equal`/`NotEqual`
  // evaluate handler, which sees EVALUATED operands and re-applies the same
  // rule with full information (element-wise for list-vs-scalar via
  // `broadcastComparison`, whole-collection equality for two collections) —
  // so a possibly-collection operand that turns out scalar still broadcasts
  // element-wise, unchanged.
  if (
    (operator === 'Equal' || operator === 'NotEqual') &&
    ops.filter((x) => x.isCollection || isPossiblyCollectionTyped(x)).length >=
      2
  )
    return true;
  return false;
}

/**
 * Broadcastable logic operators excluded from conditional-value threading.
 * Kleene logic is not strict — `And(Undefined, False)` must stay `False` — so
 * lifting a `When` guard out of them would be unsound (design decision 2/9).
 */
const CONDITIONAL_THREADING_SKIP = new Set([
  'And',
  'Or',
  'Not',
  'Xor',
  'Nand',
  'Nor',
  'Implies',
  'Equivalent',
]);

/**
 * Threading pre-pass for conditional values (`When`/`Which`), modeled on the
 * broadcast lift (step 4b). Given the already-evaluated `tail` of operator
 * `op`, lift a conditional operand outward:
 *
 * - **When (T1–T3), guard-outermost normal form:** if any operand is a `When`,
 *   strip each `When` to its value and collect its guard, then wrap the
 *   *evaluated* `op(strippedTail)` in a single `When` whose guard is the
 *   conjunction of the collected guards and re-evaluate. `When`'s canonical
 *   handler And-folds the guards and its evaluate handler resolves a decidable
 *   guard (T4/T5), so a True guard collapses to the bare value and a False
 *   guard to `Undefined`. Evaluating the inner application is what lets a fold
 *   run inside the guard (`0·x → 0`, `x − x → 0`) and an inner `Which`
 *   distribute (yielding `When(Which(…), g)`, decision 6).
 * - **Which (T6/T7), only when no `When` operand is present:** distribute over
 *   the lexicographic cross-product of branches — a non-`Which` operand is a
 *   single unconditional branch, each branch's condition is the `And` of the
 *   selected operands' conditions, and the branch value is `op` applied to the
 *   selected values. Lexicographic order preserves first-true-wins without a
 *   disjointness requirement. Cost-gated (decision 10): a product above 16
 *   branches stays inert (returns `undefined`).
 *
 * `lazy` operators (`Add`/`Multiply`/relations) reach the pre-pass with an
 * *un-evaluated* tail, so operands are evaluated here first — this both
 * surfaces a conditional nested under a lazy operand (e.g. `Negate(When)` in
 * `When − When`) and is a cheap cache hit for the already-evaluated tail of a
 * strict operator.
 *
 * Returns `undefined` when there is nothing to thread, so the caller falls
 * through to normal evaluation — except for a `lazy` operator whose tail was
 * evaluated here and no longer holds a conditional, where the folded
 * application of the already-evaluated tail is returned to avoid re-evaluating
 * the operands.
 */
function threadConditional(
  ce: ComputeEngine,
  op: string,
  rawTail: ReadonlyArray<Expression>,
  lazy: boolean,
  options: Partial<EvaluateOptions> | undefined
): Expression | undefined {
  const tail = lazy ? rawTail.map((x) => x.evaluate(options)) : rawTail;

  // --- `When` lift (guard-outermost) ---
  if (tail.some((x) => isFunction(x, 'When'))) {
    const guards: Expression[] = [];
    const stripped = tail.map((x) => {
      if (isFunction(x, 'When')) {
        guards.push(x.op2);
        return x.op1;
      }
      return x;
    });
    const guard = guards.length === 1 ? guards[0] : ce._fn('And', guards);
    const inner = ce._fn(op, stripped).evaluate(options);
    return ce._fn('When', [inner, guard]).evaluate(options);
  }

  // --- `Which` distribution ---
  if (tail.some((x) => isFunction(x, 'Which'))) {
    // Each operand contributes a list of (condition, value) branches; a
    // non-`Which` operand is a single unconditional branch (condition = null).
    const branchSets = tail.map((x) => {
      if (isFunction(x, 'Which')) {
        const branches: { cond: Expression | null; value: Expression }[] = [];
        const ops = x.ops;
        for (let i = 0; i + 1 < ops.length; i += 2)
          branches.push({ cond: ops[i], value: ops[i + 1] });
        return branches;
      }
      return [{ cond: null as Expression | null, value: x }];
    });

    // Cost gate (decision 10): product of branch counts.
    let count = 1;
    for (const bs of branchSets) count *= bs.length;
    if (count > 16) return undefined;

    // Lexicographic cross-product: the first operand varies slowest, so every
    // lexicographically earlier branch has a false conjunct at the selected
    // point — first-true-wins is preserved without disjointness.
    let combos: { conds: Expression[]; value: Expression[] }[] = [
      { conds: [], value: [] },
    ];
    for (const bs of branchSets) {
      const next: typeof combos = [];
      for (const combo of combos)
        for (const b of bs)
          next.push({
            conds: b.cond ? [...combo.conds, b.cond] : combo.conds,
            value: [...combo.value, b.value],
          });
      combos = next;
    }

    const resultOps: Expression[] = [];
    for (const combo of combos) {
      const cond =
        combo.conds.length === 0
          ? ce.True
          : combo.conds.length === 1
            ? combo.conds[0]
            : ce._fn('And', combo.conds);
      resultOps.push(cond, ce._fn(op, combo.value).evaluate(options));
    }
    return ce._fn('Which', resultOps).evaluate(options);
  }

  // Nothing (left) to thread. For a `lazy` operator we already evaluated the
  // tail above to inspect it — a `When`/`Which` operand that reduced to a plain
  // value during that evaluation (e.g. a `Which` whose selected branch has no
  // free variables, `2·{cond: x, y}`) leaves no conditional to lift. Return the
  // folded application of the already-evaluated tail so the caller does not
  // evaluate the operands a *second* time: falling through to `undefined` would
  // have the operator's own handler re-evaluate the raw tail, doubling the work
  // (and re-running any effectful selected branch). For a non-`lazy` operator
  // `tail === rawTail` was already evaluated by the caller, so there is nothing
  // to reuse — fall through.
  if (lazy) return ce._fn(op, tail).evaluate(options);

  return undefined;
}

/** Return the type of the value of the expression, without actually
 * evaluating it */
function type(expr: BoxedFunction): Type {
  if (!expr.isValid) return 'error';

  // Is this a 'Function' expression?
  // The arrow — parameters, result AND effect specifier — is built by the
  // single Stage 2 construction seam (`effects-inference.ts`). Nothing else in
  // the engine may assemble a `Function` literal's signature: a second builder
  // silently reintroduces the inline-callback gap. Guarded by
  // `test/compute-engine/effects-seam.test.ts`.
  if (expr.operator === 'Function') return functionLiteralSignatureType(expr);

  // Is there a definition associated with the operator of the function?
  const def = expr.operatorDefinition;
  if (def) {
    const sig =
      def.signature instanceof BoxedType
        ? def.signature.type
        : typeof def.signature === 'string'
          ? parseType(def.signature, expr.engine._typeResolver)
          : def.signature;

    // An overload set resolves to its most-specific viable arm, and the result
    // type is read off THAT arm (`docs/plans/2026-07-25-overload-resolution-
    // design.md` §6). Note the asymmetry with operand inference, which uses the
    // JOIN over every viable arm (§4.3): a result type wants the most precise
    // arm, an operand constraint must be the weakest — conflating them
    // reintroduces the §4.5 unsoundness.
    let sigResult = functionResult(resolvedArm(expr, sig) ?? sig) ?? 'unknown';

    // Missing-value absorption (§3.B of the missing-value typing design). When
    // this application resolves to `propagate` and some operand carries a
    // `missing` arm, the base result is absorbed: every `missing` arm is
    // stripped and every numeric result cell widens to `number` (an absent
    // numeric cell contributes `NaN` — Q2/I6). Gated on `typeContainsMissing`,
    // so a Missing-free program's type is byte-identical.
    const absorbMissing =
      def.resolvedMissingBehavior === 'propagate' &&
      expr.ops.some((x) => typeContainsMissing(x.type.type));
    const maybeAbsorb = (t: Type): Type =>
      absorbMissing ? absorbNumericAbsence(t) : t;

    // If there is a type handler, call it. Strip-before-validate (§3.B step 3):
    // for a `propagate`/`handle` operator with an absent operand, convey the
    // stripped operand types via the `operandTypes` context override — a
    // handler consults `options.operandTypes[i]` before `ops[i].type` (no proxy
    // expressions, no interaction with the `_type` cache).
    if (typeof def.type === 'function') {
      const stripsAny =
        (def.resolvedMissingBehavior === 'propagate' ||
          def.resolvedMissingBehavior === 'handle') &&
        expr.ops.some(
          (x, i) => def.stripsMissingAt(i) && typeContainsMissing(x.type.type)
        );
      const operandTypes = stripsAny
        ? expr.ops.map((x, i) =>
            def.stripsMissingAt(i) && typeContainsMissing(x.type.type)
              ? stripMissingFromType(x.type.type)
              : undefined
          )
        : undefined;
      const calculatedType = def.type(expr.ops, {
        engine: expr.engine,
        operandTypes,
      });
      if (calculatedType) {
        if (calculatedType instanceof BoxedType)
          sigResult = calculatedType.type;
        else
          sigResult =
            parseType(calculatedType, expr.engine._typeResolver) ?? sigResult;
      }
    } else if (
      expr.ops.length > 0 &&
      (sigResult === 'number' || sigResult === 'finite_number')
    ) {
      // No explicit type handler and signature result is a broad numeric
      // type: try to narrow based on argument types.
      // E.g., if signature says "number" but all args are "integer",
      // narrow result to "finite_integer".
      //
      // This is a closure assumption (the operator maps its argument kinds to
      // the same kind) — sound only when the operands are provably finite. For
      // an operator with no type handler we cannot assume finite-in → finite-out
      // (e.g. an unknown `f` may send ∞ to a finite value), so a non-finite (or
      // unknown-finiteness) operand must not narrow the result finiteness
      // (SYMBOLIC P0-15). Gate the narrowing on every operand being provably
      // finite.
      const argTypes = expr.ops.map((op) => op.type.type);
      if (
        expr.ops.every((op) => op.isFinite === true) &&
        argTypes.every(
          (t) =>
            typeof t === 'string' &&
            NUMERIC_TYPES.includes(t as NumericPrimitiveType)
        )
      ) {
        const widened = widen(...argTypes);
        if (typeof widened === 'string' && isSubtype(widened, sigResult))
          sigResult = widened;
      }
    }

    // Honest typing for list broadcast: when this operator will broadcast
    // element-wise over a finite indexed collection operand, its value is a
    // List, so its declared type must be the broadcast list type — not the
    // scalar per-element type the handler computed. The predicate matches the
    // value path so type and value never disagree: a materialized finite
    // collection (`isFiniteIndexedCollection`, step 2 / step 4b), OR an operand
    // whose declared type is an unbounded list / indexed-collection that will
    // materialize into a List at evaluation (`isBroadcastCollectionType` — a
    // symbolic-length `Range`, or an un-evaluated broadcast result like `R^2`).
    // Numeric tuples/points and tensor Add/Multiply (dedicated component-wise
    // typing) stay untouched via `skipBroadcastForVectorOps`.
    if (def.broadcastable) {
      // O(rank) candidate check — see the §D4.2 note at the sibling sites.
      const hasTensors = expr.ops.some((x) => candidateShape(x) !== null);
      // `Equal`/`NotEqual` over TWO OR MORE definite collections is
      // whole-value equality — a scalar `boolean`, never a broadcast (see
      // `skipBroadcastForVectorOps`). That skip tests value-level
      // `isCollection`, which an unevaluated `Multiply`/`Add` intermediate
      // (typed `vector<n>` but with no collection handler) does not satisfy —
      // so mirror the same ≥2 rule at the TYPE level here, or
      // `Equal(10⁴·[1,2,3], 10⁴·[4,5,6])` would type `list<boolean>` while
      // evaluating to the scalar `False`. A SINGLE collection operand keeps
      // the lift (a collection-vs-scalar comparison genuinely broadcasts to
      // a boolean mask), and possibly-collection operands keep arm 2's
      // `broadcastable<boolean>` (sound for every outcome, including the
      // whole-value one).
      const typeLevelEqualitySkip =
        (expr.operator === 'Equal' || expr.operator === 'NotEqual') &&
        expr.ops.filter((x) => x.isCollection || isLinearAlgebraCollection(x))
          .length >= 2;
      if (
        !typeLevelEqualitySkip &&
        !skipBroadcastForVectorOps(expr.operator, hasTensors, expr.ops)
      ) {
        // Arm 1 (statically-visible collection) — PRIORITY. A materialized
        // finite indexed collection, an operand whose declared type is an
        // unbounded list / indexed-collection, or — when the handler's own
        // result COLLAPSED to a scalar — an operand whose type is a
        // FIXED-SHAPE (dimensioned) `vector<n>`/`matrix` unevaluated
        // intermediate such as `10^4·[1,2,3]` (`isFixedShapeCollection`; Tycho
        // 19.2's inlined-broadcast probe: without this trigger `sin(10^4·[…])`
        // collapsed to scalar `number` and `At` hard-rejected a provably-list
        // base). The fixed-shape trigger is deliberately NARROWER than
        // `isLinearAlgebraCollection` — a generic `collection`-kind operand may
        // be a non-indexed `set` the value path never broadcasts, and the
        // dimensionless list/indexed-collection case is already covered by the
        // `isBroadcastCollectionType` disjunct above. All matched operands
        // definitely produce a `List` at evaluation, so the honest type is the
        // concrete `list<E>`.
        //
        // The fixed-shape trigger DEFERS to a handler that GENUINELY computes
        // collection results — an ALLOWLIST, not a shape test: only
        // `Add`/`Multiply` (their own matrix/vector branches, which type
        // `matrix + scalar` as `matrix` and keep the honest widen only for
        // possibly-non-indexed `collection`/`set` operands — see `addType`)
        // and `Negate` (passes `x.type` through). Re-wrapping those would
        // collapse an honest `matrix` to an unbounded `list<…>` (it broke
        // `-M → matrix` and `det(M+N)`). Every OTHER handler that produces a
        // collection-bearing type over a collection operand did so by naive
        // `widen(…)` — e.g. `Remainder(10⁴·[1,2,3], 7)` widening to
        // `finite_integer | vector<3>` while the value ALWAYS broadcasts to a
        // list — and must be repaired to the definite `list<E>`, so the
        // allowlist is the ONLY thing that defers (a shape test on
        // `sigResult` cannot tell a deliberate union from a widen artifact).
        //
        // For the two pre-existing triggers the handler computed the scalar
        // per-element result. Some handlers leak the collection type or a
        // `scalar | list<E>` union (a naive `widen(…)` over a collection
        // operand); `broadcastElementType` unwraps both so the wrapper does
        // not nest a list or a union inside the broadcast result.
        const handlerOwnsCollectionTyping =
          expr.operator === 'Add' ||
          expr.operator === 'Multiply' ||
          expr.operator === 'Negate';
        const deferToHandler =
          handlerOwnsCollectionTyping &&
          (isSubtype(sigResult, 'collection') ||
            (typeof sigResult !== 'string' &&
              sigResult.kind === 'union' &&
              sigResult.types.some((m) => isSubtype(m, 'collection'))));
        const broadcastingOps = expr.ops.filter(
          (x) =>
            (isFiniteIndexedCollection(x) && !isTuple(x)) ||
            isBroadcastCollectionType(x) ||
            (!deferToHandler && isFixedShapeCollection(x))
        );
        if (broadcastingOps.length > 0)
          // Rank/shape-aware lift (§D6.1): mirror the operands'
          // statically-provable structure — `Sqrt(M)` with `M: matrix<2x2>`
          // types `list<finite_number^2x2>`, statically compatible with
          // `matrix` signature parameters. Falls back to the plain unbounded
          // `list<E>` whenever the shape is not provable from every
          // broadcasting operand (see `broadcastShapedResultType`).
          return maybeAbsorb(
            broadcastShapedResultType(
              broadcastingOps.map((x) => x.type.type),
              broadcastElementType(sigResult)
            )
          );

        // Arm 2 (possibly-collection, step 2 phase C). No operand is a
        // statically-visible collection, but some operand's collection-ness is
        // not statically knowable — an application typed `unknown`/`any`/`value`
        // (e.g. an undeclared `h(x)`), or an already-`broadcastable<…>` node
        // (nested arithmetic). It might broadcast at runtime or stay scalar, so
        // the honest result is `broadcastable<E>` (not a definite `list<E>`).
        // `broadcastElementType(sigResult)` unwraps an already-broadcastable
        // `sigResult` (Add/Multiply handlers compute their own broadcastable
        // type), keeping the arm idempotent — never `broadcastable<broadcastable<…>>`.
        if (expr.ops.some((x) => isPossiblyCollectionTyped(x)))
          return maybeAbsorb({
            kind: 'broadcastable',
            elements: broadcastElementType(sigResult),
          });
      }
    }

    // Honest typing for user function-literal broadcast (Tycho 19.2). A lambda
    // operator definition (`ce.assign('g', x ↦ …)`) with scalar parameters:
    //  - Applied to a statically-visible finite collection argument, the runtime
    //    broadcasts element-wise (step 2b in `_computeValue`), producing a
    //    `List` — so the honest type is the concrete `list<E>`, not the scalar
    //    signature result computed above.
    //  - Applied to a POSSIBLY-collection argument (`broadcastable<…>` or a
    //    top-typed call, `isPossiblyCollectionTyped`), NO pre-evaluation step 2b
    //    fires (that gate only matches statically-visible finite indexed
    //    collections). The static type stays `broadcastable<E>` — NOT a definite
    //    `List` — because collection-ness is not statically provable here. At
    //    RUNTIME, however, the post-eval lambda-broadcast arm (step 4b sync /
    //    step 3b async in `_computeValue`) maps EVERY body element-wise — not
    //    only arithmetic bodies that broadcast internally — once the argument
    //    evaluates to a finite indexed collection, producing a `List`. So a
    //    non-arithmetic body (`x ↦ If(x > 0, 1, -1)`) applied to something that
    //    evaluates to a list is now mapped, not left inert.
    // The scalar-ness gate mirrors the runtime (declared signature authoritative
    // via `paramsAreScalar`; tuples atomic, bound whole, never mapped). A
    // collection-typed PARAMETER makes `paramsAreScalar` false, so a lambda that
    // consumes a whole collection keeps its scalar result unchanged.
    if (
      def instanceof _BoxedOperatorDefinition &&
      def._isLambda &&
      paramsAreScalar(def)
    ) {
      // A numeric-tuple argument binds WHOLE to a scalar parameter (atomic,
      // never mapped), then the body's own arithmetic broadcasts it
      // element-wise (`g := x ↦ 2x`; `g((1,2))` evaluates `2·(1,2) = (2,4)`).
      // The INFERRED scalar signature result therefore disagrees with the
      // value, and we can't statically know the body's shape — return `any`.
      // A DECLARED signature is authoritative (the user promised the result
      // type), so it is left untouched below.
      if (def.inferredSignature && expr.ops.some((x) => isNumericTuple(x)))
        return 'any';
      // For a lambda application the per-element result IS the signature result
      // (`f := x ↦ [x, -x]` maps EACH element to `[x, -x]`, so the element type
      // is `list<number>`, not its unwrapped `number`). Use `sigResult`
      // verbatim — NOT `broadcastElementType(sigResult)`, which would unwrap a
      // collection-valued return and mis-type `f([1, 2])` as `list<number>`
      // instead of `list<list<number>>`.
      {
        const mapped = expr.ops.filter(
          (x) =>
            (isFiniteIndexedCollection(x) && !isTuple(x)) ||
            // Collection-TYPED operands too (Tycho item 73): `h(L+1)` /
            // `h(2L)` — an unevaluated expression statically typed as a
            // list/vector broadcasts through the lambda at runtime (the
            // post-eval lambda-broadcast arm maps it element-wise), so the
            // static type must be the lifted list as well, exactly as at
            // the generic wrapper's arm 1.
            isBroadcastCollectionType(x) ||
            isFixedShapeCollection(x)
        );
        if (mapped.length > 0) {
          // A collection-valued per-element result keeps the plain nested
          // lift (`f := x ↦ [x,-x]` over `[1,2]` → `list<vector<2>>`):
          // installing the collection result as the element of a dimensioned
          // list mixes encodings and breaks `evaluated ⊆ declared` (the
          // value is a rank-2 tensor with scalar leaves).
          const collectionValued =
            isSubtype(sigResult, 'collection') ||
            (typeof sigResult !== 'string' &&
              sigResult.kind === 'union' &&
              sigResult.types.some((m) => isSubtype(m, 'collection')));
          if (collectionValued) return broadcastResultType(sigResult);
          // Shape-aware (§D6.1): the map preserves the source's structure.
          return broadcastShapedResultType(
            mapped.map((x) => x.type.type),
            sigResult
          );
        }
      }
      if (expr.ops.some((x) => isPossiblyCollectionTyped(x)))
        return {
          kind: 'broadcastable',
          elements: sigResult,
        };
    }

    return maybeAbsorb(sigResult);
  }

  // Is this a function literal?
  // e.g. f := (x) -> x + 1
  if (expr.valueDefinition) {
    // A `:=` registration whose declared signature is preserved on the value
    // definition (e.g. `ce.declare('f', '(number) -> number')` then assigning a
    // matching lambda) resolves here rather than through an operator
    // definition. Mirror the same application-site broadcast typing as the
    // operator-def lambda path above, keeping the DECLARED signature
    // authoritative: a collection-typed parameter binds its argument whole, so
    // `paramsAreScalar` is false and the scalar result is preserved.
    // As at the operator-def site above: an overload set resolves to its
    // most-specific viable arm for the RESULT type (§6 of the overload design).
    const sig =
      resolvedArm(expr, expr.valueDefinition.type.type) ??
      expr.valueDefinition.type.type;
    const sigResult = functionResult(sig) ?? 'unknown';
    if (paramsAreScalar(sig)) {
      // As at the operator-def lambda site above: a numeric-tuple argument
      // binds whole to a scalar parameter and the body broadcasts it, so an
      // INFERRED signature result disagrees with the value — return `any`. A
      // DECLARED signature (`inferredType` false) is authoritative and kept.
      if (
        expr.valueDefinition.inferredType &&
        expr.ops.some((x) => isNumericTuple(x))
      )
        return 'any';
      // The per-element result IS the signature result for a lambda application
      // (see the operator-def lambda site above): use `sigResult` verbatim so a
      // collection-valued return types as `list<list<…>>` rather than being
      // flattened by `broadcastElementType`.
      {
        const mapped = expr.ops.filter(
          (x) =>
            (isFiniteIndexedCollection(x) && !isTuple(x)) ||
            // Collection-TYPED operands too (Tycho item 73): `h(L+1)` /
            // `h(2L)` — an unevaluated expression statically typed as a
            // list/vector broadcasts through the lambda at runtime (the
            // post-eval lambda-broadcast arm maps it element-wise), so the
            // static type must be the lifted list as well, exactly as at
            // the generic wrapper's arm 1.
            isBroadcastCollectionType(x) ||
            isFixedShapeCollection(x)
        );
        // Shape-aware (§D6.1), as at the operator-def lambda site above —
        // including the collection-valued-result exception.
        if (mapped.length > 0) {
          const collectionValued =
            isSubtype(sigResult, 'collection') ||
            (typeof sigResult !== 'string' &&
              sigResult.kind === 'union' &&
              sigResult.types.some((m) => isSubtype(m, 'collection')));
          if (collectionValued) return broadcastResultType(sigResult);
          return broadcastShapedResultType(
            mapped.map((x) => x.type.type),
            sigResult
          );
        }
      }
      if (expr.ops.some((x) => isPossiblyCollectionTyped(x)))
        return {
          kind: 'broadcastable',
          elements: sigResult,
        };
    }
    return sigResult;
  }

  // We want to return the result of evaluating the function, so since
  // we don't know (somehow?) we return 'unknown', not 'function', which
  // is the type of the function itself, not of its result.
  return 'unknown';
}

function applyFunctionLiteral(
  expr: BoxedFunction,
  def: BoxedValueDefinition,
  options?: Partial<EvaluateOptions>
): Expression {
  const value = def.isConstant
    ? def.value
    : expr.engine._getSymbolValue(expr.operator);

  if (value && !value.type.matches('function')) {
    if (!value.isValid) return expr;
    return expr.engine.typeError('function', value.type, value.toString());
  }

  const ops = expr.ops.map((x) => x.evaluate(options));
  if (!value || value.type.isUnknown) {
    // The cached `_def` may be a function-typed *value* placeholder (created
    // by the `Assign`/`Declare` canonical pass, e.g. a block-local one-step
    // definition `f(x) = …` inside a function body) while the runtime
    // `ce.assign` created an *operator* definition, which
    // `_getSymbolValue` cannot read. If the symbol now resolves to an
    // operator definition, dispatch through it; otherwise stay symbolic.
    const opDef = expr.engine.lookupDefinition(expr.operator);
    if (opDef && isOperatorDef(opDef))
      return expr.engine.function(expr.operator, ops).evaluate(options);
    return expr.engine.function(expr.operator, ops);
  }

  // Broadcast if any operand is a finite indexed collection and the
  // function's parameter types are scalar. Zip operands and apply
  // pointwise, returning a List of results. Tuples are excluded
  // (`!isTuple`): a `Tuple` is an atomic value, bound whole, never mapped.
  // The DECLARED signature is authoritative for the broadcast decision when
  // present (a `:=` registration preserves it on the value definition — see
  // the declared-signature reconciliation): a collection-typed parameter
  // (e.g. `(tuple | list<tuple>) -> any`) binds its argument WHOLE. The
  // literal's own inferred type is only the fallback.
  const declaredType = def.type?.type;
  const broadcastGateType =
    typeof declaredType === 'object' && declaredType.kind === 'signature'
      ? declaredType
      : value.type.type;
  if (
    ops.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
    paramsAreScalar(broadcastGateType)
  ) {
    // Hybrid laziness, as at the operator-def lambda broadcast (step 2b):
    // past the eager threshold — or for a provably-finite collection of
    // unknown size — return the lazy `Map` form instead of materializing.
    // The `Map` body references the function by NAME (`g(_1)`), so each
    // element re-dispatches through this path on a scalar at drain time.
    const lazy = lazyBroadcastMapIfNeeded(
      expr.engine,
      expr.operator,
      ops,
      isBroadcastableCollection,
      options?.numericApproximation ?? false
    );
    if (lazy) return lazy;

    const items = zip(ops);
    if (items) {
      const results: Expression[] = [];
      while (true) {
        const { done, value: zipped } = items.next();
        if (done) break;
        results.push(apply(value, zipped, options));
      }
      return expr.engine._fn('List', results);
    }
  }

  // The value is a function literal. Apply the arguments to it, threading
  // the caller's options — `numericApproximation` is honored inside the
  // function's scope frame (see makeLambda), preserving lexical scoping.
  return apply(value, ops, options);
}

/**
 * When `sig` is an overload set (an intersection of signatures), the arm this
 * application resolves to — the most-specific one whose parameters admit
 * `expr.ops`. `undefined` for a plain signature, for a non-overload type, and
 * when no arm fits. In that last case the caller falls back to
 * `functionResult` of the whole intersection, which is the §5.1 join over
 * every arm's result — NOT `unknown`; the operands have already been marked
 * invalid by `validateArguments`, so the imprecision is not load-bearing.
 *
 * **The policies must match the ones `validateArguments` resolved with.** They
 * are recomputed here rather than threaded through because `.type` is a getter
 * reached on paths that never ran validation; resolving with different
 * policies would let the result type come from a different arm than the one
 * the call was validated against (a lazy operator is the clearest case — its
 * operands are unbound, so type filtering there is noise).
 *
 * Result typing only — see `overload.ts` for why operand *inference* must use
 * the join over every viable arm instead.
 */
function resolvedArm(
  expr: BoxedFunction,
  sig: Readonly<Type> | undefined
): Type | undefined {
  const arms = overloadArms(sig);
  if (!arms) return undefined;
  const def = expr.operatorDefinition;
  const selected = resolveOverload(expr.engine, expr.ops, arms, {
    lazy: def?.lazy,
    threadable: def?.broadcastable,
    couldBeCollection: couldBeCollectionOperand,
  }).selected;
  if (selected === undefined) return undefined;

  // Value-arm JOIN (function-polymorphism design §4.4): when an arm
  // dispatches on VALUES, the boolean filter drops arms a symbolic operand
  // leaves genuinely open (`f(0) -> string` & `f(n: integer) -> integer`
  // called on an operand typed `integer`: runtime may take either arm).
  // `triStateSelect` — the SAME decision procedure the runtime selector
  // runs — says whether dispatch is decided: `selected` keeps that arm's
  // exact result (`f(0)` types `string`); `blocked` joins the results of
  // every non-refuted arm. Gated on value components — declared overload
  // sets without them keep the boolean-selected arm byte-identically.
  // Skipped for lazy operators (operands unbound; their types refute
  // nothing meaningful).
  if (!def?.lazy && arms.some(armHasValueParam)) {
    const verdict = triStateSelect(expr.ops, arms);
    if (verdict.kind === 'selected') return arms[verdict.index];
    if (verdict.kind === 'blocked')
      return {
        ...selected,
        result: widen(...verdict.nonRefuted.map((i) => arms[i].result)),
      };
  }
  return selected;
}

/** Returns true when every formal parameter of a signature is a scalar
 * type (not a collection/list/tuple/function).
 *
 * Accepts either a `Type` (typically from a function-typed value) or a
 * `BoxedOperatorDefinition` (whose `signature.type` is inspected).
 *
 * Conservative: unknown/any and non-signature types are treated as scalar,
 * which makes this a permissive default for inferred lambda signatures.
 * @internal
 */
export function paramsAreScalar(
  source: BoxedOperatorDefinition | Type
): boolean {
  const sigType = isOperatorDefinition(source)
    ? source.signature?.type
    : source;
  if (!sigType || typeof sigType === 'string') return true;
  if (sigType.kind !== 'signature') return true;
  const args = [
    ...(sigType.args ?? []),
    ...(sigType.optArgs ?? []),
    ...(sigType.variadicArg ? [sigType.variadicArg] : []),
  ];
  return args.every((arg) => isScalarType(arg.type));
}

function isOperatorDefinition(
  source: BoxedOperatorDefinition | Type
): source is BoxedOperatorDefinition {
  return typeof source === 'object' && source !== null && 'signature' in source;
}

/**  Eagerly evaluate xs by iterating over its elements.
 *
 * If eager is true, evaluate DEFAULT_MATERIALIZATION elements.
 *
 * If eager is a number, evaluate that many elements, half in the head and
 * half in the tail.
 *
 * If eager is a tuple [head, tail], evaluate that many elements in the head and
 * that many elements in the tail.
 */
function materialize(
  expr: BoxedFunction,
  def: BoxedOperatorDefinition,
  options?: Partial<EvaluateOptions>
): Expression {
  if (!expr.isValid || options?.materialization === false) return expr;

  // Emptiness indeterminate (e.g. Range(1, n) with a symbolic bound): the
  // collection cannot be enumerated, so fabricating a literal would collapse
  // it (previously to the 1-element list [1]). Keep the lazy form.
  if (expr.isEmptyCollection === undefined) return expr;

  let materialization = options?.materialization ?? false;
  if (typeof materialization === 'boolean')
    materialization = DEFAULT_MATERIALIZATION;

  // Static-type indexed-ness, with a value-aware fallback: a lazy wrapper
  // over a declared-`unknown` symbol holding an indexed collection (e.g. a
  // `Filter(L, …)` whose type is its source's `unknown`) sheds indexed-ness
  // statically — without the fallback its preview would render with a
  // misleading `Set` head and no tail. The fallback only applies when the
  // static type is indeterminate, and consults the SOURCE operand's
  // value-aware indexed-ness (a symbol holding a `List` reports indexed; one
  // holding a `Set` does not) — NOT an `at(1)` probe, which misclassifies
  // operators like `Filter` that answer `at` by sequential scan over
  // non-indexed sources.
  const t = expr.type.type;
  const isIndexed =
    expr.isIndexedCollection ||
    ((t === 'unknown' || t === 'any' || t === 'value') &&
      def.collection?.at !== undefined &&
      expr.nops > 0 &&
      expr.op1.isIndexedCollection === true);
  const isFinite = expr.isFiniteCollection;

  // Leave oversized indexed collections in their lazy form. Consumers
  // can detect the size via `.count` without risking OOM.
  if (isIndexed && isFinite) {
    const count = expr.count;
    if (count !== undefined && count > expr.engine.maxCollectionSize)
      return expr;
  }

  const xs: Expression[] = [];

  if (!expr.isEmptyCollection) {
    // The head+tail rendering needs the exact `count` (it indexes the tail
    // from the end). A collection can be provably FINITE without knowing its
    // count — `Take(xs, 10)` over a source that may exhaust early, a `Filter`
    // of a finite list — and there the head+tail branch fabricated a trailing
    // `ContinuationPlaceholder` for a collection that had already ended.
    // Finiteness and exact count are separate questions: fall back to the
    // head-only walk, which probes the iterator for a genuine continuation.
    if (!isIndexed || !isFinite || expr.count === undefined) {
      //
      // If we're not indexed, or not finite (or of unknown length), we can
      // only materialize the head
      //
      const last =
        typeof materialization === 'number'
          ? materialization
          : materialization[0];
      const iter = expr.each();
      for (const x of iter) {
        if (xs.length === last) {
          // If we have more elements, add a ContinuationPlaceholder
          if (!iter.next().done)
            xs.push(expr.engine.symbol('ContinuationPlaceholder'));
          break;
        }
        xs.push(x.evaluate(options));
      }
    } else {
      //
      // We are indexed and finite, so we can materialize the head and tail
      //
      const [headSize, tailSize]: [number, number] =
        typeof materialization === 'number'
          ? [
              Math.ceil(materialization / 2),
              materialization - Math.ceil(materialization / 2),
            ]
          : materialization;

      // Materialize the head
      let i = 1;
      const iter = expr.each();
      for (const x of iter) {
        xs.push(x.evaluate(options));
        i += 1;
        if (i > headSize) break;
      }

      // Nothing enumerable despite claiming elements (e.g. Linspace with a
      // symbolic endpoint: concrete count, but its iterator declines): keep
      // the lazy form rather than fabricate a placeholder literal.
      if (xs.length === 0) return expr;

      const count = expr.count;
      if (count === undefined || count <= headSize) {
        // If the collection is smaller than the head, we don't need to evaluate the tail
        if (count === undefined || xs.length < count)
          xs.push(expr.engine.symbol('ContinuationPlaceholder'));
      } else {
        // Materialize the tail
        // Ensure tail doesn't overlap with head and add ContinuationPlaceholder if needed
        const tailStartIndex = Math.max(headSize + 1, count - tailSize + 1);

        // Add ContinuationPlaceholder if there's a gap between head and tail
        if (count > headSize + tailSize) {
          xs.push(expr.engine.symbol('ContinuationPlaceholder'));
        }

        i = tailStartIndex;
        while (i <= count) {
          const x = expr.at(i);
          if (!x) break;
          xs.push(x.evaluate(options));
          i += 1;
        }
      }
    }
  }

  // A collection that claims elements but yielded none cannot be enumerated
  // (e.g. Linspace with a symbolic endpoint, whose iterator declines): keep
  // the lazy form rather than fabricate an empty or placeholder literal.
  if (xs.length === 0 && expr.isEmptyCollection === false) return expr;

  //
  // Convert to a List, Set or Dictionary depending on the type of
  // the collection.
  //

  const elttype = def.collection?.elttype?.(expr);
  if (elttype && isSubtype(elttype, 'tuple<string, any>')) {
    // If the collection is a collection of key-value pairs,
    // we convert it to a Dictionary
    return expr.engine.function('Dictionary', xs);
  }

  // `Nothing` is an ERASURE marker: a lazy stream element that materialized as
  // `Nothing` (e.g. a `Map` body producing `Nothing`) is spliced out of the
  // resulting collection (§3.G). `Missing` is preserved. (The
  // `ContinuationPlaceholder` sentinel is not `Nothing`, so it survives.)
  const materialized = xs.filter((x) => !isSymbol(x, 'Nothing'));

  if (isIndexed) return expr.engine._fn('List', materialized);

  return expr.engine.function('Set', [...materialized]);
}
