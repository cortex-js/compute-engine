import Complex from 'complex.js';
import { Decimal } from 'decimal.js';
import { isPrime } from '../numerics/primes';
import {
  BoxedExpression,
  BoxedFunctionDefinition,
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
import { bignumPreferred, complexAllowed, isLatexString } from './utils';
import { widen } from './boxed-domain';
import { asFloat } from './numerics';

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
  private _flags: Partial<NumericFlags> | undefined;

  constant: boolean;
  holdUntil: 'never' | 'simplify' | 'evaluate' | 'N';

  // readonly unit?: BoxedExpression;

  prototype?: BoxedFunctionDefinition; // @todo for collections and other special data structures
  self?: unknown; // @todo

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
    if (this._value === null) {
      const ce = this._engine;
      if (isLatexString(this._defValue))
        this._value = ce.parse(this._defValue) ?? ce.symbol('Undefined');
      else if (typeof this._defValue === 'function')
        this._value = ce.box(this._defValue(ce) ?? 'Undefined');
      else if (this._defValue) this._value = ce.box(this._defValue);
      else this._value = undefined;

      if (this._value?.numericValue) {
        const val = this._value.numericValue;
        if (!bignumPreferred(ce) && val instanceof Decimal)
          this._value = ce.number(val.toNumber());
        else if (!complexAllowed(ce) && val instanceof Complex)
          this._value = ce.NaN;
      }
    }
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
  get algebraic(): boolean | undefined {
    // Most numbers will return undefined, so the flag will provide the info if
    // present
    return this.value?.isAlgebraic ?? this._flags?.algebraic;
  }
  set algebraic(val: boolean | undefined) {
    this.updateFlags({ algebraic: val });
  }
  get real(): boolean | undefined {
    return this.value?.isReal ?? this._flags?.real;
  }
  set real(val: boolean | undefined) {
    this.updateFlags({ real: val });
  }
  get extendedReal(): boolean | undefined {
    return this.value?.isExtendedReal ?? this._flags?.extendedReal;
  }
  set extendedReal(val: boolean | undefined) {
    this.updateFlags({ extendedReal: val });
  }
  get complex(): boolean | undefined {
    return this.value?.isComplex ?? this._flags?.complex;
  }
  set complex(val: boolean | undefined) {
    this.updateFlags({ complex: val });
  }
  get extendedComplex(): boolean | undefined {
    return this.value?.isExtendedComplex ?? this._flags?.extendedComplex;
  }
  set extendedComplex(val: boolean | undefined) {
    this.updateFlags({ extendedComplex: val });
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
  get prime(): boolean | undefined {
    const val = this._value;
    if (val) {
      if (!val.isInteger || val.isNonPositive) return false;
      return isPrime(asFloat(val) ?? NaN);
    }

    return this._flags?.prime;
  }
  set prime(val: boolean | undefined) {
    this.updateFlags({ prime: val });
  }
  get composite(): boolean | undefined {
    const val = this._value;
    if (val) {
      if (!val.isInteger || val.isNonPositive) return false;
      return !isPrime(asFloat(val) ?? NaN);
    }

    return this._flags?.composite;
  }
  set composite(val: boolean | undefined) {
    this.updateFlags({ composite: val });
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
          case 'algebraic':
            consistent = this._value.isAlgebraic === flags.algebraic;
            break;
          case 'real':
            consistent = this._value.isReal === flags.real;
            break;
          case 'extendedReal':
            consistent = this._value.isExtendedReal === flags.extendedReal;
            break;
          case 'complex':
            consistent = this._value.isComplex === flags.complex;
            break;
          case 'extendedComplex':
            consistent =
              this._value.isExtendedComplex === flags.extendedComplex;
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
          case 'prime':
            consistent = this._value.isPrime === flags.prime;
            break;
          case 'composite':
            consistent = this._value.isComposite === flags.composite;
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

function normalizeFlags(flags: Partial<NumericFlags>): NumericFlags {
  const result = { ...flags };

  if (flags.zero || flags.one || flags.negativeOne) {
    result.zero = flags.zero && !flags.one && !flags.negativeOne;
    result.notZero = !flags.zero || flags.one || flags.negativeOne;
    result.one = flags.one && !flags.zero && !flags.negativeOne;
    result.negativeOne = flags.negativeOne && !flags.zero && !flags.one;
    result.infinity = false;
    result.NaN = false;
    result.finite = true;

    result.integer = true;
    result.finite = true;
    result.infinity = false;
    result.NaN = false;

    result.even = flags.one;
    result.odd = !flags.one;

    // 0, 1 and -1 are neither prime nor composite
    result.prime = false;
    result.composite = false;
  }

  if (result.zero) {
    result.positive = false;
    result.negative = false;
    result.nonPositive = true;
    result.nonNegative = true;
  }
  if (result.notZero === true) {
    if (!result.imaginary) result.real = true;
    result.zero = false;
  }
  if (result.one) {
    result.positive = true;
  }
  if (result.negativeOne) {
    result.nonPositive = true;
  }

  if (result.positive || result.nonNegative) {
    result.negativeOne = false;
  }
  if (result.positive) {
    result.nonPositive = false;
    result.negative = false;
    result.nonNegative = true;
  } else if (result.nonPositive) {
    result.positive = false;
    result.negative = result.notZero;
    result.nonNegative = !result.zero;
  } else if (result.negative) {
    result.positive = false;
    result.nonPositive = result.notZero;
    result.nonNegative = false;
  } else if (result.nonNegative) {
    result.positive = result.notZero;
    result.nonPositive = !result.zero;
    result.negative = false;
  }

  // Positive or negative numbers are real (not imaginary)
  if (
    result.positive ||
    result.negative ||
    result.nonPositive ||
    result.nonNegative
  ) {
    result.number = true;
    if (result.finite) result.real = true;
    // All non-imaginary numbers are complex
    else if (!result.finite) result.complex = true; // All non-imaginary numbers are complex

    result.imaginary = false;
  }

  if (result.finite) {
    result.number = true;
    result.complex = true;
    result.infinity = false;
    result.NaN = false;
  }

  if (result.infinity) {
    result.finite = false;
    result.NaN = false;
  }
  if (result.infinity === false) {
    result.extendedComplex = false;
    result.extendedReal = false;
  }

  if (flags.even) result.odd = false;
  if (flags.odd) result.even = false;

  // Adjust domain flags
  if (result.integer) result.rational = true;
  if (result.rational) result.algebraic = true;
  if (result.algebraic) result.real = true;
  if (result.real) result.complex = true;
  if (result.imaginary) result.complex = true;
  if (result.complex) result.number = true;
  if (result.real && result.infinity !== false) result.extendedReal = true;
  if (result.complex && result.infinity !== false)
    result.extendedComplex = true;

  // Adjust primality (depends on domain)
  if (
    result.even ||
    result.infinity ||
    result.NaN ||
    result.negative ||
    result.imaginary ||
    result.integer === false
  )
    result.prime = false;

  if (result.number && result.prime) result.composite = false;

  return result as NumericFlags;
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
    result.algebraic = false;
    result.real = false;
    result.extendedReal = false;
    result.complex = false;
    result.extendedComplex = false;
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

    result.prime = false;
    result.composite = false;
    return result;
  }

  // @todo: handle `Range`, `Interval`, and other numeric literals
  const base = dom.base;
  result.number = true;
  if (base === 'Integers') result.integer = true;
  if (base === 'RationalNumbers') result.rational = true;
  if (base === 'AlgebraicNumbers') result.algebraic = true;
  if (base === 'TranscendentalNumbers') {
    result.algebraic = false;
    result.real = true;
  }
  if (base === 'ExtendedRealNumbers') result.extendedReal = true;
  if (base === 'RealNumbers') result.real = true;
  if (base === 'ImaginaryNumbers') result.imaginary = true;
  if (base === 'ExtendedComplexNumbers') result.extendedComplex = true;
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
