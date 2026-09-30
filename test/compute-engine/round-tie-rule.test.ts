import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * `Round` at a half rounds AWAY FROM ZERO, at every precision and on every
 * route (user decision, 2026-09-21): `Round(-0.5)` is `-1`, `Round(-1.5)` is
 * `-2`, `Round(0.5)` is `1` and `Round(2.5)` is `3`. JavaScript `Math.round`
 * rounds a half toward `+∞` instead, so no route may call it directly for
 * `Round`.
 *
 * The engine is built inside each test, because the precision of the
 * big-number library is module-global: an engine built at one precision
 * changes the precision of an engine built before it.
 */

/** The four values the decision names, and the two other halves beside them. */
const TIES: [number, number][] = [
  [-0.5, -1],
  [0.5, 1],
  [-1.5, -2],
  [2.5, 3],
  [-2.5, -3],
  [1.5, 2],
];

function engineAt(precision: 'machine' | number): ComputeEngine {
  const ce = new ComputeEngine();
  ce.precision = precision;
  return ce;
}

describe.each(['machine', 21] as const)('Round at a half (precision %s)', (p) => {
  test('a machine float rounds away from zero', () => {
    const ce = engineAt(p);
    for (const [x, want] of TIES)
      expect([x, ce.box(['Round', x]).evaluate().re]).toEqual([x, want]);
  });

  test('an exact rational rounds away from zero', () => {
    const ce = engineAt(p);
    expect(ce.box(['Round', ['Rational', -1, 2]]).evaluate().re).toBe(-1);
    expect(ce.box(['Round', ['Rational', -3, 2]]).evaluate().re).toBe(-2);
    expect(ce.box(['Round', ['Rational', 1, 2]]).evaluate().re).toBe(1);
    expect(ce.box(['Round', ['Rational', 5, 2]]).evaluate().re).toBe(3);
  });

  test('the precision form rounds a half away from zero too', () => {
    const ce = engineAt(p);
    // `Round(x, n)` is `Round(x·10ⁿ)/10ⁿ`, so the tie of the scaled value
    // follows the same rule: −0.125·100 is −12.5, which rounds to −13.
    expect(ce.box(['Round', -0.125, 2]).evaluate().re).toBeCloseTo(-0.13, 12);
    expect(ce.box(['Round', 0.125, 2]).evaluate().re).toBeCloseTo(0.13, 12);
    expect(ce.box(['Round', -1.25, 1]).evaluate().re).toBeCloseTo(-1.3, 12);
    expect(ce.box(['Round', 1.25, 1]).evaluate().re).toBeCloseTo(1.3, 12);
    // A negative `n` rounds to tens, hundreds, … and follows the same rule:
    // −1250·10⁻² is −12.5, which rounds to −13, hence −1300.
    expect(ce.box(['Round', -1250, -2]).evaluate().re).toBe(-1300);
    expect(ce.box(['Round', 1250, -2]).evaluate().re).toBe(1300);
  });

  test('the sign agrees with the value', () => {
    const ce = engineAt(p);
    expect(ce.box(['Round', -0.5]).sgn).toBe('negative');
    expect(ce.box(['Round', -0.5]).evaluate().re).toBe(-1);
  });
});

describe('Round at a half over a list of machine numbers', () => {
  test('a short list rounds every element away from zero', () => {
    const ce = engineAt('machine');
    const r = ce.box(['Round', ['List', -0.5, 0.5, -1.5, 2.5]]).evaluate();
    expect(r.operator).toBe('List');
    expect(r.ops!.map((x) => x.re)).toEqual([-1, 1, -2, 3]);
  });

  test('a list of 200 numbers takes the eager kernel and rounds away from zero', () => {
    const ce = engineAt('machine');
    // Above a hundred elements the list is computed at once on doubles
    // (`machine-broadcast.ts`), which is the route this pins. The first six
    // elements are the halves; the rest are quarters, which no rule ties.
    const values = [
      ...TIES.map(([x]) => x),
      ...Array.from({ length: 194 }, (_, i) => i - 97 + 0.25),
    ];
    ce.declare('L', { value: ce.box(['List', ...values]) });
    const r = ce.box(['Round', 'L']).evaluate();
    expect(r.operator).toBe('List');
    const got = r.ops!.map((x) => x.re);
    expect(got.length).toBe(200);
    expect(got.slice(0, 6)).toEqual(TIES.map(([, want]) => want));
    // Every element answers what the same value answers on its own.
    for (let i = 0; i < values.length; i++)
      expect([values[i], got[i]]).toEqual([
        values[i],
        ce.box(['Round', values[i]]).evaluate().re,
      ]);
  });
});

