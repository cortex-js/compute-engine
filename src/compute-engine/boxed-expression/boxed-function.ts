import type { Expression } from '../../math-json/types';
import type {
  SimplifyOptions,
  ReplaceOptions,
  PatternMatchOptions,
  BoxedExpression,
  BoxedBaseDefinition,
  BoxedOperatorDefinition,
  BoxedRuleSet,
  BoxedSubstitution,
  CanonicalOptions,
  EvaluateOptions,
  ComputeEngine,
  Metadata,
  Rule,
  Sign,
  Substitution,
  BoxedDefinition,
  EvalContext,
  Scope,
  BoxedValueDefinition,
} from '../global-types';

import { isFiniteIndexedCollection, zip } from '../collection-utils';
import { Type } from '../../common/type/types';
import { BoxedType } from '../../common/type/boxed-type';
import { parseType } from '../../common/type/parse';
import { isSubtype } from '../../common/type/subtype';
import {
  functionResult,
  isSignatureType,
  narrow,
  widen,
} from '../../common/type/utils';
import { NumericValue } from '../numeric-value/types';

import { findUnivariateRoots } from './solve';
import { replace } from './rules';
import { negate } from './negate';
import { Product } from './product';
import { simplify } from './simplify';
import { canonicalMultiply, mul, div } from './arithmetic-mul-div';
import { add } from './arithmetic-add';
import { pow } from './arithmetic-power';
import { asSmallInteger } from './numerics';
import { _BoxedExpression } from './abstract-boxed-expression';
import { DEFAULT_COMPLEXITY, sortOperands } from './order';
import {
  hashCode,
  isOperatorDef,
  isValueDef,
  normalizedUnknownsForSolve,
} from './utils';
import { match } from './match';
import { factor } from './factor';
import { holdMap, holdMapAsync } from './hold';
import {
  positiveSign,
  nonNegativeSign,
  negativeSign,
  nonPositiveSign,
  sgn,
} from './sgn';
import { cachedValue, CachedValue } from './cache';
import { apply, lookup } from '../function-utils';

/** When `materialization` is true, display 10 items if the collection is
 * infinite, otherwise 5 from the head and 5 from the tail
 */
const DEFAULT_MATERIALIZATION: [number, number] = [5, 5] as const;

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

export class BoxedFunction extends _BoxedExpression {
  // The operator of the function expression
  private readonly _operator: string;

  // The operands of the function expression
  private readonly _ops: ReadonlyArray<BoxedExpression>;

  // Only canonical expressions have an associated def (are bound)
  // If `null`, the expression is not bound, if `undefined`, the expression
  // is bound but no definition was found.
  private _def: BoxedDefinition | undefined | null;

  /** @todo: wrong. If the function is scoped (has its own lexical scope), the captured eval context. This includes the lexical scope for this expression
   */
  private _capturedContext: ReadonlyArray<EvalContext> | undefined;

