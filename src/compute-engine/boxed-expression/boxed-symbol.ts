import { Decimal } from 'decimal.js';
import type { Expression } from '../../math-json/types';
import {
  isValidIdentifier,
  validateIdentifier,
} from '../../math-json/identifiers';

import type { Type } from '../../common/type/types';

import type {
  BoxedExpression,
  BoxedRuleSet,
  BoxedSymbolDefinition,
  IComputeEngine,
  EvaluateOptions,
  ReplaceOptions,
  SimplifyOptions,
  Substitution,
  Metadata,
  PatternMatchOptions,
  BoxedDomain,
  RuntimeScope,
  BoxedFunctionDefinition,
  BoxedBaseDefinition,
  DomainExpression,
  BoxedSubstitution,
  Rule,
  SemiBoxedExpression,
  CanonicalOptions,
  BoxedRule,
  Sign,
} from './public';

import { domainToSignature, signatureToDomain } from '../domain-utils';

import { mul } from '../library/arithmetic-multiply';

import { replace } from './rules';
import { Product } from './product';
import { simplify } from './simplify';
import { negate } from './negate';

import { NumericValue } from '../numeric-value/public';

import { canonicalAngle } from './trigonometry';
import { match } from './match';
import { _BoxedSymbolDefinition } from './boxed-symbol-definition';
import { _BoxedFunctionDefinition } from './boxed-function-definition';
import { narrow } from './boxed-domain';
import { add } from './terms';
import { _BoxedExpression } from './abstract-boxed-expression';
import {
  getImaginaryFactor,
  hashCode,
  normalizedUnknownsForSolve,
} from './utils';

/**
 * BoxedSymbol
 *
 * A boxed symbol is a reference to a `BoxedSymbolDefinition` or a
 * `BoxedFunctionDefinition`.
 *
 * If a `BoxedSymbolDefinition`, it "owns" all the information
 * about the symbol, its value, domain and various attributes.
 *
 * If a `BoxedFunctionDefinition`, it it a reference to a function name,
 * not a function expression, i.e. `Sin`, not `["Sin", "Pi"]`. This is used
 * for example in `["InverseFunction", "Sin"]`
 *
 * @noInheritDoc
 *
 */
export class BoxedSymbol extends _BoxedExpression {
  private _scope: RuntimeScope | null;
  protected _id: string;
  private _hash: number | undefined;

  // Note: a `BoxedSymbol` is bound lazily to a definition. This is important
  // during the creation of a scope to avoid circular references.
  //
  // This can also happen if a symbol is used before being defined
  // and the engine has no default domain specified. If there
  // is a default domain, a definition is created automatically.

  // `undefined` indicate the symbol has not been bound yet,
  // `null` indicate that the symbol is not canonical and it should not be
  // bound.

  private _def:
    | BoxedSymbolDefinition
    | BoxedFunctionDefinition
    | null
    | undefined;

  private _isStructural: boolean = false;

  constructor(
    ce: IComputeEngine,
    name: string,
    options?: {
      metadata?: Metadata;
      canonical?: CanonicalOptions;
      structural?: boolean;
      def?: BoxedSymbolDefinition | BoxedFunctionDefinition;
    }
  ) {
    super(ce, options?.metadata);

    console.assert(
      isValidIdentifier(name),
      `Invalid symbol "${name}": ${validateIdentifier(name)}`
    );
    this._id = name;
    this._def = options?.def ?? undefined; // Mark the def as not cached if not provided

    if (options?.structural) this._isStructural = true;

    if ((options?.canonical ?? true) !== true) this._scope = null;
    else if (this._def) this._scope = ce.context;
    else this.bind();
  }

  get json(): Expression {
    return this._id;
  }

  get hash(): number {
    if (this._hash === undefined) this._hash = hashCode(this._id);
    return this._hash;
  }

  get isPure(): boolean {
    return true;
  }

  get isStructural(): boolean {
    return this._isStructural;
  }