describe('Round at a half in compiled JavaScript', () => {
  test('the compiled value matches the interpreter', () => {
    const ce = engineAt('machine');
    ce.declare('x', 'real');
    const fn = compile(ce.box(['Round', 'x']));
    expect(fn).not.toBeNull();
    for (const [x, want] of TIES)
      expect([x, fn!.run({ x })]).toEqual([x, want]);
  });

  test('the compiled precision form matches the interpreter', () => {
    const ce = engineAt('machine');
    ce.declare('x', 'real');
    const fn = compile(ce.box(['Round', 'x', 2]));
    expect(fn).not.toBeNull();
    expect(fn!.run({ x: -0.125 })).toBeCloseTo(-0.13, 12);
    expect(fn!.run({ x: 0.125 })).toBeCloseTo(0.13, 12);
    const tens = compile(ce.box(['Round', 'x', -2]));
    expect(tens!.run({ x: -1250 })).toBe(-1300);
  });
});

/**
 * The rounding family answers an EXACT number for a float argument, as in
 * Mathematica (cortex-js/compute-engine#351): `Round(2.5)` is the integer `3`,
 * not the float `3.0`, and `Round(3.14159, 2)` is the rational `157/50`. This
 * is an exception to the rule that a float operand makes a numeric result a
 * float. Under `.N()` the result is a float.
 */
describe('Rounding a float gives an exact result', () => {
  test('the precision form gives an exact rational', () => {
    const ce = engineAt('machine');
    const r = ce.box(['Round', 3.14159, 2]).evaluate();
    expect(r.json).toEqual(['Rational', 157, 50]);
    expect(r.isExact).toBe(true);
    // A negative `n` rounds to hundreds and gives an exact integer.
    const tens = ce.box(['Round', 1234.5, -2]).evaluate();
    expect(tens.json).toBe(1200);
    expect(tens.isExact).toBe(true);
  });

  test('Round, Floor, Ceil and Truncate give exact integers', () => {
    const ce = engineAt('machine');
    const cases: [string, number, number][] = [
      ['Round', 2.5, 3],
      ['Floor', 2.7, 2],
      ['Ceil', 2.2, 3],
      ['Truncate', -2.7, -2],
    ];
    for (const [op, x, want] of cases) {
      const r = ce.box([op, x]).evaluate();
      expect([op, x, r.json, r.isExact]).toEqual([op, x, want, true]);
    }
  });

  test('a big-decimal float rounds to an exact integer', () => {
    const ce = engineAt(30);
    const x = ce.parse('2.5');
    expect(x.isExact).toBe(false);
    const r = ce.box(['Round', x]).evaluate();
    expect(r.json).toBe(3);
    expect(r.isExact).toBe(true);
  });

  test('a large float keeps all its digits', () => {
    const ce = engineAt('machine');
    const r = ce.parse('\\lfloor 10^{20} + 0.5 \\rfloor').evaluate();
    expect(r.isExact).toBe(true);
    expect(r.isSame(ce.number(10n ** 20n))).toBe(true);
    const m = ce.box(['Floor', 1e20]).evaluate();
    expect(m.isExact).toBe(true);
    expect(m.isSame(ce.number(10n ** 20n))).toBe(true);
  });

  test('infinities and NaN are unchanged', () => {
    const ce = engineAt('machine');
    expect(ce.box(['Round', 'PositiveInfinity']).evaluate().json).toBe(
      'PositiveInfinity'
    );
    expect(ce.box(['Round', 'NaN']).evaluate().json).toBe('NaN');
  });

  test('under N the result is a float', () => {
    const ce = engineAt('machine');
    const r = ce.box(['Round', 3.14159, 2]).N();
    expect(r.isExact).toBe(false);
    expect(r.re).toBeCloseTo(3.14, 12);
    expect(ce.box(['Round', 2.5]).N().json).toEqual({ num: '3.0' });
  });
});

