import { isPrime } from '../numerics/primes';
import {
  BoxedExpression,
  BoxedFunctionDefinition,
  BoxedSymbolDefinition,
  IComputeEngine,
  RuntimeScope,
  SemiBoxedExpression,
  SymbolDefinition,
  SymbolFlags,
} from '../public';
import { isLatexString } from './utils';

function definedProperties(def: { [key: string]: any }): {
  [key: string]: any;
} {
  return Object.fromEntries(
    Object.entries(def).filter(([_k, v]) => v !== undefined)
  );
}

function normalizeFlags(flags: Partial<SymbolFlags>): SymbolFlags {
  const result = { ...flags };

  if (flags.zero || flags.one || flags.negativeOne) {
    result.number = true;
    result.integer = true;
    result.rational = true;
    result.algebraic = true;
    result.real = true;
    result.extendedReal = true;
    result.complex = true;
    result.extendedComplex = true;
    result.imaginary = false;

    result.positive = false;
    result.nonPositive = true;
    result.negative = false;
    result.nonNegative = true;

    result.zero = flags.zero;
    result.notZero = !flags.zero;
    result.one = flags.one;
    result.negativeOne = flags.negativeOne;
    result.negativeOne = false;
    result.infinity = false;
    result.NaN = false;
    result.finite = true;

    result.even = flags.one;
    result.odd = !flags.one;

    // 0, 1 and -1 are neither prime nor composite
    result.prime = false;
    result.composite = false;
    return result as SymbolFlags;
  }

  if (result.notZero === true) {
    if (!result.imaginary) result.real = true;
    result.zero = false;
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

  if (result.infinity) {
    result.finite = false;
    result.NaN = false;
  }
  if (result.finite) {
    result.number = true;
    result.complex = true;
    result.infinity = false;
    result.NaN = false;
  }

  if (flags.even) result.odd = false;
  if (flags.odd) result.even = false;

  // Adjust domain flags
  if (result.integer) result.rational = true;
  if (result.rational) result.algebraic = true;
  if (result.algebraic) result.real = true;
  if (result.extendedReal) result.real = true;
  if (result.real) result.complex = true;
  if (result.imaginary) result.complex = true;
  if (result.extendedComplex) result.complex = true;
  if (result.complex) result.number = true;
  if (result.real && result.infinity) result.extendedReal = true;
  if (result.complex && result.infinity) result.extendedComplex = true;

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

  return result as SymbolFlags;
}

export function domainToFlags(
  dom: BoxedExpression | undefined | null
): Partial<SymbolFlags> {
  if (!dom) return {};
  const domain = dom.symbol;
  const result: Partial<SymbolFlags> = {};

  if (dom.isSubsetOf('Number')) {
    result.number = true;
    if (domain === 'Integer') result.integer = true;
    if (domain === 'RationalNumber') result.rational = true;
    if (domain === 'AlgebraicNumber') result.algebraic = true;
    if (domain === 'TranscendentalNumber') {
      result.algebraic = false;
      result.real = true;
    }
    if (domain === 'ExtendedRealNumber') result.extendedReal = true;
    if (domain === 'RealNumber') result.real = true;
    if (domain === 'ImaginaryNumber') result.imaginary = true;
    if (domain === 'ExtendedComplexNumber') result.extendedComplex = true;
    if (domain === 'ComplexNumber') result.complex = true;
  } else {
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
  }
  return definedProperties(normalizeFlags(result)) as Partial<SymbolFlags>;
}

function valueToFlags(value: BoxedExpression): Partial<SymbolFlags> {
  value = value.canonical;
  return definedProperties({
    number: value.isNumber,
    integer: value.isInteger,
    rational: value.isRational,
    algebraic: value.isAlgebraic,
    real: value.isReal,
    extendedReal: value.isExtendedReal,
    complex: value.isComplex,
    extendedComplex: value.isExtendedComplex,
    imaginary: value.isImaginary,
    positive: value.isPositive,
    nonPositive: value.isNonPositive,
    negative: value.isNegative,
    nonNegative: value.isNonNegative,

    zero: value.isZero,
    notZero: value.isNotZero,
    one: value.isOne,
    negativeOne: value.isNegativeOne,
    infinity: value.isInfinity,
    NaN: value.isNaN,
    finite: value.isFinite,

    even: value.isEven,
    odd: value.isOdd,

    prime: value.isPrime,
    composite: value.isComposite,
  }) as Partial<SymbolFlags>;
}

export class BoxedSymbolDefinitionImpl implements BoxedSymbolDefinition {
  private _engine: IComputeEngine;
  private _value: BoxedExpression | undefined;
  readonly name: string;
  wikidata?: string;
  description?: string | string[];
  readonly scope: RuntimeScope | undefined;

  private _domain: BoxedExpression | undefined;
  // readonly unit?: BoxedExpression;

  private _number: boolean | undefined;
  private _integer: boolean | undefined;
  private _rational: boolean | undefined;
  private _algebraic: boolean | undefined;
  private _real: boolean | undefined;
  private _extendedReal: boolean | undefined;
  private _complex: boolean | undefined;
  private _extendedComplex: boolean | undefined;
  private _imaginary: boolean | undefined;

  private _positive: boolean | undefined; // x > 0
  private _nonPositive: boolean | undefined; // x <= 0
  private _negative: boolean | undefined; // x < 0
  private _nonNegative: boolean | undefined; // x >= 0

  private _zero: boolean | undefined;
  private _notZero: boolean | undefined;
  private _one: boolean | undefined;
  private _negativeOne: boolean | undefined;
  private _infinity: boolean | undefined;
  private _NaN: boolean | undefined;
  private _finite: boolean | undefined;

  private _even: boolean | undefined;
  private _odd: boolean | undefined;

  private _prime: boolean | undefined;
  private _composite: boolean | undefined;

  private _at: (index: string | number) => undefined | SemiBoxedExpression;
  at?: (index: string | number) => undefined | BoxedExpression;

  readonly constant: boolean;
  readonly hold: boolean;

  private _def: SymbolDefinition;

  prototype?: BoxedFunctionDefinition; // @todo for collections and other special data structures
  self?: any; // @todo

  constructor(ce: IComputeEngine, def: SymbolDefinition) {
    this._engine = ce;
    this._def = def;
    this.scope = ce.context;
    this.name = def.name;
    this.constant = def.constant ?? false;
    this.hold = def.hold ?? true;

    this._purge();
  }

  _purge(): undefined {
    this._value = this._value?._purge();
    // this._domain = this._domain?._purge();

    const def = this._def;

    const result = definedProperties({
      description: def.description,
      wikidata: def.wikidata,
      number: def.number,
      integer: def.integer,
      rational: def.rational,
      algebraic: def.algebraic,
      real: def.real,
      extendedReal: def.extendedReal,
      complex: def.complex,
      zero: def.zero,
      notZero: def.notZero,
      one: def.one,
      negativeOne: def.negativeOne,
      infinity: def.infinity,
      NaN: def.NaN,
      finite: def.finite,
      even: def.even,
      odd: def.odd,
      prime: def.prime,
      composite: def.composite,
      // unit: def.unit ? ce.box(def.unit) : undefined,
    }) as BoxedSymbolDefinition;

    //
    // 1/ Is it a number?
    //
    if ('value' in def && typeof def.value === 'number') {
      // If the dictionary entry is provided as a number, assume it's a
      // variable, and infer its domain based on its value.
      const value = this._engine.number(def.value);
      let domain: BoxedExpression;
      const defDomain = def.domain
        ? this._engine.domain(def.domain)
        : undefined;
      if (defDomain && value.domain.isSubsetOf(defDomain)) domain = defDomain;
      else domain = value.domain;

      this._value = value;
      this._domain = domain;
      this.setProps(valueToFlags(value));
      this.setProps(domainToFlags(domain));
      this.setProps(result);

      return undefined;
    }

    //
    // 2/ It's a full definition with no value or a non-numeric value
    //

    let value: BoxedExpression | undefined;
    if (isLatexString(def.value)) value = this._engine.parse(def.value)!;
    else if (typeof def.value === 'function')
      value = this._engine.box(def.value(this._engine) ?? 'Undefined');
    else if (def.value) value = this._engine.box(def.value);

    if (!value && def.hold === false)
      throw new Error(
        `Symbol definition "${def.name}": Expected a value "hold=false" `
      );

    value = value?.canonical;

    // If there is a domain specified in the definition, and it
    // is compatible with the value, use it.
    // For example, domain = Real, value = 5 (Integer).
    // Otherwise, adopt the domain of the value, if there is one.
    // Otherwise, the default domain if there is one.
    // Otherwise 🤷 'Anything'
    let domain: BoxedExpression;
    const defDomain = def.domain ? this._engine.domain(def.domain) : undefined;
    if (defDomain && (!value || value.domain.isSubsetOf(defDomain)))
      domain = defDomain;
    else
      domain =
        value?.domain ??
        this._engine.defaultDomain ??
        this._engine.domain('Anything');

    if (!value) {
      this._value = undefined;
      this._domain = domain;
      this.setProps(domainToFlags(domain));
      this.setProps(result);

      return undefined;
    }
    this._value = value;
    this._domain = domain;
    this.setProps(valueToFlags(value));
    this.setProps(domainToFlags(domain));
    this.setProps(result);

    return undefined;
  }

  get value(): BoxedExpression | undefined {
    return this._value;
  }

  set value(val: BoxedExpression | number | undefined) {
    if (this.constant)
      throw new Error(
        `The value of the constant "${this.name}" cannot be changed`
      );
    if (typeof val === 'number') val = this._engine.box(val);
    this._value = val;
    if (val) this.setProps(valueToFlags(val));
  }

  get domain(): BoxedExpression | undefined {
    return this._domain;
  }

  set domain(domain: BoxedExpression | undefined | string) {
    if (!domain) {
      this._domain = undefined;
      return;
    }

    domain = this._engine.domain(domain);

    // Ensure the domain is compatible with the domain of the value,
    // if there is one
    const valDomain = this.value?.domain;
    if (valDomain && !valDomain.isSubsetOf(domain)) domain = valDomain;

    this._domain = domain;
    this.setProps(domainToFlags(domain));
  }

  updateFlags(flags: Partial<SymbolFlags>): void {
    this.setProps(normalizeFlags(flags));
  }

  // Set the props, except for the domain and value
  setProps(props: Omit<Partial<BoxedSymbolDefinition>, 'domain' | 'value'>) {
    if (props.wikidata) this.wikidata = props.wikidata;
    if (props.description) this.description = props.description;

    if (props.number !== undefined) this._number = props.number;
    if (props.integer !== undefined) this._integer = props.integer;
    if (props.rational !== undefined) this._rational = props.rational;
    if (props.algebraic !== undefined) this._algebraic = props.algebraic;
    if (props.real !== undefined) this._real = props.real;
    if (props.extendedReal !== undefined)
      this._extendedReal = props.extendedReal;
    if (props.complex !== undefined) this._complex = props.complex;
    if (props.extendedComplex !== undefined)
      this._extendedComplex = props.extendedComplex;
    if (props.imaginary !== undefined) this._imaginary = props.imaginary;
    if (props.positive !== undefined) this._positive = props.positive;
    if (props.nonPositive !== undefined) this._nonPositive = props.nonPositive;
    if (props.negative !== undefined) this._negative = props.negative;
    if (props.nonNegative !== undefined) this._nonNegative = props.nonNegative;
    if (props.zero !== undefined) this._zero = props.zero;
    if (props.notZero !== undefined) this._notZero = props.notZero;
    if (props.one !== undefined) this._one = props.one;
    if (props.negativeOne !== undefined) this._negativeOne = props.negativeOne;
    if (props.infinity !== undefined) this._infinity = props.infinity;
    if (props.finite !== undefined) this._finite = props.finite;
    if (props.NaN !== undefined) this._NaN = props.NaN;
    if (props.even !== undefined) this._even = props.even;
    if (props.odd !== undefined) this._odd = props.odd;
    if (props.prime !== undefined) this._prime = props.prime;
    if (props.composite !== undefined) this._composite = props.composite;
  }

  //
  // Flags
  //

  get number(): boolean | undefined {
    return this._number;
  }
  set number(val: boolean | undefined) {
    this.updateFlags({ number: val });
  }

  get integer(): boolean | undefined {
    return this._integer;
  }
  set integer(val: boolean | undefined) {
    this.updateFlags({ integer: val });
  }
  get rational(): boolean | undefined {
    return this._rational;
  }
  set rational(val: boolean | undefined) {
    this.updateFlags({ rational: val });
  }
  get algebraic(): boolean | undefined {
    return this._algebraic;
  }
  set algebraic(val: boolean | undefined) {
    this.updateFlags({ algebraic: val });
  }
  get real(): boolean | undefined {
    return this._real;
  }
  set real(val: boolean | undefined) {
    this.updateFlags({ real: val });
  }
  get extendedReal(): boolean | undefined {
    return this._extendedReal;
  }
  set extendedReal(val: boolean | undefined) {
    this.updateFlags({ extendedReal: val });
  }
  get complex(): boolean | undefined {
    return this._complex;
  }
  set complex(val: boolean | undefined) {
    this.updateFlags({ complex: val });
  }
  get extendedComplex(): boolean | undefined {
    return this._extendedComplex;
  }
  set extendedComplex(val: boolean | undefined) {
    this.updateFlags({ extendedComplex: val });
  }
  get imaginary(): boolean | undefined {
    return this._imaginary;
  }
  set imaginary(val: boolean | undefined) {
    this.updateFlags({ imaginary: val });
  }
  get positive(): boolean | undefined {
    return this._positive;
  }
  set positive(val: boolean | undefined) {
    this.updateFlags({ positive: val });
  }
  get nonPositive(): boolean | undefined {
    return this._nonPositive;
  }
  set nonPositive(val: boolean | undefined) {
    this.updateFlags({ nonPositive: val });
  }
  get negative(): boolean | undefined {
    return this._negative;
  }
  set negative(val: boolean | undefined) {
    this.updateFlags({ negative: val });
  }
  get nonNegative(): boolean | undefined {
    return this._nonNegative;
  }
  set nonNegative(val: boolean | undefined) {
    this.updateFlags({ nonNegative: val });
  }
  get zero(): boolean | undefined {
    return this._zero;
  }
  set zero(val: boolean | undefined) {
    this.updateFlags({ zero: val });
  }
  get notZero(): boolean | undefined {
    return this._notZero;
  }
  set notZero(val: boolean | undefined) {
    this.updateFlags({ notZero: val });
  }
  get one(): boolean | undefined {
    return this._one;
  }
  set one(val: boolean | undefined) {
    this.updateFlags({ one: val });
  }
  get negativeOne(): boolean | undefined {
    return this._negativeOne;
  }
  set negativeOne(val: boolean | undefined) {
    this.updateFlags({ negativeOne: val });
  }
  get infinity(): boolean | undefined {
    return this._infinity;
  }
  set infinity(val: boolean | undefined) {
    this.updateFlags({ infinity: val });
  }
  get finite(): boolean | undefined {
    return this._finite;
  }
  set finite(val: boolean | undefined) {
    this.updateFlags({ finite: val });
  }
  get NaN(): boolean | undefined {
    return this._NaN;
  }
  set NaN(val: boolean | undefined) {
    this.updateFlags({ NaN: val });
  }
  get even(): boolean | undefined {
    return this._even;
  }
  set even(val: boolean | undefined) {
    this.updateFlags({ even: val });
  }
  get odd(): boolean | undefined {
    return this._odd;
  }
  set odd(val: boolean | undefined) {
    this.updateFlags({ odd: val });
  }
  get prime(): boolean | undefined {
    if (this._prime === undefined && this._value?.isNumber) {
      if (!this._value.isInteger || this._value.isNonPositive) {
        this._prime = false;
        this._composite = false;
      } else {
        const n = this._value.asFloat;
        if (n !== null) {
          this._prime = isPrime(n);
          this._composite = !this._prime;
        } else {
          // @todo handle Decimal
          this._prime = undefined;
          this._composite = undefined;
        }
      }
    }
    return this._prime;
  }
  set prime(val: boolean | undefined) {
    this.updateFlags({ prime: val });
  }
  get composite(): boolean | undefined {
    if (this._composite === undefined) {
      const isPrime = this.prime;
      if (isPrime === undefined) this._composite = undefined;
      else this._composite = !isPrime;
    }
    return this._composite;
  }
  set composite(val: boolean | undefined) {
    this.updateFlags({ composite: val });
  }
}
