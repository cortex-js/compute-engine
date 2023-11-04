import Complex from 'complex.js';
import { AbstractTensor } from '../symbolic/tensors';
import { BoxedExpression, IComputeEngine } from '../public';

// @todo tensor: implement
export class Vector<T extends number | Complex = number>
  implements AbstractTensor<T>
{
  constructor(public data: T[]) {}

  expression(ce: IComputeEngine): BoxedExpression {
    return ce.box(['List', ...this.data.map((x) => ce.number(x))]);
  }

  get rank(): number {
    return 1;
  }

  get shape(): number[] {
    return [this.data.length];
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

  at(...indices: number[]): T {
    return this.data[indices[0]];
  }

  axis(axis: number): Vector<T> {
    return this;
  }

  diagonal(): T[] | undefined {
    return undefined;
  }

  reshape(...shape: number[]): Vector<T> {
    return this;
  }

  flatten(): T[] {
    return this.data;
  }

  transpose(): Vector<T>;
  transpose(
    axis1?: number,
    axis2?: number,
    fn?: (v: T) => T
  ): undefined | Vector<T> {
    return undefined;
  }

  conjugateTranspose(axis1: number, axis2: number): undefined | Vector<T> {
    return undefined;
  }

  determinant(): undefined | T {
    return undefined;
  }

  inverse(): undefined | Vector<T> {
    return undefined;
  }

  pseudoInverse(): undefined | Vector<T> {
    return this;
  }

  adjugateMatrix(): undefined | Vector<T> {
    return this;
  }

  minor(i: number, j: number): undefined | T {
    return undefined;
  }

  trace(): undefined | Vector<T> {
    return undefined;
  }

  add(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  subtract(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  multiply(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  divide(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  power(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  tensorProduct(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  kroneckerProduct(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  frobeniusProduct(rhs: AbstractTensor<T>): T {
    return this as unknown as T;
  }

  dot(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  crossProduct(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  outerProduct(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  innerProduct(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  matrixProduct(rhs: AbstractTensor<T>): AbstractTensor<T> {
    return this;
  }

  equals(rhs: AbstractTensor<T>): boolean {
    return false;
  }
}
