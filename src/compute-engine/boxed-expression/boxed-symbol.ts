import { Expression } from '../../math-json/math-json-format';
import { _BoxedExpression } from './abstract-boxed-expression';
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
  PatternMatchOptions,
  BoxedDomain,
  RuntimeScope,
  BoxedFunctionDefinition,
  BoxedBaseDefinition,
  DomainExpression,
  BoxedSubstitution,
} from '../public';
import { replace } from '../rules';
import { serializeJsonSymbol } from './serialize';
import { isValidIdentifier, validateIdentifier } from '../../math-json/utils';
import { hashCode } from './utils';
import { _BoxedSymbolDefinition } from './boxed-symbol-definition';
import { _BoxedFunctionDefinition } from './boxed-function-definition';
import { widen } from './boxed-domain';

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
export class BoxedSymbol extends _BoxedExpression {
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

  constructor(
    ce: IComputeEngine,
    name: string,
    options?: {
      metadata?: Metadata;
      canonical?: boolean;
      def?: BoxedSymbolDefinition | BoxedFunctionDefinition;
    }
  ) {
    super(ce, options?.metadata);

    // MathJSON symbols are always stored in Unicode NFC canonical order.
    // See https://unicode.org/reports/tr15/
    console.assert(
      name === name.normalize(),
      `Symbol "${name}" must be in Unicode NFC canonical order`
    );
    this._name = name;

    console.assert(
      isValidIdentifier(this._name),
      `Invalid symbol "${name}": ${validateIdentifier(this._name)}`
    );

    this._scope = options?.canonical ? ce.context : null;

    this._def = options?.def ?? null; // Mark the def as not cached if not provided
  }

  get hash(): number {
    if (this._hash === undefined) this._hash = hashCode(this._name);
    return this._hash;
  }

  unbind() {
    this._def?.reset();
    this._def = null;
  }

  get isPure(): boolean {
    return (
      (this.symbolDefinition?.constant &&
        this.symbolDefinition.value?.isPure) ??
      this.functionDefinition?.pure ??
      false
    );
  }

  get json(): Expression {
    return serializeJsonSymbol(this.engine, this._name, {
      latex: this._latex,
      wikidata: this.wikidata,
    });
  }

  get scope(): RuntimeScope | null {
    return this._scope;
  }

  get isConstant(): boolean {
    // Don't use `.symbolDefinition` as this has a side effect of creating
    // a def, which is not desirable whn we're just doing a test.
    const def =
      this._def ?? this.engine.lookupSymbol(this._name, this.wikidata);

    return !(def instanceof _BoxedSymbolDefinition) || def.constant;
  }

  get isCanonical(): boolean {
    return this._scope !== null;
  }
  set isCanonical(val: boolean) {
    this._scope = val ? this.engine.context : null;
    this._def = null;
  }

  get canonical(): BoxedExpression {
    // If a scope has been provided, this symbol is canonical
    if (this._scope) return this;
    // Return a new canonical symbol, scoped in the current context
    return this.engine.box(this._name);
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

  //  A base definition is the base class of both symbol and function definition
  get baseDefinition(): BoxedBaseDefinition | undefined {
    if (this._def === null) this.bind(this._scope);
    return this._def ?? undefined;
  }

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    if (this._def === null) this.bind(this._scope);
    return this._def instanceof _BoxedSymbolDefinition ? this._def : undefined;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    if (this._def === null) this.bind(this._scope);
    return this._def instanceof _BoxedFunctionDefinition
      ? this._def
      : undefined;
  }

  infer(domain: BoxedDomain): boolean {
    if (!this._def) {
      // We don't know anything about this symbol yet, create a definition
      const scope = this.engine.swapScope(this._scope);
      console.assert(this.engine.lookupSymbol(this._name) === undefined);
      this._def = this.engine.defineSymbol(this._name, {
        domain,
        inferred: true,
      });
      this.engine.swapScope(scope);
      return true;
    }

    if (
      this._def instanceof _BoxedSymbolDefinition &&
      this._def.inferredDomain
    ) {
      this._def.domain = widen(this._def.domain, domain);
      return true;
    }

    return false;
  }

