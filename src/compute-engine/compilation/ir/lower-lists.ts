/**
 * The lowering of collections: a list operand as a source (its length and
 * the element at an index from 0), a `Range` read through its count and
 * the arithmetic of its elements (no list is made unless its value is
 * read), the reductions (`Sum`, `Product`, `Max`, `Min`, `Reduce`) as
 * counted loops, and `Map`, `Filter` and `Comprehension` as builds.
 */

import {
  isFunction,
  isNumber,
  isSymbol,
} from '../../boxed-expression/type-guards.js';
import type { Expression } from '../../global-types.js';
import {
  collectionElementType,
  requiredArity,
} from '../../../common/type/utils.js';
import {
  elementIndex,
  elementType,
  isSubLane,
  lengthValues,
  mapLengths,
  outsOf,
  recursiveFunctions,
  regionsOf,
  scalarType,
  type Instr,
  type Lane,
  type Length,
  type Region,
  type V,
} from './ir.js';
import {
  REDUCTIONS,
  rowOfHead,
  rowOfOp,
  signatureOf,
  type OperatorRow,
} from './operators.js';
import { isLibraryOperator } from '../../library-shadowing.js';
import { isTupleOrTupleUnionShapedType } from '../../collection-utils.js';
import {
  decline,
  Decline,
  type Fn,
  type Lowering,
  type Source,
  userBinding,
} from './lower-context.js';
import { SCALARIZE_LIMIT } from './passes.js';
import { emptyBigOpValue } from '../../symbolic/big-op-identity.js';
import { MAX_CHUNK_COUNT } from '../../numerics/value-scaled-caps.js';
import { textOrder } from './lower-strings.js';

/** The name of a parameter of a function literal: a symbol, or a symbol
 *  with a type (`Typed(z, "real")`), also with a default value
 *  (`Optional(z, 2)`, `Optional(Typed(z, "real"), 2)`). */
export function parameterName(p: Expression): string | undefined {
  if (isFunction(p, 'Optional') && p.nops === 2) p = p.ops[0];
  if (isFunction(p, 'Typed')) p = p.ops[0];
  return isSymbol(p) ? p.symbol : undefined;
}

/** The function literal `(p1, …, pn) ↦ Op(p1, …, pn)` of a symbol `f` that
 *  names the library operator `Op` of a row, which the interpreter applies
 *  as the call `Op(a1, …, an)`, and `(p1, …, pn) ↦ f(p1, …, pn)` of a user
 *  function of `n` parameters; `f` itself otherwise (a user function of
 *  another arity or with no `n`, a shadowed name, a parameter, a name of
 *  `vars`). A row of a fixed arity takes `n` of that arity, a variadic row
 *  any `n` (2 when `n` is not given: the combiner of a `Reduce`); a `chain`
 *  row, none. */
export function operatorLiteral(
  f: Expression,
  rows: readonly OperatorRow[],
  n?: number,
  vars?: readonly string[]
): Expression {
  if (!isSymbol(f) || vars?.includes(f.symbol)) return f;
  const name = f.symbol;
  const node = {
    operator: name,
    operatorDefinition: f.operatorDefinition,
    valueDefinition: f.valueDefinition,
    engine: f.engine,
  };
  // A user function of `n` parameters (a `Map`, a `Filter`, a quantifier),
  // or of more whose parameters after the `n`th have a default: the
  // interpreter applies it as the call `f(a1, …, an)`, which the canonical
  // form completes with the defaults. The call is boxed here, so its head
  // must resolve to the definition of `f`.
  const user = userBinding(node as never);
  if (user !== undefined) {
    const ps = Array.from({ length: n ?? 0 }, (_, i) => `_p${i + 1}`);
    const total = user.literal.nops - 1;
    const required = user.literal.ops
      .slice(1)
      .filter((p) => !isFunction(p, 'Optional')).length;
    if (
      n === undefined ||
      n > total ||
      n < required ||
      userBinding(f.engine.box([name, ...ps]) as never)?.key !== user.key
    )
      return f;
    return f.engine.box(['Function', [name, ...ps], ...ps]);
  }
  const arity = rowOfHead(rows, name)?.arity;
  const k = arity === 'variadic' ? (n ?? 2) : arity;
  if (
    typeof k !== 'number' ||
    k < 1 ||
    (n !== undefined && k !== n) ||
    !isLibraryOperator(node as never, name)
  )
    return f;
  const ps = Array.from({ length: k }, (_, i) => `_p${i + 1}`);
  return f.engine.box(['Function', [name, ...ps], ...ps]);
}

/** `l` is a literal `List` of the library (a user definition declines in
 *  `cx.value()`, which lowers a host handler's answer). */
export const literalList = (cx: Lowering, l: Expression): l is Fn =>
  isFunction(l, 'List') && cx.isLibrary(l);

/** The numbers of operands of the list operators that compile
 *  (`collection()`); `Mean` takes any number but 0. */
const ARITY: Readonly<Record<string, readonly number[]>> = Object.freeze({
  Count: [1, 2],
  IsEmpty: [1],
  Rest: [1],
  Most: [1],
  Reverse: [1],
  Take: [2],
  Drop: [2],
  RotateLeft: [1, 2],
  RotateRight: [1, 2],
  Median: [1],
  Sort: [1, 2],
  Ordering: [1],
  Unique: [1],
  Any: [1, 2],
  All: [1, 2],
  Contains: [2],
  IndexOf: [2],
  Dot: [2],
  Norm: [1, 2],
  DeleteAt: [2],
  Insert: [3],
  Slice: [3],
  Linspace: [1, 2, 3],
  Chunk: [2],
  Partition: [2, 3],
  TakeWhile: [2],
  DropWhile: [2],
  FlatMap: [2],
  Scan: [2, 3],
  Element: [2],
  Identity: [1],
  CountIf: [2],
  Find: [2],
  IndexWhere: [2],
  Position: [2],
  RandomSample: [2],
  StartsWith: [2],
  EndsWith: [2],
  ContainsSequence: [2],
});

/** The list operators of CE-1531 (`more()`). */
const MORE: ReadonlySet<string> = new Set([
  'Append',
  'DeleteAt',
  'Insert',
  'Slice',
  'Linspace',
  'Chunk',
  'Partition',
  'TakeWhile',
  'DropWhile',
  'FlatMap',
  'Scan',
  'Tabulate',
  'Element',
  'Identity',
  'CountIf',
  'Find',
  'IndexWhere',
  'Position',
  'RandomSample',
  'ApplyWhole',
  'StartsWith',
  'EndsWith',
  'ContainsSequence',
]);

/** The variances and the standard deviations (`variance()`). */
const VARIANCES: readonly string[] = [
  'Variance',
  'PopulationVariance',
  'StandardDeviation',
  'PopulationStandardDeviation',
];

