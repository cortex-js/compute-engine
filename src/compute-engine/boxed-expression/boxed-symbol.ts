import { Expression } from '../../math-json/math-json-format';
import { AbstractBoxedExpression } from './abstract-boxed-expression';
import {
  BoxedExpression,
  BoxedRuleSet,
  BoxedSymbolDefinition,
  IComputeEngine,
  EvaluateOptions,
  NOptions,
  ReplaceOptions,
  SimplifyOptions,
  Substitution,
  Metadata,
  PatternMatchOption,
  BoxedDomain,
  RuntimeScope,
  BoxedFunctionDefinition,
  BoxedBaseDefinition,
} from '../public';
import { replace } from '../rules';
import { domainToFlags } from './boxed-symbol-definition';
import { serializeJsonSymbol } from './serialize';
import { isValidSymbolName } from '../../math-json/utils';
import { hashCode } from './utils';

function isSymbolDefinition(
  def: BoxedSymbolDefinition | BoxedFunctionDefinition | null | undefined
): def is BoxedSymbolDefinition {
  if (def === null || def === undefined) return false;
  if ('constant' in def) return true;
  return false;
}

function isFunctionDefinition(
  def: BoxedSymbolDefinition | BoxedFunctionDefinition | null | undefined
): def is BoxedFunctionDefinition {
  if (def === null || def === undefined) return false;
  if ('signature' in def) return true;
  return false;
}

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
 */
export class BoxedSymbol extends AbstractBoxedExpression {
  private _scope: RuntimeScope | null;
  protected _name: string;
  private _hash: number | undefined;

  // Note: a `BoxedSymbol` is bound lazily to a definition. This is important
  // during the creation of a scope to avoid circular references.
  //
  // This can also happen if a symbol is used before being defined
  // and the engine has no default domain specified. If there
  // is a default domain, a definition is created automatically.

  // `null` indicate the symbol has not been bound yet, `undefined` indicate
  // that there is no binding available.

  private _def:
    | BoxedSymbolDefinition
    | BoxedFunctionDefinition
    | null
    | undefined;

  constructor(ce: IComputeEngine, name: string, metadata?: Metadata) {
    super(ce, metadata);

    this._scope = ce.context;

    // MathJSON symbols are always stored in Unicode NFC canonical order.
    // See https://unicode.org/reports/tr15/
    console.assert(name === name.normalize());
    this._name = name;

    console.assert(isValidSymbolName(this._name));

    this._def = null; // Mark the def as not cached

    ce._register(this);
  }

  get hash(): number {
    if (this._hash === undefined) this._hash = hashCode(this._name);
    return this._hash;
  }

  unbind(): undefined {
    // this._def = null;
    return this._def?.reset();
  }

  get isPure(): boolean {
    return (
      (this.symbolDefinition?.constant &&
        this.symbolDefinition.value?.isPure) ??
      this.functionDefinition?.pure ??
      false
    );
  }

  /** A free variable either has no definition, or it has a definition, but no value */
  get isFree(): boolean {
    return !this.symbolDefinition?.value;
  }

  get isConstant(): boolean {
    return this.symbolDefinition?.constant ?? false;
  }

  get isCanonical(): boolean {
    if (this.symbolDefinition?.hold === false) return false;
    return true;
  }
  set isCanonical(_va: boolean) {
    return;
  }

  get canonical(): BoxedExpression {
    if (this.symbolDefinition?.hold === true) return this;
    return (
      this.symbolDefinition?.value?.value ??
      this.symbolDefinition?.value ??
      this
    );
  }

  get wikidata(): string | undefined {
    return this._wikidata ?? this.baseDefinition?.wikidata ?? undefined;
  }

  get description(): string[] | undefined {
    if (!this.baseDefinition) return undefined;
    if (!this.baseDefinition.description) return undefined;
    if (typeof this.baseDefinition.description === 'string')
      return [this.baseDefinition.description];
    return this.baseDefinition.description;
  }

  get url(): string | undefined {
    return this.baseDefinition?.url ?? undefined;
  }

  get complexity(): number {
    return 7;
  }

  get head(): string {
    return 'Symbol';
  }

  get symbol(): string {
    return this._name;
  }

