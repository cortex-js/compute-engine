import type { Expression } from '../global-types.js';
import type { Type } from '../../common/type/types.js';
import { BoxedType } from '../../common/type/boxed-type.js';
import { isSubtype } from '../../common/type/subtype.js';
import { resolveTypeAlias } from '../../common/type/utils.js';
import { isFunction, isSymbol } from './type-guards.js';

/**
 * Can this operand be a matrix, although its type does not say so? This is
 * `true` when the type of the operand is not known to exclude a collection:
 * the type is `unknown` or `any` (the call `g(x)` of a function that was not
 * declared), a union such as `number | matrix`, or a collection that is not
 * known to be a matrix or a vector (`g(A)` with `A` a matrix has the type
 * `matrix<unknown^(2x2)>`). A tuple is not a matrix. An operand of a scalar
 * type (`number`, `real`, `integer`) is `false`.
 *
 * A symbol of type `unknown` (a symbol with no declaration and no value) is
 * `false`: a symbol used in a product is a number. `ce.box(['Multiply', 'A',
 * 'x'])` infers the type `number` for `x`, but `ce.parse('A x')` leaves it
 * `unknown`, and the two must give the same product. A symbol declared with
 * the type `any` is not inferred to be a number, so it is `true`.
 *
 * In a product with a matrix, such an operand must not move past a matrix
 * or past another operand of this kind: if it is a matrix, the two factors
 * do not commute. A nested product that is not canonical yet is spliced
 * into the outer product before its operands are made canonical (see
 * `flattenRawProductOperands()` in `canonical-numeric.ts`), so that
 * `['Multiply', 'A', ['Multiply', ['g', 'x'], ['k', 'x'], ['g', 'x']]]`
 * keeps the written order `A·g(x)·k(x)·g(x)`.
 *
 * A negative integer power of such an operand stays a `Power`
 * (`canonicalPower()` in `arithmetic-power.ts`): it is the matrix inverse
 * when the operand is a matrix.
 *
 * This function is in its own file because `arithmetic-power.ts` and
 * `order.ts` both use it, and `order.ts` imports `arithmetic-power.ts`.
 */
export function mayBeTensorProductOperand(x: Expression): boolean {
  const facts = x.type.facts;
  if (facts.collection === false || facts.tupleShaped) return false;
  return !(isSymbol(x) && x.type.type === 'unknown');
}

/**
 * Can the base `x` of a power be a matrix, although its type does not say
 * so? This is `mayBeTensorProductOperand()` (the call `g(x)` of a function
 * that was not declared, an operand of type `any`, a union with a
 * collection), except for a list of numbers (`[1, 2, 3]`, a symbol declared
 * `vector<3>` or `list<number>`): it has one dimension, so it is not a
 * matrix, and its power is element-wise.
 *
 * A negative integer power of such a base is the matrix inverse (or a power
 * of it) when the base is a matrix. So it stays a `Power`: it is not made
 * canonical as a quotient (`canonicalPower()`), it is not moved to the
 * denominator of a product (`Product` in `arithmetic-mul-div.ts`), and it is
 * not written as a fraction (`serialize.ts` and the LaTeX serializer). The
 * quotient `1/g(x)` is the element-wise reciprocal of a matrix.
 */
export function mayBeMatrixPowerBase(x: Expression): boolean {
  return (
    mayBeTensorProductOperand(x) &&
    !x.type.matches(new BoxedType('list<number>'))
  );
}

/**
 * Can the value of `x` be a matrix of numbers, by the type of `x`? This is
 * `true` for a symbol or a call typed `matrix`, `tensor<number>`,
 * `list<list<number>>`, a bare `list`, `list<unknown>`, `any`,
 * `broadcastable<number>` or `number | matrix`. It is `false` for an operand
 * typed `expression` (a symbolic expression, not a numeric array), `unknown` (the call `g(x)` of a function that was not declared), for
 * a vector or a list of numbers (one axis), for a type whose cells cannot be
 * numbers (`list<string>`, `list<boolean>`), for a set, and for a list of
 * tuples (points).
 *
 * The product of two matrices is the matrix product, which does not
 * commute, and the product of such operands is evaluated from their values.
 * So a product with two of these operands keeps them in their written order
 * (`sortProductOperands()` in `order.ts`): `q·p` with `p` and `q` declared
 * `tensor<number>` and holding matrices is not `p·q`. The simplification of
 * a product does not move one of them past another either
 * (`Product.hasMatrixFactor()` in `arithmetic-mul-div.ts`, the product rule
 * of `simplify-rules.ts`): `p·q·p` is not `p^2·q`. An operand typed
 * `unknown` keeps its written order only beside such an operand, so that a
 * product of calls of functions that were not declared (`f(x)·g(x)`) is
 * still sorted.
 */
export function typeMayHoldMatrix(x: Expression, depth = 0): boolean {
  // An application of an element-wise operator (`Power`, `Add`, `Sin`, …)
  // has the shape of its operands, so its operands are read, not its type:
  // `g(x)^2` with `g` a function that was not declared is typed
  // `broadcastable<number>`, but it is a matrix only if `g(x)` is, and
  // `g(x)` is typed `unknown`.
  if (
    depth < 8 &&
    isFunction(x) &&
    x.operator !== 'List' &&
    x.operatorDefinition?.broadcastable === true
  )
    return x.ops.some((op) => typeMayHoldMatrix(op, depth + 1));
  const t = x.type.type;
  if (t === 'unknown') return false;
  if (!mayBeTensorProductOperand(x)) return false;
  return mayHoldNumericArray(t, 2, 0);
}

