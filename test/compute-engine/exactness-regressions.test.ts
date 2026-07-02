import { engine as ce } from '../utils';

/**
 * Regressions for three verified correctness P0s (WP-2.2):
 *  - P0-2  : `.N()` dropped the square root of a symbolic argument.
 *  - P0-4  : `asBigint` corrupted integers longer than `ce.precision` digits.
 *  - P0-16i: `Sum().evaluate()` numericized exact summands via `.add()`.
 */

const evalStr = (e: any) => ce.box(e).evaluate().toString();
const nStr = (e: any) => ce.box(e).N().toString();

describe('P0-2 — Sqrt.N() keeps the radical on the symbolic part', () => {
  test('Sqrt(y).N() keeps the root', () => {
    // Was `y` (root silently dropped); now stays √y.
    expect(nStr(['Sqrt', 'y'])).toEqual('sqrt(y)');
  });
  test('√(4y).N() → 2√y', () => {
    expect(nStr(['Sqrt', ['Multiply', 4, 'y']])).toEqual('2sqrt(y)');
  });
  test('(y·√y).N() → y^(3/2)', () => {
    // Was `y^2` (from y·y after the root was dropped).
    expect(nStr(['Multiply', 'y', ['Sqrt', 'y']])).toEqual('y^(3/2)');
  });
  test('y^(1/3)·√y .N() → y^(5/6)', () => {
    expect(
      nStr(['Multiply', ['Power', 'y', ['Rational', 1, 3]], ['Sqrt', 'y']])
    ).toEqual('y^(5/6)');
  });
  test('numeric Sqrt still numericizes (control)', () => {
    expect(nStr(['Sqrt', 4])).toEqual('2');
    expect(nStr(['Sqrt', 2]).startsWith('1.414')).toBe(true);
  });
});

describe('P0-4 — asBigint extracts exact integers beyond ce.precision', () => {
  const m127 = 2n ** 127n - 1n; // 39-digit Mersenne prime
  test('IsPrime of an exactly-stored 39-digit Mersenne prime', () => {
    expect(evalStr(['IsPrime', ce.number(m127)])).toEqual('"True"');
  });
  test('IsOdd / IsEven of a 39-digit integer', () => {
    expect(evalStr(['IsOdd', ce.number(m127)])).toEqual('"True"');
    expect(evalStr(['IsEven', ce.number(m127)])).toEqual('"False"');
  });
  test('DigitSum of a 39-digit integer', () => {
    expect(evalStr(['DigitSum', ce.number(m127)])).toEqual('154');
  });
  test('FactorInteger of 10^21+3 (exact, stays exact through Add)', () => {
    expect(evalStr(['FactorInteger', ['Add', ['Power', 10, 21], 3]])).toEqual(
      '[(67, 1),(14925373134328358209, 1)]'
    );
  });
  test('Mod of a large exact integer by a small modulus', () => {
    expect(evalStr(['Mod', ['Add', ['Power', 10, 21], 3], 10])).toEqual('3');
  });
});

describe('P0-16i — Sum.evaluate() preserves exactness', () => {
  test('Sum(√k, k=1..5) stays exact', () => {
    // Was `8.38233…` (float). Canonicalized: 3 + √2 + √3 + √5.
    expect(evalStr(['Sum', ['Sqrt', 'k'], ['Tuple', 'k', 1, 5]])).toEqual(
      '3 + sqrt(2) + sqrt(3) + sqrt(5)'
    );
  });
  test('Sum(√k, k=1..5).N() still numericizes', () => {
    expect(nStr(['Sum', ['Sqrt', 'k'], ['Tuple', 'k', 1, 5]]).startsWith('8.382')).toBe(
      true
    );
  });
  test('numeric sum stays exact and fast (control)', () => {
    expect(evalStr(['Sum', 'k', ['Tuple', 'k', 1, 100]])).toEqual('5050');
    expect(evalStr(['Sum', ['Divide', 1, 'k'], ['Tuple', 'k', 1, 10]])).toEqual(
      '7381/2520'
    );
  });
  test('symbolic summand accumulates symbolically (control)', () => {
    expect(evalStr(['Sum', 'x', ['Tuple', 'k', 1, 3]])).toEqual('3x');
  });
  test('long numeric sum does not lose exactness or blow up', () => {
    const t = Date.now();
    expect(evalStr(['Sum', 'k', ['Tuple', 'k', 1, 100000]])).toEqual(
      '5000050000'
    );
    expect(Date.now() - t).toBeLessThan(5000);
  });
});

/**
 * Regressions for the exact-integer-power P0 package (WP-2.16):
 *  - P0-4 residual / EX-07a-large: `Power(2,127)` rounded to 21 digits.
 *  - P0-16a  : `Power(2,-2)` numericized to a float (0.25 vs 1/4).
 *  - P0-11   : integer powers of exact complex numbers via exp/ln → residue.
 *  - EX-15   : `Power(2,1e15)` produced a value whose `.json` threw.
 */
const jsonOf = (e: any) => JSON.stringify(ce.box(e).evaluate().json);