/**
 * `Floor`, `Ceil`, `Truncate` and `Round` of an EXACT real literal are
 * computed with `bigint` arithmetic, at every precision
 * (cortex-js/compute-engine#382). Before, the value was first converted to
 * a double or to a big decimal at the working precision, so a value with
 * more integer digits than that precision lost its low digits:
 * `Floor((25! − 1)/24!)` was `25`, not `24`.
 *
 * The expected values are computed here with `bigint` division, independently
 * of the engine.
 */
describe.each(['machine', 21, 60] as const)(
  'Rounding of an exact literal (precision %s)',
  (p) => {
    const F24 = 620448401733239439360000n; // 24!
    const BIG = 15511210043330985983999999n; // 25! − 1

    // Independent reference: floor, ceil, trunc and round-half-away-from-zero
    // of `num/den`, with `den > 0`.
    const floorDiv = (n: bigint, d: bigint) => {
      const q = n / d;
      return n % d !== 0n && n < 0n ? q - 1n : q;
    };
    const reference = (n: bigint, d: bigint) => {
      const floor = floorDiv(n, d);
      const exact = n % d === 0n;
      const ceil = exact ? floor : floor + 1n;
      const trunc = n < 0n ? ceil : floor;
      // |n/d| rounded half away from zero, then the sign restored.
      const a = n < 0n ? -n : n;
      const r = (2n * a + d) / (2n * d);
      return {
        Floor: floor,
        Ceil: ceil,
        Truncate: trunc,
        Round: n < 0n ? -r : r,
      };
    };
    const big = (n: bigint) => ({ num: n.toString() });

    const RATIONALS: [bigint, bigint][] = [
      [BIG, F24], // 24.99…: the reported case
      [BIG, 3n],
      [-BIG, 3n],
      [BIG, 2n], // a tie
      [-BIG, 2n], // a negative tie
      [BIG, 1n], // a big integer
      [-BIG, 1n],
      [10n ** 30n + 10n, 1n],
      [123456789012345678901234567n, 10n],
      [10n ** 30n / 2n - 1n, 10n ** 30n], // 1/2 − 10⁻³⁰
      [-(10n ** 30n / 2n - 1n), 10n ** 30n],
      [7n, 123456789012345678901234567n],
      [-7n, 123456789012345678901234567n],
      [5n, 2n],
      [-5n, 2n],
    ];

    test.each(['Floor', 'Ceil', 'Truncate', 'Round'] as const)(
      '%s of an exact rational is exact',
      (op) => {
        const ce = engineAt(p);
        for (const [n, d] of RATIONALS) {
          const r = ce.box([op, ['Rational', big(n), big(d)]]).evaluate();
          const want = reference(n, d)[op];
          expect([op, `${n}/${d}`, r.isExact, r.toString()]).toEqual([
            op,
            `${n}/${d}`,
            true,
            ce.number(want).toString(),
          ]);
        }
      }
    );

    test('a rational times a radical is rounded exactly', () => {
      const ce = engineAt(p);
      // ⌊√2·10⁴⁰⌋ = isqrt(2·10⁸⁰), and √2·10⁴⁰ is not an integer.
      const x = ['Multiply', ['Sqrt', 2], ['Power', 10, 40]];
      const floor = 14142135623730950488016887242096980785696n;
      expect(floor * floor <= 2n * 10n ** 80n).toBe(true);
      expect((floor + 1n) ** 2n > 2n * 10n ** 80n).toBe(true);
      expect(ce.box(['Floor', x]).evaluate().toString()).toBe(
        ce.number(floor).toString()
      );
      expect(ce.box(['Ceil', x]).evaluate().toString()).toBe(
        ce.number(floor + 1n).toString()
      );
      // −(3/7)·√5 ≈ −0.958
      const y = ['Multiply', ['Rational', -3, 7], ['Sqrt', 5]];
      expect(ce.box(['Floor', y]).evaluate().json).toBe(-1);
      expect(ce.box(['Ceil', y]).evaluate().json).toBe(0);
      expect(ce.box(['Round', y]).evaluate().json).toBe(-1);
      expect(ce.box(['Truncate', y]).evaluate().json).toBe(0);
    });

    test('Fract and the precision form of Round use the exact floor', () => {
      const ce = engineAt(p);
      // BIG = 25! − 1 ≡ 2 (mod 3)
      expect(
        ce.box(['Fract', ['Rational', big(BIG), 3]]).evaluate().json
      ).toEqual(['Rational', 2, 3]);
      expect(ce.box(['Fract', big(BIG)]).evaluate().json).toBe(0);
      // Round(BIG/3, 2) = round(100·BIG/3)/100
      const scaled = reference(100n * BIG, 3n).Round;
      expect(
        ce
          .box(['Round', ['Rational', big(BIG), 3], 2])
          .evaluate()
          .toString()
      ).toBe(
        ce
          .box(['Rational', big(scaled), 100])
          .evaluate()
          .toString()
      );
    });

    test('the sign of Round of an exact literal is exact', () => {
      const ce = engineAt(p);
      const r = ce.box([
        'Round',
        ['Rational', big(10n ** 30n / 2n - 1n), big(10n ** 30n)],
      ]);
      expect(r.sgn).toBe('zero');
    });
  }
);

