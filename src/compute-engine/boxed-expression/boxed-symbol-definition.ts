import type {
  BoxedExpression,
  BoxedSymbolDefinition,
  BoxedDomain,
  DomainExpression,
  IComputeEngine,
  RuntimeScope,
  SemiBoxedExpression,
  SymbolDefinition,
  NumericFlags,
  LatexString,
} from './public';
import { _BoxedExpression } from './abstract-boxed-expression';
import { isLatexString, normalizeFlags } from './utils';
import { widen } from './boxed-domain';
import { Type } from '../../common/type/types';

/**
 * ### THEORY OF OPERATIONS
 *
 * - The value or domain of a constant cannot be changed.
 * - If set explicitly, the value is the source of truth: it overrides any
 *  flags.
 * - Once the domain has been set, it can only be changed from a numeric domain
 * to another numeric domain (some expressions may have been validated with
 * assumptions that the domain was numeric).
 * - When the domain is changed, the value is preserved if it is compatible
 *  with the new domain, otherwise it is reset to no value. Flags are adjusted
 * to match the domain (discarded if not a numeric domain).
 * - When the value is changed, the domain is unaffected. If the value is not
 *  compatible with the domain (setting a def with a numeric domain to a value
 *  of `True` for example), the value is discarded.
 * - When getting a flag, if a value is available, it is the source of truth.
 * Otherwise, the stored flags are (the stored flags are also set when the domain is changed)
 *
 */

export class _BoxedSymbolDefinition implements BoxedSymbolDefinition {
  readonly name: string;
  wikidata?: string;
  description?: string | string[];
  url?: string;

  private _engine: IComputeEngine;
  readonly scope: RuntimeScope | undefined;

  // The defValue is the value as specified in the original definition.
  // It is used to update the actual value when the environment changes,
  // e.g. when the Compute Engine precision is changed.
  private _defValue?:
    | LatexString
    | SemiBoxedExpression
    | ((ce: IComputeEngine) => SemiBoxedExpression | null);

  // If `null`, the value needs to be recalculated from _defValue
  private _value: BoxedExpression | undefined | null;

  // If `null`, the domain is the domain of the _value
  private _domain: BoxedDomain | undefined | null;

  // If true, the _domain is inferred
  inferredDomain: boolean;

  // If `null`, the type is the type of the value
  // @fixme: update property where needed
  private _type: Type | undefined | null;

  // If true, the _type is inferred
  // @fixme: update property where needed
  inferredType: boolean;

  constant: boolean;

  holdUntil: 'never' | 'evaluate' | 'N';

  private _flags: Partial<NumericFlags> | undefined;

  constructor(ce: IComputeEngine, name: string, def: SymbolDefinition) {
    if (!ce.context) throw Error('No context available');

    this.name = name;
    this.wikidata = def.wikidata;
    this.description = def.description;
    this.url = def.url;

    this._engine = ce;
    this.scope = ce.context;

    this.name = name;

    this._flags = def.flags ? normalizeFlags(def.flags) : undefined;

    this._domain = def.domain ? ce.domain(def.domain) : undefined;
    this.inferredDomain = def.inferred ?? false;
    this.inferredType = def.inferred ?? false; // @fixme...

    this.constant = def.constant ?? false;
    this.holdUntil = def.holdUntil ?? 'evaluate';

    if (this.constant) {
      this._defValue = def.value;
      this._value = null;
    } else {
      if (def.value !== undefined) {
        if (isLatexString(def.value))
          this._value = ce.parse(def.value) ?? ce.symbol('Undefined');
        else if (typeof def.value === 'function')
          this._value = ce.box(def.value(ce) ?? 'Undefined');
        else if (def.value instanceof _BoxedExpression) this._value = def.value;
        else this._value = ce.box(def.value);
      } else this._value = undefined;
      if (!this._value && this._domain && !def.flags)
        this._flags = domainToFlags(this._domain);
    }

    if (this._value && !this._domain) {
      this._domain = this._value.domain;
      this.inferredDomain = true;

      this._type = this._value.type;
      this.inferredType = true;
    }
  }

