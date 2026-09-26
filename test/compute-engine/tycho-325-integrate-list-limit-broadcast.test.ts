import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { getPolynomialCoefficients } from '../../src/compute-engine/boxed-expression/polynomials';

// Tycho item 325. The normal cumulative distribution function written as an
// improper integral,
//   E(x) = 1/(√(2π)·s) · ∫_{−∞}^{x} exp(−½·Z²/s²) dZ,   s = 0.577,
// applied to a LIST of numbers. The interpreter answered non-finite elements
// while the compiled `javascript` target answered the right values.
//
// The cause was the antiderivative: the Gaussian rule `∫ e^{a·Z² + b·Z + c}`
// reads the exponent's polynomial coefficients, and the coefficient
// extraction rejected a quotient by a factor free of `Z` (`Z²/s²`, and
// `Z²/0.577²`, which canonicalization keeps as a `Divide` because the
// denominator is a float). So `evaluate()` left every element as a symbolic
// `Integrate`, whose `.re` is `NaN`, and tried the whole antiderivative
// search again for each element.
//
// The reference values are Φ(x/s) = ½·(1 + erf(x/(s·√2))), computed with an
// independent erf (Python `math.erf`), and they agree with the compiled route
// (checked below).

const BODY =
  'x \\mapsto \\frac{1}{\\sqrt{2\\pi}s}\\int_{-\\infty}^{x}\\exp(-\\frac{1}{2}\\frac{Z^2}{s^2})\\,\\mathrm{d}Z';
const INLINE =
  '\\frac{1}{\\sqrt{2\\pi}s}\\int_{-\\infty}^{G}\\exp(-\\frac{1}{2}\\frac{Z^2}{s^2})\\,\\mathrm{d}Z';

const EXPECTED: Record<string, number> = {
  '-1': 0.04153874799618801,
  '0': 0.5,
  '1': 0.958461252003812,
};
const EXPECTED_LIST = [EXPECTED['-1'], EXPECTED['0'], EXPECTED['1']];

function engineWithE(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('E', { type: '(number) -> number' } as any);
  ce.assign('E', ce.parse(BODY));
  return ce;
}

function values(expr: Expression): number[] {
  const result: number[] = [];
  for (const el of expr.each()) result.push(el.re);
  return result;
}

function expectCdf(actual: number[], expected: number[] = EXPECTED_LIST) {
  expect(actual).toHaveLength(expected.length);
  for (let i = 0; i < expected.length; i++) {
    expect(Number.isFinite(actual[i])).toBe(true);
    expect(Math.abs(actual[i] - expected[i])).toBeLessThan(1e-3);
  }
}

describe('Tycho 325: scalar E(x)', () => {
  test('E(0).N() is 0.5', () => {
    const ce = engineWithE();
    ce.assign('s', 0.577);
    expect(ce.parse('E(0)').N().re).toBeCloseTo(0.5, 10);
  });

  test('E(x).evaluate() is finite: the Gaussian antiderivative closes', () => {
    const ce = engineWithE();
    ce.assign('s', 0.577);
    for (const x of [-1, 0, 1]) {
      const v = ce.box(['E', x]).evaluate();
      expect(Math.abs(v.re - EXPECTED[String(x)])).toBeLessThan(1e-9);
    }
  });
});

