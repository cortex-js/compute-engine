/**
 * The lowering of the mutable arrays of the engine (`array<T>`, a
 * `BoxedArray`) on JavaScript, for arrays of machine cells
 * (`docs/plans/2026-11-25-mutable-arrays-spec.md`, section 10).
 *
 * An array is a value of the lane `array` and the shape `[]`, whose IR type
 * holds its cells (`IRType.array`): one shape whatever its length. The code
 * holds the engine's array itself, and reads its storage and its count at
 * each use (`print-js.ts`), so the interpreter, the code and the host read
 * and write one storage. Every read of a cell or of the count, every store,
 * every exchange and every construction is an effectful operation of the
 * IR (decision C6): no pass moves or merges it.
 *
 * An array reaches the code as a parameter of an array type (of the root
 * function literal, of a user function), as an input of an array type, as
 * the value of a name (an input of the entry that `run()` reads at each call
 * from the definition of the name, `ArrayUse.names`), as a field of a value
 * of a name (a reference of the program, `ArrayUse.refs`), or from
 * `ArrayFrom` (a construction of the engine, `ArrayUse.makers`). What the
 * code does not compile declines, with a message that names the case.
 */

import type { Type } from '../../../common/type/types.js';
import {
  arrayCellType,
  arrayStorageKind,
  throughTransparentAliases,
} from '../../../common/type/array-storage.js';
import { resolveTypeReference } from '../../../common/type/subtype.js';
import { resolveTypeAlias } from '../../../common/type/utils.js';
import { typeToString as engineTypeToString } from '../../../common/type/serialize.js';
import type {
  BoxedValueDefinition,
  ComputeEngine,
  Expression,
} from '../../global-types.js';
import {
  isFunction,
  isMutableArray,
  isString,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import {
  isSubLane,
  scalarType,
  typeToString,
  type ArrayCells,
  type ArrayMaker,
  type ArrayUse,
  type IRType,
  type V,
} from './ir.js';
import {
  decline,
  LANE_MISMATCH,
  type Binding,
  type Fn,
  type Lowering,
  type Source,
} from './lower-context.js';
import type { listLowering } from './lower-lists.js';

/** What the lowering of arrays reads of the lowering of records
 *  (`recordLowering()` of `lower-records.ts`, which this module does not
 *  import: `lower-records.ts` reaches it through `lower-functions.ts`). */
type Records = {
  make(
    e: Expression,
    values: V[],
    nominal?: { nominal?: string; names?: readonly string[] },
    fields?: (IRType | undefined)[]
  ): V;
  field(r: V, k: number): V;
};

/** The cells of the array type `t` of machine cells, a string that names why
 *  the code does not hold such an array (expression cells, bare `array`), or
 *  `undefined` for a type that is not an array type. */
export function arrayCells(t: Type): ArrayCells | string | undefined {
  const cell = arrayCellType(t);
  if (cell === undefined)
    return resolveTypeAlias(t) === 'array'
      ? 'a value of the bare type array, whose cell type the type does not state'
      : undefined;
  const { storage, tuple } = arrayStorageKind(cell);
  const c = throughTransparentAliases(cell) ?? cell;
  if (storage === 'expression')
    return `an array of expression cells (array<${engineTypeToString(c)}>), which compiled code does not hold: only an array of machine cells compiles`;
  const lane = storage === 'float64' ? 'real' : 'integer';
  if (!tuple) return { cell: engineTypeToString(c), type: c, lane };
  // The tuple cell of four bytes: the head of the value of a cell, the name
  // of its nominal type or `Tuple` (`tupleTag()` of `boxed-array.ts`), and
  // its field names.
  const tag =
    typeof c === 'object' && c.kind === 'reference' && !c.alias
      ? c.name
      : 'Tuple';
  const body = resolveTypeReference(c);
  const names =
    typeof body === 'object' &&
    body.kind === 'tuple' &&
    body.elements.every((x) => x.name !== undefined)
      ? body.elements.map((x) => x.name!)
      : undefined;
  return {
    cell: engineTypeToString(c),
    type: c,
    lane,
    tuple: { tag, ...(names === undefined ? {} : { names }) },
  };
}

/** The IR type of an array of the cells `cells`. */
export const arrayType = (cells: ArrayCells): IRType => ({
  lane: 'array',
  shape: [],
  array: cells,
});

/** The IR type of a value of the engine type `t` that is an array of
 *  machine cells, else `undefined`. */
export function arrayIRType(t: Type): IRType | undefined {
  const cells = arrayCells(t);
  return typeof cells === 'object' ? arrayType(cells) : undefined;
}

/** Whether a value of the IR type `t` is, or holds, an array (a field of a
 *  record). */
export function holdsArray(t: IRType): boolean {
  return t.lane === 'array' || (t.fields ?? []).some(holdsArray);
}

/** The test of the value `x` that the entry of the code reads as an array
 *  of the cells `cells` (`label` names it): the engine's array whose cell
 *  type is that of the compilation, compared as the engine compares the
 *  cell types of two arrays (one storage, one cell type). It throws the
 *  `TypeError` of the entry for another value. */
export function arrayEntryCheck(
  cells: ArrayCells,
  label: string
): (x: unknown) => boolean {
  const kind = arrayStorageKind(cells.type);
  return (x) => {
    const a = x as Expression | undefined;
    if (
      isMutableArray(a) &&
      a._storage === kind.storage &&
      a._tuple === kind.tuple &&
      engineTypeToString(a.cellType.type) === cells.cell
    )
      return true;
    throw new TypeError(
      `${label} was compiled as an array<${cells.cell}>, and received ${describe(a)}. Pass the engine's array of that cell type.`
    );
  };
}

function describe(x: Expression | undefined): string {
  if (x === undefined || x === null) return 'no value';
  if (isMutableArray(x))
    return `an array<${engineTypeToString(x.cellType.type)}>`;
  if (typeof x !== 'object') return `the ${typeof x} ${String(x)}`;
  return typeof (x as { toString?: unknown }).toString === 'function'
    ? `the value ${String(x)}`
    : 'another value';
}

/** The decline of a read or a store of an array in the body of a function
 *  literal that is an operand or a value (spec section 10.6). */
const CALLBACK =
  'a read or a store of an array in the body of a function literal that is an operand or a value (map(k => a[k], 1..n), a function given to reduce): the interpreter can compute an element after a later store; write a loop, or take listFrom(a)';

/**
 * The nodes of the function literals of `root` that are operands or values
 * (a callback of `Map`, a function given by its name to `Reduce`, a local
 * function named as an operand), and of the bodies of the user functions
 * that they call, with the names of those user functions: a read or a
 * store of an array there declines. The root function literal, a user
 * function called by its name, and a local function of a `Block` that is
 * only called are not such literals.
 */
export function callbackScan(
  root: Expression,
  user: (x: Fn) => { key: object; literal: Fn } | undefined,
  named: (
    x: Expression & { symbol: string }
  ) => { key: object; literal: Fn } | undefined
): { nodes: Set<Expression>; functions: Set<string> } {
  const nodes = new Set<Expression>();
  const functions = new Set<string>();
  const seen = new Set<Expression>();
  const bodies = new Map<object, boolean>();
  const body = (u: { key: object; literal: Fn }, inside: boolean) => {
    const before = bodies.get(u.key);
    if (before === true || (before === false && !inside)) return;
    bodies.set(u.key, inside);
    walk(u.literal.ops[0], inside);
  };
  const walk = (x: Expression, inside: boolean, local = false): void => {
    if (inside) {
      if (nodes.has(x)) return;
      nodes.add(x);
    } else {
      if (seen.has(x)) return;
      seen.add(x);
    }
    if (isSymbol(x)) {
      const u = named(x);
      if (u !== undefined) body(u, true);
      return;
    }
    if (!isFunction(x)) return;
    const u = user(x);
    if (u !== undefined) {
      if (inside) functions.add(x.operator);
      body(u, inside);
    }
    // A function literal: a callback, but for the root and a local function
    // of a block that is only called (`local`).
    const callback = x.operator === 'Function' && x !== root && !local;
    const within = inside || callback;
    x.ops.forEach((op, k) => {
      // `Declare(f, …, Function(…))` in a block where `f` is only called.
      const value =
        x.operator === 'Declare' &&
        k > 0 &&
        isFunction(op, 'Function') &&
        isSymbol(x.ops[0])
          ? x.ops[0].symbol
          : undefined;
      walk(op, within, value !== undefined && !valueUse(root, value));
    });
  };
  walk(root, false);
  return { nodes, functions };
}

/** Whether `name` occurs in `root` as a symbol other than as the target of
 *  its `Declare`: a local function used as a value. */
function valueUse(root: Expression, name: string): boolean {
  const seen = new Set<Expression>();
  const walk = (x: Expression): boolean => {
    if (seen.has(x)) return false;
    seen.add(x);
    if (isSymbol(x)) return x.symbol === name;
    if (!isFunction(x)) return false;
    return x.ops.some((op, k) =>
      x.operator === 'Declare' && k === 0 ? false : walk(op)
    );
  };
  return walk(root);
}

export function arrayLowering(
  cx: Lowering,
  lists: ReturnType<typeof listLowering>,
  records: Records,
  /** The target holds arrays (JavaScript in the default mode). */
  javascript: boolean,
  /** The places where a read or a store declines (`callbackScan()`). */
  callbacks: () => { nodes: Set<Expression>; functions: Set<string> }
) {
  const { b, type } = cx;
  const names: {
    name: string;
    definition: BoxedValueDefinition;
    cells: ArrayCells;
  }[] = [];
  const inputs = new Map<string, Binding>();
  const refs: Expression[] = [];
  const makers: ArrayMaker[] = [];
  /** The bindings of the names whose value is an array (`named()`): a read
   *  of one is its input, not an input of the program. */
  const bindings = new WeakSet<Binding>();
  /** The records read from a tuple cell of a nominal type (`cell()`). */
  const recordReads = new Set<V>();
  let used = false;
  let stores = false;

  /** The cells of an array of the engine type `t` at the node `e`: an array
   *  of machine cells on JavaScript in the default mode; every other case
   *  declines, with the reason. `undefined` for a type that is not an array
   *  type. */
  const cellsOf = (e: Expression, t: Type): ArrayCells | undefined => {
    const cells = arrayCells(t);
    if (cells === undefined) return undefined;
    if (!javascript)
      decline(
        e,
        'an array (array<T>), which compiles on javascript in the default mode only (not interval-js, the bigint and the complex modes, GLSL)'
      );
    if (typeof cells === 'string') decline(e, cells);
    used = true;
    return cells;
  };

  /** A read or a store of the array at `e` in a body where it declines. */
  const site = (e: Expression) => {
    used = true;
    const c = callbacks();
    if (
      c.nodes.has(e) ||
      (cx.inFunction !== undefined && c.functions.has(cx.inFunction))
    )
      decline(e, CALLBACK);
  };

  const cellsOfValue = (e: Expression, a: V): ArrayCells => {
    const t = type(a);
    if (t.lane !== 'array' || t.array === undefined)
      decline(e, `a value of type ${typeToString(t)} where an array is read`);
    return t.array;
  };

  /** The index `x` of a cell: a scalar number. */
  const index = (e: Expression, x: Expression): V => {
    const i = cx.value(x)!;
    const t = type(i);
    if (t.shape.length > 0 || !isSubLane(t.lane, 'real'))
      decline(x, `an index of an array that is not a number (${typeToString(t)})`);
    return i;
  };

  /** The byte `j` (from 0) of the tuple cell at `i`. */
  const byte = (a: V, i: V, j: number): V =>
    b.op(
      type(i).lane === 'integer' ? 'arr.byte' : 'arr.byte.r',
      [a, i, b.constant(j, 'integer')],
      scalarType('integer')
    );

  /** The cell at the index `i` (a value) of the array `a`: a number, or the
   *  tuple of a tuple cell (a record of its nominal type, or a tuple), whose
   *  four bytes are read; NaN, and a tuple of NaN, where it names no cell. */
  const cell = (e: Expression, a: V, i: V): V => {
    site(e);
    const cells = cellsOfValue(e, a);
    if (cells.tuple === undefined)
      return b.op(
        (cells.lane === 'integer' ? 'arr.get.int' : 'arr.get') +
          (type(i).lane === 'integer' ? '' : '.r'),
        [a, i],
        scalarType(cells.lane)
      );
    const bytes = [0, 1, 2, 3].map((j) => byte(a, i, j));
    if (cells.tuple.tag === 'Tuple') {
      const v = b.list(bytes, { lane: 'integer', shape: [4] });
      cx.tuples.set(v, 0);
      return v;
    }
    const r = records.make(
      e,
      bytes,
      { nominal: cells.tuple.tag, names: cells.tuple.names },
      bytes.map(() => scalarType('integer'))
    );
    recordReads.add(r);
    return r;
  };

  /** The list of the cells at the indexes of `s` (from 1). */
  const gather = (e: Fn, a: V, s: Source, filter?: Source): V => {
    const cells = cellsOfValue(e, a);
    if (cells.tuple !== undefined)
      decline(
        e,
        'a range or a list as the index of an array of tuple cells (it compiles for cells of one number)'
      );
    site(e);
    return filter === undefined
      ? lists.over(e, s, '', (x) => cell(e, a, x), false, e)
      : lists.over(
          e,
          {
            length: cx.apply(e, 'Min', [s.length, filter.length]),
            at: s.at,
          },
          '',
          (_x, k) => filter.at(k),
          true,
          e
        );
  };

  /** The source of the cells of `a`: its count and the cell at each index
   *  from 0. */
  const cellsSource = (e: Fn, a: V): Source => ({
    length: length(e, a),
    at: (k) => cell(e, a, cx.apply(e, 'Add', [k, b.constant(1, 'integer')])),
  });

  const length = (e: Expression, a: V): V => {
    site(e);
    cellsOfValue(e, a);
    return b.op('arr.len', [a], scalarType('integer'));
  };

  /** The store of the value `v` in the cell at `i` of `a`; its value is
   *  the value given. A value of another lane declines (`lane-mismatch`):
   *  a real for integer cells, a boolean or a complex number for any cell,
   *  and for a tuple cell anything but a tuple of its type. */
  const put = (e: Expression, a: V, i: V, v: V): V => {
    site(e);
    const cells = cellsOfValue(e, a);
    const t = type(v);
    stores = true;
    const mismatch = (): never =>
      decline(
        e,
        `a store of a value of type ${typeToString(t, cx.tuples.get(v) ?? -1)} in an array<${cells.cell}>`,
        LANE_MISMATCH
      );
    if (cells.tuple === undefined) {
      if (
        t.shape.length > 0 ||
        !(t.lane === 'integer' || (t.lane === 'real' && cells.lane === 'real'))
      )
        mismatch();
      return b.op(
        (t.lane === 'integer' && cells.lane === 'integer'
          ? 'arr.set.int'
          : 'arr.set') + (type(i).lane === 'integer' ? '' : '.r'),
        [a, i, v],
        scalarType(cells.lane === 'integer' ? 'integer' : 'real')
      );
    }
    // A tuple of four integers of the type of the cell: its four bytes,
    // read from the values that the tuple was made of when the code built
    // it (`records.field()`), so no tuple is allocated.
    const nominal = cells.tuple.tag !== 'Tuple';
    const parts: V[] | undefined = nominal
      ? t.lane === 'record' &&
        t.nominal === cells.tuple.tag &&
        t.fields?.length === 4 &&
        t.fields.every((f) => f.lane === 'integer' && f.shape.length === 0)
        ? [0, 1, 2, 3].map((k) => records.field(v, k))
        : undefined
      : t.lane === 'integer' &&
          t.shape.length === 1 &&
          t.shape[0] === 4 &&
          // A tuple, not a list (the interpreter gives incompatible-type).
          cx.tuples.get(v) === 0
        ? [0, 1, 2, 3].map((k) =>
            b.op('elem', [v, b.constant(k, 'integer')], scalarType('integer'))
          )
        : undefined;
    if (parts === undefined) mismatch();
    b.op('arr.touch', [a], scalarType('integer'));
    parts!.forEach((x, j) =>
      b.op(
        type(i).lane === 'integer' ? 'arr.setbyte' : 'arr.setbyte.r',
        [a, i, b.constant(j, 'integer'), x],
        scalarType('integer')
      )
    );
    return v;
  };

  /** The base of the target `At(x, i)` of a store: the array that `x` is,
   *  or `undefined` when it is not one. */
  const base = (target: Expression): V | undefined => {
    if (!isFunction(target, 'At') || target.nops < 2) return undefined;
    if (target.nops > 2) {
      // `a[i][j] = v`: the base `a[i]` is a cell, never an array (a list
      // of arrays declines).
      return undefined;
    }
    const a = cx.value(target.ops[0])!;
    return type(a).lane === 'array' ? a : undefined;
  };

  return {
    /** The program's arrays, or `undefined` when it touches none. */
    use: (): ArrayUse | undefined =>
      used ? { names, refs, makers, stores } : undefined,

    /** The binding of a name whose value is an array (`named()`). */
    isNamed: (x: Binding | undefined): boolean =>
      x !== undefined && bindings.has(x),

    note: (x: Binding) => bindings.add(x),

    cellsOf,

    /** The input of the entry that holds the array of the name `name` at
     *  each call (`ArrayUse.names`), read from the definition `definition`
     *  of the name at the compilation, whose value now is `value`. */
    named: (
      e: Expression,
      name: string,
      definition: BoxedValueDefinition,
      value: Expression
    ): V => {
      const known = inputs.get(name);
      if (known !== undefined) return known.v;
      const cells = cellsOf(e, value.type.type)!;
      const v = b.param(name, arrayType(cells));
      const binding: Binding = { v, role: 'index' };
      cx.frames[0].names.set(name, binding);
      inputs.set(name, binding);
      bindings.add(binding);
      names.push({ name, definition, cells });
      return v;
    },

    /** The array `x` that a value of a name holds: a reference of the
     *  program (`arr.ref`). */
    ref: (x: Expression): V => {
      const cells = cellsOf(x, x.type.type)!;
      let k = refs.indexOf(x);
      if (k < 0) k = refs.push(x) - 1;
      return b.op('arr.ref', [b.constant(k, 'integer')], arrayType(cells));
    },

    /** `At(a, i)` of an array value `a`: the cell, or of a range, a list
     *  of indexes or a list of booleans, the list of those cells. */
    at: (e: Fn, a: V): V => {
      const x = e.ops[1];
      const i = cx.value(x)!;
      const t = type(i);
      if (t.shape.length === 1 && !cx.tuples.has(i)) {
        const s = lists.listSource(i);
        return t.lane === 'boolean'
          ? gather(e, a, cellsSource(e, a), s)
          : gather(e, a, s);
      }
      if (t.shape.length > 0 || !isSubLane(t.lane, 'real'))
        decline(x, `an index of an array that is not a number (${typeToString(t)})`);
      return cell(e, a, i);
    },

    /** `Field(At(a, i), name)` (`k` undefined) or `At(At(a, i), k)` of an
     *  array of tuple cells: the one byte read, with no tuple built. */
    element: (e: Expression, a: V, x: Expression, k: number | string): V => {
      const cells = cellsOfValue(e, a);
      const tuple = cells.tuple!;
      const j =
        typeof k === 'string'
          ? (tuple.names?.indexOf(k) ?? -1)
          : Number.isInteger(k) && k !== 0 && Math.abs(k) <= 4
            ? k > 0
              ? k - 1
              : 4 + k
            : -1;
      if (j < 0)
        decline(
          e,
          `${typeof k === 'string' ? `the field ${k}` : `the element ${k}`} of a tuple cell of array<${cells.cell}>, which it does not have`
        );
      site(e);
      return byte(a, index(e, x), j);
    },

    /** Whether `a` is an array of tuple cells. */
    tupleCells: (a: V): boolean => type(a).array?.tuple !== undefined,

    /** Whether `v` is the record read from a tuple cell of a nominal type:
     *  out of range, the interpreter's value is the tuple of four NaN,
     *  which is absent, and the record of four NaN is not
     *  (`absent()` of `lower.ts`). */
    recordCell: (v: V): boolean => recordReads.has(v),

    /** Whether a value of the engine type `t` can be a tuple cell of a
     *  nominal type (`type Pixel = tuple<r: Byte, …>`): `t`, or a member of
     *  the union `t`, is a declared type that is a machine cell of four
     *  bytes. A record of such a type can be the read of a cell that came
     *  through a user function or an arm of an `If`, where `recordCell()`
     *  no longer knows it, so a discharge of it declines too. */
    tupleCellType: (t: Type): boolean => {
      const one = (x: Type): boolean =>
        typeof x !== 'string' &&
        x.kind === 'reference' &&
        arrayStorageKind(x).tuple;
      return typeof t !== 'string' && t.kind === 'union'
        ? t.types.some(one)
        : one(t);
    },

    /** The same question for the nominal type that a record of the code
     *  names (`IRType.nominal`): the record keeps that name where the
     *  engine type of the expression is lost, such as a parameter of no
     *  type of a user function that is given the read of a cell. */
    tupleCellNominal: (ce: ComputeEngine, name: string | undefined): boolean => {
      const ref = name === undefined ? undefined : ce._typeRegistry[name];
      return ref !== undefined && arrayStorageKind(ref).tuple;
    },

    length,

    /** `ListFrom(a)`: a copy of the cells, in the list carrier of the code. */
    listFrom: (e: Fn, a: V): V => {
      const cells = cellsOfValue(e, a);
      if (cells.tuple !== undefined)
        decline(
          e,
          'ListFrom of an array of tuple cells (it compiles for cells of one number)'
        );
      return gather(e, a, {
        length: length(e, a),
        at: (k) => cx.apply(e, 'Add', [k, b.constant(1, 'integer')]),
      });
    },

    /** `Assign(At(x, i), v)` of an array `x`: the store, its operands
     *  evaluated in the order of the interpreter (the base, the index, the
     *  value); `undefined` when `x` is not an array. */
    store: (e: Fn): V | undefined => {
      const target = e.ops[0];
      const a = base(target);
      if (a === undefined) return undefined;
      const i = index(e, (target as Fn).ops[1]);
      return put(e, a, i, cx.value(e.ops[1])!);
    },

    /** `AddTo(At(x, i), d)` of an array `x`: the base and the index, then
     *  the cell read, `d`, and the store of the sum, as the interpreter;
     *  `undefined` when `x` is not an array. */
    addTo: (e: Fn): V | undefined => {
      const target = e.ops[0];
      const a = base(target);
      if (a === undefined) return undefined;
      if (cellsOfValue(e, a).tuple !== undefined)
        decline(e, 'AddTo of a tuple cell (a tuple is not a number)');
      const i = index(e, (target as Fn).ops[1]);
      const old = cell(e, a, i);
      const sum = cx.apply(e, 'Add', [old, cx.scalar(e.ops[1])]);
      return put(e, a, i, sum);
    },

    /** `Swap(a, b)` of two arrays of one cell type. */
    swap: (e: Fn): V => {
      if (e.nops !== 2) decline(e, 'Swap of other than two arrays');
      const [x, y] = e.ops.map((op) => cx.value(op)!);
      const [s, t] = [cellsOfValue(e.ops[0], x), cellsOfValue(e.ops[1], y)];
      if (s.cell !== t.cell)
        decline(
          e,
          `Swap of an array<${s.cell}> and an array<${t.cell}> (the interpreter gives incompatible-type)`
        );
      site(e);
      stores = true;
      return b.op('arr.swap', [x, y], scalarType('real'));
    },

    /** `ArrayFrom(xs, type)`: one call of the engine (`ArrayUse.makers`), of
     *  a list of numbers that the code holds, a `Repeat(v, n)` or an array. */
    from: (e: Fn): V => {
      const cells = cellsOf(e, e.type.type);
      if (cells === undefined)
        decline(e, `ArrayFrom whose type ${engineTypeToString(e.type.type)} is not an array type`);
      if (e.nops === 2 && !isString(e.ops[1]))
        decline(e, 'ArrayFrom whose cell type is not a string literal');
      site(e);
      const t = arrayType(cells);
      const k = () => b.constant(makers.length, 'integer');
      const xs = e.ops[0];
      if (isFunction(xs, 'Repeat') && xs.nops === 2) {
        const v = cx.value(xs.ops[0])!;
        const n = cx.scalar(xs.ops[1]);
        const vt = type(v);
        const record =
          cells.tuple !== undefined &&
          vt.lane === 'record' &&
          vt.nominal === cells.tuple.tag;
        if (
          !record &&
          (vt.shape.length > 0 || !isSubLane(vt.lane, 'real'))
        )
          decline(
            e,
            `ArrayFrom of a Repeat of a value of type ${typeToString(vt)} for an array<${cells.cell}>`
          );
        const out = b.op(
          record ? 'arr.from.fillrec' : 'arr.from.fill',
          [v, n, k()],
          t
        );
        makers.push({ call: e, source: 'fill', value: vt });
        return out;
      }
      const x = cx.value(xs)!;
      const xt = type(x);
      if (xt.lane === 'array') {
        const out = b.op('arr.from.copy', [x, k()], t);
        makers.push({ call: e, source: 'copy' });
        return out;
      }
      if (
        xt.shape.length !== 1 ||
        cx.tuples.has(x) ||
        !isSubLane(xt.lane, 'real')
      )
        decline(
          e,
          `ArrayFrom of a source of type ${typeToString(xt, cx.tuples.get(x) ?? -1)}, not a list of numbers, a Repeat or an array`
        );
      const out = b.op('arr.from.list', [x, k()], t);
      makers.push({ call: e, source: 'list' });
      return out;
    },
  };
}