describe('exact integer powers stay exact (WP-2.16)', () => {
  test('Power(2,127) is the exact 39-digit integer', () => {
    // Was `1.70141183460469231732e+38` (rounded to `ce.precision` digits).
    const expected = '170141183460469231731687303715884105728'; // 2^127
    expect(evalStr(['Power', 2, 127])).toEqual(expected);
    // `.json` must round-trip the exact value. The representation may be a
    // plain JSON number (2^127 is a power of two, hence exactly
    // float-representable) or a `{num}` string — assert value, not form.
    const roundTripped = ce.box(ce.box(['Power', 2, 127]).evaluate().json);
    expect(roundTripped.isSame(ce.number(2n ** 127n))).toBe(true);
    expect(ce.box(['Power', 2, 127]).evaluate().isInteger).toBe(true);
  });

  test('IsPrime(2^127−1) is True end-to-end (via Power)', () => {
    // The Mersenne prime M127, reached by parsing/subtracting through Power.
    expect(evalStr(['IsPrime', ['Subtract', ['Power', 2, 127], 1]])).toEqual(
      '"True"'
    );
  });

  test('(2^127)^2 = 2^254 is exact (large exact base, folded)', () => {
    // Was rounded to 21 digits by the ExactNumericValue SMALL_INTEGER guard.
    expect(evalStr(['Power', ce.number(2n ** 127n), 2])).toEqual(
      (2n ** 254n).toString()
    );
  });

  test('2^{100} parses+evaluates to the exact integer', () => {
    expect(ce.parse('2^{100}').evaluate().toString()).toEqual(
      '1267650600228229401496703205376'
    );
  });

  test('Power(2,127).N() is unchanged (float approximation ≈ 1.7014e38)', () => {
    const re = ce.box(['Power', 2, 127]).N().re;
    expect(re / 2 ** 127 - 1).toBeCloseTo(0, 10);
  });
});

describe('negative integer powers of exact bases are exact rationals (P0-16a)', () => {
  test('Power(2,-2) → 1/4', () => {
    // Was `0.25` (the Math.pow / bignum float lane).
    expect(evalStr(['Power', 2, -2])).toEqual('1/4');
    expect(jsonOf(['Power', 2, -2])).toEqual('["Rational",1,4]');
    expect(ce.box(['Power', 2, -2]).evaluate().isExact).toBe(true);
  });
  test('Power(3,-2) → 1/9', () => {
    expect(evalStr(['Power', 3, -2])).toEqual('1/9');
  });
  test('Power(-2,-3) → -1/8 (sign preserved)', () => {
    expect(evalStr(['Power', -2, -3])).toEqual('-1/8');
  });
  test('Power(2/3,-2) → 9/4 (control, rational base already exact)', () => {
    expect(evalStr(['Power', ['Rational', 2, 3], -2])).toEqual('9/4');
  });
});

describe('integer powers of Gaussian integers are exact (P0-11)', () => {
  test('(1+i)^2 = 2i (no float residue)', () => {
    // Was `(-1.3566e-21 + 2i)` via the transcendental exp/ln path.
    expect(jsonOf(['Power', ['Complex', 1, 1], 2])).toEqual('["Complex",0,2]');
    const r = ce.box(['Power', ['Complex', 1, 1], 2]).evaluate();
    expect(r.re).toBe(0);
    expect(r.im).toBe(2);
  });
  test('(1+i)^4 = −4 (collapses to an exact real integer)', () => {
    const r = ce.box(['Power', ['Complex', 1, 1], 4]).evaluate();
    expect(r.re).toBe(-4);
    expect(r.im).toBe(0);
    expect(r.isExact).toBe(true);
  });
  test('(2+i)^3 = 2+11i', () => {
    expect(jsonOf(['Power', ['Complex', 2, 1], 3])).toEqual('["Complex",2,11]');
  });
  test('Square(1+i) = 2i', () => {
    expect(jsonOf(['Square', ['Complex', 1, 1]])).toEqual('["Complex",0,2]');
  });
  test('(1+i)^-2 stays symbolic (Gaussian rational, not representable exactly)', () => {
    // Never a float residue under evaluate(); .N() still produces the value.
    expect(ce.box(['Power', ['Complex', 1, 1], -2]).evaluate().operator).toEqual(
      'Power'
    );
    const n = ce.box(['Power', ['Complex', 1, 1], -2]).N();
    expect(n.re).toBe(0);
    expect(n.im).toBeCloseTo(-0.5, 12);
  });
});

describe('huge integer powers stay symbolic; .json never throws (EX-15)', () => {
  test('Power(2,1e15).evaluate() stays an inert Power', () => {
    const r = ce.box(['Power', 2, 1e15]).evaluate();
    expect(r.operator).toEqual('Power');
    // The crash class: serialization must not throw.
    expect(() => JSON.stringify(r.json)).not.toThrow();
  });
  test('Power(2,1e15).N() overflows to infinity (unchanged)', () => {
    expect(ce.box(['Power', 2, 1e15]).N().re).toBe(Infinity);
  });
  test('Power(10,1e300).evaluate() stays symbolic (no crash)', () => {
    const r = ce.box(['Power', 10, 1e300]).evaluate();
    expect(r.operator).toEqual('Power');
    expect(() => JSON.stringify(r.json)).not.toThrow();
  });
});

