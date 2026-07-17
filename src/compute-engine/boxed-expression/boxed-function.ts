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
  isBroadcastCollectionType,
  isFiniteIndexedCollection,
  isFixedShapeCollection,
  isLinearAlgebraCollection,
  isNumericTuple,
  isPossiblyCollectionTyped,
  isTuple,
  zip,
} from '../collection-utils.js';
import { isTensor } from './boxed-tensor.js';
import { _BoxedOperatorDefinition } from './boxed-operator-definition.js';
import {
  isNumber,
  isFunction,
  isString,
  isContinuationOperand,
} from './type-guards.js';
import type { NumericPrimitiveType } from '../../common/type/types.js';
import { Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { parseType } from '../../common/type/parse.js';
import { isSubtype } from '../../common/type/subtype.js';
import { NUMERIC_TYPES } from '../../common/type/primitive.js';
import {
  broadcastElementType,
  broadcastResultType,
  functionResult,
  isSignatureType,
  narrow,
  widen,
} from '../../common/type/utils.js';
import { NumericValue } from '../numeric-value/types.js';

import { findUnivariateRoots } from './solve.js';
import { filterRootsByAssumptions } from './solve-domain.js';
import { solveSystem, solveOr } from './solve-system.js';
import { solveCongruence } from './solve-congruence.js';
import { replace } from './rules.js';
import { negate } from './negate.js';
import { simplify } from './simplify.js';
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
import { apply, lookup } from '../function-utils.js';
import {
  functionLiteralParameters,
  functionLiteralReturnType,
} from './function-literal.js';
import { typeToString } from '../../common/type/serialize.js';
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

  private _isPure: boolean | undefined;

  private _isStructural: boolean;

  private _hash: number | undefined;

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
      def.signature = new BoxedType(
        {
          kind: 'signature',
          args: oldSig.args,
          optArgs: oldSig.optArgs,
          variadicArg: oldSig.variadicArg,
          variadicMin: oldSig.variadicMin,
          result:
            inferenceMode === 'narrow'
              ? narrow(oldSig.result, t)
              : widen(oldSig.result, t),
        },
        this.engine._typeResolver
      );
    }

    this.engine._generation += 1;

    return true;
  }

  bind(): void {
    this._def = lookup(
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

  get isPure(): boolean {
    if (this._isPure !== undefined) return this._isPure;

    let pure = this.operatorDefinition?.pure ?? false;

    // The function expression might be pure. Let's check that all its
    // arguments are pure.
    if (pure) pure = this._ops.every((x) => x.isPure);

    this._isPure = pure;
    return pure;
  }

  get isConstant(): boolean {
    return this.isPure && this._ops.every((x) => x.isConstant);
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
    if (this._operator === 'Error') return false;

    return this._ops.every((x) => x?.isValid);
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
    if (options.canonical === undefined)
      options = { canonical: this.isCanonical || this.isStructural };

    // A non-canonical (held) child of a canonical parent — e.g. the index
    // symbol of `Limits`, held by `lazy` so it is never canonicalized — must
    // stay raw: canonicalizing it here happens OUTSIDE its binding scope (an
    // index `i` would become the imaginary unit). The parent's canonical
    // handler receives it raw, as it did when the expression was first built.
    // (A raw symbol reports `isStructural: true`, so key on `isCanonical`.)
    const ops = this._ops.map((x) =>
      options!.canonical === true && !x.isCanonical
        ? x.subs(sub, { canonical: false })
        : x.subs(sub, options)
    );

    const form =
      options.canonical === true
        ? 'canonical'
        : options.canonical === false
          ? 'raw'
          : options.canonical;

    if (!ops.every((x) => x.isValid))
      return this.engine.function(this._operator, ops, { form: 'raw' });

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

  get sgn(): Sign | undefined {
    const gen =
      this.isPure && this._ops.every((x) => x.isConstant)
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
      return [num.pow(this.op2), denom.pow(this.op2)];
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
    const gen =
      this.isPure && this._ops.every((x) => x.isConstant)
        ? undefined
        : this.engine._generation;
    return (
      cachedValue(
        this._type,
        gen,
        () => new BoxedType(type(this), this.engine._typeResolver)
      ) ?? BoxedType.unknown
    );
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
    // Arm the evaluation deadline (like evaluate()): simplification of
    // large expressions (e.g. radical towers) can run unboundedly, and the
    // simplify main loop checks `engine._deadline`.
    return withDeadline(
      this.engine,
      () => simplify(this, options).at(-1)?.value ?? this
    )();
  }

  explain(operation?: ExplainOperation, options?: ExplainOptions): Explanation {
    return explainExpression(this, operation, options);
  }

  evaluate(options?: Partial<EvaluateOptions>): Expression {
    return withDeadline(this.engine, this._computeValue(options))();
  }

  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<Expression> {
    return withDeadlineAsync(this.engine, this._computeValueAsync(options))();
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

    return def !== undefined;
  }

  get isIndexedCollection(): boolean {
    if (!this.isValid) return false;
    const def = this.baseDefinition?.collection;

    // If there is no `at` handler, it is definitely not indexed
    if (!def?.at) return false;

    // If there is an `at` handler, it _may_ be indexed.
    // We check the actual result type, e.g. Map has an at handler
    // (to access its keys), but can be indexed or not, depending on the
    // input collection

    return this.type.matches('indexed_collection');
  }

  get isLazyCollection(): boolean {
    if (!this.isValid) return false;
    const def = this.baseDefinition?.collection;
    if (!def) return false;
    return def?.isLazy?.(this) ?? false;
  }

  contains(rhs: Expression): boolean | undefined {
    return this.baseDefinition?.collection?.contains?.(this, rhs);
  }

  get count(): number | undefined {
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
    return (function* () {
      let result = iter.next();
      let i = 0;
      while (!result.done) {
        // Enumeration can be unbounded (infinite or very large lazy
        // collections): respect the engine evaluation deadline.
        if ((++i & 0xff) === 0) checkDeadline(engine._deadline);
        yield result.value;
        result = iter.next();
      }
    })();
  }

  at(index: number): Expression | undefined {
    return this.operatorDefinition?.collection?.at?.(this, index);
  }

  get(index: Expression | string): Expression | undefined {
    if (typeof index === 'string')
      return this.operatorDefinition?.collection?.at?.(this, index);

    if (!isString(index)) return undefined;
    return this.operatorDefinition?.collection?.at?.(this, index.string);
  }

  indexWhere(predicate: (element: Expression) => boolean): number | undefined {
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
    return (
      this.operatorDefinition?.collection?.subsetOf?.(this, rhs, strict) ??
      false
    );
  }

  _computeValue(options?: Partial<EvaluateOptions>): () => Expression {
    return () => {
      // Cooperative deadline checkpoint on the per-node evaluation path.
      // Specialized loops (collection enumeration, polynomial GCD, Rubi
      // matching) carry their own checks, but handler-driven evaluation —
      // e.g. a user-function body whose parameter substitution multiplies
      // the tree at every nesting level — never reaches them: without this
      // check such an evaluation exhausts the heap instead of honoring
      // `ce.timeLimit`.
      if ((++_evalTick & 0x3ff) === 0) checkDeadline(this.engine._deadline);

      if (!this.isValid || !this._def) return this;

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
      const hasTensors = this.ops!.some((x) => isTensor(x));
      const hasRawOperand =
        (this.operator === 'Add' || this.operator === 'Multiply') &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      if (
        def.broadcastable &&
        !hasRawOperand &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        !skipBroadcastForVectorOps(this.operator, hasTensors, this.ops!)
      ) {
        const items = zip(this._ops);
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
        const items = zip(this._ops);
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
      // 4/ Evaluate the applicable operands in the current scope
      //
      const tail = holdMap(this, (x) => x.evaluate(options));

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
      if (
        (lambdaBroadcast ||
          (def.broadcastable &&
            this.operator !== 'Add' &&
            this.operator !== 'Multiply')) &&
        !skipBroadcastForVectorOps(this.operator, false, tail) &&
        tail.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))
      ) {
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
        });
      } finally {
        if (isScoped) this.engine._popEvalContext();
      }

      // Fallback to a symbolic result if we could not evaluate
      const result = evalResult ?? this.engine.function(this._operator, tail);

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
      if ((++_evalTick & 0x3ff) === 0) checkDeadline(this.engine._deadline);

      if (!this.isValid || !this._def) return this;

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
      const hasTensors = this.ops!.some((x) => isTensor(x));
      const hasRawOperand =
        (this.operator === 'Add' || this.operator === 'Multiply') &&
        this.ops!.some((x) => isFunction(x) && !isFiniteIndexedCollection(x));
      if (
        def?.broadcastable &&
        !hasRawOperand &&
        this.ops!.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)) &&
        !skipBroadcastForVectorOps(this.operator, hasTensors, this.ops!)
      ) {
        const items = zip(this._ops);
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
        const items = zip(this._ops);
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
      // 3/ Evaluate the applicable operands
      //

      // Resolve all the operand promises
      const tail = await holdMapAsync(
        this,
        async (x) => await x.evaluateAsync(options)
      );

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
      if (
        (lambdaBroadcast ||
          (def.broadcastable &&
            this.operator !== 'Add' &&
            this.operator !== 'Multiply')) &&
        !skipBroadcastForVectorOps(this.operator, false, tail) &&
        tail.some((x) => isFiniteIndexedCollection(x) && !isTuple(x))
      ) {
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

      if (isScoped) {
        this.engine._pushEvalContext(this._localScope!);
      }

      //
      // 5/ Call the `evaluate` handler
      //
      const engine = this.engine;

      let evaluateFn: Expression | Promise<Expression | undefined> | undefined;
      try {
        const opts: Partial<EvaluateOptions> & { engine: ComputeEngine } = {
          numericApproximation,
          engine,
          signal: options?.signal,
          materialization: options?.materialization,
        };
        evaluateFn =
          def.evaluateAsync?.(tail, opts) ?? def.evaluate?.(tail, opts);
      } finally {
        if (isScoped) this.engine._popEvalContext();
      }

      return Promise.resolve(evaluateFn).then((value) => {
        const result = value ?? engine.function(this._operator, tail);
        // 5b/ Pole-aware numeric evaluation (see the sync path).
        if (numericApproximation)
          return applyPoleOverride(engine, this._operator, tail, result);
        return result;
      });
    };
  }
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
  if (
    (operator === 'Equal' || operator === 'NotEqual') &&
    ops.filter((x) => x.isCollection).length >= 2
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
 * through to normal evaluation.
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

  return undefined;
}

