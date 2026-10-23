import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { divergentTailSign } from '../../src/compute-engine/numerics/divergent-tail';

// ROADMAP CE-391. An integral that diverges on an infinite tail, with an
// integrand of one sign, is `+∞` or `−∞` under `.N()` and `NIntegrate`, as
// under `evaluate()`. Before, `.N()` gave a Monte-Carlo `Measurement` that
// changed at each run for an integrand that overflows (`eˣ`), and `NaN` for
// a polynomial (`x`).

const ce = new ComputeEngine();

function routes(latex: string, lower: unknown, upper: unknown) {
  const body = ce.parse(latex).json;
  const integral = ce.box([
    'Integrate',
    body,
    ['Tuple', 'x', lower, upper],
  ] as any);
  return {
    evaluate: integral.evaluate().json,
    N: integral.N().json,
    NIntegrate: ce
      .box(['NIntegrate', ['Function', body, 'x'], lower, upper] as any)
      .evaluate().json,
  };
}

describe('a divergent integral over an infinite bound', () => {
  test.each([
    ['e^x', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x e^x', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x^2', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['-x', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['\\frac{1}{x}', 1, 'PositiveInfinity', 'PositiveInfinity'],
    ['\\frac{1}{\\sqrt{x}}', 1, 'PositiveInfinity', 'PositiveInfinity'],
    ['e^x', 'PositiveInfinity', 0, 'NegativeInfinity'],
    ['e^{-x}', 'NegativeInfinity', 0, 'PositiveInfinity'],
    ['x^2', 'NegativeInfinity', 'PositiveInfinity', 'PositiveInfinity'],
  ])('∫ %s from %s to %s is %s on every route', (latex, lo, hi, expected) => {
    const r = routes(latex, lo, hi);
    expect(r.evaluate).toEqual(expected);
    expect(r.N).toEqual(expected);
    expect(r.NIntegrate).toEqual(expected);
  });

  test('an integrand whose sign changes keeps NaN', () => {
    // `x` over the whole line has no value, and `sin x` on [0, ∞) has none.
    expect(routes('x', 'NegativeInfinity', 'PositiveInfinity').N).toEqual(
      'NaN'
    );
    expect(routes('\\sin x', 0, 'PositiveInfinity').N).toEqual('NaN');
  });

  test('a convergent integral with a slowly decaying tail is a number', () => {
    const r = routes('x^{-1.01}', 1, 'PositiveInfinity');
    expect(r.NIntegrate as number).toBeCloseTo(100, 6);
    expect(routes('e^{-x}', 0, 'PositiveInfinity').NIntegrate).toBeCloseTo(
      1,
      10
    );
  });

  test('a tail whose sign changes past 10^20 is not given the sign of its start', () => {
    // `t·(1 − t/10²⁰)` is positive up to 10²⁰ and negative after it: the
    // integral is `−∞`, which the samples cannot decide from the start of
    // the tail alone, so no sign is given.
    expect(divergentTailSign((t) => t * (1 - t / 1e20), 0, Infinity)).toEqual(
      0
    );
    expect(divergentTailSign((t) => t, 0, Infinity)).toEqual(1);
    expect(divergentTailSign((t) => t, Infinity, 0)).toEqual(-1);
    expect(divergentTailSign((t) => t, Infinity, Infinity)).toEqual(0);
  });

  test('the compiled integral gives the same infinity', () => {
    const run = (latex: string): number => {
      const r = compile(ce.parse(latex));
      expect(r.success).toBe(true);
      return (r.run as () => number)();
    };
    expect(run('\\int_0^{\\infty} x\\, dx')).toBe(Infinity);
    expect(run('\\int_0^{\\infty} e^x\\, dx')).toBe(Infinity);
    expect(run('\\int_0^{\\infty} -x\\, dx')).toBe(-Infinity);
    expect(Number.isNaN(run('\\int_0^{\\infty} \\sin x\\, dx'))).toBe(true);
  });

  test.each([
    ['\\frac{x-1}{x^3}', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['-\\frac{1}{x^3}', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['\\frac{1}{x^3}', 'NegativeInfinity', 0, 'NegativeInfinity'],
    ['\\frac{1}{x^3}', 0, 'NegativeInfinity', 'PositiveInfinity'],
    ['-\\frac{1}{x^3}', 'PositiveInfinity', 0, 'PositiveInfinity'],
    ['\\frac{x-1}{x^2}', 0, 'PositiveInfinity', 'Indeterminate'],
  ])(
    'evaluate() of ∫ %s from %s to %s, a pole at the finite bound, is %s',
    (latex, lo, hi, expected) => {
      // ROADMAP CE-391.2: the antiderivative difference is `~∞` (a pole at
      // the finite bound), which was the answer. The sign of the pole and
      // the value of the antiderivative at the infinite bound decide it.
      expect(routes(latex as string, lo, hi).evaluate).toEqual(expected);
    }
  );

  test.each([
    ['x-1', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['1-x', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['\\frac{x-1}{x^3}', 0, 'PositiveInfinity', 'NegativeInfinity'],
    ['e^x - 5', 0, 'PositiveInfinity', 'PositiveInfinity'],
    ['x^2-1', 'NegativeInfinity', 'PositiveInfinity', 'PositiveInfinity'],
    ['\\frac{x-1}{x^2}', 0, 'PositiveInfinity', 'NaN'],
  ])(
    '.N() of ∫ %s from %s to %s, an integrand whose sign changes, is %s',
    (latex, lo, hi, expected) => {
      // ROADMAP CE-391.1: the numeric route found a divergence (or an
      // overflow) it could not sign, and gave `NaN` or a Monte-Carlo value.
      // The exact route decides it, as compiled code already did.
      const r = routes(latex as string, lo, hi);
      expect(r.N).toEqual(expected);
      expect(r.NIntegrate).toEqual(expected);
    }
  );

  test('an overflowing integrand with no sign is NaN, not a random value', () => {
    // `x sin x · e^x` changes sign forever and overflows: no value, and the
    // answer is the same at each run.
    const a = routes('x \\sin(x) e^x', 0, 'PositiveInfinity').N;
    const b = routes('x \\sin(x) e^x', 0, 'PositiveInfinity').N;
    expect(a).toEqual('NaN');
    expect(b).toEqual('NaN');
  });
});