describe('small/fractional integer powers unchanged (controls)', () => {
  test('Power(2,10) → 1024', () => {
    expect(evalStr(['Power', 2, 10])).toEqual('1024');
  });
  test('Power(2,1/2) and Power(2,0.5) → sqrt(2)', () => {
    expect(evalStr(['Power', 2, ['Rational', 1, 2]])).toEqual('sqrt(2)');
    expect(evalStr(['Power', 2, 0.5])).toEqual('sqrt(2)');
  });
  test('inexact (float) base still numericizes: Power(2.5,3) → 15.625', () => {
    expect(evalStr(['Power', 2.5, 3])).toEqual('15.625');
  });
  test('radical base integer power stays exact: (√2)^4 → 4, (√2)^5 → 4√2', () => {
    expect(evalStr(['Power', ['Sqrt', 2], 4])).toEqual('4');
    expect(evalStr(['Power', ['Sqrt', 2], 5])).toEqual('4sqrt(2)');
  });
});

/**
 * Regressions for P0-7 (WP-2.5): `Mod`/`Remainder` semantics disagreed
 * between the machine and bignum lanes.
 *  - `Mod` is floored (sign follows the divisor): the bignum lane used a
 *    truncated `a.mod(b)` while the machine lane already applied the
 *    floored correction — `Mod(-7, 3)` was `-1` at default (bignum)
 *    precision but `2` at machine precision.
 *  - `Remainder` keeps its existing IEEE-style (round-to-nearest, ties
 *    toward +Infinity) semantics in both lanes; the bignum lane's
 *    `BigDecimal.round()` breaks ties away from zero, disagreeing with
 *    `Math.round`'s ties-toward-+Infinity at half-integer quotients (e.g.
 *    `Remainder(-5, 2)`).
 *  - P0-16d (bonus): `Mod(1/2, 1/3)` numericized to a float instead of the
 *    exact `1/6`.
 *
 * IMPORTANT: `ce.precision` mutates the process-global `BigDecimal.precision`
 * — every machine-precision block below saves and restores it.
 */
describe('P0-7 — Mod/Remainder agree across lanes (WP-2.5)', () => {
  // Floored: sign follows the divisor.
  const modGrid: Array<[number, number, string]> = [
    [7, 3, '1'],
    [-7, 3, '2'],
    [7, -3, '-2'],
    [-7, -3, '-1'],
  ];
  // IEEE-style (round-to-nearest quotient): sign follows the sign of
  // `a - b*round(a/b)`.
  const remainderGrid: Array<[number, number, string]> = [
    [7, 3, '1'],
    [-7, 3, '-1'],
    [7, -3, '1'],
    [-7, -3, '-1'],
  ];

  function runSignGrid() {
    test.each(modGrid)('Mod(%p, %p) = %p', (a, b, expected) => {
      expect(evalStr(['Mod', a, b])).toEqual(expected);
    });
    test.each(remainderGrid)('Remainder(%p, %p) = %p', (a, b, expected) => {
      expect(evalStr(['Remainder', a, b])).toEqual(expected);
    });
    test('Remainder tie-breaking agrees at half-integer quotients', () => {
      // a/b = ±2.5: Math.round ties toward +Infinity (-2.5 → -2).
      expect(evalStr(['Remainder', 5, 2])).toEqual('-1');
      expect(evalStr(['Remainder', -5, 2])).toEqual('-1');
      expect(evalStr(['Remainder', 5, -2])).toEqual('1');
      expect(evalStr(['Remainder', -5, -2])).toEqual('1');
    });
    test('Mod(.sgn) agrees with Mod(...).evaluate().sgn', () => {
      for (const [a, b] of modGrid) {
        const e = ce.box(['Mod', a, b]);
        expect(e.sgn).toEqual(e.evaluate().sgn);
      }
    });
  }

  describe('at default (bignum) precision', () => {
    runSignGrid();
  });

  describe('at machine precision', () => {
    let saved: number;
    beforeAll(() => {
      saved = ce.precision;
      ce.precision = 'machine';
    });
    afterAll(() => {
      ce.precision = saved;
    });
    runSignGrid();
  });

  test('Mod(10^21+3, 10) = 3 (regression, WP-2.2)', () => {
    expect(evalStr(['Mod', ['Add', ['Power', 10, 21], 3], 10])).toEqual('3');
  });

  test('Mod(10^21+3, 10) = 3 at machine precision too', () => {
    const saved = ce.precision;
    ce.precision = 'machine';
    try {
      expect(evalStr(['Mod', ['Add', ['Power', 10, 21], 3], 10])).toEqual('3');
    } finally {
      ce.precision = saved;
    }
  });

  test('huge negative exact integer stays exact (all sign combinations)', () => {
    // -(10^21) mod 7, floored: 10^21 ≡ 6 (mod 7), so -(10^21) ≡ 1 (mod 7).
    expect(
      evalStr(['Mod', ['Negate', ['Power', 10, 21]], 7])
    ).toEqual('1');
  });

  test('Mod(0.5, 0.3) float behavior unchanged across lanes', () => {
    expect(evalStr(['Mod', 0.5, 0.3])).toEqual('0.2');
    const saved = ce.precision;
    ce.precision = 'machine';
    try {
      expect(evalStr(['Mod', 0.5, 0.3])).toEqual('0.2');
    } finally {
      ce.precision = saved;
    }
  });

  test('Mod(1/2, 1/3) = 1/6 exact (P0-16d)', () => {
    expect(
      evalStr(['Mod', ['Rational', 1, 2], ['Rational', 1, 3]])
    ).toEqual('1/6');
    expect(
      ce.box(['Mod', ['Rational', 1, 2], ['Rational', 1, 3]]).evaluate()
        .isExact
    ).toBe(true);
  });

  test('Mod(-1/2, 1/3) and Mod(1/2, -1/3) are exact and floored (sign follows divisor)', () => {
    expect(
      evalStr(['Mod', ['Rational', -1, 2], ['Rational', 1, 3]])
    ).toEqual('1/6');
    expect(
      evalStr(['Mod', ['Rational', 1, 2], ['Rational', -1, 3]])
    ).toEqual('-1/6');
  });
});