/**
 * Is `x` provably a square matrix by its type: a list type with two known
 * and equal dimensions (`matrix<number^(3x3)>`)? The inverse of a product of
 * square matrices is the product of their inverses in reverse order. A
 * vector, a tensor of unknown rank and a matrix of unknown size are not
 * provably square matrices: their power is element-wise or has no value.
 */
export function isSquareMatrixTyped(x: Expression): boolean {
  const t = resolveTypeAlias(x.type.type);
  if (typeof t === 'string' || t.kind !== 'list') return false;
  const d = t.dimensions;
  return !!d && d.length === 2 && d[0] >= 0 && d[0] === d[1];
}

/**
 * Is the value of `x` provably a number: a number literal, a symbol with no
 * declared type (a symbol used in a product is a number), or an operand
 * whose type is a number type? A call typed `unknown` (`h(x)` of a function
 * that was not declared) and an operand typed `any` are not: they may be
 * matrices.
 */
export function isProvablyScalar(x: Expression): boolean {
  if (isSymbol(x) && x.type.type === 'unknown') return true;
  return x.type.matches(new BoxedType('number'));
}

/**
 * Can the type of `x` hold a number? A sum of a matrix and a number adds the
 * number to every entry of the matrix (it is not the number times the identity
 * matrix), so a sum whose terms are not all provably matrices cannot be
 * expanded as a sum of matrices. This is `false` for a matrix, a tensor and
 * a list of lists; `true` for a number, `any`, `value` and a union with a
 * number arm.
 */
export function typeMayHoldNumber(x: Expression): boolean {
  return mayHoldNumericArray(x.type.type, 0, 0);
}

/**
 * Can the value of `x` be a matrix (two axes): is `x` a `Matrix` literal, an
 * operand typed `matrix`, or an operand whose type admits a matrix
 * (`typeMayHoldMatrix()`)? A vector, a list of numbers, a number and an
 * operand typed `unknown` answer `false`.
 */
export function mayBeMatrixValued(x: Expression): boolean {
  return (
    isFunction(x, 'Matrix') ||
    x.type.facts.matrix === true ||
    typeMayHoldMatrix(x)
  );
}

/**
 * Is the type of `x` a list of tuples (a list of points), `list<tuple<...>>`?
 * A list of points is a list that scales by numbers, not a matrix.
 */
export function isPointListOperand(x: Expression): boolean {
  const t = resolveTypeAlias(x.type.type);
  if (typeof t === 'string' || t.kind !== 'list') return false;
  const e = resolveTypeAlias(t.elements);
  return typeof e === 'string' ? e === 'tuple' : e.kind === 'tuple';
}

/**
 * Whether a value of type `t` may be an array of numbers with `rank` axes
 * or more (`rank` 0: a number). A type that states nothing (`any`,
 * `unknown`, a bare `list`) answers `true`. A tuple, a set, a string, a
 * boolean, a record and a function answer `false`.
 */
function mayHoldNumericArray(t: Type, rank: number, depth: number): boolean {
  // The depth limit stops a self-referential alias.
  if (depth > 16) return true;
  const r = resolveTypeAlias(t);
  if (typeof r === 'string') {
    if (
      r === 'any' ||
      r === 'unknown' ||
      r === 'value' ||
      r === 'list' ||
      r === 'collection' ||
      r === 'indexed_collection'
    )
      return true;
    return rank === 0 && isSubtype(r, 'number');
  }
  const next = (u: Type, n: number) => mayHoldNumericArray(u, n, depth + 1);
  switch (r.kind) {
    case 'union':
      return r.types.some((arm) => next(arm, rank));
    case 'intersection':
      return r.types.every((arm) => next(arm, rank));
    case 'numeric':
      return rank === 0;
    case 'list': {
      if (rank === 0) return false;
      const dims = r.dimensions;
      // A tensor of unknown rank (`tensor<U>`) holds every rank.
      if (dims === null) return next(r.elements, 0);
      if (dims !== undefined) return dims.length >= rank && next(r.elements, 0);
      return next(r.elements, rank - 1);
    }
    case 'collection':
    case 'indexed_collection':
      return rank > 0 && next(r.elements, rank - 1);
    case 'broadcastable':
      // `broadcastable<T>` is `T` or a tensor of `T` cells of any rank.
      return next(r.elements, 0) || next(r.elements, rank);
    default:
      // A tuple, a set, a record, a dictionary, a function.
      return false;
  }
}

/**
 * Can a product with the canonical factors `xs` have a matrix factor? This
 * is `true` when a factor can be a matrix (`mayBeTensorProductOperand()`: a
 * matrix, a collection, the call `g(x)` of a function that was not
 * declared) and every factor is valid.
 *
 * A nested product is spliced into the outer product before it is sorted
 * only when this is `true`: then the outer product keeps the order of the
 * factors that can be matrices. Otherwise the order of the factors does not
 * matter, and the nested product is made canonical on its own, as it was
 * before. A product with an invalid factor is not sorted at all, so a splice
 * would change its form.
 */
export function productMayHaveMatrix(xs: ReadonlyArray<Expression>): boolean {
  return xs.every((x) => x.isValid) && xs.some(mayBeTensorProductOperand);
}
