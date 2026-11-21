/**
 * The lowering of the matrix operators (`README.md`, "Matrices"): a matrix
 * is a list of rank 2 whose rows have one stated length, the shape that a
 * build can make. Each operator settles the shape of its value from the
 * shapes of its operands and declines a shape it cannot settle. The
 * operators that read whole rows and columns in a data-dependent order
 * (`Determinant`, `Inverse`, `MatrixPower`, `RowReduce`) are the kernels
 * of the runtime (`matrix-runtime.ts`), JavaScript only; the others are
 * builds of reads of the elements.
 */

import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import type { Expression } from '../../global-types.js';
import { isSubLane, type Length, type V } from './ir.js';
import { rowOfHead, rowOfOp } from './operators.js';
import { decline, type Fn, type Lowering } from './lower-context.js';
import { MAX_MATRIX_POWER_EXPONENT } from '../../numerics/value-scaled-caps.js';
import type { listLowering } from './lower-lists.js';

/** The heads that `matrix()` lowers. */
export const MATRIX_HEADS: readonly string[] = Object.freeze([
  'Matrix',
  'Transpose',
  'ConjugateTranspose',
  'Trace',
  'Diagonal',
  'Determinant',
  'Inverse',
  'MatrixPower',
  'MatrixMultiply',
  'RowReduce',
  'Rank',
  'Shape',
  'Flatten',
  'Reshape',
  'Cross',
]);