//
// WP-2.13 — the exactness sweep (P0-12, P0-16 b–h/j/k, P0-17, P0-18).
//
// The contract (CLAUDE.md "Evaluate vs. N"): under `evaluate()` an exact
// argument yields an exact result or stays symbolic — never a float; `.N()`
// produces the float; and `evaluate().N()` agrees with `.N()`.
//

const num = (e: any) => ce.box(e).evaluate();
const closeN = (e: any) => {
  const a = ce.box(e).evaluate().N().re;
  const b = ce.box(e).N().re;
  return Math.abs(a - b);
};

describe('P0-16b — Sqrt of exact arguments stays exact/symbolic', () => {
  test('Sqrt(-2) stays symbolic (not a float); .N() → 1.414…i', () => {
    expect(num(['Sqrt', -2]).operator).toEqual('Sqrt');
    expect(nStr(['Sqrt', -2]).endsWith('i')).toBe(true); // .N() → 1.414…i
  });
  test('Sqrt(-4) → 2i exact (control, perfect square)', () => {
    expect(evalStr(['Sqrt', -4])).toEqual('2i');
  });
  test('Sqrt(-3/2) stays symbolic', () => {
    expect(num(['Sqrt', ['Rational', -3, 2]]).operator).toEqual('Sqrt');
  });
  test('Sqrt(√2) (nested radical) stays symbolic', () => {
    expect(num(['Sqrt', ['Sqrt', 2]]).operator).toEqual('Sqrt');
  });
  test('Sqrt(1000003) (non-square past the 10^6 cliff) stays symbolic', () => {
    expect(num(['Sqrt', 1000003]).operator).toEqual('Sqrt');
    expect(nStr(['Sqrt', 1000003]).startsWith('1000.001')).toBe(true);
  });
  test('controls: Sqrt(4)→2, Sqrt(2) symbolic, Sqrt(999999)→3√111111', () => {
    expect(evalStr(['Sqrt', 4])).toEqual('2');
    expect(evalStr(['Sqrt', 2])).toEqual('sqrt(2)');
    expect(evalStr(['Sqrt', 999999])).toEqual('3sqrt(111111)');
    expect(evalStr(['Sqrt', ['Rational', 1, 4]])).toEqual('1/2');
  });
});

describe('P0-16c — Fract of exact arguments is exact', () => {
  test('Fract(1/2) → 1/2', () => {
    expect(evalStr(['Fract', ['Rational', 1, 2]])).toEqual('1/2');
  });
  test('Fract(-3/2) → 1/2 (x − floor(x))', () => {
    expect(evalStr(['Fract', ['Rational', -3, 2]])).toEqual('1/2');
  });
  test('Fract(√2) → √2 − 1 (exact)', () => {
    expect(evalStr(['Fract', ['Sqrt', 2]])).toEqual('-1 + sqrt(2)');
  });
  test('Fract(0.5).N() unchanged (float)', () => {
    expect(nStr(['Fract', 0.5])).toEqual('0.5');
  });
});

describe('P0-16f — Log with a symbolic (exact) base stays symbolic', () => {
  test('Log(2, Pi) stays symbolic under evaluate()', () => {
    expect(num(['Log', 2, 'Pi']).operator).toEqual('Log');
  });
  test('Log(2, Pi).N() numericizes', () => {
    expect(nStr(['Log', 2, 'Pi']).startsWith('0.605')).toBe(true);
  });
  test('Log(8, 2) → 3 exact (control)', () => {
    expect(evalStr(['Log', 8, 2])).toEqual('3');
  });
});

