/**
 * Two follow-ups to Tycho ledger row 424, decided by the user on 2026-10-22.
 *
 * Decision 1 (option A): the element selectors are linear accessors in the
 * derivative, as `PointX`, `PointY`, `PointZ` and `At` are since the row 424
 * fix.
 *
 * - The cause: `First`, `Second`, `Third`, `Last`, `Rest`, `Most`, `Reverse`,
 *   `Take`, `Drop`, `DeleteAt`, `RotateLeft`, `RotateRight`, `Slice` (and
 *   `At` with more than one index) went through the generic chain rule. That
 *   rule reads the selector as an unknown scalar function of the container,
 *   and multiplies its unknown partial derivative by the derivative of the
 *   container: `D(Last(L(u)), u)` with `L(t) = [t, t², t³]` was
 *   `[Last′(L(u)), 2u·Last′(L(u)), 3u²·Last′(L(u))]`, and for the 29-piece
 *   path of the row (a list of 29 points) it declined after about 1.1 s.
 *   With a container that does not depend on the variable, the result was a
 *   list as long as the container: `D(First([1, 2]), u)` was `[0, 0]`.
 * - The fix: when the count, the index or the span does not depend on the
 *   variable (or is constant between its jumps, as `⌈u⌉` is), the
 *   derivative of the selection is the same selection of the derivative of
 *   the container: `D(Last(L(u)), u)` is `Last(L′(u))`, which is `3u²`. A
 *   selection out of range is out of range in the derivative too, since the
 *   derivative has the length of the container. A count, index or span that
 *   changes with the variable (`Take(L(u), u)`) declines. A selection of a
 *   constant container is `0`. Selectors that read the VALUES of the
 *   elements (`Sort`, `Filter`, `Unique`, `MaxBy`, …) are not linear and
 *   are not included (`ELEMENT_SELECTOR_ARITY`, `selectorKind()`,
 *   `symbolic/derivative.ts`).
 *
 * Decision 2 (option A): a constant point element has the zero point as its
 * derivative.
 *
 * - The cause: the elementwise derivative of a written-out list (and of the
 *   value arms of `If` and `Which`) gave the scalar `0` for every element
 *   that does not depend on the variable. With `Q := (1, 2)`,
 *   `D([(t, t²), Q], t)` was `[(1, 2t), 0]`, a list that mixes a point and a
 *   number, and the derivative of a piecewise point `If(0 < t, (t, 1), Q)`
 *   was `If(0 < t, (1, 0), 0)`.
 * - The fix: a constant element or arm whose type is a point, or a list of
 *   known lengths, has the zero of its shape as its derivative:
 *   `[(1, 2t), (0, 0)]` and `If(0 < t, (1, 0), (0, 0))`. A numeric element
 *   keeps the scalar `0` (`withZeroOfShape()`, `symbolic/derivative.ts`).
 *
 * Each closed form is checked against a central difference quotient of the
 * interpreter.
 */

import { ComputeEngine } from '../../src/compute-engine';

type Engine = ComputeEngine;

/** The value of an expression of `u` at `u = a`: its numbers, as a flat
 * list, and its shape, a string where `n` is a number, `(…)` a tuple and
 * `[…]` a list (`[(n,n),(n,n)]` for a list of two points). A selection such
 * as `Rest(xs)` evaluates to a lazy view of `xs`, which is read element by
 * element as a list. */
function valuesAt(
  ce: Engine,
  expr: unknown,
  a: number
): { values: number[]; shape: string } {
  const v = ce
    .box(expr as never)
    .subs({ u: a })
    .N();
  const values: number[] = [];
  const walk = (e: typeof v): string => {
    if (e.operator === 'Tuple') return `(${e.ops!.map(walk).join(',')})`;
    if (e.operator === 'List') return `[${e.ops!.map(walk).join(',')}]`;
    if (e.isCollection) return `[${[...e.each()].map(walk).join(',')}]`;
    values.push(e.re);
    return 'n';
  };
  const shape = walk(v);
  return { values, shape };
}

/** The derivative of `expr` at `a`, from the closed form, checked against a
 * central difference quotient of the interpreter: the same shape, and the
 * same numbers. Returns the numbers of the closed form. */
