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
import { _BoxedExpression } from './abstract-boxed-expression';
import { hashCode } from './utils';

export class BoxedTensor extends _BoxedExpression {
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
}

export function isBoxedTensor(val: unknown): val is BoxedTensor {
  return val instanceof BoxedTensor;
}