describe('Tycho 325: E(G) over a list argument', () => {
  test('G assigned [-1, 0, 1]: evaluate() and N()', () => {
    const ce = engineWithE();
    ce.assign('s', 0.577);
    ce.assign('G', ce.parse('[-1, 0, 1]'));
    expectCdf(values(ce.parse('E(G)').evaluate()));
    expectCdf(values(ce.parse('E(G)').N()));
  });

  test('G declared list<number>, then substituted', () => {
    const ce = engineWithE();
    ce.assign('s', 0.577);
    ce.declare('G', 'list<number>');
    const expr = ce.parse('E(G)');
    const G = ce.parse('[-1, 0, 1]');
    expectCdf(values(expr.subs({ G }).evaluate()));
    expectCdf(values(expr.subs({ G }).N()));
  });

  test('agrees with the compiled javascript route', () => {
    const ce = engineWithE();
    ce.declare('s', 'real');
    ce.declare('G', 'list<number>');
    const r = compile(ce.parse('E(G)'), { to: 'javascript' } as never) as any;
    expect(r.success).toBe(true);
    const compiled = r.run({ G: [-1, 0, 1], s: 0.577 }) as number[];
    expectCdf(compiled);

    const ce2 = engineWithE();
    ce2.assign('s', 0.577);
    ce2.assign('G', ce2.parse('[-1, 0, 1]'));
    const interpreted = values(ce2.parse('E(G)').evaluate());
    for (let i = 0; i < 3; i++)
      expect(Math.abs(interpreted[i] - compiled[i])).toBeLessThan(1e-9);
  });

  test(
    'a list long enough to broadcast as a lazy Map (128 elements)',
    () => {
      const ce = engineWithE();
      ce.assign('s', 0.577);
      const xs = Array.from({ length: 128 }, (_, i) => -1.5 + (3 * i) / 127);
      ce.assign('G', ce.box(['List', ...xs]));
      const result = values(ce.parse('E(G)').evaluate());
      expect(result).toHaveLength(128);
      expect(result.every((v) => Number.isFinite(v))).toBe(true);
      // Monotone increasing, from Φ(−1.5/s) ≈ 0.0047 to Φ(1.5/s) ≈ 0.9953.
      for (let i = 1; i < result.length; i++)
        expect(result[i]).toBeGreaterThan(result[i - 1]);
      expect(Math.abs(result[0] - 0.004665898280694821)).toBeLessThan(1e-6);
      expect(Math.abs(result[127] - 0.9953341017193051)).toBeLessThan(1e-6);
    },
    60_000
  );
});

describe('Tycho 325: an integral with a list upper limit', () => {
  test('evaluate() and N() both answer a list', () => {
    const ce = new ComputeEngine();
    ce.assign('s', 0.577);
    ce.assign('G', ce.parse('[-1, 0, 1]'));
    const expr = ce.parse(INLINE);
    expect(expr.type.toString()).toBe('list<number>');
    expectCdf(values(expr.evaluate()));
    // Before the fix, `.N()` read the list bound as `NaN` and stayed inert.
    const n = expr.N();
    expect(n.operator).toBe('List');
    expectCdf(values(n));
  });

  test('a list bound substituted into a declared list<number>', () => {
    const ce = new ComputeEngine();
    ce.assign('s', 0.577);
    ce.declare('G', 'list<number>');
    const expr = ce.parse(INLINE);
    expect(expr.type.toString()).toBe('list<number>');
    expectCdf(values(expr.subs({ G: ce.parse('[-1, 0, 1]') }).N()));
  });

  test('a scalar-bound integral still types as a number', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\int_0^1 x\\,\\mathrm{d}x').type.toString()).toBe(
      'number'
    );
    expect(
      ce.parse('\\int_0^{[1, 2]} x\\,\\mathrm{d}x').N().operator
    ).toBe('List');
  });
});

describe('Tycho 325: a multiple integral with a list bound', () => {
  // ∫_0^1 ∫_0^{g} x·y dx dy = g²/4, one complete double integral per element.
  test('one list bound: one double integral per element', () => {
    const ce = new ComputeEngine();
    ce.assign('G', ce.parse('[1, 2, 3]'));
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, 'G'],
      ['Limits', 'y', 0, 1],
    ]);
    expect(expr.type.toString()).toBe('list<number>');
    expect(expr.evaluate().json).toEqual([
      'List',
      ['Rational', 1, 4],
      1,
      ['Rational', 9, 4],
    ]);
    const n = expr.N();
    expect(n.operator).toBe('List');
    const got = values(n);
    const want = [0.25, 1, 2.25];
    expect(got).toHaveLength(3);
    for (let i = 0; i < 3; i++)
      expect(Math.abs(got[i] - want[i])).toBeLessThan(1e-9);
  });

  test('two list bounds of equal length are paired element by element', () => {
    const ce = new ComputeEngine();
    // ∫_0^{h} ∫_0^{g} x·y dx dy = g²·h²/4
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, ['List', 1, 2]],
      ['Limits', 'y', 0, ['List', 2, 1]],
    ]);
    expect(expr.type.toString()).toBe('list<number>');
    const got = values(expr.N());
    expect(got).toHaveLength(2);
    expect(Math.abs(got[0] - 1)).toBeLessThan(1e-9);
    expect(Math.abs(got[1] - 1)).toBeLessThan(1e-9);
  });

  test('two list bounds of different lengths stay unevaluated under N()', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, ['List', 1, 2]],
      ['Limits', 'y', 0, ['List', 1, 2, 3]],
    ]);
    expect(expr.N().operator).toBe('Integrate');
  });

  test('scalar bounds still type as a number', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Integrate',
      ['Multiply', 'x', 'y'],
      ['Limits', 'x', 0, 1],
      ['Limits', 'y', 0, 1],
    ]);
    expect(expr.type.toString()).toBe('number');
    expect(Math.abs(expr.N().re - 0.25)).toBeLessThan(1e-9);
  });
});