  /** The symbol was previously inferred, but now it has a declaration. Update the def accordingly (we can't replace defs, as other expressions may be referencing them) */
  update(def: SymbolDefinition): void {
    if (def.wikidata) this.wikidata = def.wikidata;
    if (def.description) this.description = def.description;
    if (def.url) this.url = def.url;

    let flags = def?.flags;
    const domain = def?.domain ? this._engine.domain(def.domain) : undefined;

    if (domain) flags = { ...domainToFlags(domain), ...(flags ?? {}) };

    if (flags) this._flags = normalizeFlags(flags);

    if (domain) {
      this._domain = domain;
      this.inferredDomain = false;
    }

    if (def.holdUntil) this.holdUntil = def.holdUntil;

    if (def.constant) {
      this.constant = def.constant;
      this._defValue = def.value;
      this._value = null;
    } else {
      if (def.value) {
        if (isLatexString(def.value))
          this._value =
            this._engine.parse(def.value) ?? this._engine.symbol('Undefined');
        else if (typeof def.value === 'function')
          this._value = this._engine.box(
            def.value(this._engine) ?? 'Undefined'
          );
        else if (def.value instanceof _BoxedExpression) this._value = def.value;
        else this._value = this._engine.box(def.value);
      }
    }

    if (this._value && !this._domain) {
      this._domain = this._value.domain;
      this.inferredDomain = true;
    }
  }

  reset(): void {
    // Force the value to be recalculated based on the original definition
    // Useful when the environment (e.g.) precision changes
    if (this.constant) this._value = null;
  }

  get value(): BoxedExpression | undefined {
    if (this._value !== null) return this._value ?? undefined;

    const ce = this._engine;

    if (isLatexString(this._defValue))
      this._value = ce.parse(this._defValue) ?? ce.symbol('Undefined');
    else if (typeof this._defValue === 'function')
      this._value = ce.box(this._defValue(ce) ?? 'Undefined');
    else if (this._defValue !== undefined) this._value = ce.box(this._defValue);
    else this._value = undefined;

    return this._value ?? undefined;
  }

  set value(val: SemiBoxedExpression | number | undefined) {
    if (this.constant)
      throw new Error(
        `The value of the constant "${this.name}" cannot be changed`
      );

    // There should be no _defValue (only constants would have them)
    console.assert(this._defValue === undefined);

    if (typeof val === 'number') {
      this._value = this._engine.number(val);
    } else if (val) {
      const newVal = this._engine.box(val);
      // If the new value is not compatible with the domain, discard it
      if (this.inferredDomain) {
        this._value = newVal;
        this._domain = widen(this._domain, newVal.domain);
      } else if (
        !this._domain ||
        !newVal.domain ||
        newVal.domain?.isCompatible(this._domain)
      )
        this._value = newVal;
      else this._value = undefined;
    } else this._value = undefined;

    // If there were any flags, discard them, the value is the source of truth
    if (this._value !== undefined) this._flags = undefined;
    else this._flags = domainToFlags(this._domain);
  }

  get domain(): BoxedDomain | undefined {
    return this._domain ?? undefined;
  }

  set domain(domain: BoxedDomain | DomainExpression | undefined) {
    if (this.constant)
      throw new Error(
        `The domain of the constant "${this.name}" cannot be changed`
      );

    if (!this.inferredDomain)
      throw Error(
        `The domain of "${this.name}" cannot be changed because it has already been declared`
      );

    if (!domain) {
      this._defValue = undefined;
      this._value = undefined;
      this._flags = undefined;
      this._domain = undefined;
      return;
    }

    domain = this._engine.domain(domain);

    // Narrowing is OK
    if (this._domain && !domain.isCompatible(this._domain)) {
      throw Error(
        `The domain of "${this.name}" cannot be widened from "${this._domain.base}" to "${domain.base}"`
      );
    }

    if (this._value?.domain && !this._value.domain.isCompatible(domain))
      throw Error(
        `The domain of "${this.name}" cannot be changed to "${domain.base}" because its value has a domain of "${this._value.domain.base}"`
      );

    this._domain = domain;
    this._flags = undefined;
    if (this._value === undefined && domain.isNumeric)
      this._flags = domainToFlags(domain);
  }

  get type(): Type {
    if (this._type) return this._type;
    if (this._value) return this._value.type;
    return 'unknown';
  }

  set type(type: Type) {
    if (this.constant)
      throw new Error(
        `The type of the constant "${this.name}" cannot be changed`
      );

    if (!this.inferredType)
      throw Error(
        `The type of "${this.name}" cannot be changed because it has already been declared`
      );

    // @fixme: should be more leninent here, i.e. allow type widening or narrowing
    if (this._value && this._value.type !== type)
      throw Error(
        `The type of "${this.name}" cannot be changed because its value has a type of "${this._value.type}"`
      );

    // @fixme: update the flags based on the type

    this._type = type;
  }