  /** If the operator is scoped, the local scope associated with
   * the function expression
   */
  private _localScope: Scope | undefined;

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
    operator: string,
    ops: ReadonlyArray<BoxedExpression>,
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
      def.signature = new BoxedType(
        {
          kind: 'signature',
          result:
            inferenceMode === 'narrow'
              ? narrow(def.signature.type.result, t)
              : widen(def.signature.type.result, t),
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

  get value(): BoxedExpression | undefined {
    return undefined;
  }

  get isCanonical(): boolean {
    return this._def !== undefined && this._def !== null;
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

  get constantValue(): number | boolean | string | object | undefined {
    return this.isConstant ? this.value : undefined;
  }

  get json(): Expression {
    return [this._operator, ...this.structural.ops!.map((x) => x.json)];
  }

  get operator(): string {
    return this._operator;
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
  get canonical(): BoxedExpression {
    if (this.isCanonical || !this.isValid) return this;
    return this.engine.function(this._operator, this._ops);
  }

  get structural(): BoxedExpression {
    if (this.isStructural) return this;
    const def = this.operatorDefinition;
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
        this._operator,
        this.isValid ? sortOperands(this._operator, ys) : ys,
        {
          canonical: false,
          structural: true,
        }
      );
    }
    return this.engine.function(
      this._operator,
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

  /**
   * Note: the result is bound to the current scope, not the scope of the
   * original expression.
   * <!-- This may or may not be desirable -->
   */
  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    options ??= { canonical: undefined };
    if (options.canonical === undefined)
      options = { canonical: this.isCanonical };

    const ops = this._ops.map((x) => x.subs(sub, options));

    if (!ops.every((x) => x.isValid))
      return this.engine.function(this._operator, ops, { canonical: false });

    return this.engine.function(this._operator, ops, options);
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
    if (!this.isCanonical) return [this, this.engine.One];
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
    if (!this.isCanonical) throw new Error('Not canonical');
    return negate(this);
  }

  inv(): BoxedExpression {
    if (!this.isCanonical) throw new Error('Not canonical');
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

    return this.engine._fn('Divide', [this.engine.One, this]);
  }

  abs(): BoxedExpression {
    if (!this.isCanonical) throw new Error('Not canonical');
    if (this.operator === 'Abs' || this.operator === 'Negate') return this;
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    if (rhs === 0) return this;
    if (!this.isCanonical) throw new Error('Not canonical');
    return add(this, this.engine.box(rhs));
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) throw new Error('Not canonical');
    if (rhs === 0) return this.engine.Zero;
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();

    if (rhs instanceof NumericValue) {
      if (rhs.isZero) return this.engine.Zero;
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
    }

    return mul(this, this.engine.box(rhs));
  }

  div(rhs: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) throw new Error('Not canonical');
    return div(this, rhs);
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    return pow(this, exp, { numericApproximation: false });
  }

  root(exp: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical || (typeof exp !== 'number' && !exp.isCanonical))
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

    return this.engine._fn('Root', [this, this.engine.box(exp)]);
  }

  sqrt(): BoxedExpression {
    return this.root(2);
  }

  ln(semiBase?: number | BoxedExpression): BoxedExpression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;
    if (!this.isCanonical) throw new Error('Not canonical');

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