function check(ce: Engine, expr: unknown, a: number): number[] {
  const d = ce.box(['D', expr, 'u'] as never).evaluate();
  expect(d.operator).not.toBe('D');
  const exact = valuesAt(ce, d.json, a);
  const h = 1e-6;
  const plus = valuesAt(ce, expr, a + h);
  const minus = valuesAt(ce, expr, a - h);
  expect(exact.shape).toBe(plus.shape);
  expect(exact.values).toEqual(
    plus.values.map((p, i) =>
      expect.closeTo((p - minus.values[i]) / (2 * h), 5)
    )
  );
  return exact.values;
}

function engine(): Engine {
  const ce = new ComputeEngine();
  ce.declare('Q', 'tuple<integer, integer>');
  ce.assign('Q', ce.parse('(1,2)'));
  ce.declare('P', 'list');
  ce.assign('P', ce.parse('[(1,2),(3,5),(4,7)]'));
  ce.assign('V', ce.parse('[1,2]'));
  ce.assign('W', ce.parse('[(1,2),(3,4)]'));
  const functions: Record<string, string> = {
    // A list of numbers
    L: 't\\mapsto [t,t^2,t^3,\\sin t]',
    L2: 't\\mapsto [t,t^2]',
    // A matrix
    M: 't\\mapsto [[t,t^2],[t^3,2t]]',
    // A tuple
    g: 't\\mapsto (t,t^2,t^3)',
    // A list of points with a constant point
    k: 't\\mapsto [(t,t^2), Q, (2t,t^3)]',
    k0: 't\\mapsto [(t,t^2), Q]',
    n: 't\\mapsto \\lceil t\\rceil',
  };
  for (const [name, body] of Object.entries(functions)) {
    ce.declare(name, 'function');
    ce.assign(name, ce.parse(body));
  }
  ce.declare('U', 'function');
  ce.assign(
    'U',
    ce.box([
      'Function',
      ['If', ['Greater', 't', 0], ['Tuple', 't', 1], 'Q'],
      't',
    ])
  );
  return ce;
}

