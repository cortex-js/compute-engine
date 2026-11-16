import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import * as DerivativeModule from '../../src/compute-engine/symbolic/derivative';

const ce = new ComputeEngine();

// `Series` of a function whose derivative is another function (`Arctan`, …)
// integrates the series of the derivative instead of differentiating the
// function W times, which was exponential in the order.

type Rat = [number, number];

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
const binomCentral = (m: number): number => {
  let r = 1;
  for (let i = 1; i <= m; i++) r = (r * (m + i)) / i;
  return Math.round(r);
};

/** Maclaurin coefficient of x^k as [numerator, denominator]. */
const MACLAURIN: Record<string, (k: number) => Rat> = {
  Arctan: (k) => (k % 2 ? [(-1) ** ((k - 1) / 2), k] : [0, 1]),
  Arcsin: (k) => {
    if (k % 2 === 0) return [0, 1];
    const m = (k - 1) / 2;
    return [binomCentral(m), 4 ** m * k];
  },
  Arsinh: (k) => {
    if (k % 2 === 0) return [0, 1];
    const m = (k - 1) / 2;
    return [(-1) ** m * binomCentral(m), 4 ** m * k];
  },
  Artanh: (k) => (k % 2 ? [1, k] : [0, 1]),
  Ln1p: (k) => (k === 0 ? [0, 1] : [(-1) ** (k + 1), k]),
};
const neg = ([n, d]: Rat): Rat => [-n, d];
MACLAURIN.Arccos = (k) => (k === 0 ? [0, 1] : neg(MACLAURIN.Arcsin(k)));
MACLAURIN.Arccot = (k) => (k === 0 ? [0, 1] : neg(MACLAURIN.Arctan(k)));

/** The truncated polynomial of order n, as MathJSON. */
function maclaurin(name: string, n: number): MathJsonExpression {
  const terms: MathJsonExpression[] = [];
  if (name === 'Arccos' || name === 'Arccot')
    terms.push(['Multiply', ['Rational', 1, 2], 'Pi']);
  for (let k = 0; k <= n; k++) {
    const [p, q] = MACLAURIN[name](k);
    if (p === 0) continue;
    const g = gcd(Math.abs(p), q);
    terms.push(['Multiply', ['Rational', p / g, q / g], ['Power', 'x', k]]);
  }
  return ['Add', ...terms];
}

function normalSeries(
  f: MathJsonExpression,
  x0: MathJsonExpression,
  n: number
) {
  return ce.box(['Normal', ['Series', f, 'x', x0, n]]).evaluate();
}

function expectSameAs(
  got: ReturnType<typeof normalSeries>,
  want: MathJsonExpression
) {
  const w = ce.box(want).evaluate();
  // On a failure, the message shows the result
  expect(got.isSame(w) ? 'same' : `${got.latex} is not ${w.latex}`).toBe(
    'same'
  );
}

describe('Series — functions whose derivative is another function', () => {
  const cases: [string, MathJsonExpression][] = [
    ['Arctan', ['Arctan', 'x']],
    ['Arcsin', ['Arcsin', 'x']],
    ['Arccos', ['Arccos', 'x']],
    ['Arccot', ['Arccot', 'x']],
    ['Arsinh', ['Arsinh', 'x']],
    ['Artanh', ['Artanh', 'x']],
    ['Ln1p', ['Ln', ['Add', 1, 'x']]],
  ];

  for (const n of [7, 11])
    for (const [name, f] of cases)
      test(`${name} at 0, order ${n}`, () => {
        expectSameAs(normalSeries(f, 0, n), maclaurin(name, n));
      });

  test('Series keeps its remainder', () => {
    expect(
      ce.box(['Series', ['Arctan', 'x'], 'x', 0, 7]).evaluate().latex
    ).toBe(
      'x-\\frac{x^3}{3}+\\frac{x^5}{5}-\\frac{x^7}{7}+O\\left(x^9\\right)'
    );
  });

  // The regression differentiates the function once per order; a count is
  // the same on every machine, unlike a time
  test('Arctan at order 11 differentiates once', () => {
    const fresh = new ComputeEngine();
    const spy = jest.spyOn(DerivativeModule, 'differentiate');
    try {
      const r = fresh.box(['Series', ['Arctan', 'x'], 'x', 0, 11]).evaluate();
      expect(r.operator).toBe('Add');
      expect(spy.mock.calls.length).toBe(1);
    } finally {
      spy.mockRestore();
    }
  });
});

