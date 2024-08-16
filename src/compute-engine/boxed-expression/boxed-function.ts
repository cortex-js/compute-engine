import Complex from 'complex.js';
import { Decimal } from 'decimal.js';

import { _BoxedExpression } from './abstract-boxed-expression';

import { Expression } from '../../math-json/types';
import {
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
  Hold,
  Rule,
  CanonicalOptions,
} from '../public';
import { findUnivariateRoots } from '../solve';
import { replace } from '../rules';
import { DEFAULT_COMPLEXITY, sortOperands } from './order';
import {
  hashCode,
  normalizedUnknownsForSolve,
  isRelationalOperator,
} from './utils';
import { flattenOps } from '../symbolic/flatten';
import { expand } from '../symbolic/expand';
import { shouldHold } from '../symbolic/utils';
import { at, isFiniteIndexableCollection } from '../collection-utils';
import { narrow } from './boxed-domain';
import { BoxedExpression, SemiBoxedExpression, Type } from './public';
import { match } from './match';
import { factor } from './factor';
import { negate } from '../symbolic/negate';
import { Product } from '../symbolic/product';
import { asSmallInteger, signDiff } from './numerics';
import { canonicalMultiply, mul } from '../library/arithmetic-multiply';
import { NumericValue } from '../numeric-value/public';
import { add } from './terms';
import { simplify } from '../symbolic/simplify';

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
    console.assert(this.isCanonical);
    const ce = this.engine;

    if (this.operator === 'Complex') {
      return [
        ce._numericValue({ re: this.op1.re ?? 0, im: this.op2.re ?? 0 }),
        ce.One,
      ];
    }

    //
    // Add
    //
    //  use factor() to factor out common factors
    // @es-lint-disable-no-this-alias
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
    options?: ReplaceOptions
  ): BoxedExpression | null {
    const results = replace(this, rules, options);
    if (results.length === 0) return null;
    return results[results.length - 1].value;
  }

  match(
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  has(x: string | string[]): boolean {
    if (typeof x === 'string') {
      if (this._name === x) return true;
    } else if (x.includes(this._name)) return true;
    for (const arg of this._ops) if (arg.has(x)) return true;
    return false;
  }

  get sgn(): -1 | 0 | 1 | undefined | typeof NaN {
    if (this._sgn !== null) return this._sgn;

    // @todo: Could also cache non-constant values, but this
    // would require keeping track of the state of the compute engine
    // (maybe with a version number that would get incremented when
    // a value is updated)

    const memoizable = this.isPure && this._ops.every((x) => x.isConstant);

    let s: -1 | 0 | 1 | undefined | typeof NaN = undefined;
    if (this.isValid) {
      const sig = this.functionDefinition?.signature;
      if (sig?.sgn) {
        s = sig.sgn(this.engine, this._ops);
      }
    }
    if (memoizable) this._sgn = s;
    return s;
  }

  get isZero(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    return s === 0;
  }

  get isNotZero(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    return s !== 0;
  }

  get isOne(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    if (s <= 0) return false;
    return undefined;
  }

  get isNegativeOne(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    if (s >= 0) return false;
    return undefined;
  }

  // x > 0
  get isPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    return s > 0;
  }

  // x >= 0
  get isNonNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    return s >= 0;
  }

  // x < 0
  get isNegative(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    return s < 0;
  }

  // x <= 0
  get isNonPositive(): boolean | undefined {
    const s = this.sgn;
    if (s === undefined || isNaN(s)) return undefined;
    return s <= 0;
  }

  /** `isSame` is structural/symbolic equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    // We want to compare the structure of the expressions, not the
    // value of the expressions. If a rational number 1/2, we want the
    // expression ['Rational', 1, 2]
    rhs = rhs.structural;
    if (!(rhs instanceof BoxedFunction)) return false;

    // Number of arguments must match
    if (this.nops !== rhs.nops) return false;

    // Operators must match
    if (this.operator !== rhs.operator) return false;

    const operator = this.functionDefinition?.associative ? this.operator : '';

    // Each argument must match
    const lhsTail = flattenOps(
      this._ops.map((x) => x.structural),
      operator
    );
    const rhsTail = flattenOps(
      rhs._ops.map((x) => x.structural),
      operator
    );

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

    let e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

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
      return mul(...ops);
      // return this.engine._fn('Multiply', ops);
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

    let e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

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
    if (this.operator === 'Exp') return this.op1;
    if (base && this.isEqual(base)) return this.engine.One;
    if (!base && this.isEqual(this.engine.E)) return this.engine.One;
    if (this.operator === 'Power') {
      const [b, exp] = this.ops;
      if (b.isEqual(this.engine.E)) return exp;
      return exp.mul(b.ln(base));
    }
    if (this.operator === 'Root') {
      const [b, exp] = this.ops;
      return exp.div(b.ln(base));
    }
    if (this.operator === 'Sqrt') return this.op1.ln(base).div(2);
    if (this.operator === 'Divide')
      return this.op1.ln(base).sub(this.op2.ln(base));

    if (base && base.type === 'integer') {
      if (base.re === 10) return this.engine._fn('Log', [this]);
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
    rhs = this.engine.box(rhs);
    if (this === rhs) return true;

    // Put the expressions in a "more canonical" form
    const lhs = this.simplify();
    rhs = rhs.simplify();

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
    // Note: signDiff will attempt to subtract the two expressions to check
    // if the difference is zero.
    const s = signDiff(lhs, rhs);
    if (s === 0) return true;
    if (s !== undefined) return false;

    // Try to simplify the difference of the expressions
    const diff = lhs.sub(rhs);
    if (diff.isZero) return true;

    return lhs.isSame(rhs);
  }

  get isNumber(): boolean | undefined {
    return this.domain?.isCompatible('Numbers');
  }
  get isInteger(): boolean | undefined {
    return this.domain?.isCompatible('Integers');
  }
  get isRational(): boolean | undefined {
    return this.domain?.isCompatible('RationalNumbers');
  }
  get isReal(): boolean | undefined {
    return this.domain?.isCompatible('RealNumbers');
  }
  get isComplex(): boolean | undefined {
    return this.domain?.isCompatible('ComplexNumbers');
  }
  get isImaginary(): boolean | undefined {
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
    return 'expression';
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    let expr: BoxedExpression = this;
    if (options?.recursive) {
      const def = this.functionDefinition;
      const ops = holdMap(
        this._ops,
        def?.hold ?? 'none',
        def?.associative ? def.name : '',
        (x) => x.simplify({ ...options, recursive: false })
      );
      expr = this.engine.function(this._name, ops, {
        canonical: this.isCanonical,
      });
    }
    const results = simplify(expr, options);
    if (results.length === 0) return this;
    return results[results.length - 1].value;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (options?.numericMode) {
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
    const tail = holdMap(
      this._ops,
      def?.hold ?? 'none',
      def?.associative ? def.name : '',
      (x) => x.evaluate(options)
    );

    //
    // 4/ Inert? Just return the first argument.
    //
    if (def?.inert) return tail[0] ?? this;

    let result: BoxedExpression | undefined | null = undefined;

    //
    // 5/ Call the `evaluate` or `N` handler
    //
    const sig = def?.signature;
    if (sig) {
      const numericMode = options?.numericMode ?? false;
      const context = this.engine.swapScope(this.scope);
      if (numericMode && sig.N) result = sig.N!(this.engine, tail);
      if (!result && sig.evaluate) result = sig.evaluate!(this.engine, tail);
      this.engine.swapScope(context);
    }

    return result ?? this.engine.function(this._name, tail);
  }

  N(): BoxedExpression {
    return this.evaluate({ numericMode: true });
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

/** Apply the function `f` to elements of `xs`, except to the elements
 * described by `skip`:
 * - `all`: don't apply f to any elements
 * - `none`: apply `f` to all elements
 * - `first`: apply `f` to all elements except the first
 * - `rest`: apply `f` to the first element, skip the  others
 * - 'last': apply `f` to all elements except the last
 * - 'most': apply `f` to the last elements, skip the others
 *
 * Account for `Hold`, `ReleaseHold`, `Sequence`, `Symbol` and `Nothing`.
 *
 * If `f` returns `null`, the element is not added to the result
 */
