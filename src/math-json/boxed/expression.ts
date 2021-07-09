import {
  ComputeEngine,
  Definition,
  Domain,
  FunctionDefinition,
  NumericDomain,
} from '../compute-engine-interface';
import {
  Expression,
  MathJsonDictionary,
  MathJsonFunction,
  MathJsonNumber,
  MathJsonString,
  MathJsonSymbol,
} from '../math-json-format';
import { Decimal } from 'decimal.js';
import { Complex } from 'complex.js';
import { gcd } from '../../compute-engine/numeric';
import { checkAssumption, evaluateBoolean } from '../../compute-engine/assume';
import { isNumericSubdomain } from '../../compute-engine/dictionary/domains';
import { box, BoxedExpression } from './public';

/** Quickly determine the numeric domain of a number or constant
 * For the symbols, this is a hard-coded optimization that doesn't rely on the
 * dictionaries. The regular path is in `internalDomain()`
 */
function inferNumericDomain(
  value: number | Decimal | Complex | [numer: number, denom: number]
): NumericDomain {
  //
  // 1. Is it a number?
  //

  if (typeof value === 'number' && !isNaN(value)) {
    if (!isFinite(value)) return 'ExtendedRealNumber';

    if (value === 0) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (Number.isInteger(value)) {
      if (value > 0) return 'PositiveInteger';
      if (value < 0) return 'NegativeInteger';
      return 'Integer';
    }

    if (value > 0) return 'PositiveNumber';
    if (value < 0) return 'NegativeNumber';

    return 'RealNumber';
  }

  //
  // 2 Is it a decimal?
  //
  if (value instanceof Decimal) {
    if (value.isNaN()) return 'Number';
    if (!value.isFinite()) return 'ExtendedRealNumber';
    if (value.isZero()) return 'NonNegativeInteger'; // Bias: Could be NonPositiveInteger

    if (value.isInteger()) {
      if (value.gt(0)) return 'PositiveInteger';
      if (value.lt(0)) return 'NegativeInteger';
      return 'Integer';
    }

    if (value.gt(0)) return 'PositiveNumber';
    if (value.lt(0)) return 'NegativeNumber';
    return 'RealNumber';
  }

  //
  // 3 Is it a complex number?
  //
  if (value instanceof Complex) {
    const c = value as Complex;
    if (c.im === 0) return inferNumericDomain(c.re);
    if (c.re === 0 && c.im !== 0) return 'ImaginaryNumber';
    return 'ComplexNumber';
  }

  //
  // 4. Is it a rational?
  //

  if (Array.isArray(value)) {
    let [numer, denom] = value;

    const g = gcd(numer, denom);
    numer = numer / g;
    denom = denom / g;
    if (!Number.isNaN(numer) && !Number.isNaN(denom)) {
      // The value is a rational number
      if (denom !== 1) return 'RationalNumber';

      return inferNumericDomain(numer);
    }
  }

  return 'Number';
}

/**
 * BoxedNumber
 */

export class BoxedNumber extends BoxedExpression {
  protected readonly _value:
    | number
    | Decimal
    | Complex
    | [numer: number, denom: number];

