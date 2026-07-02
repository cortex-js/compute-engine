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
