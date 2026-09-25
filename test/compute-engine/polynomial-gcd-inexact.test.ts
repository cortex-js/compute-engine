import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import {
  cancelCommonFactors,
  polynomialDivide,
  polynomialGCD,
} from '../../src/compute-engine/boxed-expression/polynomials';
import { loadIntegrationRules } from '../../src/integration-rules';
import { BigDecimal } from '../../src/big-decimal/big-decimal';

// The Rubi integral ∫ 1/(2+3x⁴)² dx (Rubi test 1.1.3.2 #703) ran into the 30 s
// wall-clock guard of the rule driver. Two defects combined:
//
// 1. `evaluate()` of `−x² + x·√(⅔√6) − √6/3` turned the exact nested radical
//    `√(⅔√6)` into the big decimal 1.2778…: `toNumericValue()` of a `Sqrt`
//    extracted an inexact square root of an exact coefficient.
// 2. `polynomialGCD` then ran the Euclidean loop over big-decimal
//    coefficients. A remainder that is zero in exact arithmetic is not zero
//    with floats, so the loop did not stop; sums and products of big decimals
//    keep every digit, and the coefficients grew to thousands of digits.
//    `polynomialDivide` itself also made floats from exact radical
//    coefficients, because the `.sub()` method folds `√2 + 1` to a float.

const ce = new ComputeEngine();

/** Run `fn` with a budget of 50 deadline checks. Before the fix, some of
 * these calls did not return for minutes; the budget makes them throw
 * instead, so the test fails instead of hanging (jest cannot stop synchronous
 * code). Each call below uses at most 5 checks (measured 2026-09-24): the
 * budget has a margin of 10. A step budget, unlike a wall-clock limit, runs
 * out at the same point on every machine, whatever the load. The 60 s limit is
 * only a guard against a hang in code that does not count steps. */
function bounded<T>(fn: () => T): T {
  return ce._withBudget({ steps: 50, ms: 60_000 }, fn);
}

function hasInexactNumber(e: Expression): boolean {
  if (e.isNumberLiteral) return e.isExact === false;
  return e.ops?.some(hasInexactNumber) ?? false;
}

/** The value of `e` at `x = t`, as a machine number. */
function at(e: Expression, t: number): number {
  return e.subs({ x: t }).N().re;
}

const Q = ['Sqrt', ['Multiply', ['Rational', 2, 3], ['Sqrt', 6]]] as const;

describe('Exact nested radicals stay exact', () => {
  test('−x² + x·√(⅔√6) − √6/3 holds no float after evaluate, simplify or expand', () => {
    const e = ce.box([
      'Subtract',
      ['Add', ['Divide', ['Sqrt', 6], -3], ['Multiply', Q, 'x']],
      ['Power', 'x', 2],
    ]);
    expect(hasInexactNumber(e)).toBe(false);
    expect(hasInexactNumber(e.evaluate())).toBe(false);
    expect(hasInexactNumber(e.simplify())).toBe(false);
    expect(hasInexactNumber(ce.box(['Expand', e]).evaluate())).toBe(false);
  });

  test('toNumericValue() does not extract an inexact root', () => {
    for (const r of [Q, ['Sqrt', ['Sqrt', 2]]] as const) {
      const [coef] = ce.box(r).toNumericValue();
      expect(coef.isExact).toBe(true);
    }
  });
});

describe('polynomialDivide keeps exact radical coefficients exact', () => {
  test('(x³ + √2·x + 1) ÷ (x² + √3·x − 1)', () => {
    const p = ce.parse('x^3+\\sqrt2 x+1');
    const d = ce.parse('x^2+\\sqrt3 x-1');
    const result = bounded(() => polynomialDivide(p, d, 'x'));
    expect(result).not.toBeNull();
    const [q, r] = result!;
    expect(hasInexactNumber(q)).toBe(false);
    expect(hasInexactNumber(r)).toBe(false);
    // The remainder is (4 + √2)·x + 1 − √3; check p = d·q + r numerically.
    for (const t of [-1.3, 0.4, 2.7]) {
      const lhs = at(p, t);
      const rhs = at(d, t) * at(q, t) + at(r, t);
      expect(Math.abs(lhs - rhs)).toBeLessThan(
        1e-12 * Math.max(1, Math.abs(lhs))
      );
      expect(at(r, t)).toBeCloseTo((4 + Math.SQRT2) * t + 1 - Math.sqrt(3), 12);
    }
  });
});