  constructor(
    expr: number | Decimal | Complex | [numer: number, denom: number],
    ce?: ComputeEngine
  ) {
    super(ce);
    this._value = expr;
  }
  get head(): string {
    return 'Number';
  }
  get numberValue(): number | null {
    return typeof this._value === 'number' ? this._value : null;
  }
  get decimalValue(): Decimal | null {
    return this._value instanceof Decimal ? this._value : null;
  }
  get complexValue(): Complex | null {
    return this._value instanceof Complex ? this._value : null;
  }
  get rationalValue(): [numer: number | null, denom: number | null] {
    return [null, null];
  }
  get def(): null {
    return null;
  }
  get domain(): NumericDomain {
    return inferNumericDomain(this._value);
  }
  get json(): Expression[] | MathJsonNumber | number {
    if (this._value instanceof Decimal) {
      return { num: this._value.toString() + 'd' };
    }
    if (this._value instanceof Complex) {
      return ['Complex', this._value.re, this._value.im];
    }
    if (Array.isArray(this._value)) {
      return ['Divide', this._value[0], this._value[1]];
    }
    // this._value is a number
    if (Number.isNaN(this._value)) return { num: 'NaN' };
    if (!Number.isFinite(this._value) && this._value > 0)
      return { num: '+Infinity' };
    if (!Number.isFinite(this._value) && this._value < 0)
      return { num: '-Infinity' };
    return this._value;
  }
  get sgn(): -1 | 0 | 1 | undefined {
    if (typeof this._value === 'number') {
      if (this._value === 0) return 0;
      if (this._value < 0) return -1;
      if (this._value > 0) return 1;
      return undefined;
    }
    if (this._value instanceof Decimal) {
      if (this._value.isZero()) return 0;
      if (this._value.isNegative()) return -1;
      if (this._value.isPositive()) return 1;
      return undefined;
    }

    if (Array.isArray(this._value)) {
      const [numer] = this._value;
      if (numer === 0) return 0;
      if (numer < 0) return -1;
      if (numer > 0) return 1;
      return undefined;
    }

    // No need to check for Complex

    return undefined;
  }
  isEqual(rhs: BoxedExpression | number): boolean | undefined {
    if (typeof this._value === 'number') {
      if (typeof rhs === 'number') return this._value === rhs;
      else if (rhs instanceof Decimal) return rhs.equals(this._value);

      return false;
    }

    if (this._value instanceof Decimal) {
      if (typeof rhs === 'number' || rhs instanceof Decimal)
        return this._value.equals(rhs);
      return false;
    }

    if (this._value instanceof Complex) {
      if (rhs instanceof Complex) return this._value.eq(rhs);
      return false;
    }

    if (Array.isArray(this._value)) {
      let [n1, d1] = this._value;
      const gcd1 = gcd(n1, d1);
      [n1, d1] = [n1 / gcd1, d1 / gcd1];
      if (rhs instanceof BoxedNumber) {
        let [n2, d2] = rhs._value;
        const gcd2 = gcd(n2, d2);
        [n2, d2] = [n2 / gcd2, d2 / gcd2];
        return n1 === n2 && d1 === d2;
      } else if (typeof rhs === 'number') {
        return d1 === 1 && n1 === rhs;
      }
      return false;
    }

    if (!this._engine) return undefined;

    const result = evaluateBoolean(this._engine, [
      'Equal',
      this.json,
      typeof rhs === 'number' ? rhs : rhs.json,
    ]);
    if (result === 'True') return true;
    if (result === 'False') return false;
    return undefined;
  }
  isLess(rhs: BoxedExpression): boolean | undefined {
    if (typeof this._value === 'number') {
      if (typeof rhs === 'number') return this._value < rhs;
      else if (rhs instanceof Decimal) return rhs.gt(this._value);

      return false;
    }

    if (this._value instanceof Decimal) {
      if (typeof rhs === 'number' || rhs instanceof Decimal)
        return this._value.lt(rhs);
      return false;
    }

    if (this._value instanceof Complex) {
      return undefined;
    }

    if (Array.isArray(this._value)) {
      let [n1, d1] = this._value;
      const gcd1 = gcd(n1, d1);
      [n1, d1] = [n1 / gcd1, d1 / gcd1];
      if (rhs instanceof BoxedNumber) {
        let [n2, d2] = rhs._value;
        const gcd2 = gcd(n2, d2);
        [n2, d2] = [n2 / gcd2, d2 / gcd2];
        return n1 * d2 < n2 * d1;
      } else if (typeof rhs === 'number') {
        return n1 < rhs * d1;
      }
      return false;
    }

    if (!this._engine) return undefined;

    const result = evaluateBoolean(this._engine, [
      'Less',
      this.json,
      typeof rhs === 'number' ? rhs : rhs.json,
    ]);
    if (result === 'True') return true;
    if (result === 'False') return false;
    return undefined;
  }
  get isInfinity(): boolean | undefined {
    if (typeof this._value === 'number') {
      if (!Number.isFinite(this._value)) return true;
      if (Number.isNaN(this._value)) return undefined;
      return false;
    }

    if (this._value instanceof Decimal) {
      if (!this._value.isFinite()) return true;
      if (this._value.isNaN()) return undefined;
      return false;
    }

    if (this._value instanceof Complex) {
      if (!this._value.isFinite()) return true;
      if (this._value.isNaN()) return undefined;
      return false;
    }

    return undefined;
  }
  get isNumeric(): true {
    return true;
  }
  get isInteger(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'Integer');
  }
  get isRational(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'RationalNumber');
  }
  get isAlgebraic(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'AlgebraicNumber');
  }
  get isReal(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'RealNumber');
  }
  // Real or +-Infinity
  get isExtendedReal(): boolean | undefined {
    return this.isInfinity && this.isReal;
  }
  get isComplex(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'ComplexNumber');
  }
  isElement(_set: BoxedExpression): boolean | undefined {
    return false;
  }
}

