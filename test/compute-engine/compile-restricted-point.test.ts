/**
 * Arithmetic over a RESTRICTED POINT: `t·P{c}`, the Desmos-style point `P`
 * shown only where the condition `c` holds.
 *
 * `When(PointList(0, 1), c)` is typed `missing | tuple<integer, integer>` and
 * lowers to `c ? [0, 1] : undefined`. The `missing` arm hid the tuple from the
 * type tests that decide whether an operand is an array at run time, so the
 * JavaScript target compiled `t·P{c}` to the scalar `_.t * [0, 1]`, which ran
 * to NaN (Tycho ask 312). A restricted point now broadcasts as a point does,
 * and the shapes the interpreter refuses for a point (the product of two
 * points, a division by a point, a point added to a number) fail closed on
 * every target instead of compiling a component-wise value.
 *
 * Every value case is checked against the INTERPRETER.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();

const P = ['PointList', 't', 1];
/** `P` shown only when `1 < t`. */
const gated = (v: unknown = P) => ['When', v, ['Less', 1, 't']];

function run(json: unknown, t: number, to = 'javascript'): unknown {
  const r = compile(ce.box(json as never), { to } as never);
  expect(r.success).toBe(true);
  return r.run!({ t } as never);
}

function interpreted(json: unknown, t: number): number[] {
  return ce
    .box(json as never)
    .subs({ t: ce.number(t) })
    .N()
    .ops!.map((c) => c.re);
}

function declines(json: unknown, to: string): boolean {
  return compile(ce.box(json as never), { to } as never).success === false;
}

describe('A restricted point in arithmetic, JavaScript target', () => {
  test.each([
    [
      'the parsed product',
      't\\operatorname{PointList}(0,1)\\left\\{0<1\\right\\}',
    ],
    [
      'the parsed product with an explicit dot',
      't\\cdot(\\operatorname{PointList}(0,1)\\left\\{0<1\\right\\})',
    ],
  ])('%s broadcasts over the point', (_label, latex) => {
    const expr = ce.parse(latex);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.5 } as never)).toEqual([0, 0.5]);
  });

  test('the product summed with a point', () => {
    const expr = ce.parse(
      't\\operatorname{PointList}(0,1)\\left\\{0<1\\right\\}+\\operatorname{PointList}(t,0)'
    );
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.5 } as never)).toEqual([0.5, 0.5]);
  });

  test.each([
    ['a scalar times the point', ['Multiply', 't', gated()]],
    ['the point divided by a scalar', ['Divide', gated(), 't']],
    ['the negated point', ['Negate', gated()]],
    ['a function of the point', ['Sin', gated()]],
    ['a power of the point', ['Power', gated(), 2]],
    ['the point plus a point', ['Add', gated(), ['PointList', 2, 't']]],
  ])('%s matches the interpreter when the point is present', (_l, json) => {
    expect(run(json, 2)).toEqual(
      interpreted(json, 2).map((x) => expect.closeTo(x, 12))
    );
  });

  test('a scalar times the point is NaN when the point is absent', () => {
    expect(run(['Multiply', 't', gated()], 0.5)).toBeNaN();
  });

  test('the magnitude of the point is its norm', () => {
    expect(run(['Abs', gated()], 2)).toBeCloseTo(Math.sqrt(5), 12);
  });

  // A list of numbers times a point is a list of scaled points in the
  // interpreter (and in Desmos, `[1,2,3](0,1)`), also for a restricted point.
  // The point is kept whole while the list broadcasts: a flat broadcast
  // would pair the components of the point with the elements of the list.
  test('a list of numbers times the point is a list of points', () => {
    const json = ['Multiply', ['List', 1, 2, 3], gated()];
    const expected = ce
      .box(json as never)
      .subs({ t: ce.number(2) })
      .N()
      .ops!.map((p) => p.ops!.map((c) => c.re));
    expect(expected).toEqual([
      [2, 1],
      [4, 2],
      [6, 3],
    ]);
    expect(run(json, 2)).toEqual(expected);
  });

  test('a list of numbers times the point is NaN per element when the point is absent', () => {
    const r = run(['Multiply', ['List', 1, 2, 3], gated()], 0.5) as unknown[];
    expect(r).toHaveLength(3);
    for (const x of r) expect(x).toBeNaN();
  });
});

