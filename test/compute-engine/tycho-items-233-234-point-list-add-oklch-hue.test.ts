/**
 * Tycho items 233 and 234.
 *
 * Item 234: a point ADDED to a list of points (`4P + 0.3(t, t)` with
 * `P: list<tuple<number, number>>`) is a broadcast over the list in the
 * interpreter — the point is added to every element. The JavaScript compile
 * target used to (a) fail closed on the numeric-tuple spelling, (b) zip an
 * `unknown`-component tuple FLAT against the list (right by coincidence when
 * both components are equal, wrong otherwise), and (c) type the sum as the
 * union `list<tuple<…>> | tuple<…>`, which made `PointX` read the list as a
 * single point. The interpreter fallback's `run` also boxed a JS-array
 * argument as MathJSON (an `unexpected-mathjson` error).
 *
 * Item 233: the OKLCh hue produced by every conversion is folded into
 * `[0, 360)`, on the interpreted and JavaScript paths alike (the GPU target
 * already did).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const P = [
  [0, 0],
  [0.2, 0],
  [0.4, 0.2],
];
const t = 0.754;

function engineWithPointList(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = 'machine';
  ce.declare('t', 'real');
  ce.declare('P', 'list<tuple<number, number>>');
  return ce;
}

describe('Tycho item 234 — point + list of points, JavaScript target', () => {
  let warn: jest.SpyInstance;
  beforeAll(() => {
    warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterAll(() => warn.mockRestore());

  test('`P + (1, 2)` types as a list of points, compiles, and matches the interpreter', () => {
    const ce = engineWithPointList();
    const expr = ce.box(['Add', 'P', ['Tuple', 1, 2]]);
    expect(expr.type.toString()).toBe('list<tuple<number, number>>');
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run({ P, t })).toEqual([
      [1, 2],
      [1.2, 2],
      [1.4, 2.2],
    ]);
  });

  test('an unknown-component point is kept ATOMIC (was zipped flat)', () => {
    const ce = engineWithPointList();
    // `(t, 2t)`: the second component differs, so a flat zip is detectable.
    const expr = ce.box([
      'Add',
      ['Multiply', 4, 'P'],
      ['Multiply', 0.3, ['Tuple', 't', ['Multiply', 2, 't']]],
    ]);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    const expected = P.map(([x, y]) => [4 * x + 0.3 * t, 4 * y + 0.6 * t]);
    const got = r.run({ P, t }) as number[][];
    got.forEach((p, i) => {
      expect(p[0]).toBeCloseTo(expected[i][0], 12);
      expect(p[1]).toBeCloseTo(expected[i][1], 12);
    });
  });

  test("`PointX`/`PointY` over the sum map the LIST (Tycho's `d` witness, raw spelling)", () => {
    const ce = engineWithPointList();
    const pointExpr = [
      'Add',
      ['InvisibleOperator', 4, 'P'],
      ['InvisibleOperator', 0.3, ['Delimiter', ['Sequence', 't', 't'], "'(,)'"]],
    ];
    const x = ce.box(['PointX', pointExpr]);
    expect(x.type.toString()).toBe('list<number>');
    const rx = compile(x, { to: 'javascript' });
    expect(rx.success).toBe(true);
    const gotX = rx.run({ P, t }) as number[];
    P.forEach(([px], i) => expect(gotX[i]).toBeCloseTo(4 * px + 0.3 * t, 12));

    const d = ce.box([
      'Sqrt',
      [
        'Add',
        ['Power', ['PointX', pointExpr], 2],
        ['Power', ['PointY', pointExpr], 2],
      ],
    ]);
    const rd = compile(d, { to: 'javascript' });
    expect(rd.success).toBe(true);
    const gotD = rd.run({ P, t }) as number[];
    P.forEach(([px, py], i) =>
      expect(gotD[i]).toBeCloseTo(
        Math.hypot(4 * px + 0.3 * t, 4 * py + 0.3 * t),
        12
      )
    );
  });

  test('a literal list of points plus a point compiles element-wise', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Add',
      ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ['Tuple', 10, 20],
    ]);
    expect(expr.evaluate().toString()).toBe('[(11, 22),(13, 24)]');
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run({})).toEqual([
      [11, 22],
      [13, 24],
    ]);
  });

  test('`PointX` over a LITERAL point list plus a point maps the list', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'PointX',
      ['Add', ['List', ['Tuple', 0, 0], ['Tuple', 3, 4]], ['Tuple', 1, 2]],
    ]);
    expect(expr.evaluate().toString()).toBe('[1,4]');
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(true);
    expect(r.run({})).toEqual([1, 4]);
  });

  test('a scalar-or-list union keeps its honest union type', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'number | list<tuple<number, number>>');
    const expr = ce.box(['Add', 'u', ['Tuple', 1, 2]]);
    expect(expr.type.matches('list<any>')).toBe(false);
  });

  test('a third scalar operand, string cells, and complex cells fail closed', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'list<tuple<number, number>>');
    ce.declare('S', 'list<tuple<string, string>>');
    ce.declare('Z', 'list<tuple<complex, complex>>');
    for (const json of [
      ['Add', 'P', ['Tuple', 1, 2], 1],
      ['Add', 'S', ['Tuple', 1, 2]],
    ]) {
      const r = compile(ce.box(json as never), { to: 'javascript' });
      expect(r.success).toBe(false);
    }
    // Complex cells used to fail closed too. A point list whose declared
    // column type is complex has no single element lane, so the sum lowers
    // through the run-time dispatching `_SYS.sadd` (Tycho item 246) and
    // answers the interpreter's value.
    const r = compile(ce.box(['Add', 'Z', ['Tuple', 1, 2]] as never), {
      to: 'javascript',
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_SYS.sadd');
    expect(
      r.run({
        Z: [
          [{ re: 1, im: 1 }, 0],
          [3, 4],
        ],
      })
    ).toEqual([
      [{ re: 2, im: 1 }, 2],
      [4, 6],
    ]);
  });

  test('the lambda-convention fallback boxes a positional array under its parameter type', () => {
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['Add', ['PointX', 'p'], ['PointY', 'p'], ['Tuple', 1, 2]],
      ['Typed', 'p', ['Tuple', 'number', 'number']],
    ] as never);
    const r = compile(f, { to: 'no-such-target' as never });
    expect(r.success).toBe(false);
    // `PointX(p) + PointY(p)` is a scalar, plus a point: an error per
    // component in the interpreter — the argument still boxes as a POINT
    // (a `List` would have been an `incompatible-type` at application).
    const g = ce.box(['Function', ['PointX', 'p'], 'p'] as never);
    const rg = compile(g, { to: 'no-such-target' as never });
    expect(rg.run([3, 4])).toBe(3);
  });

  test('a point plus a list of SCALARS still fails closed (interpreter errors per element)', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<number>');
    const r = compile(ce.box(['Add', 'L', ['Tuple', 1, 2]]), {
      to: 'javascript',
    });
    expect(r.success).toBe(false);
  });

  test('two points plus the list still fail closed, and the fallback `run` accepts a list argument', () => {
    const ce = engineWithPointList();
    const expr = ce.box(['Add', 'P', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
    const r = compile(expr, { to: 'javascript' });
    expect(r.success).toBe(false);
    // Before: the array argument boxed as MathJSON (`unexpected-mathjson`)
    // and the shadow was declared `number`, so `run` threw.
    expect(r.run({ P, t })).toEqual([
      [4, 6],
      [4.2, 6],
      [4.4, 6.2],
    ]);
  });
});

describe('Tycho item 233 — OKLCh hue is folded into [0, 360)', () => {
  test('`Hsv(180, 1, 1)` converts to a positive hue on the interpreted path', () => {
    const ce = new ComputeEngine();
    const c = ce.box(['AsOklch', ['Hsv', 180, 1, 1]]).evaluate();
    const [L, C, H] = c.ops!.map((x) => x.re);
    expect(L).toBeCloseTo(0.9054, 3);
    expect(C).toBeCloseTo(0.1546, 3);
    expect(H).toBeCloseTo(194.77, 2);
  });

  test('the compiled `Hsv` emission agrees with the interpreter', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Hsv', 180, 1, 1]), { to: 'javascript' });
    expect(r.success).toBe(true);
    const [L, C, H] = r.run({}) as number[];
    expect(L).toBeCloseTo(0.9054, 3);
    expect(C).toBeCloseTo(0.1546, 3);
    expect(H).toBeCloseTo(194.77, 2);
  });

  test('a hue the user wrote is left as written, through conversions too', () => {
    const ce = new ComputeEngine();
    const c = ce.box(['Oklch', 0.9, 0.15, -165]).evaluate();
    expect(c.ops![2].re).toBe(-165);
    // A conversion that starts from an OKLCh color keeps the authored hue
    // (`ColorMix` is not a witness: its hue INTERPOLATION folds the result).
    const same = ce
      .box(['ColorToColorspace', ['Oklch', 0.9, 0.15, -165], { str: 'oklch' }])
      .evaluate();
    expect(same.ops![2].re).toBe(-165);
  });
});