export function holdMap(
  xs: ReadonlyArray<BoxedExpression>,
  skip: Hold,
  associativeHead: string,
  f: (x: BoxedExpression) => BoxedExpression | null
): ReadonlyArray<BoxedExpression> {
  if (xs.length === 0) return [];

  // f(a, f(b, c), d) -> f(a, b, c, d)
  xs = flattenOps(xs, associativeHead);

  //
  // Apply the hold as necessary
  //
  // @fastpath
  if (skip === 'all') return xs;
  if (skip === 'none') {
    const result: BoxedExpression[] = [];
    for (const x of xs) {
      const h = x.operator;
      if (h === 'Hold') result.push(x);
      else {
        const op = h === 'ReleaseHold' ? x.op1 : x;
        if (op) {
          const y = f(op);
          if (y !== null) result.push(y);
        }
      }
    }
    return flattenOps(result, associativeHead);
  }

  const result: BoxedExpression[] = [];
  for (let i = 0; i < xs.length; i++) {
    if (xs[i].operator === 'Hold') {
      result.push(xs[i]);
    } else {
      let y: BoxedExpression | undefined = undefined;
      if (xs[i].operator === 'ReleaseHold') y = xs[i].op1;
      else if (!shouldHold(skip, xs.length - 1, i)) y = xs[i];
      else result.push(xs[i]);

      if (y) {
        const x = f(y);
        if (x !== null) result.push(x);
      }
    }
  }
  return flattenOps(result, associativeHead);
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
