/**
 * Arithmetic over a RESTRICTED POINT: `t·P{c}`, the Desmos-style point `P`
 * shown only where the condition `c` holds.
 *
 * `If(c, PointList(0, 1))` is typed `missing | tuple<integer, integer>` and
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

/** A fresh engine with `t` declared real, for the tests that build their own. */
function engineWithT(): ComputeEngine {
  const e = new ComputeEngine();
  e.declare('t', 'real');
  return e;
}
/** `P` shown only when `1 < t`. */
const gated = (v: unknown = P) => ['If', ['Less', 1, 't'], v];

/** The compiled value at `t`. Boxing declares no name, so the code is
 * compiled on an engine where `t` is declared. */
function run(json: unknown, t: number, to = 'javascript'): unknown {
  const r = compile(engineWithT().box(json as never), { to } as never);
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

  // The interpreter answers `Missing` when the point is absent. The compiled
  // value of arithmetic on an absent point is not specified
  // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code", the bullet
  // "Everything computed from an absent value, except at a discharge"; R4 of
  // `docs/plans/2026-11-01-absent-value-contract.md`), so the compiled tests
  // in this block use a present point only.

  test('the magnitude of the point is its norm', () => {
    expect(run(['Abs', gated()], 2)).toBeCloseTo(Math.sqrt(5), 12);
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
    for (const to of ['javascript', 'glsl'])
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
  });
});