/**
 * BoxedSymbol
 */

export class BoxedSymbol extends BoxedExpression {
  protected readonly _value: string;
  private _def: Definition | null | undefined;

  constructor(expr: MathJsonSymbol | string, ce?: ComputeEngine) {
    super(ce);
    if (typeof expr === 'string') this._value = expr;
    else this._value = expr.sym;
  }

  get head(): string {
    return 'Symbol';
  }

  get value(): string {
    return this._value;
  }

  get defValue(): BoxedExpression | undefined {
    const def = this.def;
    if (def && this._engine && 'value' in def) {
      if (typeof def.value === 'function') return box(def.value(this._engine));
      else if (def.value !== undefined) return box(def.value);
    }
    return undefined;
  }

  get def(): Definition | null {
    if (this._def !== undefined) return this._def;
    this._def = this._engine?.getDefinition(this._value) ?? null;
    return this._def;
  }

  get domain(): Domain {
    //
    // 1. Check well-known symbols
    // (this is an optimization to avoid having to query the definition of
    // those symbols)
    //
    // Note that 'ThreeQuarter', 'TwoThird', 'Half', 'Third', 'Quarter'
    // 'Infinity', 'ImaginaryUnit' and 'ComplexInfinity' get boxed so
    // they are never seen as a Boxed Symbol
    //

    if (this._value === 'NaN') return 'Number'; // Yes, `Not A Number` is a `Number`. Bite me.
    if (
      [
        'MinusDoublePi',
        'MinusPi',
        'QuarterPi',
        'ThirdPi',
        'HalfPi',
        'TwoThirdPi',
        'ThreeQuarterPi',
        'Pi',
        'DoublePi',
        'ExponentialE',
      ].includes(this._value)
    ) {
      return 'TranscendentalNumber';
    }

    //
    // 2. Check assumptions about this symbol
    //
    const domains = this._engine?.ask(['Element', this._value, '_domain']);
    if (domains && domains.length > 0) {
      // There should be a single `Element` assumption...
      console.assert(domains.length === 1);
      return domains[0]['domain'];

      // 1.1 Do we have an equality assumption about this symbol?
      // @todo: we could do more:
      // - search for ['Equal', x, '_expr'] and get the domain of expr
      // 1.2 Do we have an inequality assumption about this model?
      // @todo
      // - search for ['Less', x '_expr'], etc... => implies RealNumber
      // @todo! alternative: when calling assume('x > 0'), assume could add
      // an assumption that assume(x, 'RealNumber')
    }

    //
    // 3. Use definition info
    //
    const def = this.def;
    if (def) {
      if (def.domain) return def.domain;
      const defValue = this.defValue;
      if (defValue !== undefined) return defValue.domain;
    }
    return 'Anything';
  }

  get json(): string {
    return this._value;
  }

