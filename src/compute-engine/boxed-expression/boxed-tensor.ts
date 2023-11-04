import { Expression } from '../../math-json/math-json-format';
import {
  BoxedExpression,
  IComputeEngine,
  EvaluateOptions,
  NOptions,
  SimplifyOptions,
  Metadata,
  BoxedDomain,
  ArrayValue,
  BoxedSubstitution,
  PatternMatchOptions,
  SemiBoxedExpression,
} from '../public';
import { AbstractTensor } from '../symbolic/tensors.js';
import { _BoxedExpression } from './abstract-boxed-expression';
import {
  serializeJsonCanonicalFunction,
  serializeJsonFunction,
} from './serialize';
import { hashCode } from './utils';

export class BoxedTensor
  extends _BoxedExpression
  implements AbstractTensor<BoxedExpression>
{
  private readonly _head: string;
  private readonly _data: BoxedExpression[];
  private _canonical: BoxedExpression | undefined;

  constructor(
    ce: IComputeEngine,
    head: string,
    data: BoxedExpression[],
    options?: { canonical?: boolean; metadata?: Metadata }
  ) {
    options ??= {};
    super(ce, options.metadata);

    this._head = head;
    this._data = options?.canonical ? ce.canonical(data) : data;

    ce._register(this);
  }

  bind(): void {}

  reset(): undefined {}

  get hash(): number {
    let h = hashCode('BoxedArray');
    // for (const [k, v] of this._value) h ^= hashCode(k) ^ v.hash;
    return h;
  }

  get canonical(): BoxedExpression {
    if (this._canonical === undefined) {
      if (this._data.every((e) => e.isCanonical)) this._canonical = this;
      else
        this._canonical = this.engine.box([
          this._head,
          ...this._data.map((e) => e.canonical),
        ]);
    }
    return this._canonical;
  }

  get isCanonical(): boolean {
    return this.canonical === this;
  }

  set isCanonical(val: boolean) {
    this._canonical = val ? this : undefined;
  }

  get isPure(): boolean {
    if (this.isCanonical) return false;
    return this._data.every((e) => e.isPure);
  }

  get isValid(): boolean {
    return this._data.every((e) => e.isValid);
  }

  get complexity(): number {
    return 97;
  }

  get head(): string {
    return this._head;
  }

  get nops(): number {
    return this._data.length;
  }

  get ops(): BoxedExpression[] {
    return this._data;
  }

  get op1(): BoxedExpression {
    return this._data[0] ?? this.engine.Nothing;
  }

  get op2(): BoxedExpression {
    return this._data[1] ?? this.engine.Nothing;
  }

  get op3(): BoxedExpression {
    return this._data[2] ?? this.engine.Nothing;
  }

  get domain(): BoxedDomain {
    return this.engine.domain('Lists');
  }

  get json(): Expression {
    if (this.isCanonical && this.isValid) {
      return serializeJsonCanonicalFunction(
        this.engine,
        this._head,
        this._data,
        { latex: this._latex, wikidata: this.wikidata }
      );
    }
    return serializeJsonFunction(this.engine, this._head, this._data, {
      latex: this._latex,
      wikidata: this.wikidata,
    });
  }

  get rawJson(): Expression {
    return [this._head, ...this._data.map((e) => e.rawJson)];
  }

  /** Structural equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (rhs.head !== this._head) return false;
    if (rhs.nops !== this._data.length) return false;
    return this._data.every((e, i) => e.isSame(rhs.ops![i]));
  }

  /** Mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    if (rhs.head !== this._head) return false;
    if (rhs.nops !== this._data.length) return false;
    return this._data.every((e, i) => e.isEqual(rhs.ops![i]));
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    if (rhs.head !== this._head) return null;
    if (rhs.nops !== this._data.length) return null;

    const rhsOps = rhs.ops!;
    const subs: BoxedSubstitution = {};
    for (let i = 0; i < this._data.length; i++) {
      const s = this._data[i].match(rhsOps[i], options);
      if (s === null) return null;
      Object.assign(subs, s);
    }
    return subs;
  }

  evaluate(options?: EvaluateOptions): BoxedExpression {
    if (!this.isCanonical) return this.canonical.evaluate(options);
    return this.engine.box([
      this._head,
      ...this._data.map((e) => e.evaluate(options)),
    ]);
  }

  simplify(options?: SimplifyOptions): BoxedExpression {
    if (!this.isCanonical) return this.canonical.simplify(options);
    return this.engine.box([
      this._head,
      ...this._data.map((e) => e.simplify(options)),
    ]);
  }

  N(options?: NOptions): BoxedExpression {
    if (!this.isCanonical) return this.canonical.N(options);
    return this.engine.box([
      this._head,
      ...this._data.map((e) => e.N(options)),
    ]);
  }

  //
  // AbstractArray
  //

  expression(ce: IComputeEngine): BoxedExpression {
    return this;
  }

  get shape(): number[] {
    // The function to recursively calculate the shape.
    const shapeCalc = (t: BoxedExpression[]): number[] => {
      // Recursive case: we need to find the maximum length of all elements
      // in this dimension.
      let maxShape: number[] = [];
      for (const item of t) {
        if (item.head === this._head) {
          const currentShape = shapeCalc(item.ops!);
          maxShape =
            maxShape.length > currentShape.length
              ? maxShape
              : currentShape.map((size, index) =>
                  Math.max(size, maxShape[index] || 0)
                );
        } else {
          // If the item is not an array, then we've reached the
          // end of this dimension.
          return [t.length];
        }
      }
      // Add this dimension's length to the front of the shape array.
      return [t.length, ...maxShape];
    };

    return shapeCalc(this._data);
  }

  get rank(): number {
    return this.shape.length;
  }

  get isSquare(): boolean {
    const shape = this.shape;
    return shape.length === 2 && shape[0] === shape[1];
  }

  get isSymmetric(): boolean {
    // @todo tensor
    return false;
  }

  get isSkewSymmetric(): boolean {
    // @todo tensor
    return false;
  }

  get isUpperTriangular(): boolean {
    // @todo tensor
    return false;
  }

  get isLowerTriangular(): boolean {
    // @todo tensor
    return false;
  }

  get isTriangular(): boolean {
    // @todo tensor
    return false;
  }

  get isDiagonal(): boolean {
    // @todo tensor
    return false;
  }

  get isIdentity(): boolean {
    // @todo tensor
    return false;
  }

  get isZero(): boolean {
    // @todo tensor
    return false;
  }

  get isSparse(): boolean {
    // @todo tensor
    return false;
  }

  get isRegular(): boolean {
    // @todo tensor
    return false;
  }

  get isSingular(): boolean {
    // @todo tensor
    return false;
  }

  get dataType(): 'number' | 'complex' | 'boolean' | 'any' {
    // @todo tensor: use 'expression' for general BoxedExpression elements
    return 'any';
  }

  at(...indices: number[]): BoxedExpression {
    let t: BoxedExpression[] = this._data;
    for (const index of indices) {
      if (index < 1 || index > t.length) return this.engine.Nothing;
      if (!t[index - 1].ops) return t[index - 1];
      t = t[index - 1].ops!;
    }
    return this.engine.box([this._head, ...t]);
  }

  axis(axis: number): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  diagonal(): undefined | BoxedExpression[] {
    // @todo tensor:
    return undefined;
  }

  reshape(...shape: number[]): AbstractTensor<BoxedExpression> {
    return reshape(
      this.engine,
      this._head,
      flatten(this._head, this._data),
      shape
    );
  }

  flatten(): BoxedExpression[] {
    if (this.rank === 1) return this._data;
    return flatten(this._head, this._data);
  }

  transpose(): undefined | AbstractTensor<BoxedExpression>;
  transpose(
    axis1: number,
    axis2: number,
    fn?: (v: BoxedExpression) => BoxedExpression
  ): undefined | AbstractTensor<BoxedExpression>;
  transpose(
    axis1?: number,
    axis2?: number,
    fn?: (v: BoxedExpression) => BoxedExpression
  ): undefined | AbstractTensor<BoxedExpression> {
    if (this.rank !== 2) return undefined;

    axis1 ??= 1;
    axis2 ??= 2;

    if (axis1 === axis2) return this;
    if (axis1 <= 0 || axis1 > 2) return undefined;
    if (axis2 <= 0 || axis2 > 2) return undefined;

    // Transpose the two axes of the matrix
    const [m, n] = this.shape;
    let data = flatten(this._head, this._data);
    if (fn) data = data.map((x) => fn(x));

    let index = 0;
    const result: BoxedExpression[] = new Array(m * n);
    const stride = n;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < m; j++) result[index++] = data[j * stride + i];
    }

    return reshape(this.engine, this._head, result, [n, m]);
  }

  conjugateTranspose(
    axis1: number,
    axis2: number
  ): undefined | AbstractTensor<BoxedExpression> {
    return this.transpose(axis1, axis2, (z) => {
      const v = z.numericValue;
      if (v === null || !this.engine.isComplex(v)) return z;
      return this.engine.number(v.conjugate());
    });
  }

  determinant(): BoxedExpression {
    if (this.rank !== 2) return this.engine.Nothing;
    const [m, n] = this.shape;
    if (m !== n) return this.engine.Nothing;
    if (m === 1) return this._data[0];
    const ce = this.engine;
    if (m === 2) {
      const [a, b, c, d] = flatten(this._head, this._data);

      return this.engine
        .add([ce.mul([a, d]), ce.neg(ce.mul([b, c]))])
        .simplify();
    }
    if (m === 3) {
      const [a, b, c, d, e, f, g, h, i] = flatten(this._head, this._data);
      return this.engine
        .add([
          ce.mul([a, e, i]),
          ce.mul([b, f, g]),
          ce.mul([c, d, h]),
          ce.neg(ce.mul([c, e, g])),
          ce.neg(ce.mul([b, d, i])),
          ce.neg(ce.mul([a, f, h])),
        ])
        .simplify();
    }

    return this.engine.Nothing;
  }

  inverse(): undefined | AbstractTensor<BoxedExpression> {
    if (this.rank !== 2) return undefined;
    const [m, n] = this.shape;
    if (m !== n) return undefined;

    // Inverse the matrix
    // @todo tensor: that's wrong
    const flatData = flatten(this._head, this._data);
    return reshape(this.engine, this._head, flatData.reverse(), [n, m]);
  }

  pseudoInverse(): undefined | AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return undefined;
  }

  adjugateMatrix(): undefined | AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return undefined;
  }

  minor(i: number, j: number): undefined | BoxedExpression {
    // @todo tensor:
    return undefined;
  }

  trace(): undefined | AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return undefined;
  }

  add(rhs: AbstractTensor<BoxedExpression>): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  subtract(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  multiply(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  divide(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  power(rhs: AbstractTensor<BoxedExpression>): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  tensorProduct(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  kroneckerProduct(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  frobeniusProduct(rhs: AbstractTensor<BoxedExpression>): BoxedExpression {
    // @todo tensor:
    return this;
  }

  dot(rhs: AbstractTensor<BoxedExpression>): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  crossProduct(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  outerProduct(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  innerProduct(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  matrixProduct(
    rhs: AbstractTensor<BoxedExpression>
  ): AbstractTensor<BoxedExpression> {
    // @todo tensor:
    return this;
  }

  equals(rhs: AbstractTensor<BoxedExpression>): boolean {
    // @todo tensor:
    return false;
  }
}

export function isBoxedTensor(val: unknown): val is BoxedTensor {
  return val instanceof BoxedTensor;
}

function flatten(head: string, t: BoxedExpression[]): BoxedExpression[] {
  const flattenData: BoxedExpression[] = [];
  const flatten = (t: BoxedExpression[]) => {
    for (const item of t) {
      if (item.head === head) flatten(item.ops!);
      else flattenData.push(item);
    }
  };
  flatten(t);
  return flattenData;
}

function reshape(
  ce: IComputeEngine,
  head: string,
  data: BoxedExpression[],
  shape: number[]
): BoxedTensor {
  if (shape.length === 0) return new BoxedTensor(this.engine, head, data);

  const totalSize = shape.reduce((a, b) => a * b, 1);
  let flatData = data;
  if (totalSize !== data.length) {
    flatData = [...data];
    // Fill the missing data with elements from the beginning
    // of the array.
    let missing = totalSize - flatData.length;
    while (missing !== 0) {
      if (missing < 0) {
        // Remove elements from the end of the array.
        flatData.splice(missing);
        missing = 0;
      } else {
        const l = flatData.length;
        flatData.push(...flatData.slice(0, missing));
        missing -= l;
      }
    }
  }

  // flatData is now of the correct size for the requested shape.

  const filledData: BoxedExpression[] = [];
  const fill = (axis = 0, index = 0) => {
    const dim = shape[axis];
    if (axis === shape.length - 1) {
      filledData.push(ce.box([head, data.slice(index, index + dim)]));
    } else {
      for (let j = 0; j < dim; j++) fill(axis + 1, index + j * dim);
    }
  };
  fill();
  return new BoxedTensor(ce, head, filledData);
}

function getStrides(shape: number[]): number[] {
  let strides = new Array(shape.length);
  for (let i = shape.length - 1, stride = 1; i >= 0; i--) {
    strides[i] = stride;
    stride *= shape[i];
  }
  return strides;
}

function idx(strides: number[], coords: number[]) {
  return coords.reduce((acc, val, dim) => acc + val * strides[dim], 0);
}
