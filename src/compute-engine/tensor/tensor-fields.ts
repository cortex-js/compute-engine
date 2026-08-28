import { Complex } from 'complex-esm';
import '../numerics/complex-esm-augment.js'; // adds the 1-arg `Complex.equals` overload
import {
  Expression,
  IComputeEngine as ComputeEngine,
  DataTypeMap,
  TensorDataType,
  TensorField,
} from '../global-types.js';
import { isSymbol, isNumber } from '../boxed-expression/type-guards.js';
import { stripNumericRanges } from '../../common/type/utils.js';
import { isComplexInfinityValue } from '../../common/type/types.js';

// Lazy reference to the n-ary `add()` from arithmetic-add.ts, registered by
// `init-lazy-refs.ts` — a static import here would close a dependency cycle
// (arithmetic-add → … → tensor-view → tensor-fields).
let _addN: ((...xs: Expression[]) => Expression) | undefined;
export function _setFieldAddN(fn: (...xs: Expression[]) => Expression): void {
  _addN = fn;
}

/** @category Tensors */
export function makeTensorField<DT extends keyof DataTypeMap>(
  ce: ComputeEngine,
  dtype: DT
): TensorField<DataTypeMap[DT]> {
  switch (dtype) {
    case 'float64':
    case 'float32':
    case 'int32':
    case 'uint8':
      return new TensorFieldNumber(ce) as unknown as TensorField<
        DataTypeMap[DT]
      >;
    case 'complex128':
    case 'complex64':
      return new TensorFieldComplex(ce) as unknown as TensorField<
        DataTypeMap[DT]
      >;
    case 'bool':
    // case 'string':
    case 'expression':
      return new TensorFieldExpression(ce) as unknown as TensorField<
        DataTypeMap[DT]
      >;
    case undefined:
      return new TensorFieldNumber(ce) as unknown as TensorField<
        DataTypeMap[DT]
      >;
  }

  throw new Error(`Unknown dtype ${dtype}`);
}

/** @category Tensors */
export class TensorFieldNumber implements TensorField<number> {
  one = 1;
  zero = 0;
  nan = NaN;

  constructor(private ce: ComputeEngine) {}

