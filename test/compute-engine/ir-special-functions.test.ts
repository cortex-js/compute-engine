/**
 * The special functions and steps of the library on JavaScript: each row
 * calls the interpreter's kernel (`REAL_FUNCTIONS`, `_SYS.ir.<op>`), so the
 * compiled value is the interpreter's (`N()`, at the default precision)
 * within the error of the double kernel. Where the interpreter's value of
 * real operands is not real, the real lane gives NaN, and `mode: 'complex'`
 * the interpreter's complex value (`COMPLEX_FUNCTIONS`) or a decline. A pole
 * is ±∞, also where the interpreter gives the unsigned `~oo`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

const ce = new ComputeEngine();
for (const v of ['x', 'y', 'z']) ce.declare(v, 'real');
for (const v of ['n', 'm']) ce.declare(v, 'integer');

type Json = unknown;
type Point = Record<string, number>;
type Run = (inputs: Point) => unknown;

/** The double `v` as an exact rational: a decimal is not the double that
 *  compiled code reads. */
function exact(v: number) {
  if (!Number.isFinite(v) || Number.isInteger(v) || Math.abs(v) < 1e-6)
    return ce.number(v);
  let k = 0;
  while (!Number.isInteger(v * 2 ** k)) k++;
  return ce.number([BigInt(v * 2 ** k), 2n ** BigInt(k)] as never);
}

/** The interpreter's value of `json` at `p`: `{ re, im }`, a boolean as 1
 *  or 0. */
function interpret(json: Json, p: Point): { re: number; im: number } {
  const subs = Object.fromEntries(
    Object.entries(p).map(([k, v]) => [k, exact(v)])
  );
  const r = ce
    .box(json as never)
    .subs(subs)
    .N();
  if (r.symbol === 'True') return { re: 1, im: 0 };
  if (r.symbol === 'False') return { re: 0, im: 0 };
  return { re: r.re, im: r.im ?? 0 };
}

function run(json: Json, options: object = {}): Run {
  const r = compile(ce.box(json as never), {
    fallback: false,
    ...options,
  } as never);
  return r.run as unknown as Run;
}

/** The differences between the compiled value and the interpreter's at
 *  each point: none expected. */
function differences(json: Json, points: Point[], tolerance: number) {
  const f = run(json);
  const out: string[] = [];
  for (const p of points) {
    const want = interpret(json, p);
    const v = f(p);
    const got = typeof v === 'boolean' ? (v ? 1 : 0) : (v as number);
    const at = JSON.stringify(p);
    if (want.im !== 0 && Number.isFinite(want.re) && Number.isFinite(want.im)) {
      // Not real: NaN on the real lane.
      if (!Number.isNaN(got)) out.push(`${at}: ${got}, interpreter complex`);
    } else if (want.im !== 0 || Number.isNaN(want.re)) {
      // `~oo` (a pole: ±∞ or NaN), or no value (NaN).
      if (!Number.isNaN(got) && (want.im === 0 || Number.isFinite(got)))
        out.push(`${at}: ${got}, interpreter ${want.re} + ${want.im}i`);
    } else if (!Number.isFinite(want.re)) {
      if (got !== want.re) out.push(`${at}: ${got}, interpreter ${want.re}`);
    } else if (
      !(Math.abs(got - want.re) <= tolerance * Math.max(1, Math.abs(want.re)))
    )
      out.push(`${at}: ${got}, interpreter ${want.re}`);
  }
  return out;
}

const xs = (values: number[]) => values.map((x) => ({ x }));
const grid = (a: string, as: number[], b: string, bs: number[]) =>
  as.flatMap((u) => bs.map((v) => ({ [a]: u, [b]: v })));

// prettier-ignore
const REALS = [-10.5, -3.7, -2.5, -2, -1, -0.5, -1e-8, 0, 1e-8, 0.1, 0.5, 1, 1.5, 2, 2.5, 3.7, 7.25, 10, 30.5];
// prettier-ignore
const UNIT = [-2, -1, -0.99, -0.5, -0.1, 0, 1e-9, 0.1, 0.5, 0.9, 0.99, 0.999999, 1, 1.0001];
const PARAMETER = [-5, -1, 0, 0.1, 0.5, 0.9, 0.999, 1, 1.5, 5];

