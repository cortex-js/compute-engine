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
  SemiBoxedExpression,
  SimplifyOptions,
  Substitution,
  Metadata,
} from '../public';
import { replace } from '../rules';
import { domainToFlags } from './boxed-symbol-definition';
import { serializeJsonSymbol } from './serialize';
import { isValidSymbolName } from '../../math-json/utils';
import { hashCode } from './utils';

/**
 * BoxedSymbol
 *
 * A boxed symbol is a reference to a BoxedSymbolDefinition.
 * The BoxedSymbolDefinition "owns" all the information
 * about the symbol, its value, domain and various attributes.
 */

export class BoxedSymbol extends AbstractBoxedExpression {
  protected _name: string;
  private _hash: number | undefined;
  // Note: a `BoxedSymbol` is not always bound to a definition.
  // This can happen (temporarily) during the creation of a scope
  // to avoid circular references. The symbols are then "repaired"
  // (bound to a definition) later.
  // This can also happen if a symbol is used before being defined
  // and the engine has no default domain specified. If there
  // is a default domain, a definition is created automatically.
  private _def: BoxedSymbolDefinition | undefined;

  constructor(ce: IComputeEngine, name: string, metadata?: Metadata) {
    super(ce, metadata);

    // MathJSON symbols are always stored in Unicode NFC canonical order.
    // See https://unicode.org/reports/tr15/
    this._name = name.normalize();

    if (!isValidSymbolName(this._name))
      throw new Error(
        `The name "${this._name}" cannot be used as a symbol name`
      );

    console.assert(
      this._name[0] !== "'",
      'Symbol name should not start with single quote'
    );

    this._repairDefinition();

    ce._register(this);
  }

  get hash(): number {
    if (this._hash === undefined) this._hash = hashCode(this._name);
    return this._hash;
  }

  _purge(): undefined {
    return this._def?._purge();
  }

  get isPure(): boolean {
    return (this._def?.constant && this._def.value?.isPure) ?? false;
  }

  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(_va: boolean) {
    return;
  }

  get wikidata(): string {
    return this._wikidata ?? this._def?.wikidata ?? '';
  }

  get description(): string[] {
    if (!this._def) return [];
    if (!this._def.description) return [];
    if (typeof this._def.description === 'string')
      return [this._def.description];
    return this._def.description;
  }

