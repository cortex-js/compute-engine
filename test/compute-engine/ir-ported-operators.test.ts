/**
 * The operators that compiled before 0.194.0 and declined after it
 * (CE-1533), ported to the compiler: `HarmonicNumber`, `Zeta(s, a)`,
 * `Gamma(s, z)`, `Gamma`, `Sign` and `Norm` of a complex, a closed `Limit`,
 * `ND(f, x)` and `EvaluateAt` on JavaScript; `EvaluateAt` and `Argument` of
 * a real in the interval mode. Each compiled value is the interpreter's
 * (`N()`), within the error of the double kernel; a pole is ±∞ where the
 * interpreter gives `~oo`, and a value that is not real is NaN on the real
 * lane.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

const ce = new ComputeEngine();
for (const v of ['x', 'y', 'a']) ce.declare(v, 'real');
ce.declare('n', 'integer');
ce.declare('w', 'complex');
ce.declare('L', 'list<real>');

type Json = unknown;
type Cx = { re: number; im: number };
type Point = Record<string, number | Cx | number[]>;

/** The double `v` as an exact rational: a decimal is not the double that
 *  compiled code reads. */
function exact(v: number) {
  if (!Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) < 1e-6)
    return ce.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ce.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

function boxed(v: number | Cx | number[]) {
  if (typeof v === 'number') return exact(v);
  if (Array.isArray(v)) return ce.function('List', v.map(exact));
  return ce.function('Complex', [exact(v.re), exact(v.im)]);
}

/** A value: a number as `{re, im}`, or a list of values. */
type Value = Cx | Value[];

/** The value of a boxed result: a `List` is the list of its elements. */
function valueOf(r: ReturnType<typeof ce.box>): Value {
  if (r.operator === 'List') return r.ops!.map(valueOf);
  return { re: r.re, im: r.im ?? 0 };
}

/** The interpreter's value of `json` at `p`. */
function interpret(json: Json, p: Point): Value {
  const subs = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, boxed(v)])
  );
  const expr = ce.box(json as never).subs(subs);
  const r = expr.N();
  if (r.isNumberLiteral || r.operator === 'List') return valueOf(r);
  // Above machine precision a kernel that has only a double value stays
  // unevaluated (`Gamma(s, z)` at `z < 0`); compiled code reads doubles, so
  // its reference is the interpreter at machine precision.
  const precision = ce.precision;
  ce.precision = 'machine';
  try {
    return valueOf(expr.N());
  } finally {
    ce.precision = precision;
  }
}

function compiled(json: Json, options: object = {}) {
  return compile(ce.box(json as never), {
    fallback: false,
    ...options,
  } as never);
}

/** The difference between the compiled value `got` and the interpreter's
 *  `want`, or `undefined`: the shapes, then each element. `real`: a value
 *  of real operands that is not real is NaN. */
function difference(
  got: unknown,
  want: Value,
  tolerance: number,
  real: boolean
): string | undefined {
  const show = () =>
    `${JSON.stringify(got)}, interpreter ${JSON.stringify(want)}`;
  if (Array.isArray(want)) {
    if (!Array.isArray(got) || got.length !== want.length) return show();
    for (let i = 0; i < want.length; i++) {
      const d = difference(got[i], want[i], tolerance, real);
      if (d !== undefined) return `[${i}] ${d}`;
    }
    return undefined;
  }
  if (Array.isArray(got)) return show();
  const g: Cx = typeof got === 'number' ? { re: got, im: 0 } : (got as Cx);
  if (typeof g?.re !== 'number' || typeof g?.im !== 'number') return show();
  const close = (a: number, b: number) =>
    a === b ||
    (Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(b), Math.abs(a)));
  // `~oo` has no finite imaginary part: an infinite part (a pole) or NaN.
  if (!Number.isFinite(want.im))
    return Number.isFinite(g.re) && Number.isFinite(g.im) ? show() : undefined;
  if (Number.isNaN(want.re)) return Number.isNaN(g.re) ? undefined : show();
  // Not real: NaN on the real lane.
  if (want.im !== 0 && g.im === 0 && real)
    return Number.isNaN(g.re) ? undefined : show();
  return close(g.re, want.re) && close(g.im, want.im) ? undefined : show();
}

/** The differences between the compiled value and the interpreter's at
 *  each point: none expected. */
function differences(
  json: Json,
  points: Point[],
  tolerance = 1e-13,
  options: object = {}
): string[] {
  const real = !('mode' in options) || options.mode !== 'complex';
  const run = compiled(json, options).run as unknown as (p: Point) => unknown;
  return points.flatMap((p) => {
    const d = difference(run(p), interpret(json, p), tolerance, real);
    return d === undefined ? [] : [`${JSON.stringify(p)}: ${d}`];
  });
}