  get isNothing(): boolean {
    return this._name === 'Nothing';
  }

  get isLiteral(): boolean {
    return false;
  }

  //  A base definition is the base class of both symbol and function definition
  get baseDefinition(): BoxedBaseDefinition | undefined {
    if (this._def === null) this.bind(this._scope);
    return this._def ?? undefined;
  }

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    if (this._def === null) this.bind(this._scope);
    return isSymbolDefinition(this._def) ? this._def : undefined;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    if (this._def === null) this.bind(this._scope);
    return isFunctionDefinition(this._def) ? this._def : undefined;
  }

  bind(scope: RuntimeScope | null): void {
    // Symbols that start with `_` are wildcards and never have a definition
    if (this._name[0] === '_' || scope === null) {
      this._def = undefined;
      return;
    }

    // Look for a definition in the scope when the symbol was boxed
    let def: BoxedSymbolDefinition | BoxedFunctionDefinition | undefined;

    //
    // 1. Bind to a symbol definition over a function definition
    // (since symbols can be redefined)
    //
    def = this.engine.lookupSymbol(this._name, this._wikidata, scope);
    // Is the wikidata consistent?
    if (def?.wikidata && this._wikidata && def.wikidata !== this._wikidata)
      def = undefined;

    if (def) {
      // In case the symbol was found by its wikidata and the name of the
      // symbol doesn't match, update it to match the definition in our dictionary
      this._name = def.name;

      // Bind the definition and value to this symbol
      this._def = def;
      return;
    }

    //
    // 2. Bind to a function definition
    //
    def = this.engine.lookupFunction(this._name, scope);
    if (def) {
      this._def = def;
      return;
    }

    //
    // 3. Auto-binding
    //

    if (this.engine.defaultDomain !== null) {
      // No definition, create one if a default domain is specified
      this._def = this.engine.defineSymbol({
        name: this._name,
        wikidata: this._wikidata,
        domain: this.engine.defaultDomain,
        ...domainToFlags(this.engine.defaultDomain),
      });
      this._name = this._def.name;
    }
  }

  get value(): BoxedExpression {
    return this.symbolDefinition?.value ?? this;
  }

  set value(value: BoxedExpression | number | undefined) {
    // Symbols starting with `_` are wildcards and never have an associated
    // value
    if (this._name[0] === '_')
      throw new Error(
        `The value of the wildcard "${this._name}" cannot be changed`
      );

    //
    // Clear assumptions  about this symbol
    //
    this.engine.forget(this._name);

    //
    // Determine the new value
    //
    let v: BoxedExpression | undefined;
    if (value !== undefined) {
      const boxedValue = this.engine.box(value);
      v = boxedValue.value ?? boxedValue.evaluate();
    }

    //
    // Assign the value to the corresponding definition
    //
    if (v?.domain.isCompatible('Function')) {
      // New function definitions always completely replace an existing one
      this._def = this.engine.defineFunction({
        name: this._name,
        signature: {
          domain: v.domain,
          evaluate: v, // Evaluate as a lambda
        },
      });
    } else if (this._def && isSymbolDefinition(this._def)) {
      // We are already bound to a symbol definition, update it
      // (this may throw if the definition is readonly)
      this._def.value = v;
    } else {
      // Create a new symbol definition
      this._def = this.engine.defineSymbol({
        name: this._name,
        value: v,
        domain: this.engine.defaultDomain ?? this.engine.domain('Anything'),
      });
    }
  }

  get numericValue(): BoxedExpression | undefined {
    return this.symbolDefinition?.value?.numericValue ?? undefined;
  }

  get domain(): BoxedDomain {
    if (this.functionDefinition) return this.engine.domain('Function');
    return this.symbolDefinition?.domain ?? this.engine.domain('Anything');
  }

  set domain(d: BoxedDomain) {
    if (this._name[0] === '_')
      throw new Error(
        `The domain of the wildcard "${this._name}" cannot be changed`
      );

    if (d.isCompatible('Function')) {
      this.engine.forget(this._name);
      this._def = this.engine.defineFunction({
        name: this._name,
        signature: { domain: d },
      });
    }

    // Since setting the domain can have the side effect of creating a symbol
    // don't use `symbolDefinition` which may also create the symbol entry,
    // but with a defaultDomain
    else if (isSymbolDefinition(this._def)) {
      // Setting the domain will also update the flags
      this._def.domain = d;
    } else {
      // Symbol was not bound to a definition, bind it in the current scope
      this.engine.forget(this._name);
      this._def = this.engine.defineSymbol({
        name: this._name,
        domain: d,
        ...domainToFlags(d),
      });
    }
  }

  get explicitDomain(): BoxedDomain | undefined {
    if (this.functionDefinition) return this.engine.domain('Function');
    return this.symbolDefinition?.domain ?? undefined;
  }

  get json(): Expression {
    return serializeJsonSymbol(this.engine, this._name, {
      latex: this._latex,
      wikidata: this._wikidata,
    });
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    // If available, use the value associated with this symbol.
    // Note that `null` is an acceptable and valid value
    const v = this.numericValue;
    if (v && v !== this) {
      const s = v.sgn;
      if (s !== undefined) return s;
    }

    // We didn't get a definitive answer from the value
    // of this symbol. Check flags.
    const def = this.symbolDefinition;
    if (def) {
      if (def.zero === true) return 0;
      if (def.positive === true) return 1;
      if (def.negative === true) return -1;
    }
    return undefined;
  }

  has(x: string | string[]): boolean {
    if (typeof x === 'string') return this._name === x;
    return x.includes(this._name);
  }

  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (!(rhs instanceof BoxedSymbol)) return false;
    return this._name === rhs._name;
  }

  match(
    rhs: BoxedExpression,
    _options?: PatternMatchOption
  ): Substitution | null {
    if (!(rhs instanceof BoxedSymbol)) return null;
    if (this._name === rhs._name) return {};
    return null;
  }

  isEqual(rhs: BoxedExpression): boolean {
    if (!this.isCanonical) return this.canonical.isEqual(rhs);
    rhs = rhs.canonical;

    //  Boxed Identity
    if (this === rhs) return true;

    // Idempotency ('x' = 'x')
    if (rhs.symbol !== null) return rhs.symbol === this._name;

    // Mathematical/numeric equality
    const lhsVal = this.symbolDefinition?.value?.numericValue;
    if (lhsVal) {
      const rhsVal = rhs.numericValue;
      if (rhsVal) return lhsVal.isEqual(rhsVal);
    }

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
    if (rhs.symbol !== null && rhs.symbol === this._name) return false;

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
    if (rhs.symbol !== null && rhs.symbol === this._name) return true;

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
    if (rhs.symbol !== null && rhs.symbol === this._name) return false;

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
    if (rhs.symbol !== null && rhs.symbol === this._name) return true;

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
    return this.symbolDefinition?.zero ?? this.symbolDefinition?.value?.isZero;
  }

  get isNotZero(): boolean | undefined {
    const result = this.symbolDefinition?.notZero;
    if (typeof result === 'boolean') return result;
    const s = this.sgn;
    if (typeof s === 'number') return s !== 0;
    return undefined;
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

  simplify(options?: SimplifyOptions): BoxedExpression {
    // By default, there is no simplification of symbols,
    // however if a custom set of rules is provided, apply them
    const expr = options?.rules ? this.replace(options.rules) ?? this : this;

    // If allowed (`hold` attribute in the symbol definition is false), replace
    // this symbol with its value/definition. In some cases this may allow for
    // some additional simplifications (e.g. `GoldenRatio`).
    if (expr.symbolDefinition?.hold === false) {
      const val = expr.value;
      if (val) return val.simplify(options);
    }
    return expr;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    const def = this.symbolDefinition;
    if (!def) return this;
    if (def.hold === true) return this;
    return def.value?.evaluate(options) ?? this;
  }

  N(options?: NOptions): BoxedExpression {
    // If we're doing a numeric evaluation, the `hold` does not apply,
    // so call the evaluate handler directly (if the `N` handler doesn't work)
    const value = this.symbolDefinition?.value;
    return value?.N(options) ?? value?.evaluate(options) ?? value ?? this;
  }

  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): BoxedExpression | null {
    return replace(this, rules, options);
  }

  subs(sub: Substitution): BoxedExpression {
    if (!sub[this._name]) return this;
    return this.engine.box(sub[this._name]);
  }
}