  //
  // Flags
  //

  get number(): boolean | undefined {
    return this.value?.isNumber ?? this._flags?.number;
  }
  set number(val: boolean | undefined) {
    this.updateFlags({ number: val });
  }

  get integer(): boolean | undefined {
    return this.value?.isInteger ?? this._flags?.integer;
  }
  set integer(val: boolean | undefined) {
    this.updateFlags({ integer: val });
  }
  get rational(): boolean | undefined {
    return this.value?.isRational ?? this._flags?.rational;
  }
  set rational(val: boolean | undefined) {
    this.updateFlags({ rational: val });
  }
  get real(): boolean | undefined {
    return this.value?.isReal ?? this._flags?.real;
  }
  set real(val: boolean | undefined) {
    this.updateFlags({ real: val });
  }
  get complex(): boolean | undefined {
    return this.value?.isComplex ?? this._flags?.complex;
  }
  set complex(val: boolean | undefined) {
    this.updateFlags({ complex: val });
  }
  get imaginary(): boolean | undefined {
    return this.value?.isImaginary ?? this._flags?.imaginary;
  }
  set imaginary(val: boolean | undefined) {
    this.updateFlags({ imaginary: val });
  }
  get positive(): boolean | undefined {
    return this.value?.isPositive ?? this._flags?.positive;
  }
  set positive(val: boolean | undefined) {
    this.updateFlags({ positive: val });
  }
  get nonPositive(): boolean | undefined {
    return this.value?.isNonPositive ?? this._flags?.nonPositive;
  }
  set nonPositive(val: boolean | undefined) {
    this.updateFlags({ nonPositive: val });
  }
  get negative(): boolean | undefined {
    return this.value?.isNegative ?? this._flags?.negative;
  }
  set negative(val: boolean | undefined) {
    this.updateFlags({ negative: val });
  }
  get nonNegative(): boolean | undefined {
    return this.value?.isNonNegative ?? this._flags?.nonNegative;
  }
  set nonNegative(val: boolean | undefined) {
    this.updateFlags({ nonNegative: val });
  }
  get zero(): boolean | undefined {
    return this.value?.isZero ?? this._flags?.zero;
  }
  set zero(val: boolean | undefined) {
    this.updateFlags({ zero: val });
  }
  get notZero(): boolean | undefined {
    return this.value?.isNotZero ?? this._flags?.notZero;
  }
  set notZero(val: boolean | undefined) {
    this.updateFlags({ notZero: val });
  }
  get one(): boolean | undefined {
    return this.value?.isOne ?? this._flags?.one;
  }
  set one(val: boolean | undefined) {
    this.updateFlags({ one: val });
  }
  get negativeOne(): boolean | undefined {
    return this.value?.isNegativeOne ?? this._flags?.negativeOne;
  }
  set negativeOne(val: boolean | undefined) {
    this.updateFlags({ negativeOne: val });
  }
  get infinity(): boolean | undefined {
    return this.value?.isInfinity ?? this._flags?.infinity;
  }
  set infinity(val: boolean | undefined) {
    this.updateFlags({ infinity: val });
  }
  get finite(): boolean | undefined {
    return this.value?.isFinite ?? this._flags?.finite;
  }
  set finite(val: boolean | undefined) {
    this.updateFlags({ finite: val });
  }
  get NaN(): boolean | undefined {
    return this.value?.isNaN ?? this._flags?.NaN;
  }
  set NaN(val: boolean | undefined) {
    this.updateFlags({ NaN: val });
  }
  get even(): boolean | undefined {
    return this.value?.isEven ?? this._flags?.even;
  }
  set even(val: boolean | undefined) {
    this.updateFlags({ even: val });
  }
  get odd(): boolean | undefined {
    return this.value?.isOdd ?? this._flags?.odd;
  }
  set odd(val: boolean | undefined) {
    this.updateFlags({ odd: val });
  }

