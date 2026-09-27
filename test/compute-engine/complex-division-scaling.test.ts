/**
 * The quotient of two complex numbers must not overflow or underflow when
 * the quotient itself is in the range of a double.
 *
 * The textbook formula `a·conj(b) / |b|²` squares the parts of the divisor:
 * `1 / (1e308 + 1e308i)` gave `0` (the square overflows) and
 * `1 / (1e-200 + 1e-200i)` gave `~oo` (the square underflows). The unscaled
 * Smith formula of `complex-esm` overflows for
 * `(1e308 + 1e308i) / (1 + i)`. The interpreter now uses
 * `scaledComplexDivide()` (`src/compute-engine/numerics/numeric-complex.ts`),
 * the same algorithm as the compiled JavaScript target.
 *
 * Every expected value is computed in this file from the algebra, not copied
 * from the engine:
 * - `1 / (s + s·i) = (1 − i) / (2s)`, so each part is `±0.5 / s`;
 * - `(s + s·i) / (1 + i) = s`;
 * - the inverse of `[[a, b], [0, 1]]` is `[[1/a, −b/a], [0, 1]]`.
 */
import { Complex } from 'complex-esm';
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { MachineNumericValue } from '../../src/compute-engine/numeric-value/machine-numeric-value';
import { BigNumericValue } from '../../src/compute-engine/numeric-value/big-numeric-value';
import {
  complexDivide,
  complexInverse,
  complexQuotient,
  scaledComplexDivide,
} from '../../src/compute-engine/numerics/numeric-complex';

const ce = new ComputeEngine();
ce.declare('z', 'complex');
ce.declare('w', 'complex');

/** Relative closeness; an expected zero must be exactly zero. */
function close(actual: number, expected: number, tol = 1e-12): boolean {
  if (expected === 0) return actual === 0;
  return Math.abs(actual - expected) <= tol * Math.abs(expected);
}

function expectComplex(
  actual: { re: number; im: number },
  expected: { re: number; im: number }
): void {
  const ok = close(actual.re, expected.re) && close(actual.im, expected.im);
  if (!ok)
    throw new Error(
      `expected ${expected.re} + ${expected.im}i, got ${actual.re} + ${actual.im}i`
    );
  expect(ok).toBe(true);
}

/** The value of an evaluated number expression, as `{re, im}`. */
function reIm(x: Expression): { re: number; im: number } {
  return { re: x.re, im: x.im };
}

/** The compiled JavaScript value of `expr` for the given complex inputs. */
function compiled(
  expr: Expression,
  vars: Record<string, unknown>
): { re: number; im: number } {
  const result = compile(expr, { to: 'javascript' });
  expect(result.success).toBe(true);
  const v = result.run!(vars as any) as any;
  return typeof v === 'number' ? { re: v, im: 0 } : { re: v.re, im: v.im };
}

// 1/(s + s·i) = (1 − i)/(2s)
const HUGE = 1e308;
const TINY = 1e-200;
const INV_HUGE = { re: 0.5 / HUGE, im: -0.5 / HUGE }; // 5e-309 − 5e-309i
const INV_TINY = { re: 0.5 / TINY, im: -0.5 / TINY }; // 5e199 − 5e199i

