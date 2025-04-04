import type { Expression } from '../../math-json/types';
import type {
  SimplifyOptions,
  ReplaceOptions,
  PatternMatchOptions,
  BoxedExpression,
  BoxedBaseDefinition,
  BoxedFunctionDefinition,
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  ComputeEngine,
  Metadata,
  Rule,
  RuntimeScope,
  Sign,
  Substitution,
} from '../global-types';

import { findUnivariateRoots } from './solve';
import { replace } from './rules';
import { negate } from './negate';
import { Product } from './product';
import { simplify } from './simplify';
import { canonicalMultiply, mul, div } from './arithmetic-mul-div';
import { add } from './arithmetic-add';
import { pow } from './arithmetic-power';

import { asSmallInteger } from './numerics';

import { isFiniteIndexableCollection, zip } from '../collection-utils';

import { NumericValue } from '../numeric-value/types';

import { _BoxedExpression } from './abstract-boxed-expression';
import { DEFAULT_COMPLEXITY, sortOperands } from './order';
import { hashCode, normalizedUnknownsForSolve } from './utils';
import { match } from './match';
import { factor } from './factor';
import { holdMap, holdMapAsync } from './hold';
import { Type } from '../../common/type/types';
import { parseType } from '../../common/type/parse';
import { isSubtype } from '../../common/type/subtype';
import {
  functionResult,
  isSignatureType,
  narrow,
} from '../../common/type/utils';
import {
  positiveSign,
  nonNegativeSign,
  negativeSign,
  nonPositiveSign,
  sgn,
} from './sgn';
import { cachedValue, CachedValue, cachedValueAsync } from './cache';
import { BoxedType } from '../../common/type/boxed-type';

/**
 * A boxed function represent an expression that can be represented by a
 * function call.
 *
 * It is composed of an operator (the name of the function) and a list of
 * arguments.
 *
 * It has a definition associated with it, based on the operator.
 * The definition contains the signature of the function, and the
 * implementation of the function.
 *
 */

export class BoxedFunction extends _BoxedExpression {
  // The name of the function
  private readonly _name: string;

  // The operands of the function
  private readonly _ops: ReadonlyArray<BoxedExpression>;

  // The canonical representation of this expression.
  // If this expression is not canonical, this property is undefined.
  private _canonical: BoxedExpression | undefined;

  // The scope in which this function was defined/boxed
  private _scope: RuntimeScope | null;

  // Only canonical expressions have an associated def
  _def: BoxedFunctionDefinition | undefined;

  private _isPure: boolean;

  private _isStructural: boolean;

  private _hash: number | undefined;