describe('Tycho 325: Map(E, G)', () => {
  test('each element is the CDF value', () => {
    const ce = engineWithE();
    ce.assign('s', 0.577);
    ce.assign('G', ce.parse('[-1, 0, 1]'));
    expectCdf(values(ce.parse('\\operatorname{Map}(E, G)').evaluate()));
    expectCdf(values(ce.parse('\\operatorname{Map}(E, G)').N()));
  });
});

describe('Tycho 325: s assigned in a child scope', () => {
  test('ce.pushScope(); ce.assign(s, 0.577)', () => {
    const ce = engineWithE();
    ce.assign('G', ce.parse('[-1, 0, 1]'));
    ce.pushScope();
    try {
      ce.assign('s', 0.577);
      expect(ce.parse('E(0)').N().re).toBeCloseTo(0.5, 10);
      expectCdf(values(ce.parse('E(G)').evaluate()));
      expectCdf(values(ce.parse('E(G)').N()));
      expectCdf(values(ce.parse(INLINE).N()));
      expectCdf(values(ce.parse('\\operatorname{Map}(E, G)').evaluate()));
    } finally {
      ce.popScope();
    }
  });
});

describe('Tycho 325: the pieces of the fix', () => {
  test('polynomial coefficients of a quotient by a factor free of the variable', () => {
    const ce = new ComputeEngine();
    const coeffs = (latex: string) =>
      getPolynomialCoefficients(ce.parse(latex), 'Z')?.map((c) =>
        c.N().re
      );
    // −½·Z²/0.577² = −1.50182…·Z²
    const a = coeffs('-\\frac{1}{2}\\frac{Z^2}{0.577^2}')!;
    expect(a[0]).toBe(0);
    expect(a[1]).toBe(0);
    expect(a[2]).toBeCloseTo(-0.5 / 0.577 ** 2, 12);
    // (Z² + 3Z)/0.5 = 2Z² + 6Z
    expect(coeffs('\\frac{Z^2+3Z}{0.5}')).toEqual([0, 6, 2]);
    // A denominator that depends on the variable is not a polynomial.
    expect(coeffs('\\frac{1}{Z}')).toBeUndefined();
  });

  test('the Gaussian antiderivative with a float or valued-symbol coefficient', () => {
    const ce = new ComputeEngine();
    ce.assign('s', 0.577);
    // ∫_{−∞}^{0} e^{−Z²/(2s²)} dZ = s·√(π/2) ≈ 0.72316
    const expected = 0.577 * Math.sqrt(Math.PI / 2);
    for (const latex of [
      '\\int_{-\\infty}^{0}\\exp(-\\frac{1}{2}\\frac{Z^2}{0.577^2})\\,\\mathrm{d}Z',
      '\\int_{-\\infty}^{0}\\exp(-\\frac{1}{2}\\frac{Z^2}{s^2})\\,\\mathrm{d}Z',
    ]) {
      const v = ce.parse(latex).evaluate();
      expect(Math.abs(v.re - expected)).toBeLessThan(1e-12);
    }
    // A coefficient with no value keeps the integral symbolic: the sign of
    // the coefficient chooses between Erf and Erfi.
    expect(
      ce
        .parse('\\int \\exp(-\\frac{Z^2}{a^2})\\,\\mathrm{d}Z')
        .evaluate()
        .has('Integrate')
    ).toBe(true);
  });

  test('N() of a scalar times a list of Measurements folds every cell', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Multiply',
        0.5,
        ['List', ['Measurement', 2, 0.1], ['Measurement', 3, 0.1]],
      ])
      .N();
    expect(r.json).toEqual([
      'List',
      ['Measurement', 1, 0.05],
      ['Measurement', 1.5, 0.05],
    ]);
  });
});
