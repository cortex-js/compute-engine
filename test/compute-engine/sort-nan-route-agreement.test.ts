/**
 * `Sort` and `Ordering` of a list that holds NaN put NaN LAST, on the
 * interpreter and on the compiled JavaScript route alike (user decision
 * 2026-09-24). This is the IEEE 754 total-order convention, which NumPy's
 * `sort` also follows: NaN is after every real number and after both
 * infinities, in an ascending sort, in a descending sort (a comparator) and in
 * a sort by a key (a NaN key). Two NaN keep their order in the input (the sort
 * is stable).
 *
 * Before, the interpreter left `Sort([3, NaN, 1])` unevaluated (it read the
 * NaN pair as unordered), while the compiled `Sort` used the comparator
 * `(a, b) => a - b` and answered `[3, NaN, 1]` (every pair with a NaN read as a
 * tie), and the compiled `Ordering` answered `[1, 2, 3]`.
 *
 * The compiled sort orders numbers only. An element type that admits a
 * boolean or a tuple does not compile (it fails closed), because the
 * interpreter leaves such a sort unevaluated.
 */

import type { Expression } from '../../src/compute-engine';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';

const ce = new ComputeEngine();
ce.declare('xs', 'list<number>');

// A small deterministic generator (mulberry32), so a failure is reproducible.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A list of 1 to 12 elements: small integers (with repeats), halves, the
 * two infinities, and NaN in random positions (at least one NaN). */
function randomList(next: () => number): number[] {
  const n = 1 + Math.floor(next() * 12);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = next();
    if (r < 0.3) out.push(NaN);
    else if (r < 0.35) out.push(Infinity);
    else if (r < 0.4) out.push(-Infinity);
    else if (r < 0.55) out.push(Math.floor(next() * 10) - 5 + 0.5);
    else out.push(Math.floor(next() * 10) - 5);
  }
  if (!out.some((x) => Number.isNaN(x)))
    out.splice(Math.floor(next() * (n + 1)), 0, NaN);
  return out;
}

const toMathJson = (x: number): any =>
  Number.isNaN(x)
    ? 'NaN'
    : x === Infinity
      ? 'PositiveInfinity'
      : x === -Infinity
        ? 'NegativeInfinity'
        : x;

function interpret(mathJson: any): number[] {
  const r = ce.box(mathJson).evaluate();
  expect(r.operator).toBe('List');
  return r.ops!.map((x: Expression) => (x.isNaN ? NaN : x.re));
}

function compiled(op: 'Sort' | 'Ordering', xs: number[]): number[] {
  const r = compile(ce.box([op, 'xs']), { fallback: false })!;
  expect(r.success).toBe(true);
  return r.run!({ xs }) as number[];
}

/** The rule, written independently of both routes: NaN last, stable. */
function reference(
  xs: number[],
  cmp: (a: number, b: number) => number
): number[] {
  const idx = xs.map((_, i) => i);
  idx.sort((i, j) => {
    const a = xs[i];
    const b = xs[j];
    if (Number.isNaN(a)) return Number.isNaN(b) ? 0 : 1;
    if (Number.isNaN(b)) return -1;
    return cmp(a, b);
  });
  return idx;
}

const ascending = (a: number, b: number) => (a < b ? -1 : a > b ? 1 : 0);
const descending = (a: number, b: number) => ascending(b, a);

const LISTS = (() => {
  const next = rng(20260924);
  return Array.from({ length: 30 }, () => randomList(next));
})();