// Values pinned from the derivative loop that this path replaces.
describe('Series — agrees with the derivative loop', () => {
  test('Arctan(2x + x^2) at 0, order 5', () => {
    const r = ce
      .box([
        'Series',
        ['Arctan', ['Add', ['Multiply', 2, 'x'], ['Power', 'x', 2]]],
        'x',
        0,
        5,
      ])
      .evaluate();
    expect(r.latex).toBe(
      '2x+x^2-\\frac{8x^3}{3}-4x^4+\\frac{22x^5}{5}+O\\left(x^6\\right)'
    );
  });

  test('Arctan at 1, order 5', () => {
    const r = ce.box(['Series', ['Arctan', 'x'], 'x', 1, 5]).evaluate();
    expect(r.latex).toBe(
      '\\frac{\\pi}{4}+\\frac{x-1}{2}-\\frac{(x-1)^2}{4}+\\frac{(x-1)^3}{12}-\\frac{(x-1)^5}{40}+O\\left((x-1)^6\\right)'
    );
  });

  test('Arcsin at 1/2, order 5', () => {
    const r = ce
      .box(['Series', ['Arcsin', 'x'], 'x', ['Rational', 1, 2], 5])
      .evaluate();
    expect(r.latex).toBe(
      '\\frac{\\pi}{6}+\\frac{1}{3}\\times2\\sqrt{3}(x-\\frac{1}{2})+\\frac{1}{9}\\times2\\sqrt{3}(x-\\frac{1}{2})^2+\\frac{1}{27}\\times8\\sqrt{3}(x-\\frac{1}{2})^3+\\frac{1}{81}\\times28\\sqrt{3}(x-\\frac{1}{2})^4+\\frac{1}{1\\,215}\\times608\\sqrt{3}(x-\\frac{1}{2})^5+O\\left((x-\\frac{1}{2})^6\\right)'
    );
  });

  // The constant term is the value of `Arccot` on its real range (0, π)
  // (CE-1334), and the integrated derivative stays on that branch.
  test('Arccot at -1, order 4', () => {
    const r = ce.box(['Series', ['Arccot', 'x'], 'x', -1, 4]).evaluate();
    expect(r.latex).toBe(
      '\\frac{3\\pi}{4}-\\frac{x+1}{2}-\\frac{(x+1)^2}{4}-\\frac{(x+1)^3}{12}+O\\left((x+1)^5\\right)'
    );
  });

  test('Ln at 2, order 4', () => {
    const r = ce.box(['Series', ['Ln', 'x'], 'x', 2, 4]).evaluate();
    expect(r.latex).toBe(
      '\\ln(2)+\\frac{x-2}{2}-\\frac{(x-2)^2}{8}+\\frac{(x-2)^3}{24}-\\frac{(x-2)^4}{64}+O\\left((x-2)^5\\right)'
    );
  });

  test('Arctan at 2i, order 3', () => {
    const r = ce
      .box(['Series', ['Arctan', 'x'], 'x', ['Complex', 0, 2], 3])
      .evaluate();
    expect(r.latex).toBe(
      '\\arctan(2\\imaginaryI)-\\frac{x-2\\imaginaryI}{3}+(-\\frac{2}{9}\\imaginaryI)(x-2\\imaginaryI)^2+\\frac{1}{81}\\times13(x-2\\imaginaryI)^3+O\\left((x-2\\imaginaryI)^4\\right)'
    );
  });

  // The coefficients are evaluated: no `0.64(-0.5 - 0.5)` or `(a + a)`
  test('Arctan at -0.5, order 3', () => {
    const r = ce.box(['Series', ['Arctan', 'x'], 'x', -0.5, 3]).evaluate();
    expect(r.latex).toBe(
      '-0.463\\,647\\,609\\,000\\,806\\,116\\,214+0.8(x+0.5)+\\frac{0.64}{2}(x+0.5)^2-\\frac{0.128}{3}(x+0.5)^3+O\\left((x+0.5)^4\\right)'
    );
  });

  test('Arctan at a, order 3', () => {
    const r = ce.box(['Series', ['Arctan', 'x'], 'x', 'a', 3]).evaluate();
    expect(r.latex).toBe(
      '\\arctan(a)+\\frac{x-a}{a^2+1}-\\frac{a}{(a^2+1)^2}(x-a)^2+\\frac{1}{3}(\\frac{4a^2}{(a^2+1)^3}-\\frac{1}{(a^2+1)^2})(x-a)^3+O\\left((x-a)^4\\right)'
    );
  });

  test('a singular point still defers', () => {
    const r = ce.box(['Series', ['Arcsin', 'x'], 'x', 1, 3]).evaluate();
    expect(r.operator).toBe('Series');
  });

  test('evaluate() and N() agree near the expansion point', () => {
    const poly = ce
      .box(['Normal', ['Series', ['Arctan', 'x'], 'x', 0, 11]])
      .evaluate()
      .subs({ x: 0.1 })
      .N().re;
    expect(poly).toBeCloseTo(Math.atan(0.1), 12);
  });
});