describe('SCALED COMPLEX DIVISION: box route', () => {
  for (const precision of ['auto', 'machine'] as const) {
    describe(`precision ${precision}`, () => {
      const engine = new ComputeEngine();
      engine.precision = precision;

      test('1 / (1e308 + 1e308i) does not overflow', () => {
        const x = engine.box(['Divide', 1, ['Complex', HUGE, HUGE]]);
        expectComplex(reIm(x.N()), INV_HUGE);
        expectComplex(reIm(x.evaluate()), INV_HUGE);
      });

      test('1 / (1e-200 + 1e-200i) does not underflow', () => {
        const x = engine.box(['Divide', 1, ['Complex', TINY, TINY]]);
        expectComplex(reIm(x.N()), INV_TINY);
        expectComplex(reIm(x.evaluate()), INV_TINY);
      });

      test('(1e308 + 1e308i) / (1 + i) is 1e308', () => {
        const x = engine.box([
          'Divide',
          ['Complex', HUGE, HUGE],
          ['Complex', 1, 1],
        ]);
        expectComplex(reIm(x.N()), { re: HUGE, im: 0 });
      });

      test('(1e-200 + 1e-200i)^-1 does not underflow', () => {
        const x = engine.box(['Power', ['Complex', TINY, TINY], -1]);
        expectComplex(reIm(x.N()), INV_TINY);
        expectComplex(reIm(x.evaluate()), INV_TINY);
      });

      test('(3 + 4i) / (1 + 2i) is 2.2 − 0.4i', () => {
        // (3 + 4i)(1 − 2i)/5 = (11 − 2i)/5
        const x = engine.box(['Divide', ['Complex', 3, 4], ['Complex', 1, 2]]);
        expectComplex(reIm(x.N()), { re: 11 / 5, im: -2 / 5 });
      });
    });
  }
});

describe('SCALED COMPLEX DIVISION: parse route', () => {
  test('\\frac{1}{10^{308}+10^{308}i}', () => {
    const x = ce.parse('\\frac{1}{10^{308}+10^{308}i}');
    expectComplex(reIm(x.N()), INV_HUGE);
  });

  test('(10^{-200}+10^{-200}i)^{-1}', () => {
    const x = ce.parse('(10^{-200}+10^{-200}i)^{-1}');
    expectComplex(reIm(x.N()), INV_TINY);
    expectComplex(reIm(x.evaluate()), INV_TINY);
  });
});

describe('SCALED COMPLEX DIVISION: Inverse', () => {
  test('Inverse of [[1e308 + 1e308i]]', () => {
    const m = ce.box(['Inverse', ['List', ['List', ['Complex', HUGE, HUGE]]]]);
    const r = m.N();
    expectComplex(reIm(r.ops![0].ops![0]), INV_HUGE);
  });

  test('Inverse of [[1 + i, 1e308 + 1e308i], [0, 1]]', () => {
    const m = ce.box([
      'Inverse',
      [
        'List',
        ['List', ['Complex', 1, 1], ['Complex', HUGE, HUGE]],
        ['List', 0, 1],
      ],
    ]);
    const r = m.N();
    // [[1/a, −b/a], [0, 1]] with a = 1 + i, b = 1e308(1 + i): −b/a = −1e308
    expectComplex(reIm(r.ops![0].ops![0]), { re: 0.5, im: -0.5 });
    expectComplex(reIm(r.ops![0].ops![1]), { re: -HUGE, im: 0 });
    expectComplex(reIm(r.ops![1].ops![0]), { re: 0, im: 0 });
    expectComplex(reIm(r.ops![1].ops![1]), { re: 1, im: 0 });
  });
});