// prettier-ignore
const CASES: [name: string, json: Json, points: Point[], tolerance?: number][] = [
  ['Heaviside', ['Heaviside', 'x'], xs(REALS)],
  ['Remainder of reals', ['Remainder', 'x', 'y'], grid('x', [7, -7, 7.5, -7.5, 0, 5, -9, 1e20, 3.25], 'y', [3, -3, 2, -2, 4, 2.5, 0.75])],
  ['Remainder of integers', ['Remainder', 'n', 'm'], grid('n', [7, -7, 0, 9, -9, 10], 'm', [3, -3, 2, 4, -4])],
  ['Smoothstep', ['Smoothstep', 'x', 'y', 'z'], [[0, 1, 0.5], [0, 1, -1], [0, 1, 2], [1, 0, 0.3], [2, 2, 1], [2, 2, 3], [-1, 3, 0.7]].map(([x, y, z]) => ({ x, y, z }))],
  ['InverseHaversine', ['InverseHaversine', 'x'], xs(UNIT), 1e-13],
  ['ErfInv', ['ErfInv', 'x'], xs(UNIT)],
  ['Erfi', ['Erfi', 'x'], xs(REALS)],
  ['Beta', ['Beta', 'x', 'y'], grid('x', [0.5, 1, 2, 3.5, -0.5, -1.5, 10], 'y', [0.5, 1, 2, 5, -2.5])],
  ['BetaRegularized', ['BetaRegularized', 'x', 'y', 'z'], [[0.3, 2, 3], [0.5, 0.5, 0.5], [0.9, 5, 1], [0, 2, 2], [1, 2, 2], [0.2, 10, 3], [1.5, 2, 2]].map(([x, y, z]) => ({ x, y, z }))],
  ['GammaRegularized', ['GammaRegularized', 'x', 'y'], grid('x', [-0.5, 0.5, 1, 2, 5.5, 10], 'y', [0, 0.1, 1, 3, 10, 30])],
  ['Digamma', ['Digamma', 'x'], xs(REALS)],
  ['Trigamma', ['Trigamma', 'x'], xs(REALS)],
  ['PolyGamma', ['PolyGamma', 'n', 'x'], grid('n', [-1, 0, 1, 2, 3], 'x', [-2.5, -1, 0.5, 1, 2, 7.25])],
  ['AiryAi', ['AiryAi', 'x'], xs(REALS)],
  ['AiryBi', ['AiryBi', 'x'], xs(REALS)],
  ['AiryAiPrime', ['AiryAiPrime', 'x'], xs(REALS)],
  ['AiryBiPrime', ['AiryBiPrime', 'x'], xs(REALS)],
  ['BesselJ', ['BesselJ', 'n', 'x'], grid('n', [0, 1, 2, -1, 5], 'x', [-2.5, 0, 0.1, 1, 2.5, 5, 10, 30.5])],
  ['BesselY', ['BesselY', 'n', 'x'], grid('n', [0, 1, 2, -1], 'x', [-2.5, 0, 0.1, 1, 2.5, 5, 10, 30.5])],
  ['BesselI', ['BesselI', 'n', 'x'], grid('n', [0, 1, 2, -1], 'x', [-2.5, 0, 0.1, 1, 2.5, 5, 10])],
  ['BesselK', ['BesselK', 'n', 'x'], grid('n', [0, 1, 2, -1], 'x', [-2.5, 0, 0.1, 1, 2.5, 5, 10])],
  ['SinIntegral', ['SinIntegral', 'x'], xs(REALS)],
  ['CosIntegral', ['CosIntegral', 'x'], xs(REALS)],
  ['ExpIntegralEi', ['ExpIntegralEi', 'x'], xs(REALS)],
  ['LogIntegral', ['LogIntegral', 'x'], xs([-1, 0, 1e-8, 0.001, 0.1, 0.5, 0.9, 1, 1.1, 2, 2.5, 10, 100, 700])],
  ['AGM of one operand', ['AGM', 'x'], xs([-2, 0, 0.5, 1, 2, 10])],
  ['AGM', ['AGM', 'x', 'y'], grid('x', [1, 2, 0.5, 0, -1, 10], 'y', [1, 2, 10, 0, -3])],
  ['EllipticK', ['EllipticK', 'x'], xs(PARAMETER)],
  ['EllipticE', ['EllipticE', 'x'], xs(PARAMETER), 1e-12],
  ['EllipticE incomplete', ['EllipticE', 'x', 'y'], grid('x', [0, 0.5, 1, 2, -1, 4], 'y', [-1, 0, 0.5, 0.9, 1, 2]), 1e-12],
  ['EllipticF', ['EllipticF', 'x', 'y'], grid('x', [0, 0.5, 1, 2, -1, 4], 'y', [-1, 0, 0.5, 0.9, 1, 2])],
  ['EllipticPi', ['EllipticPi', 'x', 'y'], grid('x', [-1, 0, 0.3, 0.9, 1, 2], 'y', [-1, 0, 0.5, 0.9, 1, 2])],
  ['EllipticPi incomplete', ['EllipticPi', 'x', 'y', 'z'], [[0.3, 0.5, 0.5], [0, 1, 0.5], [-1, 1, 0.9], [0.5, 2, 0.2], [2, 1, 0.5], [0.3, -1, 0.5], [2, 0.5, 0.5]].map(([x, y, z]) => ({ x, y, z }))],
  ['Hypergeometric1F1', ['Hypergeometric1F1', 'x', 'y', 'z'], [[1, 2, 0], [1, 2, 0.5], [1, 2, -1], [1, 2, 3], [0.5, 1.5, -10], [-2, 3, 5], [2, 3, 30], [1, -0.5, 1]].map(([x, y, z]) => ({ x, y, z }))],
  ['Hypergeometric2F1', ['Hypergeometric2F1', 1, 2, 3, 'x'], xs([-5, -0.5, 0, 0.25, 0.5, 0.99, 1, 1.5]), 1e-13],
  ['HurwitzZeta', ['HurwitzZeta', 'x', 'y'], grid('x', [2, 3, 1.5, 0.5, -1, 1], 'y', [0.5, 1, 2, 7.25, -0.5])],
  ['LerchPhi', ['LerchPhi', 'x', 'y', 'z'], [[0.5, 2, 1], [0.5, 1, 1], [-1, 2, 1], [0.9, 3, 0.5], [2, 2, 1], [0.3, -1, 2], [0.5, 2, -0.5], [0.5, 1.5, -2.5]].map(([x, y, z]) => ({ x, y, z }))],
  ['PolyLog', ['PolyLog', 'x', 'y'], grid('x', [2, 3, 1, 0, -1, 0.5], 'y', [-2, -0.5, 0, 0.5, 0.99, 2]), 1e-13],
  ['DirichletEta', ['DirichletEta', 'x'], xs(REALS)],
  ['DirichletBeta', ['DirichletBeta', 'x'], xs(REALS)],
  ['StieltjesGamma', ['StieltjesGamma', 'n'], [0, 1, 2, 3, 5, 10].map((n) => ({ n }))],
  ['StieltjesGamma of two operands', ['StieltjesGamma', 'n', 'x'], grid('n', [0, 1, 2], 'x', [0.5, 1, 2, -0.5])],
  ['ClausenCl', ['ClausenCl', 'n', 'x'], grid('n', [1, 2, 3, 4], 'x', [-3, -1, 0, 0.5, 1, 3, 10]), 1e-13],
  ['LambertW', ['LambertW', 'x'], xs([-0.5, -0.36787944117144233, -0.3, -0.2, 0, 0.5, 1, 2, 10, 1e10])],
  ['LambertW of a branch', ['LambertW', 'x', 'n'], grid('x', [-0.3, -0.1, 0.5, 2], 'n', [-1, 0, 1])],
  ['ChebyshevT', ['ChebyshevT', 'n', 'x'], grid('n', [0, 1, 2, 3, 7, 20, -1, -3], 'x', [-2.5, -1, -0.5, 0, 0.3, 1, 1.5, 10])],
  ['ChebyshevU', ['ChebyshevU', 'n', 'x'], grid('n', [0, 1, 2, 5, 20, -1, -2, -5], 'x', [-2.5, -1, -0.5, 0, 0.3, 1, 1.5, 10])],
  ['LegendreP', ['LegendreP', 'n', 'x'], grid('n', [0, 1, 2, 5, 20, -1, -4], 'x', [-2.5, -1, -0.5, 0, 0.3, 1, 1.5, 10])],
  // A negative degree has no value: NaN, the interpreter is unevaluated.
  ['HermiteH', ['HermiteH', 'n', 'x'], grid('n', [0, 1, 2, 5, 20, -1], 'x', [-2.5, -1, -0.5, 0, 0.3, 1, 1.5, 10])],
  ['LaguerreL', ['LaguerreL', 'n', 'x'], grid('n', [0, 1, 2, 5, 20, -2], 'x', [-2.5, -1, 0, 0.3, 1, 1.5, 10, 30.5])],
  ['Fibonacci', ['Fibonacci', 'n'], [0, 1, 2, 5, 10, 20, 50, 78, 79, 100, 500, 1000, 1476, 1477, -1, -2, -7, -80].map((n) => ({ n })), 1e-14],
  ['IsPrime', ['IsPrime', 'n'], [0, 1, 2, 3, 4, 97, 91, -7, 1e15 + 37, 2 ** 53 + 2].map((n) => ({ n }))],
  ['Binomial of reals', ['Binomial', 'x', 'y'], grid('x', [5, 10, 7, 6, 20, 2.5, -3, 0.5, -2.5], 'y', [2, 3, 0, 6, 10, 1.5, -1, -2])],
  ['GCD of reals', ['GCD', 'x', 'y'], grid('x', [12, 7, 100, 9, 7.5, -12, 0.5, 2.5], 'y', [8, 3, 36, 81, 2, 0, 1.25])],
  ['LCM of integers', ['LCM', 'n', 'm'], grid('n', [12, 7, 4, -12, 0], 'm', [8, 3, 6, -4])],
  ['LCM of reals', ['LCM', 'x', 'y'], grid('x', [12, 7, 4, 7.5, -12, 0.5, 0], 'y', [8, 3, 6, 2, 1.25, -4])],
];