  get structural(): BoxedExpression {
    if (this.isStructural) return this;
    return new BoxedSymbol(this.engine, this._id, {
      structural: true,
      def: this._def ?? undefined,
    });
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get isConstant(): boolean {
    // Don't use `.symbolDefinition` as this has a side effect of creating
    // a def, which is not desirable whn we're just doing a test.
    const def = this._def ?? this.engine.lookupSymbol(this._id, this.wikidata);

    return !(def instanceof _BoxedSymbolDefinition) || def.constant;
  }

  /**
   * Associate a definition with this symbol
   */
  bind(): void {
    this._scope = this.engine.context;

    //
    // 1. Bind to a symbol definition over a function definition
    // (since symbols can be redefined)
    //
    const def =
      this.engine.lookupSymbol(this._id) ??
      this.engine.lookupFunction(this._id);

    if (def) {
      this._def = def;
      return;
    }

    //
    // 3. Auto-binding
    //

    // No definition, create one
    this._def = this.engine.defineSymbol(this._id, {
      domain: undefined,
      inferred: true,
    });
    this._id = this._def.name;
  }

  reset(): void {
    this._def?.reset();
    this._def = undefined;
  }

  get isCanonical(): boolean {
    return this._scope !== null;
  }
  set isCanonical(val: boolean) {
    this._scope = val ? this.engine.context : null;
    this._def = undefined;
  }

  get canonical(): BoxedExpression {
    // If a scope has been provided, this symbol is canonical
    if (this._scope) return this;
    // Return a new canonical symbol, scoped in the current context
    return this.engine.box(this._id);
  }

  toNumericValue(): [NumericValue, BoxedExpression] {
    console.assert(this.isCanonical);
    const ce = this.engine;

    if (this.symbol === 'ImaginaryUnit')
      return [ce._numericValue({ decimal: 0, im: 1 }), ce.One];
    if (
      this.symbol === 'PositiveInfinity' ||
      (this.isInfinity && this.isPositive)
    )
      return [ce._numericValue(Infinity), ce.One];
    if (
      this.symbol === 'NegativeInfinity' ||
      (this.isInfinity && this.isNegative)
    )
      return [ce._numericValue(-Infinity), ce.One];
    if (this.symbol === 'NaN') return [ce._numericValue(NaN), ce.One];

    return [ce._numericValue(1), this];
  }

  neg(): BoxedExpression {
    return negate(this);
  }

  inv(): BoxedExpression {
    return this.engine._fn('Divide', [this.engine.One, this]);
  }

  abs(): BoxedExpression {
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    if (rhs === 0) return this;
    return add(this.canonical, this.engine.box(rhs));
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    if (rhs === 1) return this;
    if (rhs === -1) return this.neg();
    if (rhs === 0) return this.engine.Zero;
    if (rhs instanceof NumericValue) {
      if (rhs.isOne) return this;
      if (rhs.isNegativeOne) return this.neg();
      if (rhs.isZero) return this.engine.Zero;
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

    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;

    if (typeof exp !== 'number') exp = exp.canonical;

    const e = typeof exp === 'number' ? exp : exp.im === 0 ? exp.re : undefined;

    if (e === 0) return this.engine.One;
    if (e === 1) return this;
    if (e === -1) return this.inv();
    if (e === 0.5) return this.sqrt();
    if (e === -0.5) return this.sqrt().inv();
    if (e === Number.POSITIVE_INFINITY) {
      if (this.isGreater(1)) return ce.PositiveInfinity;
      if (this.isPositive && this.isLess(1)) return ce.Zero;
    }
    if (e === Number.NEGATIVE_INFINITY) {
      if (this.isGreater(1)) return ce.Zero;
      if (this.isPositive && this.isLess(1)) return ce.PositiveInfinity;
    }

    if (typeof exp !== 'number') {
      if (exp.operator === 'Negate') return this.pow(exp.op1).inv();
      if (this.symbol === 'ExponentialE') {
        // Is the argument an imaginary or complex number?
        let theta = getImaginaryFactor(exp);
        if (theta !== undefined) {
          // We have an expression of the form `e^(i theta)`
          theta = canonicalAngle(theta);
          if (theta !== undefined) {
            // Use Euler's formula to return a complex trigonometric expression
            return ce
              .function('Cos', [theta])
              .add(ce.function('Sin', [theta]).mul(ce.I))
              .simplify();
            // } else if (theta) {
            //   // Return simplify angle
            //   return ce._fn('Power', [ce.E, radiansToAngle(theta)!.mul(ce.I)]);
          }
        } else if (exp.isNumberLiteral) {
          return ce.number(
            ce._numericValue(ce.E.N().numericValue!).pow(exp.numericValue!)
          );
        }
      }
    }

    return ce._fn('Power', [this, ce.box(exp)]);
  }

  root(n: number | BoxedExpression): BoxedExpression {
    if (!this.isCanonical) return this.canonical.root(n);

    if (typeof n !== 'number') n = n.canonical;

    const e = typeof n === 'number' ? n : n.im === 0 ? n.re : undefined;

    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    if (e === 0) return ce.NaN;
    if (e === 1) return this;
    if (e === 2) return this.sqrt();
    if (e === -1) return this.inv();

    return ce._fn('Root', [this, ce.box(n)]);
  }

  sqrt(): BoxedExpression {
    const ce = this.engine;
    if (this.symbol === 'ComplexInfinity') return ce.NaN;
    if (this.isZero) return this;
    if (this.isOne) return this.engine.One;
    if (this.isNegativeOne) return ce.I;

    return ce._fn('Sqrt', [this]);
  }

  ln(semiBase?: SemiBoxedExpression): BoxedExpression {
    const base = semiBase ? this.engine.box(semiBase) : undefined;
    if (!this.isCanonical) return this.canonical.ln(base);

    // Mathematica returns `Log[0]` as `-∞`
    if (this.isZero) return this.engine.NegativeInfinity;

    if (
      (!base || base.symbol === 'ExponentialE') &&
      this.symbol === 'ExponentialE'
    )
      return this.engine.One;

    if (base) {
      if (base.re === 10) return this.engine._fn('Log', [this]);
      return this.engine._fn('Log', [this, base]);
    }

    return this.engine._fn('Ln', [this]);
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
    if (varNames.includes(this.symbol)) return [this.engine.Zero];
    return null;
  }

  get complexity(): number {
    return 7;
  }

  get operator(): string {
    return 'Symbol';
  }

  get symbol(): string {
    return this._id;
  }

  //  A base definition is the base class of both symbol and function definition
  get baseDefinition(): BoxedBaseDefinition | undefined {
    if (this._def === undefined) this.bind();
    return this._def ?? undefined;
  }

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    if (this._def === undefined) this.bind();
    return this._def instanceof _BoxedSymbolDefinition ? this._def : undefined;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    if (this._def === undefined) this.bind();
    return this._def instanceof _BoxedFunctionDefinition
      ? this._def
      : undefined;
  }

  /**
   * Subsequence inferences will narrow the domain of the symbol.
   * f(:integer), g(:real)
   * g(x) => x:real
   * f(x) => x:integer narrowed from integer to real
   */
  infer(domain: BoxedDomain): boolean {
    const def =
      this.engine.lookupSymbol(this._id) ??
      this.engine.lookupFunction(this._id);
    if (!def) {
      // We don't know anything about this symbol yet, create a definition
      const scope = this.engine.swapScope(this._scope ?? this.engine.context);
      this._def = this.engine.defineSymbol(this._id, {
        domain,
        inferred: true,
      });
      this.engine.swapScope(scope);
      return true;
    }

    // Narrow the domain, if it was previously inferred
    if (def instanceof _BoxedSymbolDefinition && def.inferredDomain) {
      def.domain = narrow(def.domain, domain);
      return true;
    }

    return false;
  }

  get value(): number | boolean | string | object | undefined {
    const def = this._def;
    if (def && def instanceof _BoxedSymbolDefinition) return def.value?.value;
    return undefined;
  }

  set value(
    value:
      | boolean
      | string
      | Decimal
      | { re: number; im: number }
      | { num: number; denom: number }
      | number[]
      | BoxedExpression
      | number
      | object
      | undefined
  ) {
    const ce = this.engine;

    //
    // Clear assumptions  about this symbol
    //
    ce.forget(this._id);

    //
    // Determine the new value
    //
    let v: BoxedExpression | undefined;
    if (typeof value === 'boolean') value = value ? ce.True : ce.False;
    if (typeof value === 'string') value = ce.string(value);
    if (typeof value === 'object') {
      if ('re' in value && 'im' in value)
        value = ce.complex(value.re ?? 0, value.im);
      else if ('num' in value && 'denom' in value)
        value = ce.number([value.num, value.denom]);
      else if (Array.isArray(value))
        value = ce._fn(
          'List',
          value.map((x) => ce.box(x))
        );
      else throw new Error(`Invalid value for symbol ${this._id}: ${value}`);
    }

    if (value !== undefined) {
      const boxedValue = ce.box(value as Decimal | BoxedExpression);
      v = boxedValue.evaluate();
    }

    //
    // Assign the value to the corresponding definition
    //
    if (v?.domain?.isFunction) {
      console.assert(!this.engine.lookupSymbol(this._id));
      // New function definitions always completely replace an existing one
      this._def = ce.defineFunction(this._id, {
        signature: {
          ...domainToSignature(v.domain),
          evaluate: v, // Evaluate as a lambda
        },
      });
      return;
    }

    const def = this.engine.lookupSymbol(this._id);

    if (def && def instanceof _BoxedSymbolDefinition) {
      // We are already bound to a symbol definition, update it
      // (this may throw if the definition is readonly)
      def.value = v;
    } else {
      // Create a new symbol definition
      let dom = v?.domain;
      if (dom?.isNumeric) dom = ce.Numbers;
      this._def = ce.defineSymbol(this._id, {
        value: v,
        domain: dom,
      });
    }
  }

  get domain(): BoxedDomain | undefined {
    const def = this._def;
    if (def) {
      if (def instanceof _BoxedFunctionDefinition) {
        return signatureToDomain(this.engine, def.signature);
      } else if (def instanceof _BoxedSymbolDefinition)
        return (def as BoxedSymbolDefinition).domain ?? undefined;
    }
    return undefined;
  }

  // The type of the value of the symbol.
  // If the symbol is not bound to a definition, the type is 'symbol'
  get type(): Type {
    return this._def?.type ?? 'symbol';
  }

  set domain(inDomain: DomainExpression | BoxedDomain) {
    // Do nothing if the domain is not bound
    if (!this._def) return;

    if (this._id[0] === '_')
      throw new Error(
        `The domain of the wildcard "${this._id}" cannot be changed`
      );

    const d = this.engine.domain(inDomain);

    if (d.isFunction) {
      this.engine.forget(this._id);
      this._def = this.engine.defineFunction(this._id, {
        signature: domainToSignature(d),
      });
    } else if (this._def instanceof _BoxedSymbolDefinition) {
      // Setting the domain will also update the flags
      this._def.domain = d;
    } else {
      // Symbol was not bound to a definition, bind it in the current scope
      this.engine.forget(this._id);
      this._def = this.engine.defineSymbol(this._id, { domain: d });
    }
  }

  get sgn(): Sign | undefined {
    // If available, use the value associated with this symbol.
    // Note that `null` is an acceptable and valid value
    const def = this._def;
    if (!def || !(def instanceof _BoxedSymbolDefinition)) return undefined;

    const v = def.value;
    if (v && v !== this) {
      const s = v.sgn;
      if (s !== undefined) return s;
    }

    // We didn't get a definitive answer from the value
    // of this symbol. Check flags.
    if (def.zero === true) return 'zero';
    if (def.positive === true) return 'positive';
    if (def.negative === true) return 'negative';
    if (def.nonPositive === true) return 'non-positive';
    if (def.nonNegative === true) return 'non-negative';
    if (def.notZero === true) return 'not-zero';
    if (def.NaN === true) return 'unsigned';
    if (def.imaginary === true) return 'unsigned';

    return undefined;
  }

  has(x: string | string[]): boolean {
    if (typeof x === 'string') return this._id === x;
    return x.includes(this._id);
  }

  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    if (!(rhs instanceof BoxedSymbol)) return false;
    return this._id === rhs._id;
  }