  cast(x: number, dtype: 'float64'): undefined | number;
  cast(x: number, dtype: 'float32'): undefined | number;
  cast(x: number, dtype: 'int32'): undefined | number;
  cast(x: number, dtype: 'uint8'): undefined | number;
  cast(x: number, dtype: 'complex128'): undefined | Complex;
  cast(x: number, dtype: 'complex64'): undefined | Complex;
  cast(x: number, dtype: 'bool'): undefined | boolean;
  // cast(x: number, dtype: 'string'): undefined | string;
  cast(x: number, dtype: 'expression'): undefined | Expression;
  cast(x: number[], dtype: 'float64'): undefined | number[];
  cast(x: number[], dtype: 'float32'): undefined | number[];
  cast(x: number[], dtype: 'int32'): undefined | number[];
  cast(x: number[], dtype: 'uint8'): undefined | number[];
  cast(x: number[], dtype: 'complex128'): undefined | Complex[];
  cast(x: number[], dtype: 'complex64'): undefined | Complex[];
  cast(x: number[], dtype: 'bool'): undefined | boolean[];
  // cast(x: number[], dtype: 'string'): undefined | string[];
  cast(x: number[], dtype: 'expression'): undefined | Expression[];
  cast(
    x: number | number[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    // | string
    | Expression
    | Complex[]
    | number[]
    | boolean[]
    // | string[]
    | Expression[] {
    const ce = this.ce;
    switch (dtype) {
      case 'float64':
      case 'float32':
      case 'int32':
      case 'uint8':
        return x;
      case 'complex128':
      case 'complex64':
        return Array.isArray(x)
          ? x.map((x) => ce.complex(x))
          : this.ce.complex(x);
      case 'bool':
        return Array.isArray(x)
          ? x.map((x) => (x === 0 ? false : true))
          : x === 0
            ? false
            : true;
      // case 'string':
      //   return Array.isArray(x)
      //     ? x.map((x) => Number(x).toString())
      //     : Number(x).toString();
      case 'expression':
        return Array.isArray(x) ? x.map((x) => ce.number(x)) : ce.number(x);
    }
    throw new Error(`Cannot cast ${x} to ${dtype}`);
  }

  expression(x: number): Expression {
    return this.ce.number(x);
  }

  isZero(x: number): boolean {
    return x === 0;
  }

  isOne(x: number): boolean {
    return x === 1;
  }

  equals(lhs: number, rhs: number): boolean {
    return lhs === rhs;
  }

  add(lhs: number, rhs: number): number {
    return lhs + rhs;
  }

  addn(...xs: number[]): number {
    return xs.reduce((a, b) => a + b, 0);
  }

  neg(x: number): number {
    return -x;
  }

  sub(lhs: number, rhs: number): number {
    return lhs - rhs;
  }

  mul(lhs: number, rhs: number): number {
    return lhs * rhs;
  }

  muln(...xs: number[]): number {
    return xs.reduce((a, b) => a * b, 1);
  }

  div(lhs: number, rhs: number): number {
    return lhs / rhs;
  }

  pow(lhs: number, rhs: number): number {
    return lhs ** rhs;
  }

  conjugate(x: number): number {
    return x;
  }
}

/** @category Tensors */
export class TensorFieldExpression implements TensorField<Expression> {
  one: Expression;
  zero: Expression;
  nan: Expression;

  private ce: ComputeEngine;

  constructor(ce: ComputeEngine) {
    this.one = ce.One;
    this.zero = ce.Zero;
    this.nan = ce.NaN;
    this.ce = ce;
  }

  cast(x: Expression, dtype: 'float64'): undefined | number;
  cast(x: Expression, dtype: 'float32'): undefined | number;
  cast(x: Expression, dtype: 'int32'): undefined | number;
  cast(x: Expression, dtype: 'uint8'): undefined | number;
  cast(x: Expression, dtype: 'complex128'): undefined | Complex;
  cast(x: Expression, dtype: 'complex64'): undefined | Complex;
  cast(x: Expression, dtype: 'bool'): undefined | boolean;
  // cast(x: Expression, dtype: 'string'): undefined | string;
  cast(x: Expression, dtype: 'expression'): undefined | Expression;
  cast(x: Expression[], dtype: 'float64'): undefined | number[];
  cast(x: Expression[], dtype: 'float32'): undefined | number[];
  cast(x: Expression[], dtype: 'int32'): undefined | number[];
  cast(x: Expression[], dtype: 'uint8'): undefined | number[];
  cast(x: Expression[], dtype: 'complex128'): undefined | Complex[];
  cast(x: Expression[], dtype: 'complex64'): undefined | Complex[];
  cast(x: Expression[], dtype: 'bool'): undefined | boolean[];
  // cast(x: Expression[], dtype: 'string'): undefined | string[];
  cast(x: Expression[], dtype: 'expression'): undefined | Expression[];
  cast(
    x: Expression | Expression[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    // | string
    | Expression
    | Complex[]
    | number[]
    | boolean[]
    // | string[]
    | Expression[] {
    if (Array.isArray(x)) {
      switch (dtype) {
        case 'float64':
          return x.map((item) => this.cast(item, 'float64')!);
        case 'float32':
          return x.map((item) => this.cast(item, 'float32')!);
        case 'int32':
          return x.map((item) => this.cast(item, 'int32')!);
        case 'uint8':
          return x.map((item) => this.cast(item, 'uint8')!);
        case 'complex128':
          return x.map((item) => this.cast(item, 'complex128')!);
        case 'complex64':
          return x.map((item) => this.cast(item, 'complex64')!);
        case 'bool':
          return x.map((item) => this.cast(item, 'bool')!);
        case 'expression':
          return x.map((item) => this.cast(item, 'expression')!);
      }
    }

    switch (dtype) {
      case 'float64':
      case 'float32':
        return x.im === 0 ? x.re : undefined;

      case 'int32':
        return typeof x.re === 'number' ? Math.round(x.re) : undefined;

      case 'uint8':
        if (typeof x.re !== 'number') return undefined;
        const i = Math.round(x.re);
        return i >= 0 && i <= 255 ? i : undefined;

      case 'complex128':
      case 'complex64':
        const [re, im] = [x.re, x.im];
        if (typeof re === 'number' && typeof im === 'number')
          return this.ce.complex(re, im);

        if (typeof re === 'number') return this.ce.complex(re);
        return undefined;

      case 'bool':
        const bool = x.valueOf();
        return typeof bool === 'boolean' ? bool : undefined;

      // case 'string':
      //   const str = x.valueOf();
      //   if (typeof str === 'string') return str;
      //   if (typeof str === 'number') return str.toString();
      //   if (typeof str === 'boolean') return str.toString();
      //   return undefined;

      case 'expression':
        return x;
    }
    throw new Error(`Cannot cast ${x} to ${dtype}`);
  }

  expression(x: Expression): Expression {
    return x;
  }
  isZero(x: Expression): boolean {
    return x.isSame(0);
  }

  isOne(x: Expression): boolean {
    return x.isSame(1);
  }

  equals(lhs: Expression, rhs: Expression): boolean {
    return lhs.isSame(rhs) === true;
  }

  add(lhs: Expression, rhs: Expression): Expression {
    return lhs.add(rhs);
  }

  addn(...xs: Expression[]): Expression {
    // n-ary `add()` in one pass, not an incremental `reduce(.add)`: the
    // accumulator re-canonicalizes the growing sum at every step (quadratic
    // in the number of terms — e.g. the trace of an n×n symbolic matrix).
    // Same semantics as chained `.add()` (like-term collection included,
    // which the symbolic determinant's expanded form relies on).
    if (xs.length === 0) return this.zero;
    if (xs.length === 1) return xs[0];
    if (_addN) return _addN(...xs);
    return xs.reduce((a, b) => a.add(b), this.zero);
  }

  neg(x: Expression): Expression {
    return x.neg();
  }

  sub(lhs: Expression, rhs: Expression): Expression {
    return lhs.sub(rhs);
  }

  mul(lhs: Expression, rhs: Expression): Expression {
    return lhs.mul(rhs);
  }

  muln(...xs: Expression[]): Expression {
    // Deliberately incremental: `mul()` distributes over sums, and the
    // 3×3 symbolic determinant (and through it `CharacteristicPolynomial`)
    // relies on that expansion. Call sites pass at most a handful of
    // factors, so the per-step re-canonicalization stays cheap — do not
    // convert to a one-shot `Multiply` (it would keep products factored).
    return xs.reduce((a, b) => a.mul(b), this.one);
  }

  div(lhs: Expression, rhs: Expression): Expression {
    return lhs.div(rhs);
  }

  pow(lhs: Expression, rhs: number): Expression {
    return lhs.pow(rhs);
  }

  conjugate(x: Expression): Expression {
    return this.ce.function('Conjugate', [x]).evaluate();
  }
}

/** @category Tensors */
export class TensorFieldComplex implements TensorField<Complex> {
  one: Complex;
  zero: Complex;
  nan: Complex;

  private ce: ComputeEngine;

  constructor(ce: ComputeEngine) {
    this.ce = ce;
    this.one = ce.complex(1);
    this.zero = ce.complex(0);
    this.nan = ce.complex(NaN);
  }

  cast(x: Complex, dtype: 'float64'): undefined | number;
  cast(x: Complex, dtype: 'float32'): undefined | number;
  cast(x: Complex, dtype: 'int32'): undefined | number;
  cast(x: Complex, dtype: 'uint8'): undefined | number;
  cast(x: Complex, dtype: 'complex128'): undefined | Complex;
  cast(x: Complex, dtype: 'complex64'): undefined | Complex;
  cast(x: Complex, dtype: 'bool'): undefined | boolean;
  // cast(x: Complex, dtype: 'string'): undefined | string;
  cast(x: Complex, dtype: 'expression'): undefined | Expression;
  cast(x: Complex[], dtype: 'float64'): undefined | number[];
  cast(x: Complex[], dtype: 'float32'): undefined | number[];
  cast(x: Complex[], dtype: 'int32'): undefined | number[];
  cast(x: Complex[], dtype: 'uint8'): undefined | number[];
  cast(x: Complex[], dtype: 'complex128'): undefined | Complex[];
  cast(x: Complex[], dtype: 'complex64'): undefined | Complex[];
  cast(x: Complex[], dtype: 'bool'): undefined | boolean[];
  // cast(x: Complex[], dtype: 'string'): undefined | string[];
  cast(x: Complex[], dtype: 'expression'): undefined | Expression[];
  cast(
    x: Complex | Complex[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    // | string
    | Expression
    | Complex[]
    | number[]
    | boolean[]
    // | string[]
    | Expression[] {
    if (Array.isArray(x)) {
      switch (dtype) {
        case 'float64':
          return x.map((item) => this.cast(item, 'float64')!);
        case 'float32':
          return x.map((item) => this.cast(item, 'float32')!);
        case 'int32':
          return x.map((item) => this.cast(item, 'int32')!);
        case 'uint8':
          return x.map((item) => this.cast(item, 'uint8')!);
        case 'complex128':
          return x.map((item) => this.cast(item, 'complex128')!);
        case 'complex64':
          return x.map((item) => this.cast(item, 'complex64')!);
        case 'bool':
          return x.map((item) => this.cast(item, 'bool')!);
        case 'expression':
          return x.map((item) => this.cast(item, 'expression')!);
      }
    }
    switch (dtype) {
      case 'float64':
        return x.im === 0 ? x.re : undefined;
      case 'float32':
        return x.im === 0 ? x.re : undefined;
      case 'int32':
        return x.im === 0 ? Math.round(x.re) : undefined;
      case 'uint8':
        if (x.im !== 0) return undefined;
        const i = Math.round(x.re);
        return i >= 0 && i <= 255 ? i : undefined;
      case 'complex128':
        return x;
      case 'complex64':
        return x;
      case 'bool':
        return x.im === 0 && x.re === 0 ? false : true;
      // case 'string':
      //   return x.toString();
      case 'expression':
        return this.ce.number(x);
    }
    throw new Error(`Cannot cast ${x} to ${dtype}`);
  }

  expression(z: Complex): Expression {
    return this.ce.number(z);
  }

  isZero(z: Complex): boolean {
    return z.isZero();
  }

  isOne(z: Complex): boolean {
    return z.re === 1 && z.im === 0;
  }

  equals(lhs: Complex, rhs: Complex): boolean {
    return lhs.equals(rhs);
  }

  add(lhs: Complex, rhs: Complex): Complex {
    return lhs.add(rhs);
  }

  addn(...xs: Complex[]): Complex {
    return xs.reduce((a, b) => a.add(b), this.zero);
  }

  neg(z: Complex): Complex {
    return z.neg();
  }

  sub(lhs: Complex, rhs: Complex): Complex {
    return lhs.sub(rhs);
  }

  mul(lhs: Complex, rhs: Complex): Complex {
    return lhs.mul(rhs);
  }

  muln(...xs: Complex[]): Complex {
    return xs.reduce((a, b) => a.mul(b), this.one);
  }

  div(lhs: Complex, rhs: Complex): Complex {
    return lhs.div(rhs);
  }

  pow(lhs: Complex, rhs: number): Complex {
    return lhs.pow(rhs);
  }

  conjugate(z: Complex): Complex {
    return z.conjugate();
  }
}

/**
 * @category Tensors
 * @internal
 */
export function getSupertype(
  t1: TensorDataType | undefined,
  t2: TensorDataType
): TensorDataType {
  if (t1 === undefined) return t2;
  // Of the two types, return the one which is the most generic, i.e.
  // the least upper bound (LUB) or supertype.
  // If the two types are incompatible, return undefined.
  if (t1 === t2) return t1;

  if (t1 === 'expression' || t2 === 'expression') return 'expression';
  // if (t1 === 'string' || t2 === 'string') return 'expression';
  if (t1 === 'complex128' || t2 === 'complex128') return 'complex128';
  if (t1 === 'complex64' || t2 === 'complex64') {
    // complex64 has 32-bit components; joining with a 64-bit real (float64)
    // needs 64-bit components to avoid precision loss → complex128.
    if (t1 === 'float64' || t2 === 'float64') return 'complex128';
    return 'complex64';
  }
  if (t1 === 'float64' || t2 === 'float64') return 'float64';
  if (t1 === 'float32' || t2 === 'float32') return 'float32';
  if (t1 === 'int32' || t2 === 'int32') return 'int32';
  if (t1 === 'uint8' || t2 === 'uint8') return 'uint8';
  if (t1 === 'bool' || t2 === 'bool') return 'bool';
  return 'expression';
}

/**
 * If the expression is a literal number, return the datatype of the
 * number (or boolean). Otherwise, return the `expression`.
 *
 * @category Tensors
 * @internal
 */

export function getExpressionDatatype(expr: Expression): TensorDataType {
  // Depending on whether the expr is a literal number, a string, etc,
  // return the appropriate datatype.

  if (isSymbol(expr)) {
    if (expr.symbol === 'True' || expr.symbol === 'False') return 'bool';
    if (expr.symbol === 'NaN') return 'float64';
    if (expr.symbol === 'PositiveInfinity') return 'float64';
    if (expr.symbol === 'NegativeInfinity') return 'float64';
    if (expr.symbol === 'ComplexInfinity') return 'complex128';
    if (expr.symbol === 'ImaginaryUnit') return 'complex128';
  }

  if (isNumber(expr)) {
    // A literal's public type carries its value or an enclosing range since
    // ruling O9 (`5`, `rational<0.5..0.5>`, `real<1.4..1.5>`) — an OBJECT
    // node, which a string switch would send to the `expression` dtype,
    // silently demoting every numeric tensor to the exact field (`.N()` then
    // kept rationals, `MatrixRank` stayed inert). Project the decoration back
    // to its bare tier first; a type that is not a decorated numeric tier
    // passes through unchanged.
    const tier = stripNumericRanges(expr.type.type);

    // The unsigned complex infinity `~oo` is the one numeric literal whose
    // type is a value node that `stripNumericRanges` does NOT project to a
    // tier: it has no JavaScript number to stand for it, so it keeps the
    // `COMPLEX_INFINITY_VALUE` sentinel. Handled here, ahead of the switch,
    // because the `infinity` tier below is now the SIGNED pair alone: without
    // this test `~oo` would reach the `expression` default silently, and a
    // later reader would have no way to tell that storage class was chosen on
    // purpose. `expression` is the right field for it — no numeric buffer
    // holds an unsigned infinity.
    if (
      typeof tier === 'object' &&
      tier.kind === 'value' &&
      isComplexInfinityValue(tier.value)
    )
      return 'expression';

    switch (typeof tier === 'string' ? tier : 'expression') {
      case 'real':
      case 'rational':
        // Preserve exactness: an exact rational (½) or radical (√2) stored as
        // float64 would lose precision, so it uses the `expression` dtype. An
        // inexact (machine/decimal) value uses float64.
        return expr.isExact ? 'expression' : 'float64';

      case 'integer': {
        // The narrowest integer storage class that holds this value. A cell
        // read inside a broadcast window carries the bare `integer` tier with
        // no value behind it, so `expr.re` is not a finite number there:
        // float64 is the storage class that holds any integer, and it is the
        // fallback for that valueless case. An integer outside the safely
        // representable range (|n| > 2^53) would be truncated in a
        // float64-backed buffer, so it is preserved exactly via the
        // `expression` dtype (mirrors the exact rational/real case above).
        const val = expr.re;
        if (!Number.isFinite(val)) return 'float64';
        if (!Number.isSafeInteger(val)) return 'expression';
        return val >= 0 && val <= 255 ? 'uint8' : 'int32';
      }

      // The non-finite tiers, all of them a signed `±oo` or a NaN by the time
      // they arrive here — `~oo` was returned above. Two spellings reach this
      // point for the same values: `stripNumericRanges` projects the `+oo` and
      // `-oo` VALUE nodes to `infinity`, while a read inside a broadcast cell,
      // where the literal type is withheld, sees the bare tiers `nan` and
      // `non_finite_number` instead. All three are held exactly by a float64,
      // which is how the `NaN` / `PositiveInfinity` / `NegativeInfinity`
      // named constants at the top of this function are classified too.
      // Sending `infinity` to `complex128` promoted a real tensor such as
      // `[1, +oo]` to the complex field for no gain.
      case 'nan':
      case 'non_finite_number':
      case 'infinity':
        return 'float64';

      case 'complex':
      case 'imaginary':
        return 'complex128';

      default:
        return 'expression';
    }
  }

  return 'expression';
}
