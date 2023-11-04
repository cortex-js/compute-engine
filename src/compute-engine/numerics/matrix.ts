import Complex from 'complex.js';
import { AbstractTensor } from '../symbolic/tensors';
import { BoxedExpression, IComputeEngine } from '../public';
import { Vector } from './vector.js';

// @todo tensor: implement
export class Matrix<T extends number | Complex = number>
  implements AbstractTensor<T>
{
  private _shape: number[];
  private _stride: number;
  private _isSquare: boolean;
  constructor(
    public data: T[],
    shape: number[]
  ) {
    this._shape = shape;
    this._stride = data.length / shape[1];
    this._isSquare = shape[0] === shape[1];
  }

  expression(ce: IComputeEngine): BoxedExpression {
    // @todo
    return ce.box(['List', ...this.data.map((x) => ce.number(x))]);
  }

  get rank(): number {
    return 2;
  }

  get shape(): number[] {
    return this._shape;
  }

  get isSquare(): boolean {
    return this._isSquare;
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

  at(row: number, column: number): T {
    return this.data[this._stride * row + column];
  }

  axis(axis: number): Matrix<T> {
    return this;
  }

  diagonal(): T[] | undefined {
    if (!this.isSquare) return undefined;
    return undefined;
  }

  reshape(...shape: number[]): Matrix<T> {
    return this;
  }

  flatten(): T[] {
    return this.data;
  }

  transpose(): Matrix<T>;
  transpose(axis1: number, axis2: number, fn?: (v: T) => T): Matrix<T>;
  transpose(axis1?: number, axis2?: number, fn?: (v: T) => T): Matrix<T> {
    return this;
  }

  conjugateTranspose(axis1: number, axis2: number): undefined | Matrix<T> {
    return this.transpose(axis1, axis2);
  }

  determinant(): T {
    return this.data[0]; // should be zero
  }

  inverse(): undefined | Matrix<T> {
    return undefined;
  }

  pseudoInverse(): Matrix<T> {
    return this;
  }

  adjugateMatrix(): Matrix<T> {
    return this;
  }

  minor(i: number, j: number): undefined | T {
    return undefined;
  }

  trace(): undefined | Matrix<T> {
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
