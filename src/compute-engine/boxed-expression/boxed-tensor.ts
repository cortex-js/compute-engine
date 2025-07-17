import type { Expression } from '../../math-json/types';

import type {
  ComputeEngine,
  TensorDataType,
  Metadata,
  BoxedBaseDefinition,
  BoxedOperatorDefinition,
  BoxedSubstitution,
  EvaluateOptions,
  TensorData,
  DataTypeMap,
  BoxedExpression,
  SimplifyOptions,
  PatternMatchOptions,
  Tensor,
} from '../global-types';

import { parseType } from '../../common/type/parse';
import { BoxedType } from '../../common/type/boxed-type';

import {
  getExpressionDatatype,
  getSupertype,
  makeTensorField,
} from '../tensor/tensor-fields';
import { AbstractTensor, makeTensor } from '../tensor/tensors'; // @fixme

import { NumericValue } from '../numeric-value/types';

import { _BoxedExpression } from './abstract-boxed-expression';
import { isWildcard, wildcardName } from './boxed-patterns';
import { hashCode, isBoxedExpression } from './utils';

/**
 * A boxed tensor represents an expression that can be represented by a tensor.
 * This could be a vector, matrix or multi-dimensional array.
 *
 * The object can be created either from a tensor or from an expression that
 * can be represented as a tensor.
 *
 * The structural counterpart (expression if input is tensor, or tensor
 * if input is expression) is created lazily.
 *
 */
export class BoxedTensor<T extends TensorDataType> extends _BoxedExpression {
  private _tensor: AbstractTensor<T>;

  private _expression?: BoxedExpression;

  constructor(
    ce: ComputeEngine,
    readonly input: {
      ops: ReadonlyArray<BoxedExpression>;
      shape: number[];
      dtype: T;
    },
    readonly options?: { metadata?: Metadata }
  ) {
    super(ce, options?.metadata);

    const tensorData = expressionAsTensor<T>(
      ce,
      'List',
      input.ops,
      input.shape,
      input.dtype
    );
    if (!tensorData) throw new Error('Invalid tensor');
    this._tensor = makeTensor(ce, tensorData);
  }

  get structural(): BoxedExpression {
    // Make an expression from the tensor
    this._expression ??= this._tensor!.expression;

    return this._expression;
  }

  /** Create the tensor on demand */
  get tensor(): Tensor<T> {
    return this._tensor;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.structural.baseDefinition;
  }

  get operatorDefinition(): BoxedOperatorDefinition | undefined {
    return this.structural.operatorDefinition;
  }

  get hash(): number {
    const h = hashCode('BoxedTensor');
    // for (const [k, v] of this._value) h ^= hashCode(k) ^ v.hash;
    return h;
  }

  get canonical(): BoxedExpression {
    return this;
  }

  get isCanonical(): boolean {
    if (this._tensor) return true;
    return this._expression!.isCanonical;
  }

  // set isCanonical(val: boolean) {
  //   if (!this._tensor) this.structural.isCanonical = val;
  // }

  get isPure(): boolean {
    if (this._tensor) return true;
    return this.structural.isPure;
  }

  get isValid(): boolean {
    if (this._tensor) return true;
    return this.structural.isValid;
  }

  get complexity(): number {
    return 97;
  }

  get operator(): string {
    return 'List';
  }

  get nops(): number {
    if (this._tensor) return this._tensor.shape[0];
    return this.structural.nops;
  }

  get ops(): ReadonlyArray<BoxedExpression> {
    return this.structural.ops!;
  }