describe('special functions on JavaScript give the interpreter value', () => {
  test.each(CASES)('%s', (_, json, points, tolerance = 1e-14) => {
    expect(differences(json, points, tolerance)).toEqual([]);
  });

  test('a kernel is called by name', () => {
    const r = compile(ce.box(['BesselJ', 0, 'x']), { fallback: false });
    expect(r.code).toContain('_SYS.ir.besselj(0, _.x)');
  });

  test('a closed node is the interpreter value', () => {
    const r = compile(ce.box(['SinIntegral', 3]), { fallback: false });
    expect(r.code).not.toContain('sinint');
    expect((r.run as unknown as () => number)()).toBe(
      interpret(['SinIntegral', 3], {}).re
    );
  });

  test('the bigint mode spells Remainder and Fibonacci of integers', () => {
    const rem = run(['Remainder', 'n', 'm'], { mode: 'bigint' });
    expect(rem({ n: 7, m: 2 })).toBe(-1n);
    // A tie rounds the quotient toward +∞: 4.5 is 5.
    expect(rem({ n: 9, m: 2 })).toBe(-1n);
    expect(rem({ n: 10, m: 4 })).toBe(-2n);
    expect(rem({ n: -7, m: 2 })).toBe(-1n);
    const fib = run(['Fibonacci', 'n'], { mode: 'bigint' });
    expect(fib({ n: 100 })).toBe(354224848179261915075n);
    expect(fib({ n: -8 })).toBe(-21n);
  });
});

