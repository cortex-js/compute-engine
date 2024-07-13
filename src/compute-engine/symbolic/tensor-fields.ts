import Complex from 'complex.js';
import { BoxedExpression, IComputeEngine } from '../public';

export type DataTypeMap = {
  float64: number;
  float32: number;
  int32: number;
  uint8: number;
  complex128: Complex;
  complex64: Complex;
  bool: boolean;
  string: string;
  expression: BoxedExpression;
};

export type TensorDataType = keyof DataTypeMap;

export function makeTensorField<DT extends keyof DataTypeMap>(
  ce: IComputeEngine,
  dtype: DT
): TensorField<DataTypeMap[DT]> {
  switch (dtype) {
    case 'float64':
    case 'float32':
    case 'int32':
    case 'uint8':
      return new TensorFieldNumber(ce) as any as TensorField<DataTypeMap[DT]>;
    case 'complex128':
    case 'complex64':
      return new TensorFieldComplex(ce) as any as TensorField<DataTypeMap[DT]>;
    case 'bool':
    case 'string':
    case 'expression':
      return new TensorFieldExpression(ce) as any as TensorField<
        DataTypeMap[DT]
      >;
  }
  throw new Error(`Unknown dtype ${dtype}`);
}

export interface TensorField<
  T extends number | Complex | BoxedExpression | boolean | string = number,