  get sgn(): -1 | 0 | 1 | undefined {
    if (['MinusDoublePi', 'MinusPi'].includes(this._value)) {
      return -1;
    }
    if (
      [
        'QuarterPi',
        'ThirdPi',
        'HalfPi',
        'TwoThirdPi',
        'ThreeQuarterPi',
        'Pi',
        'DoublePi',
        'MachineEpsilon',
        'CatalanConstant',
        'GoldenRatio',
        'EulerGamma',
        'ExponentialE',
      ].includes(this._value)
    ) {
      return +1;
    }
    const s = this.defValue?.sgn;
    if (s !== undefined) return s;

    if (this._engine) {
      if (checkAssumption(this._engine, ['Equal', this._value, 0])) return 0;
      if (checkAssumption(this._engine, ['Greater', this._value, 0])) return 1;
      if (checkAssumption(this._engine, ['Less', this._value, 0])) return -1;
    }
    return undefined;
  }
  isEqual(rhs: BoxedExpression | string): boolean | undefined {
    if (typeof rhs === 'string') return this._value === rhs;
    if (rhs instanceof BoxedSymbol) return rhs._value === this._value;
    if (this._engine) {
      if (checkAssumption(this._engine, ['Equal', this._value, rhs.json]))
        return true;
      if (checkAssumption(this._engine, ['NotEqual', this._value, rhs.json]))
        return false;
    }
    return undefined;
  }
  isLess(rhs: BoxedExpression): boolean | undefined {
    //
    // 2. Check assumptions
    //
    if (this._engine) {
      const result = evaluateBoolean(this._engine, [
        'Less',
        this._value,
        rhs.json,
      ]);
      if (result === 'True') return true;
      if (result === 'False') return false;
    }
    return undefined;
  }
  get isZero(): boolean | undefined {
    if (this.sgn === 0) return true;
    if (this.sgn !== undefined) return false;
    if (this._engine) {
      if (checkAssumption(this._engine, ['Equal', this._value, 0])) return true;
      if (checkAssumption(this._engine, ['NotEqual', this._value, 0]))
        return false;
      // @todo
      // const match = engine.matchAssumptions(['Greater', expr, '_val']);
      // if (match.some((x) => x._val > 0)) return true;
    }
    return undefined;
  }
  get isNumeric(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'Number');
  }
  get isInfinity(): boolean | undefined {
    if (this.value === 'Infinity' || this.value === 'ComplexInfinity')
      return true;
    // @todo: use def / value
    return false;
  }
  // x > 0
  get isPositive(): boolean | undefined {
    const s = super.isPositive;
    if (s !== undefined) return s;

    if (this._engine) {
      if (checkAssumption(this._engine, ['LessEqual', this._value, 0]))
        return false;
      if (checkAssumption(this._engine, ['Less', this._value, 0])) return false;
      if (checkAssumption(this._engine, ['Greater', this._value, 0]))
        return true;
    }

    // @todo: could use value from def

    return undefined;
  }
  get isInteger(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'Integer');
  }
  get isRational(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'RationalNumber');
  }
  get isAlgebraic(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'AlgebraicNumber');
  }
  get isReal(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'RealNumber');
  }
  // Real or +-Infinity
  get isExtendedReal(): boolean | undefined {
    return this.isInfinity && this.isReal;
  }
  get isComplex(): boolean | undefined {
    return isNumericSubdomain(this.domain, 'ComplexNumber');
  }
  isElement(set: BoxedExpression): boolean | undefined {
    if (!this._engine) return undefined;
    const result = evaluateBoolean(this._engine, [
      'Element',
      this._value,
      set.json,
    ]);
    if (result === 'True') return true;
    if (result === 'False') return false;
    return undefined;
  }
}

/**
 * BoxedString
 */

export class BoxedString extends BoxedExpression {
  private readonly _value: string;
  constructor(expr: string, ce?: ComputeEngine) {
    super(ce);
    this._value = expr;
  }
  get head(): string {
    return 'String';
  }
  get value(): string {
    return this._value;
  }
  get def(): null {
    return null;
  }
  get domain(): 'String' {
    return 'String';
  }
  get json(): MathJsonString {
    return { str: this._value };
  }
  isEqual(rhs: BoxedExpression | number | string): boolean {
    if (!(rhs instanceof BoxedString)) return false;
    return rhs._value === this._value;
  }
}

/**
 * BoxedDictionary
 */

export class BoxedDictionary extends BoxedExpression {
  private _value: { [key: string]: BoxedExpression } = {};
  constructor(
    dict: { [key: string]: BoxedExpression | Expression },
    ce?: ComputeEngine
  ) {
    super(ce);
    for (const key of Object.keys(dict)) {
      this._value[key] = box(dict[key], ce);
    }
  }
  get head(): string {
    return 'Dictionary';
  }
  get(key: string): BoxedExpression | undefined {
    return this._value[key];
  }
  has(key: string): boolean {
    return this._value[key] !== undefined;
  }
  get def(): null {
    return null;
  }
  get domain(): 'Dictionary' {
    return 'Dictionary';
  }
  get json(): MathJsonDictionary {
    const dict = {};
    for (const key of Object.keys(this._value))
      dict[key] = this._value[key].json;
    return { dict };
  }
  apply(
    fn: (x: BoxedExpression) => Expression | BoxedExpression
  ): BoxedDictionary {
    const keys = Object.keys(this._value);
    const result = {};
    for (const key of keys) result[key] = fn(this._value[key]);

    return new BoxedDictionary(result, this._engine);
  }
  isEqual(rhs: BoxedExpression | number | string): boolean {
    if (!(rhs instanceof BoxedDictionary)) return false;
    const keys = Object.keys(this._value);
    if (Object.keys(rhs._value).length !== keys.length) return false;
    for (const key of keys)
      if (!this._value[key].isEqual(rhs._value[key])) return false;
    return true;
  }
}