describe('polynomialGCD over exact radical coefficients', () => {
  test('coprime operands give 1 quickly', () => {
    const g = bounded(() =>
      polynomialGCD(
        ce.parse('x^3+\\sqrt2 x+1'),
        ce.parse('x^2+\\sqrt3 x-1'),
        'x'
      )
    );
    expect(g.json).toEqual(1);
  }, 5_000);

  test('a common factor over ℚ(√(⅔√6)) is found exactly', () => {
    // 3x⁴ + 2 = 3·(x² + q·x + √6/3)·(x² − q·x + √6/3), with q = √(⅔√6).
    const factor = ce.box([
      'Add',
      ['Power', 'x', 2],
      ['Multiply', Q, 'x'],
      ['Divide', ['Sqrt', 6], 3],
    ]);
    const g = bounded(() => polynomialGCD(ce.parse('3x^4+2'), factor, 'x'));
    expect(hasInexactNumber(g)).toBe(false);
    for (const t of [-1.1, 0.3, 1.9]) {
      const expected = at(factor, t);
      expect(Math.abs(at(g, t) - expected)).toBeLessThan(
        1e-12 * Math.max(1, Math.abs(expected))
      );
    }
  }, 5_000);
});

describe('polynomialGCD refuses inexact coefficients', () => {
  // The pair of polynomials of the profile of the Rubi integral #703, with the
  // float 1.2778… in place of √(⅔√6). The Euclidean loop over these ran until
  // the 30 s guard.
  const q = { num: '1.27788620849254495171' };
  const a = ce.box([
    'Add',
    ['Multiply', -2, ['Power', 'x', 2]],
    ['Multiply', q, 'x'],
  ]);
  const b = ce.box([
    'Add',
    ['Negate', ['Power', 'x', 2]],
    ['Multiply', q, 'x'],
    ['Negate', ['Divide', ['Sqrt', 6], 3]],
  ]);

  test('big-decimal coefficients give the trivial GCD 1 quickly', () => {
    expect(bounded(() => polynomialGCD(a, b, 'x')).json).toEqual(1);
    expect(bounded(() => polynomialGCD(b, a, 'x')).json).toEqual(1);
  }, 5_000);

  test('a machine-float coefficient with many digits gives the trivial GCD 1', () => {
    // `x + √2` with √2 as the double 1.4142135623730951 (17 digits): not a
    // short decimal, so not read as an exact rational.
    const g = bounded(() =>
      polynomialGCD(
        ce.parse('x^2-2'),
        ce.box(['Add', 'x', { num: String(Math.SQRT2) }]),
        'x'
      )
    );
    expect(g.json).toEqual(1);
  });

  test('cancelCommonFactors leaves a fraction with long inexact coefficients unchanged', () => {
    const f = ce.function('Divide', [a, b]);
    expect(bounded(() => cancelCommonFactors(f, 'x'))).toBe(f);
  }, 5_000);
});

