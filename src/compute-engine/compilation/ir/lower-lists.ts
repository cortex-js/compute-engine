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
import { requiredArity } from '../../../common/type/utils.js';
import {
  elementType,
  isSubLane,
  lengthValues,
  outsOf,
  recursiveFunctions,
  regionsOf,
  scalarType,
  type Instr,
  type Lane,
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
import {
  decline,
  type Fn,
  type Lowering,
  type Source,
  userBinding,
} from './lower-context.js';
import { SCALARIZE_LIMIT } from './passes.js';

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
});

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

  const listSource = (l: V): Source => {
    const n = type(l).shape[0];
    // An element of a list of tuples is a tuple.
    const axis = cx.tuples.get(l);
    return {
      length: typeof n === 'number' ? integer(n) : n.v,
      at: (k) => {
        const x = b.op('elem', [l, k], elementType(type(l)));
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

  /** A counted loop from `lo` to `hi` that carries the accumulator of
   *  `r`, from `init`, over the value of `term` at each index. */
  const accumulate = (
    e: Expression,
    r: OperatorRow,
    init: V,
    lo: V,
    hi: V,
    term: (k: V) => V
  ): V => {
    const k = b.newValue(scalarType('integer'));
    const params = [k];
    let lane: Lane | undefined;
    const body = b.region(params, () => {
      const t = term(k);
      lane = signatureOf(r, [type(init), type(t)])?.[1] as Lane | undefined;
      if (lane === undefined || type(t).shape.length > 0)
        decline(e, 'a term that is not a number');
      const acc = b.newValue(scalarType(lane));
      params.push(acc);
      const next = cx.apply(e, r, [acc, t]);
      if (type(next).lane !== lane)
        decline(e, 'an accumulator that changes lane');
      return [next];
    });
    const out = b.newValue(scalarType(lane!));
    const start = cx.widen(init, lane!);
    b.emit({ k: 'loop', outs: [out], lo, hi, init: [start], body });
    return out;
  };

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
   *  first term when the loop's accumulator has its lane. */
  const writtenOut = (
    e: Fn,
    r: OperatorRow,
    init: V,
    lo: V,
    hi: V,
    term: (k: V) => V,
    identity = false
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
          if (type(t).shape.length > 0 || !s) return undefined;
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
    const term = (k: V) => indexed(index.symbol, k, () => cx.scalar(e.ops[0]));
    const written = writtenOut(e, r, init, lo, hi, term);
    if (written !== undefined) return written;
    const run = () => accumulate(e, r, init, lo, hi, term);
    if (cx.budget === undefined || !Number.isFinite(cx.budget)) return run();
    // `iterationBudget`: a loop of more passes than the budget is NaN
    // (`CompilationOptions.iterationBudget`), `hi - lo < budget` otherwise.
    const span = cx.apply(e, 'Subtract', [hi, lo]);
    const budget = integer(Math.floor(cx.budget));
    const within = cx.apply(e, 'Less', [span, budget]);
    let lane: Lane = 'real';
    return cx.branch(
      e,
      within,
      () => {
        const v = run();
        lane = type(v).lane;
        return v;
      },
      () =>
        lane === 'complex'
          ? b.constant({ re: NaN, im: NaN }, 'complex')
          : b.constant(NaN, 'real'),
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

  /** `ListJoin(L1, …, Ln)` of lists and scalars (a scalar is a list of one
   *  element): a build over the sum of the lengths, whose element at `k` is
   *  the element of the first list whose end is after `k`. */
  const join = (e: Fn): V => {
    if (e.nops === 0) decline(e, 'ListJoin with no operand');
    const parts = e.ops.map((x) => source(x, true));
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
    if (e.nops === 0 || !e.ops.every((x) => x.type.matches('list')))
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
  const reals = (e: Fn): V => {
    const l = cx.value(e.ops[0])!;
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
      e.ops[0].type.matches('list<integer>') &&
      e.ops[1].type.matches('integer');
    if (!integers && !(doubles(e.ops[0]) && doubles(e.ops[1])))
      decline(
        e,
        `${e.operator} of a value that the interpreter may hold exactly`
      );
    const effects = b.effects;
    const s = source(e.ops[0]);
    const v = cx.scalar(e.ops[1]);
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
    if (e.operator === 'Contains') return found;
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
    if (h === 'Sort') {
      const l = reals(e);
      const lane = type(l).lane === 'integer' ? 'sort.int' : 'sort';
      return cx.apply(e, op(lane), [l]);
    }
    if (h === 'Ordering') return cx.apply(e, op('ordering'), [reals(e)]);
    if (h === 'Unique') {
      // The elements that no earlier element equals (NaN equals NaN, as
      // the interpreter's), in order: a filter whose test is a loop over
      // the elements before.
      const s = listSource(reals(e));
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
      const items = e.ops.map((x) => source(x, true, true));
      const sum = reduce(e, rowOfHead(cx.rows, 'Add')!, items, integer(0));
      if (type(sum).lane === 'complex') decline(e, 'Mean of complex numbers');
      const n = items
        .map((x) => (typeof x === 'number' ? integer(1) : x.length))
        .reduce((a, c) => int(e, 'Add', a, c));
      return cx.apply(e, 'Divide', [sum, n]);
    }
    if (h === 'Count' && e.nops === 2)
      return listSource(build(e, e.ops[0], e.ops[1], true)).length;
    if (h === 'Take' && isIterate(e.ops[0])) return iterateTake(e);
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
      const m = count(e.ops[1]);
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
    source,
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