  match(
    pattern: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return match(this, pattern, options);
  }

  isEqual(rhs: number | BoxedExpression): boolean {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isZero === true;
    if (rhs === 1 || (typeof rhs !== 'number' && rhs.isOne))
      return this.isOne === true;
    if (rhs === -1 || (typeof rhs !== 'number' && rhs.isNegativeOne))
      return this.isNegativeOne === true;

    rhs = this.engine.box(rhs);

    if (!this.isCanonical) return this.canonical.isEqual(rhs);
    rhs = rhs.canonical;

    //  Boxed Identity
    if (this === rhs) return true;

    // Idempotency ('x' = 'x')
    if (rhs.symbol !== null) return rhs.symbol === this._id;

    // Mathematical/numeric equality
    const lhsVal = this.isZero
      ? this.engine.Zero
      : this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isEqual(rhs.N());

    if (rhs.isZero) {
      if (this.isZero) return true;
      if (this.isNotZero) return false;
    }
    if (this.isZero && rhs.isNotZero) return false;
    // @todo could test other contradictory properties: prime vs composite, etc...

    // Direct assumptions
    if (this.engine.ask(['Equal', this, rhs]).length > 0) return true;
    if (this.engine.ask(['NotEqual', this, rhs]).length > 0) return false;

    //@todo: could use range

    return false;
  }