/**
 * BoxedFunction
 */

export class BoxedFunction extends BoxedExpression {
  private _value: BoxedExpression[];
  private _def: FunctionDefinition | null | undefined;
  constructor(fn: (Expression | BoxedExpression)[], ce?: ComputeEngine) {
    super(ce);
    this._value = fn.map((x) => box(x, ce));
  }
  get head(): string | BoxedExpression {
    return this._value[0] instanceof BoxedSymbol
      ? this._value[0].value
      : this._value[0];
  }
  op(n: number): BoxedExpression | undefined {
    return this._value[n];
  }
  get nops(): number {
    return this._value.length - 1;
  }
  get tail(): Iterable<BoxedExpression> {
    return getTail(this._value);
  }
  get def(): FunctionDefinition | null {
    if (this._def !== undefined) return this._def;
    let def: FunctionDefinition | null = null;
    if (typeof this.head === 'string' && this._engine) {
      def = this._engine.getFunctionDefinition(this.head);
    }
    this._def = def;
    return def;
  }
  get domain(): Domain {
    const def = this.def;
    if (def) {
      let result: Domain | null = null;
      if (this._engine && typeof def.evalDomain === 'function') {
        result = def.evalDomain(
          this._engine,
          ...[...this.tail].map((x) => x.domain)
        );
        if (result) return result;
      }
      if (def.numeric) return 'Number';
    }
    return 'Anything';
  }
  get json(): MathJsonFunction {
    return { fn: this._value.map((x) => x.json) };
  }
  isEqual(rhs: BoxedExpression | number | string): boolean {
    if (!(rhs instanceof BoxedFunction)) return false;
    if (rhs._value.length !== this._value.length) return false;
    for (const [n, arg] of this._value.entries())
      if (arg.isEqual(rhs._value[n]) !== true) return false;
    return true;
  }
  get sgn(): -1 | 0 | 1 | undefined {
    const head = this.head;
    if (head === 'Negate') {
      const s = this._value[1]?.sgn;
      if (s === undefined) return undefined;
      return -s as -1 | 0 | 1;
    }
    if (head === 'Multiply') {
      const total = [...this.tail].reduce((acc, x) => acc * (x.sgn ?? NaN), 0);
      if (isNaN(total)) return undefined;
      if (total > 0) return 1;
      if (total < 0) return -1;
      return 0;
    }
    if (head === 'Add') {
      return [...this.tail].every((x) => (x.sgn ?? -1) > 0) ? 1 : undefined;
    }
    if (head === 'Divide') {
      const n = this._value[1]?.sgn;
      const d = this._value[2]?.sgn;
      if (n === undefined || d === undefined) return undefined;
      if (n === 0) return 0;
      if ((n > 0 && d > 0) || (n < 0 && d < 0)) return +1;
      return -1;
    }
    if (head === 'Square') {
      if (this._value[1]?.isComplex) return undefined;
      if (this._value[1]?.isZero) return 0;
      return +1;
    }
    // @todo: more functions...
    if (head === 'Exp') {
    }
    if (head === 'Ln') {
    }

    return undefined;
  }
  *map<T = BoxedExpression>(
    fn: (x: BoxedExpression) => T
  ): IterableIterator<T> {
    let i = 1;
    while (i < this._value.length) yield fn(this._value[i++]);
  }
  apply(
    fn: (x: BoxedExpression) => Expression | BoxedExpression
  ): BoxedFunction {
    return new BoxedFunction(this._value.map(fn), this._engine);
  }
}

function* getTail(expr: BoxedExpression[]) {
  let i = 1;
  while (expr[i]) yield expr[i++];
}
