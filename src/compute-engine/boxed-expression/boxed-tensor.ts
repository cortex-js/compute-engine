import Complex from 'complex.js';
import Decimal from 'decimal.js';
import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  IComputeEngine,
  EvaluateOptions,
  SimplifyOptions,
  Metadata,
  BoxedDomain,
  BoxedSubstitution,
  PatternMatchOptions,
  BoxedBaseDefinition,
  BoxedFunctionDefinition,
  SemiBoxedExpression,
} from '../public';
import {
  DataTypeMap,
  TensorDataType,
  getExpressionDatatype,
  getSupertype,
  makeTensorField,
} from '../symbolic/tensor-fields';
import { AbstractTensor, TensorData, makeTensor } from '../symbolic/tensors';
import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode, isBoxedExpression } from './utils';
import { canonical } from '../symbolic/utils';
import { isWildcard, wildcardName } from './boxed-patterns';

/**
 * A boxed tensor represents an expression that can be
 * represented by a tensor. This could be a vector, matrix
 * or multi-dimensional array.
 *
 * The object can be created either from a tensor or from
 * an expression that can be represented as a tensor.
 *
 * The counterpart (expression if input is tensor, or tensor
 * if input is expression) is created lazily.
 *
 * @noInheritDoc
 *
 */
export class BoxedTensor extends _BoxedExpression {
  private _tensor: undefined | AbstractTensor<'expression'>;

  private readonly _head?: string;
  private readonly _ops?: ReadonlyArray<BoxedExpression>;
  private _expression: undefined | BoxedExpression;

  constructor(
    ce: IComputeEngine,
    input:
      | {
          head?: string;
          ops: ReadonlyArray<BoxedExpression>;
        }
      | AbstractTensor<'expression'>,
    options?: { metadata?: Metadata; canonical?: boolean }
  ) {
    options = options ? { ...options } : {};
    options.canonical ??= true;

    super(ce, options.metadata);

    if (input instanceof AbstractTensor) {
      this._tensor = input;
    } else {
      this._head = input.head ?? 'List';
      this._ops = options.canonical === true ? canonical(input.ops) : input.ops;

      this._expression = ce._fn(this._head, this._ops, {
        canonical: options.canonical,
      });
    }

    ce._register(this);
  }

  get expression(): BoxedExpression {
    // Make an expression from the tensor
    this._expression ??= this._tensor!.expression;

    return this._expression;
  }

  /** Create the tensor on demand */
  get tensor(): AbstractTensor<'expression'> {
    if (this._tensor === undefined) {
      console.assert(this._head !== undefined);
      console.assert(this._ops !== undefined);
      const tensorData = expressionAsTensor<'expression'>(
        this._head!,
        this._ops!
      );
      if (tensorData === undefined) throw new Error('Invalid tensor');
      this._tensor = makeTensor(this.engine, tensorData);
    }
    return this._tensor!;
  }

  get baseDefinition(): BoxedBaseDefinition | undefined {
    return this.expression.baseDefinition;
  }

  get functionDefinition(): BoxedFunctionDefinition | undefined {
    return this.expression.functionDefinition;
  }

  bind(): void {
    this.expression.bind();
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
      { head: this._head, ops: this._ops! },
      { canonical: true }
    );
  }

  get isCanonical(): boolean {
    if (this._tensor) return true;
    return this._expression!.isCanonical;
  }

  set isCanonical(val: boolean) {
    if (!this._tensor) this.expression.isCanonical = val;
  }

  get isPure(): boolean {
    if (this._tensor) return true;
    return this.expression.isPure;
  }

  get isValid(): boolean {
    if (this._tensor) return true;
    return this.expression.isValid;
  }

  get complexity(): number {
    return 97;
  }

  get head(): string {
    return this._tensor ? 'List' : this._head!;
  }

  get nops(): number {
    if (this._tensor) return this._tensor.shape[0];
    return this.expression.nops;
  }

  get ops(): ReadonlyArray<BoxedExpression> {
    return this.expression.ops!;
  }

  get op1(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length === 0) return this.engine.Nothing;
      return this.engine.box(data[0]);
    }
    return this.expression.op1;
  }

  get op2(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length < 2) return this.engine.Nothing;
      return this.engine.box(data[1]);
    }
    return this.expression.op2;
  }

  get op3(): BoxedExpression {
    if (this._tensor) {
      const data = this._tensor.data;
      if (data.length < 3) return this.engine.Nothing;
      return this.engine.box(data[2]);
    }
    return this.expression.op3;
  }

  get shape(): number[] {
    return this.tensor.shape;
  }

  get rank(): number {
    return this.tensor.rank;
  }

  get domain(): BoxedDomain | undefined {
    if (this._tensor) return this.engine.domain('Lists');
    return this.expression.domain;
  }

  get json(): Expression {
    // @todo tensor: could be optimized by avoiding creating
    // an expression and getting the JSON from the tensor directly
    return this.expression.json;
  }

  /** Structural equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    if (rhs instanceof BoxedTensor) return this.tensor.equals(rhs.tensor);

    return this.expression.isSame(rhs);
  }

  /** Mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;

    if (rhs instanceof BoxedTensor) return this.tensor.equals(rhs.tensor);

    return this.expression.isEqual(rhs);
  }

  match(
    pattern:
      | Decimal
      | Complex
      | [num: number, denom: number]
      | SemiBoxedExpression
      | BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (!isBoxedExpression(pattern))
      pattern = this.engine.box(pattern, { canonical: false });
    if (isWildcard(pattern)) return { [wildcardName(pattern)!]: this };
    return this.expression.match(pattern, options);
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    if (this._tensor) return this;
    return this.expression.evaluate(options);
  }

  simplify(options?: Partial<SimplifyOptions>): BoxedExpression {
    if (this._tensor) return this;
    return this.expression.simplify(options);
  }

  N(): BoxedExpression {
    if (this._tensor) return this;
    return this.expression.N();
  }
}

export function isBoxedTensor(val: unknown): val is BoxedTensor {
  return val instanceof BoxedTensor;
}

export function expressionTensorInfo(
  head: string,
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
      if (item.head === head) visit(item.ops!, axis + 1);
      else {
        if (dtype === undefined) dtype = getExpressionDatatype(item);
        else dtype = getSupertype(dtype, getExpressionDatatype(item));
      }
      if (!valid) return;
    }
  };

  visit(rows);

  return valid ? { shape, dtype } : undefined;
}

export function expressionAsTensor<T extends TensorDataType>(
  head: string,
  rows: ReadonlyArray<BoxedExpression>
): TensorData<T> | undefined {
  const { shape, dtype } = expressionTensorInfo(head, rows) ?? {
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
      if (item.head === head) visit(item.ops!);
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