describe('the derivative of an element selector is the selector of the derivative', () => {
  test('a list of numbers returned by a function', () => {
    const ce = engine();
    const L = ['L', 'u'];
    const a = 0.7;
    expect(check(ce, ['First', L], a)).toEqual([1]);
    expect(check(ce, ['Second', L], a)).toEqual([expect.closeTo(1.4, 12)]);
    expect(check(ce, ['Third', L], a)).toEqual([expect.closeTo(1.47, 12)]);
    expect(check(ce, ['Last', L], a)).toEqual([
      expect.closeTo(Math.cos(a), 12),
    ]);
    for (const expr of [
      ['Rest', L],
      ['Most', L],
      ['Reverse', L],
      ['Take', L, 2],
      ['Take', L, -2],
      ['Drop', L, 1],
      ['Drop', L, -1],
      ['Slice', L, 2, 3],
      ['Slice', L, ['Range', 2, 3]],
      ['RotateLeft', L, 1],
      ['RotateRight', L],
      ['DeleteAt', L, 2],
      ['At', L, ['List', 1, 3]],
      ['At', L, -1],
    ])
      check(ce, expr, a);
    expect(
      ce
        .box(['D', ['Last', L], 'u'])
        .evaluate()
        .toString()
    ).toBe('cos(u)');
    expect(
      ce
        .box(['D', ['Take', L, 2], 'u'])
        .evaluate()
        .toString()
    ).toBe('[1,2u]');
  });

  test('At with two indices of a matrix', () => {
    const ce = engine();
    expect(check(ce, ['At', ['M', 'u'], 2, 1], 0.7)).toEqual([
      expect.closeTo(1.47, 12),
    ]);
  });

  test('a written-out list of numbers', () => {
    const ce = engine();
    const list = ['List', 'u', ['Power', 'u', 2], ['Power', 'u', 3]];
    expect(check(ce, ['Last', list], 0.7)).toEqual([expect.closeTo(1.47, 12)]);
    check(ce, ['Take', list, 2], 0.7);
    check(ce, ['Reverse', list], 0.7);
  });

  test('a list of points with a constant point', () => {
    const ce = engine();
    const k = ['k', 'u'];
    const a = 0.7;
    expect(check(ce, ['First', k], a)).toEqual([1, expect.closeTo(1.4, 12)]);
    // The constant point `Q` is the zero point, not the scalar 0.
    expect(check(ce, ['Second', k], a)).toEqual([0, 0]);
    expect(check(ce, ['At', k, 2], a)).toEqual([0, 0]);
    expect(check(ce, ['Last', k], a)).toEqual([2, expect.closeTo(1.47, 12)]);
    for (const expr of [
      ['Take', k, 2],
      ['Rest', k],
      ['Most', k],
      ['Reverse', k],
      ['Slice', k, 2, 3],
      ['Drop', k, -1],
    ])
      check(ce, expr, a);
    expect(check(ce, ['PointY', ['Take', k, 2]], a)).toEqual([
      expect.closeTo(1.4, 12),
      0,
    ]);
    // A written-out list, not a call
    const written = ['List', ['Tuple', 'u', ['Power', 'u', 2]], 'Q'];
    expect(check(ce, ['Last', written], a)).toEqual([0, 0]);
    expect(check(ce, ['PointY', ['Last', written]], a)).toEqual([0]);
    expect(check(ce, ['Take', written, 1], a)).toEqual([
      1,
      expect.closeTo(1.4, 12),
    ]);
  });

  test('a tuple', () => {
    const ce = engine();
    const g = ['g', 'u'];
    expect(check(ce, ['Last', g], 0.7)).toEqual([expect.closeTo(1.47, 12)]);
    for (const expr of [
      ['First', g],
      ['Take', g, 2],
      ['Drop', g, 1],
      ['Rest', g],
      ['Most', g],
      ['Reverse', g],
      ['RotateRight', g],
      ['Take', g, -2],
    ])
      check(ce, expr, 0.7);
  });

  test('a PointList', () => {
    const ce = engine();
    // One point
    expect(
      check(ce, ['Last', ['PointList', 'u', ['Power', 'u', 2]]], 0.7)
    ).toEqual([expect.closeTo(1.4, 12)]);
    // A PointList that zips its components into a list of points
    expect(
      check(
        ce,
        ['Last', ['PointList', ['List', 'u', ['Multiply', 2, 'u']], 5]],
        0.7
      )
    ).toEqual([2, 0]);
    check(
      ce,
      [
        'Take',
        [
          'PointList',
          ['List', 'u', ['Multiply', 2, 'u'], ['Multiply', 3, 'u']],
          ['Power', 'u', 2],
        ],
        2,
      ],
      0.7
    );
  });

  test('a selection out of range gives the same value as the interpreter', () => {
    const ce = engine();
    const L2 = ['L2', 'u'];
    // An absent element: `NaN`, as the selection of the list itself
    for (const expr of [
      ['Third', L2],
      ['At', L2, 5],
      ['At', L2, -3],
    ]) {
      const d = ce.box(['D', expr, 'u'] as never).evaluate();
      expect(d.subs({ u: 0.7 }).N().isNaN).toBe(true);
      expect(
        ce
          .box(expr as never)
          .subs({ u: 0.7 })
          .N().isNaN
      ).toBe(true);
    }
    // A count or a span past the end is clamped, in the list and in its
    // derivative
    expect(check(ce, ['Take', L2, 5], 0.7)).toEqual([
      1,
      expect.closeTo(1.4, 12),
    ]);
    expect(check(ce, ['Drop', L2, 5], 0.7)).toEqual([]);
    expect(check(ce, ['Slice', L2, 2, 7], 0.7)).toEqual([
      expect.closeTo(1.4, 12),
    ]);
  });

  test('a selection that is constant between its jumps', () => {
    const ce = engine();
    const L = ['L', 'u'];
    for (const a of [1.3, 2.4, 3.6]) {
      check(ce, ['At', L, ['n', 'u']], a);
      check(ce, ['Take', L, ['n', 'u']], a);
      check(ce, ['Drop', L, ['Ceil', 'u']], a);
      check(ce, ['Slice', L, 1, ['Ceil', 'u']], a);
    }
    // `k(u)` has 3 points: at `⌈3.6⌉ = 4` the index is out of range.
    for (const a of [1.3, 2.4]) check(ce, ['At', ['k', 'u'], ['Ceil', 'u']], a);
    const d = ce.box(['D', ['At', ['k', 'u'], ['Ceil', 'u']], 'u']).evaluate();
    expect(d.subs({ u: 3.6 }).N().toString()).toBe(
      ce
        .box(['At', ['k', 'u'], ['Ceil', 'u']])
        .subs({ u: 3.6 })
        .N()
        .toString()
    );
    expect(
      ce
        .box(['D', ['Take', L, ['n', 'u']], 'u'])
        .evaluate()
        .toString()
    ).toBe('Take([1,2u,3u^2,cos(u)], ceil(u))');
  });

  test('a selection that changes with the variable declines', () => {
    // A count or an index is an integer: its value does not change
    // continuously. The generic chain rule gave unknown partial derivatives
    // of the selector (`Apply(Derivative("At", 0, 1), P, u)`).
    const ce = engine();
    for (const expr of [
      ['Take', ['L', 'u'], 'u'],
      ['At', ['L', 'u'], 'u'],
      ['At', 'P', 'u'],
    ]) {
      const d = ce.box(['D', expr, 'u'] as never).evaluate();
      expect(d.operator).toBe('D');
    }
  });

  test('a selection of a constant container is the zero of its shape', () => {
    // It was a list as long as the container: `D(First([1, 2]), u)` was
    // `[0, 0]`, `D(Take([1, 2, 3], 2), u)` was `[0, 0, 0]`.
    const ce = engine();
    const zero = (expr: unknown) =>
      ce
        .box(['D', expr, 'u'] as never)
        .evaluate()
        .toString();
    expect(zero(['First', ['List', 1, 2]])).toBe('0');
    expect(zero(['Take', ['List', 1, 2, 3], 2])).toBe('[0,0]');
    expect(zero(['Last', 'P'])).toBe('(0, 0)');
    // The index is constant between its jumps: the zero point while it is
    // in range, an absent point (as `At(P, 4)` is) past the end of `P`.
    const d = ce.box(['D', ['At', 'P', ['Ceil', 'u']], 'u']).evaluate();
    expect(d.subs({ u: 1.5 }).N().toString()).toBe('(0, 0)');
    expect(d.subs({ u: 3.5 }).N().toString()).toBe(
      ce.box(['At', 'P', 4]).N().toString()
    );
  });

  test('a selection of a selection that is constant between its jumps', () => {
    // The inner selection has the derivative 0, and the outer selector
    // declined: the pattern `P[⌈t⌉ + k]` of row 424 one level deeper.
    const ce = engine();
    const inner = ['Take', 'P', ['Ceil', 'u']];
    for (const a of [1.3, 2.4]) {
      expect(check(ce, ['PointY', inner], a).every((x) => x === 0)).toBe(true);
      expect(check(ce, ['PointX', ['First', inner]], a)).toEqual([0]);
      expect(check(ce, ['Last', inner], a)).toEqual([0, 0]);
    }
  });

  test('At of a dictionary or a record by a key is not a selection by position', () => {
    // `At` of a dictionary with a constant key read the dictionary as a
    // constant (its `has()` tests a key, not a symbol) and gave `0`, where
    // the value is `u²`. The derivative declines.
    const ce = engine();
    const dict = [
      'Dictionary',
      ['KeyValuePair', { str: 'a' }, 'u'],
      ['KeyValuePair', { str: 'b' }, ['Power', 'u', 2]],
    ];
    const record = [
      'Record',
      ['Tuple', "'a'", 'u'],
      ['Tuple', "'b'", ['Power', 'u', 2]],
    ];
    for (const container of [dict, record]) {
      const d = ce
        .box(['D', ['At', container, { str: 'b' }], 'u'] as never)
        .evaluate();
      expect(d.operator).toBe('D');
    }
    // A constant dictionary
    expect(
      ce
        .box([
          'D',
          [
            'At',
            ['Dictionary', ['KeyValuePair', { str: 'a' }, 3]],
            { str: 'a' },
          ],
          'u',
        ] as never)
        .evaluate().json
    ).toBe(0);
  });

  test('a PointList with a constant list component of unknown length', () => {
    // The component `c` sets the number of points. Its derivative was the
    // scalar 0, which the zip repeats for every point: `D(Rest(PointList(u,
    // c)), u)` was `[0]` and `D(PointList(u, c), u)` was the point `(1, 0)`.
    const ce = engine();
    ce.declare('c', 'list<number>');
    ce.assign('c', ce.parse('[5,6]'));
    const pl = ['PointList', 'u', 'c'];
    const zipped = [
      'PointList',
      ['List', 'u', ['Multiply', 2, 'u'], ['Multiply', 3, 'u']],
      'c',
    ];
    expect(check(ce, pl, 0.7)).toEqual([1, 0, 1, 0]);
    expect(check(ce, ['Rest', pl], 0.7)).toEqual([1, 0]);
    expect(check(ce, ['Take', pl, 1], 0.7)).toEqual([1, 0]);
    expect(check(ce, ['Last', zipped], 0.7)).toEqual([2, 0]);
    expect(check(ce, ['At', zipped, -1], 0.7)).toEqual([2, 0]);
    expect(check(ce, ['PointX', zipped], 0.7)).toEqual([1, 2]);
  });

  test('a constant list of a very large declared length declines at once', () => {
    // The list of zeros was built with no size check: 100 million entries.
    const ce = engine();
    ce.declare('A', 'vector<integer^100000000>');
    const start = Date.now();
    const d = ce.box(['D', ['List', 'u', 'A'], 'u']).evaluate();
    expect(d.operator).toBe('D');
    expect(Date.now() - start).toBeLessThan(2000);
    // 3 × (10000 + 1) + 1 nodes, over the limit of 25000
    ce.declare('B', 'matrix<integer^(3x10000)>');
    expect(ce.box(['D', ['List', 'u', 'B'], 'u']).evaluate().operator).toBe(
      'D'
    );
  });

  test('a constant matrix within the size limit is a zero matrix', () => {
    // 2 × (10000 + 1) + 1 = 20003 nodes. The size was counted from the
    // outer length first (30001 nodes), and the derivative declined.
    const ce = engine();
    ce.declare('Z', 'matrix<integer^(2x10000)>');
    const d = ce.box(['D', ['List', 'u', 'Z'], 'u']).evaluate();
    expect(d.operator).toBe('List');
    const zero = d.ops![1];
    expect(zero.nops).toBe(2);
    expect(zero.ops!.every((row) => row.nops === 10000)).toBe(true);
    expect(zero.ops!.every((row) => row.ops!.every((x) => x.is(0)))).toBe(true);
  });

  test('an absent element of a constant list stays absent', () => {
    // The zero was built from the type, with the `missing` arm removed:
    // `D(Last(P), u)` was `(0, 0)` although `Last(P)` is `Missing`.
    const ce = engine();
    ce.declare('PM', 'list');
    ce.assign('PM', ce.box(['List', ['Tuple', 1, 2], 'Missing']));
    const at = (expr: unknown, a: number) =>
      ce
        .box(['D', expr, 'u'] as never)
        .evaluate()
        .subs({ u: a })
        .N()
        .toString();
    const value = (expr: unknown, a: number) =>
      ce
        .box(expr as never)
        .subs({ u: a })
        .N()
        .toString();
    // Selected: absent, as the value is
    for (const expr of [
      ['Last', 'PM'],
      ['At', 'PM', 2],
    ]) {
      expect(at(expr, 0.5)).toBe('"Missing"');
      expect(value(expr, 0.5)).toBe('"Missing"');
    }
    expect(at(['At', 'PM', ['Ceil', 'u']], 1.5)).toBe('"Missing"');
    // Not selected: the zero point
    expect(at(['First', 'PM'], 0.5)).toBe('(0, 0)');
    expect(at(['Take', 'PM', 1], 0.5)).toBe('[(0, 0)]');
    expect(at(['At', 'PM', ['Ceil', 'u']], 0.5)).toBe('(0, 0)');
    // Each coordinate: an absent point has absent coordinates
    expect(at(['PointX', 'PM'], 0.5)).toBe('[0,"Missing"]');
  });

  test('a container that can be a list or a dictionary is read by position', () => {
    // Only `At` reads by a key. `First(C)` became `At([0, 0])` with no
    // index, and `Take(C, 1)` a read of one element.
    const ce = engine();
    ce.declare('C', 'list<number> | dictionary<number>');
    ce.assign('C', ce.parse('[1,2]'));
    const d = (expr: unknown) =>
      ce
        .box(['D', expr, 'u'] as never)
        .evaluate()
        .toString();
    expect(d(['First', 'C'])).toBe('0');
    expect(d(['Last', 'C'])).toBe('0');
    expect(d(['Take', 'C', 1])).toBe('[0]');
    expect(d(['At', 'C', 1])).toBe('0');
  });

  test('a constant element that can be absent: the zero of its value', () => {
    // `Q: missing | tuple<integer, integer>`. The zero was built from the
    // type with the `missing` arm removed, so an absent `Q` gave the present
    // point `(0, 0)`.
    const ce = engine();
    for (const [name, value] of [
      ['QM', 'Missing'],
      ['QP', ['Tuple', 1, 2]],
      ['QN', undefined],
    ] as const) {
      ce.declare(name, 'missing | tuple<integer, integer>');
      if (value !== undefined) ce.assign(name, ce.box(value as never));
    }
    const d = (expr: unknown) =>
      ce
        .box(['D', expr, 'u'] as never)
        .evaluate()
        .toString();
    const list = (q: string) => ['List', ['Tuple', 'u', 'u'], q];
    const arm = (q: string) => [
      'If',
      ['Greater', 'u', 0],
      ['Tuple', 'u', 'u'],
      q,
    ];
    // The value is `Missing`: the derivative is `Missing`
    expect(d(list('QM'))).toBe('[(1, 1),"Missing"]');
    expect(d(arm('QM'))).toBe('If(0 < u, (1, 1), "Missing")');
    expect(d(['Last', list('QM')])).toBe('"Missing"');
    // The value is a point: the zero point
    expect(d(list('QP'))).toBe('[(1, 1),(0, 0)]');
    expect(d(arm('QP'))).toBe('If(0 < u, (1, 1), (0, 0))');
    expect(d(['Last', list('QP')])).toBe('(0, 0)');
    // No value: the element keeps the scalar `0`, and a selector declines
    expect(d(list('QN'))).toBe('[(1, 1),0]');
    expect(d(arm('QN'))).toBe('If(0 < u, (1, 1), 0)');
    expect(
      ce.box(['D', ['Last', list('QN')], 'u'] as never).evaluate().operator
    ).toBe('D');
    expect(
      ce.box(['D', ['PointY', list('QN')], 'u'] as never).evaluate().operator
    ).toBe('D');
  });

  test('a key of a constant dictionary: present is zero, absent stays absent', () => {
    // An absent key gave `0`.
    const ce = engine();
    const dict = [
      'Dictionary',
      ['KeyValuePair', { str: 'a' }, 3],
      ['KeyValuePair', { str: 'b' }, ['Tuple', 1, 2]],
    ];
    const d = (key: string) =>
      ce
        .box(['D', ['At', dict, { str: key }], 'u'] as never)
        .evaluate()
        .toString();
    expect(d('a')).toBe('0');
    expect(d('b')).toBe('(0, 0)');
    expect(d('zz')).toBe('"Missing"');
    expect(
      ce
        .box(['At', dict, { str: 'zz' }] as never)
        .evaluate()
        .toString()
    ).toBe('"Missing"');
  });

  test('a self-referential type alias does not overflow the stack', () => {
    // `type alias cyc = cyc | list<number>` reaches itself through a union
    // arm. The walks of the type (is it a dictionary? what is its zero?)
    // unfolded it again at each step.
    const ce = engine();
    ce.declareType('cyc', 'cyc | list<number>', { alias: true });
    ce.declare('C', 'cyc');
    expect(() => ce.box(['D', ['First', 'C'], 'u']).evaluate()).not.toThrow();
    expect(() =>
      ce.box(['D', ['List', 'u', 'C'], 'u']).evaluate()
    ).not.toThrow();
    ce.declare('k_c', 'function');
    ce.assign('k_c', ce.box(['Function', ['List', 't', 'C'], 't']));
    expect(() =>
      ce.box(['D', ['Last', ['k_c', 'u']], 'u']).evaluate()
    ).not.toThrow();
  });

  test('a selection out of range of a container whose derivative is zero', () => {
    // The derivative of the container is a list of zeros of the same
    // length, and the selector is applied to it: the selection stays out of
    // range. `D(At([⌈u⌉], 2), u)` was `0`.
    const ce = engine();
    const short = ['List', ['Ceil', 'u'], ['Floor', 'u']];
    for (const expr of [
      ['At', ['List', ['Ceil', 'u']], 2],
      ['Third', short],
      ['At', short, -3],
      ['First', ['Take', short, 0]],
      ['Last', ['Drop', short, 5]],
      ['Third', ['List', 1, 2]],
    ]) {
      const d = ce.box(['D', expr, 'u'] as never).evaluate();
      expect(d.subs({ u: 0.5 }).N().isNaN).toBe(true);
      expect(
        ce
          .box(expr as never)
          .subs({ u: 0.5 })
          .N().isNaN
      ).toBe(true);
    }
    // In range, and a count past the end
    for (const a of [0.5, 2.5]) {
      expect(check(ce, ['Second', short], a)).toEqual([0]);
      expect(check(ce, ['Take', short, 5], a)).toEqual([0, 0]);
      expect(check(ce, ['First', ['Take', 'P', ['Ceil', 'u']]], a)).toEqual([
        0, 0,
      ]);
    }
  });

  test('the 29-piece path of the row', () => {
    const ce = new ComputeEngine();
    const n = 29;
    const points = Array.from({ length: 5 + n }, (_, i) => [
      'Tuple',
      i,
      (i * 7) % 5,
    ]);
    ce.declare('P', 'list');
    ce.assign('P', ce.box(['List', ...points]));
    const pieces = Array.from(
      { length: n },
      (_, k) =>
        `(1-\\operatorname{mod}(t,1))P[\\lceil t\\rceil+${k}]+\\operatorname{mod}(t,1)P[\\lceil t\\rceil+${k + 1}]`
    );
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.parse(`t\\mapsto\\operatorname{join}(${pieces.join(',')})`)
    );
    // At ⌈2.5⌉ = 3, the last piece runs from P[31] = (30, 0) to
    // P[32] = (31, 2), and the first piece from P[3] = (2, 4) to
    // P[4] = (3, 1).
    expect(check(ce, ['Last', ['h', 'u']], 2.5)).toEqual([1, 2]);
    expect(check(ce, ['First', ['h', 'u']], 2.5)).toEqual([1, -3]);
    expect(check(ce, ['PointY', ['Last', ['h', 'u']]], 2.5)).toEqual([2]);
  });
});

