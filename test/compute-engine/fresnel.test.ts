/**
 * Tests for Fresnel integrals (FresnelS, FresnelC)
 *
 * S(x) = integral from 0 to x of sin(pi*t^2/2) dt
 * C(x) = integral from 0 to x of cos(pi*t^2/2) dt
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { BoxedExpression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import {
  fresnelS,
  fresnelC,
} from '../../src/compute-engine/numerics/special-functions';

const ce = new ComputeEngine();

// Reference values computed from Cephes rational approximation (verified against DLMF)
const FRESNEL_S_REF: [number, number][] = [
  [0, 0],
  [1, 0.438259147390355],
  [2, 0.343415678363698],
  [0.5, 0.064732432859999],
];

// Region 2 values tested separately with looser precision
const FRESNEL_S_REGION2: [number, number][] = [
  [3, 0.496313],
  [5, 0.499191],
];

const FRESNEL_C_REF: [number, number][] = [
  [0, 0],
  [1, 0.779893400376823],
  [2, 0.488253406075341],
  [0.5, 0.492344225871443],
];

const FRESNEL_C_REGION2: [number, number][] = [
  [3, 0.605721],
  [5, 0.563631],
];

describe('FRESNEL - Numeric fresnelS', () => {
  test('S(0) = 0', () => {
    expect(fresnelS(0)).toBe(0);
  });

  test.each(FRESNEL_S_REF)('S(%f) matches reference', (x, expected) => {
    expect(fresnelS(x)).toBeCloseTo(expected, 12);
  });

  test.each(FRESNEL_S_REGION2)(
    'S(%f) matches reference (region 2)',
    (x, expected) => {
      expect(fresnelS(x)).toBeCloseTo(expected, 5);
    }
  );

  test('S(Infinity) = 0.5', () => {
    expect(fresnelS(Infinity)).toBe(0.5);
  });

  test('S(-Infinity) = -0.5', () => {
    expect(fresnelS(-Infinity)).toBe(-0.5);
  });

  test('S(NaN) = NaN', () => {
    expect(fresnelS(NaN)).toBeNaN();
  });

  test('odd symmetry: S(-x) = -S(x)', () => {
    for (const x of [0.3, 1, 2.5, 10, 35]) {
      expect(fresnelS(-x)).toBeCloseTo(-fresnelS(x), 14);
    }
  });

  // S(50) = 0.5 − f(50)·cos(1250π) ≈ 0.49363, not 0.5: the previous
  // asymptotic cutoff of 36 (a transcription of the Cephes 36974) dropped
  // the oscillating term, an absolute error of ~1/(πx)
  test('large argument: S(50) = 0.49363380258593874...', () => {
    expect(fresnelS(50)).toBeCloseTo(0.49363380258593874, 12);
  });
});

describe('FRESNEL - Numeric fresnelC', () => {
  test('C(0) = 0', () => {
    expect(fresnelC(0)).toBe(0);
  });

  test.each(FRESNEL_C_REF)('C(%f) matches reference', (x, expected) => {
    expect(fresnelC(x)).toBeCloseTo(expected, 11);
  });

  test.each(FRESNEL_C_REGION2)(
    'C(%f) matches reference (region 2)',
    (x, expected) => {
      expect(fresnelC(x)).toBeCloseTo(expected, 5);
    }
  );

  test('C(Infinity) = 0.5', () => {
    expect(fresnelC(Infinity)).toBe(0.5);
  });

  test('C(-Infinity) = -0.5', () => {
    expect(fresnelC(-Infinity)).toBe(-0.5);
  });

  test('C(NaN) = NaN', () => {
    expect(fresnelC(NaN)).toBeNaN();
  });

  test('odd symmetry: C(-x) = -C(x)', () => {
    for (const x of [0.3, 1, 2.5, 10, 35]) {
      expect(fresnelC(-x)).toBeCloseTo(-fresnelC(x), 14);
    }
  });

  // C(50) = 0.5 − g(50)·cos(1250π) ≈ 0.49999919 (see S(50) note above)
  test('large argument: C(50) = 0.49999918943072797...', () => {
    expect(fresnelC(50)).toBeCloseTo(0.49999918943072797, 12);
  });
});

describe('FRESNEL - Engine evaluation', () => {
  test('FresnelS(0) = 0', () => {
    const result = ce.expr(['FresnelS', 0]).evaluate();
    expect(result.re).toBe(0);
  });

  test('FresnelC(0) = 0', () => {
    const result = ce.expr(['FresnelC', 0]).evaluate();
    expect(result.re).toBe(0);
  });

  test('FresnelS(1) matches reference', () => {
    const result = ce.expr(['FresnelS', 1]).N();
    expect(result.re).toBeCloseTo(0.438259147390355, 12);
  });

  test('FresnelC(1) matches reference', () => {
    const result = ce.expr(['FresnelC', 1]).N();
    expect(result.re).toBeCloseTo(0.779893400376823, 12);
  });
});

describe('FRESNEL - huge arguments reach the 1/2 limit', () => {
  // Both integrals tend to ±1/2, with a correction of order 1/(πx) that is
  // far below the working tolerance here. The bignum kernel used to size its
  // guard digits from the phase πx²/2, which overflows the machine float for
  // |x| ≳ 1.6e154: `log10(Infinity)` made the requested extra precision
  // Infinity, and computing π at infinite precision recursed until the stack
  // overflowed ("Maximum call stack size exceeded").
  test.each([
    ['1e300', 0.5],
    ['-1e300', -0.5],
    ['1e400', 0.5],
    ['-1e400', -0.5],
  ])('FresnelS(%s) = %f', (x, expected) => {
    expect(ce.box(['FresnelS', ce.parse(x)]).N().re).toBe(expected);
  });

  test.each([
    ['1e300', 0.5],
    ['-1e300', -0.5],
    ['1e400', 0.5],
    ['-1e400', -0.5],
  ])('FresnelC(%s) = %f', (x, expected) => {
    expect(ce.box(['FresnelC', ce.parse(x)]).N().re).toBe(expected);
  });

  // These sit on either side of the phase overflow (πx²/2 leaves the double
  // range at |x| ≳ 1.6e154), but at the default 21-digit precision all three
  // take the same 1/2 shortcut as the rows above — log10(x) already exceeds
  // the working tolerance. They pin that the shortcut answers 1/2 across the
  // overflow boundary; the branch below the shortcut is covered separately,
  // at a precision high enough to reach it.
  test.each(['1e100', '1e150', '1e153'])(
    'FresnelS and FresnelC at %s are unchanged at 1/2',
    (x) => {
      expect(ce.box(['FresnelS', ce.parse(x)]).N().re).toBe(0.5);
      expect(ce.box(['FresnelC', ce.parse(x)]).N().re).toBe(0.5);
    }
  );

  // Moderate arguments still go through the Taylor/asymptotic kernels.
  test('moderate arguments are untouched', () => {
    expect(ce.box(['FresnelS', ce.parse('2.5')]).N().re).toBeCloseTo(
      0.6191817558195929,
      12
    );
    expect(ce.box(['FresnelC', ce.parse('-3')]).N().re).toBeCloseTo(
      -0.6057207892976856,
      12
    );
    expect(ce.box(['FresnelS', ce.parse('1000')]).N().re).toBeCloseTo(
      0.4996816901138163,
      12
    );
  });
});

describe('FRESNEL - LaTeX parsing', () => {
  test('parses \\operatorname{FresnelS}(x)', () => {
    const expr = ce.parse('\\operatorname{FresnelS}(x)');
    expect(expr.operator).toBe('FresnelS');
    expect(expr.json).toEqual(['FresnelS', 'x']);
  });

  test('parses \\operatorname{FresnelC}(x)', () => {
    const expr = ce.parse('\\operatorname{FresnelC}(x)');
    expect(expr.operator).toBe('FresnelC');
    expect(expr.json).toEqual(['FresnelC', 'x']);
  });

  test('FresnelS round-trip', () => {
    const expr = ce.parse('\\operatorname{FresnelS}(x)');
    expect(expr.latex).toContain('FresnelS');
  });

  test('FresnelC round-trip', () => {
    const expr = ce.parse('\\operatorname{FresnelC}(x)');
    expect(expr.latex).toContain('FresnelC');
  });
});

describe('FRESNEL - JavaScript compilation', () => {
  test('compiles FresnelS to _SYS.fresnelS', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('_SYS.fresnelS');
  });

  test('compiles FresnelC to _SYS.fresnelC', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.code).toContain('_SYS.fresnelC');
  });

  test('compiled FresnelS(0) returns 0', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0 })).toBe(0);
  });

  test('compiled FresnelC(0) returns 0', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 0 })).toBe(0);
  });

  test('compiled FresnelS(1) matches direct evaluation', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 1 })).toBeCloseTo(fresnelS(1), 14);
  });

  test('compiled FresnelC(1) matches direct evaluation', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr);
    expect(result.success).toBe(true);
    expect(result.run!({ x: 1 })).toBeCloseTo(fresnelC(1), 14);
  });
});

describe('FRESNEL - Interval JS compilation', () => {
  test('compiles FresnelS to _IA.fresnelS', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('_IA.fresnelS');
  });

  test('compiles FresnelC to _IA.fresnelC', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    expect(result.code).toContain('_IA.fresnelC');
  });

  test('interval FresnelS containing 0', () => {
    const expr = ce.expr(['FresnelS', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const interval = result.run!({ x: { lo: -1, hi: 1 } });
    expect(interval.kind).toBe('interval');
    if (interval.kind === 'interval') {
      // S(-1) < 0 and S(1) > 0, S(0) = 0
      expect(interval.value.lo).toBeLessThan(0);
      expect(interval.value.hi).toBeGreaterThan(0);
    }
  });

  test('interval FresnelC point evaluation', () => {
    const expr = ce.expr(['FresnelC', 'x']);
    const result = compile(expr, { to: 'interval-js' });
    expect(result.success).toBe(true);
    const interval = result.run!({ x: { lo: 1, hi: 1 } });
    expect(interval.kind).toBe('interval');
    if (interval.kind === 'interval') {
      expect(interval.value.lo).toBeCloseTo(fresnelC(1), 14);
      expect(interval.value.hi).toBeCloseTo(fresnelC(1), 14);
    }
  });
});

describe('FRESNEL - huge arguments at raised precision', () => {
  // The 1/2 shortcut in the bignum kernel only applies while the 1/(πx)
  // correction sits below the working tolerance, i.e. while log10(x) exceeds
  // the working precision. Raising the precision past log10(x) puts the same
  // arguments back on the asymptotic branch, which is where the phase πx²/2
  // overflows the double and the log10(πx²/2) fallback (derived from log10(x)
  // instead of from the overflowed phase) is exercised.
  //
  // `BigDecimal.precision` is process-global and setting `ce.precision` writes
  // it, so every case restores the engine's precision afterwards: the other
  // blocks in this file share this engine. (Nothing can leak to a sibling test
  // FILE — jest gives each file its own module registry — but the blocks here
  // would see the raised precision.)
  // Captured while the describe body runs, i.e. before any test in this file
  // has had a chance to touch the shared engine.
  const DEFAULT_PRECISION = ce.precision;

  function atPrecision<T>(digits: number, f: () => T): T {
    const saved = ce.precision;
    try {
      ce.precision = digits;
      return f();
    } finally {
      ce.precision = saved;
    }
  }

  // The leading significant digits of a value's decimal expansion, sign and
  // all. Two values are compared this way rather than through a ratio because
  // the corrections here are around 1e-161 and 1e-401: `Divide` on operands
  // whose machine projection has underflowed to -0 answers NaN, so a relative
  // error computed that way is unusable.
  const leadingDigits = (v: BoxedExpression, n = 40) => v.toString().slice(0, n);

  test('S(1e160) at 200 digits is 1/2 - 1/(pi x)', () => {
    atPrecision(200, () => {
      const x = ce.parse('1e160');
      const s = ce.box(['FresnelS', x]).N();
      // The phase of x = 10^k is an exact multiple of 2π (π·10^320/2 = 2π·
      // 25·10^318), so cos(πx²/2) = 1 and sin(πx²/2) = 0: the whole asymptotic
      // correction collapses to the leading −1/(πx) term, and the next term is
      // smaller by a factor u² ≈ 2.5e640.
      const diff = ce.box(['Subtract', s, ce.parse('0.5')]).N();
      const expected = ce.box(['Negate', ['Divide', 1, ['Multiply', 'Pi', x]]]).N();
      expect(diff.isNegative).toBe(true);
      // Subtracting 1/2 from a 200-digit S leaves ~40 significant digits, all
      // of which must be digits of -1/(pi x).
      expect(leadingDigits(diff)).toBe('-3.1830988618379067153776752674502872406');
      expect(leadingDigits(diff)).toBe(leadingDigits(expected));
    });
  });

  test('C(1e160) at 200 digits is exactly 1/2', () => {
    atPrecision(200, () => {
      // C's correction is g(x)·cos(πx²/2) with g ~ 1/(2πxu) ≈ 2e-481, below the
      // 200-digit tolerance, so every digit carried is a digit of 1/2.
      // (`.re` would round 0.4999…9 to 0.5 too, hence the exact string check.)
      expect(ce.box(['FresnelC', ce.parse('1e160')]).N().toString()).toBe('0.5');
    });
  });

  test('S(1e400) at 500 digits is 1/2 - 1/(pi x), not exactly 1/2', () => {
    atPrecision(500, () => {
      const x = ce.parse('1e400');
      const s = ce.box(['FresnelS', x]).N();
      expect(s.toString()).not.toBe('0.5');
      const diff = ce.box(['Subtract', s, ce.parse('0.5')]).N();
      const expected = ce.box(['Negate', ['Divide', 1, ['Multiply', 'Pi', x]]]).N();
      expect(leadingDigits(diff)).toBe('-3.1830988618379067153776752674502872406');
      expect(leadingDigits(diff)).toBe(leadingDigits(expected));
    });
  });

  test('S(1e300) at the default precision is still exactly 1/2', () => {
    expect(ce.box(['FresnelS', ce.parse('1e300')]).N().toString()).toBe('0.5');
  });

  test('the raised-precision cases restored the engine precision', () => {
    expect(ce.precision).toBe(DEFAULT_PRECISION);
  });
});
