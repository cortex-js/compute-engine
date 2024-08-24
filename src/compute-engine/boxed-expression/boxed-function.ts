import type { Expression } from '../../math-json/types';
import type {
  BoxedFunctionDefinition,
  IComputeEngine,
  BoxedRuleSet,
  SimplifyOptions,
  Substitution,
  ReplaceOptions,
  Metadata,
  PatternMatchOptions,
  BoxedDomain,
  RuntimeScope,
  BoxedSubstitution,
  EvaluateOptions,
  BoxedBaseDefinition,
  Rule,
  CanonicalOptions,
} from '../public';

import type {
  BoxedExpression,
  SemiBoxedExpression,
  Sign,
  Type,
} from './public';

import { findUnivariateRoots } from './solve';
import { replace } from './rules';
import { flattenOps } from './flatten';
import { negate } from './negate';
import { Product } from './product';
import { simplify } from './simplify';

import { asSmallInteger, signDiff } from './numerics';

import { at, isFiniteIndexableCollection } from '../collection-utils';

import { canonicalMultiply, mul } from '../library/arithmetic-multiply';

import { NumericValue } from '../numeric-value/public';

import { _BoxedExpression } from './abstract-boxed-expression';
import { DEFAULT_COMPLEXITY, sortOperands } from './order';
import {
  hashCode,
  normalizedUnknownsForSolve,
  isRelationalOperator,
} from './utils';
import { narrow } from './boxed-domain';
import { match } from './match';
import { factor } from './factor';
import { add } from './terms';
import { holdMap } from './hold';