  /**
   * Associate a definition with this symbol, if one is not already available
   */
  bind(scope?: RuntimeScope | null): void {
    if (scope === null) {
      this._def = undefined;
      return;
    }

    if (scope === undefined) scope = this._scope;
    if (!scope) return;

    // Look for a definition in the scope when the symbol was boxed
    let def: BoxedSymbolDefinition | BoxedFunctionDefinition | undefined;

    //
    // 1. Bind to a symbol definition over a function definition
    // (since symbols can be redefined)
    //
    def = this.engine.lookupSymbol(this._name, undefined, scope);

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
      this._def = this.engine.defineSymbol(this._name, {
        domain: this.engine.defaultDomain,
      });
      this._name = this._def.name;
    }
  }

  get value(): BoxedExpression | undefined {
    return this.symbolDefinition?.value;
  }

  set value(value: BoxedExpression | number | undefined) {
    // Symbols starting with `_` are wildcards and never have an associated
    // value
    // @todo: this may not entirely be true. This could
    // be an anonymous parameter, e.g. `x^2 + _`
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
    if (v?.domain.isFunction) {
      // New function definitions always completely replace an existing one
      this._def = this.engine.defineFunction(this._name, {
        signature: {
          domain: v.domain,
          evaluate: v, // Evaluate as a lambda
        },
      });
    } else if (this._def && this._def instanceof _BoxedSymbolDefinition) {
      // We are already bound to a symbol definition, update it
      // (this may throw if the definition is readonly)
      this._def.value = v;
    } else {
      // Create a new symbol definition
      let dom = v?.domain;
      if (dom?.isNumeric) dom = this.engine.domain('Numbers');
      this._def = this.engine.defineSymbol(this._name, {
        value: v,
        domain: dom ?? 'Anything',
      });
    }
  }

  get domain(): BoxedDomain {
    if (this.functionDefinition)
      return (
        this.functionDefinition.signature.domain ??
        this.engine.domain('Functions')
      );
    return this.symbolDefinition?.domain ?? this.engine.domain('Anything');
  }

  set domain(inDomain: BoxedExpression | DomainExpression | BoxedDomain) {
    if (this._name[0] === '_')
      throw new Error(
        `The domain of the wildcard "${this._name}" cannot be changed`
      );

    const d = this.engine.domain(inDomain);

    if (d.isFunction) {
      this.engine.forget(this._name);
      this._def = this.engine.defineFunction(this._name, {
        signature: { domain: d },
      });
    }

    // Since setting the domain can have the side effect of creating a symbol
    // don't use `symbolDefinition` which may also create the symbol entry,
    // but with a defaultDomain
    else if (this._def instanceof _BoxedSymbolDefinition) {
      // Setting the domain will also update the flags
      this._def.domain = d;
    } else {
      // Symbol was not bound to a definition, bind it in the current scope
      this.engine.forget(this._name);
      this._def = this.engine.defineSymbol(this._name, { domain: d });
    }
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    // If available, use the value associated with this symbol.
    // Note that `null` is an acceptable and valid value
    const v = this.value;
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
    } else return null;
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
    _options?: PatternMatchOptions
  ): BoxedSubstitution | null {
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
    if (rhs.symbol !== null && rhs.symbol === this._name) return false;

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
    if (rhs.symbol !== null && rhs.symbol === this._name) return true;

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
    if (rhs.symbol !== null && rhs.symbol === this._name) return false;

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
    if (rhs.symbol !== null && rhs.symbol === this._name) return true;

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

  simplify(options?: SimplifyOptions): BoxedExpression {
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
    const def = this.symbolDefinition;
    if (def && (def.holdUntil === 'simplify' || def.holdUntil === 'evaluate'))
      return def.value?.evaluate(options) ?? this;
    return this;
  }

  N(options?: NOptions): BoxedExpression {
    // If we're doing a numeric evaluation, the `hold` does not apply
    const def = this.symbolDefinition;
    if (def && def.holdUntil === 'never') return this;
    return this.symbolDefinition?.value?.N(options) ?? this;
  }

  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): BoxedExpression | null {
    return replace(this, rules, options);
  }

  subs(sub: Substitution, options?: { canonical: boolean }): BoxedExpression {
    if (sub[this._name] === undefined)
      return options?.canonical ? this.canonical : this;

    return this.engine.box(sub[this._name], options);
  }
}

export function makeCanonicalSymbol(
  ce: IComputeEngine,
  name: string
): BoxedExpression {
  const def = ce.lookupSymbol(name, undefined, ce.context!);
  if (def?.holdUntil === 'never' && def.value) return def.value;
  return new BoxedSymbol(ce, name, { canonical: true, def });
}