export function matrixLowering(
  cx: Lowering,
  lists: ReturnType<typeof listLowering>
) {
  const { b, type } = cx;
  const integer = (n: number) => b.constant(n, 'integer');
  const op = (name: string) => rowOfOp(cx.rows, name)!.row;
  const length = (n: Length): V => (typeof n === 'number' ? integer(n) : n.v);
  /** The element of the list `l` at the index `k` from 0, in range. */
  const at = (l: V, k: V): V => lists.listSource(l).at(k);
  /** The list of `n` elements whose element at `k` is `f(k)`. */
  const build = (e: Fn, n: V, f: (k: V) => V): V =>
    lists.over(e, { length: n, at: (k) => k }, '', (_x, k) => f(k), false, e);
  /** The sum from 0 of `f` at each index below `n`. */
  const sum = (e: Fn, n: V, f: (k: V) => V): V =>
    lists.reduce(
      e,
      rowOfHead(cx.rows, 'Add')!,
      [{ length: n, at: f }],
      integer(0)
    );

  /** The value of the operand `x` of `e`: real or integer numbers, no
   *  tuple and no list of tuples (the interpreter reads a tuple as one
   *  element of a matrix), of rank at most `rank`. */
  const numbers = (e: Fn, x: Expression, rank = 2): V => {
    const v = cx.value(x)!;
    if (cx.tuples.has(v))
      decline(e, `${e.operator} of a tuple or of a list of tuples`);
    if (!isSubLane(type(v).lane, 'real'))
      decline(e, `${e.operator} of other than real numbers`);
    if (type(v).shape.length > rank)
      decline(e, `${e.operator} of a list of rank ${type(v).shape.length}`);
    return v;
  };

  /** The order of the square matrix `m`: both lengths stated and equal.
   *  The interpreter's value of a matrix that is not square is the error
   *  `expected-square-matrix`, and a number of rows known at run time only
   *  does not settle that the matrix is square. */
  const order = (e: Fn, m: V): number => {
    const shape = type(m).shape;
    if (shape.length !== 2)
      decline(e, `${e.operator} of a value that is not a matrix`);
    const [r, c] = shape;
    if (typeof r !== 'number' || typeof c !== 'number')
      decline(
        e,
        `${e.operator} of a matrix whose number of rows is known at run time only`
      );
    if (r !== c) decline(e, `${e.operator} of a matrix that is not square`);
    return r;
  };

  /** The elements of the matrix `m`, row by row. */
  const flatten = (e: Fn, m: V): V => {
    const [r, c] = type(m).shape;
    if (typeof c !== 'number') decline(e, 'a list of lists of run-time length');
    const n =
      typeof r === 'number'
        ? integer(r * c)
        : cx.apply(e, 'Multiply', [r.v, integer(c)]);
    const columns = integer(c);
    return build(e, n, (k) =>
      at(
        at(m, cx.apply(e, 'Floor', [cx.apply(e, 'Divide', [k, columns])])),
        cx.apply(e, 'Mod', [k, columns])
      )
    );
  };

  /** The transpose of the matrix `m`: its number of rows must be stated
   *  (the length of the rows of the result). */
  const transpose = (e: Fn, m: V): V => {
    const [r, c] = type(m).shape;
    if (typeof r !== 'number')
      decline(
        e,
        `${e.operator} of a matrix whose number of rows is known at run time only (a list of lists of run-time length)`
      );
    return build(e, length(c), (j) =>
      build(e, integer(r), (i) => at(at(m, i), j))
    );
  };

  /** `MatrixMultiply(A, B)` of matrices and vectors: the matrix product,
   *  the product of a matrix and a vector on either side, and the inner
   *  product of two vectors, each entry the sum from 0 of the products in
   *  the order of the inner index. */
  const product = (e: Fn): V => {
    const [a, c] = e.ops.map((x) => numbers(e, x));
    const [sa, sc] = [type(a).shape, type(c).shape];
    if (sa.length === 0 || sc.length === 0)
      decline(e, 'MatrixMultiply of a scalar');
    const [ka, kc] = [sa[sa.length - 1], sc[0]];
    if (typeof ka === 'number' && typeof kc === 'number' && ka !== kc)
      decline(e, 'MatrixMultiply of operands of two inner lengths');
    // A stated inner length, when there is one, so that a short sum is
    // written out.
    const k = length(typeof ka === 'number' ? ka : kc);
    const dot = (x: (p: V) => V, y: (p: V) => V): V =>
      sum(e, k, (p) => cx.apply(e, 'Multiply', [x(p), y(p)]));
    if (sa.length === 1 && sc.length === 1)
      return dot(
        (p) => at(a, p),
        (p) => at(c, p)
      );
    if (sa.length === 1)
      return build(e, length(sc[1]), (j) =>
        dot(
          (p) => at(a, p),
          (p) => at(at(c, p), j)
        )
      );
    return build(e, length(sa[0]), (i) => {
      const row = at(a, i);
      return sc.length === 1
        ? dot(
            (p) => at(row, p),
            (p) => at(c, p)
          )
        : build(e, length(sc[1]), (j) =>
            dot(
              (p) => at(row, p),
              (p) => at(at(c, p), j)
            )
          );
    });
  };

  /** `Reshape(x, Tuple(d1, …, dk))` of constant positive integers: the
   *  elements of `x`, row by row, cycled to fill the shape, as the
   *  interpreter's. */
  const reshape = (e: Fn): V => {
    const x = numbers(e, e.ops[0]);
    const dims = e.ops[1];
    const sizes = isFunction(dims, 'Tuple')
      ? // Each dimension is lowered, so that a name that holds it is a
        // capture of the program (`symbolDeps`), and must be a constant.
        dims.ops.map((d) => {
          const v = cx.value(d)!;
          return type(v).shape.length === 0 ? (cx.constant(v) ?? NaN) : NaN;
        })
      : [];
    if (
      sizes.length === 0 ||
      !sizes.every((n) => Number.isInteger(n) && n >= 1)
    )
      decline(
        e,
        'Reshape to a shape that is not a tuple of constant positive integers'
      );
    if (type(x).shape.length === 0) decline(e, 'Reshape of a scalar');
    const flat = type(x).shape.length === 1 ? x : flatten(e, x);
    const n = lists.listSource(flat).length;
    const level = (j: number, prefix: V | undefined): V =>
      build(e, integer(sizes[j]), (i) => {
        const k =
          prefix === undefined
            ? i
            : cx.apply(e, 'Add', [
                cx.apply(e, 'Multiply', [prefix, integer(sizes[j])]),
                i,
              ]);
        return j === sizes.length - 1
          ? at(flat, cx.apply(e, 'Mod', [k, n]))
          : level(j + 1, k);
      });
    return level(0, undefined);
  };

  /** `Cross(u, v)` of two vectors of three real numbers (lists or
   *  tuples): a tuple when both are tuples, as the interpreter's. */
  const cross = (e: Fn): V => {
    const [u, v] = e.ops.map((x) => {
      const w = cx.value(x)!;
      const t = type(w);
      if (
        !isSubLane(t.lane, 'real') ||
        t.shape.length !== 1 ||
        t.shape[0] !== 3 ||
        (cx.tuples.has(w) && cx.tuples.get(w) !== 0)
      )
        decline(e, 'Cross of other than two vectors of three real numbers');
      return w;
    });
    const tuple = cx.tuples.has(u) && cx.tuples.has(v);
    if (cx.tuples.has(u) !== cx.tuples.has(v))
      decline(e, 'Cross of a tuple and a list');
    const [x, y] = [u, v].map((w) => [0, 1, 2].map((k) => at(w, integer(k))));
    const term = (i: number, j: number) =>
      cx.apply(e, 'Subtract', [
        cx.apply(e, 'Multiply', [x[i], y[j]]),
        cx.apply(e, 'Multiply', [x[j], y[i]]),
      ]);
    const w = cx.list(e, [term(1, 2), term(2, 0), term(0, 1)]);
    if (tuple) cx.tuples.set(w, 0);
    return w;
  };

  /** The operators of `MATRIX_HEADS`. */
  const matrix = (e: Fn): V => {
    const h = e.operator;
    const arity =
      h === 'MatrixMultiply' ||
      h === 'Reshape' ||
      h === 'Cross' ||
      h === 'MatrixPower'
        ? 2
        : h === 'Flatten' && e.nops === 2
          ? 2
          : 1;
    if (e.nops !== arity)
      decline(e, `${h} of ${e.nops} operands is not supported by the compiler`);
    if (h === 'Cross') return cross(e);
    if (cx.interval && h !== 'Matrix') decline(e, `${h} on interval-js`);
    if (h === 'Matrix') return cx.value(e.ops[0])!;
    if (h === 'MatrixMultiply') return product(e);
    if (h === 'Reshape') return reshape(e);
    const m = numbers(e, e.ops[0]);
    const rank = type(m).shape.length;
    // An empty list of rows has rank 1 and the shape `(0)` in the
    // interpreter: a matrix whose number of rows is known at run time only
    // has no settled rank.
    if (
      (h === 'Rank' || h === 'Shape') &&
      rank === 2 &&
      typeof type(m).shape[0] !== 'number'
    )
      decline(
        e,
        `${h} of a matrix whose number of rows is known at run time only (an empty list has rank 1)`
      );
    if (h === 'Rank') return integer(rank);
    if (h === 'Shape') {
      if (rank === 0) decline(e, 'Shape of a scalar (an empty tuple)');
      const v = cx.list(e, type(m).shape.map(length));
      cx.tuples.set(v, 0);
      return v;
    }
    if (h === 'Flatten') {
      // A depth of 0 leaves the rows; any other flattens the one nesting
      // level a matrix has (`+oo` is complete).
      const depth =
        e.nops === 2
          ? isSymbol(e.ops[1], 'PositiveInfinity')
            ? Infinity
            : cx.constant(cx.value(e.ops[1])!)
          : Infinity;
      if (
        depth === undefined ||
        !(depth === Infinity || (Number.isInteger(depth) && depth >= 0))
      )
        decline(
          e,
          'Flatten to a depth that is not a constant non-negative integer'
        );
      return rank === 0
        ? cx.list(e, [m])
        : rank === 1 || depth === 0
          ? m
          : flatten(e, m);
    }
    if (h === 'Transpose' || h === 'ConjugateTranspose')
      return rank < 2 ? m : transpose(e, m);
    if (h === 'Trace') {
      if (rank === 0) return m;
      const n = integer(order(e, m));
      return sum(e, n, (k) => at(at(m, k), k));
    }
    if (h === 'Diagonal') {
      if (rank === 0) return m;
      const [r, c] = type(m).shape;
      if (rank === 2) {
        // The main diagonal: `Min(rows, columns)` elements.
        const n =
          typeof r === 'number' && typeof c === 'number'
            ? integer(Math.min(r, c))
            : cx.apply(e, 'Min', [length(r), length(c)]);
        return build(e, n, (k) => at(at(m, k), k));
      }
      // The square matrix with `m` on its diagonal and 0 elsewhere.
      if (typeof r !== 'number')
        decline(
          e,
          'Diagonal of a vector of run-time length (a list of lists of run-time length)'
        );
      const n = integer(r);
      return build(e, n, (i) =>
        build(e, n, (j) =>
          cx.branch(
            e,
            cx.apply(e, 'Equal', [i, j]),
            () => at(m, i),
            () => integer(0),
            true
          )!
        )
      );
    }
    // The kernels of the runtime, of a square matrix (`RowReduce`: any
    // matrix).
    if (h === 'RowReduce') {
      if (rank !== 2) decline(e, 'RowReduce of a value that is not a matrix');
      // The interpreter chops the entries at the engine's tolerance at the
      // evaluation (`ce.chop()`); the code holds it at the compilation.
      return cx.apply(e, op('mrowreduce'), [
        m,
        b.constant(e.engine.tolerance, 'real'),
      ]);
    }
    const n = order(e, m);
    if (h === 'Determinant')
      return n === 1
        ? at(at(m, integer(0)), integer(0))
        : cx.apply(e, op('mdet'), [flatten(e, m), integer(n)]);
    if (h === 'Inverse') return cx.apply(e, op('minverse'), [m]);
    // `MatrixPower(m, p)`: the interpreter's value of a power by a real
    // exponent is a root of the matrix for a half-integer, which no kernel
    // computes.
    // A literal exponent past the cap of the interpreter, which keeps the
    // power unevaluated (`value-scaled-caps.ts`), declines; a computed one
    // is a matrix of NaN at run time (`matrixPower()`).
    const exponent = e.ops[1];
    if (isNumber(exponent) && Math.abs(exponent.re) > MAX_MATRIX_POWER_EXPONENT)
      decline(e, 'MatrixPower by an exponent past the cap of the interpreter');
    const p = cx.scalar(e.ops[1]);
    if (type(p).lane !== 'integer')
      decline(e, 'MatrixPower by an exponent that is not an integer');
    return cx.apply(e, op('mpower'), [m, p]);
  };

  return { matrix };
}
