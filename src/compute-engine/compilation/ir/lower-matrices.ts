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
import { isSubLane, scalarType, type Length, type V } from './ir.js';
import { rowOfHead, rowOfOp, type OperatorRow } from './operators.js';
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

/** The heads that read a list of lists of run-time length whose rows have
 *  one length (CE-1736, `rowWidths` of the lowering). */
const TABLE_HEADS: ReadonlySet<string> = new Set([
  'Transpose',
  'ConjugateTranspose',
  'Trace',
  'MatrixMultiply',
  'Rank',
  'Shape',
  'Diagonal',
  'Determinant',
  'Inverse',
  'MatrixPower',
]);

/** The operators of a square matrix: a list of rank 2 of a run-time size
 *  is read as its rows (`matrixRows()`), whose order is checked at run
 *  time (`rowsKernel()`, `agree()`). */
const SQUARE_HEADS: ReadonlySet<string> = new Set([
  'Trace',
  'Determinant',
  'Inverse',
  'MatrixPower',
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
  /** The sum from `zero` (the integer 0, or the value 0 of a check of
   *  `agree()`) of `f` at each index below `n`. */
  const sum = (e: Fn, n: V, f: (k: V) => V, zero = integer(0)): V =>
    lists.reduce(e, rowOfHead(cx.rows, 'Add')!, [{ length: n, at: f }], zero);

  /** The value of the operand `x` of `e`: real or integer numbers, no
   *  tuple and no list of tuples (the interpreter reads a tuple as one
   *  element of a matrix), of rank at most `rank`. */
  const numbers = (e: Fn, x: Expression, rank = 2): V => {
    // A list of lists of run-time length that the program made (the lane
    // `rows`, CE-1736): its rows can have different lengths. `Flatten`
    // reads it (`matrix()`), and `Transpose`, `MatrixMultiply` and `Trace`
    // read one whose rows have one length (`rowWidths`, `table()`); the
    // other operators need an order known at compile time. A name is read
    // whole too (a local that holds such a value).
    const v = cx.wholeRows(x);
    if (type(v).lane === 'rows' && cx.rowsParams.has(v)) {
      if (e.operator === 'Flatten' && cx.rowsElements.has(v)) return v;
      if (cx.rowWidths.has(v) && cx.rowsElements.has(v)) {
        if (TABLE_HEADS.has(e.operator)) return v;
        decline(
          e,
          `${e.operator} of a matrix whose number of rows is known at run time only (a list of lists of run-time length)`
        );
      }
      decline(
        e,
        `${e.operator} of a list of lists of run-time length (its rows can have different lengths)`
      );
    }
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

  /** The number of rows of `m`, of the lane `rows` (`rowCounts`). */
  const rowCount = (m: V): V =>
    cx.rowCounts.get(m) ?? b.op('rows.count', [m], scalarType('integer'));

  /** The element at the row `i` and the column `j` of `m`, of the lane
   *  `rows`. */
  const rowsAt = (m: V, i: V, j: V): V => {
    const lane = cx.rowsElements.get(m)!;
    return b.op(
      lane === 'integer' ? 'rows.get.int' : 'rows.get',
      [m, i, j],
      scalarType(lane)
    );
  };

  /** The values `x` and `y` are one number at run time: one value, or
   *  equal constants. */
  const same = (x: V, y: V): boolean =>
    x === y ||
    (cx.constant(x) !== undefined && cx.constant(x) === cx.constant(y));

  /** JavaScript outside the interval and the bigint modes: the target
   *  where two lengths are compared at run time (`agree()`). */
  const checks = cx.runtimeLengths && !cx.interval && !cx.bigint;

  /** The initial value 0 of the sums of an operator that reads two
   *  lengths `x` and `y` that must be equal: the inner lengths of
   *  `MatrixMultiply` (`check` is `rows.agree`), the numbers of rows and of
   *  columns of `Trace` (`rows.square`). Where `same()` does not prove them
   *  equal, on JavaScript, the value 0 of the check of `agree()` of
   *  `lower-lists.ts`, made here, before the builds and the sums, once;
   *  every sum reads it as its initial value, so that `dce` keeps it and no
   *  count or length changes (a sum of a constant length stays written
   *  out). Elsewhere, and where `same()` proves them equal, the constant 0,
   *  as before (a value of the lane `rows` is JavaScript only). Two
   *  constants that differ are the callers' decline. */
  const agree = (
    x: V,
    y: V,
    check: 'rows.agree' | 'rows.square' = 'rows.agree'
  ): V => lists.agree(x, y, check)?.zero ?? integer(0);

  /** `Transpose`, `ConjugateTranspose`, `Trace`, `Rank` and `Shape` of `m`,
   *  a value of the lane `rows` of reals or integers whose rows have one
   *  length (CE-1736, `rowWidths`): the transpose, rows of the elements of
   *  a column, whose rows have the number of rows of `m` as their length;
   *  the trace, whose number of rows and length of the rows are compared
   *  (`agree()`); the rank 2 and the tuple of the number of rows and the
   *  length of the rows (the interpreter's empty list of rows has rank 1,
   *  a known limitation of `docs/COMPILATION-MODEL.md`). */
  const table = (e: Fn, m: V): V => {
    const w = cx.rowWidths.get(m)!;
    const n = rowCount(m);
    if (e.operator === 'Rank') return integer(2);
    if (e.operator === 'Shape') {
      const v = cx.list(e, [n, w]);
      cx.tuples.set(v, 0);
      return v;
    }
    if (e.operator === 'Trace') {
      const [cn, cw] = [cx.constant(n), cx.constant(w)];
      if (cn !== undefined && cw !== undefined && cn !== cw)
        decline(e, 'Trace of a matrix that is not square');
      const zero = agree(n, w, 'rows.square');
      return sum(e, n, (k) => rowsAt(m, k, k), zero);
    }
    if (e.operator === 'Diagonal')
      return build(e, cx.apply(e, 'Min', [n, w]), (k) => rowsAt(m, k, k));
    if (
      e.operator === 'Determinant' ||
      e.operator === 'Inverse' ||
      e.operator === 'MatrixPower'
    )
      return rowsKernel(e, m, n, w);
    return build(e, w, (j) => build(e, n, (i) => rowsAt(m, i, j)));
  };

  /** `Determinant`, `Inverse` and `MatrixPower` of `m`, a value of the lane
   *  `rows` whose rows have one length, of `n` rows of `w` elements: the
   *  kernels of a square matrix, of the order `n`. Where `same()` does not
   *  prove `n` and `w` equal, the order is `rows.order`, which throws a
   *  `RangeError` where they differ (the interpreter's
   *  `expected-square-matrix`); each kernel reads the order, so that the
   *  check runs before it, and the rows of `Inverse` and `MatrixPower` have
   *  that order as their count and their length, so that a reader of the
   *  result that reads no element runs the check too. */
  const rowsKernel = (e: Fn, m: V, n: V, w: V): V => {
    const [cn, cw] = [cx.constant(n), cx.constant(w)];
    if (cn !== undefined && cw !== undefined && cn !== cw)
      decline(e, `${e.operator} of a matrix that is not square`);
    const order = same(n, w)
      ? n
      : b.op('rows.order', [n, w], scalarType('integer'));
    // The kernel reads the elements row by row (`rows.flat`) and the order;
    // its value at the order 1 is the element.
    if (e.operator === 'Determinant')
      return cx.apply(e, op('mdet'), [
        rowsFlat(e, m, cx.rowsElements.get(m)!),
        order,
      ]);
    const out =
      e.operator === 'Inverse'
        ? b.op('rows.inverse', [m, order], scalarType('rows'))
        : b.op('rows.power', [m, exponent(e), order], scalarType('rows'));
    cx.rowsParams.add(out);
    cx.rowsElements.set(out, 'real');
    cx.rowCounts.set(out, order);
    cx.rowWidths.set(out, order);
    return out;
  };

  /** The exponent of `MatrixPower(m, p)`: the interpreter's value of a
   *  power by a real exponent is a root of the matrix for a half-integer,
   *  which no kernel computes. A literal exponent past the cap of the
   *  interpreter, which keeps the power unevaluated
   *  (`value-scaled-caps.ts`), declines; a computed one is a matrix of NaN
   *  at run time (`matrixPower()`). */
  const exponent = (e: Fn): V => {
    const x = e.ops[1];
    if (isNumber(x) && Math.abs(x.re) > MAX_MATRIX_POWER_EXPONENT)
      decline(e, 'MatrixPower by an exponent past the cap of the interpreter');
    const p = cx.scalar(e.ops[1]);
    if (type(p).lane !== 'integer')
      decline(e, 'MatrixPower by an exponent that is not an integer');
    return p;
  };

  /** `MatrixMultiply(A, B)` of matrices and vectors: the matrix product,
   *  the product of a matrix and a vector on either side, and the inner
   *  product of two vectors, each entry the sum from 0 of the products in
   *  the order of the inner index. */
  const product = (e: Fn): V => {
    const [a, c] = e.ops.map((x) => numbers(e, x));
    if (type(a).lane === 'rows' || type(c).lane === 'rows')
      return tableProduct(e, a, c);
    const [sa, sc] = [type(a).shape, type(c).shape];
    if (sa.length === 0 || sc.length === 0)
      decline(e, 'MatrixMultiply of a scalar');
    const [ka, kc] = [sa[sa.length - 1], sc[0]];
    if (typeof ka === 'number' && typeof kc === 'number' && ka !== kc)
      decline(e, 'MatrixMultiply of operands of two inner lengths');
    // A stated inner length, when there is one, so that a short sum is
    // written out.
    const k = length(typeof ka === 'number' ? ka : kc);
    // The check of inner lengths known at run time (`agree()`).
    const zero = agree(length(ka), length(kc));
    const dot = (x: (p: V) => V, y: (p: V) => V): V =>
      sum(e, k, (p) => cx.apply(e, 'Multiply', [x(p), y(p)]), zero);
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

  /** `MatrixMultiply(A, B)` where `A` or `B` is a value of the lane `rows`
   *  whose rows have one length (CE-1736), and the other is such a value,
   *  a matrix or a vector. Inner lengths that are not one value or equal
   *  constants are compared at run time (`agree()`): the interpreter's
   *  value of other lengths is the error `incompatible-dimensions`. */
  const tableProduct = (e: Fn, a: V, c: V): V => {
    type Table = { rows: V; columns: V; at: (i: V, j: V) => V };
    type Operand = Table | { length: V; at: (k: V) => V };
    const operand = (m: V): Operand => {
      const shape = type(m).shape;
      if (type(m).lane === 'rows')
        return {
          rows: rowCount(m),
          columns: cx.rowWidths.get(m)!,
          at: (i: V, j: V) => rowsAt(m, i, j),
        };
      if (shape.length === 2)
        return {
          rows: length(shape[0]),
          columns: length(shape[1]),
          at: (i: V, j: V) => at(at(m, i), j),
        };
      if (shape.length === 1)
        return { length: length(shape[0]), at: (k: V) => at(m, k) };
      decline(e, 'MatrixMultiply of a scalar');
    };
    const [x, y] = [operand(a), operand(c)];
    const inner = 'columns' in x ? x.columns : x.length;
    const other = 'rows' in y ? y.rows : y.length;
    const [ci, co] = [cx.constant(inner), cx.constant(other)];
    if (ci !== undefined && co !== undefined && ci !== co)
      decline(e, 'MatrixMultiply of operands of two inner lengths');
    // A constant inner length, when there is one, so that a short sum is
    // written out; the check of the inner lengths (`agree()`).
    const k = ci !== undefined ? inner : other;
    const zero = agree(inner, other);
    const dot = (f: (p: V) => V, g: (p: V) => V): V =>
      sum(e, k, (p) => cx.apply(e, 'Multiply', [f(p), g(p)]), zero);
    if ('length' in x) {
      const m = y as Table;
      return build(e, m.columns, (j) => dot(x.at, (p) => m.at(p, j)));
    }
    if ('length' in y)
      return build(e, x.rows, (i) => dot((p) => x.at(i, p), y.at));
    return build(e, x.rows, (i) =>
      build(e, y.columns, (j) =>
        dot(
          (p) => x.at(i, p),
          (p) => y.at(p, j)
        )
      )
    );
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

  /** The depth of `Flatten(x, d)`: `+oo` without `d`; a `d` that is not a
   *  constant non-negative integer or `+oo` declines. */
  const flattenDepth = (e: Fn): number => {
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
    return depth;
  };

  /** `Flatten(g)` and `Flatten(g, d)` of an input or a parameter `g` of the
   *  lane `rows` (a list of lists whose rows can have different lengths),
   *  or of such a part of a tuple input (`chunks()` of `lower-lists.ts`):
   *  the elements of its rows, in order, copied from the host's rows by
   *  the region `rows.flat`. A depth of 1 or more flattens the one nesting
   *  level; a depth of 0, whose value is the rows, declines. `undefined`
   *  for another operand. */
  const flattenRows = (e: Fn): V | undefined => {
    const x = e.ops[0];
    const lane = cx.rowsLaneOf(x);
    if (
      lane === undefined ||
      !(isSymbol(x) || (isFunction(x, 'At') && isSymbol(x.ops[0])))
    )
      return undefined;
    const r = lists.chunks(x);
    if (r === undefined || typeof r === 'number' || r.row === undefined)
      return undefined;
    if (flattenDepth(e) === 0)
      decline(
        e,
        'Flatten to the depth 0 of a list of rows of different lengths (its value is the rows)'
      );
    return rowsFlat(e, r.rows(), r.lane ?? lane);
  };

  /** The elements of the rows of `g`, of the lane `rows` of elements of
   *  `lane`, in order (the region `rows.flat`). */
  const rowsFlat = (e: Fn, g: V, lane: 'integer' | 'real'): V =>
    cx.region(
      lane === 'integer' ? 'rows.flat.int' : 'rows.flat',
      [g],
      [],
      () => [],
      e
    )[1];

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
    if (h === 'Flatten') {
      const v = flattenRows(e);
      if (v !== undefined) return v;
    }
    const m = numbers(e, e.ops[0]);
    // The matrix operators of a list of lists of run-time length whose
    // rows have one length (CE-1736).
    if (type(m).lane === 'rows' && h !== 'Flatten') return table(e, m);
    // An operator of a square matrix of a list of rank 2 of a run-time
    // size (a build of a constant row length): its rows, whose order is
    // checked at run time.
    if (
      checks &&
      SQUARE_HEADS.has(h) &&
      type(m).shape.length === 2 &&
      type(m).shape.some((d) => typeof d !== 'number')
    ) {
      const rows = lists.matrixRows(e, m);
      if (rows !== undefined) return table(e, rows);
    }
    // `Flatten` of a list of lists of run-time length that the program
    // made (CE-1736): the elements of its rows.
    if (type(m).lane === 'rows') {
      if (flattenDepth(e) === 0)
        decline(
          e,
          'Flatten to the depth 0 of a list of rows of different lengths (its value is the rows)'
        );
      return rowsFlat(e, m, cx.rowsElements.get(m)!);
    }
    const rank = type(m).shape.length;
    // A matrix whose number of rows is known at run time only has rank 2:
    // the interpreter's empty list of rows has rank 1 and the shape `(0)`,
    // a known limitation of `docs/COMPILATION-MODEL.md`.
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
      const depth = flattenDepth(e);
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
    return cx.apply(e, op('mpower'), [m, exponent(e)]);
  };

  /** The element at each row and column of a value that `elementwise()`
   *  made: the operation on the elements of its operands, so that an
   *  operation of such values computes each element once. */
  const tableElements = new Map<V, (i: V, j: V) => V>();

  /** The row `r`, which threads, of the values `args`, one of them of the
   *  lane `rows` (a matrix of run-time size, CE-1736): the interpreter's
   *  value is the matrix of the operation on the elements at each row and
   *  column. `apply(elements)` applies `r` to the elements. An operand is
   *  such a value whose rows have one length (`rowWidths`), a list of rank
   *  2 of reals or integers, or a scalar, the same at every element. The
   *  numbers of rows of the matrices, and the lengths of their rows, that
   *  `same()` does not prove equal are compared once, before the builds
   *  (`agreedLength()` of `lower-lists.ts`): the interpreter gives
   *  `incompatible-dimensions` for two matrices of two sizes. The value is
   *  a build of rows of one length, which records both lengths
   *  (`rowCounts`, `rowWidths`), so the matrix operators read it.
   *  Declined: rows that can have different lengths, a flat list (the
   *  interpreter adds its element `i` to each element of the row `i`, and
   *  multiplies the matrix and the vector), a tuple, the product of two
   *  matrices (the matrix product), a power whose base is a matrix (the
   *  matrix power at an integer exponent, element by element at another),
   *  and elements that are not real or integer numbers. */
  const elementwise = (
    e: Expression,
    r: OperatorRow,
    args: V[],
    apply: (elements: V[]) => V
  ): V => {
    type Table = { rows: V; columns: V; at: (i: V, j: V) => V };
    // A scalar is its value, a number.
    const operand = (m: V): Table | V => {
      const t = type(m);
      if (t.lane === 'rows') {
        if (!cx.rowWidths.has(m) || !cx.rowsElements.has(m))
          decline(
            e,
            `${r.head} of a list of lists of run-time length (its rows can have different lengths)`
          );
        return {
          rows: rowCount(m),
          columns: cx.rowWidths.get(m)!,
          at: tableElements.get(m) ?? ((i: V, j: V) => rowsAt(m, i, j)),
        };
      }
      if (cx.tuples.has(m))
        decline(e, `${r.head} of a matrix and a tuple or a list of tuples`);
      if (t.shape.length === 0) return m;
      if (t.shape.length !== 2 || !isSubLane(t.lane, 'real'))
        decline(
          e,
          `${r.head} of a matrix and a list (the interpreter's value is ${r.head === 'Multiply' ? 'the product of the matrix and the vector' : 'the operation of the element i of the list with each element of the row i'})`
        );
      return {
        rows: length(t.shape[0]),
        columns: length(t.shape[1]),
        at: (i: V, j: V) => at(at(m, i), j),
      };
    };
    const operands = args.map(operand);
    const tables = operands.filter((x): x is Table => typeof x !== 'number');
    if (
      (r.head === 'Multiply' && tables.length > 1) ||
      (r.head === 'Power' && typeof operands[0] !== 'number')
    )
      decline(
        e,
        `${r.head} of a matrix${r.head === 'Power' ? ' as a base' : ' with a matrix'}: the interpreter's value is the matrix ${r.head === 'Power' ? 'power' : 'product'}`
      );
    // The number of rows and the length of the rows, compared with those of
    // each other matrix.
    const agreed = (lengths: V[]): V => {
      let n = lengths[0];
      for (const m of lengths.slice(1)) {
        const [k, c] = [lists.knownLength(n), lists.knownLength(m)];
        if (k !== undefined && c !== undefined && k !== c)
          decline(e, `${r.head} of matrices of two sizes`);
        const x = lists.agreedLength(e, n, m);
        if (x === undefined) decline(e, `${r.head} of matrices of two sizes`);
        n = x;
      }
      return n;
    };
    const n = agreed(tables.map((x) => x.rows));
    const w = agreed(tables.map((x) => x.columns));
    const element = (i: V, j: V): V => {
      const x = apply(
        operands.map((o) => (typeof o === 'number' ? o : o.at(i, j)))
      );
      const t = type(x);
      if (
        t.shape.length > 0 ||
        cx.tuples.has(x) ||
        (t.lane !== 'real' && t.lane !== 'integer')
      )
        decline(
          e,
          `${r.head} of a matrix whose elements are not real or integer numbers`
        );
      return x;
    };
    const out = build(e as Fn, n, (i) =>
      build(e as Fn, w, (j) => element(i, j))
    );
    tableElements.set(out, element);
    return out;
  };

  return { matrix, elementwise };
}
