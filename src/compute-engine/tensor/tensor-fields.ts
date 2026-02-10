import { Complex } from 'complex-esm';
import {
  BoxedExpression,
  IComputeEngine as ComputeEngine,
  DataTypeMap,
  TensorDataType,
  TensorField,
} from '../global-types';
import { isBoxedSymbol, isBoxedNumber } from '../boxed-expression/type-guards';

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
  cast(x: number, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: number[], dtype: 'float64'): undefined | number[];
  cast(x: number[], dtype: 'float32'): undefined | number[];
  cast(x: number[], dtype: 'int32'): undefined | number[];
  cast(x: number[], dtype: 'uint8'): undefined | number[];
  cast(x: number[], dtype: 'complex128'): undefined | Complex[];
  cast(x: number[], dtype: 'complex64'): undefined | Complex[];
  cast(x: number[], dtype: 'bool'): undefined | boolean[];
  // cast(x: number[], dtype: 'string'): undefined | string[];
  cast(x: number[], dtype: 'expression'): undefined | BoxedExpression[];
  cast(
    x: number | number[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    // | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    // | string[]
    | BoxedExpression[] {
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

  expression(x: number): BoxedExpression {
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
export class TensorFieldExpression implements TensorField<BoxedExpression> {
  one: BoxedExpression;
  zero: BoxedExpression;
  nan: BoxedExpression;

  private ce: ComputeEngine;

  constructor(ce: ComputeEngine) {
    this.one = ce.One;
    this.zero = ce.Zero;
    this.nan = ce.NaN;
    this.ce = ce;
  }

  cast(x: BoxedExpression, dtype: 'float64'): undefined | number;
  cast(x: BoxedExpression, dtype: 'float32'): undefined | number;
  cast(x: BoxedExpression, dtype: 'int32'): undefined | number;
  cast(x: BoxedExpression, dtype: 'uint8'): undefined | number;
  cast(x: BoxedExpression, dtype: 'complex128'): undefined | Complex;
  cast(x: BoxedExpression, dtype: 'complex64'): undefined | Complex;
  cast(x: BoxedExpression, dtype: 'bool'): undefined | boolean;
  // cast(x: BoxedExpression, dtype: 'string'): undefined | string;
  cast(x: BoxedExpression, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: BoxedExpression[], dtype: 'float64'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'float32'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'int32'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'uint8'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'complex128'): undefined | Complex[];
  cast(x: BoxedExpression[], dtype: 'complex64'): undefined | Complex[];
  cast(x: BoxedExpression[], dtype: 'bool'): undefined | boolean[];
  // cast(x: BoxedExpression[], dtype: 'string'): undefined | string[];
  cast(
    x: BoxedExpression[],
    dtype: 'expression'
  ): undefined | BoxedExpression[];
  cast(
    x: BoxedExpression | BoxedExpression[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    // | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    // | string[]
    | BoxedExpression[] {
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

  expression(x: BoxedExpression): BoxedExpression {
    return x;
  }
  isZero(x: BoxedExpression): boolean {
    return x.is(0);
  }

  isOne(x: BoxedExpression): boolean {
    return x.is(1);
  }

  equals(lhs: BoxedExpression, rhs: BoxedExpression): boolean {
    return lhs.isSame(rhs) === true;
  }

  add(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return lhs.add(rhs);
  }

  addn(...xs: BoxedExpression[]): BoxedExpression {
    return xs.reduce((a, b) => a.add(b), this.zero);
  }

  neg(x: BoxedExpression): BoxedExpression {
    return x.neg();
  }

  sub(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return lhs.sub(rhs);
  }

  mul(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return lhs.mul(rhs);
  }

  muln(...xs: BoxedExpression[]): BoxedExpression {
    return xs.reduce((a, b) => a.mul(b), this.one);
  }

  div(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return lhs.div(rhs);
  }

  pow(lhs: BoxedExpression, rhs: number): BoxedExpression {
    return lhs.pow(rhs);
  }

  conjugate(x: BoxedExpression): BoxedExpression {
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
  cast(x: Complex, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: Complex[], dtype: 'float64'): undefined | number[];
  cast(x: Complex[], dtype: 'float32'): undefined | number[];
  cast(x: Complex[], dtype: 'int32'): undefined | number[];
  cast(x: Complex[], dtype: 'uint8'): undefined | number[];
  cast(x: Complex[], dtype: 'complex128'): undefined | Complex[];
  cast(x: Complex[], dtype: 'complex64'): undefined | Complex[];
  cast(x: Complex[], dtype: 'bool'): undefined | boolean[];
  // cast(x: Complex[], dtype: 'string'): undefined | string[];
  cast(x: Complex[], dtype: 'expression'): undefined | BoxedExpression[];
  cast(
    x: Complex | Complex[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    // | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    // | string[]
    | BoxedExpression[] {
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

  expression(z: Complex): BoxedExpression {
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
  if (t1 === 'complex64' || t2 === 'complex64') return 'complex64';
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

export function getExpressionDatatype(expr: BoxedExpression): TensorDataType {
  // Depending on whether the expr is a literal number, a string, etc,
  // return the appropriate datatype.

  if (isBoxedSymbol(expr)) {
    if (expr.symbol === 'True' || expr.symbol === 'False') return 'bool';
    if (expr.symbol === 'NaN') return 'float64';
    if (expr.symbol === 'PositiveInfinity') return 'float64';
    if (expr.symbol === 'NegativeInfinity') return 'float64';
    if (expr.symbol === 'ComplexInfinity') return 'complex128';
    if (expr.symbol === 'ImaginaryUnit') return 'complex128';
  }

  if (isBoxedNumber(expr))
    switch (expr.type.type) {
      case 'real':
      case 'rational':
      case 'finite_real':
      case 'finite_rational':
      case 'integer': // For NaN, Infinity, etc
        return 'float64';

      case 'complex':
      case 'finite_complex':
      case 'imaginary':
        return 'complex128';

      case 'finite_integer': {
        const val = expr.re;
        if (val >= 0 && val <= 255) return 'uint8';
        return 'int32';
      }
      default:
        return 'expression';
    }

  return 'expression';
}
