/**
 * HurwitzZeta(s,a) at a non-positive integer order s = −n: the Bernoulli
 * polynomial closed form ζ(−n,a) = −Bₙ₊₁(a)/(n+1) (DLMF 25.11.14), built by
 * `hurwitzZetaNegativeIntegerExpression` (library/arithmetic.ts) for a
 * symbolic `a` or a numeric `a` the exact bigint-rational path
 * (`hurwitzZetaNegativeInteger`, numerics/bernoulli.ts) doesn't reach.
 *
 * Reference values are cross-checked against mpmath, not against the
 * implementation: `python3 -c "import mpmath as m; m.mp.dps=30;
 * print(m.zeta(-3, 1+1j))"` and similarly for the other cases (see the
 * comment on each test).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { hurwitzZetaNegativeIntegerGaussian } from '../../src/compute-engine/numerics/bernoulli';

const ce = new ComputeEngine();

function hurwitzZeta(s: number, a: unknown) {
  return ce.expr(['HurwitzZeta', s, a as any]);
}

describe('HurwitzZeta at a non-positive integer order, symbolic a: the Bernoulli polynomial', () => {
  test('ζ(−1,a) = −a²/2 + a/2 − 1/12 (evaluate)', () => {
    const expected = ce.box([
      'Add',
      ['Multiply', ['Rational', -1, 2], ['Power', 'a', 2]],
      ['Multiply', ['Rational', 1, 2], 'a'],
      ['Rational', -1, 12],
    ]);
    expect(hurwitzZeta(-1, 'a').evaluate().isSame(expected)).toBe(true);
  });

  test('ζ(0,a) = 1/2 − a (evaluate)', () => {
    const expected = ce.box(['Subtract', ['Rational', 1, 2], 'a']);
    expect(hurwitzZeta(0, 'a').evaluate().isSame(expected)).toBe(true);
  });

  test('ζ(−1,a) stays the same polynomial under .N() with a still symbolic', () => {
    // No numeric operand to approximate: N() evaluates the same exact
    // polynomial evaluate() does.
    expect(
      hurwitzZeta(-1, 'a').N().isSame(hurwitzZeta(-1, 'a').evaluate())
    ).toBe(true);
  });

  test('parse route: \\zeta(-1, a) parses to Zeta and matches HurwitzZeta(-1,a)', () => {
    const parsed = ce.parse('\\zeta(-1, a)');
    expect(parsed.operator).toBe('Zeta');
    expect(parsed.evaluate().isSame(hurwitzZeta(-1, 'a').evaluate())).toBe(
      true
    );
  });

  test('compound argument: ζ(−1, x + 1 − x) reduces to the polynomial in x', () => {
    const compound = ce.expr([
      'HurwitzZeta',
      -1,
      ['Subtract', ['Add', 'x', 1], 'x'],
    ]);
    expect(compound.evaluate().isSame(hurwitzZeta(-1, 1).evaluate())).toBe(
      true
    );
    // ζ(-1,1) = ζ(-1) = -1/12
    expect(compound.evaluate().isSame(ce.number([-1, 12]))).toBe(true);
  });
});

describe('HurwitzZeta at a non-positive integer order, rational a: unaffected, still exact', () => {
  test('ζ(−3,1/2) = −7/960 (evaluate, exact)', () => {
    // mpmath: zeta(-3, 0.5) = -0.00729166666666666666666666666667
    expect(
      hurwitzZeta(-3, ['Rational', 1, 2])
        .evaluate()
        .isSame(ce.number([-7, 960]))
    ).toBe(true);
  });

  test('ζ(−5,1/3) = 121/61236 (evaluate, exact)', () => {
    // mpmath: zeta(-5, 1/3) = 0.00197596185250506238160559148213
    // sympy: -bernoulli(6, Rational(1,3))/6 = 121/61236
    expect(
      hurwitzZeta(-5, ['Rational', 1, 3])
        .evaluate()
        .isSame(ce.number([121, 61236]))
    ).toBe(true);
  });

  test('compound rational argument: ζ(−3, 1/4 + 1/4) = −7/960', () => {
    const compound = ce.expr([
      'HurwitzZeta',
      -3,
      ['Add', ['Rational', 1, 4], ['Rational', 1, 4]],
    ]);
    expect(compound.evaluate().isSame(ce.number([-7, 960]))).toBe(true);
  });
});

describe('HurwitzZeta at a non-positive integer order, float a: the polynomial, correct to rounding', () => {
  test('ζ(−3,0.1) ≈ 0.00630833333333333333333 (.N())', () => {
    // mpmath: zeta(-3, 0.1) = 0.00630833333333333333333333333333
    const r = hurwitzZeta(-3, 0.1).N();
    expect(r.re).toBeCloseTo(0.00630833333333333333333333333333, 15);
  });

  test('ζ(−1,0.5) = 1/24 ≈ 0.0416666666666667 (.N())', () => {
    // mpmath: zeta(-1, 0.5) = 0.0416666666666666666666666666667
    const r = hurwitzZeta(-1, 0.5).N();
    expect(r.re).toBeCloseTo(1 / 24, 12);
  });
});

describe('HurwitzZeta at a non-positive integer order, complex a: the polynomial, correct to rounding', () => {
  test('ζ(−3,1+i) = 1/120 + i/2 (.N(), the motivating case in #374)', () => {
    // mpmath: zeta(-3, 1+1j) = 0.00833333333333333333333333333333 + 0.5j
    const r = hurwitzZeta(-3, ['Complex', 1, 1]).N();
    expect(r.re).toBeCloseTo(1 / 120, 12);
    expect(r.im).toBeCloseTo(0.5, 12);
  });

  test('ζ(−3,0.3+0.4i) ≈ −0.0194916666666667 − 0.0296i (.N())', () => {
    // mpmath: zeta(-3, 0.3+0.4j) = -0.019491666666666669242384083797
    //                              - 0.0296000000000000030642155479654j
    const r = hurwitzZeta(-3, ['Complex', 0.3, 0.4]).N();
    expect(r.re).toBeCloseTo(-0.019491666666666669242384083797, 12);
    expect(r.im).toBeCloseTo(-0.0296, 12);
  });

  test('compound complex argument: ζ(−3, 1 + i) built from Add', () => {
    const compound = ce.expr([
      'HurwitzZeta',
      -3,
      ['Add', 1, ['Complex', 0, 1]],
    ]);
    const r = compound.N();
    expect(r.re).toBeCloseTo(1 / 120, 12);
    expect(r.im).toBeCloseTo(0.5, 12);
  });
});

describe('hurwitzZetaNegativeIntegerGaussian: exact bigint-rational arithmetic (numerics/bernoulli.ts)', () => {
  // Reference fractions computed independently of this implementation, via
  // sympy: `-bernoulli(n+1, a)/(n+1)` reduced with `sympy.Rational`, and for
  // complex a, `sympy.expand_complex` before taking `re`/`im`.
  test('n=40, a=27/10 (2.7): exact rational, no rounding', () => {
    const value = hurwitzZetaNegativeIntegerGaussian(40, {
      re: [27n, 10n],
      im: [0n, 1n],
    });
    expect(value).toEqual({
      re: [
        -146041752762864596648452516937112437854904590161199516971n,
        50000000000000000000000000000000000000000n,
      ],
      im: [0n, 1n],
    });
  });

  test('n=40, a=21/2 (10.5): exact rational, no rounding', () => {
    const value = hurwitzZetaNegativeIntegerGaussian(40, {
      re: [21n, 2n],
      im: [0n, 1n],
    });
    expect(value).toEqual({
      re: [
        -714817508215194000188363341770895261403249303571029n,
        549755813888n,
      ],
      im: [0n, 1n],
    });
  });

  test('n=99, a=11/2 (5.5): exact rational, no rounding', () => {
    const value = hurwitzZetaNegativeIntegerGaussian(99, {
      re: [11n, 2n],
      im: [0n, 1n],
    });
    expect(value).toEqual({
      re: [
        -59958629711009819292877390833712999293836067946715552858618132742318174176695093485095997719438977663933071924457n,
        2112539725280344297594255891759104000n,
      ],
      im: [0n, 1n],
    });
  });

  test('n=60, a=2+3i: exact Gaussian rational, no rounding', () => {
    const value = hurwitzZetaNegativeIntegerGaussian(60, {
      re: [2n, 1n],
      im: [3n, 1n],
    });
    expect(value).toEqual({
      re: [-1838493462106526321743279289777n, 2n],
      im: [1248370269784074868275667087244022579407093791n, 4774n],
    });
  });
});

describe('HurwitzZeta(s,a).N(): float/complex a with |a| > 1, exact to the digit against mpmath', () => {
  // Reference values: python3 -c "import mpmath as m; m.mp.dps=40;
  // print(m.zeta(-40, m.mpf('2.7')))" and similarly for the other three
  // (a = 10.5, a = 5.5, a = 2+3j). Compared full printed digits, not
  // toBeCloseTo: Horner's method in floating point loses about 6 digits
  // here (terms grow like a^(n+1), past the result, for |a| > 1 — #374),
  // which a loose tolerance would not catch.
  const precise = new ComputeEngine();
  precise.precision = 40;

  test('ζ(−40,2.7) = -2920835055257291.932969050338742248757098', () => {
    const r = precise.box(['HurwitzZeta', -40, 2.7]).N();
    expect(r.toString()).toBe('-2920835055257291.932969050338742248757098');
  });

  test('ζ(−40,10.5) = -1300245472912491095827796637915335416261', () => {
    // The exact value's fractional part (…916261.3128…) falls entirely
    // past 40 significant digits of a 43-digit integer part, so it prints
    // as an integer at this precision — not a defect, just where the cap
    // and the magnitude land (confirmed against the exact fraction with
    // Python's Decimal at 60 digits of precision).
    const r = precise.box(['HurwitzZeta', -40, 10.5]).N();
    expect(r.toString()).toBe('-1300245472912491095827796637915335416261');
  });

  test('ζ(−99,5.5) = -2.838224957074026973519910453585365097856e+76', () => {
    const r = precise.box(['HurwitzZeta', -99, 5.5]).N();
    expect(r.toString()).toBe('-2.838224957074026973519910453585365097856e+76');
  });

  test('ζ(−60,2+3i): exact real part, imaginary part to the digit against mpmath', () => {
    // mpmath: zeta(-60, 2+3j) =
    //   -919246731053263160871639644888.5000000002 + 2.614935630046239774352046684633478381665e+41j
    // The real part is the exact terminating value
    // -1838493462106526321743279289777/2 = -919246731053263160871639644888.5
    // (confirmed independently against sympy's exact fraction above); the
    // "…8.5000000002" mpmath prints past the exact ".5" is mpmath's own
    // floating-point zeta kernel, not a discrepancy in this result. `.re`
    // and `.im` truncate to double precision, so the comparison is against
    // the full-precision `toString()` of the whole complex value, not
    // those properties.
    const r = precise.box(['HurwitzZeta', -60, ['Complex', 2, 3]]).N();
    expect(r.toString()).toBe(
      '(-9.192467310532631608716396448885e+29 + 261493563004623977435204668463347838166500i)'
    );
  });
});

describe('HurwitzZeta at a non-positive integer order: consistency and boundary cases', () => {
  test('ζ(−1,−2) = −37/12: a nonpositive integer a still uses the fast rational path', () => {
    // Unaffected by this change (asRational(-2) already succeeds); the
    // Bernoulli polynomial is the analytic continuation regardless of a's
    // sign, matching Wolfram's HurwitzZeta convention.
    expect(
      hurwitzZeta(-1, -2)
        .evaluate()
        .isSame(ce.number([-37, 12]))
    ).toBe(true);
  });

  test('ζ(−100,a) still evaluates at the order cap', () => {
    const r = hurwitzZeta(-100, 'a').evaluate();
    expect(r.operator).not.toBe('HurwitzZeta');
  });

  test('ζ(−101,a) stays symbolic past the order cap', () => {
    const r = hurwitzZeta(-101, 'a').evaluate();
    expect(r.operator).toBe('HurwitzZeta');
    expect(r.json).toEqual(['HurwitzZeta', -101, 'a']);
  });
});

describe('HurwitzZeta at a non-positive integer order: the compiled JavaScript lane', () => {
  test('a literal complex operand constant-folds to the same accurate value', () => {
    const expr = hurwitzZeta(-3, ['Complex', 1, 1]);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const value = compiled.run() as { re: number; im: number };
    expect(value.re).toBeCloseTo(1 / 120, 12);
    expect(value.im).toBeCloseTo(0.5, 12);
  });

  test('a genuinely complex free variable declines to NaN, not a wrong value', () => {
    ce.declare('z374', 'complex');
    const expr = ce.expr(['HurwitzZeta', -3, 'z374']);
    const compiled = compile(expr);
    expect(compiled.success).toBe(true);
    const value = compiled.run({
      z374: { re: 1, im: 1 },
    }) as number;
    expect(Number.isNaN(value)).toBe(true);
  });
});