  // Cached properties of the expression
  private _value: CachedValue<BoxedExpression> = {
    value: null,
    generation: -1,
  };
  private _valueN: CachedValue<BoxedExpression> = {
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
    name: string,
    ops: ReadonlyArray<BoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      structural?: boolean;
    }
  ) {
    super(ce, options?.metadata);

    this._name = name;
    this._ops = ops;
    this._isStructural = options?.structural ?? false;

    if (options?.canonical) this._canonical = this;
    if (options?.canonical || this._isStructural) this.bind();

    ce._register(this);
  }

  //
  // NON-CANONICAL OR CANONICAL OPERATIONS
  //
  // Those operations/properties can be applied to a canonical or
  // non-canonical expression
  //
  get hash(): number {
    if (this._hash !== undefined) return this._hash;

    let h = 0;
    for (const op of this._ops) h = ((h << 1) ^ op.hash) | 0;

    h = (h ^ hashCode(this._name)) | 0;
    this._hash = h;
    return h;
  }

  // For function expressions, `infer()` infers the result type of the function
  infer(t: Type): boolean {
    const def = this.functionDefinition;
    if (!def) return false;

    if (!def.inferredSignature) return false;

    // If the signature was inferred, refine it by narrowing the result
    if (def.signature.is('function')) {
      def.signature = new BoxedType({ kind: 'signature', result: t });
    } else if (isSignatureType(def.signature.type)) {
      def.signature = new BoxedType({
        kind: 'signature',
        result: narrow(def.signature.type.result, t),
      });
    }

    this.engine.generation += 1;

    return true;
  }

  bind(): void {
    // Unbind
    this._def = undefined;

    this._scope = this.engine.context;

    this._def = this.engine.lookupFunction(this._name);
    for (const op of this._ops) op.bind();
  }

  reset(): void {
    // Note: a non-canonical expression is never bound
    // this._def = null;
  }

  get isCanonical(): boolean {
    return this._canonical === this;
  }

  set isCanonical(val: boolean) {
    this._canonical = val ? this : undefined;
  }

  get isPure(): boolean {
    if (this._isPure !== undefined) return this._isPure;
    if (this.isCanonical === false) return this.canonical.isPure;

    let pure = this.functionDefinition?.pure ?? false;

    // The function might be pure. Let's check that all its arguments are pure.
    if (pure) pure = this._ops.every((x) => x.isPure);

    this._isPure = pure;
    return pure;
  }

  get isConstant(): boolean {
    if (!this.isPure) return false;
    return this._ops.every((x) => x.isConstant);
  }

  get constantValue(): number | boolean | string | object | undefined {
    return this.isConstant ? this.value : undefined;
  }

  /**
   *
   * @inheritdoc
   */
  get value(): number | boolean | string | object | undefined {
    if (!this.isPure) return undefined;
    return this.N().valueOf();
  }

  get json(): Expression {
    return [this._name, ...this.structural.ops!.map((x) => x.json)];
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get operator(): string {
    return this._name;
  }

  get ops(): ReadonlyArray<BoxedExpression> {
    return this._ops;
  }

  get nops(): number {
    return this._ops.length;
  }

  get op1(): BoxedExpression {
    return this._ops[0] ?? this.engine.Nothing;
  }
  get op2(): BoxedExpression {
    return this._ops[1] ?? this.engine.Nothing;
  }
  get op3(): BoxedExpression {
    return this._ops[2] ?? this.engine.Nothing;
  }

  get isValid(): boolean {
    if (this._name === 'Error') return false;

    return this._ops.every((x) => x?.isValid);
  }

  get canonical(): BoxedExpression {
    this._canonical ??= this.isValid
      ? this.engine.function(this._name, this._ops)
      : this;

    return this._canonical;
  }

  get structural(): BoxedExpression {
    if (this.isStructural) return this;
    const def = this.functionDefinition;
    if (def?.associative || def?.commutative) {
      // Flatten the arguments if they are the same as the operator
      const xs: BoxedExpression[] = this.ops.map((x) => x.structural);
      let ys: BoxedExpression[] = [];
      if (!def.associative) ys = xs;
      else {
        for (const x of xs) {
          if (x.operator === this.operator) ys.push(...x.ops!);
          else ys.push(x);
        }
      }
      return this.engine.function(
        this._name,
        this.isValid ? sortOperands(this._name, ys) : ys,
        {
          canonical: false,
          structural: true,
        }
      );
    }
    return this.engine.function(
      this._name,
      this.ops.map((x) => x.structural),
      { canonical: false, structural: true }
    );
  }

  get isStructural(): boolean {
    return this._isStructural;
  }

  toNumericValue(): [NumericValue, BoxedExpression] {
    console.assert(this.isCanonical || this.isStructural);

    const ce = this.engine;

    if (this.operator === 'Complex') {
      return [ce._numericValue({ re: this.op1.re, im: this.op2.re }), ce.One];
    }

    //
    // Add
    //
    //  use factor() to factor out common factors
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let expr: BoxedExpression = this;
    if (expr.operator === 'Add') {
      expr = factor(this);
      if (expr.numericValue !== null) {
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
    if (expr.operator === 'Negate') {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.neg(), rest];
    }

    //
    // Multiply
    //
    if (expr.operator === 'Multiply') {
      const rest: BoxedExpression[] = [];
      let coef = ce._numericValue(1);
      for (const arg of expr.ops!) {
        const [c, r] = arg.toNumericValue();
        coef = coef.mul(c);
        if (!r.is(1)) rest.push(r);
      }
      if (rest.length === 0) return [coef, ce.One];
      if (rest.length === 1) return [coef, rest[0]];
      return [coef, canonicalMultiply(this.engine, rest)];
    }

    //
    // Divide
    //
    if (expr.operator === 'Divide') {
      const [coef1, numer] = expr.op1.toNumericValue();
      const [coef2, denom] = expr.op2.toNumericValue();
      const coef = coef1.div(coef2);
      if (denom.is(1)) return [coef, numer];
      return [coef, ce.function('Divide', [numer, denom])];
    }

    //
    // Power/Sqrt/Root
    //
    if (expr.operator === 'Power') {
      // We can only extract a coef if the exponent is a literal
      if (expr.op2.numericValue === null) return [ce._numericValue(1), this];

      // eslint-disable-next-line prefer-const
      let [coef, base] = expr.op1.toNumericValue();
      if (coef.isOne) return [coef, this];

      const exponent = asSmallInteger(expr.op2);
      if (exponent !== null)
        return [coef.pow(exponent), ce.function('Power', [base, expr.op2])];

      if (expr.op2.is(0.5)) return [coef.sqrt(), ce.function('Sqrt', [base])];

      return [ce._numericValue(1), this];
    }

    if (expr.operator === 'Sqrt') {
      const [coef, rest] = expr.op1.toNumericValue();
      // @fastpasth
      if (rest.is(1) || rest.is(0)) {
        if (coef.isOne || coef.isZero) return [coef, rest];
        return [coef.sqrt(), rest];
      }
      return [coef.sqrt(), ce.function('Sqrt', [rest])];
    }

    if (expr.operator === 'Root') {
      const exp = expr.op2.re;
      if (isNaN(exp) || expr.op2.im !== 0) return [ce._numericValue(1), this];

      const [coef, rest] = expr.op1.toNumericValue();
      if (exp === 2) return [coef.sqrt(), ce.function('Sqrt', [rest])];
      return [coef.root(exp), ce.function('Root', [rest, expr.op2])];
    }

    //
    // Abs
    //
    if (expr.operator === 'Abs') {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.abs(), ce.function('Abs', [rest])];
    }
    console.assert(expr.operator !== 'Complex');
    console.assert(expr.operator !== 'Exp');

    //
    // Log/Ln
    //
    if (expr.operator === 'Log' || expr.operator === 'Ln') {
      let base = expr.op2.re;
      if (isNaN(base) && expr.operator === 'Log') base = 10;

      const [coef, rest] = expr.op1.toNumericValue();
      if (coef.isOne) return [coef, this];
      return ce
        .box(coef.ln(base))
        .add(ce.function(expr.operator, [rest, expr.op2]))
        .toNumericValue();
    }

    // @todo:  could consider others: Exp, trig functions

    return [ce._numericValue(1), expr];
  }

  // Note: the resulting expression is bound to the current scope, not
  // the scope of the original expression.
  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    const ops = this._ops.map((x) => x.subs(sub, options));

    if (!ops.every((x) => x.isValid))
      return this.engine.function(this._name, ops, { canonical: false });

    return this.engine.function(this._name, ops, options);
  }

  replace(
    rules: BoxedRuleSet | Rule | Rule[],
    options?: Partial<ReplaceOptions>
  ): BoxedExpression | null {
    return replace(this, rules, options).at(-1)?.value ?? null;
  }

  match(
    pattern: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  has(v: string | string[]): boolean {
    // Does the operator name match?
    if (typeof v === 'string') {
      if (this._name === v) return true;
    } else if (v.includes(this._name)) return true;

    // Do any of the operands match?
    return this._ops.some((x) => x.has(v));
  }

  get sgn(): Sign | undefined {
    const gen =
      this.isPure && this._ops.every((x) => x.isConstant)
        ? undefined
        : this.engine.generation;
    return cachedValue(this._sgn, gen, () => {
      if (!this.isValid || this.isNumber !== true) return undefined;
      return sgn(this);
    });
  }

  get isNaN(): boolean | undefined {
    return this.sgn === 'nan';
  }

  get isInfinity(): boolean | undefined {
    const s = this.sgn;
    if (s === 'positive-infinity' || s === 'negative-infinity') return true;
    if (s === 'complex-infinity') return true;
    return false;
    // return this.type === 'number' && !this.isNaN;
  }

  // Not +- Infinity, not NaN
  get isFinite(): boolean | undefined {
    if (this.isNumber !== true) return false;
    if (this.isNaN || this.isInfinity) return false;
    if (this.isNaN === undefined || this.isInfinity === undefined)
      return undefined;
    return true;
  }

  get isOne(): boolean | undefined {
    if (this.isNonPositive === true || this.isReal === false) return false;
    return undefined;
  }

  get isNegativeOne(): boolean | undefined {
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

  get numerator(): BoxedExpression {
    return this.numeratorDenominator[0];
  }

  get denominator(): BoxedExpression {
    return this.numeratorDenominator[1];
  }

  get numeratorDenominator(): [BoxedExpression, BoxedExpression] {
    if (!this.isCanonical) return this.canonical.numeratorDenominator;
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

  //
  //
  // ALGEBRAIC OPERATIONS
  //

  neg(): BoxedExpression {
    return negate(this.canonical);
  }

  inv(): BoxedExpression {
    if (!this.isCanonical) return this.canonical.inv();
    if (this.isOne) return this;
    if (this.isNegativeOne) return this;

    if (this.operator === 'Sqrt') return this.op1.inv().sqrt();
    if (this.operator === 'Divide') return this.op2.div(this.op1);
    if (this.operator === 'Power') {
      const neg = this.op2.neg();
      if (neg.operator !== 'Negate') return this.op1.pow(neg);
      return this.engine.function('Power', [this.op1, neg]);
    }
    if (this.operator === 'Root') {
      const neg = this.op2.neg();
      if (neg.operator !== 'Negate') return this.op1.root(neg);
      return this.engine.function('Root', [this.op1, neg]);
    }
    if (this.operator === 'Exp') return this.engine.E.pow(this.op1.neg());
    if (this.operator === 'Rational') return this.op2.div(this.op1);
    if (this.operator === 'Negate') return this.op1.inv().neg();

    return this.engine._fn('Divide', [this.engine.One, this.canonical]);
  }

  abs(): BoxedExpression {
    if (!this.isCanonical) return this.canonical.abs();
    if (this.operator === 'Abs' || this.operator === 'Negate') return this;
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    if (rhs === 0) return this;
    return add(this.canonical, this.engine.box(rhs));
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    if (rhs === 0) return this.engine.Zero;
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();

    if (rhs instanceof NumericValue) {
      if (rhs.isZero) return this.engine.Zero;
      if (rhs.isOne) return this.canonical;
      if (rhs.isNegativeOne) return this.neg();
    }

    return mul(this.canonical, this.engine.box(rhs));
  }

  div(rhs: number | BoxedExpression): BoxedExpression {
    return div(this, rhs);
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(exp: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) return this.canonical.root(exp);

    if (typeof exp !== 'number') exp = exp.canonical;

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
    if (this.operator === 'Sqrt' || this.operator === 'Root') {
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

    return this.engine._fn('Root', [this, this.engine.box(exp)]);
  }

  sqrt(): BoxedExpression {
    return this.root(2);
  }

  ln(semiBase?: number | BoxedExpression): BoxedExpression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;
    if (!this.isCanonical) return this.canonical.ln(base);

    // Mathematica returns `Log[0]` as `-∞`
    if (this.is(0)) return this.engine.NegativeInfinity;

    // ln(exp(x)) = x
    if (this.operator === 'Exp') return this.op1;

    // ln_c(c) = 1
    if (base && this.isSame(base)) return this.engine.One;

    // ln(e) = 1
    if (!base && this.isSame(this.engine.E)) return this.engine.One;

    // ln(e^x) = x
    if (this.operator === 'Power') {
      const [b, exp] = this.ops;
      if (b.isSame(this.engine.E)) return exp;
      return exp.mul(b.ln(base));
    }

    // ln_c(a^(1/b)) = ln_c(root(a, b)) = 1/b ln_c(a)
    if (this.operator === 'Root') {
      const [a, b] = this.ops;
      return b.div(a.ln(base));
    }

    // ln_c(√a) = 1/2 ln_c(a)
    if (this.operator === 'Sqrt') return this.op1.ln(base).div(2);

    // ln_c(a/b) = ln_c(a) - ln_c(b)
    if (this.operator === 'Divide')
      return this.op1.ln(base).sub(this.op2.ln(base));

    if (base && base.type.matches('finite_integer')) {
      // ln_10(x) -> log(x)
      if (base.re === 10) return this.engine._fn('Log', [this]);
      // ln_n(x) -> log_n(x)
      return this.engine._fn('Log', [this, base]);
    }
    return this.engine._fn('Ln', [this]);
  }

  //
  // CANONICAL OPERATIONS
  //
  // These operations apply only to canonical expressions
  //

  get complexity(): number | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return undefined;
    return this.functionDefinition?.complexity ?? DEFAULT_COMPLEXITY;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this._def;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this._def;
  }

  get isNumber(): boolean | undefined {
    const t = this.type.type;
    if (t === 'unknown') return undefined;
    return isSubtype(t, 'number');
  }

  get isInteger(): boolean | undefined {
    const t = this.type.type;
    if (t === 'unknown') return undefined;
    return isSubtype(t, 'integer');
  }

  get isRational(): boolean | undefined {
    const t = this.type.type;
    if (t === 'unknown') return undefined;
    // integers are rationals
    return isSubtype(t, 'rational');
  }

  get isReal(): boolean | undefined {
    const t = this.type.type;
    if (t === 'unknown') return undefined;
    // rationals and integers are real
    return isSubtype(t, 'real');
  }

  get isFunctionExpression(): boolean {
    return true;
  }

  /** The type of the value of the function */
  get type(): BoxedType {
    const gen =
      this.isPure && this._ops.every((x) => x.isConstant)
        ? undefined
        : this.engine.generation;
    return (
      cachedValue(this._type, gen, () => {
        const t = type(this);
        return t ? new BoxedType(t) : undefined;
      }) ?? BoxedType.unknown
    );
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    return simplify(this, options).at(-1)?.value ?? this;
  }

  evaluate(options?: Partial<EvaluateOptions>): BoxedExpression {
    // If this function is not pure, then bypass caching (i.e. saved as this._value, this._valueN):
    // since the result potentially could differ for each computation)
    // if (!this.isPure) return this._computeValue(options)();
    return cachedValue(
      options?.numericApproximation ? this._valueN : this._value,
      this.engine.generation,
      withDeadline(this.engine, this._computeValue(options))
    );
  }

  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<BoxedExpression> {
    return cachedValueAsync(
      options?.numericApproximation ? this._valueN : this._value,
      this.engine.generation,
      withDeadlineAsync(this.engine, this._computeValueAsync(options))
    );
  }

  N(): BoxedExpression {
    return this.evaluate({ numericApproximation: true });
  }

  solve(
    vars?:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ): null | ReadonlyArray<BoxedExpression> {
    const varNames = normalizedUnknownsForSolve(vars ?? this.unknowns);
    if (varNames.length !== 1) return null;
    return findUnivariateRoots(this, varNames[0]);
  }

  get isCollection(): boolean {
    const def = this.functionDefinition;
    if (!def) return false;
    // A collection has at least a contains handler or a size handler
    return (
      def.collection?.contains !== undefined ||
      def.collection?.size !== undefined
    );
  }

  contains(rhs: BoxedExpression): boolean {
    return this.functionDefinition?.collection?.contains?.(this, rhs) ?? false;
  }

  get size(): number {
    return this.functionDefinition?.collection?.size?.(this) ?? 0;
  }

  each(start?: number, count?: number): Iterator<BoxedExpression, undefined> {
    const iter = this.functionDefinition?.collection?.iterator?.(
      this,
      start,
      count
    );
    if (!iter)
      return {
        next() {
          return { done: true, value: undefined };
        },
      };
    return iter;
  }

  at(index: number): BoxedExpression | undefined {
    return this.functionDefinition?.collection?.at?.(this, index);
  }

  get(index: BoxedExpression | string): BoxedExpression | undefined {
    if (typeof index === 'string')
      return this.functionDefinition?.collection?.at?.(this, index);

    if (!index.string) return undefined;
    return this.functionDefinition?.collection?.at?.(this, index.string);
  }

  indexOf(expr: BoxedExpression): number {
    return this.functionDefinition?.collection?.indexOf?.(this, expr) ?? -1;
  }

  subsetOf(rhs: BoxedExpression, strict: boolean): boolean {
    return (
      this.functionDefinition?.collection?.subsetOf?.(this, rhs, strict) ??
      false
    );
  }
  _computeValue(options?: Partial<EvaluateOptions>): () => BoxedExpression {
    return () => {
      if (!this.isValid) return this;

      //
      // 1/ Use the canonical form
      //

      const numericApproximation = options?.numericApproximation ?? false;

      //
      // Transform N(Integrate) into NIntegrate(), etc...
      //
      if (numericApproximation) {
        const h = this.operator;
        if (h === 'Integrate' || h === 'Limit')
          return this.engine
            .box(['N', this], { canonical: true })
            .evaluate(options);
      }

      if (!this.isCanonical) {
        this.engine.pushScope();
        const canonical = this.canonical;
        this.engine.popScope();
        if (!canonical.isCanonical || !canonical.isValid) return this;
        return canonical.evaluate(options);
      }

      const def = this.functionDefinition;

      //
      // 2/ Thread if applicable
      //
      if (
        def?.threadable &&
        this.ops!.some((x) => isFiniteIndexableCollection(x))
      ) {
        const items = zip(this._ops);
        if (!items) return this.engine.Nothing;

        const results: BoxedExpression[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;
          results.push(this.engine._fn(this.operator, value).evaluate(options));
        }

        if (results.length === 0) return this.engine.Nothing;
        if (results.length === 1) return results[0];
        return this.engine._fn('List', results);
      }

      //
      // 3/ Evaluate the applicable operands
      //
      const tail = holdMap(this, (x) => x.evaluate(options));

      //
      // 4/ Call the `evaluate` handler
      //
      if (def) {
        const engine = this.engine;
        const context = engine.swapScope(this.scope);

        const evaluateFn = def.evaluate?.(tail, {
          numericApproximation,
          engine,
        });

        engine.swapScope(context);

        return evaluateFn ?? this.engine.function(this._name, tail);
      }

      return this.engine.function(this._name, tail);
    };
  }

  _computeValueAsync(
    options?: Partial<EvaluateOptions>
  ): () => Promise<BoxedExpression> {
    return async () => {
      //
      // 1/ Use the canonical form
      //
      if (!this.isValid) return this;

      const numericApproximation = options?.numericApproximation ?? false;

      if (numericApproximation) {
        const h = this.operator;

        //
        // Transform N(Integrate) into NIntegrate(), etc...
        //
        if (h === 'Integrate' || h === 'Limit')
          this.engine
            .box(['N', this], { canonical: true })
            .evaluateAsync(options);
      }
      if (!this.isCanonical) {
        this.engine.pushScope();
        const canonical = this.canonical;
        this.engine.popScope();
        if (!canonical.isCanonical || !canonical.isValid) return this;
        return canonical.evaluateAsync(options);
      }

      const def = this.functionDefinition;

      //
      // 2/ Thread if applicable
      //
      if (
        def?.threadable &&
        this.ops!.some((x) => isFiniteIndexableCollection(x))
      ) {
        const items = zip(this._ops);
        if (!items) return this.engine.Nothing;

        const results: Promise<BoxedExpression>[] = [];
        while (true) {
          const { done, value } = items.next();
          if (done) break;

          results.push(
            this.engine._fn(this.operator, value).evaluateAsync(options)
          );
        }

        if (results.length === 0) return this.engine.Nothing;
        if (results.length === 1) return results[0];

        return Promise.all(results).then((resolved) =>
          this.engine._fn('List', resolved)
        );
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
      // 4/ Call the `evaluate` handler
      //
      if (def) {
        const engine = this.engine;
        const context = engine.swapScope(this.scope);

        const opts = { numericApproximation, engine, signal: options?.signal };
        const evaluateFn =
          def.evaluateAsync?.(tail, opts) ?? def.evaluate?.(tail, opts);

        engine.swapScope(context);

        return Promise.resolve(evaluateFn).then(
          (result) => result ?? this.engine.function(this._name, tail)
        );
      }

      return Promise.resolve(this.engine.function(this._name, tail));
    };
  }
}

/** Return the type of the value of the expression */
function type(expr: BoxedFunction): Type | undefined {
  if (!expr.isValid) return 'error';

  // Is this a 'Function' expression?
  if (expr.operator === 'Function') {
    // What is the type of the body of the function?
    const body = expr.ops[0];
    const bodyType = body.type;
    const args = expr.ops.slice(1);
    return parseType(`(${args.map((x) => 'any').join(', ')}) -> ${bodyType}`);
  }

  // Is there a definition associated with the operator of the function?
  const def = expr.functionDefinition;
  if (def) {
    const sig =
      def.signature instanceof BoxedType
        ? def.signature.type
        : typeof def.signature === 'string'
          ? parseType(def.signature)
          : def.signature;

    let sigResult = functionResult(sig) ?? 'unknown';

    // If there is a type handler, call it
    if (typeof def.type === 'function') {
      const calculatedType = def.type(expr.ops, { engine: expr.engine });
      if (calculatedType) {
        if (calculatedType instanceof BoxedType)
          sigResult = calculatedType.type;
        else sigResult = parseType(calculatedType) ?? sigResult;
      }
    }

    return sigResult;
  }

  return 'function';
}

function withDeadline<T>(engine: ComputeEngine, fn: () => T): () => T {
  return () => {
    if (engine._deadline === undefined) {
      engine._deadline = Date.now() + engine.timeLimit;

      const result: T = fn();

      engine._deadline = undefined;

      return result;
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

      const result: T = await fn();

      engine._deadline = undefined;

      return result;
    }

    return fn();
  };
}