  get url(): string {
    return this._def?.url ?? '';
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

  get isMissing(): boolean {
    return this._name === 'Missing';
  }

  get isLiteral(): boolean {
    return false;
  }

  get symbolDefinition(): BoxedSymbolDefinition | undefined {
    return this._def;
  }

  _repairDefinition(): void {
    // Symbol that start with `_` are wildcards and never have a definition
    if (this._name[0] === '_') return;

    // Look for a  definition in the current scope
    let def: BoxedSymbolDefinition | undefined;

    // 1/  If there is some wikidata info, do a search using only wikidata first
    if (this._wikidata)
      def = this.engine.getSymbolDefinition('', this._wikidata);

    // 2/ If we couldn't find with wikidata, try find by name
    if (!def) {
      def = this.engine.getSymbolDefinition(this._name);
      if (
        def &&
        def.wikidata &&
        this._wikidata &&
        def.wikidata !== this._wikidata
      ) {
        // This was an entry matching by name, but with an inconsistent
        // wikidata,
        def = undefined;
      }
    }

    if (def) {
      // In case the symbol was found by its wikidata and the name of the
      // symbol doesn't match, update it to match the definition in our dictionary
      this._name = def.name;

      // Bind the definition and value to this symbol
      this._def = def;
    } else if (this.engine.defaultDomain !== null) {
      // No definition, create one if a default domain is specified
      this._def = this.engine.defineSymbol({
        name: this._name,
        wikidata: this._wikidata,
        domain: this.engine.defaultDomain,
        ...domainToFlags(this.engine.defaultDomain),
      });
      this._name = this._def.name;
    } else {
      this._def = undefined;
    }
  }

  get value(): BoxedExpression | undefined {
    return this._def?.value;
  }

  set value(value: SemiBoxedExpression | undefined) {
    // Symbol that start with `_` are wildcards and can never have an associated value
    if (this._name[0] === '_')
      throw new Error(
        `The value of the wildcard "${this._name}" cannot be changed`
      );

    // Clear assumptions  about this symbol
    this.engine.forget(this._name);

    let v: BoxedExpression | undefined;
    if (value !== undefined) {
      const boxedValue = this.engine.box(value);
      v = boxedValue.value ?? boxedValue.evaluate();
    }
    if (this._def) {
      // We are bound to a definition, update it
      // (this may throw if the definition is readonly)
      this._def.value = v;
    } else {
      this._def = this.engine.defineSymbol({
        name: this._name,
        value: v,
        domain: this.engine.defaultDomain ?? this.engine.domain('Anything'),
      });
    }
  }

  get numericValue(): BoxedExpression | undefined {
    return this._def?.value?.numericValue;
  }

  get domain(): BoxedExpression {
    return this._def?.domain ?? this.engine.domain('Anything');
  }

  set domain(d: BoxedExpression) {
    if (this._name[0] === '_')
      throw new Error(
        `The domain of the wildcard "${this._name}" cannot be changed`
      );

    if (this._def) {
      this._def.domain = d;
    } else {
      // Symbol was not bound to a definition, bind it in the current scope
      this._def = this.engine.defineSymbol({
        name: this._name,
        domain: d,
        ...domainToFlags(d),
      });
    }
  }

  get json(): Expression {
    return serializeJsonSymbol(this.engine, this._name, {
      wikidata: this._wikidata,
    });
  }

  get sgn(): -1 | 0 | 1 | undefined | null {
    // If available, use the value associated with this symbol.
    // Note that `null` is an acceptable and valid value
    const s = this.value?.sgn;
    if (s !== undefined) return s;

    // We didn't get a definitive answer from the value
    // of this symbol. Check flags.
    if (this._def?.zero === true) return 0;
    if (this._def?.positive === true) return 1;
    if (this._def?.negative === true) return -1;

    return undefined;
  }

  has(x: string | string[]): boolean {
    if (typeof x === 'string') return this._name === x;
    return x.includes(this._name);
  }

  isSame(rhs: BoxedExpression): boolean {
    if (!(rhs instanceof BoxedSymbol)) return false;
    return this._name === rhs._name;
  }

  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    // Idempotency ('x' = 'x')
    if (rhs.symbol !== null) return rhs.symbol === this._name;

    // Mathematical/numerical equality
    const val = this._def?.value;
    if (val) return val.isEqual(rhs);

    if (rhs.isZero) {
      if (this.isZero) return true;
      if (this.isNotZero) return false;
    }
    if (this.isZero && rhs.isNotZero) return false;
    // @todo could test other contradictory properties: prime vs composite, etc...

    // Direct assumptions
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

  get isZero(): boolean | undefined {
    return this._def?.zero ?? this._def?.value?.isZero;
  }

  get isNotZero(): boolean | undefined {
    const result = this._def?.notZero;
    if (typeof result === 'boolean') return result;
    const s = this.sgn;
    if (typeof s === 'number') return s !== 0;
    return undefined;
  }

  get isOne(): boolean | undefined {
    return this._def?.one;
  }

  get isNegativeOne(): boolean | undefined {
    return this._def?.negativeOne;
  }

  get isOdd(): boolean | undefined {
    return this._def?.odd;
  }

  get isEven(): boolean | undefined {
    return this._def?.even;
  }

  get isPrime(): boolean | undefined {
    return this._def?.prime;
  }

  get isComposite(): boolean | undefined {
    return this._def?.composite;
  }

  get isInfinity(): boolean | undefined {
    return this._def?.infinity;
  }
  get isNaN(): boolean | undefined {
    return this._def?.NaN;
  }
  // x > 0
  get isPositive(): boolean | undefined {
    return this._def?.positive;
  }
  get isNonPositive(): boolean | undefined {
    return this._def?.nonPositive;
  }
  get isNegative(): boolean | undefined {
    return this._def?.negative;
  }
  get isNonNegative(): boolean | undefined {
    return this._def?.nonNegative;
  }
  get isNumber(): boolean | undefined {
    return this._def?.number;
  }
  get isInteger(): boolean | undefined {
    return this._def?.integer;
  }
  get isRational(): boolean | undefined {
    return this._def?.rational;
  }
  get isAlgebraic(): boolean | undefined {
    return this._def?.rational;
  }
  get isReal(): boolean | undefined {
    return this._def?.real;
  }
  get isExtendedReal(): boolean | undefined {
    return this._def?.extendedReal;
  }
  get isComplex(): boolean | undefined {
    return this._def?.complex;
  }
  get isImaginary(): boolean | undefined {
    return this._def?.imaginary;
  }

  get canonical(): BoxedExpression {
    if (this._def?.hold === false)
      return this._def?.value?.value ?? this._def?.value ?? this;
    return this;
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
    if (this.symbolDefinition?.hold === true) return this;
    return this._def?.value?.evaluate(options) ?? this;
  }

  N(options?: NOptions): BoxedExpression {
    // If we're doing a numerical evaluation, the `hold` does not apply,
    // so call the evaluate handler directly (if the `N` handler doesn't work)
    const value = this._def?.value;
    return value?.N(options) ?? value?.evaluate(options) ?? value ?? this;
  }

  replace(
    rules: BoxedRuleSet,
    options?: ReplaceOptions
  ): BoxedExpression | null {
    return replace(this, rules, options);
  }

  subs(sub: Substitution): BoxedExpression {
    return sub[this._name] ?? this;
  }
}
