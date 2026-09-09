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

function codeOf(latex: string, to: 'javascript' | 'glsl' | 'python'): string {
  const r = compile(ce.parse(latex), { to });
  expect(r.success).toBe(true);
  return r.code!;
}

function intervalCodeOf(latex: string): string {
  const r = compile(ce.parse(latex), { to: 'interval-js' });
  expect(r.success).toBe(true);
  return r.code;
}

/** The compiled JavaScript value of `latex` at `x`. */
function jsRun(latex: string, x: number): number {
  const r = compile(ce.parse(latex), { to: 'javascript' });
  expect(r.success).toBe(true);
  return r.run!({ x }) as number;
}

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

describe('COMPILE a rational factor as a division', () => {
  test('`x / 49` divides on every target', () => {
    expect(codeOf('\\frac{x}{49}', 'javascript')).toBe('_.x / 49');
    expect(codeOf('\\frac{x}{49}', 'glsl')).toBe('x / 49.0');
    expect(codeOf('\\frac{x}{49}', 'python')).toBe('x / 49');
    expect(intervalCodeOf('\\frac{x}{49}')).toBe('_IA.div(_.x, _IA.point(49))');
  });

  test('a divisor with 32 zero low bits is not a power of two', () => {
    // `49 · 2^32` is not a power of two, but its low 32 bits are all zero, so
    // the JavaScript bitwise test `(q & (q - 1)) === 0` — which truncates its
    // operand to 32 bits — read it as one and kept the rounded reciprocal.
    expect(codeOf('\\frac{x}{210453397504}', 'javascript')).toBe(
      '_.x / 210453397504'
    );
    expect(intervalCodeOf('\\frac{x}{210453397504}')).toBe(
      '_IA.div(_.x, _IA.point(210453397504))'
    );
    expect(jsRun('\\lfloor\\frac{x}{210453397504}\\rfloor', 210453397504)).toBe(
      1
    );
  });

  test('`floor(x / 49)` answers the interpreter at exact multiples', () => {
    expect(codeOf('\\lfloor\\frac{x}{49}\\rfloor', 'javascript')).toBe(
      'Math.floor(_.x / 49)'
    );
    expect(codeOf('\\lfloor\\frac{x}{49}\\rfloor', 'glsl')).toBe(
      'floor(x / 49.0)'
    );
    expect(intervalCodeOf('\\lfloor\\frac{x}{49}\\rfloor')).toBe(
      '_IA.floor(_IA.div(_.x, _IA.point(49)))'
    );
    expect(jsRun('\\lfloor\\frac{x}{49}\\rfloor', 49)).toBe(1);
    expect(jsRun('\\lfloor\\frac{x}{49}\\rfloor', 98)).toBe(2);
    expect(intervalRunPoint('\\lfloor\\frac{x}{49}\\rfloor', 49)).toEqual({
      lo: 1,
      hi: 1,
    });
    expect(intervalRunPoint('\\lfloor\\frac{x}{49}\\rfloor', 98)).toEqual({
      lo: 2,
      hi: 2,
    });
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

  test('the numerator multiplies the quotient, after the division', () => {
    // `x / q * p`, never `(p * x) / q`: the product `p * x` overflows to
    // infinity for an `x` whose quotient is finite, and on a 32-bit shader
    // float that limit is about 1e38.
    expect(codeOf('\\frac{3x}{49}', 'javascript')).toBe('_.x / 49 * 3');
    expect(codeOf('\\frac{3x}{49}', 'glsl')).toBe('x / 49.0 * 3.0');
    expect(codeOf('\\frac{3x}{49}', 'python')).toBe('x / 49 * 3');
    expect(intervalCodeOf('\\frac{3x}{49}')).toBe(
      '_IA.mul(_IA.div(_.x, _IA.point(49)), _IA.point(3))'
    );
    expect(codeOf('\\frac{-3x}{49}', 'javascript')).toBe('_.x / 49 * -3');
    expect(intervalCodeOf('\\frac{-3x}{49}')).toBe(
      '_IA.mul(_IA.div(_.x, _IA.point(49)), _IA.point(-3))'
    );
  });

  test('a large operand does not overflow before the division', () => {
    // `2x/3` at `x = 1e308`: `2 * x` is `Infinity`, `x / 3 * 2` is finite.
    expect(codeOf('\\frac{2x}{3}', 'javascript')).toBe('_.x / 3 * 2');
    const got = jsRun('\\frac{2x}{3}', 1e308);
    expect(Number.isFinite(got)).toBe(true);
    expect(got).toBe(ce.parse('\\frac{2x}{3}').subs({ x: 1e308 }).N().re);
  });

  test('a numerator of -1 becomes a unary negation', () => {
    // `-(a / q)` and `(-a) / q` are the same float: IEEE negation is exact
    // and round-to-nearest is sign-symmetric.
    expect(codeOf('-\\frac{x}{49}', 'javascript')).toBe('-(_.x / 49)');
    expect(codeOf('\\frac{x}{-49}', 'javascript')).toBe('-(_.x / 49)');
    expect(codeOf('-\\frac{x}{49}', 'glsl')).toBe('-(x / 49.0)');
    expect(intervalCodeOf('\\frac{x}{-49}')).toBe(
      '_IA.div(_IA.negate(_.x), _IA.point(49))'
    );
    expect(jsRun('-\\frac{x}{49}', 49)).toBe(-1);
  });

  test('a constant factor stays in the product', () => {
    // `π` stays in the numerator; only the rational numerator `2` moves past
    // the division.
    expect(codeOf('\\frac{2\\pi x}{49}', 'javascript')).toBe(
      '(Math.PI * _.x) / 49 * 2'
    );
    expect(codeOf('\\frac{2\\pi x}{49}', 'glsl')).toBe(
      '(3.14159265359 * x) / 49.0 * 2.0'
    );
    // π compiles to a two-ulp enclosure, which the numerator keeps as it
    // stands: there is no second constant next to it to fold with.
    expect(intervalCodeOf('\\frac{2\\pi x}{49}')).toBe(
      '_IA.mul(_IA.div(_IA.mul({ lo: 3.1415926535897927, ' +
        'hi: 3.1415926535897936 }, _.x), _IA.point(49)), _IA.point(2))'
    );
  });

  test('the rewrite composes with a surrounding sum', () => {
    expect(codeOf('\\frac{x}{49} + 1', 'javascript')).toBe('_.x / 49 + 1');
    expect(intervalCodeOf('\\frac{x}{49} + 1')).toBe(
      '_IA.add(_IA.div(_.x, _IA.point(49)), _IA.point(1))'
    );
  });

  test('an unrolled Sum body divides in every term', () => {
    expect(codeOf('\\sum_{n=1}^{3}\\frac{n x}{49}', 'javascript')).toBe(
      '((_.x / 49) + ((2 * _.x) / 49) + ((3 * _.x) / 49))'
    );
    // The divisor constant occurs three times, so the interval target hoists
    // it into one preamble constant (`_k1`) and the terms read the name.
    expect(intervalCodeOf('\\sum_{n=1}^{3}\\frac{n x}{49}')).toBe(
      '_IA.add(_IA.div(_.x, _k1), _IA.add(_IA.div(_IA.mul(' +
        '_IA.point(2), _.x), _k1), _IA.div(_IA.mul(_IA.point(3), ' +
        '_.x), _k1)))'
    );
    // 6x/49 at x = 49 is exactly 6.
    expect(jsRun('\\sum_{n=1}^{3}\\frac{n x}{49}', 49)).toBe(6);
  });
});

describe('COMPILE what the rational rewrite must NOT touch', () => {
  test('a power-of-two denominator keeps the exact reciprocal product', () => {
    // `1/2`, `1/8` and `3/8` are exact binary fractions, so the product is
    // already correctly rounded and shorter than a division.
    expect(codeOf('\\frac{x}{2}', 'javascript')).toBe('0.5 * _.x');
    expect(codeOf('\\frac{x}{8}', 'javascript')).toBe('0.125 * _.x');
    expect(codeOf('\\frac{3x}{8}', 'javascript')).toBe('0.375 * _.x');
    expect(codeOf('\\frac{x}{2}', 'glsl')).toBe('0.5 * x');
    expect(intervalCodeOf('\\frac{x}{2}')).toBe('_IA.mul(_IA.point(0.5), _.x)');
    // A power of two past the 32-bit range is still exempt.
    expect(codeOf('\\frac{x}{4294967296}', 'javascript')).toBe(
      '2.3283064365386963e-10 * _.x'
    );
  });

  test('a decimal divisor is not on this path', () => {
    // `x / 1.6` stays a `Divide` node through canonicalization.
    expect(codeOf('\\frac{x}{1.6}', 'javascript')).toBe('_.x / 1.6');
    expect(intervalCodeOf('\\frac{x}{1.6}')).toBe(
      '_IA.div(_.x, _IA.point(1.6))'
    );
  });

  test('a literal with a radical part is not a plain rational', () => {
    // `√2 / 49` is an exact value, but not a rational one.
    expect(codeOf('\\frac{\\sqrt{2}x}{49}', 'javascript')).toBe(
      '0.028861501272920306 * _.x'
    );
  });

  test('dividing BY a rational multiplies, as before', () => {
    // `x / (1/49)` canonicalizes to `Multiply(49, x)` — an integer factor,
    // with no denominator to divide by.
    expect(codeOf('x / (1/49)', 'javascript')).toBe('49 * _.x');
  });

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
