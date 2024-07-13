import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import { Expression } from '../../math-json/math-json-format';
import { _BoxedExpression } from './abstract-boxed-expression';
import {
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
} from './public';
import { replace } from '../rules';
import { isValidIdentifier, validateIdentifier } from '../../math-json/utils';
import { hashCode, normalizedUnknownsForSolve } from './utils';
import { _BoxedSymbolDefinition } from './boxed-symbol-definition';
import { _BoxedFunctionDefinition } from './boxed-function-definition';
import { narrow } from './boxed-domain';
import { domainToSignature, signatureToDomain } from '../domain-utils';
import { match } from './match';
import { canonicalDivide } from '../library/arithmetic-divide';
import { canonicalPower } from '../library/arithmetic-power';
import { Terms } from '../numerics/terms';
import { negate } from '../symbolic/negate';
import { Product } from '../symbolic/product';

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

  constructor(
    ce: IComputeEngine,
    name: string,
    options?: {
      metadata?: Metadata;
      canonical?: CanonicalOptions;
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

  neg(): BoxedExpression {
    return negate(this);
  }

  inv(): BoxedExpression {
    return this.engine.One.div(this);
  }

  abs(): BoxedExpression {
    if (this.isNonNegative) return this;
    if (this.isNonPositive) return this.neg();
    return this.engine._fn('Abs', [this]);
  }

  add(...rhs: (number | BoxedExpression)[]): BoxedExpression {
    if (rhs.length === 0) return this;
    const ce = this.engine;

    return new Terms(ce, [
      this,
      ...rhs.map((x) => (typeof x === 'number' ? ce.number(x) : x)),
    ]).asExpression();
  }

  sub(rhs: BoxedExpression): BoxedExpression {
    return this.add(rhs.neg());
  }

  mul(...rhs: (number | BoxedExpression)[]): BoxedExpression {
    if (rhs.length === 0) return this;

    const ce = this.engine;

    return new Product(ce, [
      this,
      ...rhs.map((x) => (typeof x === 'number' ? ce.number(x) : x)),
    ]).asExpression();
  }

  div(rhs: BoxedExpression): BoxedExpression {
    return canonicalDivide(this, rhs);
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    return canonicalPower(
      this,
      typeof exp === 'number' ? this.engine.number(exp) : exp
    );
  }

  sqrt(): BoxedExpression {
    return canonicalPower(this, this.engine.Half);
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

  get head(): string {
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
      | Complex
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
        value = ce.complex(value.re, value.im);
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
      const boxedValue = ce.box(value as Complex | Decimal | BoxedExpression);
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

  get sgn(): -1 | 0 | 1 | undefined | null {
    // If available, use the value associated with this symbol.
    // Note that `null` is an acceptable and valid value
    const def = this._def;
    if (!def || !(def instanceof _BoxedSymbolDefinition)) return null;

    const v = def.value;
    if (v && v !== this) {
      const s = v.sgn;
      if (s !== undefined) return s;
    }

    // We didn't get a definitive answer from the value
    // of this symbol. Check flags.
    if (def.zero === true) return 0;
    if (def.positive === true) return 1;
    if (def.negative === true) return -1;
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

  isEqual(rhs: BoxedExpression): boolean {
    if (!this.isCanonical) return this.canonical.isEqual(rhs);
    rhs = rhs.canonical;

    //  Boxed Identity
    if (this === rhs) return true;

    // Idempotency ('x' = 'x')
    if (rhs.symbol !== null) return rhs.symbol === this._id;

    // Mathematical/numeric equality
    const lhsVal = this.symbolDefinition?.value?.N();
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

  isLess(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._id) return false;

    // Mathematical/numeric equality
    const lhsVal = this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isLess(rhs.N());

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s < 0;
    }

    //  @todo Check assumptions, use range
    //  let x = assumeSymbolValue(this._engine, this._symbol, 'Less');

    return undefined;
  }

  isLessEqual(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._id) return true;

    // Mathematical/numeric equality
    const lhsVal = this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isLessEqual(rhs.N());

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s <= 0;
    }
    //  @todo Check assumptions, use range

    return this.isLess(rhs) || this.isEqual(rhs);
  }

  isGreater(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._id) return false;

    // Mathematical/numeric equality
    const lhsVal = this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isGreater(rhs.N());

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s > 0;
    }

    //  @todo Check assumptions, use range
    //  let x = assumeSymbolValue(this._engine, this._symbol, 'Less');

    return undefined;
  }

  isGreaterEqual(rhs: BoxedExpression): boolean | undefined {
    // Idempotency
    if (rhs.symbol !== null && rhs.symbol === this._id) return true;

    // Mathematical/numeric equality
    const lhsVal = this.symbolDefinition?.value?.N();
    if (lhsVal) return lhsVal.isGreaterEqual(rhs.N());

    if (rhs.isZero) {
      const s = this.sgn;
      if (s === null) return false;
      if (s !== undefined) return s >= 0;
    }
    //  @todo Check assumptions, use range

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

  get isPrime(): boolean | undefined {
    return this.symbolDefinition?.prime;
  }

  get isComposite(): boolean | undefined {
    return this.symbolDefinition?.composite;
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
  get isAlgebraic(): boolean | undefined {
    return this.symbolDefinition?.rational;
  }
  get isReal(): boolean | undefined {
    return this.symbolDefinition?.real;
  }
  get isExtendedReal(): boolean | undefined {
    return this.symbolDefinition?.extendedReal;
  }
  get isComplex(): boolean | undefined {
    return this.symbolDefinition?.complex;
  }
  get isImaginary(): boolean | undefined {
    return this.symbolDefinition?.imaginary;
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    // console.count('simplify symbol ' + this.toString());
    // If allowed replace this symbol with its value/definition.
    // In some cases this may allow for some additional simplifications (e.g. `GoldenRatio`).
    const def = this.symbolDefinition;
    if (def?.holdUntil === 'simplify' && def.value)
      return def.value.simplify(options);

    // By default, there is no simplification of symbols,
    // however if a custom set of rules is provided, apply them
    return options?.rules ? this.replace(options.rules) ?? this : this;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    // console.count('symbol evaluate ' + this.toString());
    // console.log('symbol evaluate', this.toString());
    const def = this.symbolDefinition;
    if (def) {
      if (options?.numericMode) {
        if (def.holdUntil === 'never') return this;
        return def.value?.N() ?? this;
      }
      if (def.holdUntil === 'simplify' || def.holdUntil === 'evaluate') {
        return def.value?.evaluate(options) ?? this;
      }
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
    rules: BoxedRuleSet | Rule | Rule[],
    options?: ReplaceOptions
  ): BoxedExpression | null {
    return replace(this, rules, options);
  }

  subs(
    sub: Substitution,
    options?: { canonical?: CanonicalOptions }
  ): BoxedExpression {
    if (sub[this._id] === undefined)
      return options?.canonical === true ? this.canonical : this;

    return this.engine.box(sub[this._id], options);
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
