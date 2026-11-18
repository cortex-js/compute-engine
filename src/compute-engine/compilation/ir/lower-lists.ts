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
  elementType,
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
} from './lower-context.js';
import { SCALARIZE_LIMIT } from './passes.js';

/** The name of a parameter of a function literal: a symbol, or a symbol
 *  with a type (`Typed(z, "real")`). */
export function parameterName(p: Expression): string | undefined {
  if (isFunction(p, 'Typed')) p = p.ops[0];
  return isSymbol(p) ? p.symbol : undefined;
}

/** The function literal `(p1, …, pn) ↦ Op(p1, …, pn)` of a symbol `f` that
 *  names the library operator `Op` of a row, which the interpreter applies
 *  as the call `Op(a1, …, an)`; `f` itself otherwise (a user function, a
 *  shadowed name, a parameter, a name of `vars`). A row of a fixed arity
 *  takes `n` of that arity, a variadic row any `n` (2 when `n` is not
 *  given: the combiner of a `Reduce`); a `chain` row, none. */
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

  return {
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
  };
}