> {
  readonly one: T;
  readonly zero: T;
  readonly nan: T;

  cast(x: T, dtype: 'float64'): undefined | number;
  cast(x: T, dtype: 'float32'): undefined | number;
  cast(x: T, dtype: 'int32'): undefined | number;
  cast(x: T, dtype: 'uint8'): undefined | number;
  cast(x: T, dtype: 'complex128'): undefined | Complex;
  cast(x: T, dtype: 'complex64'): undefined | Complex;
  cast(x: T, dtype: 'bool'): undefined | boolean;
  cast(x: T, dtype: 'string'): undefined | string;
  cast(x: T, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: T[], dtype: 'float64'): undefined | number[];
  cast(x: T[], dtype: 'float32'): undefined | number[];
  cast(x: T[], dtype: 'int32'): undefined | number[];
  cast(x: T[], dtype: 'uint8'): undefined | number[];
  cast(x: T[], dtype: 'complex128'): undefined | Complex[];
  cast(x: T[], dtype: 'complex64'): undefined | Complex[];
  cast(x: T[], dtype: 'bool'): undefined | boolean[];
  cast(x: T[], dtype: 'string'): undefined | string[];
  cast(x: T[], dtype: 'expression'): undefined | BoxedExpression[];
  cast(
    x: T | T[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    | string[]
    | BoxedExpression[];

  // Synonym for `cast(x, 'expression')`
  expression(x: T): BoxedExpression;

  isZero(x: T): boolean;
  isOne(x: T): boolean;

  equals(lhs: T, rhs: T): boolean;

  add(lhs: T, rhs: T): T;
  addn(...xs: T[]): T;
  neg(x: T): T;
  sub(lhs: T, rhs: T): T;
  mul(lhs: T, rhs: T): T;
  muln(...xs: T[]): T;
  div(lhs: T, rhs: T): T;
  pow(rhs: T, n: number): T;
  conjugate(x: T): T;
}

export class TensorFieldNumber implements TensorField<number> {
  one = 1;
  zero = 0;
  nan = NaN;

  constructor(private ce: IComputeEngine) {}

  cast(x: number, dtype: 'float64'): undefined | number;
  cast(x: number, dtype: 'float32'): undefined | number;
  cast(x: number, dtype: 'int32'): undefined | number;
  cast(x: number, dtype: 'uint8'): undefined | number;
  cast(x: number, dtype: 'complex128'): undefined | Complex;
  cast(x: number, dtype: 'complex64'): undefined | Complex;
  cast(x: number, dtype: 'bool'): undefined | boolean;
  cast(x: number, dtype: 'string'): undefined | string;
  cast(x: number, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: number[], dtype: 'float64'): undefined | number[];
  cast(x: number[], dtype: 'float32'): undefined | number[];
  cast(x: number[], dtype: 'int32'): undefined | number[];
  cast(x: number[], dtype: 'uint8'): undefined | number[];
  cast(x: number[], dtype: 'complex128'): undefined | Complex[];
  cast(x: number[], dtype: 'complex64'): undefined | Complex[];
  cast(x: number[], dtype: 'bool'): undefined | boolean[];
  cast(x: number[], dtype: 'string'): undefined | string[];
  cast(x: number[], dtype: 'expression'): undefined | BoxedExpression[];
  cast(
    x: number | number[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    | string[]
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
      case 'string':
        return Array.isArray(x)
          ? x.map((x) => Number(x).toString())
          : Number(x).toString();
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

export class TensorFieldExpression implements TensorField<BoxedExpression> {
  one: BoxedExpression;
  zero: BoxedExpression;
  nan: BoxedExpression;

  private ce: IComputeEngine;

  constructor(ce: IComputeEngine) {
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
  cast(x: BoxedExpression, dtype: 'string'): undefined | string;
  cast(x: BoxedExpression, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: BoxedExpression[], dtype: 'float64'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'float32'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'int32'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'uint8'): undefined | number[];
  cast(x: BoxedExpression[], dtype: 'complex128'): undefined | Complex[];
  cast(x: BoxedExpression[], dtype: 'complex64'): undefined | Complex[];
  cast(x: BoxedExpression[], dtype: 'bool'): undefined | boolean[];
  cast(x: BoxedExpression[], dtype: 'string'): undefined | string[];
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
    | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    | string[]
    | BoxedExpression[] {
    if (Array.isArray(x)) {
      return x.map((x) => this.cast(x, dtype as any)!);
    }
    const v = x.value;
    switch (dtype) {
      case 'float64':
      case 'float32':
        return typeof v === 'number' ? v : undefined;
      case 'int32':
        return typeof v === 'number' ? Math.round(v) : undefined;
      case 'uint8':
        if (typeof v !== 'number') return undefined;
        const i = Math.round(v);
        return i >= 0 && i <= 255 ? i : undefined;
      case 'complex128':
      case 'complex64':
        if (typeof v === 'number') return this.ce.complex(v);
        const n = x.numericValue;
        if (n instanceof Complex) return n;
        return undefined;
      case 'bool':
        return typeof v === 'boolean' ? v : undefined;
      case 'string':
        return typeof v === 'string' ? v : undefined;
      case 'expression':
        return x;
    }
    throw new Error(`Cannot cast ${x} to ${dtype}`);
  }

  expression(x: BoxedExpression): BoxedExpression {
    return x;
  }

  isZero(x: BoxedExpression): boolean {
    return x.isZero ?? false;
  }

  isOne(x: BoxedExpression): boolean {
    return x.isOne ?? false;
  }

  equals(lhs: BoxedExpression, rhs: BoxedExpression): boolean {
    return lhs.isEqual(rhs);
  }

  add(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return this.ce.add(lhs, rhs);
  }

  addn(...xs: BoxedExpression[]): BoxedExpression {
    return this.ce.add(...xs);
  }

  neg(x: BoxedExpression): BoxedExpression {
    return x.neg();
  }

  sub(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return this.ce.add(lhs, rhs.neg());
  }

  mul(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return this.ce.evalMul(lhs, rhs);
  }

  muln(...xs: BoxedExpression[]): BoxedExpression {
    return this.ce.evalMul(...xs);
  }

  div(lhs: BoxedExpression, rhs: BoxedExpression): BoxedExpression {
    return this.ce.div(lhs, rhs);
  }

  pow(lhs: BoxedExpression, rhs: number): BoxedExpression {
    return this.ce.pow(lhs, rhs);
  }

  conjugate(x: BoxedExpression): BoxedExpression {
    return this.ce.box(['Conjugate', x]);
  }
}

export class TensorFieldComplex implements TensorField<Complex> {
  one: Complex;
  zero: Complex;
  nan: Complex;

  private ce: IComputeEngine;

  constructor(ce: IComputeEngine) {
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
  cast(x: Complex, dtype: 'string'): undefined | string;
  cast(x: Complex, dtype: 'expression'): undefined | BoxedExpression;
  cast(x: Complex[], dtype: 'float64'): undefined | number[];
  cast(x: Complex[], dtype: 'float32'): undefined | number[];
  cast(x: Complex[], dtype: 'int32'): undefined | number[];
  cast(x: Complex[], dtype: 'uint8'): undefined | number[];
  cast(x: Complex[], dtype: 'complex128'): undefined | Complex[];
  cast(x: Complex[], dtype: 'complex64'): undefined | Complex[];
  cast(x: Complex[], dtype: 'bool'): undefined | boolean[];
  cast(x: Complex[], dtype: 'string'): undefined | string[];
  cast(x: Complex[], dtype: 'expression'): undefined | BoxedExpression[];
  cast(
    x: Complex | Complex[],
    dtype: TensorDataType
  ):
    | undefined
    | Complex
    | number
    | boolean
    | string
    | BoxedExpression
    | Complex[]
    | number[]
    | boolean[]
    | string[]
    | BoxedExpression[] {
    if (Array.isArray(x)) {
      return x.map((x) => this.cast(x, dtype as any)!);
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
      case 'string':
        return x.toString();
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

export function getSupertype(
  t1: TensorDataType,
  t2: TensorDataType
): TensorDataType {
  // Of the two types, return the one which is the most generic, i.e.
  // the least upper bound (LUB) or supertype
  // If the two types are incompatible, return undefined
  if (t1 === t2) return t1;

  if (t1 === 'string' || t2 === 'string') return 'expression';
  if (t1 === 'expression' || t2 === 'expression') return 'expression';
  if (t1 === 'complex128' || t2 === 'complex128') return 'complex128';
  if (t1 === 'complex64' || t2 === 'complex64') return 'complex64';
  if (t1 === 'float64' || t2 === 'float64') return 'float64';
  if (t1 === 'float32' || t2 === 'float32') return 'float32';
  if (t1 === 'int32' || t2 === 'int32') return 'int32';
  if (t1 === 'uint8' || t2 === 'uint8') return 'uint8';
  if (t1 === 'bool' || t2 === 'bool') return 'bool';
  return 'expression';
}

export function getExpressionDatatype(expr: BoxedExpression): TensorDataType {
  // Depending on whether the expr is a literal number, a string, etc, set the dtype
  // appropriately
  const val = expr.value;
  if (typeof val === 'number') {
    if (Number.isInteger(val)) {
      if (val >= 0 && val <= 255) return 'uint8';
      return 'int32';
    }
    return 'float64';
  }
  const nVal = expr.numericValue;
  if (nVal !== null && nVal instanceof Complex) return 'complex128';
  if (expr.string) return 'string';
  return 'expression';
}