/**
 * `.N()` promises a RESULT correct to the working precision, not a float at
 * every step (user decision, 2026-09-30). A rounding function jumps at a
 * point, so an operand whose exact value is known is rounded exactly under
 * `.N()` too: the float of `(25! − 1)/24!` at 21 digits is `25`, but its
 * floor is `24`. Each expected value below was checked in Mathematica 15
 * (`N[Floor[(25!-1)/24!]]` is `24.`, `N[Round[1/2 - 10^-30]]` is `0.`,
 * `N[FractionalPart[(25!-1)/3]]` is `0.6666…`) and is computed here again
 * with `bigint` arithmetic.
 */
describe.each(['machine', 21] as const)(
  'Rounding of an exact operand under N (precision %s)',
  (p) => {
    const F24 = 620448401733239439360000n; // 24!
    const BIG = 15511210043330985983999999n; // 25! − 1
    const big = (n: bigint) => ({ num: n.toString() });
    // (25! − 1)/24! with the factorial unevaluated, so that the operand is
    // an expression, not a literal.
    const quotient = ['Divide', big(BIG), ['Factorial', 24]];
    // 1/2 − 10⁻³⁰: an exact value whose float is 0.5.
    const nearHalf = ['Subtract', ['Rational', 1, 2], ['Power', 10, -30]];

    test('the rounding family rounds the exact value', () => {
      const ce = engineAt(p);
      const q = BIG / F24; // BIG is not a multiple of 24!
      expect(q).toBe(24n);
      expect(BIG % F24 !== 0n).toBe(true);
      const cases: [string, bigint][] = [
        ['Floor', q],
        ['Truncate', q],
        ['Ceil', q + 1n],
        // 2·(BIG mod 24!) ≥ 24!, so the value rounds up.
        ['Round', 2n * (BIG % F24) >= F24 ? q + 1n : q],
      ];
      for (const [op, expected] of cases) {
        const r = ce.box([op, quotient]).N();
        expect(r.toString()).toBe(expected.toString());
        // The result of `.N()` is a float, also when the exact value of the
        // operand decided it.
        expect(r.isExact).toBe(false);
      }
    });

    test('the floor of a big exact integer is that integer, approximated', () => {
      const ce = engineAt(p);
      // The integer is exact, so the float is the integer approximated to
      // the working precision: its relative error is at most one unit in
      // the last digit.
      const r = ce.box(['Floor', big(BIG)]).N();
      expect(r.isExact).toBe(false);
      expect(Math.abs(r.re / Number(BIG) - 1)).toBeLessThan(1e-15);
    });

    test('Round of a value just below a half rounds down', () => {
      const ce = engineAt(p);
      expect(ce.box(['Round', nearHalf]).N().re).toBe(0);
      // (25! − 1)/24! − 1/2 = (2·BIG − 24!)/(2·24!), just below 24.5.
      const n = 2n * BIG - F24;
      const d = 2n * F24;
      expect(n / d).toBe(24n);
      expect(2n * (n % d) < d).toBe(true);
      expect(
        ce
          .box(['Round', ['Subtract', quotient, ['Rational', 1, 2]]])
          .N()
          .toString()
      ).toBe('24');
      // Round((25! − 1)/24! − 1/200, 2): 100 times the value is just below
      // 2499.5, so the result is 24.99, approximated.
      const s = 100n * (200n * BIG - F24);
      const t = 200n * F24;
      expect(s / t).toBe(2499n);
      expect(2n * (s % t) < t).toBe(true);
      const r = ce
        .box(['Round', ['Subtract', quotient, ['Rational', 1, 200]], 2])
        .N();
      expect(r.isExact).toBe(false);
      expect(r.re).toBe(24.99);
    });

    test('Fract is computed exactly, and the result is approximated', () => {
      const ce = engineAt(p);
      // BIG ≡ 2 (mod 3)
      expect(BIG % 3n).toBe(2n);
      const r = ce.box(['Fract', ['Divide', big(BIG), 3]]).N();
      expect(r.isExact).toBe(false);
      expect(Math.abs(r.re - 2 / 3)).toBeLessThan(1e-15);
    });

    test('the parse route rounds the exact value', () => {
      const ce = engineAt(p);
      expect(
        ce
          .parse('\\lfloor\\frac{15511210043330985983999999}{24!}\\rfloor')
          .N()
          .toString()
      ).toBe('24');
    });

    test('a float operand and an operand with no exact value do not change', () => {
      const ce = engineAt(p);
      expect(ce.box(['Floor', 2.7]).N().re).toBe(2);
      expect(ce.box(['Round', 3.14159, 2]).N().re).toBe(3.14);
      // π·10³⁰ has no exact number value: the float is rounded.
      const r = ce.box(['Floor', ['Multiply', 'Pi', ['Power', 10, 30]]]).N();
      expect(r.isExact).toBe(false);
      expect(r.re / 1e30).toBeCloseTo(Math.PI, 12);
    });

    test('the sign of a rounding function of an exact expression is exact', () => {
      const ce = engineAt(p);
      // The canonical operand is `Add(1/2, −10⁻³⁰)`, not a literal: the
      // predicates compare it with 1/2 within the tolerance.
      expect(ce.box(['Round', nearHalf]).sgn).toBe('zero');
      expect(ce.box(['Round', nearHalf], { form: 'structural' }).sgn).toBe(
        'zero'
      );
      const nearOne = ['Subtract', 1, ['Power', 10, -30]];
      expect(ce.box(['Floor', nearOne]).sgn).toBe('zero');
      expect(ce.box(['Truncate', nearOne]).sgn).toBe('zero');
      const nearMinusOne = ['Add', -1, ['Power', 10, -30]];
      expect(ce.box(['Ceil', nearMinusOne]).sgn).toBe('zero');
      // The values agree with the signs.
      expect(ce.box(['Floor', nearOne]).evaluate().json).toBe(0);
      expect(ce.box(['Ceil', nearMinusOne]).evaluate().json).toBe(0);
    });
  }
);

