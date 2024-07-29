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
import { isMachineRational } from '../numerics/rationals';
import { replace } from '../rules';
import { DEFAULT_COMPLEXITY } from './order';
import {
  hashCode,
  bignumPreferred,
  normalizedUnknownsForSolve,
  isRelationalOperator,
} from './utils';
import { flattenOps } from '../symbolic/flatten';
import { expand } from '../symbolic/expand';
import { apply } from '../function-utils';
import { shouldHold } from '../symbolic/utils';
import { at, isFiniteIndexableCollection } from '../collection-utils';
import { narrow } from './boxed-domain';
import { BoxedExpression, SemiBoxedExpression } from './public';
import { match } from './match';
import { factor } from './factor';
import { negate } from '../symbolic/negate';
import { Product } from '../symbolic/product';
import { asFloat, asMachineInteger, asRational, signDiff } from './numerics';
import { add } from '../library/arithmetic-add';
import { canonicalMultiply, mul } from '../library/arithmetic-multiply';
import { NumericValue } from '../numeric-value/public';

/**
 * A boxed function represent an expression that can be
 * represented by a function call.
 *
 * It is composed of a head (the name of the function) and
 * a list of arguments.
 *
 * It has a definition associated with it, based
 * on the head. The definition contains the signature of the function,
 * and the implementation of the function.
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

  // The domain of the value of the function applied to its arguments
  private _result: BoxedDomain | undefined = undefined;

  private _hash: number | undefined;

  constructor(
    ce: IComputeEngine,
    name: string,
    ops: ReadonlyArray<BoxedExpression>,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
    }
  ) {
    super(ce, options?.metadata);

    this._name = name;
    this._ops = ops;

    if (options?.canonical) {
      this._canonical = this;
      this.bind();
    }

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

  get json(): Expression {
    return [this._name, ...this.ops.map((x) => x.json)];
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get head(): string {
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

  toNumericValue(): [NumericValue, BoxedExpression] {
    console.assert(this.isCanonical);
    const ce = this.engine;

    if (this.head === 'Complex') {
      return [
        ce._numericValue({
          re: asFloat(this.op1) ?? 0,
          im: asFloat(this.op2) ?? 0,
        }),
        ce.One,
      ];
    }

    //
    // Add
    //
    //  use factor() to factor out common factors
    let expr: BoxedExpression = this;
    if (expr.head === 'Add') {
      expr = factor(this);
      // if (expr.op !== 'Add') return expr.toNumericValue();
    }

    //
    // Negate
    //
    if (expr.head === 'Negate') {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.neg(), rest];
    }

    //
    // Multiply
    //
    if (expr.head === 'Multiply') {
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
    if (expr.head === 'Divide') {
      const [coef1, numer] = expr.op1.toNumericValue();
      const [coef2, denom] = expr.op2.toNumericValue();
      const coef = coef1.div(coef2);
      if (denom.isOne) return [coef, numer];
      return [coef, ce.function('Divide', [numer, denom])];
    }

    //
    // Power
    //
    if (expr.head === 'Power') {
      // We can only extract a coef if the exponent is a literal
      if (expr.op2.numericValue === null) return [ce._numericValue(1), this];

      // eslint-disable-next-line prefer-const
      let [coef, base] = expr.op1.toNumericValue();
      if (coef.isOne) return [coef, this];

      const exponent = asMachineInteger(expr.op2);
      if (exponent !== null)
        return [coef.pow(exponent), ce.function('Power', [base, expr.op2])];

      if (asFloat(expr.op2) === 0.5)
        return [coef.sqrt(), ce.function('Sqrt', [base])];

      return [ce._numericValue(1), this];
    }

    if (expr.head === 'Sqrt') {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.sqrt(), ce.function('Sqrt', [rest])];
    }

    //
    // Abs
    //
    if (expr.head === 'Abs') {
      const [coef, rest] = expr.op1.toNumericValue();
      return [coef.abs(), ce.function('Abs', [rest])];
    }
    console.assert(expr.head !== 'Complex');
    console.assert(expr.head !== 'Exp');
    console.assert(expr.head !== 'Root');

    //
    // Log/Ln
    //
    if (expr.head === 'Log' || expr.head === 'Ln') {
      let base = asFloat(expr.op2) ?? undefined;
      if (!base && expr.head === 'Log') base = 10;

      const [coef, rest] = expr.op1.toNumericValue();
      if (coef.isOne) return [coef, this];
      return ce
        .box(coef.ln(base))
        .add(ce.function(expr.head, [rest, expr.op2]))
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
    return replace(this, rules, options);
  }

  has(x: string | string[]): boolean {
    if (typeof x === 'string') {
      if (this._name === x) return true;
    } else if (x.includes(this._name)) return true;
    for (const arg of this._ops) if (arg.has(x)) return true;
    return false;
  }

  /** `isSame` is structural/symbolic equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedFunction)) return false;

    // Number of arguments must match
    if (this.nops !== rhs.nops) return false;

    // Head must match
    if (typeof this.head === 'string') {
      if (this.head !== rhs.head) return false;
    } else {
      if (typeof rhs.head === 'string') return false;
      if (
        !rhs.head ||
        !this.engine.box(this.head).isSame(this.engine.box(rhs.head))
      )
        return false;
    }

    // Each argument must match
    const lhsTail = this._ops;
    const rhsTail = rhs._ops;
    for (let i = 0; i < lhsTail.length; i++)
      if (!lhsTail[i].isSame(rhsTail[i])) return false;

    return true;
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

  //
  //
  // ALGEBRAIC OPERATIONS
  //

  neg(): BoxedExpression {
    return negate(this.canonical);
  }

  inv(): BoxedExpression {
    if (!this.isCanonical) return this.canonical.inv();
    if (this.head === 'Sqrt') return this.op1.inv().sqrt();
    if (this.head === 'Divide') return this.op2.div(this.op1);
    if (this.head === 'Power') {
      const neg = this.op2.neg();
      if (neg.head !== 'Negate') return this.op1.pow(neg);
      return this.engine._fn('Power', [this.op1, neg]);
    }
    if (this.head === 'Exp') return this.engine.E.pow(this.op1.neg());
    if (this.head === 'Rational') return this.op2.div(this.op1);
    if (this.head === 'Negate') return this.op1.inv().neg();

    return this.engine._fn('Divide', [this.engine.One, this.canonical]);
  }

  abs(): BoxedExpression {
    if (!this.isCanonical) return this.canonical.abs();
    if (this.head === 'Abs' || this.head === 'Negate') return this;
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    if (rhs === 0) return this;
    return add(this.canonical, this.engine.box(rhs));
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    if (rhs instanceof NumericValue) {
      if (rhs.isZero) return this.engine.Zero;
      if (rhs.isOne) return this.canonical;
      if (rhs.isNegativeOne) return this.neg();
      return mul(this.canonical, this.engine.box(rhs));
    }
    return mul(this.canonical, this.engine.box(rhs));
  }

  div(rhs: number | BoxedExpression): BoxedExpression {
    const result = new Product(this.engine, [this]);
    result.div(typeof rhs === 'number' ? this.engine._numericValue(rhs) : rhs);
    return result.asRationalExpression();
  }

  pow(
    exp: number | [num: number, denom: number] | BoxedExpression
  ): BoxedExpression {
    if (exp === 0) return this.engine.One;
    if (exp === 1) return this;
    if (exp === -1) return this.inv();

    if (!this.isCanonical) return this.canonical.pow(exp);

    if (typeof exp !== 'number') {
      exp = this.engine.box(exp);
      if (exp.isZero) return this.engine.One;
      if (exp.isOne) return this;
      if (exp.isNegativeOne) return this.inv();
      if (exp.head === 'Negate') return this.pow(exp.op1).inv();
    }

    // (a^b)^c -> a^(b*c)
    if (this.head === 'Power') {
      const [base, power] = this.ops;
      return base.pow(power.mul(exp));
    }

    // (a/b)^c -> a^c / b^c
    if (this.head === 'Divide') {
      const [num, denom] = this.ops;
      return num.pow(exp).div(denom.pow(exp));
    }

    if (this.head === 'Negate') {
      const e = typeof exp === 'number' ? exp : exp.numericValue;
      // (-x)^n = (-1)^n x^n
      if (typeof e === 'number' && e % 2 === 0) return this.op1.pow(exp).neg();
    }

    if (this.head === 'Sqrt') {
      const e = typeof exp === 'number' ? exp : exp.numericValue;
      if (exp === 2) return this.op1;
      if (typeof e === 'number' && Number.isInteger(e))
        return this.op1.pow([e, 2]);
      if (isMachineRational(e)) return this.op1.pow([e[0], 2 * e[1]]);
    }

    if (this.head === 'Exp') return this.engine.E.pow(this.op1.mul(exp));

    return this.engine._fn('Power', [this, this.engine.box(exp)]);
  }

  sqrt(): BoxedExpression {
    return this.pow([1, 2]);
  }

  ln(semiBase?: SemiBoxedExpression): BoxedExpression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;
    if (!this.isCanonical) return this.canonical.ln(base);
    if (this.head === 'Exp') return this.op1;
    if (base && this.isEqual(base)) return this.engine.One;
    if (!base && this.isEqual(this.engine.E)) return this.engine.One;
    if (this.head === 'Power') {
      const [b, exp] = this.ops;
      if (b.isEqual(this.engine.E)) return exp;
      return exp.mul(b.ln(base));
    }
    if (this.head === 'Sqrt') return this.op1.ln(base).div(2);
    if (this.head === 'Divide') return this.op1.ln(base).sub(this.op2.ln(base));

    if (base) {
      if (asFloat(base) === 10) return this.engine._fn('Log', [this]);
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
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    const lhs = this.simplify();
    rhs = rhs.simplify();

    const head = lhs.head;
    //
    // Handle relational operators
    //
    if (head === 'Equal' || head === 'NotEqual' || head === 'Unequal') {
      // @fixme: put lhs and rhs in canonical form, i.e. x + 1 = 2 -> x - 1 = 0
      if (rhs.head !== head) return false;
      // Equality is commutative
      if (
        (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) ||
        (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1))
      )
        return true;
    }
    if (head === 'Less') {
      if (rhs.head === 'Less') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'Greater') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (head === 'Greater') {
      if (rhs.head === 'Greater') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'Less') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (head === 'LessEqual') {
      if (rhs.head === 'LessEqual') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'GreaterEqual') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (head === 'GreaterEqual') {
      if (rhs.head === 'GreaterEqual') {
        if (lhs.op1.isEqual(rhs.op1) && lhs.op2.isEqual(rhs.op2)) return true;
        return false;
      }
      if (rhs.head === 'LessEqual') {
        if (lhs.op1.isEqual(rhs.op2) && lhs.op2.isEqual(rhs.op1)) return true;
        return false;
      }
      return false;
    }
    if (isRelationalOperator(head)) {
      if (rhs.head !== lhs.head) return false;
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
  get isAlgebraic(): boolean | undefined {
    return this.domain?.isCompatible('AlgebraicNumbers');
  }
  get isReal(): boolean | undefined {
    return this.domain?.isCompatible('RealNumbers');
  }
  get isExtendedReal(): boolean | undefined {
    return this.domain?.isCompatible('ExtendedRealNumbers');
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

  // simplify(options?: SimplifyOptions): BoxedExpression {
  //   const result = this.simplifyAll(options);
  //   if (result.length === 1) return result[0];
  //   const ce = this.engine;
  //   result.sort((a, b) => {
  //     if (a === b) return 0;
  //     return ce.costFunction(a) - ce.costFunction(b);
  //   });
  //   return result[0];
  // }

  simplify(options?: SimplifyOptions): BoxedExpression {
    // @fixme: simplify logic, only use rules, including "core" rules (i.e. expand/distribute/factor)
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (!this.isCanonical) {
      const canonical = this.canonical;
      if (!canonical.isCanonical || !canonical.isValid) return this;
      return canonical.simplify(options);
    }

    //
    // 2/ Apply expand
    //
    const recursive = options?.recursive ?? true;

    let expr: BoxedExpression | undefined | null;
    if (recursive) {
      expr = expand(this);
      if (expr && !expr.isSame(this))
        return expr.simplify({ ...options, recursive: false });
    }

    //
    // 3/ Factor if a relational operator
    //    2x < 4t -> x < 2t
    if (isRelationalOperator(this.head)) {
      expr = factor(expr ?? this);
      expr = expr ?? this;
      console.assert(isRelationalOperator(expr.head));
      if (expr.nops === 2) {
        // Try f(x) < g(x) -> f(x) - g(x) < 0
        const ce = this.engine;
        const alt = ce._fn(expr.head, [expr.op1.sub(expr.op2), ce.Zero]);
        expr = cheapest(expr, alt);
      }
    }

    //
    // 4/ Simplify the applicable operands
    // @todo not clear if this is always the best strategy. Might be better to
    // defer to the handler.
    //
    const def = this.functionDefinition;
    const tail = recursive
      ? holdMap(
          this._ops,
          def?.hold ?? 'none',
          def?.associative ? def.name : '',
          (x) => x.simplify({ ...options, recursive: false })
        )
      : this._ops;

    //
    // 5/ Apply `simplify` handler
    //

    if (def) {
      if (def.inert) expr = tail[0]?.canonical ?? this;
      else {
        const sig = def.signature;
        if (sig?.simplify) expr = sig.simplify(this.engine, tail);
      }
    }

    if (!expr) expr = this.engine.box([this._name, ...tail]);
    else expr = cheapest(this.engine.box([this._name, ...tail]), expr);

    if (recursive) expr = cheapest(this, expr);

    if (options?.rules === null) return expr;

    //
    // 6/ Apply rules, until no rules can be applied
    //
    const rules =
      options?.rules ?? this.engine.getRuleSet('standard-simplification')!;

    let iterationCount = 0;
    do {
      const newExpr = expr!.replace(rules);
      if (!newExpr) break;
      expr = newExpr.simplify({
        ...options,
        recursive: false,
        rules: null,
      });

      iterationCount += 1;
    } while (iterationCount < this.engine.iterationLimit);
    return expr!; // cheapest(this, expr);
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    //
    // 1/ Use the canonical form
    //
    if (!this.isValid) return this;
    if (options?.numericMode) {
      const h = this.head;

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
        results.push(this.engine._fn(this.head, args).evaluate(options));
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

    if (result) {
      const num = result.numericValue;
      if (num !== null) {
        if (!bignumPreferred(this.engine) && num instanceof Decimal)
          result = this.engine.number(num.toNumber());
      }
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
      const h = x.head;
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
    if (xs[i].head === 'Hold') {
      result.push(xs[i]);
    } else {
      let y: BoxedExpression | undefined = undefined;
      if (xs[i].head === 'ReleaseHold') y = xs[i].op1;
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

/**
 * Considering an old (existing) expression and a new (simplified) one,
 * return the cheapest of the two, with a bias towards the new (which can
 * actually be a bit more expensive than the old one, and still be picked).
 */
function cheapest(
  oldExpr: BoxedExpression,
  newExpr: SemiBoxedExpression | null | undefined
): BoxedExpression {
  if (newExpr === null || newExpr === undefined) return oldExpr;
  if (oldExpr === newExpr) return oldExpr;

  const ce = oldExpr.engine;
  const boxedNewExpr = ce.box(newExpr);

  if (oldExpr.isSame(boxedNewExpr)) return oldExpr;

  if (ce.costFunction(boxedNewExpr) <= 1.2 * ce.costFunction(oldExpr)) {
    // console.log(
    //   'Picked new' + boxedNewExpr.toString() + ' over ' + oldExpr.toString()
    // );
    return boxedNewExpr;
  }

  // console.log(
  //   'Picked old ' + oldExpr.toString() + ' over ' + newExpr.toString()
  // );
  return oldExpr;
}