describe('P0-16g — Real/Imaginary/Conjugate keep exact real parts', () => {
  test('Real(1/2) → 1/2', () => {
    expect(evalStr(['Real', ['Rational', 1, 2]])).toEqual('1/2');
  });
  test('Real(√2) → √2', () => {
    expect(evalStr(['Real', ['Sqrt', 2]])).toEqual('sqrt(2)');
  });
  test('Imaginary(1/2) → 0, Conjugate(1/2) → 1/2', () => {
    expect(evalStr(['Imaginary', ['Rational', 1, 2]])).toEqual('0');
    expect(evalStr(['Conjugate', ['Rational', 1, 2]])).toEqual('1/2');
  });
  test('Real(3+4i) → 3, Imaginary(3+4i) → 4 (control)', () => {
    expect(evalStr(['Real', ['Complex', 3, 4]])).toEqual('3');
    expect(evalStr(['Imaginary', ['Complex', 3, 4]])).toEqual('4');
  });
});

describe('P0-16h — statistics of exact data stay exact under evaluate()', () => {
  const d = ['List', 1, 2, 3, 4];
  const d5 = ['List', 1, 2, 3, 4, 5];
  test('Mean → 5/2', () => expect(evalStr(['Mean', d])).toEqual('5/2'));
  test('Median → 5/2', () => expect(evalStr(['Median', d])).toEqual('5/2'));
  test('Variance → 5/3', () => expect(evalStr(['Variance', d])).toEqual('5/3'));
  test('PopulationVariance → 5/4', () =>
    expect(evalStr(['PopulationVariance', d])).toEqual('5/4'));
  test('Kurtosis → 41/25', () =>
    expect(evalStr(['Kurtosis', d])).toEqual('41/25'));
  // CORRECTNESS_FINDINGS.md CR-P1-2: Quartiles now uses the Moore–McCabe
  // convention (median excluded from both halves for odd n): for [1..5],
  // lower half {1,2} → Q1 = 3/2, upper half {4,5} → Q3 = 9/2, IQR = 3.
  test('InterquartileRange → 3', () =>
    expect(evalStr(['InterquartileRange', d5])).toEqual('3'));
  test('Mean of exact rationals → 1/3', () =>
    expect(
      evalStr([
        'Mean',
        ['List', ['Rational', 1, 2], ['Rational', 1, 3], ['Rational', 1, 6]],
      ])
    ).toEqual('1/3'));
  test('StandardDeviation stays exact/symbolic (√)', () => {
    // √(5/3) rationalized to the exact radical √15/3 — not a machine float.
    expect(evalStr(['StandardDeviation', d])).toEqual('sqrt(15)/3');
    expect(nStr(['StandardDeviation', d]).startsWith('1.29')).toBe(true);
  });
  test('evaluate().N() agrees with .N()', () => {
    for (const op of [
      'Mean',
      'Median',
      'Variance',
      'PopulationVariance',
      'StandardDeviation',
      'Kurtosis',
    ])
      expect(closeN([op, d])).toBeLessThan(1e-9);
  });
  test('.N() of an exact list numericizes (unchanged)', () => {
    expect(nStr(['Mean', d])).toEqual('2.5');
  });
  test('float data is unchanged (Mean([0.5,1.5,2.5]) → 1.5)', () => {
    expect(evalStr(['Mean', ['List', 0.5, 1.5, 2.5]])).toEqual('1.5');
  });
});

describe('P0-16j — Distance routes through the exact path', () => {
  test('Distance((0,0),(1,1)) → √2', () => {
    expect(
      evalStr(['Distance', ['Tuple', 0, 0], ['Tuple', 1, 1]])
    ).toEqual('sqrt(2)');
  });
  test('Distance((0,0),(3,4)) → 5 (control, perfect square)', () => {
    expect(
      evalStr(['Distance', ['Tuple', 0, 0], ['Tuple', 3, 4]])
    ).toEqual('5');
  });
  test('Distance().N() numericizes', () => {
    expect(
      nStr(['Distance', ['Tuple', 0, 0], ['Tuple', 1, 1]]).startsWith('1.414')
    ).toBe(true);
  });
});

describe('P0-16k — Abs of an exact Gaussian integer is exact', () => {
  test('Abs(1+i) → √2', () => {
    expect(evalStr(['Abs', ['Complex', 1, 1]])).toEqual('sqrt(2)');
  });
  test('Abs(2+3i) → √13', () => {
    expect(evalStr(['Abs', ['Complex', 2, 3]])).toEqual('sqrt(13)');
  });
  test('Abs(3+4i) → 5 (control)', () => {
    expect(evalStr(['Abs', ['Complex', 3, 4]])).toEqual('5');
  });
  test('Abs(1+i).N() numericizes', () => {
    expect(nStr(['Abs', ['Complex', 1, 1]]).startsWith('1.414')).toBe(true);
  });
});

