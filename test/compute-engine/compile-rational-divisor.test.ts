/**
 * A product with an exact rational factor `p/q` must be lowered as a
 * DIVISION by the integer `q`, not as a multiplication by the rounded
 * reciprocal.
 *
 * Canonicalization rewrites `x / 49` to `Multiply(Rational(1, 49), x)`. When
 * that literal is emitted directly every target produces
 * `0.02040816326530612 * x`. IEEE division is correctly rounded, so `x / 49`
 * is exactly `k` at `x = 49k`, while `x * fl(1/49)` is one ulp below it — so
 * `floor`, `mod 1` and `= 1` all answer one less than the interpreter at
 * every exact multiple. A denominator that IS a power of two has an exact
 * reciprocal and keeps the shorter product.
 *
 * The Tycho code-generation audit of 2026-09-08 measured 82 divisors below
 * 1000 for which the reciprocal product misses an exact multiple, and
 * reported `floor(x / 49)` compiling to 0 at `x = 49`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
// The tests check the division, not how an input is read, so `x` is declared.
ce.declare('x', 'number');

/** The enclosure the interval target answers for a POINT input `x`. */
function intervalRunPoint(
  latex: string,
  x: number
): { lo: number; hi: number } {
  const r = compile(ce.parse(latex), { to: 'interval-js' });
  expect(r.success).toBe(true);
  const out = r.run!({ x: { lo: x, hi: x } }) as {
    kind?: string;
    value?: { lo: number; hi: number };
    lo?: number;
    hi?: number;
  };
  return (out.value ?? out) as { lo: number; hi: number };
}

/** The compiled JavaScript value of `latex` at `x`. */
function jsRun(latex: string, x: number): number {
  const r = compile(ce.parse(latex), { to: 'javascript', fallback: false });
  expect(r.success).toBe(true);
  return r.run!({ x }) as number;
}

describe('COMPILE a rational factor as a division', () => {
  test('a divisor with 32 zero low bits divides exactly', () => {
    // `49 · 2^32` is not a power of two, but its low 32 bits are all zero.
    expect(jsRun('\\lfloor\\frac{x}{210453397504}\\rfloor', 210453397504)).toBe(
      1
    );
  });

  test('a negated quotient is exact at a multiple', () => {
    expect(jsRun('-\\frac{x}{49}', 49)).toBe(-1);
    expect(jsRun('\\frac{x}{-49}', 49)).toBe(-1);
  });

  test('an unrolled Sum body divides in every term', () => {
    // 6x/49 at x = 49 is exactly 6.
    expect(jsRun('\\sum_{n=1}^{3}\\frac{n x}{49}', 49)).toBe(6);
  });

  test('no divisor misses an exact multiple', () => {
    // The audit listed 49, 98, 103, 107, 161, 187, 196 and 197 among the 82
    // failing divisors below 1000. Sweep a range that covers them all.
    const misses: string[] = [];
    for (const d of [3, 7, 49, 98, 103, 107, 161, 187, 196, 197, 999]) {
      const latex = `\\lfloor\\frac{x}{${d}}\\rfloor`;
      const js = compile(ce.parse(latex), { to: 'javascript' });
      const iv = compile(ce.parse(latex), { to: 'interval-js' });
      for (let k = 1; k <= 60; k++) {
        const got = js.run!({ x: d * k }) as number;
        if (got !== k) misses.push(`js d=${d} k=${k} -> ${got}`);
        const bound = iv.run!({ x: { lo: d * k, hi: d * k } }) as {
          value: { lo: number; hi: number };
        };
        if (bound.value.lo !== k || bound.value.hi !== k)
          misses.push(`interval d=${d} k=${k} -> ${JSON.stringify(bound)}`);
      }
    }
    expect(misses).toEqual([]);
  });
});

describe('COMPILE what the rational rewrite must NOT touch', () => {
  test('the leading-literal fold of an Add is untouched', () => {
    // The numeric fold MULTIPLIES the literals it absorbs, so it must stay
    // confined to a product: over an `Add` it would collapse `2k + 1` at
    // `k = 0` to `0`.
    expect(
      compile(ce.parse('\\sum_{k=0}^{2} \\frac{\\sin((2k+1)x)}{2k+1}'), {
        to: 'javascript',
      }).run!({ x: 1 })
    ).toBeCloseTo(Math.sin(1) / 1 + Math.sin(3) / 3 + Math.sin(5) / 5, 12);
  });
});

describe('COMPILE rational divisor agrees with the interpreter', () => {
  const samples = [0, 1, 2.5, -3, 49, 98, 343, 0.1, 1e6];
  for (const latex of [
    '\\frac{x}{49}',
    '\\frac{3x}{49}',
    '\\frac{2x}{3}',
    '\\frac{x}{210453397504}',
    '\\frac{2\\pi x}{49}',
    '\\frac{x}{2}',
    '\\frac{x}{1.6}',
    '\\frac{x}{49}+1',
    '-\\frac{x}{49}',
    '\\frac{-3x}{49}',
    '\\frac{x}{49}-\\frac{x}{7}',
    '\\lfloor\\frac{x}{49}\\rfloor',
  ]) {
    test(`run() matches N() for ${latex}`, () => {
      const expr = ce.parse(latex);
      const fn = compile(expr, { to: 'javascript' });
      for (const x of samples) {
        const got = fn.run!({ x }) as number;
        const want = expr.subs({ x }).N().re;
        expect(got).toBeCloseTo(want, 10);
      }
    });
  }
});

describe('INTERVAL div divides its endpoints', () => {
  test('a point quotient is exact when the division rounds nothing', () => {
    // `_div` used to multiply by the reciprocal interval `[1/b.hi, 1/b.lo]`,
    // which rounds twice: `49 * (1 / 4.9)` is `9.999999999999998`, two ulps
    // off. Dividing the endpoints rounds once, and `49 / 49` is then the
    // exact point 1 — that divisor never reaches the rational rewrite, so
    // this pins the library fix on its own.
    expect(intervalRunPoint('\\frac{x}{49}', 49)).toEqual({ lo: 1, hi: 1 });
    // `49 / 4.9` is the double 10, but 10 is NOT the true quotient: the
    // double written `4.9` is a little ABOVE 4.9, so the real value is just
    // under 10. The point `[10, 10]` would exclude it, and the library
    // therefore reports the one-ulp neighbourhood of 10 instead.
    const q = intervalRunPoint('\\frac{x}{4.9}', 49);
    expect(q.lo).toBeLessThan(10);
    expect(q.hi).toBeGreaterThan(10);
    expect(q.hi - q.lo).toBeLessThan(1e-14);
  });

  test('an unbounded operand keeps its enclosure', () => {
    // `[1, ∞) / [2, ∞)` is `[0, ∞)`: the `∞ / ∞` corner is annihilated by
    // the same convention `_prod` uses for `0 · ∞`.
    const r = compile(ce.parse('\\frac{x}{y}'), { to: 'interval-js' });
    expect(r.success).toBe(true);
    const out = r.run!({
      x: { lo: 1, hi: Infinity },
      y: { lo: 2, hi: Infinity },
    }) as { value: { lo: number; hi: number } };
    expect(out.value.lo).toBe(0);
    expect(out.value.hi).toBe(Infinity);
  });
});