/** The message of the decline of `json`, or `undefined`. */
function decline(json: Json, options: object = {}): string | undefined {
  try {
    compiled(json, options);
  } catch (e) {
    return (e as Error).message;
  }
  return undefined;
}

const xs = (values: number[]) => values.map((x) => ({ x }));
const grid = (as: number[], bs: number[]) =>
  as.flatMap((x) => bs.map((y) => ({ x, y })));
const ws = (values: [number, number][]) =>
  values.map(([re, im]) => ({ w: { re, im } }));

// prettier-ignore
const REALS = [-10.5, -3.7, -2.5, -2, -1, -0.5, -1e-9, 0, 1e-9, 1e-5, 0.05, 0.1, 0.5, 1, 1.5, 2, 3, 7.25, 10, 30.5, 1000, 123456, 1e9];
// prettier-ignore
const COMPLEX: [number, number][] = [[0.5, 0.3], [0, 0], [-2, 0], [-2.5, 0], [3, 0], [1, 0], [0, 1], [0, -3], [-3.5, 2], [-1, 1e-9], [1e-300, 0]];

describe('the special functions on JavaScript give the interpreter value', () => {
  // prettier-ignore
  test.each([
    ['HarmonicNumber', ['HarmonicNumber', 'x'], xs(REALS)],
    ['HarmonicNumber of two operands', ['HarmonicNumber', 'x', 'y'], grid([-2, -1.5, -0.5, -0.3, 0, 1e-6, 0.001, 0.5, 1, 3, 10, 2000.5], [-4.5, -3, -2, -1, 0, 0.5, 0.999, 1, 1.001, 2, 3.5, 10])],
    // The witness of a series that did not converge (x = -0.09, y = 1000),
    // and the boundaries of the methods: |n| = 0.1, r near 1 and 1 ± 0.5,
    // a large r.
    ['HarmonicNumber of two operands near the boundaries of its methods', ['HarmonicNumber', 'x', 'y'], grid([-0.95, -0.5, -0.1001, -0.1, -0.0999, -0.09, 0.05, 0.0999, 0.1, 0.1001, 0.6, 3.5], [-5, -4.9, 0.5, 0.501, 0.999, 1.001, 1.499, 1.5, 1.501, 2, 10, 50, 100, 300, 1000])],
    ['Zeta of two operands', ['Zeta', 'x', 'y'], grid([-2, -1, 0, 0.5, 0.7, 1, 2, 2.5, 3], [-3, -2.5, -1, -0.5, 0, 0.5, 1.3, 2, 7.25])],
    ['Gamma of two operands', ['Gamma', 'x', 'y'], grid([-2, -1.5, 0, 0.5, 0.7, 1, 2, 3, 5], [-10, -2, -1, 0, 1e-3, 0.5, 1.3, 3, 10, 30])],
  ])('%s', (_, json, points) => {
    expect(differences(json, points as Point[])).toEqual([]);
  });

  test('a kernel is called by name', () => {
    expect(compiled(['HarmonicNumber', 'x']).code).toContain(
      '_SYS.ir.harmonic(_.x)'
    );
    expect(compiled(['Zeta', 'x', 'y']).code).toContain(
      '_SYS.ir.zetagen(_.x, _.y)'
    );
    expect(compiled(['Gamma', 'x', 'y']).code).toContain(
      '_SYS.ir.gammaupper(_.x, _.y)'
    );
  });

  test('a closed node is the interpreter value', () => {
    const r = compiled(['HarmonicNumber', 10]);
    expect(r.code).not.toContain('harmonic');
    expect((r.run as unknown as () => number)()).toBe(
      (interpret(['HarmonicNumber', 10], {}) as Cx).re
    );
  });

  test('HarmonicNumber threads over a list', () => {
    expect(
      differences(['HarmonicNumber', 'L'], [{ L: [1, 2.5, -0.5, 0] }])
    ).toEqual([]);
  });

  test('a list is compared element by element', () => {
    const want = interpret(['List', 1, 2], {});
    expect(difference([1, 2], want, 0, true)).toBeUndefined();
    expect(difference([1, 3], want, 0, true)).toBeDefined();
    expect(difference([1], want, 0, true)).toBeDefined();
    expect(difference(1, want, 0, true)).toBeDefined();
    // A non-finite value is equal only to itself, whatever the tolerance.
    const one = { re: 1, im: 0 };
    const inf = { re: Infinity, im: 0 };
    expect(difference(Infinity, one, 1e-13, true)).toBeDefined();
    expect(difference(1, inf, 1e-13, true)).toBeDefined();
    expect(difference(-Infinity, inf, 1e-13, true)).toBeDefined();
    expect(difference(Infinity, inf, 1e-13, true)).toBeUndefined();
    expect(difference(NaN, one, 1e-13, true)).toBeDefined();
    expect(difference(1 + 1e-15, one, 1e-13, true)).toBeUndefined();
  });

  test('a value that is not real is the complex value in mode complex', () => {
    // `Γ(0, −1)` is `−1.895 − πi`; `Γ(2, −1)` is real.
    expect(
      differences(
        ['Gamma', 'x', 'y'],
        grid([0, 0.5, 2, 3], [-2, -1, 0.5, 2]),
        1e-13,
        { mode: 'complex' }
      )
    ).toEqual([]);
  });
});