  get complexity(): number | undefined {
    // Since the canonical and non-canonical version of the expression
    // may have different heads, not applicable to non-canonical expressions.
    if (!this.isCanonical) return undefined;
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

  get isFunctionExpression(): boolean {
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

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    return simplify(this, options).at(-1)?.value ?? this;
  }

  evaluate(options?: Partial<EvaluateOptions>): BoxedExpression {
    return withDeadline(this.engine, this._computeValue(options))();
  }

  evaluateAsync(options?: Partial<EvaluateOptions>): Promise<BoxedExpression> {
    return withDeadlineAsync(this.engine, this._computeValueAsync(options))();
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

  xcontains(rhs: BoxedExpression): boolean | undefined {
    return this.baseDefinition?.collection?.contains?.(this, rhs);
  }

  get xsize(): number | undefined {
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

  each(): Generator<BoxedExpression> {
    const iter = this.operatorDefinition?.collection?.iterator?.(this);

    // Return an empty generator if no iterator is defined
    if (!iter) return (function* () {})();

    return (function* () {
      let result = iter.next();
      let i = 0;
      while (!result.done) {
        i += 1;
        //     if (i++ > limit)
        //       throw new CancellationError({ cause: 'iteration-limit-exceeded' });
        yield result.value;
        result = iter.next();
      }
    })();
  }

  at(index: number): BoxedExpression | undefined {
    return this.operatorDefinition?.collection?.at?.(this, index);
  }

  get(index: BoxedExpression | string): BoxedExpression | undefined {
    if (typeof index === 'string')
      return this.operatorDefinition?.collection?.at?.(this, index);

    if (!index.string) return undefined;
    return this.operatorDefinition?.collection?.at?.(this, index.string);
  }

  indexWhere(
    predicate: (element: BoxedExpression) => boolean
  ): number | undefined {
    if (this.operatorDefinition?.collection?.indexWhere)
      return this.operatorDefinition.collection.indexWhere(this, predicate);
    if (!this.isIndexedCollection) return undefined;
    if (!this.isFiniteCollection) return undefined;
    let i = 0;
    for (const x of this.each()) {
      if (predicate(x)) return i;
      i += 1;
    }
    return undefined;
  }

  subsetOf(rhs: BoxedExpression, strict: boolean): boolean {
    return (
      this.operatorDefinition?.collection?.subsetOf?.(this, rhs, strict) ??
      false
    );
  }

  _computeValue(options?: Partial<EvaluateOptions>): () => BoxedExpression {
    return () => {
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
      //
      if (
        def.broadcastable &&
        this.ops!.some((x) => isFiniteIndexedCollection(x))
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
      // 3/ Handle evaluation of lazy collections
      //
      if (materialization !== false && !def.evaluate && this.isLazyCollection)
        return materialize(this, def, options);

      //
      // 4/ Evaluate the applicable operands in the current scope
      //
      const tail = holdMap(this, (x) => x.evaluate(options));

      //
      // 5/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined || options?.withArguments;

      if (isScoped) {
        this.engine._pushEvalContext(
          this._localScope ?? {
            parent: this.engine.context?.lexicalScope,
            bindings: new Map(),
          }
        );
        // Set the named arguments as local variables
        if (options?.withArguments) {
          for (const [k, v] of Object.entries(options.withArguments))
            this.engine.context.values[k] = v;
        }
      }

      //
      // 6/ Call the `evaluate` handler
      //
      const evalResult = def.evaluate?.(tail, {
        numericApproximation,
        engine: this.engine,
        materialization: materialization,
      });
      if (isScoped) this.engine._popEvalContext();

      // Fallback to a symbolic result if we could not evaluate
      return evalResult ?? this.engine.function(this._operator, tail);
    };
  }

  _computeValueAsync(
    options?: Partial<EvaluateOptions>
  ): () => Promise<BoxedExpression> {
    return async () => {
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
      //
      if (
        def?.broadcastable &&
        this.ops!.some((x) => isFiniteIndexedCollection(x))
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

      // 4/ Create a scope if needed
      //
      const isScoped = this._localScope !== undefined || options?.withArguments;

      if (isScoped) {
        this.engine._pushEvalContext(
          this._localScope ?? {
            parent: this.engine.context?.lexicalScope,
            bindings: new Map(),
          }
        );
        // Set the named arguments as local variables
        if (options?.withArguments) {
          for (const [k, v] of Object.entries(options.withArguments))
            this.engine.context.values[k] = v;
        }
      }

      //
      // 5/ Call the `evaluate` handler
      //
      const engine = this.engine;

      const opts = {
        numericApproximation,
        engine,
        signal: options?.signal,
        eager: options?.materialization,
      };
      const evaluateFn =
        def.evaluateAsync?.(tail, opts) ?? def.evaluate?.(tail, opts);

      if (isScoped) this.engine._popEvalContext();

      return Promise.resolve(evaluateFn).then(
        (result) => result ?? engine.function(this._operator, tail)
      );
    };
  }
}

/** Return the type of the value of the expression, without actually
 * evaluating it */
function type(expr: BoxedFunction): Type {
  if (!expr.isValid) return 'error';

  // Is this a 'Function' expression?
  if (expr.operator === 'Function') {
    // What is the type of the body of the function?
    const body = expr.ops[0];
    const bodyType = body.type;
    const args = expr.ops.slice(1);
    return parseType(
      `(${args.map((_) => 'unknown').join(', ')}) -> ${bodyType}`,
      expr.engine._typeResolver
    );
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
    }

    return sigResult;
  }

  // Is this a function literal?
  // e.g. f := (x) -> x + 1
  if (expr.valueDefinition)
    return functionResult(expr.valueDefinition.type.type) ?? 'unknown';

  // We want to return the result of evaluating the function, so since
  // we don't know (somehow?) we return 'unknown', not 'function', which
  // is the type of the function itself, not of its result.
  return 'unknown';
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

function applyFunctionLiteral(
  expr: BoxedFunction,
  def: BoxedValueDefinition,
  options?: Partial<EvaluateOptions>
): BoxedExpression {
  const value = def.isConstant
    ? def.value
    : expr.engine._getSymbolValue(expr.operator);

  if (value && !value.type.matches('function')) {
    if (!value.isValid) return expr;
    return expr.engine.typeError('function', value.type, value.toString());
  }

  const ops = expr.ops.map((x) => x.evaluate(options));
  if (!value || value.type.isUnknown)
    return expr.engine.function(expr.operator, ops);

  // The value is a function literal. Apply the arguments to it
  return apply(value, ops);
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
): BoxedExpression {
  if (!expr.isValid || options?.materialization === false) return expr;

  let materialization = options?.materialization ?? false;
  if (typeof materialization === 'boolean')
    materialization = DEFAULT_MATERIALIZATION;

  const isIndexed = expr.isIndexedCollection;
  const isFinite = expr.isFiniteCollection;

  const xs: BoxedExpression[] = [];

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

      const count = expr.xsize;
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