  isLess(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNegative;

    // Idempotency
    if (
      typeof rhs !== 'number' &&
      rhs.symbol !== null &&
      rhs.symbol === this._id
    )
      return false;

    // Mathematical/numeric equality
    const lhsVal = this.isZero
      ? this.engine.Zero
      : this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isLess(rhs);

    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNegative;

    return undefined;
  }

  isLessEqual(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNonPositive;

    // Idempotency
    if (
      typeof rhs !== 'number' &&
      rhs.symbol !== null &&
      rhs.symbol === this._id
    )
      return true;

    // Mathematical/numeric equality
    const lhsVal = this.isZero
      ? this.engine.Zero
      : this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isLessEqual(rhs);

    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNonPositive;

    return this.isLess(rhs) || this.isEqual(rhs);
  }

  isGreater(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isPositive;

    // Idempotency
    if (
      typeof rhs !== 'number' &&
      rhs.symbol !== null &&
      rhs.symbol === this._id
    )
      return false;

    // Mathematical/numeric equality

    const lhsVal = this.isZero
      ? this.engine.Zero
      : this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isGreater(rhs);

    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isPositive;

    return undefined;
  }

  isGreaterEqual(rhs: number | BoxedExpression): boolean | undefined {
    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNonNegative;

    // Idempotency
    if (
      typeof rhs !== 'number' &&
      rhs.symbol !== null &&
      rhs.symbol === this._id
    )
      return true;

    // Mathematical/numeric equality
    const lhsVal = this.isZero
      ? this.engine.Zero
      : this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isGreaterEqual(rhs);

    if (rhs === 0 || (typeof rhs !== 'number' && rhs.isZero))
      return this.isNonNegative;

    return this.isGreater(rhs) || this.isEqual(rhs);
  }

