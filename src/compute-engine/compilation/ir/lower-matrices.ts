/**
 * The lowering of the matrix operators (`README.md`, "Matrices"): a matrix
 * is a list of rank 2 whose rows have one length, stated or (on JavaScript)
 * a value. Each operator settles the shape of its value from the
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
import { rowOfHead, rowOfOp } from './operators.js';
import { decline, type Fn, type Lowering } from './lower-context.js';
import { MAX_MATRIX_POWER_EXPONENT } from '../../numerics/value-scaled-caps.js';
import type { listLowering } from './lower-lists.js';

/** The decline of the operator `head` of a matrix whose rows have a
 *  run-time length. */
const RUN_TIME_SIZE = (head: string) =>
  `${head} of a matrix whose number of rows is known at run time only (a list of lists of run-time length)`;

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
  /** The sum from `zero` (the integer 0, or the value 0 of a check of
   *  `agree()`) of `f` at each index below `n`. */
  const sum = (e: Fn, n: V, f: (k: V) => V, zero = integer(0)): V =>
    lists.reduce(e, rowOfHead(cx.rows, 'Add')!, [{ length: n, at: f }], zero);

  /** The value of the operand `x` of `e`: real or integer numbers, no
   *  tuple and no list of tuples (the interpreter reads a tuple as one
   *  element of a matrix), of rank at most `rank`. */
  const numbers = (e: Fn, x: Expression, rank = 2): V => {
    // A list of lists of run-time length (the lane `rows`, CE-1736). One
    // whose rows have one length (`rowWidths`: an input or a parameter of a
    // matrix type, a build) is a matrix, read as a list of rank 2 of its
    // two lengths (`asMatrix()`). `Flatten` reads another one (`matrix()`),
    // whose rows can have different lengths; the other operators decline
    // it. A name is read whole too (a local that holds such a value).
    const v = cx.wholeRows(x);
    if (type(v).lane === 'rows' && cx.rowsParams.has(v)) {
      const m = cx.asMatrix(e, v);
      if (m !== undefined) return m;
      if (e.operator === 'Flatten' && cx.rowsElements.has(v)) return v;
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

  /** The transpose of the matrix `m`: the rows of the elements of each
   *  column, whose length is the number of rows of `m`. */
  const transpose = (e: Fn, m: V): V => {
    const [r, c] = type(m).shape.map(length);
    return build(e, c, (j) => build(e, r, (i) => at(at(m, i), j)));
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

  /** `f` of `given` element by element, where the lists among them are two
   *  matrices or more (lists of rank 2, no tuple) whose shapes the type
   *  does not prove the same: the build of the rows, each the build of `f`
   *  of the elements at one place and of the scalars. Each of the two
   *  lengths is one value for all of them, compared once at run time
   *  before the builds where it is not proved (`agreedLength()` of
   *  `lower-lists.ts`, the check of two flat lists): the interpreter's
   *  value of matrices of two sizes is the error `incompatible-dimensions`.
   *  `undefined` for other operands, for two constant lengths that differ,
   *  and on a target that compares no length at run time. */
  const elementwise = (
    e: Expression,
    given: V[],
    f: (xs: V[]) => V
  ): V | undefined => {
    const matrices = given.filter((v) => type(v).shape.length > 0);
    if (
      !lists.checks ||
      matrices.length < 2 ||
      !matrices.every((v) => type(v).shape.length === 2 && !cx.tuples.has(v))
    )
      return undefined;
    const axes = [0, 1].map((axis) =>
      matrices.map((v) => length(type(v).shape[axis]))
    );
    for (const lengths of axes) {
      const known = lengths
        .map((n) => lists.knownLength(n))
        .filter((c) => c !== undefined);
      if (new Set(known).size > 1) return undefined;
    }
    const [n, w] = axes.map((lengths) =>
      lengths.reduce((x, y) => lists.agreedLength(e, x, y)!)
    );
    const [i, j] = [0, 1].map(() => b.newValue(scalarType('integer')));
    const row = () =>
      cx.region(
        'build',
        [w],
        [j],
        () => [
          f(given.map((v) => (type(v).shape.length > 0 ? at(at(v, i), j) : v))),
        ],
        e
      )[0];
    return cx.region('build', [n], [i], () => [row()], e)[0];
  };

  /** `Determinant`, `Inverse` and `MatrixPower` of `m`, a matrix of a size
   *  known at run time: the kernels of a square matrix, of the order of its
   *  number of rows. Where `same()` does not prove the two lengths equal,
   *  the order is `rows.order`, which throws a `RangeError` where they
   *  differ (the interpreter's `expected-square-matrix`); each kernel reads
   *  the order, so that the check runs before it, and the value of
   *  `Inverse` and of `MatrixPower`, of the lane `rows`, has that order as
   *  its count and its row length, so that a reader of the result that
   *  reads no element runs the check too. */
  const kernel = (e: Fn, m: V): V => {
    const [n, w] = type(m).shape.map(length);
    const [cn, cw] = [cx.constant(n), cx.constant(w)];
    if (cn !== undefined && cw !== undefined && cn !== cw)
      decline(e, `${e.operator} of a matrix that is not square`);
    const order = same(n, w)
      ? n
      : b.op('rows.order', [n, w], scalarType('integer'));
    // The kernel reads the rows (the same array) and the order; the value
    // of the determinant at the order 1 is the element.
    const rows = cx.rowsOfMatrix(m);
    if (e.operator === 'Determinant')
      return cx.apply(e, op('mdet'), [
        rowsFlat(e, rows, cx.rowsElements.get(rows)!),
        order,
      ]);
    const out =
      e.operator === 'Inverse'
        ? b.op('rows.inverse', [rows, order], scalarType('rows'))
        : b.op('rows.power', [rows, exponent(e), order], scalarType('rows'));
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
    const [sa, sc] = [type(a).shape, type(c).shape];
    if (sa.length === 0 || sc.length === 0)
      decline(e, 'MatrixMultiply of a scalar');
    const [ka, kc] = [length(sa[sa.length - 1]), length(sc[0])];
    const [ca, cc] = [cx.constant(ka), cx.constant(kc)];
    if (ca !== undefined && cc !== undefined && ca !== cc)
      decline(e, 'MatrixMultiply of operands of two inner lengths');
    // A constant inner length, when there is one, so that a short sum is
    // written out.
    const k = ca !== undefined ? ka : kc;
    // The check of inner lengths that are not proved equal (`agree()`): the
    // interpreter's value of other lengths is `incompatible-dimensions`.
    const zero = agree(ka, kc);
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
    if (type(x).shape.length === 2 && typeof type(x).shape[1] !== 'number')
      decline(e, RUN_TIME_SIZE('Reshape'));
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
    // `Flatten` of a list of lists of run-time length whose rows can have
    // different lengths (CE-1736): the elements of its rows.
    if (type(m).lane === 'rows') {
      if (flattenDepth(e) === 0)
        decline(
          e,
          'Flatten to the depth 0 of a list of rows of different lengths (its value is the rows)'
        );
      return rowsFlat(e, m, cx.rowsElements.get(m)!);
    }
    const shape = type(m).shape;
    const rank = shape.length;
    // A matrix whose rows have a run-time length (an input or a parameter
    // of a matrix type, a table that the program builds, an operation on
    // the elements of one), and one of a size known at run time.
    const free = rank === 2 && typeof shape[1] !== 'number';
    const sized = rank === 2 && shape.some((d) => typeof d !== 'number');
    // A matrix whose number of rows is known at run time only has rank 2:
    // the interpreter's empty list of rows has rank 1 and the shape `(0)`,
    // a known limitation of `docs/COMPILATION-MODEL.md`.
    if (h === 'Rank') return integer(rank);
    if (h === 'Shape') {
      if (rank === 0) decline(e, 'Shape of a scalar (an empty tuple)');
      const v = cx.list(e, shape.map(length));
      cx.tuples.set(v, 0);
      return v;
    }
    if (h === 'Flatten') {
      // A depth of 0 leaves the rows; any other flattens the one nesting
      // level a matrix has (`+oo` is complete). Rows of a run-time length
      // are copied one after the other (`rows.flat`).
      const depth = flattenDepth(e);
      if (rank === 0) return cx.list(e, [m]);
      if (rank === 1 || depth === 0) return m;
      return free
        ? rowsFlat(e, cx.rowsOfMatrix(m), type(m).lane as 'integer' | 'real')
        : flatten(e, m);
    }
    if (h === 'Transpose' || h === 'ConjugateTranspose') {
      // The rows of the result have the number of rows of `m` as their
      // length: a run-time length on JavaScript only.
      if (rank === 2 && typeof shape[0] !== 'number' && !checks)
        decline(e, RUN_TIME_SIZE(h));
      return rank < 2 ? m : transpose(e, m);
    }
    if (h === 'Trace') {
      if (rank === 0) return m;
      if (rank !== 2) decline(e, 'Trace of a value that is not a matrix');
      // The numbers of rows and of columns are compared (`agree()`): the
      // interpreter's value of a matrix that is not square is the error
      // `expected-square-matrix`.
      const [n, w] = shape.map(length);
      const [cn, cw] = [cx.constant(n), cx.constant(w)];
      if (cn !== undefined && cw !== undefined && cn !== cw)
        decline(e, 'Trace of a matrix that is not square');
      if (sized && !checks && !same(n, w))
        decline(
          e,
          'Trace of a matrix whose number of rows is known at run time only'
        );
      return sum(e, n, (k) => at(at(m, k), k), agree(n, w, 'rows.square'));
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
      if (free) decline(e, RUN_TIME_SIZE(h));
      // The interpreter chops the entries at the engine's tolerance at the
      // evaluation (`ce.chop()`); the code holds it at the compilation.
      return cx.apply(e, op('mrowreduce'), [
        m,
        b.constant(e.engine.tolerance, 'real'),
      ]);
    }
    // A square matrix of a size known at run time: its order is checked
    // at run time (`kernel()`), on JavaScript.
    if (sized && checks) return kernel(e, m);
    const n = order(e, m);
    if (h === 'Determinant')
      return n === 1
        ? at(at(m, integer(0)), integer(0))
        : cx.apply(e, op('mdet'), [flatten(e, m), integer(n)]);
    if (h === 'Inverse') return cx.apply(e, op('minverse'), [m]);
    return cx.apply(e, op('mpower'), [m, exponent(e)]);
  };

  return { matrix, elementwise };
}