describe('P0-12 — trig poles under .N() return ~oo, not garbage', () => {
  test('Cot(π).N() → ~oo', () => {
    expect(nStr(['Cot', 'Pi'])).toEqual('~oo');
  });
  test('Csc(π).N() → ~oo', () => {
    expect(nStr(['Csc', 'Pi'])).toEqual('~oo');
  });
  test('Sec(π/2).N() → ~oo', () => {
    expect(nStr(['Sec', ['Divide', 'Pi', 2]])).toEqual('~oo');
  });
  test('evaluate() poles unchanged', () => {
    expect(evalStr(['Cot', 'Pi'])).toEqual('~oo');
  });
  test('non-pole values unchanged (controls)', () => {
    expect(nStr(['Cot', 1]).startsWith('0.642')).toBe(true);
    expect(nStr(['Csc', 1]).startsWith('1.188')).toBe(true);
    expect(nStr(['Sec', 1]).startsWith('1.850')).toBe(true);
  });
});

describe('P0-17 — Haversine/InverseHaversine/Hypot .N() are fully evaluated', () => {
  test('Haversine(0.5).N() is a number', () => {
    expect(ce.box(['Haversine', 0.5]).N().isNumberLiteral).toBe(true);
    expect(closeN(['Haversine', 0.5])).toBeLessThan(1e-9);
  });
  test('InverseHaversine(1/2).evaluate() → π/2 (fold)', () => {
    expect(evalStr(['InverseHaversine', ['Rational', 1, 2]])).toEqual(
      '1/2 * pi'
    );
  });
  test('InverseHaversine(1/2).N() is a number', () => {
    expect(ce.box(['InverseHaversine', ['Rational', 1, 2]]).N().isNumberLiteral).toBe(
      true
    );
  });
  test('Hypot(1/2,1/3).N() is a number; evaluate() → √13/6', () => {
    expect(
      evalStr(['Hypot', ['Rational', 1, 2], ['Rational', 1, 3]])
    ).toEqual('sqrt(13)/6');
    expect(
      ce.box(['Hypot', ['Rational', 1, 2], ['Rational', 1, 3]]).N().isNumberLiteral
    ).toBe(true);
  });
});

describe('P0-18 — negative-argument logarithms are lane-consistent', () => {
  // Exact negative → symbolic under evaluate(), complex under N().
  test('Ln(-2) symbolic under evaluate(), complex under N()', () => {
    expect(num(['Ln', -2]).operator).toEqual('Ln');
    expect(ce.box(['Ln', -2]).N().im).toBeCloseTo(Math.PI, 10);
  });
  test('Log(-2, 2) symbolic under evaluate()', () => {
    expect(num(['Log', -2, 2]).operator).toEqual('Log');
  });
  // Inexact negative → complex under BOTH evaluate() and N().
  test('Ln(-0.5) complex under evaluate() (was NaN)', () => {
    const e = num(['Ln', -0.5]);
    expect(e.im).toBeCloseTo(Math.PI, 10);
    expect(e.re).toBeCloseTo(Math.log(0.5), 10);
  });
  test('Log(-1.0, 2).N() is complex (was NaN); matches Ln(-1.0).N()/ln2', () => {
    const lg = ce.box(['Log', -1.0, 2]).N();
    expect(lg.re).toBeCloseTo(0, 10);
    expect(lg.im).toBeCloseTo(Math.PI / Math.log(2), 8);
  });
  test('one-arg Lg(-2).N() and two-arg Log(-2,10).N() agree', () => {
    const a = ce.box(['Log', -2]).N();
    const b = ce.box(['Log', -2, 10]).N();
    expect(a.re).toBeCloseTo(b.re, 10);
    expect(a.im).toBeCloseTo(b.im, 10);
    expect(Number.isNaN(b.re)).toBe(false); // was NaN
  });
  test('positive-argument logs unchanged (controls)', () => {
    expect(evalStr(['Ln', 2])).toEqual('ln(2)');
    expect(nStr(['Ln', 2]).startsWith('0.693')).toBe(true);
  });
});

describe('SYM P0-15 residual — generic numeric fallback gates finiteness on operands', () => {
  // `PreIncrement`/`PreDecrement` have a `(number) -> number` signature and no
  // type handler, so they exercise the generic narrowing fallback.
  test('non-finite operand is NOT narrowed to non_finite_number', () => {
    // finite-in → finite-out is an unsound closure assumption for an unknown
    // operator; with a non-finite operand the result finiteness must stay
    // `number` (was `non_finite_number`).
    expect(ce.box(['PreIncrement', 'PositiveInfinity']).type.toString()).toEqual(
      'number'
    );
    expect(ce.box(['PreDecrement', 'NegativeInfinity']).type.toString()).toEqual(
      'number'
    );
  });
  test('finite operand still narrows (kind + finiteness justified)', () => {
    expect(ce.box(['PreIncrement', 2]).type.toString()).toEqual(
      'finite_integer'
    );
  });
});