describe('SCALED COMPLEX DIVISION: the interpreter agrees with the compiled JavaScript', () => {
  const cases: [string, [number, number], [number, number]][] = [
    ['1 / (1e308 + 1e308i)', [1, 0], [HUGE, HUGE]],
    ['1 / (1e-200 + 1e-200i)', [1, 0], [TINY, TINY]],
    ['(1e308 + 1e308i) / (1 + i)', [HUGE, HUGE], [1, 1]],
    ['(3 + 4i) / (1 + 2i)', [3, 4], [1, 2]],
    [
      '(1e-300 + 2e-300i) / (3e-10 − 1e-10i)',
      [1e-300, 2e-300],
      [3e-10, -1e-10],
    ],
    // The numerator products `2^-1000 · 2^-100` underflow to `0`, so the
    // textbook numerator reads as an exact zero although the quotient
    // `2^-901 − 2^-901·i` is representable; both routes must take the scaled
    // route (found by the review of 2026-09-27).
    ['2^-1000 / (2^-100 + 2^-100i)', [2 ** -1000, 0], [2 ** -100, 2 ** -100]],
  ];
  for (const [label, [ar, ai], [br, bi]] of cases) {
    test(label, () => {
      const interpreted = reIm(
        ce.box(['Divide', ['Complex', ar, ai], ['Complex', br, bi]]).N()
      );
      const js = compiled(ce.box(['Divide', 'z', 'w']), {
        z: { re: ar, im: ai },
        w: { re: br, im: bi },
      });
      expectComplex(interpreted, js);
    });
  }

  test('Inverse of [[1 + i, 1e308 + 1e308i], [0, 1]]', () => {
    ce.declare('M', 'matrix<complex^2x2>');
    const js = compile(ce.box(['Inverse', 'M']), { to: 'javascript' });
    expect(js.success).toBe(true);
    const out = js.run!({
      M: [
        [
          { re: 1, im: 1 },
          { re: HUGE, im: HUGE },
        ],
        [0, 1],
      ],
    } as any) as any;
    expect(out[0][1]).toBe(-HUGE);
  });
});

describe('SCALED COMPLEX DIVISION: numeric-value methods', () => {
  test('MachineNumericValue.div and .inv', () => {
    const one = new MachineNumericValue(1);
    const huge = new MachineNumericValue({ re: HUGE, im: HUGE });
    const tiny = new MachineNumericValue({ re: TINY, im: TINY });
    expectComplex(one.div(huge), INV_HUGE);
    expectComplex(one.div(tiny), INV_TINY);
    expectComplex(huge.inv(), INV_HUGE);
    expectComplex(tiny.inv(), INV_TINY);
    expectComplex(huge.div(new MachineNumericValue({ re: 1, im: 1 })), {
      re: HUGE,
      im: 0,
    });
  });

  test('BigNumericValue.div and .inv', () => {
    const one = new BigNumericValue(1);
    const huge = new BigNumericValue({ re: HUGE, im: HUGE });
    const tiny = new BigNumericValue({ re: TINY, im: TINY });
    expectComplex(one.div(huge), INV_HUGE);
    expectComplex(one.div(tiny), INV_TINY);
    expectComplex(huge.inv(), INV_HUGE);
    expectComplex(tiny.inv(), INV_TINY);
    expectComplex(huge.div(new BigNumericValue({ re: 1, im: 1 })), {
      re: HUGE,
      im: 0,
    });
  });
});

