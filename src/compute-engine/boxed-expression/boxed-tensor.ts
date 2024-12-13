import type { Expression } from '../../math-json/types';
import type {
  BoxedExpression,
  IComputeEngine,
  EvaluateOptions,
  SimplifyOptions,
  Metadata,
  BoxedSubstitution,
  PatternMatchOptions,
  BoxedBaseDefinition,
  BoxedFunctionDefinition,
} from '../public';

import {
  DataTypeMap,
  TensorDataType,
  getExpressionDatatype,
  getSupertype,
  makeTensorField,
} from './tensor-fields';

import { NumericValue } from '../numeric-value/public';

import { _BoxedExpression } from './abstract-boxed-expression';
import { isWildcard, wildcardName } from './boxed-patterns';
import { canonical, hashCode, isBoxedExpression } from './utils';

import { AbstractTensor, TensorData, makeTensor } from '../tensor/tensors'; // @fixme
import { Type } from '../../common/type/types';
import { parseType } from '../../common/type/parse';

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
 * @noInheritDoc
 *
 */
export class BoxedTensor extends _BoxedExpression {
  private _tensor: undefined | AbstractTensor<'expression'>;

  private readonly _operator?: string;
  private readonly _ops?: ReadonlyArray<BoxedExpression>;
  private _expression: undefined | BoxedExpression;

  constructor(
    ce: IComputeEngine,
    input:
      | {
          op?: string;
          ops: ReadonlyArray<BoxedExpression>;
        }
      | AbstractTensor<'expression'>,
    readonly options?: { metadata?: Metadata; canonical?: boolean }
  ) {
    super(ce, options?.metadata);

    if (input instanceof AbstractTensor) {
      this._tensor = input;
    } else {
      const isCanonical = options?.canonical ?? true;
      this._operator = input.op ?? 'List';
      this._ops = isCanonical ? canonical(ce, input.ops) : input.ops;

      this._expression = ce._fn(this._operator, this._ops, {
        canonical: isCanonical,
      });
    }

    ce._register(this);
  }

  get structural(): BoxedExpression {
    // Make an expression from the tensor
    this._expression ??= this._tensor!.expression;

    return this._expression;
  }

  /** Create the tensor on demand */
  get tensor(): AbstractTensor<'expression'> {
    if (this._tensor === undefined) {
      console.assert(this._operator !== undefined);
      console.assert(this._ops !== undefined);
      const tensorData = expressionAsTensor(this._operator!, this._ops!);
      if (tensorData === undefined) {
        const t2 = expressionAsTensor(this._operator!, this._ops!);
        throw new Error('Invalid tensor');
      }
      this._tensor = makeTensor(this.engine, tensorData);
    }
    return this._tensor!;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.structural.baseDefinition;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this.structural.functionDefinition;
  }

  bind(): void {
    this.structural.bind();
  }

  reset(): void {}

  get hash(): number {
    const h = hashCode('BoxedTensor');
    // for (const [k, v] of this._value) h ^= hashCode(k) ^ v.hash;
    return h;
  }

  get canonical(): BoxedExpression {
    if (this.isCanonical) return this;
    return new BoxedTensor(
      this.engine,
      { op: this._operator, ops: this._ops! },
      { canonical: true }
    );
  }

  get isCanonical(): boolean {
    if (this._tensor) return true;
    return this._expression!.isCanonical;
  }

  set isCanonical(val: boolean) {
    if (!this._tensor) this.structural.isCanonical = val;
  }

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
    return this._tensor ? 'List' : this._operator!;
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
    return this.tensor.rank;
  }

  get type(): Type {
    // @fixme: more precisely: matrix, vector, etc...
    return this.isValid ? parseType('list<number>') : 'error';
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

  contains(rhs: BoxedExpression): boolean {
    const data = this.tensor.data;

    const target = this.tensor.field.cast(rhs, this.tensor.dtype);
    if (typeof target === 'number') return data.includes(target);

    const items = data.map(
      (x) => this.tensor.field.cast(x, 'expression') ?? rhs.engine.Nothing
    );

    for (const item of items) if (rhs.isSame(item)) return true;
    return false;
  }

  get size(): number {
    return this.tensor.shape.reduce((a, b) => a * b, 1);
  }

  each(start?: number, count?: number): Iterator<BoxedExpression, undefined> {
    const data = this.tensor.data;
    let index = start ?? 1;
    count = Math.min(count ?? data.length, data.length);

    if (count <= 0) return { next: () => ({ value: undefined, done: true }) };

    return {
      next: () => {
        if (count! > 0) {
          count!--;
          return { value: this.engine.box(data[index++ - 1]), done: false };
        } else {
          return { value: undefined, done: true };
        }
      },
    };
  }

  at(_index: number): BoxedExpression | undefined {
    return undefined;
  }

  indexOf(_expr: BoxedExpression): number {
    return -1;
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
    if (this._tensor) return this;
    return this.structural.evaluate(options);
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    if (this._tensor) return this;
    return this.structural.simplify(options);
  }

  N(): BoxedExpression {
    if (this._tensor) return this;
    return this.structural.N();
  }
}

export function isBoxedTensor(val: unknown): val is BoxedTensor {
  return val instanceof BoxedTensor;
}

export function expressionTensorInfo(
  operator: string,
  rows: ReadonlyArray<BoxedExpression>
):
  | {
      shape: number[];
      dtype: TensorDataType | undefined;
    }
  | undefined {
  let dtype: TensorDataType | undefined = undefined;
  const shape: number[] = [];
  let valid = true;

  const visit = (t: ReadonlyArray<BoxedExpression>, axis = 0) => {
    if (t.length === 0) return;
    if (t.length > 1 && shape[axis] !== undefined)
      valid = valid && shape[axis] === t.length;
    else shape[axis] = Math.max(shape[axis] ?? 0, t.length);

    for (const item of t) {
      if (item.operator === operator) visit(item.ops!, axis + 1);
      else dtype = getSupertype(dtype, getExpressionDatatype(item));

      if (!valid) return;
    }
  };

  visit(rows);

  return valid ? { shape, dtype } : undefined;
}

export function expressionAsTensor<T extends TensorDataType = 'expression'>(
  operator: string,
  rows: ReadonlyArray<BoxedExpression>
): TensorData<T> | undefined {
  const { shape, dtype } = expressionTensorInfo(operator, rows) ?? {
    shape: [],
    dtype: undefined,
  };
  if (dtype === undefined) return undefined;

  let isValid = true;
  const data: DataTypeMap[T][] = [];
  const f = makeTensorField(rows[0].engine, 'expression');
  const cast = f.cast.bind(f);
  const visit = (t: ReadonlyArray<BoxedExpression>) => {
    for (const item of t) {
      if (item.operator === operator) visit(item.ops!);
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
  return { shape, data, dtype: dtype as T };
}