  updateFlags(flags: Partial<NumericFlags>): void {
    // If this is a constant, can set the flags
    if (this.constant) throw Error('The flags of constant cannot be changed');
    if (this.domain?.isNumeric === false)
      throw Error('Flags only apply to numeric domains');

    let flagCount = 0;
    let consistent = true;
    for (const flag in Object.keys(flags)) {
      flagCount += 1;
      if (this._value && flags[flag] !== undefined) {
        switch (flag) {
          case 'number':
            consistent = this._value.isNumber === flags.number;
            break;
          case 'integer':
            consistent = this._value.isInteger === flags.integer;
            break;
          case 'rational':
            consistent = this._value.isRational === flags.rational;
            break;
          case 'real':
            consistent = this._value.isReal === flags.real;
            break;
          case 'complex':
            consistent = this._value.isComplex === flags.complex;
            break;
            break;
          case 'imaginary':
            consistent = this._value.isImaginary === flags.imaginary;
            break;
          case 'positive':
            consistent = this._value.isPositive === flags.positive;
            break;
          case 'nonPositive':
            consistent = this._value.isNonPositive === flags.nonPositive;
            break;
          case 'negative':
            consistent = this._value.isNegative === flags.negative;
            break;
          case 'nonNegative':
            consistent = this._value.isNonNegative === flags.nonNegative;
            break;
          case 'zero':
            consistent = this._value.isZero === flags.zero;
            break;
          case 'notZero':
            consistent = this._value.isNotZero === flags.notZero;
            break;
          case 'one':
            consistent = this._value.isOne === flags.one;
            break;
          case 'negativeOne':
            consistent = this._value.isNegativeOne === flags.negativeOne;
            break;
          case 'infinity':
            consistent = this._value.isInfinity === flags.infinity;
            break;
          case 'NaN':
            consistent = this._value.isNaN === flags.NaN;
            break;
          case 'finite':
            consistent = this._value.isFinite === flags.finite;
            break;
          case 'even':
            consistent = this._value.isEven === flags.even;
            break;
          case 'odd':
            consistent = this._value.isOdd === flags.odd;
            break;
        }
      }
    }

    if (flagCount > 0) {
      if (!consistent) {
        this._defValue = undefined;
        this._value = undefined;
      }
      this._domain = this._engine.Numbers;

      if (!this._flags) this._flags = normalizeFlags(flags);
      else this._flags = { ...this._flags, ...normalizeFlags(flags) };
    }
  }
}

function definedKeys<T>(xs: Record<string, T>): Record<string, T> {
  return Object.fromEntries(
    Object.entries(xs).filter(([_k, v]) => v !== undefined)
  );
}

export function domainToFlags(
  dom: BoxedDomain | undefined | null
): Partial<NumericFlags> {
  if (!dom) return {};
  const result: Partial<NumericFlags> = {};

  if (!dom.isNumeric) {
    result.number = false;
    result.integer = false;
    result.rational = false;
    result.real = false;
    result.complex = false;
    result.imaginary = false;

    result.positive = false;
    result.nonPositive = false;
    result.negative = false;
    result.nonNegative = false;
    result.zero = false;
    result.notZero = false;
    result.one = false;
    result.negativeOne = false;
    result.infinity = false;
    result.NaN = false;

    result.odd = false;
    result.even = false;

    return result;
  }

  // @todo: handle `Range`, `Interval`, and other numeric literals
  const base = dom.base;
  result.number = true;
  if (base === 'Integers') result.integer = true;
  if (base === 'RationalNumbers') result.rational = true;
  if (base === 'RealNumbers') result.real = true;
  if (base === 'ImaginaryNumbers') result.imaginary = true;
  if (base === 'ComplexNumbers') result.complex = true;

  if (base === 'PositiveNumbers') {
    result.notZero = true;
    result.real = true;
    result.positive = true;
  }
  if (base === 'NegativeNumbers') {
    result.notZero = true;
    result.real = true;
    result.negative = true;
  }
  if (base === 'NonNegativeNumbers') {
    result.real = true;
    result.positive = true;
  }
  if (base === 'NonPositiveNumbers') {
    result.real = true;
    result.negative = true;
  }

  if (base === 'PositiveIntegers') {
    result.notZero = true;
    result.integer = true;
    result.positive = true;
  }
  if (base === 'NegativeNumbers') {
    result.notZero = true;
    result.integer = true;
    result.negative = true;
  }
  if (base === 'NonNegativeNumbers') {
    result.integer = true;
    result.positive = true;
  }
  if (base === 'NonPositiveNumbers') {
    result.integer = true;
    result.negative = true;
  }

  return definedKeys(normalizeFlags(result));
}
