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
} from '../public';
import { AbstractArray, Tensor } from '../symbolic/tensors.js';
import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode } from './utils';

export class BoxedTensor
  extends _BoxedExpression
  implements AbstractArray<BoxedExpression>
{
  private _rows: ArrayValue[];

  constructor(
    ce: IComputeEngine,
    array: BoxedExpression,
    options?: { canonical?: boolean; metadata?: Metadata }
  ) {
    options ??= {};
    super(ce, options.metadata);

    if (array instanceof _BoxedExpression) {
      if (array.head === 'List') {
        // @todo...
      }
    } else {
      console.assert(Array.isArray(array));
      // Calculate dimensions
      // Check dataType, isSquare, isSymmetric, isSkewSymmetric, isUpperTriangular, isLowerTriangular, isTriangular, isDiagonal, isIdentity, isZero, isSparse
      // Check it's a regular matrix, possibly sparse
    }

    ce._register(this);
  }

  bind(): void {}

  reset(): undefined {}

  get hash(): number {
    let h = hashCode('BoxedArray');
    // for (const [k, v] of this._value) h ^= hashCode(k) ^ v.hash;
    return h;
  }

  get complexity(): number {
    return 97;
  }

  get head(): 'List' {
    return 'List';
  }

  get isPure(): boolean {
    return true;
  }

  get domain(): BoxedDomain {
    return this.engine.domain('Lists');
  }

  get json(): Expression {
    return ['List'];
  }

  /** Structural equality */
  isSame(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    return false;
  }

  /** Mathematical equality */
  isEqual(rhs: BoxedExpression): boolean {
    if (this === rhs) return true;
    return false;
    // return this.equals(rhs);
  }

  match(
    rhs: BoxedExpression,
    options?: PatternMatchOptions
  ): BoxedSubstitution | null {
    return null;
  }

  evaluate(_options?: EvaluateOptions): BoxedExpression {
    return this;
  }

  get isCanonical(): boolean {
    return true;
  }
  set isCanonical(val: boolean) {}

  get canonical(): BoxedExpression {
    return this;
  }

  simplify(_options?: SimplifyOptions): BoxedExpression {
    return this;
  }

  N(_options?: NOptions): BoxedExpression {
    return this;
  }

  //
  // AbstractArray
  //

  get rank(): number {
    return 1;
  }

  get shape(): number[] {
    return [this._rows.length];
  }

  get isSquare(): boolean {
    return false;
  }
  get isSymmetric(): boolean {
    return false;
  }
  get isSkewSymmetric(): boolean {
    return false;
  }
  get isUpperTriangular(): boolean {
    return false;
  }

  get isLowerTriangular(): boolean {
    return false;
  }

  get isTriangular(): boolean {
    return false;
  }

  get isDiagonal(): boolean {
    return false;
  }

  get isIdentity(): boolean {
    return false;
  }

  get isZero(): boolean {
    return false;
  }

  get isSparse(): boolean {
    return false;
  }

  get isRegular(): boolean {
    return false;
  }

  get isSingular(): boolean {
    return false;
  }

  get dataType(): 'number' | 'complex' | 'boolean' | 'any' {
    return 'any';
  }

  at(...indices: number[]): BoxedExpression {
    return this.engine.Nothing;
  }

  axis(axis: number): AbstractArray<BoxedExpression> {
    return this;
  }

  diagonal(): AbstractArray<BoxedExpression> {
    return this;
  }

  reshape(...shape: number[]): AbstractArray<BoxedExpression> {
    return this;
  }

  flatten(): AbstractArray<BoxedExpression> {
    return this;
  }

  transpose(): AbstractArray<BoxedExpression>;
  transpose(axis1?: number, axis2?: number): AbstractArray<BoxedExpression> {
    return this;
  }

  conjugateTranspose(
    axis1: number,
    axis2: number
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  determinant(): BoxedExpression {
    return this;
  }

  inverse(): AbstractArray<BoxedExpression> {
    return this;
  }

  pseudoInverse(): AbstractArray<BoxedExpression> {
    return this;
  }

  adjugateMatrix(): AbstractArray<BoxedExpression> {
    return this;
  }

  minor(i: number, j: number): BoxedExpression {
    return this;
  }

  trace(): AbstractArray<BoxedExpression> {
    return this;
  }

  add(rhs: AbstractArray<BoxedExpression>): AbstractArray<BoxedExpression> {
    return this;
  }

  subtract(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  multiply(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  divide(rhs: AbstractArray<BoxedExpression>): AbstractArray<BoxedExpression> {
    return this;
  }

  power(rhs: AbstractArray<BoxedExpression>): AbstractArray<BoxedExpression> {
    return this;
  }

  tensorProduct(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  kroneckerProduct(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  frobeniusProduct(rhs: AbstractArray<BoxedExpression>): BoxedExpression {
    return this;
  }

  dotProduct(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  crossProduct(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  outerProduct(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  innerProduct(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  matrixProduct(
    rhs: AbstractArray<BoxedExpression>
  ): AbstractArray<BoxedExpression> {
    return this;
  }

  equals(rhs: AbstractArray<BoxedExpression>): boolean {
    return false;
  }
}

export function isBoxedTensor(val: unknown): val is BoxedTensor {
  return val instanceof BoxedTensor;
}