  get isFunction(): boolean | undefined {
    return !!this.functionDefinition;
  }

  get isZero(): boolean | undefined {
    return this.symbolDefinition?.zero;
  }

  get isNotZero(): boolean | undefined {
    return this.symbolDefinition?.notZero;
  }

  get isOne(): boolean | undefined {
    return this.symbolDefinition?.one;
  }

  get isNegativeOne(): boolean | undefined {
    return this.symbolDefinition?.negativeOne;
  }

  get isOdd(): boolean | undefined {
    return this.symbolDefinition?.odd;
  }

  get isEven(): boolean | undefined {
    return this.symbolDefinition?.even;
  }

  get isInfinity(): boolean | undefined {
    return this.symbolDefinition?.infinity;
  }
  get isNaN(): boolean | undefined {
    return this.symbolDefinition?.NaN;
  }
  // x > 0
  get isPositive(): boolean | undefined {
    return this.symbolDefinition?.positive;
  }
  get isNonPositive(): boolean | undefined {
    return this.symbolDefinition?.nonPositive;
  }
  get isNegative(): boolean | undefined {
    return this.symbolDefinition?.negative;
  }
  get isNonNegative(): boolean | undefined {
    return this.symbolDefinition?.nonNegative;
  }
  get isNumber(): boolean | undefined {
    return this.symbolDefinition?.number;
  }
  get isInteger(): boolean | undefined {
    return this.symbolDefinition?.integer;
  }
  get isRational(): boolean | undefined {
    return this.symbolDefinition?.rational;
  }
  get isReal(): boolean | undefined {
    return this.symbolDefinition?.real;
  }
  get isComplex(): boolean | undefined {
    return this.symbolDefinition?.complex;
  }
  get isImaginary(): boolean | undefined {
    return this.symbolDefinition?.imaginary;
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    return simplify(this, options).at(-1)?.value ?? this;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    // console.count('symbol evaluate ' + this.toString());
    // console.log('symbol evaluate', this.toString());
    const def = this.symbolDefinition;
    if (def) {
      if (def.holdUntil === 'never') return this;

      if (options?.numericApproximation) return def.value?.N() ?? this;

      if (def.holdUntil === 'evaluate')
        return def.value?.evaluate(options) ?? this;
    }
    return this;
  }

  N(): BoxedExpression {
    // console.count('symbol N ' + this.toString());
    // If we're doing a numeric evaluation, the `hold` does not apply
    const def = this.symbolDefinition;
    if (def && def.holdUntil === 'never') return this;
    return def?.value?.N() ?? this;
  }

  replace(
    rules: Rule | (Rule | BoxedRule)[] | BoxedRuleSet,
    options?: Partial<ReplaceOptions>
  ): BoxedExpression | null {
    return replace(this, rules, options).at(-1)?.value ?? null;
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    const canonical = options?.canonical ?? this.isCanonical;
    if (sub[this._id] === undefined) return canonical ? this.canonical : this;

    return this.engine.box(sub[this._id], { canonical });
  }
}

export function makeCanonicalSymbol(
  ce: IComputeEngine,
  name: string
): BoxedExpression {
  const def = ce.lookupSymbol(name);
  if (def?.holdUntil === 'never' && def.value) return def.value;
  return new BoxedSymbol(ce, name, { canonical: true, def });
}