describe('Shader targets keep the supported shapes', () => {
  test.each([
    ['a scalar times the point', ['Multiply', 't', gated()]],
    ['the point divided by a scalar', ['Divide', gated(), 't']],
    ['the point plus a point', ['Add', gated(), ['PointList', 2, 't']]],
    ['two plain points', ['Add', P, ['PointList', 2, 't']]],
  ])('%s compiles', (_l, json) => {
    const r = compile(engineWithT().box(json as never), {
      to: 'glsl',
    } as never);
    expect(r.success).toBe(true);
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
  // A shader lowers a point and a list of the same length to one `vecN`,
  // and its operators combine them component-wise. In the interpreter a point
  // times or divided by a list is a list of points.
  test.each([
    ['a list times the point', ['Multiply', ['List', 1, 2], P]],
    ['the point divided by a list', ['Divide', P, ['List', 1, 2]]],
  ])('%s fails closed on the shader targets', (_l, json) => {
    for (const to of ['glsl']) {
      expect(declines(json, to)).toBe(true);
      // With `t` untyped, as in a fresh engine.
      const r = compile(new ComputeEngine().box(json as never), {
        to,
      } as never);
      expect(r.success).toBe(false);
    }
  });

  // A point of numbers times or divided by a list is an array of points on
  // GLSL, as in the interpreter (CE-1569).
  test.each([
    [
      'a point times a list',
      ['Multiply', ['Tuple', 'x', 1], ['List', 1, 2]],
      /^vec2 (v\d+) = vec2\(x, 1\.0\);\nreturn vec2\[2\]\(\(\1 \* 1\.0\), \(\1 \* 2\.0\)\);$/,
    ],
    [
      'a point divided by a list',
      ['Divide', ['Tuple', 3, 1], ['List', 1, 2]],
      /^vec2\[2\]\(vec2\(3\.0, 1\.0\), vec2\(1\.5, 0\.5\)\)$/,
    ],
  ])('%s is an array of points on GLSL', (_l, json, code) => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const r = compile(ce.box(json as never), { to: 'glsl' } as never);
    expect(r.success).toBe(true);
    expect(r.code).toMatch(code);
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

describe('Distance of a restricted point', () => {
  // A false restriction of a point is the point of `NaN` coordinates (user
  // decision 2026-11-03), so the distances from it to a list of points are a
  // list of `NaN`, and the distance between two points is `NaN`, in the
  // interpreter and in compiled code.
  const L = ['List', ['Tuple', 3, 4], ['Tuple', 6, 8]];
  test.each([
    ['point, list', ['Distance', gated(['Tuple', 0, 0]), L]],
    ['list, point', ['Distance', L, gated(['Tuple', 0, 0])]],
  ])('%s: a false restricted point answers a list of NaN', (_l, json) => {
    expect(
      ce
        .box(json as never)
        .subs({ t: 0 })
        .evaluate()
        .toString()
    ).toBe('[NaN,NaN]');
    expect(run(json, 0)).toEqual([NaN, NaN]);
    expect(run(json, 2)).toEqual([5, 10]);
  });

  test('point, point: a false restricted point answers NaN', () => {
    const json = ['Distance', gated(['Tuple', 0, 0]), ['Tuple', 3, 4]];
    expect(
      ce
        .box(json as never)
        .subs({ t: 0 })
        .evaluate().json
    ).toBe('NaN');
    expect(run(json, 0)).toBeNaN();
    expect(run(json, 2)).toBe(5);
  });
});

/**
 * A restricted list, point or list of points on the INTERVAL target. The
 * restriction handler already masked a list-typed input (`A\{0<t\}`) with
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
   * value `Missing` and `NaN` read as `'empty'`, the spelling of both on
   * this target: a false restriction of a point is a point of `NaN`
   * coordinates, a point of `empty` coordinates on this target. */
  function interpreted(latex: string, t: number): unknown {
    const v = ce2
      .parse(latex)
      .subs({ t, A: ce2.box(['List', ...A]), B: ce2.box(['List', ...B]) })
      .N();
    const toJS = (e: typeof v): unknown =>
      e.symbol === 'Missing' || e.isNaN === true
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
    ['a restricted point literal', '(1,2)\\{0<t\\}'],
    ['a scalar times a restricted point', 't\\cdot(1,2)\\{0<t\\}'],
    ['a restricted point plus a point', '(1,2)\\{0<t\\}+(t,1)'],
  ])('%s matches the interpreter', (_l, latex) => {
    for (const t of [2, -1]) {
      // The compiled value of an operator applied to an absent operand is not
      // specified.
      if (t < 0 && _l === 'a function of a restricted list') continue;
      const expected = interpreted(latex, t);
      expect(bounds(intervalRun(latex, t))).toEqual(close(expected));
    }
  });

  test('a restricted list of booleans still declines', () => {
    const r = compile(ce2.parse('[t<1, t<2]\\{0<t\\}'), {
      to: 'interval-js',
    } as never);
    expect(r.success).toBe(false);
  });
});

describe('The norm of a point with a restricted list component', () => {
  // `L {c}` is typed `list<…> | missing`. Its `missing` arm hid the list
  // from the tests that decide whether a component broadcasts, so the
  // JavaScript target took the absolute value of each coordinate of a
  // restricted list of points, and folded a restricted list into one vector
  // of a single norm. Every value is checked against the interpreter.
  const ceR = new ComputeEngine();
  ceR.declare('t', 'real');
  ceR.declare('L', 'list<real>');
  ceR.declare('y', 'real');
  const pointList = [
    'Abs',
    ['PointList', ['If', ['Less', 0, 't'], ['List', 1, 2]], 'y'],
  ];
  const tuple = ['Abs', ['Tuple', ['If', ['Less', 0, 't'], 'L'], 'y']];
  const L = [1, 2, 3];

  /** The interpreted value at `t` (`y = 3`, `L = [1, 2, 3]`). */
  function interpretedAt(json: unknown, t: number): unknown {
    const e = new ComputeEngine();
    e.declare('L', 'list<real>');
    e.assign('L', e.box(['List', ...L]));
    e.assign('t', t);
    e.assign('y', 3);
    const v = e.box(json as never).N();
    if (v.symbol === 'Missing') return undefined;
    return v.ops ? v.ops.map((c) => c.re) : v.re;
  }

  function compiledAt(json: unknown, t: number, to: string): unknown {
    const r = compile(ceR.box(json as never), { to, fallback: false } as never);
    expect(r.success).toBe(true);
    return r.run!({ t, y: 3, L } as never);
  }

  test('Hypot and a restricted list of points beside another list match the interpreter (JavaScript)', () => {
    // A scalar condition selects the list whole, also under `Hypot`, which
    // broadcasts element by element: the interpreter gives the absent list
    // `Missing` (selection rule of 2026-11-02; it gave one `NaN` per
    // element of the other list). The compiled value of an operator applied
    // to an absent operand is not specified.
    const gatedL = ['If', ['Less', 0, 't'], 'L'];
    const hypot = ['Hypot', gatedL, ['List', 10, 20, 30]];
    expect(interpretedAt(hypot, -1)).toBeUndefined();
    // A restricted list of points is absent as a whole: `Missing` in the
    // interpreter.
    const points = ['Abs', ['PointList', gatedL, ['List', 10, 20, 30]]];
    expect(interpretedAt(points, -1)).toBeUndefined();
  });

  test('the norm types as a list', () => {
    expect(ceR.box(tuple as never).type.toString()).toBe('list<number>');
  });

  test('the interval and shader targets decline a restricted list coordinate', () => {
    for (const to of ['interval-js', 'glsl']) {
      const r = compile(ceR.box(tuple as never), { to } as never);
      expect(r.success).toBe(false);
    }
  });
});