/**
 * Under `.N()`, a broadcast of a function that jumps at a point (`Floor`,
 * `Ceil`, `Round`, `Truncate`, `Fract`, `Sign`) over a collection uses the
 * exact elements of an exact collection, as the scalar case does. The
 * broadcast built its cells from the elements AFTER their approximation: at
 * 21 digits, the third element of `Range(1, 3)/3` is `0.999…`, and its floor
 * was `0`.
 */
describe.each(['machine', 21] as const)(
  'A broadcast of a rounding function under N (precision %s)',
  (p) => {
    // 25! = 15511210043330985984000000, so X = 25 − 1/24!: its floor is 24
    // and its ceiling is 25.
    const X = [
      'Divide',
      { num: '15511210043330985983999999' },
      ['Factorial', 24],
    ];
    const thirds = ['Divide', ['Range', 1, 3], 3];

    test('a list that is a collection only after evaluation', () => {
      const ce = engineAt(p);
      expect(ce.box(['Floor', thirds]).N().toString()).toBe('[0,0,1]');
      expect(ce.box(['Ceil', thirds]).N().toString()).toBe('[1,1,1]');
      expect(ce.box(['Truncate', thirds]).N().toString()).toBe('[0,0,1]');
      // Fract(k/3) is 1/3, 2/3, 0.
      const fract = ce.box(['Fract', thirds]).N();
      expect(fract.toString().endsWith(',0]')).toBe(true);
      // Sign(k/3 − 1) is −1, −1, 0.
      expect(
        ce
          .box(['Sign', ['Subtract', thirds, 1]])
          .N()
          .toString()
      ).toBe('[-1,-1,0]');
      // Round(k/2 − 10⁻³⁰) is 0, 1, 1: each value is just below a half.
      expect(
        ce
          .box([
            'Round',
            ['Subtract', ['Divide', ['Range', 1, 3], 2], ['Power', 10, -30]],
          ])
          .N()
          .toString()
      ).toBe('[0,1,1]');
    });

    test('the components of a tuple', () => {
      const ce = engineAt(p);
      expect(
        ce
          .box(['Floor', ['Tuple', X, 1]])
          .N()
          .toString()
      ).toBe('(24, 1)');
      expect(
        ce
          .box(['Ceil', ['Tuple', X, 1]])
          .N()
          .toString()
      ).toBe('(25, 1)');
      // The same values as without `.N()`.
      expect(
        ce
          .box(['Floor', ['Tuple', X, 1]])
          .evaluate()
          .toString()
      ).toBe('(24, 1)');
    });

    test('a lazy broadcast (more than 100 elements)', () => {
      const ce = engineAt(p);
      const r = ce.box(['Floor', ['Divide', ['Range', 1, 300], 3]]).N();
      const at = (k: number) => ce.box(['At', r, k]).evaluate().re;
      expect([at(3), at(299), at(300)]).toEqual([1, 99, 100]);
    });

    test('the parse route', () => {
      const ce = engineAt(p);
      expect(
        ce
          .parse('\\lfloor\\frac{\\operatorname{Range}(1,3)}{3}\\rfloor')
          .N()
          .toString()
      ).toBe('[0,0,1]');
    });

    test('the async route', async () => {
      const ce = engineAt(p);
      const opts = { numericApproximation: true };
      const list = await ce.box(['Floor', thirds]).evaluateAsync(opts);
      expect(list.toString()).toBe('[0,0,1]');
      const tuple = await ce
        .box(['Floor', ['Tuple', X, 1]])
        .evaluateAsync(opts);
      expect(tuple.toString()).toBe('(24, 1)');
      const lazy = await ce
        .box(['Floor', ['Divide', ['Range', 1, 300], 3]])
        .evaluateAsync(opts);
      expect(ce.box(['At', lazy, 300]).evaluate().re).toBe(100);
    });

    test('a broadcast far from a jump does not change', () => {
      const ce = engineAt(p);
      expect(
        ce
          .box(['Floor', ['Multiply', ['Range', 1, 4], 1.5]])
          .N()
          .toString()
      ).toBe('[1,3,4,6]');
      expect(
        ce
          .box(['Floor', ['Divide', ['Range', 1, 3], 4]])
          .N()
          .toString()
      ).toBe('[0,0,0]');
      expect(
        ce
          .box(['Round', ['Tuple', 2.4, 3.6]])
          .N()
          .toString()
      ).toBe('(2, 4)');
    });
  }
);