describe('a form the kernels do not cover declines', () => {
  function declines(json: Json, options: object = {}) {
    try {
      run(json, options);
    } catch (e) {
      return (e as { diagnostic?: { code: string; message: string } })
        .diagnostic;
    }
    return undefined;
  }

  // prettier-ignore
  test.each([
    // A real order: the kernels are NaN there, the interpreter is not.
    ['BesselJ of a real order', ['BesselJ', 'x', 'y'], {}],
    ['Fibonacci of a polynomial', ['Fibonacci', 'n', 'x'], {}],
    ['HurwitzZeta of three operands', ['HurwitzZeta', 'x', 'y', 'n'], {}],
    // Complex values of real operands with no complex kernel.
    ['CosIntegral, complex mode', ['CosIntegral', 'x'], { mode: 'complex' }],
    ['BesselY, complex mode', ['BesselY', 1, 'x'], { mode: 'complex' }],
    ['AGM, complex mode', ['AGM', 'x', 'y'], { mode: 'complex' }],
    ['EllipticF, complex mode', ['EllipticF', 'x', 'y'], { mode: 'complex' }],
  ])('%s', (_, json, options) => {
    expect(declines(json, options)?.code).toBe('outside-profile');
  });

  test.each(['javascript', 'glsl', 'interval-js'])(
    'Equal of one operand on %s',
    (to) => {
      const d = declines(['Equal', 'x'], { to });
      expect(d?.message).toMatch(/Equal with 1 operands/);
    }
  );
});

describe('the complex mode gives the interpreter complex value', () => {
  // prettier-ignore
  test.each([
    ['InverseHaversine', ['InverseHaversine', 'x'], [-1, 0.5, 2]],
    ['EllipticK', ['EllipticK', 'x'], [0.5, 2, -1]],
    ['EllipticE', ['EllipticE', 'x'], [0.5, 2, -1]],
    ['Hypergeometric2F1', ['Hypergeometric2F1', 1, 2, 3, 'x'], [0.5, 1.5, 3]],
    ['HurwitzZeta', ['HurwitzZeta', 2, 'x'], [0.5, -0.5, -1.5]],
    ['LerchPhi', ['LerchPhi', 'x', 2, 1], [0.5, 2]],
    ['PolyLog', ['PolyLog', 2, 'x'], [0.5, 2, 3]],
    ['LambertW', ['LambertW', 'x'], [1, -0.5, -2]],
  ])('%s', (_, json, values) => {
    const f = run(json, { mode: 'complex' });
    for (const x of values) {
      const want = interpret(json, { x });
      // A value with no imaginary part is a number.
      const v = f({ x }) as number | { re: number; im: number };
      const got = typeof v === 'number' ? { re: v, im: 0 } : v;
      // `EllipticE(2)` differs by 1.1e-13.
      expect(Math.abs(got.re - want.re)).toBeLessThan(1e-12);
      expect(Math.abs(got.im - want.im)).toBeLessThan(1e-12);
    }
  });
});
