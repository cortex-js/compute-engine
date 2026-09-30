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

  test('parse route: \\zeta(-1, a) parses to Zeta and matches HurwitzZeta(-1,a) for a positive a', () => {
    const engine = new ComputeEngine();
    engine.assume(engine.box(['Greater', 'a', 0]));
    const parsed = engine.parse('\\zeta(-1, a)');
    expect(parsed.operator).toBe('Zeta');
    expect(
      parsed.evaluate().isSame(engine.box(['HurwitzZeta', -1, 'a']).evaluate())
    ).toBe(true);
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
  //
  // The engine is built in `beforeAll`, not when the file loads: building an
  // engine sets the module-global `BigDecimal.precision`, which the printed
  // digits follow, so an engine built by an earlier test would otherwise
  // reset it to 21 digits.
  let precise: ComputeEngine;
  beforeAll(() => {
    precise = new ComputeEngine();
    precise.precision = 40;
  });

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

  test('ζ(−12,a) still evaluates at the order cap for a symbolic a', () => {
    const r = hurwitzZeta(-12, 'a').evaluate();
    expect(r.operator).not.toBe('HurwitzZeta');
  });

  test('ζ(−13,a) stays symbolic past the order cap for a symbolic a', () => {
    const r = hurwitzZeta(-13, 'a').evaluate();
    expect(r.json).toEqual(['HurwitzZeta', -13, 'a']);
  });

  test('ζ(−13,x+y) stays symbolic: the expansion is not built', () => {
    const r = ce.expr(['HurwitzZeta', -13, ['Add', 'x', 'y']]).evaluate();
    expect(r.operator).toBe('HurwitzZeta');
  });

  test('ζ(−100,2.5) still evaluates at the order cap for a numeric a', () => {
    // mpmath (dps = 30): zeta(-100, 2.5) = -406561177535215237.397279707567
    const r = hurwitzZeta(-100, 2.5).N();
    expect(r.toString()).toBe('-406561177535215237.397');
  });
});

describe('Zeta(s, a) with a symbolic a: the Bernoulli polynomial only for a positive a', () => {
  // The two-operand `Zeta` is Wolfram's generalized zeta: a term with
  // k + a < 0 is |k + a|^(−s), so for a negative a it differs from
  // HurwitzZeta, whose value is the Bernoulli polynomial for every a.
  test('Zeta(−1, a) with no assumption on a stays symbolic', () => {
    const engine = new ComputeEngine();
    const r = engine.box(['Zeta', -1, 'a']).evaluate();
    expect(r.json).toEqual(['Zeta', -1, 'a']);
  });

  test('Zeta(−1, a) with a > 0 is the polynomial −a²/2 + a/2 − 1/12', () => {
    const engine = new ComputeEngine();
    engine.assume(engine.box(['Greater', 'a', 0]));
    const expected = engine.box([
      'Add',
      ['Multiply', ['Rational', -1, 2], ['Power', 'a', 2]],
      ['Multiply', ['Rational', 1, 2], 'a'],
      ['Rational', -1, 12],
    ]);
    expect(engine.box(['Zeta', -1, 'a']).evaluate().isSame(expected)).toBe(
      true
    );
  });

  test('Zeta(−1, −5/2) = 109/24, HurwitzZeta(−1, −5/2) = −107/24', () => {
    // Zeta: |−5/2| + |−3/2| + |−1/2| + ζ(−1, 1/2) = 9/2 + 1/24 = 109/24.
    // HurwitzZeta: −B₂(−5/2)/2 = −(25/4 + 5/2 + 1/6)/2 = −107/24.
    expect(
      ce
        .box(['Zeta', -1, ['Rational', -5, 2]])
        .evaluate()
        .isSame(ce.number([109, 24]))
    ).toBe(true);
    expect(
      hurwitzZeta(-1, ['Rational', -5, 2])
        .evaluate()
        .isSame(ce.number([-107, 24]))
    ).toBe(true);
  });

  test('HurwitzZeta(−1, a) with no assumption on a is the polynomial', () => {
    const engine = new ComputeEngine();
    const r = engine.box(['HurwitzZeta', -1, 'a']).evaluate();
    expect(r.operator).not.toBe('HurwitzZeta');
  });
});