describe('SORT AND ORDERING PUT NaN LAST ON EVERY ROUTE', () => {
  test('the examples of the decision', () => {
    expect(ce.box(['Sort', ['List', 3, 'NaN', 1]]).evaluate().toString()).toBe(
      '[1,3,NaN]'
    );
    // 1-based indices of 1, 3 and NaN.
    expect(
      ce.box(['Ordering', ['List', 3, 'NaN', 1]]).evaluate().toString()
    ).toBe('[3,1,2]');
    expect(compiled('Sort', [3, NaN, 1])).toEqual([1, 3, NaN]);
    expect(compiled('Ordering', [3, NaN, 1])).toEqual([3, 1, 2]);
  });

  test('NaN is after both infinities', () => {
    const xs = [NaN, Infinity, 2, -Infinity, NaN];
    expect(interpret(['Sort', ['List', ...xs.map(toMathJson)]])).toEqual([
      -Infinity,
      2,
      Infinity,
      NaN,
      NaN,
    ]);
    expect(compiled('Sort', xs)).toEqual([-Infinity, 2, Infinity, NaN, NaN]);
    // Two NaN keep their order in the input: index 1 before index 5.
    expect(
      interpret(['Ordering', ['List', ...xs.map(toMathJson)]])
    ).toEqual([4, 3, 2, 1, 5]);
    expect(compiled('Ordering', xs)).toEqual([4, 3, 2, 1, 5]);
  });

  test.each(LISTS.map((xs, i) => [i, xs]))(
    'ascending: list %i, the two routes agree',
    (_, xs) => {
      const list = ['List', ...xs.map(toMathJson)];
      const order = reference(xs, ascending);
      const sorted = order.map((i) => xs[i]);
      expect(interpret(['Sort', list])).toEqual(sorted);
      expect(compiled('Sort', xs)).toEqual(sorted);
      const ordering = order.map((i) => i + 1);
      expect(interpret(['Ordering', list])).toEqual(ordering);
      expect(compiled('Ordering', xs)).toEqual(ordering);
    }
  );

  // A descending sort and a sort by a key need a function operand, which the
  // compiled `Sort`/`Ordering` do not lower (they fail closed, and the
  // interpreter evaluates them). The interpreter is checked against the rule.
  test.each(LISTS.map((xs, i) => [i, xs]))(
    'descending (comparator b - a): list %i, NaN last',
    (_, xs) => {
      const list = ['List', ...xs.map(toMathJson)];
      const fn = ['Function', ['Subtract', 'b', 'a'], 'a', 'b'];
      const order = reference(xs, descending);
      expect(interpret(['Sort', list, fn])).toEqual(order.map((i) => xs[i]));
      expect(interpret(['Ordering', list, fn])).toEqual(
        order.map((i) => i + 1)
      );
    }
  );

  test.each(LISTS.map((xs, i) => [i, xs]))(
    'key x -> -x: list %i, NaN keys last',
    (_, xs) => {
      const list = ['List', ...xs.map(toMathJson)];
      const fn = ['Function', ['Negate', 'x'], 'x'];
      // The key of NaN is NaN, and `-x` reverses the order of the others.
      const order = reference(xs, descending);
      expect(interpret(['Sort', list, fn])).toEqual(order.map((i) => xs[i]));
      expect(interpret(['Ordering', list, fn])).toEqual(
        order.map((i) => i + 1)
      );
    }
  );

  test('a key that is NaN for a non-NaN element puts that element last', () => {
    // The key is NaN at x = 0 and 0 elsewhere.
    const fn = ['Function', ['If', ['Equal', 'x', 0], 'NaN', 0], 'x'];
    const r = ce.box(['Sort', ['List', 0, 2, 1, 0], fn]).evaluate();
    // The other keys tie, so 2 and 1 keep their order.
    expect(r.toString()).toBe('[2,1,0,0]');
  });

  test('a function operand still fails closed on the JavaScript route', () => {
    const js = new JavaScriptTarget();
    for (const op of ['Sort', 'Ordering'])
      expect(() =>
        js.compile(
          ce.box([op, 'xs', ['Function', ['Negate', 'x'], 'x']]),
          { constantFold: false }
        )
      ).toThrow(/Fail closed/);
  });
});

describe('SORT OF BOOLEANS, TUPLES OR SYMBOLS: INTERPRETER UNEVALUATED, JAVASCRIPT DECLINES', () => {
  const eng = new ComputeEngine();
  eng.declare('bs', 'list<boolean>');
  eng.declare('ts', 'list<tuple<real, real>>');
  eng.declare('ms', 'list<real | boolean>');

  const CASES: Array<[string, any]> = [
    ['boolean literals', ['List', 'True', 'False']],
    ['tuple literals', ['List', ['Tuple', 2, 1], ['Tuple', 1, 2]]],
    ['a boolean beside NaN', ['List', 'True', 'NaN']],
    ['a symbol beside NaN', ['List', 'x', 'NaN']],
  ];
  for (const [label, list] of CASES)
    for (const op of ['Sort', 'Ordering'])
      test(`${op}: ${label} stays unevaluated`, () => {
        const r = eng.box([op, list]).evaluate();
        expect(r.operator).toBe(op);
      });

  const DECLARED: Array<[string, any]> = [
    ['list<boolean>', 'bs'],
    ['list<tuple<real, real>>', 'ts'],
    ['list<real | boolean>', 'ms'],
    ['a literal list of booleans', ['List', 'True', 'False']],
    ['a literal list of tuples', ['List', ['Tuple', 2, 1], ['Tuple', 1, 2]]],
  ];
  for (const [label, operand] of DECLARED)
    for (const op of ['Sort', 'Ordering'])
      test(`${op} of ${label} fails closed on JavaScript`, () => {
        const js = new JavaScriptTarget();
        expect(() =>
          js.compile(eng.box([op, operand]), { constantFold: false })
        ).toThrow(/not provably numbers.*Fail closed/);
      });
});