/** Return the type of the value of the expression, without actually
 * evaluating it */
function type(expr: BoxedFunction): Type {
  if (!expr.isValid) return 'error';

  // Is this a 'Function' expression?
  if (expr.operator === 'Function') {
    // What is the type of the body of the function?
    const body = expr.ops[0];
    const params = functionLiteralParameters(expr);

    // Result type: an explicit return-type ascription (the §4.2 marker) is
    // used verbatim, bypassing the widening rule. A Block's type is its last
    // statement's type, so `body.type` already surfaces the ascribed return.
    const ascribedReturn = functionLiteralReturnType(expr);
    let bodyType: Type | string = `${body.type}`;
    // The parameters of a bare function literal have unknown type, so a
    // finite-numeric body claim is unsound: the lambda may later be applied to
    // a non-finite argument — `(x ↦ x²)(∞) = +∞` — so widen a finite-numeric
    // result to the top numeric type `number`. (A nullary function has no such
    // parameter, so its exact body type is kept.) Suppress the widening only
    // when EVERY parameter type is provably finite (`finite_number`); in this
    // type system `integer`/`rational`/`real` all admit non-finite values, so
    // a param annotated `integer` still widens. A bare param (type undefined)
    // never suppresses widening.
    if (
      ascribedReturn === undefined &&
      params.length > 0 &&
      body.type.matches('finite_number') &&
      !params.every(
        (p) => p.type !== undefined && isSubtype(p.type, 'finite_number')
      )
    )
      bodyType = 'number';

    // Parameter slots: an annotated param emits its declared type, named
    // (`x: integer`); a bare param stays `unknown` as today.
    const paramSig = params
      .map((p) =>
        p.type !== undefined ? `${p.name}: ${typeToString(p.type)}` : 'unknown'
      )
      .join(', ');

    return parseType(`(${paramSig}) -> ${bodyType}`, expr.engine._typeResolver);
  }

  // Is there a definition associated with the operator of the function?
  const def = expr.operatorDefinition;
  if (def) {
    const sig =
      def.signature instanceof BoxedType
        ? def.signature.type
        : typeof def.signature === 'string'
          ? parseType(def.signature, expr.engine._typeResolver)
          : def.signature;

    let sigResult = functionResult(sig) ?? 'unknown';

    // If there is a type handler, call it
    if (typeof def.type === 'function') {
      const calculatedType = def.type(expr.ops, { engine: expr.engine });
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
      const hasTensors = expr.ops.some((x) => isTensor(x));
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
        // `Add`/`Multiply` (their own matrix/vector/union branches, incl. the
        // deliberate honest `finite_integer | matrix` for `matrix + scalar`)
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
        if (
          expr.ops.some(
            (x) =>
              (isFiniteIndexedCollection(x) && !isTuple(x)) ||
              isBroadcastCollectionType(x) ||
              (!deferToHandler && isFixedShapeCollection(x))
          )
        )
          return broadcastResultType(broadcastElementType(sigResult));

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
          return {
            kind: 'broadcastable',
            elements: broadcastElementType(sigResult),
          };
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
      if (expr.ops.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)))
        return broadcastResultType(sigResult);
      if (expr.ops.some((x) => isPossiblyCollectionTyped(x)))
        return {
          kind: 'broadcastable',
          elements: sigResult,
        };
    }

    return sigResult;
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
    const sig = expr.valueDefinition.type.type;
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
      if (expr.ops.some((x) => isFiniteIndexedCollection(x) && !isTuple(x)))
        return broadcastResultType(sigResult);
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