describe('Shapes the interpreter refuses for a restricted point', () => {
  test.each([
    [
      'the product of two points',
      ['Multiply', gated(), gated(['PointList', 2, 't'])],
    ],
    [
      'a restricted point times a point',
      ['Multiply', ['PointList', 2, 't'], gated()],
    ],
    ['a scalar divided by the point', ['Divide', 't', gated()]],
    ['a number plus the point', ['Add', 't', gated()]],
    ['an ordering of the point', ['Less', gated(), 3]],
  ])('%s fails closed on JavaScript', (_l, json) => {
    expect(declines(json, 'javascript')).toBe(true);
  });

  // A product with two point operands and a division by a point are errors
  // when the expression is created, also for a restricted point (as in
  // Desmos, whatever the value of the condition). The expression is then
  // invalid, and no target compiles it to a value. (`t + P{c}` stays valid
  // here because `t` has no declared type in this file: it could hold a
  // point.)
  test.each([
    [
      'the product of two points',
      ['Multiply', gated(), gated(['PointList', 2, 't'])],
      'no-product-between-points',
    ],
    [
      'a restricted point times a point',
      ['Multiply', ['PointList', 2, 't'], gated()],
      'no-product-between-points',
    ],
    [
      'a scalar divided by the point',
      ['Divide', 't', gated()],
      'no-division-by-point',
    ],
  ])('%s is an invalid expression', (_l, json, code) => {
    const expr = ce.box(json as never);
    expect(expr.isValid).toBe(false);
    expect(JSON.stringify(expr.json)).toContain(code);
    for (const to of ['javascript', 'glsl', 'wgsl', 'python'])
      expect(declines(json, to)).toBe(true);
  });

  test.each([
    [
      'the product of two points',
      ['Multiply', gated(), gated(['PointList', 2, 't'])],
    ],
    [
      'a restricted point times a point',
      ['Multiply', ['PointList', 2, 't'], gated()],
    ],
    ['a scalar divided by the point', ['Divide', 't', gated()]],
    ['a number plus the point', ['Add', 't', gated()]],
    ['a number plus a plain point', ['Add', 't', P]],
  ])('%s fails closed on the shader targets', (_l, json) => {
    expect(declines(json, 'glsl')).toBe(true);
    expect(declines(json, 'wgsl')).toBe(true);
  });

  test.each([
    ['a scalar times the point', ['Multiply', 't', gated()]],
    ['the point divided by a scalar', ['Divide', gated(), 't']],
  ])('%s fails closed on Python', (_l, json) => {
    expect(declines(json, 'python')).toBe(true);
  });

  test('the magnitude of the point is its norm on Python, not a component-wise abs', () => {
    const r = compile(ce.box(['Abs', gated()] as never), {
      to: 'python',
    } as never);
    expect(r.success).toBe(true);
    expect(r.code).toContain('np.linalg.norm');
  });
});

describe('Shader targets keep the supported shapes', () => {
  test.each([
    ['a scalar times the point', ['Multiply', 't', gated()]],
    ['the point divided by a scalar', ['Divide', gated(), 't']],
    ['the point plus a point', ['Add', gated(), ['PointList', 2, 't']]],
    ['two plain points', ['Add', P, ['PointList', 2, 't']]],
  ])('%s compiles', (_l, json) => {
    expect(declines(json, 'glsl')).toBe(false);
    expect(declines(json, 'wgsl')).toBe(false);
  });
});