describe('a constant point element has the zero point as its derivative', () => {
  test('in a list of points', () => {
    const ce = engine();
    const d = ce.box(['D', ['k0', 'u'], 'u']).evaluate();
    // It was `[(1, 2u), 0]`.
    expect(d.toString()).toBe('[(1, 2u),(0, 0)]');
    expect(check(ce, ['k0', 'u'], 0.7)).toEqual([
      1,
      expect.closeTo(1.4, 12),
      0,
      0,
    ]);
    // An element read from a list of points, typed `missing | tuple`
    expect(
      ce
        .box(['D', ['List', 'u', ['At', 'P', 3]], 'u'])
        .evaluate()
        .toString()
    ).toBe('[1,(0, 0)]');
  });

  test('in the arms of a piecewise point', () => {
    const ce = engine();
    // It was `If(0 < u, (1, 0), 0)`.
    expect(
      ce
        .box(['D', ['U', 'u'], 'u'])
        .evaluate()
        .toString()
    ).toBe('If(0 < u, (1, 0), (0, 0))');
    for (const a of [-0.5, 0.5]) check(ce, ['U', 'u'], a);
    const which = ['Which', ['Less', 'u', 0], 'Q', 'True', ['Tuple', 'u', 'u']];
    expect(ce.box(['D', which, 'u']).evaluate().json).toEqual([
      'Which',
      ['Less', 'u', 0],
      ['Tuple', 0, 0],
      'True',
      ['Tuple', 1, 1],
    ]);
  });

  test('a constant list of known length is a list of zeros', () => {
    const ce = engine();
    expect(
      ce
        .box(['D', ['List', ['List', 'u', 'u'], 'V'], 'u'])
        .evaluate()
        .toString()
    ).toBe('[[1,1],[0,0]]');
    expect(
      ce
        .box(['D', ['List', ['List', 'u', 'u'], 'W'], 'u'])
        .evaluate()
        .toString()
    ).toBe('[[1,1],[(0, 0),(0, 0)]]');
  });

  test('a constant number keeps the scalar 0', () => {
    const ce = engine();
    ce.declare('a', 'real');
    expect(ce.box(['D', ['List', 'u', 5, 'a'], 'u']).evaluate().json).toEqual([
      'List',
      1,
      0,
      0,
    ]);
    expect(
      ce.box(['D', ['If', ['Greater', 'u', 0], 'u', 3], 'u']).evaluate().json
    ).toEqual(['If', ['Less', 0, 'u'], 1, 0]);
  });
});