describe('SCALED COMPLEX DIVISION: helpers', () => {
  test('scaledComplexDivide', () => {
    expectComplex(scaledComplexDivide(1, 0, HUGE, HUGE), INV_HUGE);
    expectComplex(scaledComplexDivide(1, 0, TINY, TINY), INV_TINY);
    expectComplex(scaledComplexDivide(HUGE, HUGE, 1, 1), { re: HUGE, im: 0 });
  });

  test('complexQuotient scales a subnormal numerator part', () => {
    // 1e-300 / (1e-10 + 1e-10i) = 1e-300(1 − i)/(2e-10) = 5e-291 − 5e-291i.
    // The textbook numerator 1e-300 · 1e-10 is subnormal and has lost digits.
    const q = complexQuotient(1e-300, 0, 1e-10, 1e-10);
    expect(close(q.re, 0.5e-290, 1e-15)).toBe(true);
    expect(close(q.im, -0.5e-290, 1e-15)).toBe(true);
  });

  test('complexQuotient keeps the textbook formula for ordinary values', () => {
    // Bit for bit the formula the numeric values used before.
    const [a, b, c, d] = [3, 4, 1, 2];
    const den = c * c + d * d;
    expect(complexQuotient(a, b, c, d)).toEqual({
      re: (a * c + b * d) / den,
      im: (b * c - a * d) / den,
    });
  });

  test('complexDivide and complexInverse', () => {
    const r = complexDivide(new Complex(1, 0), new Complex(HUGE, HUGE));
    expectComplex(r, INV_HUGE);
    expectComplex(complexInverse(new Complex(TINY, TINY)), INV_TINY);
    expectComplex(complexInverse(new Complex(HUGE, HUGE)), INV_HUGE);
  });

  test('complexDivide matches Complex.div for ordinary values, bit for bit', () => {
    const pairs: [Complex, Complex][] = [
      [new Complex(3, 4), new Complex(1, 2)],
      [new Complex(-1.5, 0.25), new Complex(7, -3)],
      [new Complex(2, -9), new Complex(0.1, 0.3)],
    ];
    for (const [a, b] of pairs) {
      const expected = a.div(b);
      const actual = complexDivide(a, b);
      expect([actual.re, actual.im]).toEqual([expected.re, expected.im]);
    }
  });

  test('complexDivide and complexInverse keep the Complex.div edge values', () => {
    const cases: [Complex, Complex][] = [
      [new Complex(1, 1), new Complex(0, 0)],
      [new Complex(0, 0), new Complex(0, 0)],
      [new Complex(1, 1), new Complex(Infinity, 0)],
      [new Complex(Infinity, 0), new Complex(1, 1)],
      [new Complex(NaN, 0), new Complex(1, 1)],
      [new Complex(1, 1), new Complex(NaN, 1)],
    ];
    for (const [a, b] of cases) {
      const expected = a.div(b);
      const actual = complexDivide(a, b);
      expect([actual.re, actual.im]).toEqual([expected.re, expected.im]);
    }
    for (const z of [
      new Complex(0, 0),
      new Complex(Infinity, 1),
      new Complex(NaN, 1),
    ]) {
      const expected = z.inverse();
      const actual = complexInverse(z);
      expect([actual.re, actual.im]).toEqual([expected.re, expected.im]);
    }
  });
});

describe('SCALED COMPLEX DIVISION: zero, infinite and NaN operands keep their values', () => {
  // Measured before the scaled division was introduced (2026-09-27).
  const cases: [string, any, string][] = [
    ['(1 + i) / 0', ['Divide', ['Complex', 1, 1], 0], '~oo'],
    ['0 / 0', ['Divide', 0, 0], 'NaN'],
    ['(1 + i) / NaN', ['Divide', ['Complex', 1, 1], 'NaN'], 'NaN'],
    ['NaN / (1 + i)', ['Divide', 'NaN', ['Complex', 1, 1]], 'NaN'],
    ['(1 + i) / +oo', ['Divide', ['Complex', 1, 1], 'PositiveInfinity'], '0'],
    ['+oo / (1 + i)', ['Divide', 'PositiveInfinity', ['Complex', 1, 1]], '~oo'],
    ['~oo / (1 + i)', ['Divide', 'ComplexInfinity', ['Complex', 1, 1]], '~oo'],
    ['(1 + i) / ~oo', ['Divide', ['Complex', 1, 1], 'ComplexInfinity'], '0'],
  ];
  for (const [label, json, expected] of cases) {
    test(label, () => {
      expect(ce.box(json).N().toString()).toBe(expected);
      expect(ce.box(json).evaluate().toString()).toBe(expected);
    });
  }
});

describe('COMPLEX ROOTS OF A LARGE VALUE', () => {
  test('ComplexRoots(1e200 + 1e200i, 2) does not overflow the modulus', () => {
    // |z| = √2·1e200 and arg z = π/4, so the principal root is
    // 2^(1/4)·1e100·(cos(π/8) + i·sin(π/8)). The squared modulus 2e400 is
    // not a double.
    const r = ce.box(['ComplexRoots', ['Complex', 1e200, 1e200], 2]).N();
    const m = 2 ** 0.25 * 1e100;
    expectComplex(reIm(r.ops![0]), {
      re: m * Math.cos(Math.PI / 8),
      im: m * Math.sin(Math.PI / 8),
    });
  });
});