describe('polynomialGCD reads short float coefficients as exact decimals', () => {
  test('gcd(x² − 1.5x + 0.5, x − 1) = x − 1', () => {
    const g = bounded(() =>
      polynomialGCD(ce.parse('x^2-1.5x+0.5'), ce.parse('x-1'), 'x')
    );
    expect(g.json).toEqual(['Add', 'x', -1]);
    const h = ce
      .box(['PolynomialGCD', ce.parse('x^2-1.5x+0.5').json, ['Add', 'x', -1]])
      .evaluate();
    expect(h.json).toEqual(['Add', 'x', -1]);
  });

  test('gcd(x² − 2.25, x + 1.5) = x + 3/2', () => {
    const g = bounded(() =>
      polynomialGCD(ce.parse('x^2-2.25'), ce.parse('x+1.5'), 'x')
    );
    expect(g.json).toEqual(['Add', 'x', ['Rational', 3, 2]]);
  });

  test('simplify cancels the common factor of a fraction with float coefficients', () => {
    // The input has floats, so a float in the result is acceptable under the
    // exactness contract.
    expect(ce.parse('\\frac{x^2-1.5x+0.5}{x-1}').simplify().json).toEqual([
      'Add',
      'x',
      -0.5,
    ]);
  });

  test('gcd(0, 1.5x + 3) is the monic x + 2', () => {
    expect(polynomialGCD(ce.Zero, ce.parse('1.5x+3'), 'x').toString()).toBe(
      'x + 2'
    );
    expect(polynomialGCD(ce.parse('1.5x+3'), ce.Zero, 'x').toString()).toBe(
      'x + 2'
    );
  });
});

describe('∫ 1/(2+3x⁴)² dx with the Rubi rules (1.1.3.2 #703)', () => {
  const rubi = new ComputeEngine();
  beforeAll(() => loadIntegrationRules(rubi));

  test('evaluates to a correct antiderivative in well under the guard', () => {
    const F = rubi.parse('\\int \\frac{1}{(2+3x^4)^2} dx').evaluate();
    expect(F.has('Integrate')).toBe(false);
    expect(hasInexactNumber(F)).toBe(false);

    const dF = rubi.box(['D', F, 'x']).evaluate();
    for (const t of [-1.7, -0.6, 0.35, 0.9, 1.45]) {
      const expected = 1 / (2 + 3 * t ** 4) ** 2;
      const actual = dF.subs({ x: t }).N().re;
      expect(Math.abs(actual - expected)).toBeLessThan(1e-12 * expected);
    }
  }, 30_000);
});

describe('BigDecimal.toNumber of a long significand', () => {
  // A long significand is converted by a binary division, not by printing
  // every digit. The result must still be the double nearest to the value,
  // as `Number()` gives for the decimal string.
  test('matches the decimal string for a 3,000-digit value', () => {
    let digits = '';
    for (let i = 0; i < 3000; i++) digits += String((i * 7 + 3) % 10);
    for (const exp of [-3000, -2990, -3100, -2700]) {
      const b = new BigDecimal(digits + 'e' + exp);
      expect(b.toNumber()).toBe(Number(b.toString()));
      expect(b.neg().toNumber()).toBe(-Number(b.toString()));
    }
  });

  test('matches the decimal string near the ends of the range of the fast conversion', () => {
    let digits = '';
    for (let i = 0; i < 60; i++) digits += String((i * 3 + 1) % 10);
    // Adjusted exponents (the decimal exponent of the leading digit) of −299
    // and −298, and positive exponents (adjusted 70 and 250).
    for (const exp of [-358, -357, 11, 191]) {
      const b = new BigDecimal(digits + 'e' + exp);
      expect(b.toNumber()).toBe(Number(b.toString()));
      expect(b.neg().toNumber()).toBe(-Number(b.toString()));
    }
  });

  test('rounds a value half-way between two doubles, and next to it, as the decimal string does', () => {
    // 1 + 2^-53 is the midpoint between 1 and the next double: it rounds to
    // even (1). A value just above it rounds up; just below, down.
    const mid = 5n ** 53n + 2n ** 53n * 5n ** 53n; // (1 + 2^-53) · 10^53
    for (const d of [0n, 1n, -1n]) {
      const b = new BigDecimal((mid * 10n ** 60n + d).toString() + 'e-113');
      expect(b.toNumber()).toBe(Number(b.toString()));
    }
    expect(
      new BigDecimal((mid * 10n ** 60n + 1n).toString() + 'e-113').toNumber()
    ).toBe(1 + 2 ** -52);
    expect(
      new BigDecimal((mid * 10n ** 60n).toString() + 'e-113').toNumber()
    ).toBe(1);
  });
});