/**
 * A boxed function represent an expression that can be
 * represented by a function call.
 *
 * It is composed of an operator (the name of the function) and
 * a list of arguments.
 *
 * It has a definition associated with it, based on the operator.
 * The definition contains the signature of the function, and the
 * implementation of the function.
 *
 * @noInheritDoc
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

  // Note: only canonical expressions have an associated def
  private _def: BoxedFunctionDefinition | undefined;

  private _isPure: boolean;

  private _isStructural: boolean;

  // The domain of the value of the function applied to its arguments
  private _result: BoxedDomain | undefined = undefined;

  private _hash: number | undefined;

  // Cached sign of the function (if all the arguments are constant)
  private _sgn: number | undefined | typeof NaN | null = null;

  constructor(
    ce: IComputeEngine,
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

  // For function expressions, infer infers the result domain of the function
  infer(domain: BoxedDomain): boolean {
    const def = this._def;
    if (!def) return false;

    if (!def.signature.inferredSignature) return false;

    if (typeof def.signature.result !== 'function')
      def.signature.result = narrow(def.signature.result, domain);
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
    if (!this.isCanonical) {
      this._isPure = false;
      return false;
    }
    let pure = this.functionDefinition?.pure ?? false;

    // The function might be pure. Let's check that all its arguments are pure.
    if (pure) pure = this._ops.every((x) => x.isPure);

    this._isPure = pure;
    return pure;
  }

  /** The value of the function is constant if the function is
   * pure, and all its arguments are constant.
   */
  get isConstant(): boolean {
    if (!this.isPure) return false;
    return this._ops.every((x) => x.isConstant);
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
      return [
        ce._numericValue({ decimal: this.op1.re ?? 0, im: this.op2.re ?? 0 }),
        ce.One,
      ];
    }

    //
    // Add
    //
    //  use factor() to factor out common factors
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    let expr: BoxedExpression = this;
    if (expr.operator === 'Add') {
      expr = factor(this);
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
        if (!r.isOne) rest.push(r);
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
      if (denom.isOne) return [coef, numer];
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

      if (expr.op2.re === 0.5)
        return [coef.sqrt(), ce.function('Sqrt', [base])];

      return [ce._numericValue(1), this];
    }

    if (expr.operator === 'Sqrt') {
      const [coef, rest] = expr.op1.toNumericValue();
      // @fastpasth
      if (rest.isOne || rest.isZero) {
        if (coef.isOne || coef.isZero) return [coef, rest];
        return [coef.sqrt(), rest];
      }
      return [coef.sqrt(), ce.function('Sqrt', [rest])];
    }

    if (expr.operator === 'Root') {
      const exp = expr.op2.re;
      if (exp === undefined || expr.op2.im !== 0)
        return [ce._numericValue(1), this];

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
      if (base === undefined && expr.operator === 'Log') base = 10;

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

  get sgn(): -1 | 0 | 1 | undefined | typeof NaN {
    if (this._sgn !== null) return this._sgn;

    // Check flags in priority
    if (this._def?.flags?.zero) return 0;
    if (this._def?.flags?.positive) return 1;
    if (this._def?.flags?.negative) return -1;

    // @todo: Could also cache non-constant values, but this
    // would require keeping track of the state of the compute engine
    // (maybe with a version number that would get incremented when
    // a value is updated)

    const memoizable = this.isPure && this._ops.every((x) => x.isConstant);

    let s: -1 | 0 | 1 | undefined | typeof NaN = undefined;
    if (this.isValid) {
      const sig = this.functionDefinition?.signature;
      if (sig?.sgn) {
        const context = this.engine.swapScope(this.scope);
        s = sig.sgn(this._ops, { engine: this.engine });
        this.engine.swapScope(context);
      }
    }
    if (memoizable) this._sgn = s;
    return s;
  }

  isLess(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNegative;
    return undefined;
  }

  isLessEqual(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNonPositive;

    return undefined;
  }

  isGreater(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isPositive;

    return undefined;
  }

  isGreaterEqual(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNonNegative;

    return undefined;
  }

  get isZero(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.zero !== undefined) return this._def.flags.zero;

    const s = this.sgn;
    if (s === undefined) return undefined;
    return s === 0;

    // if (s === 'zero') return true;
    // if (
    //   [
    //     'not-zero',
    //     'real-not-zero',
    //     'positive',
    //     'negative',
    //     'unsigned',
    //   ].includes(s)
    // )
    //   return false;
    // return undefined;
  }

  get isNotZero(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.notZero !== undefined) return this._def.flags.notZero;

    const s = this.sgn;
    if (s === undefined) return undefined;
    return s !== 0;

    // if (['not-zero','real-not-zero','positive','negative'].includes(s)) return true;
    // if (s==='zero') return false:
    // return undefined
  }

  get isOne(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.one !== undefined) return this._def.flags.one;

    if (this.isNonPositive || this.isImaginary) return false;
    return undefined;
  }

  get isNegativeOne(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.negativeOne !== undefined)
      return this._def.flags.negativeOne;

    if (this.isNonNegative || this.isImaginary) return false;
    return undefined;
  }

  // x > 0
  get isPositive(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.positive !== undefined)
      return this._def.flags.positive;

    const s = this.sgn;
    if (s === undefined) return undefined;
    return !isNaN(s) && s > 0;

    // if (s === 'positive') return true;
    // if (['non-positive', 'zero', 'unsigned', 'negative'].includes(s))
    //   return false;

    // return undefined;
  }

  // x >= 0
  get isNonNegative(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.nonNegative !== undefined)
      return this._def.flags.nonNegative;

    const s = this.sgn;
    if (s === undefined) return undefined;
    return !isNaN(s) && s >= 0;

    // if (s === 'positive' || s === 'non-negative') return true;
    // if (['negative', 'zero', 'unsigned'].includes(s)) return false;
    // return undefined;
  }

  // x < 0
  get isNegative(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.negative !== undefined)
      return this._def.flags.negative;

    const s = this.sgn;
    if (s === undefined) return undefined;
    return !isNaN(s) && s < 0;
    // if (s === 'negative') return true;
    // if (['non-negative', 'zero', 'unsigned', 'positive'].includes(s))
    //   return false;
    // return undefined;
  }

  // x <= 0
  get isNonPositive(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.nonPositive !== undefined)
      return this._def.flags.nonPositive;

    const s = this.sgn;
    if (s === undefined) return undefined;
    return !isNaN(s) && s <= 0;

    // if (s === 'negative' || s === 'non-positive') return true;
    // if (['positive', 'zero', 'unsigned'].includes(s)) return false;

    // return undefined;
  }

  /** `isSame` is structural/symbolic equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    if (!(rhs instanceof BoxedFunction)) return false;

    // Number of arguments must match
    if (this.nops !== rhs.nops) return false;

    // Operators must match
    if (this.operator !== rhs.operator) return false;

    const lhsTail = this.ops!;
    const rhsTail = rhs.ops!;
    for (let i = 0; i < lhsTail.length; i++)
      if (!lhsTail[i].isSame(rhsTail[i])) return false;

    return true;
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
    if (typeof rhs === 'number') {
      if (rhs === 1) return this;
      if (rhs === -1) return this.neg();
      if (rhs === 0) return this.engine.NaN;
      if (isNaN(rhs)) return this.engine.NaN;
    }
    const result = new Product(this.engine, [this]);
    result.div(typeof rhs === 'number' ? this.engine._numericValue(rhs) : rhs);
    return result.asRationalExpression();
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) return this.canonical.pow(exp);

    if (typeof exp !== 'number') exp = exp.canonical;

    const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

    if (e === 0) return this.engine.One;
    if (e === 1) return this;
    if (e === -1) return this.inv();
    const ce = this.engine;
    if (e === Number.POSITIVE_INFINITY) {
      if (this.isGreater(1)) return ce.PositiveInfinity;
      if (this.isPositive && this.isLess(1)) return ce.Zero;
    }
    if (e === Number.NEGATIVE_INFINITY) {
      if (this.isGreater(1)) return ce.Zero;
      if (this.isPositive && this.isLess(1)) return ce.PositiveInfinity;
    }

    if (typeof exp !== 'number' && exp.operator === 'Negate')
      return this.pow(exp.op1).inv();

    // (a^b)^c -> a^(b*c)
    if (this.operator === 'Power') {
      const [base, power] = this.ops;
      return base.pow(power.mul(exp));
    }

    // (a/b)^c -> a^c / b^c
    if (this.operator === 'Divide') {
      const [num, denom] = this.ops;
      return num.pow(exp).div(denom.pow(exp));
    }

    if (this.operator === 'Negate') {
      // (-x)^n = (-1)^n x^n
      if (e !== undefined) {
        if (e % 2 === 0) return this.op1.pow(exp);
        return this.op1.pow(exp).neg();
      }
    }

    // (√a)^b -> a^(b/2) or √(a^b)
    if (this.operator === 'Sqrt') {
      if (e === 2) return this.op1;
      if (e !== undefined && e % 2 === 0) return this.op1.pow(e / 2);
      return this.op1.pow(exp).sqrt();
    }

    // exp(a)^b -> e^(a*b)
    if (this.operator === 'Exp') return this.engine.E.pow(this.op1.mul(exp));

    // (a*b)^c -> a^c * b^c
    if (this.operator === 'Multiply') {
      const ops = this.ops.map((x) => x.pow(exp));
      // return mul(...ops);  // don't call: infinite recursion
      return this.engine._fn('Multiply', ops);
    }

    // a^(b/c) -> root(a, c)^b if b = 1 or c = 1
    if (
      typeof exp !== 'number' &&
      exp.isNumberLiteral &&
      exp.type === 'rational'
    ) {
      const v = exp.numericValue as NumericValue;

      if (v.numerator.isOne) return this.root(v.denominator.re);
      if (v.denominator.isOne) return this.pow(v.numerator.re);
    }

    // (a^(1/b))^c -> a^(c/b)
    if (this.operator === 'Root') {
      const [base, root] = this.ops;
      return base.pow(this.engine.box(exp).div(root));
    }

    return this.engine._fn('Power', [this, this.engine.box(exp)]);
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

    // (√a)^b -> a^(b/2) or √(a^b)
    if (this.operator === 'Sqrt') {
      if (e !== undefined) return this.op1.root(e + 2);
      if (typeof exp !== 'number') return this.op1.root(exp.add(2));
    }

    if (this.operator === 'Multiply') {
      const ops = this.ops.map((x) => x.root(exp));
      return mul(...ops);
    }

    if (this.operator === 'Root') {
      const [base, root] = this.ops;
      return base.root(root.mul(exp));
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

  ln(semiBase?: SemiBoxedExpression): BoxedExpression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;
    if (!this.isCanonical) return this.canonical.ln(base);

    // Mathematica returns `Log[0]` as `-∞`
    if (this.isZero) return this.engine.NegativeInfinity;

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

    if (base && base.type === 'integer') {
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
    return this.functionDefinition;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this._def;
  }

  /** `isEqual` is mathematical equality */
  isEqual(rhs: number | BoxedExpression): boolean {
    const lhs = this.N();

    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return lhs.isZero === true;
    if (rhs === 1 || (typeof rhs !== 'number' && rhs.isOne))
      return lhs.isOne === true;
    if (rhs === -1 || (typeof rhs !== 'number' && rhs.isNegativeOne))
      return lhs.isNegativeOne === true;

    rhs = this.engine.box(rhs);
    if (this === rhs) return true;

    const operator = lhs.operator;
    //
    // Handle relational operators
    //
    if (
      operator === 'Equal' ||
      operator === 'NotEqual' ||
      operator === 'Unequal'
    ) {
      // @fixme: put lhs and rhs in canonical form, i.e. x + 1 = 2 -> x - 1 = 0
      if (rhs.operator !== operator) return false;
      // Equality is commutative
      if (
        (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) ||
        (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1))
      )
        return true;
      return false;
    }
    if (operator === 'Less') {
      if (rhs.operator === 'Greater') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
    }
    if (operator === 'Greater') {
      if (rhs.operator === 'Less') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
    }
    if (operator === 'LessEqual') {
      if (rhs.operator === 'GreaterEqual') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
    }
    if (operator === 'GreaterEqual') {
      if (rhs.operator === 'LessEqual') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
    }
    if (isRelationalOperator(operator)) {
      if (rhs.operator !== lhs.operator) return false;
      if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
      return false;
    }

    // Not a relational operator. An algebraic expression?
    // Note: signDiff will attempt to subtract the value (N()) of the
    // two expressions to check if the difference is zero.
    const s = signDiff(lhs, rhs);
    if (s === 0) return true;
    if (s !== undefined) return false;

    return lhs.isSame(rhs);
  }

  get isNumber(): boolean | undefined {
    if (this._def?.flags?.number !== undefined) return this._def.flags.number;
    this._def?.flags?.notZero;

    return this.domain?.isCompatible('Numbers');
  }
  get isInteger(): boolean | undefined {
    // Use a flag in priority
    if (this._def?.flags?.integer !== undefined) return this._def.flags.integer;

    return this.domain?.isCompatible('Integers');
  }
  get isRational(): boolean | undefined {
    if (this._def?.flags?.rational !== undefined)
      return this._def.flags.rational;

    return this.domain?.isCompatible('RationalNumbers');
  }
  get isReal(): boolean | undefined {
    if (this._def?.flags?.real !== undefined) return this._def.flags.real;

    return this.domain?.isCompatible('RealNumbers');
  }
  get isComplex(): boolean | undefined {
    if (this._def?.flags?.complex !== undefined) return this._def.flags.complex;
    this._def?.flags?.notZero;

    return this.domain?.isCompatible('ComplexNumbers');
  }
  get isImaginary(): boolean | undefined {
    if (this._def?.flags?.imaginary !== undefined)
      return this._def.flags.imaginary;

    return this.domain?.isCompatible('ImaginaryNumbers');
  }

  get domain(): BoxedDomain | undefined {
    if (this._result !== undefined) return this._result;
    if (!this.canonical) return undefined;

    const ce = this.engine;

    let result: BoxedDomain | undefined | null = undefined;

    if (this._def) {
      const sig = this._def.signature;
      if (typeof sig.result === 'function') result = sig.result(ce, this._ops);
      else result = sig.result;
    }

    result ??= undefined;

    this._result = result;
    return result;
  }

  get type(): Type {
    if (!this.isValid) return 'error';
    if (this.isInteger) return 'integer';
    if (this.isRational) return 'rational';
    if (this.isReal) return 'real';
    if (this.isComplex) return 'complex';

    return 'expression';
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    return simplify(this, options).at(-1)?.value ?? this;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;

    options ??= { numericApproximation: false };

    if (options.numericApproximation) {
      const h = this.operator;

      //
      // Transform N(Integrate) into NIntegrate(), etc...
      //
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
    // If the function is threadable, iterate
    //
    if (
      def?.threadable &&
      this.ops!.some((x) => isFiniteIndexableCollection(x))
    ) {
      // If one of the arguments is an indexable collection, thread the function
      // Get the length of the longest sequence
      const length = Math.max(
        ...this._ops.map((x) => x.functionDefinition?.size?.(x) ?? 0)
      );

      // Zip
      const results: BoxedExpression[] = [];
      for (let i = 0; i <= length - 1; i++) {
        const args = this._ops.map((x) =>
          isFiniteIndexableCollection(x)
            ? (at(x, (i % length) + 1) ?? this.engine.Nothing)
            : x
        );
        results.push(this.engine._fn(this.operator, args).evaluate(options));
      }

      if (results.length === 0) return this.engine.box(['Sequence']);
      if (results.length === 1) return results[0];
      return this.engine._fn('List', results);
    }

    //
    // 3/ Evaluate the applicable operands
    //
    const tail = holdMap(this, (x) => x.evaluate(options));

    //
    // 4/ Inert? Just return the first argument.
    //
    if (def?.inert) return tail[0] ?? this;

    let result: BoxedExpression | undefined | null = undefined;

    //
    // 5/ Call the `evaluate` handler
    //
    const sig = def?.signature;
    if (sig) {
      const context = this.engine.swapScope(this.scope);
      result = sig.evaluate?.(tail, { ...options, engine: this.engine });
      this.engine.swapScope(context);
    }

    return result ?? this.engine.function(this._name, tail);
  }

  N(): BoxedExpression {
    return this.evaluate({ numericApproximation: true });
  }

  solve(
    vars:
      | Iterable<string>
      | string
      | BoxedExpression
      | Iterable<BoxedExpression>
  ): null | ReadonlyArray<BoxedExpression> {
    const varNames = normalizedUnknownsForSolve(vars);
    if (varNames.length !== 1) return null;
    return findUnivariateRoots(this.simplify(), varNames[0]);
  }
}

// @todo: allow selection of one signature amongst multiple
// function matchSignature(
//   ce: IComputeEngine,
//   def: BoxedFunctionDefinition,
//   tail: BoxedExpression[],
//   codomain?: BoxedExpression
// ): BoxedFunctionSignature | undefined {
//   return def.signature;
// }