function withDeadline<T>(engine: ComputeEngine, fn: () => T): () => T {
  return () => {
    if (engine._deadline === undefined) {
      engine._deadline = Date.now() + engine.timeLimit;

      try {
        return fn();
      } finally {
        engine._deadline = undefined;
      }
    }

    return fn();
  };
}

function withDeadlineAsync<T>(
  engine: ComputeEngine,
  fn: () => Promise<T>
): () => Promise<T> {
  return async () => {
    if (engine._deadline === undefined) {
      engine._deadline = Date.now() + engine.timeLimit;

      try {
        return await fn();
      } finally {
        engine._deadline = undefined;
      }
    }

    return fn();
  };
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
function paramsAreScalar(source: BoxedOperatorDefinition | Type): boolean {
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

/** A type is "scalar" for broadcasting purposes if it is NOT a known
 * collection-like type. Conservative: unknown/any → scalar.
 */
function isScalarType(t: Type): boolean {
  if (typeof t === 'string') {
    // String types like 'collection', 'list', 'tuple', 'set' are non-scalar.
    if (
      t === 'collection' ||
      t === 'indexed_collection' ||
      t === 'list' ||
      t === 'tuple' ||
      t === 'set' ||
      t === 'dictionary' ||
      t === 'record' ||
      t === 'function'
    )
      return false;
    return true;
  }
  if (
    t.kind === 'collection' ||
    t.kind === 'indexed_collection' ||
    t.kind === 'list' ||
    t.kind === 'tuple' ||
    t.kind === 'set' ||
    t.kind === 'dictionary' ||
    t.kind === 'record' ||
    t.kind === 'signature' ||
    // A `broadcastable<T>` parameter accepts a collection whole (it handles
    // collections natively), so it is NOT a scalar — a lambda with such a
    // parameter must not be mapped/broadcast over a collection argument.
    t.kind === 'broadcastable'
  )
    return false;
  if (t.kind === 'union' || t.kind === 'intersection')
    return t.types.every((x) => isScalarType(x));
  if (t.kind === 'negation') return isScalarType(t.type);
  return true;
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

  const isIndexed = expr.isIndexedCollection;
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
    if (!isIndexed || !isFinite) {
      //
      // If we're not indexed, or not finite, we can only materialize the head
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

  if (isIndexed) return expr.engine._fn('List', xs);

  return expr.engine.function('Set', [...xs]);
}
