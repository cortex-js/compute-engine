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
    expect(
      ce
        .box(['Sort', ['List', 3, 'NaN', 1]])
        .evaluate()
        .toString()
    ).toBe('[1,3,NaN]');
    // 1-based indices of 1, 3 and NaN.
    expect(
      ce
        .box(['Ordering', ['List', 3, 'NaN', 1]])
        .evaluate()
        .toString()
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
    expect(interpret(['Ordering', ['List', ...xs.map(toMathJson)]])).toEqual([
      4, 3, 2, 1, 5,
    ]);
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
        js.compile(ce.box([op, 'xs', ['Function', ['Negate', 'x'], 'x']]), {
          constantFold: false,
        })
      ).toThrow(/Could not compile/);
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
        ).toThrow(/not provably numbers/);
      });
});

describe('SORT AND ORDERING PUT AN ABSENT CELL LAST', () => {
  // User decision of 2026-09-25. `Sort([1, Missing])` stayed unevaluated,
  // because `Missing` compares neither equal to nor less than a number. An
  // absent cell (`Missing` or `Undefined`) now sorts after every other
  // element, `NaN` included, in an ascending sort, a descending comparator and
  // a sort by key. Two absent cells keep their order in the input.
  const eng = new ComputeEngine();
  const value = (json: any) => eng.box(json).evaluate().toString();
  const DESC = ['Function', ['Subtract', 'b', 'a'], 'a', 'b'];
  const DESC_BOOL = ['Function', ['Greater', 'a', 'b'], 'a', 'b'];
  const NEG_KEY = ['Function', ['Negate', 'x'], 'x'];

  test.each(['Missing', 'Undefined'])('%s', (absent) => {
    const xs = ['List', 3, absent, 1];
    expect(value(['Sort', xs])).toBe(`[1,3,"${absent}"]`);
    expect(value(['Ordering', xs])).toBe('[3,1,2]');
    expect(value(['Sort', xs, DESC])).toBe(`[3,1,"${absent}"]`);
    expect(value(['Sort', xs, DESC_BOOL])).toBe(`[3,1,"${absent}"]`);
    expect(value(['Sort', xs, NEG_KEY])).toBe(`[3,1,"${absent}"]`);
    expect(value(['Ordering', xs, DESC])).toBe('[1,3,2]');
  });

  test('after NaN, and two absent cells keep their order', () => {
    expect(value(['Sort', ['List', 'Undefined', 3, 'NaN', 'Missing', 1]])).toBe(
      '[1,3,NaN,"Undefined","Missing"]'
    );
  });

  test('a list of strings', () => {
    expect(value(['Sort', ['List', "'b'", 'Missing', "'a'"]])).toBe(
      '["a","b","Missing"]'
    );
  });

  test('the parse route', () => {
    expect(
      eng
        .parse('\\operatorname{Sort}([3, \\operatorname{Missing}, 1])')
        .evaluate()
        .toString()
    ).toBe('[1,3,"Missing"]');
  });

  // The absent cell is kept in the type too. Before, the `missing` arm of
  // the elements stopped the element type from binding, and the numeric
  // absorption of an absent operand applied: `Sort` was typed
  // `list<unknown>`, `Reverse` `list` and `Ordering` `list<number>`.
  test.each([
    ['Sort', 'list<integer | missing>'],
    ['Ordering', 'list<integer>'],
    ['Reverse', 'list<integer | missing>'],
    ['Rest', 'list<integer | missing>'],
    ['Unique', 'list<integer | missing>'],
  ])('%s of a list with an absent cell is typed %s', (op, type) => {
    for (const absent of ['Missing', 'Undefined']) {
      const e = eng.box([op, ['List', 3, absent, 1]]);
      expect(e.type.toString()).toBe(type);
      expect(e.evaluate().type.matches(e.type)).toBe(true);
    }
    const parsed = eng.parse(
      `\\operatorname{${op}}([3, \\operatorname{Missing}, 1])`
    );
    expect(parsed.type.toString()).toBe(type);
  });

  test('a declared list with absent cells keeps its element type', () => {
    const e2 = new ComputeEngine();
    e2.declare('ms', 'list<real | missing>');
    expect(e2.box(['Sort', 'ms']).type.toString()).toBe('list<missing | real>');
    expect(e2.box(['Take', 'ms', 2]).type.toString()).toBe(
      'list<missing | real>'
    );
  });

  test('a list absent as a whole is still Missing', () => {
    expect(value(['Sort', 'Missing'])).toBe('"Missing"');
  });

  // The compiled sort orders a list with an absent cell as the interpreter
  // does. The run-time spelling of an absent cell is `undefined` (a written
  // `Missing` lowers to the object null of the target, `docs/ERROR-MODEL.md`
  // §3), and `Array.prototype.sort` puts every `undefined` element last.
  // Before, the element type `integer | missing` was not provably numeric,
  // so the sort did not compile, and the interpreter fallback answered
  // `[1, 3, NaN]`.
  test('compiled to JavaScript', () => {
    const runOf = (json: any, vars: object = {}): unknown => {
      const r = compile(eng.box(json), { fallback: false })!;
      expect(r.success).toBe(true);
      return (r.run as (v: object) => unknown)(vars);
    };
    expect(runOf(['Sort', ['List', 3, 'Missing', 1]])).toEqual([
      1,
      3,
      undefined,
    ]);
    expect(runOf(['Sort', ['List', 3, 'Missing', 'x']], { x: 1 })).toEqual([
      1,
      3,
      undefined,
    ]);
    expect(
      runOf(['Sort', ['List', 'x', 'Undefined', 3, 'NaN', 'Missing', 1]], {
        x: 2,
      })
    ).toEqual([1, 2, 3, NaN, undefined, undefined]);
    expect(runOf(['Ordering', ['List', 3, 'Missing', 'x']], { x: 1 })).toEqual([
      3, 1, 2,
    ]);
    expect(
      runOf(['Ordering', ['List', 'Missing', 'x', 'NaN', 'Undefined', 1]], {
        x: 2,
      })
    ).toEqual([5, 2, 3, 1, 4]);
    expect(
      value(['Ordering', ['List', 'Missing', 2, 'NaN', 'Undefined', 1]])
    ).toBe('[5,2,3,1,4]');
  });

  test('compiled from the parse route', () => {
    const r = compile(
      eng.parse('\\operatorname{Sort}([3, \\operatorname{Missing}, x])'),
      { fallback: false }
    )!;
    expect(r.success).toBe(true);
    expect((r.run as (v: object) => unknown)({ x: 1 })).toEqual([
      1,
      3,
      undefined,
    ]);
  });
});