/**
 * `Mod` and `Heaviside` jump at a point too: `Mod(a, m)` where `a/m` is an
 * integer, and `Heaviside` at 0. Under `.N()`, they use the exact values of
 * exact operands near that point, as the rounding family does. At 21
 * digits, the float of X = (25! − 1)/24! is `25`: `Mod(X, 1)` was `0` and
 * `Heaviside(X − 25)` was `1/2`.
 */
describe.each(['machine', 21] as const)(
  'Mod and Heaviside of an exact operand under N (precision %s)',
  (p) => {
    const F24 = 620448401733239439360000n; // 24!
    const BIG = 15511210043330985983999999n; // 25! − 1
    const X = ['Divide', { num: BIG.toString() }, ['Factorial', 24]];
    const X_LATEX = '\\frac{15511210043330985983999999}{24!}';

    test('the values, checked with bigint arithmetic', () => {
      // X = 24 + (24! − 1)/24!: Mod(X, 1) = 1 − 1/24!.
      expect(BIG / F24).toBe(24n);
      expect(BIG % F24).toBe(F24 - 1n);
      // 25·24! − BIG = 1: X < 25, and Mod(25, X) = 25 − X = 1/24!.
      expect(25n * F24 - BIG).toBe(1n);
    });

    test('Mod uses the exact values of its operands', () => {
      const ce = engineAt(p);
      const r = ce.box(['Mod', X, 1]).N();
      expect(r.isExact).toBe(false);
      expect(r.re).toBe(1);
      const s = ce.box(['Mod', 25, X]).N();
      expect(s.isExact).toBe(false);
      expect(s.re * Number(F24)).toBeCloseTo(1, 12);
      // Far from a jump, and with a float operand, nothing changes.
      expect(ce.box(['Mod', 7, 3]).N().json).toBe(1);
      expect(ce.box(['Mod', 7.5, 2]).N().re).toBe(1.5);
    });

    test('Heaviside uses the exact value of its operand', () => {
      const ce = engineAt(p);
      expect(ce.box(['Heaviside', ['Subtract', X, 25]]).N().json).toBe(0);
      expect(ce.box(['Heaviside', ['Subtract', 25, X]]).N().json).toBe(1);
      expect(ce.box(['Heaviside', 0]).N().json).toEqual(['Rational', 1, 2]);
    });

    test('a broadcast', () => {
      const ce = engineAt(p);
      expect(ce.box(['Mod', ['List', 1, 2, X], 1]).N().toString()).toBe(
        '[0,0,1]'
      );
      const r = ce.box(['Mod', 25, ['List', X, 3]]).N();
      expect(ce.box(['At', r, 1]).evaluate().re * Number(F24)).toBeCloseTo(
        1,
        12
      );
      expect(ce.box(['At', r, 2]).evaluate().re).toBe(1);
      expect(
        ce
          .box(['Heaviside', ['List', -1, 0, ['Subtract', X, 25]]])
          .N()
          .toString()
      ).toBe('[0,1/2,0]');
    });

    test('the parse route', () => {
      const ce = engineAt(p);
      expect(ce.parse(`${X_LATEX} \\bmod 1`).N().re).toBe(1);
      expect(
        ce.parse(`\\operatorname{Heaviside}(${X_LATEX}-25)`).N().json
      ).toBe(0);
    });
  }
);
