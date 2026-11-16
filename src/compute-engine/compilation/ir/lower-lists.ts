/**
 * The lowering of collections: a list operand as a source (its length and
 * the element at an index from 0), a `Range` read through its count and
 * the arithmetic of its elements (no list is made unless its value is
 * read), the reductions (`Sum`, `Product`, `Max`, `Min`, `Reduce`) as
 * counted loops, and `Map`, `Filter` and `Comprehension` as builds.
 */

import { isFunction, isSymbol } from '../../boxed-expression/type-guards.js';
import type { Expression } from '../../global-types.js';
import {
  elementType,
  lengthValues,
  scalarType,
  type Lane,
  type V,
} from './ir.js';
import {
  REDUCTIONS,
  rowOfOp,
  signatureOf,
  type OperatorRow,
} from './operators.js';
import {
  decline,
  hasOwnLowering,
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

export function listLowering(cx: Lowering) {
  const { b, type } = cx;
  const op = (name: string) => rowOfOp(cx.rows, name)!.row;
  const integer = (n: number) => b.constant(n, 'integer');
  // The elements of the builds written out on GLSL (`over()`).
  let unrolled = 0;

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
      value: () => l,
    };
  };

  /** The list `e` as a source; with `scalars`, a scalar is its value. A
   *  tuple is a source only with `tuple` (`Length`, `Sum`, `Max`: the
   *  value on a tuple is the value on the list of its elements). */
  function source(e: Expression, scalars?: false, tuple?: boolean): Source;
  function source(e: Expression, scalars: true, tuple?: boolean): Source | V;
  function source(e: Expression, scalars = false, tuple = false): Source | V {
    // A host's `Range` (`hasOwnLowering()`) declines in `cx.value()`.
    if (
      !isFunction(e, 'Range') ||
      !cx.isLibrary(e) ||
      hasOwnLowering('Range', e.operatorDefinition)
    ) {
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
      cx.apply(e, cx.row('Add'), [
        lo,
        cx.apply(e, cx.row('Multiply'), [k, step]),
      ]);
    return {
      length,
      at,
      value: () => {
        const k = b.newValue(scalarType('integer'));
        return cx.region('build', [length], [k], () => [at(k)], e)[0];
      },
    };
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
      // The interpreter sums a window of an infinite range; NaN is 1.
      const c = cx.constant(v);
      if (c !== undefined && !Number.isFinite(c))
        decline(x, 'a bound that is a constant infinity or NaN');
      // The interpreter gives `out-of-range` where the range is not empty.
      if (c !== undefined && Math.abs(c) > Number.MAX_SAFE_INTEGER)
        decline(x, 'a bound that is a constant beyond 2^53 - 1');
      if (type(v).lane === 'real') return cx.apply(x, cx.row('Floor'), [v]);
      if (type(v).lane !== 'integer')
        decline(x, 'a bound that is not a real number');
      return v;
    });
    const init = integer(REDUCTIONS.get(e.operator)!.identity);
    const run = () =>
      accumulate(e, r, init, lo, hi, (k) =>
        cx.withFrame(true, (frame) => {
          frame.names.set(index.symbol, { v: k, role: 'index' });
          return cx.scalar(e.ops[0]);
        })
      );
    if (cx.budget === undefined || !Number.isFinite(cx.budget)) return run();
    // `iterationBudget`: a loop of more passes than the budget is NaN
    // (`CompilationOptions.iterationBudget`), `hi - lo < budget` otherwise.
    const span = cx.apply(e, cx.row('Subtract'), [hi, lo]);
    const budget = integer(Math.floor(cx.budget));
    const within = cx.apply(e, cx.row('Less'), [span, budget]);
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
    empty?: number
  ): V => {
    let acc = init;
    for (const x of items)
      if (typeof x === 'number') acc = cx.apply(e, r, [acc, x]);
    const lists = items.filter((x): x is Source => typeof x !== 'number');
    for (const s of lists) {
      const last = cx.apply(e, cx.row('Subtract'), [s.length, integer(1)]);
      acc = accumulate(e, r, acc, integer(0), last, s.at);
    }
    if (empty === undefined || lists.length < items.length) return acc;
    const total = lists
      .map((s) => s.length)
      .reduce((n, m) => cx.apply(e, cx.row('Add'), [n, m]));
    const none = cx.apply(e, cx.row('Equal'), [total, integer(0)]);
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
    // whose fold from the identity is the loop's. Only the library's `List`
    // (a user definition or a lowering of its own declines in `cx.value()`).
    const [l] = e.ops;
    const literal =
      e.nops === 1 &&
      isFunction(l, 'List') &&
      cx.isLibrary(l) &&
      !hasOwnLowering('List', l.operatorDefinition) &&
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
    return reduce(e, r, items, b.constant(red.identity, lane), red.empty);
  };

  /** A `Map` (or, with `filter`, a `Filter`) of the function literal `f`
   *  over the list `l`: a build whose body reads the element `k`. */
  const build = (e: Fn, l: Expression, f: Expression, filter: boolean): V => {
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

  /** A build (with `filter`, a filter) over `s` of `body`, which reads the
   *  element as `name`. */
  const over = (
    e: Fn,
    s: Source,
    name: string,
    body: Expression,
    filter: boolean,
    site: Expression
  ): V => {
    // A target with no list of a run-time length has no build (GLSL): a
    // build of a constant length of at most `SCALARIZE_LIMIT` is the list
    // of its elements, the body lowered once per element, in order.
    const n = cx.runtimeLengths ? undefined : cx.constant(s.length);
    if (!filter && n !== undefined && n >= 1 && n <= SCALARIZE_LIMIT) {
      unrolled += n;
      if (unrolled > SCALARIZE_LIMIT ** 2)
        decline(e, `builds of more than ${SCALARIZE_LIMIT ** 2} elements`);
      const elements = Array.from({ length: n }, (_, j) =>
        cx.withFrame(true, (frame) => {
          frame.names.set(name, { v: s.at(integer(j)), role: 'index' });
          return cx.value(body)!;
        })
      );
      return cx.list(e, elements);
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
          const v = cx.value(body)!;
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
   *  `body` over the elements kept. The interpreter's list is lazy: it
   *  evaluates the condition and the body of an element only when the
   *  element is read (`Length` reads none), so a condition or a body with
   *  an effect declines. */
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
   *  lists reads an index: the flat list over the Cartesian product of the
   *  lists, the last index the fastest, as in the interpreter. One build
   *  over the product of the lengths, whose index `k` gives the index of
   *  the clause `j` as `Floor(k / s_j) mod n_j`, `s_j` the product of the
   *  lengths after it (exact for a total below 2^53). */
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
    const mul = (x: V, y: V) => cx.apply(e, cx.row('Multiply'), [x, y]);
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
            const q = cx.apply(e, cx.row('Floor'), [
              cx.apply(e, cx.row('Divide'), [k, strides[j]]),
            ]);
            const i = j === 0 ? q : cx.apply(e, cx.row('Mod'), [q, s.length]);
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
          : cx.apply(e, cx.row('Add'), [ends[ends.length - 1], length(x)])
      );
    const k = b.newValue(scalarType('integer'));
    const at = (j: number): V => {
      const x = parts[j];
      const read = () =>
        typeof x === 'number'
          ? x
          : x.at(
              j === 0 ? k : cx.apply(e, cx.row('Subtract'), [k, ends[j - 1]])
            );
      if (j === parts.length - 1) return read();
      const inside = cx.apply(e, cx.row('Less'), [k, ends[j]]);
      return cx.branch(e, inside, read, () => at(j + 1), true)!;
    };
    return cx.region(
      'build',
      [ends[ends.length - 1]],
      [k],
      () => [at(0)],
      e
    )[0];
  };

  return {
    source,
    listSource,
    reduce,
    reduction,
    build,
    over,
    comprehension,
    join,
  };
}