describe('HurwitzZeta at a non-positive integer order: the cost is bounded', () => {
  // Each of these took more than a minute when the exact value was
  // reduced after every step of the evaluation.
  test('ζ(−100, 1e−300).N() = 2.83822495706937069593e−222', () => {
    // mpmath: zeta(-100, mpf('1e-300')) = 2.838224957069370695926415633648e-222
    const r = ce.box(['HurwitzZeta', -100, { num: '1e-300' }]).N();
    expect(r.toString()).toBe('2.83822495706937069593e-222');
  });

  test('ζ(−50, 1e−2000).N() = −7.50086674607696436686e−1976', () => {
    // mpmath: zeta(-50, mpf('1e-2000')) = -7.500866746076964366863e-1976
    const r = ce.box(['HurwitzZeta', -50, { num: '1e-2000' }]).N();
    expect(r.toString()).toBe('-7.50086674607696436686e-1976');
  });

  test('ζ(−50, 1e−200000).N() = −7.50086674607696436686e−199976', () => {
    // Past the size of the exact evaluation: the big-decimal kernel
    // evaluates the polynomial by Horner's rule instead.
    // mpmath: -bernpoly(51, mpf('1e-200000'))/51 = -7.500866746076964366856e-199976
    const r = ce.box(['HurwitzZeta', -50, { num: '1e-200000' }]).N();
    expect(r.toString()).toBe('-7.50086674607696436686e-199976');
  });

  test('ζ(−2.5, 1e−200000).N() at a non-integer order', () => {
    // mpmath: zeta(-2.5, mpf('1e-200000')) = 0.008516928777850330542358567028
    const r = ce.box(['HurwitzZeta', -2.5, { num: '1e-200000' }]).N();
    expect(r.toString()).toBe('0.00851692877785033054236');
  });

  test('ζ(2.5, 1e−2000).N() = 1e+5000, not a pole', () => {
    // The double of 1e−2000 is 0, a non-positive integer; the big decimal
    // is not. mpmath: zeta(2.5, mpf('1e-2000')) = 1.0e+5000
    const r = ce.box(['HurwitzZeta', 2.5, { num: '1e-2000' }]).N();
    expect(r.toString()).toBe('1e+5000');
  });

  test('LerchPhi(0.5, 2.5, 1e−2000).N() = 1e+5000, not a pole', () => {
    // The same double pole test in `LerchPhi`; the arbitrary-precision
    // series answers. mpmath: lerchphi(mpf('0.5'), mpf('2.5'), mpf('1e-300'))
    // = 1.0e+750 (the 1e−2000 point is beyond mpmath's exponent range at
    // 30 digits; the value is a^(−s) to every printed digit).
    expect(
      ce
        .box(['LerchPhi', 0.5, 2.5, { num: '1e-2000' }])
        .N()
        .toString()
    ).toBe('1e+5000');
    expect(
      ce
        .box(['LerchPhi', 0.5, 2.5, { num: '1e-300' }])
        .N()
        .toString()
    ).toBe('1e+750');
  });

  test('ζ(−100, 1/3.0).N() at a precision of 100 digits', () => {
    // mpmath (dps = 100): zeta(-100, mpf(1)/3) =
    //   391198857634904826436744565576560122224802698855781321117933752755922224261470.1180067883935612620019
    const engine = new ComputeEngine();
    engine.precision = 100;
    const r = engine
      .box(['HurwitzZeta', -100, ['Divide', 1, { num: '3.0' }]])
      .N();
    expect(r.toString()).toBe(
      '3.91198857634904826436744565576560122224802698855781321117933752755922224261470118006788393561262002e+77'
    );
  });

  test('ζ(−100, 1/10³⁰⁰) stays symbolic under evaluate(): the exact value is too large', () => {
    const r = ce
      .box(['HurwitzZeta', -100, ['Rational', 1, { num: '1e300' }]])
      .evaluate();
    expect(r.operator).toBe('HurwitzZeta');
  });

  test('ζ(−60, 2+3i).N() at machine precision uses the exact polynomial', () => {
    // mpmath: zeta(-60, 2+3j) = -919246731053263160871639644888.5 + 2.614935630046239774352e+41j
    const engine = new ComputeEngine();
    engine.precision = 'machine';
    const r = engine.box(['HurwitzZeta', -60, ['Complex', 2, 3]]).N();
    expect(r.re / -9.192467310532632e29).toBeCloseTo(1, 14);
    expect(r.im / 2.61493563004624e41).toBeCloseTo(1, 14);
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