  get op1(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length === 0) return this.engine.Nothing;
      return this.engine.box(data[0]);
    }
    return this.structural.op1;
  }

  get op2(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length < 2) return this.engine.Nothing;
      return this.engine.box(data[1]);
    }
    return this.structural.op2;
  }

  get op3(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length < 3) return this.engine.Nothing;
      return this.engine.box(data[2]);
    }
    return this.structural.op3;
  }

  //
  //
  // ALGEBRAIC OPERATIONS
  //

  neg(): BoxedExpression {
    return this.structural.neg();
  }

  inv(): BoxedExpression {
    return this.engine.One.div(this.structural);
  }

  abs(): BoxedExpression {
    return this.structural.abs();
  }

  add(rhs: number | BoxedExpression): BoxedExpression {
    return this.structural.add(rhs);
  }

  sub(rhs: BoxedExpression): BoxedExpression {
    return this.structural.sub(rhs);
  }

  mul(rhs: NumericValue | number | BoxedExpression): BoxedExpression {
    return this.structural.mul(rhs);
  }

  div(rhs: number | BoxedExpression): BoxedExpression {
    return this.structural.div(rhs);
  }

  pow(exp: number | BoxedExpression): BoxedExpression {
    return this.structural.pow(exp);
  }

  root(exp: number | BoxedExpression): BoxedExpression {
    return this.structural.root(exp);
  }

  sqrt(): BoxedExpression {
    return this.structural.sqrt();
  }

  get shape(): number[] {
    return this.tensor.shape;
  }

  get rank(): number {
    try {
      return this.tensor.rank;
    } catch (e) {}
    return 0;
  }

  get type(): BoxedType {
    // @fixme: more precisely: matrix, vector, etc...
    return new BoxedType(this.isValid ? parseType('list<number>') : 'error');
  }

  get json(): Expression {
    // @todo tensor: could be optimized by avoiding creating
    // an expression and getting the JSON from the tensor directly
    return this.structural.json;
  }

  /** Mathematical equality */
  isEqual(rhs: number | BoxedExpression): boolean | undefined {
    if (this === rhs) return true;

    if (rhs instanceof BoxedTensor) return this.tensor.equals(rhs.tensor);

    return this.structural.isEqual(rhs);
  }

  get isCollection(): boolean {
    return true;
  }

  get isIndexedCollection(): boolean {
    return true;
  }

  contains(other: BoxedExpression): boolean | undefined {
    if (['float64', 'float32', 'int32', 'uint8'].includes(this.tensor.dtype)) {
      type ElementType<T extends Tensor<any>> = T['dtype'];
      type DataType = DataTypeMap[ElementType<typeof this.tensor>];
      const data = this.tensor.data as DataType[];
      return data.includes(other.re as DataType);
    }
    return this.tensor.data.some((x) =>
      other.isSame(
        this.tensor.field.cast(x, 'expression') ?? other.engine.Nothing
      )
    );
  }

  get count(): number {
    return this.tensor.shape.reduce((a, b) => a * b, 1);
  }

  each(): Generator<BoxedExpression> {
    const shape = this.tensor.shape;
    const rank = this.tensor.rank;

    // Scalar tensor: yield itself
    if (rank === 0) {
      return (function* (self: BoxedTensor<any>) {
        yield self;
      })(this);
    }

    const count = shape[0];

    if (rank === 1) {
      return (function* (self: BoxedTensor<any>) {
        // 1D tensor: yield each element as boxed expression
        for (let i = 1; i <= count; i += 1) {
          // 0-based index for .data
          const data = self.tensor.data;
          const idx = i - 1;
          if (idx >= 0 && idx < data.length) {
            yield self.engine.box(data[idx]);
          }
        }
      })(this);
    }

    // Higher rank tensor: yield slices along the first axis
    return (function* (self: BoxedTensor<any>) {
      for (let i = 1; i <= count; i += 1) {
        // slice(i - 1) returns a tensor of rank-1 less
        const row = self.tensor.slice(i - 1);
        yield new BoxedTensor(self.engine, {
          ops: row.expression.ops!,
          shape: row.shape,
          dtype: row.dtype,
        });
      }
    })(this);
  }

  at(index: number): BoxedExpression | undefined {
    // Return the nth row of the tensor
    const row = this.tensor.slice(index);
    if (row.rank === 0) {
      // Scalar tensor: return itself
      return this.engine.box(row.data[0]);
    } else if (row.rank === 1) {
      // 1D tensor: return the boxed expression of the element
      return this.engine.box(row.data[0]);
    } else if (row.rank > 1) {
      // Higher rank tensor: return a new boxed tensor
      return new BoxedTensor(this.engine, {
        ops: row.expression.ops!,
        shape: row.shape,
        dtype: row.dtype,
      });
    }
    return undefined;
  }

  match(
    pattern: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isBoxedExpression(pattern))
      pattern = this.engine.box(pattern, { canonical: false });
    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };
    return this.structural.match(pattern, options);
  }

  evaluate(options?: Partial<EvaluateOptions>): BoxedExpression {
    if (this._tensor && this._tensor.dtype !== 'expression') return this;
    return this.structural.evaluate(options);
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    if (this._tensor && this._tensor.dtype !== 'expression') return this;
    return this.structural.simplify(options);
  }

  N(): BoxedExpression {
    if (this._tensor && this._tensor.dtype !== 'expression') return this;
    return this.structural.N();
  }
}

export function isBoxedTensor(val: unknown): val is BoxedTensor<any> {
  return val instanceof BoxedTensor;
}

export function expressionTensorInfo(
  operator: string,
  rows: ReadonlyArray<BoxedExpression>
):
  | {
      shape: number[];
      dtype: TensorDataType;
    }
  | undefined {
  let dtype: TensorDataType | undefined = undefined;
  const shape: number[] = [];
  let valid = true;

  const visit = (t: ReadonlyArray<BoxedExpression>, axis = 0) => {
    if (!valid) return;
    const len = t.length;
    if (len === 0) return;

    // 1. shape check
    if (shape[axis] === undefined) {
      shape[axis] = len;
    } else if (shape[axis] !== len) {
      valid = false;
      return;
    }

    // 2. classify items
    let nestedCount = 0;
    for (const item of t) {
      if (item.operator === operator) nestedCount++;
    }
    const leafCount = len - nestedCount;

    // 3. mixed leaf + nested → invalid
    if (nestedCount > 0 && leafCount > 0) {
      valid = false;
      return;
    }

    // 4a. all nested → recurse
    if (nestedCount === len) {
      for (const item of t) {
        visit(item.ops!, axis + 1);
        if (!valid) return;
      }
    }
    // 4b. all leaves → accumulate dtype
    else {
      for (const item of t) {
        dtype = getSupertype(dtype, getExpressionDatatype(item));
      }
    }
  };

  visit(rows);
  return valid ? { shape, dtype: dtype! } : undefined;
}

function expressionAsTensor<T extends TensorDataType = 'expression'>(
  ce: ComputeEngine,
  operator: string,
  rows: ReadonlyArray<BoxedExpression>,
  shape: number[],
  dtype: T
): TensorData<T> | undefined {
  let isValid = true;
  const data: DataTypeMap[T][] = [];
  const f = makeTensorField(ce, 'expression');
  const cast = f.cast.bind(f);
  const visit = (t: ReadonlyArray<BoxedExpression>, axis = 0) => {
    if (t.length === 0) return;

    if (shape[axis] === undefined) {
      shape[axis] = t.length;
    } else if (shape[axis] !== t.length) {
      isValid = false;
      return;
    }

    for (const item of t) {
      if (!isValid) return;
      if (item.operator === operator) visit(item.ops!, axis + 1);
      else {
        const v = cast(item, dtype);
        if (v === undefined) {
          isValid = false;
          return;
        }
        data.push(v);
      }
    }
  };
  visit(rows);
  if (!isValid) return undefined;
  return { shape, rank: shape.length, data, dtype: dtype as T };
}