export function listLowering(cx: Lowering) {
  const { b, type } = cx;
  const op = (name: string) => rowOfOp(cx.rows, name)!.row;
  const integer = (n: number) => b.constant(n, 'integer');
  // The bodies written out in the program: the elements of the builds on
  // GLSL (`over()`) and the terms of the sums (`writtenOut()`).
  let unrolled = 0;
  /** `f()` in a loop frame where `name` is the index `k`. */
  const indexed = <T>(name: string, k: V, f: () => T): T =>
    cx.withFrame(true, (frame) => {
      frame.names.set(name, { v: k, role: 'index' });
      return f();
    });

  /** The list `l` as a source. Its element is `elem`, and of a list of
   *  strings `text.elem`, which conditions it (CE-1556): no absent string
   *  comes out of it, as every caller reads it at an index in range, the
   *  index of a build, a filter or a loop over the length (`over()`,
   *  `reindexed()`, `mapLists()`, `where()`, `quantifier()`, `reduce()`,
   *  the loops of `Scan`, `Unique`, `ContainsSequence`, `Dot`, `Norm`, a
   *  `for` loop, `Apply`, `Tuple`, a selection and the threaded calls of
   *  `lower.ts` and `lower-functions.ts`), that index shifted below a
   *  length it is tested against (`join()`, `appended()`, `Insert`,
   *  `ReplaceAt` of `lower.ts`), the indices that `sample` draws, the
   *  permutation of `text.ordering` (`Sort`), or a constant in
   *  range (`at()` of `lower.ts`, the rows of a `Chunk`). Two read a
   *  computed index: `Find` (`s.at(head(kept))`) declines for strings, and
   *  `elementOf()` reads in a region that is not emitted. */
  const listSource = (l: V): Source => {
    const n = type(l).shape[0];
    // An element of a list of tuples is a tuple.
    const axis = cx.tuples.get(l);
    return {
      length: typeof n === 'number' ? integer(n) : n.v,
      at: (k) => {
        const x = b.op(
          type(l).lane === 'string' ? 'text.elem' : 'elem',
          [l, k],
          elementType(type(l))
        );
        if (axis !== undefined && axis > 0) cx.tuples.set(x, axis - 1);
        return x;
      },
    };
  };

  /** The list of `length` elements whose element at the index `k` is
   *  `f(k)`. */
  const built = (site: Expression, length: V, f: (k: V) => V): V => {
    // A short list of a constant length is the list of its elements.
    const n = cx.constant(length);
    if (n !== undefined && n >= 1 && n <= cx.unrollBuilds && isFunction(site))
      return cx.list(
        site,
        Array.from({ length: n }, (_, j) => f(integer(j)))
      );
    const k = b.newValue(scalarType('integer'));
    return cx.region('build', [length], [k], () => [f(k)], site)[0];
  };

  /** The list `e` as a source; with `scalars`, a scalar is its value. A
   *  tuple is a source only with `tuple` (`Length`, `Sum`, `Max`: the
   *  value on a tuple is the value on the list of its elements). */
  function source(e: Expression, scalars?: false, tuple?: boolean): Source;
  function source(e: Expression, scalars: true, tuple?: boolean): Source | V;
  function source(e: Expression, scalars = false, tuple = false): Source | V {
    // The rows of a `Chunk` or a `Partition`, each made where it is read.
    const r = chunks(e);
    if (r !== undefined)
      return typeof r === 'number' ? listSource(r) : r.source();
    // A host's `Range` (a handler, `cx.isLibrary()`) is lowered in
    // `cx.value()`.
    if (!isFunction(e, 'Range') || !cx.isLibrary(e)) {
      const l = cx.value(e)!;
      if (cx.tuples.get(l) === 0 && !tuple)
        decline(e, 'a tuple where a list is read');
      if (type(l).shape.length > 0) return listSource(l);
      if (scalars) return l;
      decline(e, 'a scalar where a list is required');
    }
    if (e.nops < 2 || e.nops > 3) decline(e, `a Range of ${e.nops} operands`);
    // Real operands: the elements are the reals `lo + k·step`, as the
    // interpreter's (`Range(0.5, 3.7)` is `[0.5, 1.5, 2.5, 3.5]`).
    const [lo, hi, given] = e.ops.map((x) => {
      const v = cx.scalar(x);
      if (type(v).lane !== 'integer' && type(v).lane !== 'real')
        decline(x, 'a Range of an operand that is not a real number');
      const c = cx.constant(v);
      if (c !== undefined && !Number.isFinite(c))
        decline(x, 'a Range of an operand that is a constant infinity or NaN');
      return v;
    });
    const step = given ?? cx.apply(e, op('rangestep'), [lo, hi]);
    const length = cx.apply(e, op('rangecount'), [lo, hi, step]);
    const at = (k: V) =>
      cx.apply(e, 'Add', [lo, cx.apply(e, 'Multiply', [k, step])]);
    return { length, at };
  }

  /** A term of an indexed `Sum` or `Product` that is a list: a flat list
   *  of numbers, a tuple, or a list of tuples, each tuple of a constant
   *  length (the interpreter adds tuples element by element). */
  const listTerm = (t: V): boolean => {
    const [shape, axis] = [type(t).shape, cx.tuples.get(t)];
    if (axis === undefined) return shape.length === 1;
    return shape.length === axis + 1 && typeof shape[axis] === 'number';
  };

  /** The list of the length `n` whose every element is `x`. */
  const filled = (e: Fn, n: Length, x: V): V =>
    over(
      e,
      { length: typeof n === 'number' ? integer(n) : n.v, at: (k) => k },
      '',
      () => x,
      false,
      e
    );

  /** The value of the shape `shape` whose every number is `x`, a tuple at
   *  the axis `axis` (`cx.tuples`). */
  const filledAs = (
    e: Fn,
    shape: readonly Length[],
    axis: number | undefined,
    x: V
  ): V => {
    if (shape.length === 0) return x;
    const inner = filledAs(
      e,
      shape.slice(1),
      axis === undefined || axis === 0 ? undefined : axis - 1,
      x
    );
    // A build of tuples is a list of tuples (`keep()` of `lower.ts`).
    const v = filled(e, shape[0], inner);
    if (axis === 0) cx.tuples.set(v, 0);
    return v;
  };

  /** A counted loop from `lo` to `hi` that carries the accumulator of
   *  `r`, from `init`, over the value of `term` at each index. With
   *  `lists` (an indexed `Sum` or `Product`), a term may be a flat list, a
   *  tuple or a list of tuples (`listTerm()`) whose length is known before
   *  the loop: the accumulator then has the shape of the term, from `init`
   *  in each element, and the terms are added element by element
   *  (`README.md`, "Lists"). */
  const accumulate = (
    e: Fn,
    r: OperatorRow,
    init: V,
    lo: V,
    hi: V,
    term: (k: V) => V,
    lists = false
  ): V => {
    const k = b.newValue(scalarType('integer'));
    const params = [k];
    let lane: Lane | undefined;
    let shape: readonly Length[] = [];
    let axis: number | undefined;
    const body = b.region(params, () => {
      const t = term(k);
      lane = signatureOf(r, [type(init), type(t)])?.[1] as Lane | undefined;
      shape = type(t).shape;
      axis = cx.tuples.get(t);
      if (lane === undefined || (shape.length > 0 && !(lists && listTerm(t))))
        decline(e, 'a term that is not a number');
      const acc = b.newValue({ lane, shape });
      if (axis !== undefined) cx.tuples.set(acc, axis);
      params.push(acc);
      const next = cx.apply(e, r, [acc, t]);
      if (type(next).lane !== lane)
        decline(e, 'an accumulator that changes lane');
      return [next];
    });
    // The length of a list term is a value made before the loop (the
    // length of an input, of a list computed outside the sum): a length
    // computed in the loop can change from term to term, and the
    // accumulator has one length.
    const n = shape[0];
    if (n !== undefined && typeof n !== 'number' && definedIn(body, n.v))
      decline(e, 'a term that is a list whose length is computed in each term');
    const out = b.newValue({ lane: lane!, shape });
    if (axis !== undefined) cx.tuples.set(out, axis);
    const start = filledAs(e, shape, axis, cx.widen(init, lane!));
    b.emit({ k: 'loop', outs: [out], lo, hi, init: [start], body });
    return out;
  };

  /** `v` is a parameter of `r` or a value defined in it. */
  const definedIn = (r: Region, v: V): boolean =>
    r.params.includes(v) ||
    r.body.some(
      (i) => outsOf(i).includes(v) || regionsOf(i).some((x) => definedIn(x, v))
    );

  /** The sums whose term held a loop that no limit made: a nest of
   *  constant sums tries each once, not once per term of the sums around
   *  it. `limited`: a sum was refused by a limit (the bodies written out,
   *  the nodes); the lowering then attempts no more sums, since in a nest
   *  of few terms each level would double the attempts. */
  const looped = new WeakSet<Expression>();
  let limited = false;
  /** The bodies that the sums of `x` with `Limits` of two integers (a
   *  literal, or the value a free name holds) write out when each of them
   *  is (a lower bound: a call is 0). */
  const counted = new WeakMap<Expression, number>();
  const bodies = (x: Expression): number => {
    if (!isFunction(x)) return 0;
    if (counted.has(x)) return counted.get(x)!;
    let c = x.ops.reduce((s, o) => s + bodies(o), 0);
    const [body, l] = x.ops;
    if (/^(Sum|Product)$/.test(x.operator) && isFunction(l, 'Limits')) {
      const [a, z] = l.ops.slice(1).map((y) => {
        const v = cx.numberOf(y);
        return v !== undefined && isNumber(v) ? v.re : NaN;
      });
      const n = z - a + 1;
      if (Number.isInteger(n) && n >= 1 && n <= cx.unrollSums)
        c = n * (1 + bodies(body));
    }
    counted.set(x, c);
    return c;
  };
  const loops = (i: Instr): boolean =>
    i.k === 'loop' || regionsOf(i).some((r) => r.body.some(loops));

  /** The fold of `r` from `init` over the terms at the indices from `lo` to
   *  `hi`, in ascending order, each term lowered with its index a constant:
   *  the loop's operations, with no loop. `undefined`, and the loop runs, in
   *  the cases of `README.md`, "Lists" (a sum written out). With
   *  `identity`, `init` is the identity of `r`: the fold starts at the
   *  first term when the loop's accumulator has its lane. With `lists`, a
   *  term may be a flat list, a tuple or a list of tuples (`listTerm()`,
   *  `accumulate()`). */
  const writtenOut = (
    e: Fn,
    r: OperatorRow,
    init: V,
    lo: V,
    hi: V,
    term: (k: V) => V,
    identity = false,
    lists = false
  ): V | undefined => {
    const [a, z] = [cx.constant(lo), cx.constant(hi)];
    const n = a === undefined || z === undefined ? 0 : z - a + 1;
    const room = SCALARIZE_LIMIT ** 2 - unrolled;
    if (n < 1 || !(n <= cx.unrollSums) || looped.has(e) || limited)
      return undefined;
    // A nest of sums that cannot all be written out keeps this loop: an
    // attempt would lower the nest below once more per level.
    if (isFunction(e.ops[1], 'Limits') && n * (1 + bodies(e.ops[0])) > room)
      return undefined;
    if (n > room) return void (limited = true);
    cx.attempted();
    const before = unrolled;
    unrolled += n;
    // A body that holds a loop, a call of a function on a cycle of calls or
    // a complex value (`Sqrt(k)` at k = -1, where the loop's real kernel
    // gives NaN) keeps the loop.
    const accept = (region: Region): boolean => {
      const cyclic = recursiveFunctions(b.functions);
      const straight = (r: Region): boolean =>
        r.body.every(
          (i) =>
            i.k !== 'loop' &&
            !(i.k === 'call' && cyclic.has(i.fn)) &&
            outsOf(i).every((o) => type(o).lane !== 'complex') &&
            regionsOf(i).every(straight)
        );
      return straight(region);
    };
    return cx.attempt(
      (spent, left) => {
        const effects = b.effects;
        let acc = init;
        for (let j = 0; j < n; j++) {
          if (j > 0 && (spent() * (j + 1)) / j > left / 2)
            return void (limited = true);
          const from = b.current().body.length;
          const t = term(integer(a! + j));
          // A term that holds a loop: the sum keeps its loop (`accept`).
          // Unless a limit made that loop, the sum is not attempted again
          // in this lowering (a nest of constant sums).
          if (b.current().body.slice(from).some(loops)) {
            if (!limited) looped.add(e);
            return undefined;
          }
          const s = signatureOf(r, [type(acc), type(t)]);
          if ((type(t).shape.length > 0 && !(lists && listTerm(t))) || !s)
            return undefined;
          // A tuple term: the fold starts from a tuple of `init`, as the
          // loop's accumulator (`accumulate()`); `init` and a tuple have no
          // sum.
          if (j === 0 && cx.tuples.has(t))
            acc = filledAs(
              e,
              type(t).shape,
              cx.tuples.get(t),
              cx.widen(init, s[1] as Lane)
            );
          acc =
            identity && j === 0 && s[1] === type(t).lane
              ? t
              : cx.apply(e, r, [acc, t]);
        }
        return b.effects === effects ? acc : undefined;
      },
      accept,
      () => (unrolled = before)
    );
  };

  /** `Sum(body, Limits(k, a, b))`: a loop from the identity of `r`. */
  const aggregate = (e: Fn, r: OperatorRow): V => {
    const limits = e.ops[1] as Fn;
    const index = limits.ops[0];
    if (limits.nops !== 3 || !isSymbol(index))
      decline(e, 'not one index with two bounds');
    // The interpreter counts from the floor of each bound to the floor of
    // the other (`normalizeIndexingSet()`): `Sum(k, Limits(k, 0.5, 3.7))`
    // is 6.
    const [lo, hi] = [limits.ops[1], limits.ops[2]].map((x) => {
      const v = cx.scalar(x);
      // The interpreter leaves a sum over an impure bound unevaluated.
      if (x.isPure === false) decline(x, 'a bound that is not pure');
      // The interpreter sums a window of an infinite range; NaN is 1.
      const c = cx.constant(v);
      if (c !== undefined && !Number.isFinite(c))
        decline(x, 'a bound that is a constant infinity or NaN');
      // The interpreter gives `out-of-range` where the range is not empty.
      if (c !== undefined && Math.abs(c) > Number.MAX_SAFE_INTEGER)
        decline(x, 'a bound that is a constant beyond 2^53 - 1');
      if (type(v).lane === 'real') return cx.apply(x, 'Floor', [v]);
      if (type(v).lane !== 'integer')
        decline(x, 'a bound that is not a real number');
      return v;
    });
    const init = integer(REDUCTIONS.get(e.operator)!.identity);
    // A term may be a flat list, a tuple or a list of tuples: the
    // interpreter adds (multiplies) the terms element by element
    // (`accumulate()`). A `Product` of tuples declines: `Multiply` of two
    // tuples is not element by element.
    const term = (k: V) => indexed(index.symbol, k, () => cx.value(e.ops[0])!);
    const written = writtenOut(e, r, init, lo, hi, term, false, true);
    if (written !== undefined) return written;
    const run = () => {
      const v = accumulate(e, r, init, lo, hi, term, true);
      const n = type(v).shape[0];
      // Over a range with no term, the interpreter's value is a list of the
      // identity only when the static type of the sum states its length
      // (`emptyBigOpValue()`), and the identity (a number) otherwise. A
      // range from a constant at most 0 to a value proved `>= 0` (a
      // `Length`) holds a term.
      const [a, z] = [cx.constant(lo), cx.constant(hi)];
      const empty = emptyBigOpValue(e, e.operator as 'Sum' | 'Product');
      const held =
        a !== undefined &&
        (z !== undefined ? a <= z : a <= 0 && cx.nonnegative(hi));
      if (
        n !== undefined &&
        !held &&
        !(isFunction(empty, 'List') && empty.nops === n)
      )
        decline(
          e,
          'a term that is a list, over a range that can be empty, where the interpreter gives a number (the type of the sum states no length)'
        );
      return v;
    };
    if (cx.budget === undefined || !Number.isFinite(cx.budget)) return run();
    // `iterationBudget`: a loop of more passes than the budget is NaN
    // (`CompilationOptions.iterationBudget`), `hi - lo < budget` otherwise.
    const span = cx.apply(e, 'Subtract', [hi, lo]);
    const budget = integer(Math.floor(cx.budget));
    const within = cx.apply(e, 'Less', [span, budget]);
    let lane: Lane = 'real';
    let shape: readonly Length[] = [];
    let axis: number | undefined;
    return cx.branch(
      e,
      within,
      () => {
        const v = run();
        lane = type(v).lane;
        shape = type(v).shape;
        axis = cx.tuples.get(v);
        return v;
      },
      () => {
        const nan =
          lane === 'complex'
            ? b.constant({ re: NaN, im: NaN }, 'complex')
            : b.constant(NaN, 'real');
        // A list (a tuple) of NaN for a list (a tuple) of terms.
        return filledAs(e, shape, axis, nan);
      },
      true
    )!;
  };

  /** The fold of `r` over the scalars and the elements of the lists of
   *  `items`, from `init`. With `empty`, the value when there is no term
   *  at all (`Max()` is NaN, where its identity is −∞). */
  const reduce = (
    e: Fn,
    r: OperatorRow,
    items: (Source | V)[],
    init: V,
    empty?: number,
    identity = false
  ): V => {
    let acc = init;
    for (const x of items)
      if (typeof x === 'number') acc = cx.apply(e, r, [acc, x]);
    const lists = items.filter((x): x is Source => typeof x !== 'number');
    for (const s of lists) {
      // A short list of a constant length is written out, from its first
      // element when `acc` is still the identity of `r` (`README.md`,
      // "Lists", the short lists).
      const n = cx.constant(s.length);
      if (n !== undefined && n >= 1 && n <= cx.unrollBuilds) {
        const written = writtenOut(
          e,
          r,
          acc,
          integer(0),
          integer(n - 1),
          s.at,
          identity && acc === init
        );
        if (written !== undefined) {
          acc = written;
          continue;
        }
      }
      const last = cx.apply(e, 'Subtract', [s.length, integer(1)]);
      acc = accumulate(e, r, acc, integer(0), last, s.at);
    }
    if (empty === undefined || lists.length < items.length) return acc;
    const total = lists
      .map((s) => s.length)
      .reduce((n, m) => cx.apply(e, 'Add', [n, m]));
    const none = cx.apply(e, 'Equal', [total, integer(0)]);
    const result = acc;
    return cx.branch(
      e,
      none,
      () => b.constant(empty, 'real'),
      () => result,
      true
    )!;
  };

  /** A reduction head (`Sum`, `Max`, …) of lists and scalars. */
  const reduction = (e: Fn, r: OperatorRow): V => {
    const red = REDUCTIONS.get(e.operator)!;
    if (red.indexed && e.nops === 2 && isFunction(e.ops[1], 'Limits'))
      return aggregate(e, r);
    // `Sum(body, Element(k, L))` ranges over the elements of `L`: the
    // `Element` is a clause, not the boolean of a membership.
    if (e.ops.slice(1).some((x) => isFunction(x, 'Element')))
      decline(
        e,
        `${e.operator} over the elements of a list (an Element clause)`
      );
    // A literal list of scalars is read as its elements, with no array:
    // `Max(List(x, y))` is `Max(x, y)`, and `Sum(List(x, y))` is `Sum(x, y)`,
    // whose fold from the identity is the loop's. Only the library's `List`.
    const [l] = e.ops;
    const literal =
      e.nops === 1 &&
      literalList(cx, l) &&
      l.nops > 0 &&
      l.ops.every((x) => x.type.matches('number'))
        ? l.ops
        : undefined;
    const items = (literal ?? e.ops).map((x) => source(x, true, true));
    if (!red.indexed && items.every((x) => typeof x === 'number')) {
      // `Max(x)` of one real is `x`; of a boolean or a complex number the
      // interpreter leaves it unevaluated (a decline of `apply()`).
      const one = items.length === 1 && type(items[0] as V).lane;
      if (one === 'real' || one === 'integer') return items[0] as V;
      return cx.apply(e, r, items as V[]);
    }
    const lane = Number.isFinite(red.identity) ? 'integer' : 'real';
    const init = b.constant(red.identity, lane);
    // A `Sum` of doubles written out starts from 0, as its loop: `0 + -0`
    // is `0` (`Sum(L)` of `L = [-0, -0]`). The interval mode starts from
    // the first element.
    const identity = cx.interval || e.operator !== 'Sum';
    return reduce(e, r, items, init, red.empty, identity);
  };

  /** A `Map` (or, with `filter`, a `Filter`) of the function literal `f`
   *  over the list `l`: a build whose body reads the element `k`. */
  const build = (e: Fn, l: Expression, f: Expression, filter: boolean): V => {
    f = operatorLiteral(f, cx.rows, 1);
    const param = isFunction(f, 'Function')
      ? parameterName(f.ops[1])
      : undefined;
    if (!isFunction(f, 'Function') || f.nops !== 2 || param === undefined)
      decline(
        e,
        `${e.operator} of a function that is not a literal of one parameter`
      );
    return over(e, source(l), param, f.ops[0], filter, f);
  };

  /** `Map(f, L1, …, Ln)` of two lists or more and a function literal of
   *  `n` parameters: a build over the shortest length, as the interpreter's,
   *  whose body reads the element of each list at the index. The lists are
   *  lowered once; one with an effect declines (the interpreter reads them
   *  up to the shortest). */
  const mapLists = (e: Fn): V => {
    const [g, ...ls] = e.ops;
    const f = operatorLiteral(g, cx.rows, ls.length);
    const names = isFunction(f, 'Function')
      ? f.ops.slice(1).map(parameterName)
      : [];
    // A name written twice: the interpreter binds the first.
    if (
      names.length !== ls.length ||
      names.includes(undefined) ||
      new Set(names).size !== names.length
    )
      decline(
        e,
        `Map of ${ls.length} lists and a function that is not a literal of ${ls.length} parameters of distinct names`
      );
    const before = b.effects;
    const sources = ls.map((l) => source(l));
    if (b.effects > before)
      decline(
        e,
        'Map of a list with an effect (the interpreter reads the lists up to the shortest)'
      );
    const length = shortest(e, sources);
    // The source's element is the index: `over()` binds it to the first
    // name, which the frame of the body binds again to its element.
    const index: Source = { length, at: (k) => k };
    const body = (k: V) =>
      cx.withFrame(true, (frame) => {
        names.forEach((n, j) =>
          frame.names.set(n!, { v: sources[j].at(k), role: 'index' })
        );
        return cx.value((f as Fn).ops[0])!;
      });
    return over(e, index, names[0]!, body, false, f);
  };

  /** The `Min` of the lengths of `sources`: the least stated length and
   *  the length values. */
  const shortest = (e: Fn, sources: Source[]): V => {
    const fixed = sources.flatMap((s) => cx.constant(s.length) ?? []);
    return [
      ...(fixed.length > 0 ? [integer(Math.min(...fixed))] : []),
      ...new Set(
        sources.flatMap((s) =>
          cx.constant(s.length) === undefined ? [s.length] : []
        )
      ),
    ].reduce((m, n) => cx.apply(e, 'Min', [m, n]));
  };

  /** `At(l, m)` of a boolean mask `m`: the elements of `l` at the positions
   *  up to the shorter length where `m` is true, as the interpreter's. */
  const mask = (e: Fn, l: V, m: V): V => {
    const [sl, sm] = [listSource(l), listSource(m)];
    const s: Source = { length: shortest(e, [sl, sm]), at: sl.at };
    return over(e, s, '', (_x, k) => sm.at(k), true, e);
  };

  /** A build (with `filter`, a filter) over `s` of `body`, which reads the
   *  element as `name`, or of `body(x, k)` for the element `x` at the index
   *  `k`. */
  const over = (
    e: Fn,
    s: Source,
    name: string,
    body: Expression | ((x: V, k: V) => V),
    filter: boolean,
    site: Expression
  ): V => {
    const element = (x: V, k: V) =>
      typeof body === 'function' ? body(x, k) : cx.value(body)!;
    // A target with no list of a run-time length has no build (GLSL): a
    // build of a constant length of at most `SCALARIZE_LIMIT` is the list
    // of its elements, the body lowered once per element, in order; so is a
    // short list (`unrollBuilds`) on another target.
    const n = cx.constant(s.length);
    const most = cx.runtimeLengths ? cx.unrollBuilds : SCALARIZE_LIMIT;
    // With run-time lengths, past the cap the build keeps its loop.
    const full =
      cx.runtimeLengths && unrolled + (n ?? 0) > SCALARIZE_LIMIT ** 2;
    if (!filter && n !== undefined && n >= 1 && n <= most && !full) {
      const before = unrolled;
      unrolled += n;
      if (unrolled > SCALARIZE_LIMIT ** 2)
        decline(e, `builds of more than ${SCALARIZE_LIMIT ** 2} elements`);
      const write = () => {
        const effects = b.effects;
        const elements = Array.from({ length: n }, (_, j) => {
          const x = s.at(integer(j));
          return indexed(name, x, () => element(x, integer(j)));
        });
        return b.effects === effects || !short
          ? cx.list(e, elements)
          : undefined;
      };
      // A short list on JavaScript keeps the build when its body has an
      // effect, as a sum written out: a draw stays one site of the frame.
      const short = cx.runtimeLengths && !cx.interval;
      if (short) cx.attempted();
      const v = short
        ? cx.attempt(
            write,
            () => true,
            () => (unrolled = before)
          )
        : write();
      if (v !== undefined) return v;
    }
    const k = b.newValue(scalarType('integer'));
    const outs = cx.region(
      filter ? 'filter' : 'build',
      [s.length],
      [k],
      () =>
        cx.withFrame(true, (frame) => {
          const x = s.at(k);
          frame.names.set(name, { v: x, role: 'index' });
          const v = element(x, k);
          if (lengthValues(type(v)).length > 0)
            decline(e, 'a list of lists of run-time length');
          if (!filter) return [v];
          if (type(v).lane !== 'boolean' || type(v).shape.length > 0)
            decline(site, 'a predicate that is not a boolean');
          // An element kept is a row of a list of lists (`chunks()`).
          if (lengthValues(type(x)).length > 0)
            decline(e, 'a list of lists of run-time length');
          return [v, x];
        }),
      e
    );
    return outs[outs.length - 1];
  };

  /** `Comprehension(body, Element(i, L))`, and with a condition
   *  `Element(i, L, cond)`: a filter of `L` by `cond`, then a build of
   *  `body` over the elements kept. The interpreter's list is lazy, so an
   *  effect declines (`README.md`, "Lists"). */
  const comprehension = (e: Fn): V => {
    const c = e.ops[1];
    if (e.nops > 2) return product(e);
    if (
      e.nops !== 2 ||
      !isFunction(c, 'Element') ||
      c.nops < 2 ||
      c.nops > 3 ||
      !isSymbol(c.ops[0])
    )
      decline(
        e,
        'a Comprehension that is not of one clause Element(i, L) or Element(i, L, condition)'
      );
    const name = c.ops[0].symbol;
    let s = source(c.ops[1]);
    const before = b.effects;
    if (c.nops === 3) s = listSource(over(e, s, name, c.ops[2], true, c));
    const v = over(e, s, name, e.ops[0], false, e);
    if (b.effects > before)
      decline(
        e,
        'a Comprehension with an effect (the interpreter evaluates its elements lazily)'
      );
    return v;
  };

  /** A `Comprehension` of several clauses `Element(i, L)`, none of whose
   *  lists reads an index (`README.md`, "Lists"): one build over the
   *  product of the lengths, whose index `k` gives the index of the clause
   *  `j` as `Floor(k / s_j) mod n_j`, `s_j` the product of the lengths after
   *  it (exact for a total below 2^53). */
  const product = (e: Fn): V => {
    const names: string[] = [];
    const before = b.effects;
    const sources = e.ops.slice(1).map((c) => {
      if (
        !isFunction(c, 'Element') ||
        c.nops !== 2 ||
        !isSymbol(c.ops[0]) ||
        (names.length > 0 && c.ops[1].has(names))
      )
        decline(
          e,
          'a Comprehension of several clauses that are not each Element(i, L) of a list that reads no index'
        );
      names.push(c.ops[0].symbol);
      return source(c.ops[1]);
    });
    const mul = (x: V, y: V) => cx.apply(e, 'Multiply', [x, y]);
    const strides = sources.reduceRight<V[]>(
      (s, x, j) => (j === 0 ? s : [mul(x.length, s[0]), ...s]),
      [integer(1)]
    );
    const k = b.newValue(scalarType('integer'));
    const [v] = cx.region(
      'build',
      [mul(sources[0].length, strides[0])],
      [k],
      () =>
        cx.withFrame(true, (frame) => {
          sources.forEach((s, j) => {
            const q = cx.apply(e, 'Floor', [
              cx.apply(e, 'Divide', [k, strides[j]]),
            ]);
            const i = j === 0 ? q : cx.apply(e, 'Mod', [q, s.length]);
            frame.names.set(names[j], { v: s.at(i), role: 'index' });
          });
          const y = cx.value(e.ops[0])!;
          if (lengthValues(type(y)).length > 0)
            decline(e, 'a list of lists of run-time length');
          return [y];
        }),
      e
    );
    if (b.effects > before)
      decline(
        e,
        'a Comprehension of several clauses with an effect (the interpreter evaluates a list once for each element of the clauses before it, and its elements lazily)'
      );
    return v;
  };

  /** `ListJoin(L1, …, Ln)` of lists, scalars and tuples (a scalar or a
   *  tuple is a list of one element, as in the interpreter: a tuple does
   *  not splice): a build over the sum of the lengths, whose element at `k`
   *  is the element of the first list whose end is after `k`. */
  const join = (e: Fn): V => {
    if (e.nops === 0) decline(e, 'ListJoin with no operand');
    const parts = e.ops.map((x) => {
      if (!isTupleOrTupleUnionShapedType(x.type.type)) return source(x, true);
      const v = cx.value(x)!;
      if (cx.tuples.get(v) !== 0) decline(x, 'a tuple that is not one point');
      return v;
    });
    // A part whose element is a row of a run-time length (`chunks()`): the
    // row is made in the arm that reads it.
    for (const x of parts)
      if (typeof x !== 'number' && lengthValues(type(elementOf(x))).length > 0)
        decline(e, 'a list of lists of run-time length');
    // The interpreter spreads a string into its characters (CE-1548).
    if (
      parts.some((x) => typeof x === 'number' && cx.type(x).lane === 'string')
    )
      decline(
        e,
        'ListJoin of a string (the interpreter spreads its characters)'
      );
    const length = (x: Source | V) =>
      typeof x === 'number' ? integer(1) : x.length;
    const ends: V[] = [];
    for (const x of parts)
      ends.push(
        ends.length === 0
          ? length(x)
          : cx.apply(e, 'Add', [ends[ends.length - 1], length(x)])
      );
    const at = (k: V, j: number): V => {
      const x = parts[j];
      const read = () =>
        typeof x === 'number'
          ? x
          : x.at(j === 0 ? k : cx.apply(e, 'Subtract', [k, ends[j - 1]]));
      if (j === parts.length - 1) return read();
      const inside = cx.apply(e, 'Less', [k, ends[j]]);
      return cx.branch(e, inside, read, () => at(k, j + 1), true)!;
    };
    return built(e, ends[ends.length - 1], (k) => at(k, 0));
  };

  /** `Join(L1, …, Ln)` of lists: the list of `ListJoin`, which declines
   *  lists of two lanes and a tuple (that `Join` appends as one element). A
   *  scalar operand is a `List` of it after canonicalization. Of a set the
   *  interpreter's `Join` is a set, and of strings a string: an operand
   *  whose static type is not a list declines. */
  const joinLists = (e: Fn): V => {
    // The carried accumulator of a fold, read at a run-time index
    // (`At(acc, k)`), is typed `indexed_collection<number>`; the binding
    // carries a list.
    const carried = (name: string): boolean => {
      for (let i = cx.frames.length - 1; i >= 0; i--) {
        const binding = cx.frames[i].names.get(name);
        if (binding !== undefined) return binding.accumulator === true;
      }
      return false;
    };
    const listy = (x: Expression) =>
      x.type.matches('list') ||
      (isSymbol(x) &&
        x.type.matches('indexed_collection<number>') &&
        carried(x.symbol));
    if (e.nops === 0 || !e.ops.every(listy))
      decline(e, 'Join of other than lists');
    return join(e);
  };

  /** The integer `head` (`Add`, `Subtract`, `Min`, `Max`, `Mod`) of the
   *  integers `x` and `y`: a constant when both are (a constant length and
   *  constant indices write a short list out, and GLSL reads no other). */
  const int = (e: Fn, head: string, x: V, y: V): V => {
    const [p, q] = [cx.constant(x), cx.constant(y)];
    if (
      p !== undefined &&
      q !== undefined &&
      type(x).lane === 'integer' &&
      type(y).lane === 'integer' &&
      (head !== 'Mod' || q > 0)
    ) {
      const f: Record<string, number> = {
        Add: p + q,
        Subtract: p - q,
        Min: Math.min(p, q),
        Max: Math.max(p, q),
        Mod: ((p % q) + q) % q,
      };
      if (head in f) return integer(f[head]);
    }
    return cx.apply(e, head, [x, y]);
  };

  /** The list of `length` elements whose element at `k` is the element of
   *  `s` at `index(k)`, from 0. */
  const reindexed = (e: Fn, s: Source, length: V, index: (k: V) => V): V =>
    over(e, { length, at: (k) => s.at(index(k)) }, '', (x) => x, false, e);

  /** The count of `Take`, `Drop`, `RotateLeft` and `RotateRight`: an
   *  integer (the interpreter rounds a real count of `Take` and `Drop`,
   *  which declines). A real count of a rotation (`rotation`) is tested at
   *  run time, and fails where it is not an integer: the interpreter's
   *  value is an error there. */
  const count = (x: Expression, rotation = false): V => {
    const v = cx.scalar(x);
    if (type(v).lane === 'integer') return v;
    if (!rotation || type(v).lane !== 'real')
      decline(x, 'a count that is not an integer');
    return cx.apply(x, op('count.int'), [v]);
  };

  /** The value of a real list `x` for `Median` and `Sort`: one list of
   *  real or integer numbers, not a tuple. */
  const reals = (e: Fn, l: V = cx.value(e.ops[0])!): V => {
    if (
      cx.tuples.has(l) ||
      type(l).shape.length !== 1 ||
      !isSubLane(type(l).lane, 'real')
    )
      decline(e, `${e.operator} of other than one list of real numbers`);
    return l;
  };

  /** The sum from 0 of `f` at each index of the length `n`. */
  const sumOf = (e: Fn, n: V, f: (k: V) => V): V =>
    reduce(e, rowOfHead(cx.rows, 'Add')!, [{ length: n, at: f }], integer(0));

  /** `Dot(u, v)` of two vectors of real numbers (lists of numbers or
   *  points): the sum from 0 of the products of the elements. A list of
   *  points with a point, or two lists of points pair by pair, is the list
   *  of those sums, as the interpreter broadcasts it. */
  const dot = (e: Fn): V => {
    const [u, v] = e.ops.map((x) => cx.value(x)!);
    const kind = (w: V) => {
      const t = type(w);
      if (!isSubLane(t.lane, 'real')) return undefined;
      if (t.shape.length === 1) return 'vector';
      return t.shape.length === 2 && cx.tuples.get(w) === 1
        ? 'points'
        : undefined;
    };
    const [ku, kv] = [kind(u), kind(v)];
    if (ku === undefined || kv === undefined)
      decline(
        e,
        'Dot of other than vectors, points or lists of points of real numbers'
      );
    const inner = (a: V, c: V): V => {
      const [sa, sc] = [listSource(a), listSource(c)];
      const [na, nc] = [cx.constant(sa.length), cx.constant(sc.length)];
      if (na !== undefined && nc !== undefined && na !== nc)
        decline(e, 'Dot of vectors of two lengths');
      return sumOf(e, sa.length, (k) =>
        cx.apply(e, 'Multiply', [sa.at(k), sc.at(k)])
      );
    };
    if (ku === 'vector' && kv === 'vector') return inner(u, v);
    // A list of points with a list of numbers (a vector or a row of a
    // matrix) has no value in the interpreter.
    if (
      (ku === 'vector' && !cx.tuples.has(u)) ||
      (kv === 'vector' && !cx.tuples.has(v))
    )
      decline(e, 'Dot of a list of points and a value that is not a point');
    const [su, sv] = [listSource(u), listSource(v)];
    if (ku === 'points' && kv === 'points') {
      const [nu, nv] = [cx.constant(su.length), cx.constant(sv.length)];
      if (nu !== undefined && nv !== undefined && nu !== nv)
        decline(e, 'Dot of lists of points of two lengths');
    }
    const s = ku === 'points' ? su : sv;
    return over(
      e,
      { length: s.length, at: (k) => k },
      '',
      (_x, k) =>
        inner(ku === 'points' ? su.at(k) : u, kv === 'points' ? sv.at(k) : v),
      false,
      e
    );
  };

  /** `Norm(x)` and `Norm(x, p)`: of a real scalar its `Abs`; of a point
   *  or a list of points (order 2) the Euclidean norm of `Abs`; of a list of
   *  real numbers, the order 1 (the sum of the absolute values), 2 (the
   *  square root of the sum of the squares) or `Infinity` (the largest
   *  absolute value, from 0). */
  const norm = (e: Fn): V => {
    const x = cx.value(e.ops[0])!;
    const t = type(x);
    const o = e.ops[1];
    const p =
      o === undefined
        ? 2
        : isSymbol(o, 'PositiveInfinity')
          ? Infinity
          : isNumber(o) && o.im === 0
            ? o.re
            : NaN;
    // Of a complex scalar, its modulus, as the interpreter's for every order.
    if (t.lane === 'complex' && t.shape.length === 0 && p > 0)
      return cx.apply(e, 'Abs', [x]);
    if (!isSubLane(t.lane, 'real'))
      decline(e, 'Norm of a value that is not real');
    // An order that is not a positive number (a symbol, 0, -1) has no
    // value in the interpreter, or one this code does not compute.
    if (!(p > 0)) decline(e, 'Norm of an order that is not a positive number');
    if (t.shape.length === 0 || (cx.tuples.has(x) && p === 2))
      return cx.apply(e, 'Abs', [x]);
    if (
      t.shape.length !== 1 ||
      cx.tuples.has(x) ||
      ![1, 2, Infinity].includes(p)
    )
      decline(
        e,
        'Norm of a matrix, of a point with an order other than 2, or of an order other than 1, 2 and Infinity'
      );
    const s = listSource(x);
    const abs = (k: V) => cx.apply(e, 'Abs', [s.at(k)]);
    if (p === 1) return sumOf(e, s.length, abs);
    if (p === Infinity)
      return reduce(
        e,
        rowOfHead(cx.rows, 'Max')!,
        [{ length: s.length, at: abs }],
        integer(0)
      );
    return cx.apply(e, 'Sqrt', [
      sumOf(e, s.length, (k) => {
        // A square, not a product of two reads: the interval mode encloses
        // a square of a box that crosses 0 from 0, with no domain mark.
        return cx.apply(e, 'Power', [s.at(k), integer(2)]);
      }),
    ]);
  };

  /** `x` and `y` are the same double: equal, or both NaN (`isSame()` of
   *  the interpreter, for values that it holds as doubles). */
  const same = (e: Fn, x: V, y: V): V =>
    cx.apply(e, 'Or', [
      cx.apply(e, 'Equal', [x, y]),
      cx.apply(e, 'And', [
        cx.apply(e, op('isnan'), [x]),
        cx.apply(e, op('isnan'), [y]),
      ]),
    ]);

  /** `Any(L, p)` and `All(L, p)`, and of a list of booleans `Any(L)` and
   *  `All(L)`: the count of a filter of `L` by `p` (by its elements with no
   *  `p`), compared with 0 or with the length. The interpreter stops at the
   *  first element that decides, so an effect in the list or in `p`
   *  declines. */
  const quantifier = (e: Fn): V => {
    const effects = b.effects;
    const s = source(e.ops[0]);
    let kept: V;
    if (e.nops === 1) kept = over(e, s, '', (x) => x, true, e);
    else {
      const f = operatorLiteral(e.ops[1], cx.rows, 1);
      const param = isFunction(f, 'Function')
        ? parameterName(f.ops[1])
        : undefined;
      if (!isFunction(f, 'Function') || f.nops !== 2 || param === undefined)
        decline(
          e,
          `${e.operator} of a function that is not a literal of one parameter`
        );
      kept = over(e, s, param, f.ops[0], true, f);
    }
    if (b.effects > effects)
      decline(
        e,
        `${e.operator} with an effect (the interpreter stops at the first element that decides)`
      );
    const n = listSource(kept).length;
    return e.operator === 'Any'
      ? cx.apply(e, 'Less', [integer(0), n])
      : cx.apply(e, 'Equal', [n, s.length]);
  };

  /** `Contains(L, v)` and `IndexOf(L, v)` of a list of real numbers and a
   *  real number: a filter of the indices from 0 whose element is the same
   *  as `v` (`same()`); `Contains` is a count above 0, `IndexOf` the first
   *  index kept plus 1, or 0. A list with an effect declines (the
   *  interpreter stops at the first match). */
  const search = (e: Fn): V => {
    // `Element(v, L)` is `Contains(L, v)`.
    const [l, needle] =
      e.operator === 'Element' ? [e.ops[1], e.ops[0]] : [e.ops[0], e.ops[1]];
    // The interpreter compares exact values (`1/3` is not its double, and
    // `3·0.1` in a `Range` is `0.3`): the doubles compare as it does for
    // integers, and for inputs and float literals.
    // An input: a name with no binding yet (an input is bound where it is
    // first read), or bound as an input; a local or a parameter can hold an
    // exact value (`Declare(q, real, 1/3)`).
    const input = (name: string): boolean => {
      for (let i = cx.frames.length - 1; i >= 0; i--) {
        const binding = cx.frames[i].names.get(name);
        if (binding !== undefined) return binding.role === 'input';
      }
      return true;
    };
    const doubles = (x: Expression): boolean =>
      isSymbol(x)
        ? x.isConstant !== true && x.value === undefined && input(x.symbol)
        : isNumber(x)
          ? x.isExact !== true || x.type.matches('integer')
          : isFunction(x, 'List') && x.ops.every(doubles);
    const integers =
      l.type.matches('list<integer>') && needle.type.matches('integer');
    if (!integers && !(doubles(l) && doubles(needle)))
      decline(
        e,
        `${e.operator} of a value that the interpreter may hold exactly`
      );
    const effects = b.effects;
    const s = source(l);
    const v = cx.scalar(needle);
    const real = (x: V) =>
      isSubLane(type(x).lane, 'real') && type(x).shape.length === 0;
    if (!real(v)) decline(e, `${e.operator} of other than real numbers`);
    const kept = over(
      e,
      { length: s.length, at: (k) => k },
      '',
      (_x, k) => {
        const x = s.at(k);
        if (!real(x)) decline(e, `${e.operator} of other than real numbers`);
        return same(e, x, v);
      },
      true,
      e
    );
    if (b.effects > effects)
      decline(
        e,
        `${e.operator} of a list with an effect (the interpreter stops at the first match)`
      );
    const n = listSource(kept).length;
    const found = cx.apply(e, 'Less', [integer(0), n]);
    if (e.operator !== 'IndexOf') return found;
    return cx.branch(
      e,
      found,
      () =>
        cx.apply(e, 'Add', [
          b.op('elem', [kept, integer(0)], elementType(type(kept))),
          integer(1),
        ]),
      () => integer(0),
      true
    )!;
  };

  /** `Sort(L, f)`. Of a function of one parameter, a sort key: the
   *  elements of `L` in the order of `Ordering(Map(f, L))`, the
   *  interpreter's sort by the keys, computed once per element in order
   *  (NaN last, stable); a key that is not a real number declines. Of a
   *  function of two parameters, a comparator: the region `sortby`, which
   *  sorts the indices with `Array.prototype.sort` as the interpreter does
   *  (`sortedIndicesWalk()`), by -1 where the comparator gives `True` or a
   *  negative number, 0 for 0 or NaN, 1 otherwise, NaN elements last
   *  whatever the comparator; elements that are not real numbers, and a
   *  comparator with an effect, decline. */
  const sortBy = (e: Fn): V => {
    const g = e.ops[1];
    // The interpreter sorts by a key when the value of `g` requires one
    // argument, and calls `g(a, b)` as a comparator otherwise
    // (`sortedIndicesWalk()`): a user function by the required parameters
    // of its literal (`(a, b = 0) ↦ …` is a key), a library operator by its
    // signature (`Floor`, whose second
    // parameter is optional, is a comparator there).
    if (isSymbol(g) && rowOfHead(cx.rows, g.symbol)?.arity === 'variadic')
      decline(e, 'Sort by a variadic operator');
    const user = isSymbol(g)
      ? userBinding({
          operator: g.symbol,
          operatorDefinition: g.operatorDefinition,
          valueDefinition: g.valueDefinition,
          engine: g.engine,
        } as never)
      : undefined;
    const n = requiredArity((user?.literal ?? g).type.type) === 1 ? 1 : 2;
    const f = operatorLiteral(g, cx.rows, n);
    const params = isFunction(f, 'Function')
      ? f.ops.slice(1).map(parameterName)
      : [];
    if (
      !isFunction(f, 'Function') ||
      params.length !== n ||
      params.includes(undefined) ||
      new Set(params).size !== params.length
    )
      decline(
        e,
        'Sort by a function that is not a literal of one or two parameters of distinct names'
      );
    const s = source(e.ops[0]);
    const at = (order: V) => (k: V) =>
      b.op('elem', [order, k], elementType(type(order)));
    if (params.length === 1) {
      const keys = over(e, s, params[0]!, f.ops[0], false, f);
      const t = type(keys);
      if (
        t.shape.length !== 1 ||
        cx.tuples.has(keys) ||
        !isSubLane(t.lane, 'real')
      )
        decline(e, 'Sort by a key that is not a real number');
      const order = cx.apply(e, op('ordering'), [keys]);
      return reindexed(e, s, s.length, (k) =>
        cx.apply(e, 'Subtract', [at(order)(k), integer(1)])
      );
    }
    const [i, j] = [
      b.newValue(scalarType('integer')),
      b.newValue(scalarType('integer')),
    ];
    const body = (f as Fn).ops[0];
    const sign = (c: V, then: () => V, otherwise: () => V) =>
      cx.branch(e, c, then, otherwise, true)!;
    const nan = (v: V) => cx.apply(e, op('isnan'), [v]);
    const effects = b.effects;
    const [order] = cx.region(
      'sortby',
      [s.length],
      [i, j],
      () =>
        cx.withFrame(true, (frame) => {
          const [x, y] = [s.at(i), s.at(j)];
          for (const v of [x, y])
            if (type(v).shape.length > 0 || !isSubLane(type(v).lane, 'real'))
              decline(
                e,
                'Sort by a comparator of elements that are not real numbers'
              );
          frame.names.set(params[0]!, { v: x, role: 'index' });
          frame.names.set(params[1]!, { v: y, role: 'index' });
          const compare = (): V => {
            const r = cx.scalar(body);
            if (type(r).lane === 'boolean')
              return sign(
                r,
                () => integer(-1),
                () => integer(1)
              );
            if (!isSubLane(type(r).lane, 'real'))
              decline(
                e,
                'Sort by a comparator that is not a boolean or a real number'
              );
            const above = () =>
              sign(
                cx.apply(e, 'Greater', [r, integer(0)]),
                () => integer(1),
                () => integer(0)
              );
            return sign(
              cx.apply(e, 'Less', [r, integer(0)]),
              () => integer(-1),
              above
            );
          };
          return [
            sign(
              nan(x),
              () =>
                sign(
                  nan(y),
                  () => integer(0),
                  () => integer(1)
                ),
              () => sign(nan(y), () => integer(-1), compare)
            ),
          ];
        }),
      e
    );
    if (b.effects > effects) decline(e, 'Sort by a comparator with an effect');
    return reindexed(e, s, s.length, at(order));
  };

  /** The list of the first `n` elements of `it`, `Iterate(f, x0)`, for a
   *  run-time `n >= 0`: the region `iterate`, whose pass `k` from 0 binds
   *  the accumulator (`x0`, then the element before) and yields
   *  `f(k + 1, acc)`, or `f(acc)` when the value of `f` requires one
   *  argument (`iterateArgs()` of the library: a user function by its
   *  literal, a library operator by its signature). Real numbers only; an
   *  integer `x0` keeps the integer lane when `f` gives an integer of one.
   *  The interpreter's list is lazy and memoized, so an effect declines. */
  const iterated = (e: Fn, it: Fn, n: V): V => {
    if (cx.interval) decline(it, 'Iterate on interval-js');
    if (it.nops > 2) decline(it, `Iterate of ${it.nops} operands`);
    const g = it.ops[0];
    const user = isSymbol(g)
      ? userBinding({
          operator: g.symbol,
          operatorDefinition: g.operatorDefinition,
          valueDefinition: g.valueDefinition,
          engine: g.engine,
        } as never)
      : undefined;
    const arity = requiredArity((user?.literal ?? g).type.type) === 1 ? 1 : 2;
    const f = operatorLiteral(g, cx.rows, arity);
    const params = isFunction(f, 'Function')
      ? f.ops.slice(1).map(parameterName)
      : [];
    if (
      !isFunction(f, 'Function') ||
      params.length !== arity ||
      params.includes(undefined) ||
      new Set(params).size !== params.length
    )
      decline(
        it,
        `Iterate of a function that is not a literal of ${arity} parameters of distinct names`
      );
    // With no initial value the accumulator of the first pass is
    // `Nothing`: a function of the index that does not name it (any
    // occurrence of the name, also one bound again inside) is a function
    // of the index alone.
    const names = (x: Expression): boolean =>
      isSymbol(x) ? x.symbol === params[1] : isFunction(x) && x.ops.some(names);
    if (it.nops !== 2 && (arity === 1 || names((f as Fn).ops[0])))
      decline(it, 'Iterate with no initial value of a function that reads it');
    const effects = b.effects;
    const real = (v: V) =>
      type(v).shape.length === 0 && isSubLane(type(v).lane, 'real');
    const init = it.nops === 2 ? cx.scalar(it.ops[1]) : integer(0);
    if (!real(init))
      decline(
        it.ops[1],
        'an initial value of Iterate that is not a real number'
      );
    /** The parameters of a pass whose accumulator is on `lane`, and its
     *  yield. */
    const pass = (lane: Lane): [V[], () => V[]] => {
      const [k, acc] = [
        b.newValue(scalarType('integer')),
        b.newValue(scalarType(lane)),
      ];
      const yields = () =>
        cx.withFrame(true, (frame) => {
          if (arity === 2)
            frame.names.set(params[0]!, {
              v: cx.apply(e, 'Add', [k, integer(1)]),
              role: 'index',
            });
          frame.names.set(params[arity - 1]!, { v: acc, role: 'index' });
          const y = cx.scalar((f as Fn).ops[0]);
          if (!real(y))
            decline(
              it,
              'Iterate of a function whose value is not a real number'
            );
          return [y];
        });
      return [[k, acc], yields];
    };
    // An integer `x0` whose next element is not an integer: the
    // accumulator is a real. The trial region is not emitted.
    let lane = type(init).lane;
    if (lane === 'integer') {
      const before = b.effects;
      const [ps, yields] = pass(lane);
      const r = b.region(ps, yields);
      b.effects = before;
      if (type(r.yields[0]).lane !== 'integer') lane = 'real';
    }
    const [ps, yields] = pass(lane);
    const [out] = cx.region('iterate', [n, init], ps, yields, e);
    // A guard: the trial above lowered the same body on the same lane.
    if (lane === 'integer' && type(out).lane !== 'integer')
      decline(it, 'an accumulator that changes lane');
    if (b.effects > effects)
      decline(
        it,
        'Iterate with an effect (the interpreter computes its elements lazily)'
      );
    return out;
  };

  /** `x` is the library's `Iterate`. */
  const isIterate = (x: Expression): x is Fn =>
    isFunction(x, 'Iterate') && cx.isLibrary(x);

  /** The elements of `Iterate(f, x0)` up to the integer index `i`, from 1
   *  (none for `i < 1`), which an `At` of `i` reads. */
  const iterateTo = (e: Fn, it: Fn, i: V): V => {
    if (type(i).lane !== 'integer' || type(i).shape.length > 0)
      decline(e, 'an index of Iterate that is not an integer');
    return iterated(e, it, int(e, 'Max', i, integer(0)));
  };

  /** `Take(Iterate(f, x0), m)` of an integer `m`: the first `m` elements.
   *  A negative constant `m` declines, and a negative `m` at run time
   *  throws (the interpreter leaves both unevaluated). */
  const iterateTake = (e: Fn): V => {
    const m = count(e.ops[1]);
    const c = cx.constant(m);
    if (c !== undefined && c < 0)
      decline(
        e,
        'Take of a negative count of an unbounded list (the interpreter leaves it unevaluated)'
      );
    const n =
      c !== undefined
        ? m
        : cx.apply(e, op('present.int'), [
            cx.apply(e, 'Less', [m, integer(0)]),
            m,
          ]);
    return iterated(e, e.ops[0] as Fn, n);
  };

  /** The operands of `Mean` and of a variance, read the same way: the
   *  elements of each list and each scalar, their sum from 0 in order, and
   *  their count. */
  const meanParts = (e: Fn) => {
    const items = e.ops.map((x) => source(x, true, true));
    const sum = reduce(e, rowOfHead(cx.rows, 'Add')!, items, integer(0));
    if (type(sum).lane === 'complex')
      decline(e, `${e.operator} of complex numbers`);
    const n = items
      .map((x) => (typeof x === 'number' ? integer(1) : x.length))
      .reduce((a, c) => int(e, 'Add', a, c));
    return { items, sum, n };
  };

  /** `Variance`, `PopulationVariance`, `StandardDeviation` and
   *  `PopulationStandardDeviation` of the elements and the scalars of the
   *  operands, in two passes: the mean (as `Mean`), then the corrected sum
   *  `Σd² - (Σd)²/n` of the deviations `d` from it, at least 0, over
   *  `n - 1` (the sample) or `n`. The divisor of the sample is at least 0,
   *  so no element and one element are `0/0`, NaN, as the interpreter's; a
   *  NaN or an infinite element makes the mean or a deviation NaN, which
   *  `Max` keeps, as the interpreter's. */
  const variance = (e: Fn): V => {
    const h = e.operator;
    // A distribution is no list or number of the compiled code.
    if (e.ops.some((x) => !x.type.matches('collection<number> | number')))
      decline(e, `${h} of other than numbers and lists of numbers`);
    const add = rowOfHead(cx.rows, 'Add')!;
    const { items, sum, n } = meanParts(e);
    const divisor = h.startsWith('Population')
      ? n
      : int(e, 'Max', int(e, 'Subtract', n, integer(1)), integer(0));
    if (cx.constant(divisor) === 0) return b.constant(NaN, 'real');
    const mean = cx.apply(e, 'Divide', [sum, n]);
    // The corrected two-pass form: with `d = x - mean`, the sum of the
    // squares of the deviations is `Σd² - (Σd)²/n` for any `mean`, so the
    // rounding of the mean (data with a large common offset, constant data)
    // cancels; `Max(…, 0)` keeps a rounding (or an enclosure) from going
    // below 0. A square, not a product of two reads: the interval mode
    // encloses a square of a box that crosses 0 from 0.
    const deviation = (x: V) => cx.apply(e, 'Subtract', [x, mean]);
    const over = (f: (x: V) => V) =>
      items.map((x) =>
        typeof x === 'number'
          ? f(x)
          : { length: x.length, at: (k: V) => f(x.at(k)) }
      );
    const squares = reduce(
      e,
      add,
      over((x) => cx.apply(e, 'Power', [deviation(x), integer(2)])),
      integer(0)
    );
    const drift = reduce(e, add, over(deviation), integer(0));
    const centered = cx.apply(e, 'Subtract', [
      squares,
      cx.apply(e, 'Divide', [cx.apply(e, 'Power', [drift, integer(2)]), n]),
    ]);
    const v = cx.apply(e, 'Divide', [
      cx.apply(e, 'Max', [centered, integer(0)]),
      divisor,
    ]);
    return h.endsWith('Deviation') ? cx.apply(e, 'Sqrt', [v]) : v;
  };

  /** The integer of the count or index `x`: an integer, or a real rounded
   *  as the interpreter's `toInteger()` (`Math.round`; `count.round` at run
   *  time). */
  const rounded = (x: Expression): V => {
    const v = cx.scalar(x);
    if (type(v).lane === 'integer') return v;
    if (type(v).lane !== 'real')
      decline(x, 'a count that is not a real number');
    const c = cx.constant(v);
    if (c !== undefined && Number.isFinite(c)) return integer(Math.round(c));
    return cx.apply(x, op('count.round'), [v]);
  };

  /** `then()` where `x head y` holds, `otherwise()` elsewhere: chosen at
   *  compile time when `x` and `y` are constants. */
  const when = (
    e: Fn,
    head: 'Less' | 'LessEqual' | 'Equal',
    x: V,
    y: V,
    then: () => V,
    otherwise: () => V
  ): V => {
    const [p, q] = [cx.constant(x), cx.constant(y)];
    if (p !== undefined && q !== undefined)
      return (head === 'Less' ? p < q : head === 'LessEqual' ? p <= q : p === q)
        ? then()
        : otherwise();
    return cx.branch(e, cx.apply(e, head, [x, y]), then, otherwise, true)!;
  };

  /** The function literal of `n` parameters of distinct names that `g` is
   *  (a literal, a user function or a library operator of that arity,
   *  `operatorLiteral()`): its parameter names, its body and the literal. */
  const literalOf = (e: Fn, g: Expression, n: number) => {
    const f = operatorLiteral(g, cx.rows, n);
    const names = isFunction(f, 'Function')
      ? f.ops.slice(1).map(parameterName)
      : [];
    if (
      !isFunction(f, 'Function') ||
      names.length !== n ||
      names.includes(undefined) ||
      new Set(names).size !== n
    )
      decline(
        e,
        `${e.operator} of a function that is not a literal of ${n === 1 ? 'one parameter' : `${n} parameters of distinct names`}`
      );
    return { names: names as string[], body: f.ops[0], site: f };
  };

  /** The value of `body` with each name of `names` bound to the value of
   *  the same position in `values`. */
  const applied = (
    names: string[],
    values: V[],
    body: Expression,
    accumulator?: number
  ): V =>
    cx.withFrame(true, (frame) => {
      names.forEach((n, j) =>
        frame.names.set(n, {
          v: values[j],
          role: 'index',
          ...(j === accumulator ? { accumulator: true } : {}),
        })
      );
      return cx.value(body)!;
    });

  /** The element of `s` at 0, lowered in a region that is not emitted
   *  (its type and its tuple mark). */
  const elementOf = (s: Source): V => {
    const before = b.effects;
    const r = b.region([], () => [s.at(integer(0))]);
    b.effects = before;
    return r.yields[0];
  };

  /** The flat list of numbers `l` as a source whose elements are real or
   *  integer scalars, not a tuple; `what` names the operator. */
  const numbers = (e: Fn, l: Expression): Source => {
    const s = source(l);
    const x = elementOf(s);
    if (type(x).shape.length > 0 || !isSubLane(type(x).lane, 'real'))
      decline(e, `${e.operator} of a list of other than real numbers`);
    return s;
  };

  /** The index from 0 of the index `x` (from 1, from the end when
   *  negative) of a list of `n` elements: a constant for constants (one
   *  that is 0, not an integer or out of range declines: the interpreter
   *  gives no list), `wix` at run time on JavaScript, which throws where
   *  the interpreter gives no list. */
  const position = (e: Fn, n: V, x: Expression): V => {
    const i = cx.scalar(x);
    if (!isSubLane(type(i).lane, 'real'))
      decline(x, 'an index that is not a number');
    const [m, c] = [cx.constant(n), cx.constant(i)];
    if (c !== undefined && (c === 0 || !Number.isInteger(c)))
      decline(
        e,
        `the index ${c} of ${e.operator} (the interpreter gives no list)`
      );
    if (m !== undefined && c !== undefined) {
      const at = elementIndex(m, c);
      if (at === undefined)
        decline(
          e,
          `the index ${c} of ${e.operator} of a list of ${m} elements (the interpreter leaves it unevaluated)`
        );
      return integer(at);
    }
    if (!cx.runtimeLengths || cx.interval)
      decline(e, `${e.operator} at an index known at run time`);
    return cx.apply(e, op('wix'), [n, i]);
  };

  /** The indices from 0 of the elements of `s` where the predicate `g`
   *  holds (with `negate`, where it fails). The interpreter stops at the
   *  first element that decides, so a predicate with an effect declines. */
  const where = (e: Fn, s: Source, g: Expression, negate = false): V => {
    const { names, body, site } = literalOf(e, g, 1);
    const effects = b.effects;
    const kept = over(
      e,
      { length: s.length, at: (k) => k },
      '',
      (_x, k) => {
        const p = applied(names, [s.at(k)], body);
        if (type(p).lane !== 'boolean' || type(p).shape.length > 0)
          decline(site, 'a predicate that is not a boolean');
        return negate ? cx.apply(e, 'Not', [p]) : p;
      },
      true,
      site
    );
    if (b.effects > effects)
      decline(
        e,
        `${e.operator} with an effect (the interpreter stops at the first element that decides)`
      );
    return kept;
  };

  /** The first element of the list `l`, read where it has one. */
  const head = (l: V): V => b.op('elem', [l, integer(0)], elementType(type(l)));

  /** The list of the elements of the flat list `s` (of numbers or
   *  booleans) and of the scalars `xs` after them (`Append`). */
  const appended = (e: Fn, s: Source, xs: V[]): V => {
    const n = s.length;
    const at = (k: V, j: number): V => {
      if (j === xs.length) return xs[j - 1];
      const end = int(e, 'Add', n, integer(j));
      return when(
        e,
        'Less',
        k,
        end,
        () => (j === 0 ? s.at(k) : xs[j - 1]),
        () => at(k, j + 1)
      );
    };
    return built(e, int(e, 'Add', n, integer(xs.length)), (k) => at(k, 0));
  };

  /** The list `s` as rows of `size` elements, the row `i` from the element
   *  `i·step`, `count` rows (`Chunk`, `Partition`). */
  const windows = (e: Fn, s: Source, count: V, size: number, step: V): V =>
    over(
      e,
      { length: count, at: (i) => i },
      '',
      (_x, i) => {
        const start = cx.apply(e, 'Multiply', [i, step]);
        return reindexed(e, s, integer(size), (j) => int(e, 'Add', start, j));
      },
      false,
      e
    );

  /** `x` is a list that the interpreter holds whole: an input, a literal
   *  `List`, or a name whose value is one (a `Range`, a `Map`, a local or
   *  a parameter can be a lazy list, which the interpreter leaves
   *  unevaluated past `maxCollectionSize` in `Chunk` and `Partition`). */
  const whole = (x: Expression): boolean => {
    if (literalList(cx, x)) return true;
    if (!isSymbol(x)) return false;
    for (let i = cx.frames.length - 1; i >= 0; i--) {
      const binding = cx.frames[i].names.get(x.symbol);
      if (binding !== undefined) return binding.role === 'input';
    }
    return isFunction(x.value, 'List');
  };

  /** `Chunk(L, k)`, `Partition(L, n)` and `Partition(L, p)` of a
   *  predicate `p` (`README.md`, "Lists", the list operators): the list of
   *  lists when every row has one length, else its rows, which `source()`
   *  makes each where it is read and `rows()` makes the value of the lane
   *  `rows`, the result of the program only (`README.md`, "The rows
   *  lane"). `undefined` for another expression, and in the interval
   *  mode. */
  const chunks = (
    e: Expression
  ):
    | V
    | { source: () => Source; rows: () => V; groups?: readonly V[] }
    | undefined => {
    if (
      cx.interval ||
      !isFunction(e) ||
      (e.operator !== 'Chunk' && e.operator !== 'Partition') ||
      e.nops !== 2 ||
      !cx.isLibrary(e)
    )
      return undefined;
    const h = e.operator;
    const [x, k] = e.ops;
    // The list as `source()` reads it, and its value when it is not a
    // `Range`.
    const effects = b.effects;
    const range = isFunction(x, 'Range') && cx.isLibrary(x);
    const l = range ? undefined : cx.value(x)!;
    if (l !== undefined && cx.tuples.get(l) === 0)
      decline(x, 'a tuple where a list is read');
    if (l !== undefined && type(l).shape.length === 0)
      decline(x, 'a scalar where a list is required');
    const s = l === undefined ? source(x) : listSource(l);
    // The interpreter's list is lazy: it reads the elements it needs only.
    if (b.effects > effects) decline(e, `${h} of a list with an effect`);
    const n = s.length;
    const predicate = h === 'Partition' && !k.type.matches('number');
    const c = predicate ? undefined : count(k);
    if (c !== undefined) {
      const [m, q] = [cx.constant(n), cx.constant(c)];
      // The interpreter leaves a count below 1 unevaluated, and a count of
      // `Chunk` above `MAX_CHUNK_COUNT`.
      if (q !== undefined && q < 1) decline(e, `${h} of a count below 1`);
      if (h === 'Chunk' && q !== undefined && q > MAX_CHUNK_COUNT)
        decline(e, `Chunk of a count above ${MAX_CHUNK_COUNT}`);
      // Rows of one length: a list of lists.
      if (m !== undefined && q !== undefined) {
        const size = h === 'Chunk' ? Math.ceil(m / q) : q;
        const rows = h === 'Chunk' ? q : Math.ceil(m / q);
        if (size * rows === m && size !== 0)
          return windows(e, s, integer(rows), size, integer(size));
      }
    }
    // Rows that can have different lengths, of numbers or booleans.
    if (l === undefined || !whole(x))
      decline(
        e,
        `${h} of a computed list (the interpreter leaves it unevaluated past maxCollectionSize)`
      );
    const y = elementOf(s);
    if (
      type(y).shape.length > 0 ||
      !(isSubLane(type(y).lane, 'real') || type(y).lane === 'boolean')
    )
      decline(e, `${h} of a list of other than numbers or booleans`);
    const zero = integer(0);
    const times = (p: V, q: V): V => {
      const [a, z] = [cx.constant(p), cx.constant(q)];
      return a !== undefined && z !== undefined
        ? integer(a * z)
        : cx.apply(e, 'Multiply', [p, q]);
    };
    if (c === undefined) {
      // The two groups: the elements where `p` holds, then the others.
      const groups = [false, true].map((negate) => {
        const ks = listSource(where(e, s, k, negate));
        return reindexed(e, s, ks.length, (j) => ks.at(j));
      });
      // The interpreter reads the length of the groups, and a group by
      // `At` (`groups`), but leaves `Map` and the other operators that read
      // each group unevaluated: they decline.
      return {
        source: () => ({
          length: integer(2),
          at: () =>
            decline(
              e,
              'a group of Partition by a predicate read one by one (the interpreter leaves Map of the groups unevaluated)'
            ),
        }),
        rows: () => cx.apply(e, op('rows.pair'), groups),
        groups,
      };
    }
    return {
      // A count known at run time is checked where it is read, as the
      // helpers check it (`rows.chunks`, `rows.size`).
      source: () => {
        const q =
          cx.constant(c) !== undefined
            ? c
            : cx.apply(e, op(h === 'Chunk' ? 'rows.chunks' : 'rows.size'), [c]);
        const [a, z] = [cx.constant(n), cx.constant(q)];
        const ceil = (): V =>
          a !== undefined && z !== undefined
            ? integer(Math.ceil(a / z))
            : cx.apply(e, 'Ceil', [cx.apply(e, 'Divide', [n, q])]);
        // `Chunk`: `q` rows of `⌈n/q⌉` elements, the last ones shorter or
        // empty; `Partition`: `⌈n/q⌉` rows of `q` elements, the last one
        // shorter.
        const size = h === 'Chunk' ? ceil() : q;
        return {
          length: h === 'Chunk' ? q : ceil(),
          at: (i) => {
            const start = times(i, size);
            const rest = int(e, 'Subtract', n, start);
            const length =
              h === 'Chunk'
                ? int(e, 'Max', zero, int(e, 'Min', size, rest))
                : int(e, 'Min', size, rest);
            return reindexed(e, s, length, (j) => int(e, 'Add', start, j));
          },
        };
      },
      rows: () =>
        cx.apply(e, op(h === 'Chunk' ? 'rows.chunk' : 'rows.partition'), [
          l,
          c,
        ]),
    };
  };

  /** A run of passes over the first `n` indices from `x0` (the region
   *  `iterate`): the element `k` is `step(k, acc)`, `acc` the element
   *  before, or `x0` at the first pass. Real numbers only; an integer `x0`
   *  keeps the integer lane when every step gives an integer (a trial
   *  lowering, not emitted). */
  const scanned = (e: Fn, n: V, x0: V, step: (k: V, acc: V) => V): V => {
    const real = (v: V) =>
      type(v).shape.length === 0 && isSubLane(type(v).lane, 'real');
    if (!real(x0))
      decline(e, `${e.operator} from a value that is not a real number`);
    const pass = (lane: Lane): [V[], () => V[]] => {
      const [k, acc] = [
        b.newValue(scalarType('integer')),
        b.newValue(scalarType(lane)),
      ];
      const yields = () => {
        const y = step(k, acc);
        if (!real(y))
          decline(
            e,
            `${e.operator} of a function whose value is not a real number`
          );
        return [y];
      };
      return [[k, acc], yields];
    };
    let lane = type(x0).lane;
    if (lane === 'integer') {
      const before = b.effects;
      const [ps, yields] = pass(lane);
      const r = b.region(ps, yields);
      b.effects = before;
      if (type(r.yields[0]).lane !== 'integer') lane = 'real';
    }
    const [ps, yields] = pass(lane);
    const [out] = cx.region('iterate', [n, x0], ps, yields, e);
    if (lane === 'integer' && type(out).lane !== 'integer')
      decline(e, 'an accumulator that changes lane');
    return out;
  };

  /** `Reduce(L, f, init)` of a function `f` of two parameters (a literal
   *  or a user function): the left fold from `init`, `f(acc, x)` for each
   *  element `x` in order, as the interpreter's. The accumulator is a real
   *  number, a Boolean, or a flat list of reals, integers or Booleans, or a
   *  tuple of scalars. An integer `init` keeps the integer lane when every
   *  step gives an integer.
   *
   *  A list or tuple accumulator is a carried value of the loop, as the
   *  list local written whole of a `Loop` (`wholeLocal()`): of the length
   *  of `init` when that is stated and every step keeps it, else of a
   *  run-time length, carried as its length and then the list
   *  (`README.md`, "Lists"). `List()` has no type, so its lane is the
   *  body's. */
  const reduceBy = (e: Fn): V => {
    if (cx.interval) decline(e, 'Reduce by a function on interval-js');
    const { names, body } = literalOf(e, e.ops[1], 2);
    const effects = b.effects;
    const s = source(e.ops[0]);
    const seed = e.ops[2];
    const empty = isFunction(seed, 'List') && seed.nops === 0;
    const init = empty ? undefined : cx.value(seed)!;
    if (b.effects > effects)
      decline(e, 'Reduce of a list or an initial value with an effect');
    const it = init === undefined ? undefined : type(init);
    const tuple = init !== undefined && cx.tuples.get(init) === 0;
    const kind: 'scalar' | 'list' =
      it === undefined || it.shape.length === 1 ? 'list' : 'scalar';
    if (
      it !== undefined &&
      (it.shape.length > 1 ||
        cx.tuples.get(init!) === 1 ||
        !(isSubLane(it.lane, 'real') || it.lane === 'boolean'))
    )
      decline(
        e,
        'Reduce from a value that is not a real number, a Boolean, or a flat list or tuple of them'
      );
    const fits = (lane: Lane, l: Lane) =>
      lane === 'boolean' ? l === 'boolean' : isSubLane(l, lane);

    /** The loop over the accumulator of the lane `lane`; `fixed`: a list
     *  of the length `n` of `init`, carried alone. A step that does not
     *  keep the lane or the length throws `Mismatch`. */
    class Mismatch extends Error {
      constructor(
        readonly why: string,
        readonly lane?: Lane
      ) {
        super(why);
      }
    }
    const pass = (lane: Lane, fixed: number | undefined) => {
      const k = b.newValue(scalarType('integer'));
      const n =
        kind === 'list' && fixed === undefined
          ? b.newValue(scalarType('integer'))
          : undefined;
      const shape =
        kind === 'scalar' ? [] : fixed !== undefined ? [fixed] : [{ v: n! }];
      const acc = b.newValue({ lane, shape });
      if (tuple) cx.tuples.set(acc, 0);
      const params = n === undefined ? [acc] : [n, acc];
      const region = b.region([k, ...params], () => {
        const y = applied(names, [acc, s.at(k)], body, 0);
        const t = type(y);
        if (
          t.shape.length !== shape.length ||
          (cx.tuples.get(y) === 0) !== tuple
        )
          throw new Mismatch(
            `${e.operator} by a function whose value is not of the accumulator's kind`
          );
        if (!fits(lane, t.lane)) throw new Mismatch('a lane', t.lane);
        if (fixed !== undefined && t.shape[0] !== fixed)
          throw new Mismatch('a length');
        if (n === undefined) return [y];
        const m = t.shape[0];
        return [typeof m === 'number' ? b.constant(m, 'integer') : m.v, y];
      });
      return { region, params };
    };
    /** `pass`, on the real lane when an integer one gives reals. */
    const settle = (lane0: Lane, fixed: number | undefined) => {
      const before = b.effects;
      let lane = lane0;
      if (lane === 'integer') {
        try {
          pass(lane, fixed);
        } catch (m) {
          if (!(m instanceof Mismatch) || m.lane !== 'real') throw m;
          lane = 'real';
        } finally {
          b.effects = before;
        }
      }
      return { lane, ...pass(lane, fixed) };
    };
    const tryAll = (): ReturnType<typeof settle> & { fixed?: number } => {
      const n0 = it?.shape[0];
      const fixed = typeof n0 === 'number' && n0 > 0 ? n0 : undefined;
      const lanes: Lane[] =
        it !== undefined ? [it.lane] : ['integer', 'boolean'];
      // A fixed length first; a step that declines or changes it is
      // retried at a run-time length.
      const tries = lanes.flatMap((lane) =>
        (fixed !== undefined && !tuple ? [fixed, undefined] : [fixed]).map(
          (f) => [lane, f] as const
        )
      );
      let last: unknown;
      for (const [i, [lane, f]] of tries.entries()) {
        const before = b.effects;
        try {
          return { ...settle(lane, f), fixed: f };
        } catch (m) {
          b.effects = before;
          if (!(m instanceof Mismatch || m instanceof Decline)) throw m;
          last = m;
          if (i + 1 === tries.length) {
            if (m instanceof Decline && !empty) throw m;
            break;
          }
        }
      }
      const why = last instanceof Mismatch ? last.why : (last as Error).message;
      if (last instanceof Mismatch && last.why === 'a lane')
        decline(e, 'an accumulator that changes lane');
      if (last instanceof Mismatch && last.why === 'a length')
        decline(
          e,
          `${e.operator} by a function that changes the length of a tuple`
        );
      return decline(
        e,
        empty
          ? `${e.operator} from List(), whose element type the body does not fix: ${why}`
          : why
      );
    };
    const { lane, region, params, fixed } = tryAll();
    if (
      kind === 'list' &&
      fixed === undefined &&
      (!cx.runtimeLengths || cx.bigint)
    )
      decline(
        e,
        `${e.operator} of a list of a run-time length (JavaScript only)`
      );
    const keepTuple = (from: V, to: V): V => {
      if (cx.tuples.get(from) === 0) cx.tuples.set(to, 0);
      return to;
    };
    const last = cx.apply(e, 'Subtract', [s.length, integer(1)]);
    // The initial value: an empty list is a build of no element.
    const start = (): V[] => {
      if (init === undefined) {
        const k = b.newValue(scalarType('integer'));
        const zero = b.constant(lane === 'boolean' ? false : 0, lane);
        return [
          integer(0),
          cx.region('build', [integer(0)], [k], () => [zero], e)[0],
        ];
      }
      if (kind === 'scalar' || fixed !== undefined) return [init];
      const n = type(init).shape[0];
      return [typeof n === 'number' ? integer(n) : n.v, init];
    };
    const outs: V[] = [];
    for (const v of params)
      outs.push(
        keepTuple(
          v,
          b.newValue(mapLengths(type(v), (n) => outs[params.indexOf(n)] ?? n))
        )
      );
    b.emit({
      k: 'loop',
      outs,
      lo: integer(0),
      hi: last,
      init: start(),
      body: region,
    });
    if (b.effects > effects) decline(e, 'Reduce by a function with an effect');
    return outs[outs.length - 1];
  };

  /** `StartsWith`, `EndsWith` and `ContainsSequence` of two lists of real
   *  numbers: a test of each element of the needle against the element of
   *  the list at an offset (`same()`: equal, or both NaN), at the offset 0,
   *  `n - m`, or each offset from 0 to `n - m`. The interpreter compares
   *  exact values, so the operands are those of `search()`. */
  const sequence = (e: Fn): V => {
    const [l, p] = e.ops;
    const input = (name: string): boolean => {
      for (let i = cx.frames.length - 1; i >= 0; i--) {
        const binding = cx.frames[i].names.get(name);
        if (binding !== undefined) return binding.role === 'input';
      }
      return true;
    };
    const doubles = (x: Expression): boolean =>
      isSymbol(x)
        ? x.isConstant !== true && x.value === undefined && input(x.symbol)
        : isNumber(x)
          ? x.isExact !== true || x.type.matches('integer')
          : isFunction(x, 'List') && x.ops.every(doubles);
    const integers =
      l.type.matches('list<integer>') && p.type.matches('list<integer>');
    if (!integers && !(doubles(l) && doubles(p)))
      decline(
        e,
        `${e.operator} of a value that the interpreter may hold exactly`
      );
    const effects = b.effects;
    const [s, t] = [numbers(e, l), numbers(e, p)];
    if (b.effects > effects)
      decline(e, `${e.operator} of a list with an effect`);
    const [n, m] = [s.length, t.length];
    const and = rowOfHead(cx.rows, 'And')!;
    // Every element of the needle is the element of the list at `o` after
    // it.
    const at = (o: V): V =>
      accumulate(
        e,
        and,
        b.constant(true, 'boolean'),
        integer(0),
        int(e, 'Subtract', m, integer(1)),
        (j) => same(e, s.at(int(e, 'Add', o, j)), t.at(j))
      );
    const no = () => b.constant(false, 'boolean');
    if (e.operator === 'StartsWith')
      return when(e, 'LessEqual', m, n, () => at(integer(0)), no);
    if (e.operator === 'EndsWith')
      return when(e, 'LessEqual', m, n, () => at(int(e, 'Subtract', n, m)), no);
    const offsets = int(
      e,
      'Max',
      int(e, 'Add', int(e, 'Subtract', n, m), integer(1)),
      integer(0)
    );
    const kept = over(
      e,
      { length: offsets, at: (o) => o },
      '',
      (o) => at(o),
      true,
      e
    );
    return cx.apply(e, 'Less', [integer(0), listSource(kept).length]);
  };

  /** The list operators of CE-1531 (`README.md`, "Lists", the list
   *  operators): `undefined` for another head. */
  const more = (e: Fn): V | undefined => {
    const h = e.operator;
    const [zero, one] = [integer(0), integer(1)];
    if (!MORE.has(h)) return undefined;
    if (h === 'Identity') return cx.value(e.ops[0])!;
    // The interval mode reads a list through enclosures, which the
    // compilation of these operators does not hold (an equality test, a
    // count or an index computed from elements): they decline there.
    if (cx.interval && h !== 'ApplyWhole') decline(e, `${h} on interval-js`);
    if (h === 'Element') return search(e);
    if (h === 'StartsWith' || h === 'EndsWith' || h === 'ContainsSequence')
      return sequence(e);
    if (h === 'Linspace') {
      // `Linspace(b)` is `Linspace(1, b)`; the count is 50 by default.
      const real = (x: Expression) => {
        const v = cx.scalar(x);
        if (!isSubLane(type(v).lane, 'real'))
          decline(x, 'an operand of Linspace that is not a real number');
        return v;
      };
      const [a, z] =
        e.nops === 1 ? [one, real(e.ops[0])] : [real(e.ops[0]), real(e.ops[1])];
      let n = integer(50);
      if (e.nops === 3) {
        const c = real(e.ops[2]);
        const k = cx.constant(c);
        n =
          k !== undefined
            ? integer(Number.isFinite(k) ? Math.max(0, Math.floor(k)) : 50)
            : cx.apply(e, op('linspace.count'), [c]);
      }
      const d = int(e, 'Max', int(e, 'Subtract', n, one), one);
      return built(e, n, (k) => cx.apply(e, op('linspace'), [a, z, k, d]));
    }
    if (h === 'Tabulate') {
      // `Tabulate(f, n1, …, nd)`: the nested lists of `f(i1, …, id)` at
      // the indices from 1; a count below 1 is an empty list. A real count
      // is tested at run time (the interpreter's value is an error where it
      // is not an integer).
      if (e.nops < 2) decline(e, 'Tabulate with no count');
      const { names, body } = literalOf(e, e.ops[0], e.nops - 1);
      const lengths = e.ops
        .slice(1)
        .map((x) => int(e, 'Max', count(x, true), zero));
      const effects = b.effects;
      const nest = (j: number, at: V[]): V =>
        j === lengths.length
          ? applied(
              names,
              at.map((k) => int(e, 'Add', k, one)),
              body
            )
          : over(
              e,
              { length: lengths[j], at: (k) => k },
              '',
              (_x, k) => nest(j + 1, [...at, k]),
              false,
              e
            );
      const v = nest(0, []);
      if (b.effects > effects)
        decline(
          e,
          'Tabulate with an effect (the interpreter evaluates its elements lazily)'
        );
      return v;
    }
    if (h === 'ApplyWhole') {
      // The function applied to its arguments, each bound whole (no
      // element of a list is mapped over).
      const [g, ...args] = e.ops;
      if (isFunction(g, 'Function')) {
        const names = g.ops.slice(1).map((p) => (isSymbol(p) ? p.symbol : ''));
        if (names.length !== args.length || names.includes(''))
          decline(
            e,
            'ApplyWhole of a function literal that is not of one untyped parameter per argument'
          );
        const values = args.map((a) => cx.value(a)!);
        return applied(names, values, g.ops[0]);
      }
      if (
        isSymbol(g) &&
        userBinding({
          operator: g.symbol,
          operatorDefinition: g.operatorDefinition,
          valueDefinition: g.valueDefinition,
          engine: g.engine,
        } as never) === undefined &&
        isLibraryOperator(
          {
            operator: g.symbol,
            operatorDefinition: g.operatorDefinition,
            valueDefinition: g.valueDefinition,
            engine: g.engine,
          } as never,
          g.symbol
        )
      )
        return cx.value(g.engine.function(g.symbol, args))!;
      decline(
        e,
        'ApplyWhole of a value that is not a function literal or a library operator'
      );
    }
    if (h === 'Chunk' || (h === 'Partition' && e.nops === 2)) {
      const r = chunks(e)!;
      return typeof r === 'number' ? r : r.rows();
    }
    // The operators of a list.
    const effects = b.effects;
    const s =
      h === 'Append' ||
      h === 'DeleteAt' ||
      h === 'Insert' ||
      h === 'Slice' ||
      h === 'Partition' ||
      h === 'TakeWhile' ||
      h === 'DropWhile' ||
      h === 'FlatMap' ||
      h === 'Scan' ||
      h === 'CountIf' ||
      h === 'Find' ||
      h === 'IndexWhere' ||
      h === 'Position' ||
      h === 'RandomSample'
        ? source(e.ops[0])
        : undefined;
    if (s === undefined) return undefined;
    // The interpreter's list is lazy: it reads the elements it needs only.
    if (b.effects > effects) decline(e, `${h} of a list with an effect`);
    const n = s.length;
    const flat = () => {
      const x = elementOf(s);
      if (
        type(x).shape.length > 0 ||
        !(isSubLane(type(x).lane, 'real') || type(x).lane === 'boolean')
      )
        decline(e, `${h} of a list of other than numbers or booleans`);
      return x;
    };
    if (h === 'Append') {
      // Each operand after the list is one element: a list or a tuple
      // operand is an element of its own (a list of lists), which declines.
      if (e.nops < 2) decline(e, 'Append with no element');
      // A list of points and points of the same number of coordinates.
      const first = elementOf(s);
      if (cx.tuples.get(first) === 0) {
        const xs = e.ops.slice(1).map((x) => {
          const v = cx.value(x)!;
          if (
            cx.tuples.get(v) !== 0 ||
            type(v).shape.length !== 1 ||
            type(v).shape[0] !== type(first).shape[0] ||
            !isSubLane(type(v).lane, 'real')
          )
            decline(
              x,
              'an element of Append of a list of points that is not a point of real numbers of the same dimension'
            );
          return v;
        });
        return appended(e, s, xs);
      }
      const lane = type(flat()).lane;
      const xs = e.ops.slice(1).map((x) => {
        const v = cx.value(x)!;
        if (
          type(v).shape.length > 0 ||
          (type(v).lane === 'boolean') !== (lane === 'boolean') ||
          !(isSubLane(type(v).lane, 'real') || type(v).lane === 'boolean')
        )
          decline(
            x,
            'an element of Append that is not a number of a list of numbers or a boolean of a list of booleans'
          );
        return v;
      });
      return appended(e, s, xs);
    }
    if (h === 'DeleteAt') {
      flat();
      const j = position(e, n, e.ops[1]);
      return reindexed(e, s, int(e, 'Subtract', n, one), (k) =>
        when(
          e,
          'Less',
          k,
          j,
          () => k,
          () => int(e, 'Add', k, one)
        )
      );
    }
    if (h === 'Insert') {
      // The index is one of the `n + 1` positions of the new element.
      const lane = type(flat()).lane;
      const n1 = int(e, 'Add', n, one);
      const j = position(e, n1, e.ops[1]);
      const x = cx.scalar(e.ops[2]);
      if (
        (type(x).lane === 'boolean') !== (lane === 'boolean') ||
        !(isSubLane(type(x).lane, 'real') || type(x).lane === 'boolean')
      )
        decline(
          e.ops[2],
          'an element of Insert that is not a number of a list of numbers or a boolean of a list of booleans'
        );
      return built(e, n1, (k) =>
        when(
          e,
          'Less',
          k,
          j,
          () => s.at(k),
          () =>
            when(
              e,
              'Equal',
              k,
              j,
              () => x,
              () => s.at(int(e, 'Subtract', k, one))
            )
        )
      );
    }
    if (h === 'Slice') {
      // The interpreter's `computeSliceBounds()`: an index below 1 is
      // counted from the end, then at least 1; the end at most the length.
      const [a, z] = [rounded(e.ops[1]), rounded(e.ops[2])];
      const fromEnd = (x: V) =>
        when(
          e,
          'Less',
          x,
          one,
          () => int(e, 'Add', int(e, 'Add', n, one), x),
          () => x
        );
      const start = int(e, 'Max', fromEnd(a), one);
      const end = int(e, 'Min', int(e, 'Max', fromEnd(z), one), n);
      const length = int(
        e,
        'Max',
        int(e, 'Add', int(e, 'Subtract', end, start), one),
        zero
      );
      const first = int(e, 'Subtract', start, one);
      return reindexed(e, s, length, (k) => int(e, 'Add', first, k));
    }
    if (h === 'Partition') {
      // Sliding windows of `c` elements, `step` apart, complete only (the
      // forms of two operands are `chunks()`).
      const k = e.ops[1];
      if (!k.type.matches('number'))
        decline(e, 'Partition by a predicate with a step');
      const c = cx.constant(count(k));
      if (c === undefined)
        decline(e, 'Partition in windows of a size that is not a constant');
      // The interpreter leaves a count below 1 unevaluated.
      if (c < 1) decline(e, `${h} of a count below 1`);
      // A step known at run time can be below 1, where the interpreter
      // leaves the form unevaluated: it declines.
      const step = count(e.ops[2]);
      const t = cx.constant(step);
      if (t === undefined) decline(e, `${h} of a step that is not a constant`);
      if (t < 1) decline(e, `${h} of a step below 1`);
      const rows = int(
        e,
        'Max',
        int(
          e,
          'Add',
          cx.apply(e, 'Floor', [
            cx.apply(e, 'Divide', [int(e, 'Subtract', n, integer(c)), step]),
          ]),
          one
        ),
        zero
      );
      return windows(e, s, rows, c, step);
    }
    if (h === 'TakeWhile' || h === 'DropWhile') {
      // The first index where the predicate fails, or the length.
      const failed = where(e, s, e.ops[1], true);
      const stop = when(
        e,
        'Less',
        zero,
        listSource(failed).length,
        () => head(failed),
        () => n
      );
      return h === 'TakeWhile'
        ? reindexed(e, s, stop, (k) => k)
        : reindexed(e, s, int(e, 'Subtract', n, stop), (k) =>
            int(e, 'Add', stop, k)
          );
    }
    if (h === 'CountIf') return listSource(where(e, s, e.ops[1])).length;
    if (h === 'IndexWhere' || h === 'Find') {
      if (h === 'Find') {
        const x = elementOf(s);
        if (type(x).shape.length > 0 || !isSubLane(type(x).lane, 'real'))
          decline(e, 'Find in a list of other than real numbers');
      }
      const kept = where(e, s, e.ops[1]);
      return when(
        e,
        'Less',
        zero,
        listSource(kept).length,
        () =>
          h === 'Find' ? s.at(head(kept)) : int(e, 'Add', head(kept), one),
        () => (h === 'Find' ? b.constant(NaN, 'real') : zero)
      );
    }
    if (h === 'Position') {
      const kept = where(e, s, e.ops[1]);
      const ks = listSource(kept);
      return over(
        e,
        { length: ks.length, at: (k) => k },
        '',
        (_x, k) => int(e, 'Add', ks.at(k), one),
        false,
        e
      );
    }
    if (h === 'FlatMap') {
      // `f` of each element; a list value is spliced (one level), a scalar
      // kept: the build of the values, then the elements of the rows in
      // order. A row of a length known at run time declines (`over()`).
      const { names, body, site } = literalOf(e, e.ops[1], 1);
      const before = b.effects;
      const rows = over(e, s, names[0], body, false, site);
      if (b.effects > before)
        decline(
          e,
          'FlatMap with an effect (the interpreter evaluates its elements lazily)'
        );
      const t = type(rows);
      if (cx.tuples.has(rows))
        decline(e, 'FlatMap of a function whose value is a tuple');
      if (t.shape.length === 1) return rows;
      const m = t.shape[1];
      if (t.shape.length !== 2 || typeof m !== 'number')
        decline(
          e,
          'FlatMap of a function whose value is not a list of numbers'
        );
      const r = listSource(rows);
      const total = cx.constant(n);
      const length =
        total !== undefined
          ? integer(total * m)
          : cx.apply(e, 'Multiply', [n, integer(m)]);
      return built(e, length, (k) => {
        const i = cx.apply(e, 'Floor', [
          cx.apply(e, 'Divide', [k, integer(m)]),
        ]);
        const row = r.at(i);
        return listSource(row).at(cx.apply(e, 'Mod', [k, integer(m)]));
      });
    }
    if (h === 'Scan') {
      // The fold after each element, `f(acc, x)`; with no initial value
      // the first element is the first fold.
      const { names, body } = literalOf(e, e.ops[1], 2);
      flat();
      // The interpreter evaluates the initial value only when it reads an
      // element: an initial value with an effect declines, as a body.
      const before = b.effects;
      const init = e.nops === 3 ? cx.scalar(e.ops[2]) : undefined;
      const v = scanned(e, n, init ?? zero, (k, acc) => {
        const step = () => applied(names, [acc, s.at(k)], body);
        return init !== undefined
          ? step()
          : when(e, 'Equal', k, zero, () => s.at(k), step);
      });
      if (b.effects > before)
        decline(
          e,
          'Scan with an effect (the interpreter evaluates its elements lazily)'
        );
      return v;
    }
    if (h === 'RandomSample') {
      // The `k` elements at the indices drawn as the interpreter draws
      // them (`_SYS.randomSample`).
      flat();
      const k = cx.scalar(e.ops[1]);
      if (!isSubLane(type(k).lane, 'real'))
        decline(e.ops[1], 'a count that is not a real number');
      if (!cx.runtimeLengths || cx.interval)
        decline(e, 'RandomSample on a target with no draw of a list');
      const [c, ix] = cx.region('sample', [n, k], [], () => [], e);
      const at = listSource(ix);
      return reindexed(e, s, c, (j) => at.at(j));
    }
    return undefined;
  };

  /** The heads of a list that `lower.ts` hands over (`README.md`,
   *  "Lists", the list operators). */
  const collection = (e: Fn): V => {
    const h = e.operator;
    // The forms that compile (`Mean` takes any number of operands).
    const arity = ARITY[h] ?? [e.nops || 1];
    if (!arity.includes(e.nops))
      decline(e, `${h} of ${e.nops} operands is not supported by the compiler`);
    if (h === 'Dot') return dot(e);
    if (h === 'Norm') return norm(e);
    if (
      cx.interval &&
      [
        'Median',
        'Sort',
        'Ordering',
        'Unique',
        'Any',
        'All',
        'Contains',
        'IndexOf',
      ].includes(h)
    )
      decline(e, `${h} on interval-js`);
    if (h === 'Any' || h === 'All') return quantifier(e);
    if (h === 'Contains' || h === 'IndexOf') return search(e);
    if (h === 'Median') return cx.apply(e, op('median'), [reals(e)]);
    if (h === 'Sort' && e.nops === 2) return sortBy(e);
    // A list of strings (CE-1574), for `Sort` and `Unique`.
    const texts = (l: V) =>
      type(l).lane === 'string' && type(l).shape.length === 1;
    if (h === 'Sort') {
      const l = cx.value(e.ops[0])!;
      if (texts(l)) {
        // The elements in the order of `text.ordering`: of strings by
        // UTF-16 code units, of characters by code points (`textOrder()`).
        const order = textOrder([
          collectionElementType(e.ops[0].type.type) ?? 'any',
        ]);
        if (order === undefined)
          decline(e, 'Sort of a list of characters and strings');
        const at = cx.apply(
          e,
          op(order === 'points' ? 'text.ordering.cp' : 'text.ordering'),
          [l]
        );
        const s = listSource(l);
        return reindexed(e, s, s.length, (k) =>
          b.op('elem', [at, k], elementType(type(at)))
        );
      }
      const r = reals(e, l);
      const lane = type(r).lane === 'integer' ? 'sort.int' : 'sort';
      return cx.apply(e, op(lane), [r]);
    }
    if (h === 'Ordering') return cx.apply(e, op('ordering'), [reals(e)]);
    if (h === 'Unique') {
      // The elements that no earlier element equals (NaN equals NaN, as
      // the interpreter's; a string by its text, CE-1574), in order: a
      // filter whose test is a loop over the elements before.
      const l = cx.value(e.ops[0])!;
      const text = texts(l);
      const s = listSource(text ? l : reals(e, l));
      const or = rowOfHead(cx.rows, 'Or')!;
      const nan = op('isnan');
      return over(
        e,
        s,
        '',
        (x, k) => {
          const seen = accumulate(
            e,
            or,
            b.constant(false, 'boolean'),
            integer(0),
            cx.apply(e, 'Subtract', [k, integer(1)]),
            (j) => {
              const y = s.at(j);
              if (text) return cx.apply(e, 'Equal', [y, x]);
              return cx.apply(e, or, [
                cx.apply(e, 'Equal', [y, x]),
                cx.apply(e, 'And', [
                  cx.apply(e, nan, [y]),
                  cx.apply(e, nan, [x]),
                ]),
              ]);
            }
          );
          return cx.apply(e, 'Not', [seen]);
        },
        true,
        e
      );
    }
    if (h === 'Mean') {
      // The sum from 0, in order, over the count of the elements and of
      // the scalars: the interpreter's `mean()` (NaN of no element).
      const { sum, n } = meanParts(e);
      return cx.apply(e, 'Divide', [sum, n]);
    }
    if (VARIANCES.includes(h)) return variance(e);
    if (h === 'Count' && e.nops === 2)
      return listSource(build(e, e.ops[0], e.ops[1], true)).length;
    if (h === 'Take' && isIterate(e.ops[0])) return iterateTake(e);
    const other = more(e);
    if (other !== undefined) return other;
    const effects = b.effects;
    const s = source(e.ops[0], false, true);
    const n = s.length;
    if (h === 'Count' || h === 'IsEmpty')
      return h === 'Count' ? n : cx.apply(e, 'Equal', [n, integer(0)]);
    // The interpreter's list is lazy: it reads the elements kept only.
    if (b.effects > effects) decline(e, `${h} of a list with an effect`);
    const [zero, one] = [integer(0), integer(1)];
    if (h === 'Rest' || h === 'Most') {
      const length = int(e, 'Max', int(e, 'Subtract', n, one), zero);
      return reindexed(e, s, length, (k) =>
        h === 'Rest' ? int(e, 'Add', k, one) : k
      );
    }
    if (h === 'Reverse')
      return reindexed(e, s, n, (k) =>
        int(e, 'Subtract', int(e, 'Subtract', n, one), k)
      );
    if (h === 'Take' || h === 'Drop') {
      // `Take(L, m)` keeps the first `m` elements, the last `-m` for a
      // negative `m`; `Drop(L, m)` keeps the others; at most the length.
      const m = rounded(e.ops[1]);
      const c = cx.constant(m);
      const size =
        c === undefined ? cx.apply(e, 'Abs', [m]) : integer(Math.abs(c));
      const length =
        h === 'Take'
          ? int(e, 'Min', size, n)
          : int(e, 'Max', int(e, 'Subtract', n, size), zero);
      // The first element kept: past the others for a negative count of
      // `Take` and a nonnegative count of `Drop`.
      const tail = int(e, 'Subtract', n, length);
      const late = h === 'Take' ? 'Less' : 'GreaterEqual';
      const start =
        c === undefined
          ? cx.branch(
              e,
              cx.apply(e, late, [m, zero]),
              () => tail,
              () => zero,
              true
            )!
          : (h === 'Take' ? c < 0 : c >= 0)
            ? tail
            : zero;
      return reindexed(e, s, length, (k) => int(e, 'Add', start, k));
    }
    if (h === 'RotateLeft' || h === 'RotateRight') {
      // The element at `k` is the element at `k + m`, modulo the length
      // (`RotateLeft(L)` is `RotateLeft(L, 1)`; a negative `m` rotates the
      // other way). The count is reduced modulo the length first, as the
      // interpreter does, so `k + m` stays exact for a count near 2^53.
      const m = int(e, 'Mod', e.nops === 2 ? count(e.ops[1], true) : one, n);
      return reindexed(e, s, n, (k) =>
        int(e, 'Mod', int(e, h === 'RotateLeft' ? 'Add' : 'Subtract', k, m), n)
      );
    }
    decline(e, `the operator ${h} is not supported by the compiler`);
  };

  return {
    collection,
    reduceBy,
    source,
    chunks,
    listSource,
    built,
    reduce,
    reduction,
    build,
    mapLists,
    shortest,
    mask,
    over,
    comprehension,
    join,
    joinLists,
    isIterate,
    iterateTo,
  };
}