/**
 * A point whose component type is not known to be a number beside a LIST.
 * `PointList(t, 1)` with `t` free is typed `tuple<unknown, integer>`, and a
 * point with a list component such as `(-6, [4, 5, 6])` is typed
 * `tuple<integer, vector<integer^3>>`. The point plans of the broadcast
 * lowering tested for a point with the strict `isNumericTuple`, which rejects
 * both, so the point was not kept whole and the flat broadcast paired its
 * components with the list's elements: `[1, 2, 3]·PointList(t, 1)` ran to
 * `NaN` behind `success: true`, where the interpreter answers a list of
 * points.
 */
describe('A point with an undecided component type beside a list', () => {
  /** The interpreter's value, with `t` assigned, as nested arrays. */
  function interpretedValue(json: unknown, t: number): unknown {
    const ce2 = new ComputeEngine();
    ce2.assign('t', t);
    const toJS = (e: ReturnType<typeof ce2.box>): unknown =>
      e.operator === 'List' || e.operator === 'Tuple' ? e.ops!.map(toJS) : e.re;
    return toJS(ce2.box(json as never).evaluate());
  }

  /** The compiled value, from a FRESH engine: the shared engine above has
   * already inferred `t` to be a number from its other uses, which would
   * type `PointList(t, 1)` as a numeric point. */
  function compiledValue(json: unknown, t: unknown): unknown {
    const r = compile(new ComputeEngine().box(json as never), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    return r.run!({ t } as never);
  }

  test.each([
    [
      'a list times the point',
      ['Multiply', ['List', 1, 2, 3], P],
      [
        [2, 1],
        [4, 2],
        [6, 3],
      ],
    ],
    [
      'the point times a list',
      ['Multiply', P, ['List', 1, 2, 3]],
      [
        [2, 1],
        [4, 2],
        [6, 3],
      ],
    ],
    [
      'a list times a number times the point',
      ['Multiply', ['List', 1, 2, 3], P, 2],
      [
        [4, 2],
        [8, 4],
        [12, 6],
      ],
    ],
  ])('%s is a list of points on JavaScript', (_l, json, expected) => {
    expect(interpretedValue(json, 2)).toEqual(expected);
    expect(compiledValue(json, 2)).toEqual(expected);
  });

  // A point with a list component, `(−6, [4, 5, 6])`, is a LIST OF POINTS
  // when written in LaTeX (user decision 2026-09-24: the Desmos reading,
  // `PointList(−6, [4, 5, 6])`), so a list times it pairs point by point.
  // The same value built in code as a MathJSON `Tuple` is data, and
  // arithmetic over it is an `incompatible-type` error that the compiled
  // targets decline (user decision 2026-09-25): before, both routes answered
  // three "points" whose second coordinate was a list.
  test('a list times a point with a list component', () => {
    const latex = '[1,2,3]\\cdot(-6,[4,5,6])';
    const expected = [
      [-6, 4],
      [-12, 10],
      [-18, 18],
    ];
    const toJS = (e: ReturnType<typeof ce.box>): unknown =>
      e.operator === 'List' || e.operator === 'Tuple' ? e.ops!.map(toJS) : e.re;
    expect(toJS(new ComputeEngine().parse(latex).evaluate())).toEqual(expected);
    const r = compile(new ComputeEngine().parse(latex), { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run!({} as never)).toEqual(expected);

    const tuple = [
      'Multiply',
      ['List', 1, 2, 3],
      ['Tuple', -6, ['List', 4, 5, 6]],
    ];
    expect(
      new ComputeEngine()
        .box(tuple as never)
        .evaluate()
        .toString()
    ).toMatch(/incompatible-type/);
    expect(() =>
      compile(new ComputeEngine().box(tuple as never), {
        to: 'javascript',
        fallback: false,
      })
    ).toThrow(/tuple with a list coordinate/);
  });

  test('the parsed product is a list of points', () => {
    const r = compile(
      new ComputeEngine().parse('[1,2,3]\\cdot\\operatorname{PointList}(t,1)'),
      { to: 'javascript' }
    );
    expect(r.success).toBe(true);
    expect(r.run!({ t: 2 } as never)).toEqual([
      [2, 1],
      [4, 2],
      [6, 3],
    ]);
  });

  // A LIST held by the free `t` is not spliced into the point on JavaScript:
  // `_SYS.pointSlot` answers NaN for that coordinate. The result is then a
  // list of points with a NaN coordinate, never a plausible number.
  test('a list held by the free component is NaN at that coordinate', () => {
    expect(compiledValue(['Multiply', ['List', 1, 2, 3], P], [1, 2])).toEqual([
      [NaN, 1],
      [NaN, 2],
      [NaN, 3],
    ]);
  });

  test('a sum with a point-or-list-of-points operand keeps the point whole', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('W', 'list<tuple<number, number>> | tuple<number, number>');
    const r = compile(ce2.box(['Add', 'W', P] as never), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    expect(
      r.run!({
        t: 2,
        W: [
          [1, 1],
          [2, 2],
        ],
      } as never)
    ).toEqual([
      [3, 2],
      [4, 3],
    ]);
    expect(r.run!({ t: 2, W: [5, 5] } as never)).toEqual([7, 6]);
  });

  test('the interval target answers a list of points too', () => {
    const r = compile(
      new ComputeEngine().box(['Multiply', ['List', 1, 2, 3], P] as never),
      { to: 'interval-js' } as never
    );
    expect(r.success).toBe(true);
    const v = r.run!({ t: 2 } as never) as unknown as Array<
      Array<{ value: { lo: number } }>
    >;
    expect(v.map((p) => p.map((c) => c.value.lo))).toEqual([
      [2, 1],
      [4, 2],
      [6, 3],
    ]);
  });

  // A shader lowers a point and a list of the same length to one `vecN`,
  // and its operators combine them component-wise. In the interpreter a point
  // times a list is a list of points, and a point divided by a list stays
  // unevaluated.
  test.each([
    ['a list times the point', ['Multiply', ['List', 1, 2], P]],
    ['the point divided by a list', ['Divide', P, ['List', 1, 2]]],
    ['a point times a list', ['Multiply', ['Tuple', 'x', 1], ['List', 1, 2]]],
    ['a point divided by a list', ['Divide', ['Tuple', 3, 1], ['List', 1, 2]]],
  ])('%s fails closed on the shader targets', (_l, json) => {
    for (const to of ['glsl', 'wgsl']) {
      expect(declines(json, to)).toBe(true);
      // With `t` untyped, as in a fresh engine.
      const r = compile(new ComputeEngine().box(json as never), {
        to,
      } as never);
      expect(r.success).toBe(false);
    }
  });

  test('a point divided by a list fails closed on the interval target', () => {
    const r = compile(
      new ComputeEngine().box(['Divide', P, ['List', 1, 2]] as never),
      { to: 'interval-js' } as never
    );
    expect(r.success).toBe(false);
  });

  test('two lists still combine component-wise on the shader targets', () => {
    expect(declines(['Multiply', ['List', 1, 2], ['List', 3, 4]], 'glsl')).toBe(
      false
    );
  });
});

describe('Dot of a restricted operand', () => {
  test.each([
    [
      'a restricted list of points',
      [
        'Dot',
        gated(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]),
        ['Tuple', 1, 1],
      ],
    ],
    ['a restricted point', ['Dot', gated(['Tuple', 1, 2]), ['Tuple', 1, 1]]],
  ])('%s fails closed on Python', (_l, json) => {
    expect(declines(json, 'python')).toBe(true);
  });
});

/**
 * A restricted list, point or list of points on the INTERVAL target. The
 * `When` handler already masked a list-typed input (`A\{0<t\}`) with
 * `_IA.restrict`; a restricted LITERAL (`[1, 2]\{0<t\}`, `(1, 2)\{0<t\}`)
 * declined because the target spells a literal list only at a consuming
 * position, and the restricted list inside a `PointList` or under arithmetic
 * declined because its `missing` arm hid the list from the type tests. The
 * value is the one `A\{0<t\}` has: the array where the condition holds, the
 * `empty` result where it fails (the interpreter answers `Missing`), and the
 * elements clipped to `partial` where it is undecided.
 */
describe('A restricted collection on the interval target', () => {
  const ce2 = new ComputeEngine();
  ce2.declare('A', 'list<real>');
  ce2.declare('B', 'list<real>');
  ce2.declare('t', 'real');
  const A = [1, 2, 3];
  const B = [4, 5, 6];

  /** The midpoint of every interval in `v`, nested as `v` is (every value
   * here is a point or a two-ulp enclosure), or `'empty'` for the `empty`
   * result. */
  function bounds(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(bounds);
    const x = v as { kind?: string; value?: { lo: number; hi: number } };
    if (x.kind === 'empty') return 'empty';
    const iv = x.value ?? (v as { lo: number; hi: number });
    return (iv.lo + iv.hi) / 2;
  }

  /** The interpreter's value at `t`, nested the same way, with the absent
   * value `Missing` read as `'empty'`. */
  function interpreted(latex: string, t: number): unknown {
    const v = ce2
      .parse(latex)
      .subs({ t, A: ce2.box(['List', ...A]), B: ce2.box(['List', ...B]) })
      .N();
    const toJS = (e: typeof v): unknown =>
      e.symbol === 'Missing'
        ? 'empty'
        : e.operator === 'List' || e.operator === 'Tuple'
          ? e.ops!.map(toJS)
          : e.re;
    return toJS(v);
  }

  function intervalRun(latex: string, t: unknown): unknown {
    const r = compile(ce2.parse(latex), { to: 'interval-js' } as never);
    expect(r.success).toBe(true);
    return r.run!({ t, A, B } as never);
  }

  const close = (x: unknown): unknown =>
    Array.isArray(x)
      ? x.map(close)
      : typeof x === 'number'
        ? expect.closeTo(x, 12)
        : x;

  test.each([
    ['a restricted list literal', '[1,2]\\{0<t\\}'],
    ['a restricted point literal', '(1,2)\\{0<t\\}'],
    ['a restricted list input', 'A\\{0<t\\}'],
    ['a point list over a restricted list', '(A\\{0<t\\}, B)'],
    ['a point list over a restricted list and a slot', '(A\\{0<t\\}, 3)'],
    ['a restricted point list plus a point', '(A\\{0<t\\}, B)+(1,1)'],
    ['a restricted list plus a number', 'A\\{0<t\\}+1'],
    ['a function of a restricted list', '\\sin(A\\{0<t\\})'],
    ['a scalar times a restricted point', 't\\cdot(1,2)\\{0<t\\}'],
    ['a restricted point plus a point', '(1,2)\\{0<t\\}+(t,1)'],
  ])('%s matches the interpreter', (_l, latex) => {
    for (const t of [2, -1]) {
      const expected = interpreted(latex, t);
      expect(bounds(intervalRun(latex, t))).toEqual(close(expected));
    }
  });

  test('an undecided condition clips each element to a partial value', () => {
    // A coordinate of the unrestricted source `B` is a bare interval.
    const v = intervalRun('(A\\{0<t\\}, B)', { lo: -1, hi: 1 }) as Array<
      Array<{ kind?: string; value?: { lo: number }; lo?: number }>
    >;
    expect(v.map((p) => p.map((c) => c.kind ?? 'interval'))).toEqual([
      ['partial', 'interval'],
      ['partial', 'interval'],
      ['partial', 'interval'],
    ]);
    expect(v.map((p) => p.map((c) => c.value?.lo ?? c.lo))).toEqual([
      [1, 4],
      [2, 5],
      [3, 6],
    ]);
  });

  test('a restricted list of booleans still declines', () => {
    const r = compile(ce2.parse('[t<1, t<2]\\{0<t\\}'), {
      to: 'interval-js',
    } as never);
    expect(r.success).toBe(false);
  });
});