describe('Gamma, Sign and Norm of a complex', () => {
  test.each([
    ['Gamma', ['Gamma', 'w']],
    ['Sign', ['Sign', 'w']],
    ['Norm', ['Norm', 'w']],
    ['Norm of order 1', ['Norm', 'w', 1]],
    ['Norm of order 3', ['Norm', 'w', 3]],
  ])('%s', (_, json) => {
    for (const mode of ['strict', 'complex'])
      expect([mode, differences(json, ws(COMPLEX), 1e-14, { mode })]).toEqual([
        mode,
        [],
      ]);
  });

  test('a pole of Gamma is +∞', () => {
    const run = compiled(['Gamma', 'w']).run as unknown as (
      p: Point
    ) => unknown;
    expect(run({ w: { re: -2, im: 0 } })).toBe(Infinity);
  });

  test('Norm of a complex is its modulus on GLSL', () => {
    expect(compiled(['Norm', 'w'], { to: 'glsl' }).code).toMatch(/length\(/);
  });
});

describe('ND', () => {
  test('of a function literal is the interpreter value', () => {
    for (const body of [
      ['Sin', 't'],
      ['Multiply', 't', ['Exp', 't']],
      ['Abs', 't'],
      ['Divide', 1, 't'],
    ])
      expect(
        differences(
          ['ND', ['Function', body, 't'], 'x'],
          xs([-2, -0.5, 0, 0.7, 3]),
          1e-12
        )
      ).toEqual([]);
  });

  test('is the stencil of the runtime', () => {
    expect(compiled(['ND', ['Function', ['Sin', 't'], 't'], 'x']).code).toMatch(
      /_SYS\.nd\(/
    );
  });
});

describe('Limit', () => {
  test.each([
    [
      'sin(t)/t at 0',
      ['Limit', ['Function', ['Divide', ['Sin', 't'], 't'], 't'], 0],
    ],
    [
      'a one-sided limit at a jump',
      ['Limit', ['Function', ['Divide', ['Abs', 't'], 't'], 't'], 0, -1],
    ],
    [
      'a limit at infinity',
      [
        'Limit',
        ['Function', ['Power', ['Add', 1, ['Divide', 1, 't']], 't'], 't'],
        'PositiveInfinity',
      ],
    ],
  ])('a closed limit is the interpreter value: %s', (_, json) => {
    const r = compiled(['Add', 'x', json]);
    expect(r.code).not.toMatch(/limit/);
    expect(differences(['Add', 'x', json], xs([0, 1.5]), 1e-15)).toEqual([]);
  });

  // The interpreter computes a symbolic limit at each point first; the
  // numeric limit of a run-time kernel is NaN at a jump near the point
  // (CE-1232: `|t|/t` from below at 0.5 is 1).
  test.each([
    [
      'a point that is an input',
      ['Limit', ['Function', ['Divide', ['Abs', 't'], 't'], 't'], 'a', -1],
      /a limit that is not closed/,
    ],
    [
      'a body that reads an input',
      [
        'Limit',
        ['Function', ['Divide', ['Sin', ['Multiply', 't', 'x']], 't'], 't'],
        0,
      ],
      /a limit that is not closed/,
    ],
    [
      'a limit with no value',
      ['Limit', ['Function', ['Sin', ['Divide', 1, 't']], 't'], 0],
      /a limit with no real value/,
    ],
  ])('declines: %s', (_, json, cause) => {
    expect(decline(json)).toMatch(cause);
  });

  test('declines in the interval mode', () => {
    expect(
      decline(['Limit', ['Function', ['Divide', ['Sin', 't'], 't'], 't'], 0], {
        to: 'interval-js',
      })
    ).toMatch(/a limit in the interval mode/);
  });
});

describe('EvaluateAt', () => {
  const sin = ['Function', ['Sin', 't'], 't'];
  test.each([
    ['at a point', ['EvaluateAt', sin, 'x']],
    ['between two bounds', ['EvaluateAt', sin, 'x', 'y']],
    [
      'of a polynomial',
      ['EvaluateAt', ['Function', ['Power', 't', 3], 't'], 'y', 'x'],
    ],
  ])('%s is the interpreter value', (_, json) => {
    expect(differences(json, grid([-1, 0, 0.7], [0.5, 2]), 1e-15)).toEqual([]);
  });

  test('over a list', () => {
    expect(
      differences(
        ['EvaluateAt', ['Function', ['Multiply', 2, 't'], 't'], 'L'],
        [{ L: [1, -2, 0] }]
      )
    ).toEqual([]);
  });

  test('encloses the interpreter value in the interval mode', () => {
    const run = compiled(['EvaluateAt', sin, 'x', 'y'], { to: 'interval-js' })
      .run as unknown as (p: Point) => { value: { lo: number; hi: number } };
    for (const [x, y] of [
      [0.7, 1.3],
      [-1, 2],
    ]) {
      const { lo, hi } = run({ x, y }).value;
      const want = Math.sin(y) - Math.sin(x);
      expect([x, y, lo <= want && want <= hi]).toEqual([x, y, true]);
    }
  });

  // prettier-ignore
  test.each([
    ['no point', ['EvaluateAt', sin]],
    ['two parameters at one point', ['EvaluateAt', ['Function', ['Multiply', 't', 'u'], 't', 'u'], 'x']],
    ['an effect between two bounds', ['EvaluateAt', ['Function', ['Add', 't', ['Random']], 't'], 'x', 'y']],
  ])('declines: %s', (_, json) => {
    expect(decline(json)).toMatch(/EvaluateAt of a value that is not a function literal of one parameter/);
  });
});

describe('Argument of a real in the interval mode', () => {
  test('encloses the interpreter value', () => {
    const run = compiled(['Argument', 'x'], { to: 'interval-js' })
      .run as unknown as (p: Point) => { value: { lo: number; hi: number } };
    for (const x of [-2, -0.5, 0, 0.5, 3]) {
      const want = (interpret(['Argument', 'x'], { x }) as Cx).re;
      const { lo, hi } = run({ x }).value;
      expect([x, lo <= want && want <= hi]).toEqual([x, true]);
    }
  });

  test('of a list', () => {
    const run = compiled(['Arg', 'L'], { to: 'interval-js' })
      .run as unknown as (p: Point) => { value: { lo: number; hi: number } }[];
    const values = run({ L: [1, -2, 0] }).map(({ value }) => value);
    expect(values.map(({ lo, hi }) => lo <= Math.PI && Math.PI <= hi)).toEqual([
      false,
      true,
      false,
    ]);
    expect(values.map(({ lo, hi }) => lo <= 0 && 0 <= hi)).toEqual([
      true,
      false,
      true,
    ]);
  });
});

describe('a target with no spelling declines', () => {
  // prettier-ignore
  test.each([
    ['HarmonicNumber in the interval mode', ['HarmonicNumber', 'x'], 'interval-js', /the operation harmonic/],
    ['Gamma of two operands on GLSL', ['Gamma', 'x', 'y'], 'glsl', /the operation gammaupper/],
    ['ND on GLSL', ['ND', ['Function', ['Sin', 't'], 't'], 'x'], 'glsl', /ND on another target than javascript/],
  ])('%s', (_, json, to, cause) => {
    expect(decline(json, { to })).toMatch(cause);
  });

  // `Zeta(s, a)` has a GLSL spelling since CE-1534
  // (`ce-1534-glsl-complex-and-zeta.test.ts` checks its values).
  test('Zeta of two operands compiles on GLSL', () => {
    expect(decline(['Zeta', 'x', 'y'], { to: 'glsl' })).toBeUndefined();
  });

  // `HarmonicNumber` has a GLSL spelling (`ir-glsl-harmonic.test.ts` checks
  // its values).
  test('HarmonicNumber compiles on GLSL', () => {
    expect(decline(['HarmonicNumber', 'x'], { to: 'glsl' })).toBeUndefined();
    expect(decline(['HarmonicNumber', 'x', 'y'], { to: 'glsl' })).toBeUndefined();
  });
});