//
// D2 (EX-P1-2 / EX-16, Wave 4 batch 2) — inexact (float) arguments numericize
// under evaluate() for ALL numeric operators, not just trig. Previously ~30
// special functions (Gamma, Erf family, Exp/Power/Root, Bessel/Airy,
// elliptic/hypergeometric, Zeta/Digamma/…) kept a float argument symbolic
// under evaluate() and only numericized under `.N()`; `Cos`/`Sqrt` already
// complied. REVIEW.md B23 (the old "documented as intended" comment in
// `library/trigonometry.ts` and `library/statistics.ts`) is overruled by
// this policy.
//
describe('D2 — inexact arguments numericize under evaluate() (all numeric operators)', () => {
  // One representative case per family; the fix is the shared
  // `shouldNumericize()` gate in `boxed-expression/apply.ts`.
  const offenders: Array<[string, any]> = [
    ['Exp(5.1)', ['Exp', 5.1]],
    ['Gamma(5.1)', ['Gamma', 5.1]],
    ['Gamma(2, 3.1) — incomplete', ['Gamma', 2, 3.1]],
    ['GammaLn(5.1)', ['GammaLn', 5.1]],
    ['Digamma(5.1)', ['Digamma', 5.1]],
    ['Trigamma(5.1)', ['Trigamma', 5.1]],
    ['PolyGamma(1, 5.1)', ['PolyGamma', 1, 5.1]],
    ['Zeta(5.1)', ['Zeta', 5.1]],
    ['Beta(2, 3.1)', ['Beta', 2, 3.1]],
    ['LambertW(5.1)', ['LambertW', 5.1]],
    ['BesselJ(0, 2.5)', ['BesselJ', 0, 2.5]],
    ['BesselY(0, 2.5)', ['BesselY', 0, 2.5]],
    ['BesselI(0, 2.5)', ['BesselI', 0, 2.5]],
    ['BesselK(0, 2.5)', ['BesselK', 0, 2.5]],
    ['AiryAi(2.5)', ['AiryAi', 2.5]],
    ['AiryBi(2.5)', ['AiryBi', 2.5]],
    ['Power(2, 5.1) — float exponent', ['Power', 2, 5.1]],
    ['Root(5.1, 3)', ['Root', 5.1, 3]],
    ['EllipticK(0.5)', ['EllipticK', 0.5]],
    ['EllipticE(0.5)', ['EllipticE', 0.5]],
    ['EllipticF(0.5, 0.5)', ['EllipticF', 0.5, 0.5]],
    ['EllipticPi(0.5, 0.5)', ['EllipticPi', 0.5, 0.5]],
    ['AGM(1.5, 2.5)', ['AGM', 1.5, 2.5]],
    ['Hypergeometric2F1(1,1,2,0.5)', ['Hypergeometric2F1', 1, 1, 2, 0.5]],
    ['AppellF1(1,1,1,2,0.3,0.3)', ['AppellF1', 1, 1, 1, 2, 0.3, 0.3]],
    ['Hypergeometric1F1(1,2,0.5)', ['Hypergeometric1F1', 1, 2, 0.5]],
    ['ExpIntegralEi(2.5)', ['ExpIntegralEi', 2.5]],
    ['LogIntegral(2.5)', ['LogIntegral', 2.5]],
    ['Erf(1.5)', ['Erf', 1.5]],
    ['Erfc(1.5)', ['Erfc', 1.5]],
    ['ErfInv(0.5)', ['ErfInv', 0.5]],
    ['Erfi(1.5)', ['Erfi', 1.5]],
    ['Sinc(1.5)', ['Sinc', 1.5]],
    ['FresnelS(1.5)', ['FresnelS', 1.5]],
    ['FresnelC(1.5)', ['FresnelC', 1.5]],
    ['SinIntegral(1.5)', ['SinIntegral', 1.5]],
    ['CosIntegral(1.5)', ['CosIntegral', 1.5]],
  ];

  test.each(offenders)('%s numericizes under evaluate()', (_label, expr) => {
    const e = ce.box(expr);
    const ev = e.evaluate();
    const nv = e.N();
    expect(ev.isNumberLiteral).toBe(true);
    // evaluate() must agree with .N() (same numeric result, same precision
    // lane — the fix routes through the same apply()/apply2()/applyN()
    // dispatch either way).
    expect(ev.toString()).toEqual(nv.toString());
  });

  test('DedekindEta/EisensteinE/JacobiTheta numericize on an in-domain complex tau', () => {
    // Im(τ) > 0 is required (nome q = e^{iπτ} must have |q| < 1); a real τ is
    // genuinely out of domain and stays symbolic in both lanes (not a D2 bug).
    const tau = ['Complex', 0, 1.5];
    for (const expr of [
      ['DedekindEta', tau],
      ['EisensteinE', 4, tau],
      ['JacobiTheta', 3, 0.3, tau],
    ]) {
      const e = ce.box(expr);
      expect(e.evaluate().isNumberLiteral).toBe(true);
      expect(e.evaluate().toString()).toEqual(e.N().toString());
    }
  });

  describe('mixed float + exact symbolic constant folds (Add/Multiply)', () => {
    test('Add(0.5, Pi) numericizes, like Add(0.5, Sqrt(2))', () => {
      const e = ce.box(['Add', 0.5, 'Pi']);
      expect(e.evaluate().isNumberLiteral).toBe(true);
      expect(e.evaluate().toString()).toEqual(e.N().toString());
      const control = ce.box(['Add', 0.5, ['Sqrt', 2]]);
      expect(control.evaluate().isNumberLiteral).toBe(true);
    });
    test('Multiply(0.5, Pi) numericizes', () => {
      const e = ce.box(['Multiply', 0.5, 'Pi']);
      expect(e.evaluate().isNumberLiteral).toBe(true);
      expect(e.evaluate().toString()).toEqual(e.N().toString());
    });
    test('a free variable blocks the float-contagion fold (stays symbolic)', () => {
      expect(num(['Add', 0.5, 'x']).isNumberLiteral).not.toBe(true);
      expect(num(['Add', 0.5, 'x']).unknowns).toContain('x');
      expect(num(['Multiply', 0.5, 'x']).isNumberLiteral).not.toBe(true);
      expect(num(['Multiply', 0.5, 'x']).unknowns).toContain('x');
    });
    test('two exact operands (no float) do not numericize', () => {
      expect(num(['Add', 1, 'GoldenRatio']).operator).toEqual('Add');
      expect(num(['Add', 1, 'GoldenRatio']).isNumberLiteral).not.toBe(true);
      expect(num(['Add', 'Pi', 'ExponentialE']).operator).toEqual('Add');
      expect(num(['Add', 'Pi', 'ExponentialE']).isNumberLiteral).not.toBe(true);
    });
  });

  describe('controls — exact arguments are unaffected (still stay symbolic under evaluate())', () => {
    test('Gamma(5) — exact integer (not a D2 case; poles/exact folds unchanged)', () => {
      expect(num(['Gamma', 5]).operator).toEqual('Gamma');
    });
    test('Gamma(1/2) — exact rational stays symbolic', () => {
      expect(num(['Gamma', ['Rational', 1, 2]]).operator).toEqual('Gamma');
      expect(nStr(['Gamma', ['Rational', 1, 2]]).startsWith('1.772')).toBe(true);
    });
    test('Cos(1/3) — exact rational stays symbolic (trig unchanged by D2)', () => {
      expect(num(['Cos', ['Rational', 1, 3]]).operator).toEqual('Cos');
    });
    test('Ln(2) — exact integer argument stays symbolic', () => {
      expect(evalStr(['Ln', 2])).toEqual('ln(2)');
    });
    test('Erf(0) / Erf(∞) — exact special values unaffected', () => {
      expect(evalStr(['Erf', 0])).toEqual('0');
      expect(evalStr(['Erf', 'PositiveInfinity'])).toEqual('1');
    });
  });

  describe('precision follows the engine (D2 point 4)', () => {
    test('Gamma(5.1) at high precision matches .N() beyond machine precision', () => {
      // The shared test engine runs at precision 100 (see test/utils.ts):
      // the bignum kernel must be used, not a machine-precision fallback
      // silently truncated to ~16 digits.
      const e = ce.box(['Gamma', 5.1]);
      const s = e.evaluate().toString();
      expect(s).toEqual(e.N().toString());
      // ~16 significant digits would end well before position 40.
      expect(s.replace(/[^0-9]/g, '').length).toBeGreaterThan(40);
    });
  });

  test('a huge float argument stays fast (deadline guard unaffected)', () => {
    const t0 = Date.now();
    expect(ce.box(['Gamma', 1e15 + 0.5]).evaluate().toString()).toEqual('+oo');
    expect(Date.now() - t0).toBeLessThan(2000);
  });

  describe('Gaussian-integer complex literals are exact (isExactNumber, not plain isExact)', () => {
    // A complex `NumberLiteral` is never `isExact` — its `NumericValue`
    // always lives in the Big/MachineNumericValue lane, even when both its
    // real and imaginary parts are literal integers (`i`, `1+i`, `2+i`).
    // A naive `isExact === false` D2 gate would wrongly float these; the
    // shared `isExactNumber` helper (boxed-expression/apply.ts) exempts
    // Gaussian integers. These are the regressions the exemption guards.
    test('(2+i)^3 = 2+11i stays exact under evaluate() (WP-2.16)', () => {
      expect(num(['Power', ['Complex', 2, 1], 3]).json).toEqual([
        'Complex', 2, 11,
      ]);
    });
    test('1/2 + i preserves the exact real part (no float residue)', () => {
      expect(
        ce.parse('\\frac12 + i').evaluate().toString()
      ).toEqual('1/2 + i');
    });
    test('EisensteinE(4, i) stays symbolic under evaluate() (exact τ)', () => {
      expect(num(['EisensteinE', 4, 'ImaginaryUnit']).operator).toEqual(
        'EisensteinE'
      );
    });
    test('a genuinely inexact complex argument still numericizes', () => {
      // Not a Gaussian integer (1.5 is not an integer): D2 still applies.
      expect(
        num(['Gamma', ['Complex', 1.5, 2]]).isNumberLiteral
      ).toBe(true);
    });
  });
});
