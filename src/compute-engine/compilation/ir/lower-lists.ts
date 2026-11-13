/**
 * The lowering of collections: a list operand as a source (its length and
 * the element at an index from 0), a `Range` read through its count and
 * the arithmetic of its elements (no list is made unless its value is
 * read), the reductions (`Sum`, `Product`, `Max`, `Min`, `Reduce`) as
 * counted loops, and `Map` and `Filter` as builds.
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
  type Fn,
  type Lowering,
  type Source,
} from './lower-context.js';

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

  const listSource = (l: V): Source => {
    const n = type(l).shape[0];
    return {
      length: typeof n === 'number' ? integer(n) : n.v,
      at: (k) => b.op('elem', [l, k], elementType(type(l))),
      value: () => l,
    };
  };

  /** The list `e` as a source; with `scalars`, a scalar is its value. */
  function source(e: Expression): Source;
  function source(e: Expression, scalars: true): Source | V;
  function source(e: Expression, scalars = false): Source | V {
    if (!isFunction(e, 'Range') || !cx.isLibrary(e)) {
      const l = cx.value(e)!;
      if (type(l).shape.length > 0) return listSource(l);
      if (scalars) return l;
      decline(e, 'a scalar where a list is required');
    }
    if (e.nops < 2 || e.nops > 3) decline(e, `a Range of ${e.nops} operands`);
    const [lo, hi, given] = e.ops.map((x) => {
      const v = cx.scalar(x);
      if (type(v).lane !== 'integer')
        decline(
          x,
          'a Range of reals (a bound or a step that is not an integer)'
        );
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
    const [lo, hi] = [limits.ops[1], limits.ops[2]].map((x) => {
      const v = cx.scalar(x);
      if (type(v).lane !== 'integer')
        decline(x, 'a bound that is not an integer');
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
    const items = e.ops.map((x) => source(x, true));
    if (!red.indexed && items.every((x) => typeof x === 'number'))
      return cx.apply(e, r, items as V[]);
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
    const s = source(l);
    const k = b.newValue(scalarType('integer'));
    const outs = cx.region(
      filter ? 'filter' : 'build',
      [s.length],
      [k],
      () =>
        cx.withFrame(true, (frame) => {
          const x = s.at(k);
          frame.names.set(param, { v: x, role: 'index' });
          const v = cx.value(f.ops[0])!;
          if (lengthValues(type(v)).length > 0)
            decline(e, 'a list of lists of run-time length');
          if (!filter) return [v];
          if (type(v).lane !== 'boolean' || type(v).shape.length > 0)
            decline(f, 'a predicate that is not a boolean');
          return [v, x];
        }),
      e
    );
    return outs[outs.length - 1];
  };

  return { source, reduce, reduction, build };
}
