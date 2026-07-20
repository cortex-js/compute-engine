import { check, checkJson, engine } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { indexingSetCartesianProductIterator } from '../../src/compute-engine/library/utils';

const ce = engine;

ce.assign('z', ['Complex', 0, 1]);
ce.declare('b', 'integer'); // Used in Sum/Product simplification tests

describe('CONSTANTS', () => {
  test(`ExponentialE`, () =>
    expect(checkJson(`ExponentialE`)).toMatchSnapshot());
  test(`ImaginaryUnit`, () =>
    expect(checkJson(`ImaginaryUnit`)).toMatchSnapshot());
  test(`MachineEpsilon`, () =>
    expect(checkJson(`MachineEpsilon`)).toMatchSnapshot());
  test(`CatalanConstant`, () =>
    expect(checkJson(`CatalanConstant`)).toMatchSnapshot());
  test(`GoldenRatio`, () => expect(checkJson(`GoldenRatio`)).toMatchSnapshot());
  test(`EulerGamma`, () => expect(checkJson(`EulerGamma`)).toMatchSnapshot());
});

describe('RELATIONAL OPERATOR', () => {
  test(`Equal`, () =>
    expect(ce.expr(['Equal', 5, 5]).evaluate()).toMatchSnapshot());
  test(`Equal`, () =>
    expect(ce.expr(['Equal', 11, 7]).evaluate()).toMatchSnapshot());
  test(`NotEqual`, () =>
    expect(ce.expr(['NotEqual', 5, 5]).evaluate()).toMatchSnapshot());
  test(`NotEqual`, () =>
    expect(ce.expr(['NotEqual', 11, 7]).evaluate()).toMatchSnapshot());
  test(`Greater`, () =>
    expect(ce.expr(['Greater', 3, 19]).evaluate()).toMatchSnapshot());
  test(`Greater`, () =>
    expect(ce.expr(['Greater', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Less`, () =>
    expect(ce.expr(['Less', 3, 19]).evaluate()).toMatchSnapshot());
  test(`Less`, () =>
    expect(ce.expr(['Less', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`GreaterEqual`, () =>
    expect(ce.expr(['GreaterEqual', 3, 3]).evaluate()).toMatchSnapshot());
  test(`GreaterEqual`, () =>
    expect(ce.expr(['GreaterEqual', 3, 19]).evaluate()).toMatchSnapshot());
  test(`GreaterEqual`, () =>
    expect(ce.expr(['GreaterEqual', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`LessEqual`, () =>
    expect(ce.expr(['LessEqual', 3, 3]).evaluate()).toMatchSnapshot());
  test(`LessEqual`, () =>
    expect(ce.expr(['LessEqual', 3, 19]).evaluate()).toMatchSnapshot());
  test(`LessEqual`, () =>
    expect(ce.expr(['LessEqual', 2.5, 1.1]).evaluate()).toMatchSnapshot());
});

//
// When using `.evaluate()` if there are any non-exact arguments (literal
// numbers with fractional part), the result is an approximation (same as
// `N()`). Otherwise, if all the arguments are exact they are grouped as follow:
// - integers
// - rationals
// - square root of rationals
// - functions (trig, etc...)
// - constants
//
//
describe('EXACT EVALUATION', () => {
  test(`Sqrt: Exact integer`, () =>
    expect(check('\\sqrt{5}')).toMatchSnapshot());
  test(`Sqrt: Exact rational`, () =>
    expect(check('\\sqrt{\\frac{5}{7}}')).toMatchSnapshot());
  test(`Sqrt: Inexact Fractional part`, () =>
    expect(check('\\sqrt{5.1}')).toMatchSnapshot());

  test(`Cos: Exact integer`, () => expect(check('\\cos{5}')).toMatchSnapshot());

  test(`Cos: Exact rational`, () =>
    expect(check('\\cos{\\frac{5}{7}}')).toMatchSnapshot());
  test(`Cos: Inexact Fractional part`, () =>
    expect(check('\\cos(5.1)')).toMatchSnapshot());
  test(`Cos: Pi (simplify constructible value)`, () =>
    expect(check('\\cos{\\pi}')).toMatchSnapshot());

  test(`Add: All exact`, () =>
    expect(check('6+\\frac{10}{14}+\\sqrt{\\frac{18}{9}}')).toMatchSnapshot());

  test(`Add: All exact`, () =>
    expect(check('6+\\sqrt{2}+\\sqrt{5}')).toMatchSnapshot());

  test(`Add: All exact`, () =>
    expect(
      check('2+5+\\frac{5}{7}+\\frac{7}{9}+\\sqrt{2}+\\pi')
    ).toMatchSnapshot());
  test(`Add: one inexact`, () =>
    expect(
      check('1.1+2+5+\\frac{5}{7}+\\frac{7}{9}+\\sqrt{2}+\\pi')
    ).toMatchSnapshot());

  // 0.1 + 2 + 1/4 -> 2.35
  test(`Inexact values propagate`, () =>
    expect(check('0.1 + 2 + \\frac{1}{4}')).toMatchSnapshot());

  // Exact values are grouped together
  // Square rationals are preserved, not reduced
  test(`Exact values are grouped together`, () =>
    expect(
      check('2 + \\frac{1}{4} + \\frac{1}{4} + \\sqrt{5} + \\sqrt{7}')
    ).toMatchSnapshot());

  // If inexact values are canceled, exact values are grouped together
  test(`Canceled inexact values are ignored`, () =>
    expect(
      check('2.12 - 2.12 + \\frac{1}{4} + \\frac{1}{4} + \\sqrt{5} + \\sqrt{7}')
    ).toMatchSnapshot());

  // √5 + √5 = 2√5
  test(`Square rationals are grouped together`, () =>
    expect(check('\\sqrt{5} + \\sqrt{5}')).toMatchSnapshot());

  // A transcendental of an EXACT *constant expression* (π², not just a number
  // literal) stays symbolic under evaluate(); only N() numericizes.
  test(`Sin of an exact constant expression stays symbolic`, () => {
    expect(ce.parse('\\sin(\\pi^2)').evaluate().toString()).toBe('sin(pi^2)');
    expect(ce.parse('\\sin(\\pi^2)').N().toString()).toContain('-0.4303');
    // An inexact (float) argument still numericizes under evaluate()
    expect(ce.parse('\\sin(2.5)').evaluate().toString()).toContain('0.598');
  });

  // An exact real added to the imaginary unit keeps the real part exact
  // (it is not folded into a machine complex that would floatify it).
  // Since D12-A, `1/2 + i` is a single EXACT Gaussian-rational number literal
  // (printed in the parenthesized complex-literal style); a real with a
  // radical stays an exact two-term sum (`√3 + i` is outside the exact
  // complex representable set, so the radical term is kept separate).
  test(`Exact real + i preserves the exact real part`, () => {
    expect(ce.parse('\\frac12 + i').evaluate().toString()).toBe('(1/2 + i)');
    expect(ce.parse('\\sqrt3 + i').evaluate().toString()).toBe('sqrt(3) + i');
    expect(ce.parse('\\frac34\\sqrt3 + i').evaluate().toString()).toBe(
      '3/4sqrt(3) + i'
    );
    // N() still numericizes; inexact reals + i are unaffected
    expect(ce.parse('\\frac12 + i').N().toString()).toBe('(0.5 + i)');
    expect(ce.parse('1.5 + i').evaluate().toString()).toBe('(1.5 + i)');
  });
});

describe('ADD', () => {
  test(`Add ['Add']`, () =>
    expect(ce.expr(['Add']).evaluate()).toMatchSnapshot());

  test(`Add ['Add', 2.5]`, () =>
    expect(ce.expr(['Add', 2.5]).evaluate()).toMatchSnapshot());

  test(`Add ['Add', 2.5, -1.1]`, () =>
    expect(ce.expr(['Add', 2.5, -1.1]).evaluate()).toMatchSnapshot());

  test(`Add ['Add', 4, -1.1]`, () =>
    expect(ce.expr(['Add', 4, -1.1]).evaluate()).toMatchSnapshot());

  test(`Add \\sqrt{3}+2\\sqrt{3}`, () =>
    expect(ce.parse('\\sqrt{3}+2\\sqrt{3}').evaluate()).toMatchSnapshot());

  test(`Add 8+\\sqrt{3}`, () =>
    expect(ce.parse('8+\\sqrt{3}').evaluate()).toMatchSnapshot());

  test(`Add 8.1+\\sqrt{3}`, () =>
    expect(ce.parse('8.1+\\sqrt{3}').evaluate()).toMatchSnapshot());

  test(`Add ['Add', 2.5, -1.1, 18.4]`, () =>
    expect(ce.expr(['Add', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());

  test(`Add \\frac{2}{-3222233}+\\frac{1}{3}`, () =>
    expect(check('\\frac{2}{-3222233}+\\frac{1}{3}')).toMatchSnapshot());

  test(`Add `, () =>
    expect(
      check(
        '2+4+1.5+1.7+\\frac{5}{7}+\\frac{3}{11}+\\sqrt{5}+\\pi+\\sqrt{5}+\\sqrt{4}'
      )
    ).toMatchSnapshot());

  // Expected result: 12144966884186830401015120518973257/150534112785803114146067001510798 = 80.6792
  test(`Add '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'`, () =>
    expect(
      check(
        '\\frac{2}{3}+\\frac{12345678912345678}{987654321987654321}+\\frac{987654321987654321}{12345678912345678}'
      )
    ).toMatchSnapshot());

  test('Add a real to a complex variable', () => {
    expect(ce.parse('z+5').evaluate()).toMatchSnapshot();
  });

  // Regression test: precision loss when summing large integers with rationals
  // The issue was in ExactNumericValue.sum() using .re (loses precision) instead of .bignumRe
  test('Add large integer power to fraction preserves precision', () => {
    const result = ce.parse('12345678^3 + \\frac{1}{3}').N();
    // 12345678^3 = 1881675960266558605752
    // Result should be 1881675960266558605752 + 1/3 = 1881675960266558605752.333...
    // Key: the integer part "1881675960266558605752" must be preserved exactly
    expect(result.toString()).toMatch('1.881675960266558605752');
  });

  test('Add large integer to fraction preserves full precision', () => {
    // Verify the integer part is exactly correct (not losing digits)
    const result = ce.parse('1881675960266558605752 + \\frac{1}{3}').N();
    // Before the fix, this would produce "1.881675960266558" (truncated)
    expect(result.toString()).toMatch('1.881675960266558605752');
  });
});

describe('SUBTRACT', () => {
  test(`Subtract rational and float`, () =>
    expect(
      ce
        .expr(['Subtract', ['Multiply', 0.5, 'x'], ['Divide', 'x', 2]])
        .evaluate()
    ).toMatchInlineSnapshot(`0`));

  test(`Subtract`, () =>
    expect(ce.expr(['Subtract', 2.5]).evaluate()).toMatchSnapshot());
  test(`Subtract`, () =>
    expect(ce.expr(['Subtract', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Subtract with single argument`, () =>
    expect(ce.expr(['Subtract', 2.5]).evaluate()).toMatchSnapshot());
  test(`Subtract with multiple arguments`, () =>
    expect(ce.expr(['Subtract', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('NEGATE', () => {
  test(`-2`, () => expect(checkJson(['Negate', 2])).toMatchSnapshot());
  test(`-0`, () => expect(checkJson(['Negate', 0])).toMatchSnapshot());
  test(`-(-2.1)`, () => expect(checkJson(['Negate', -2])).toMatchSnapshot());
  test(`-2.5`, () => expect(checkJson(['Negate', 2.5])).toMatchSnapshot());

  test(`-NaN`, () => expect(checkJson(['Negate', 'NaN'])).toMatchSnapshot());

  test(`-(+Infinity)`, () =>
    expect(checkJson(['Negate', { num: '+Infinity' }])).toMatchSnapshot());
  test(`-(-Infinity)`, () =>
    expect(checkJson(['Negate', { num: '-Infinity' }])).toMatchSnapshot());

  test(`-1234567890987654321`, () =>
    expect(
      checkJson(['Negate', { num: '1234567890987654321' }])
    ).toMatchSnapshot());

  test(`-1234567890987654321.123456789`, () =>
    expect(
      checkJson(['Negate', '1234567890987654321.123456789'])
    ).toMatchSnapshot());

  test(`-(1+i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1, 1]])).toMatchSnapshot());

  test(`-(1.1+1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1.1, 1.1]])).toMatchSnapshot());

  test(`-(1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 0, 1.1]])).toMatchSnapshot());

  test(`-(1.1+i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1.1, 1]])).toMatchSnapshot());
  test(`-(1+1.1i)`, () =>
    expect(checkJson(['Negate', ['Complex', 1, 1.1]])).toMatchSnapshot());

  test(`-(2/3)`, () =>
    expect(checkJson(['Negate', ['Rational', 2, 3]])).toMatchSnapshot());

  test(`-(-2/3)`, () =>
    expect(checkJson(['Negate', ['Rational', -2, 3]])).toMatchSnapshot());

  test(`-(1234567890987654321/3)`, () =>
    expect(
      checkJson(['Negate', ['Rational', { num: '1234567890987654321' }, 3]])
    ).toMatchSnapshot());
});

describe('INVALID NEGATE', () => {
  test(`INVALID Negate`, () =>
    expect(ce.expr(['Negate', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`INVALID Negate`, () =>
    expect(ce.expr(['Negate', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('MULTIPLY', () => {
  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5])).toMatchSnapshot());

  test(`5x2`, () => expect(checkJson(['Multiply', 5, 2])).toMatchSnapshot());

  test(`5x(-2.1)`, () =>
    expect(checkJson(['Multiply', 5, -2.1])).toMatchSnapshot());

  test(`with zero`, () =>
    expect(checkJson(['Multiply', 'x', 2, 3.1, 0])).toMatchSnapshot());

  test(`with NaN`, () =>
    expect(checkJson(['Multiply', 'x', 2, 3.1, 'NaN'])).toMatchSnapshot());

  test(`with <0`, () =>
    expect(checkJson(['Multiply', 'x', -2, 3.1, -5.2])).toMatchSnapshot());

  test(`with +Infinity`, () =>
    expect(
      checkJson(['Multiply', 'x', -2, 3.1, { num: '+Infinity' }])
    ).toMatchSnapshot());

  test(`with -Infinity`, () =>
    expect(
      checkJson([
        'Multiply',
        'x',
        -2,
        3.1,
        'NegativeInfinity',
        { num: '-Infinity' },
      ])
    ).toMatchSnapshot());

  test(`with -Infinity and +Infinity`, () =>
    expect(
      checkJson([
        'Multiply',
        'x',
        -2,
        3.1,
        'PositiveInfinity',
        { num: '-Infinity' },
        { num: '+Infinity' },
      ])
    ).toMatchSnapshot());

  test(`with Nan, -Infinity and +Infinity`, () =>
    expect(
      checkJson([
        'Multiply',
        'x',
        -2,
        3.1,
        'NaN',
        { num: '-Infinity' },
        { num: '+Infinity' },
      ])
    ).toMatchSnapshot());

  test(`2x1234567890987654321`, () =>
    expect(
      checkJson(['Multiply', 2, { num: '1234567890987654321' }])
    ).toMatchSnapshot());

  test(`2x-1234567890987654321.123456789`, () =>
    expect(
      checkJson(['Multiply', 2, '1234567890987654321.123456789'])
    ).toMatchSnapshot());

  test(`2x(1+i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1, 1]])).toMatchSnapshot());

  test(`2x(1.1+1.1i)`, () =>
    expect(
      checkJson(['Multiply', 2, ['Complex', 1.1, 1.1]])
    ).toMatchSnapshot());

  test(`2x(1.1i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 0, 1.1]])).toMatchSnapshot());

  test(`2x(1.1+i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1.1, 1]])).toMatchSnapshot());
  test(`2x(1+1.1i)`, () =>
    expect(checkJson(['Multiply', 2, ['Complex', 1, 1.1]])).toMatchSnapshot());

  // Regression: a complex literal with im === 1 was treated as "the
  // imaginary unit" without also requiring re === 0, so multiplying a
  // number by a complex literal whose imaginary part is 1 silently
  // dropped the real part (e.g. 2·(1+i) became 2i instead of 2+2i).
  test(`Multiplying by a complex literal with im === 1 preserves the real part`, () => {
    expect(ce.expr(['Multiply', 2, ['Complex', 1, 1]]).evaluate().toString()).toBe(
      '(2 + 2i)'
    );
    expect(ce.expr(['Multiply', 5, ['Complex', 2, 1]]).evaluate().toString()).toBe(
      '(10 + 5i)'
    );
    expect(
      ce.expr(['Multiply', 2, ['Complex', 1.1, 1]]).evaluate().toString()
    ).toBe('(2.2 + 2i)');
    // Controls: still correct
    expect(ce.expr(['Multiply', 2, ['Complex', 0, 1]]).evaluate().toString()).toBe(
      '2i'
    );
    expect(ce.expr(['Multiply', 2, ['Complex', 1, 2]]).evaluate().toString()).toBe(
      '(2 + 4i)'
    );
  });

  test(`2x(2/3)`, () =>
    expect(checkJson(['Multiply', 2, ['Rational', 2, 3]])).toMatchSnapshot());
  test(`2x(-2/3)`, () =>
    expect(checkJson(['Multiply', 2, ['Rational', -2, 3]])).toMatchSnapshot());
  test(`2x(1234567890987654321/3)`, () =>
    expect(
      checkJson([
        'Multiply',
        2,
        ['Rational', { num: '1234567890987654321' }, 3],
      ])
    ).toMatchSnapshot());

  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5, 1.1])).toMatchSnapshot());
  test(`Multiply`, () =>
    expect(checkJson(['Multiply', 2.5, -1.1, 18.4])).toMatchSnapshot());

  test(`Multiply: All exact`, () =>
    expect(check('2\\frac{5}{7}\\times\\frac{7}{9}')).toMatchSnapshot());

  test(`Multiply: All exact with symbol`, () =>
    expect(
      check(
        '2\\times 5\\times\\frac{5}{7}\\times\\frac{7}{9}\\times\\sqrt{2}\\times\\pi'
      )
    ).toMatchSnapshot());

  test(`Multiply: One inexact`, () =>
    expect(
      check(
        '1.1\\times 2\\times 5\\times\\frac{5}{7}\\times\\frac{7}{9}\\times\\sqrt{2}\\times\\pi'
      )
    ).toMatchSnapshot()); // @fixme eval-big should be same or better than evaluate

  // Regression: `x · ∞` used to collapse to `∞` regardless of the sign of `x`.
  // The sign of `∞ · (symbolic factor)` follows the factor's sign; an
  // unknown-sign factor must stay symbolic, and `0 · ∞` is NaN.
  //
  // These tests create fresh engines (for isolated assumptions), which mutate
  // the GLOBAL `BigDecimal.precision`; save/restore it so downstream
  // precision-sensitive snapshots in this file are unaffected.
  describe('Symbol × Infinity', () => {
    let savedPrecision: number;
    beforeAll(() => {
      savedPrecision = BigDecimal.precision;
    });
    afterAll(() => {
      BigDecimal.precision = savedPrecision;
    });

    test('x · +∞ stays symbolic (sign of x unknown)', () => {
      const c = new ComputeEngine();
      expect(
        c.box(['Multiply', 'x', { num: '+Infinity' }]).evaluate().toString()
      ).toBe('+oo * x');
    });
    test('x · −∞ stays symbolic', () => {
      const c = new ComputeEngine();
      expect(
        c.box(['Multiply', 'x', { num: '-Infinity' }]).evaluate().toString()
      ).toBe('-oo * x');
    });
    test('(x, x<0) · +∞ = −∞', () => {
      const c = new ComputeEngine();
      c.assume(['Less', 'x', 0]);
      expect(
        c.box(['Multiply', 'x', { num: '+Infinity' }]).evaluate().toString()
      ).toBe('-oo');
    });
    test('(y, y>0) · +∞ = +∞', () => {
      const c = new ComputeEngine();
      c.assume(['Greater', 'y', 0]);
      expect(
        c.box(['Multiply', 'y', { num: '+Infinity' }]).evaluate().toString()
      ).toBe('+oo');
    });
    test('0 · +∞ = NaN', () => {
      const c = new ComputeEngine();
      expect(
        c.box(['Multiply', 0, { num: '+Infinity' }]).evaluate().toString()
      ).toBe('NaN');
    });
  });
});

describe('DIVIDE', () => {
  test(`Divide (1/5)/7`, () =>
    expect(
      ce.expr(['Divide', ['Divide', 1, 5], 7]).evaluate()
    ).toMatchSnapshot());
  test(`Divide 6/3`, () =>
    expect(ce.expr(['Divide', 6, 3]).evaluate()).toMatchSnapshot());
  test(`Divide 2.5/1.1`, () =>
    expect(ce.expr(['Divide', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Divide with single argument`, () =>
    expect(ce.expr(['Divide', 2.5]).evaluate()).toMatchSnapshot());
  test(`Divide with many arguments`, () =>
    expect(ce.expr(['Divide', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('POWER', () => {
  test(`Power with positive real exponent`, () =>
    expect(ce.expr(['Power', 2.5, 1.1]).evaluate()).toMatchSnapshot());
  test(`Power with negative exponent`, () =>
    expect(ce.expr(['Power', 2.5, -3]).evaluate()).toMatchSnapshot());
  test(`Power with negative real exponent`, () =>
    expect(ce.expr(['Power', 2.5, -3.2]).evaluate()).toMatchSnapshot());

  test(`INVALID Power`, () =>
    expect(ce.expr(['Power', 2.5]).evaluate()).toMatchSnapshot());
  test(`INVALID Power`, () =>
    expect(ce.expr(['Power', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('ROOT', () => {
  test(`Root 2.5`, () =>
    expect(ce.expr(['Root', 2.5, 3]).evaluate()).toMatchSnapshot());

  test(`Root 5/7`, () =>
    expect(
      ce.expr(['Root', ['Rational', 5, 7], 3]).evaluate()
    ).toMatchSnapshot());

  test(`Root 1234567890987654321`, () =>
    expect(
      ce.expr(['Root', { num: '1234567890987654321' }, 3]).evaluate()
    ).toMatchSnapshot());

  test(`Root 1234567890987654321.123456789`, () =>
    expect(
      ce.expr(['Root', { num: '1234567890987654321.123456789' }, 3]).evaluate()
    ).toMatchSnapshot());

  test(`Root of negative number with even exponent`, () =>
    expect(ce.expr(['Root', -2, 2]).N()).toMatchSnapshot());

  test(`Root of negative number with odd exponent`, () =>
    expect(ce.expr(['Root', -2, 3]).N()).toMatchSnapshot());

  // Odd roots of negative reals follow the real-root convention and must
  // agree between evaluate() and N() (evaluate() used to return NaN)
  test(`Root of negative perfect cube evaluates exactly`, () => {
    expect(ce.expr(['Root', -8, 3]).evaluate().json).toEqual(-2);
    expect(
      ce.expr(['Power', -8, ['Rational', 1, 3]]).evaluate().json
    ).toEqual(-2);
    expect(
      ce.expr(['Power', -32, ['Rational', 1, 5]]).evaluate().json
    ).toEqual(-2);
  });

  // NU-P1-7: Root(x,n).N() used Math.pow / a.pow(1/n), rounding the reciprocal
  // and printing a perfect root as 3.999…9. It now uses a snap-to-exact n-th
  // root, so a perfect power numericizes to the exact integer.
  test(`N() of a perfect n-th root snaps to the exact integer`, () => {
    expect(ce.expr(['Root', 64, 3]).N().json).toEqual(4);
    expect(ce.expr(['Root', 27, 3]).N().json).toEqual(3);
    expect(ce.expr(['Root', 1000, 3]).N().json).toEqual(10);
    expect(ce.expr(['Root', 1024, 10]).N().json).toEqual(2);
    // Non-perfect roots keep full precision (√[3]{2}).
    expect(ce.expr(['Root', 2, 3]).N().re).toBeCloseTo(1.2599210498948732, 14);
  });

  // NU-P1-8: an even root of a negative exact number has no real value, but a
  // complex principal value exists (like Sqrt(-4) = 2i). evaluate() used to
  // assert a NaN literal; it must stay symbolic instead (never NaN).
  test(`Even root of a negative number stays symbolic (not NaN) under evaluate`, () => {
    const r = ce.expr(['Root', -4, 4]).evaluate();
    expect(r.isNaN).not.toBe(true);
    expect(r.operator).toBe('Root');
    const p = ce.expr(['Power', -4, ['Rational', 1, 4]]).evaluate();
    expect(p.isNaN).not.toBe(true);
    // N() produces the principal complex root (~1 + i).
    const n = ce.expr(['Root', -4, 4]).N();
    expect(n.re).toBeCloseTo(1, 12);
    expect(n.im).toBeCloseTo(1, 12);
    // Control: the odd-root convention is preserved.
    expect(ce.expr(['Root', -8, 3]).evaluate().json).toEqual(-2);
  });

  // NU-P1-3: a complex value's imaginary part is always a machine double, so a
  // full-precision bignum real part printed a garbage tail (50+ digits, ~16
  // correct). The real part is now rounded to double precision.
  test(`Complex numeric result prints an honest (machine-precision) real part`, () => {
    const s = ce.expr(['Sqrt', ['Complex', 2, 3]]).N();
    const reStr = ce.number(s.re).toString();
    expect(reStr.replace('.', '').replace('-', '').length).toBeLessThanOrEqual(18);
    expect(s.re).toBeCloseTo(1.6741492280355401, 12);
    expect(s.im).toBeCloseTo(0.8959774761298381, 12);
  });

  test(`Odd root of negative non-perfect cube N() is real`, () => {
    expect(ce.expr(['Root', -2, 3]).evaluate().isNaN).not.toBe(true);
    const n = ce.expr(['Power', ['Rational', -1, 8], ['Rational', 1, 3]]).N();
    expect(n.re).toBeCloseTo(-0.5, 12);
    expect(n.im).toBe(0);
  });

  // Non-unit rational powers of a negative base used to return NaN under N()
  // (Math.pow(negative, non-integer) = NaN). They now compute the right value:
  // an even denominator takes the principal complex branch, an odd denominator
  // the real root (consistent with the unit-fraction cases above).
  test(`Even-denominator rational power of a negative base is complex`, () => {
    const a = ce.expr(['Power', -4, ['Rational', 3, 2]]).N(); // (-4)^{3/2} = -8i
    expect(a.re).toBe(0);
    expect(a.im).toBeCloseTo(-8, 12);

    const b = ce.expr(['Power', -4, ['Rational', 5, 2]]).N(); // 32i
    expect(b.re).toBe(0);
    expect(b.im).toBeCloseTo(32, 12);

    const c = ce.expr(['Power', -4, ['Rational', -3, 2]]).N(); // i/8
    expect(c.re).toBe(0);
    expect(c.im).toBeCloseTo(0.125, 12);
  });

  test(`Odd-denominator rational power of a negative base is the real root`, () => {
    expect(ce.expr(['Power', -8, ['Rational', 2, 3]]).N().re).toBeCloseTo(4, 12);
    expect(ce.expr(['Power', -8, ['Rational', 2, 3]]).N().im).toBe(0);
    expect(ce.expr(['Power', -8, ['Rational', 5, 3]]).N().re).toBeCloseTo(
      -32,
      12
    );
    expect(ce.expr(['Power', -8, ['Rational', -2, 3]]).N().re).toBeCloseTo(
      0.25,
      12
    );
    // Consistent with ((-8)^{1/3})^2 = (-2)^2 = 4 (no branch non-confluence).
    expect(
      ce.expr(['Power', ['Power', -8, ['Rational', 1, 3]], 2]).N().re
    ).toBeCloseTo(4, 12);
  });

  // exact evaluate() of a non-unit rational power reduces to an exact value
  // when the root is a perfect power — extending the unit-fraction reduction
  // above (8^{1/3} = 2, (-8)^{1/3} = -2) and matching what N() computes.
  test(`Non-unit rational power of a perfect power evaluates exactly`, () => {
    // Positive base — any denominator
    expect(ce.expr(['Power', 8, ['Rational', 2, 3]]).evaluate().json).toEqual(4);
    expect(ce.expr(['Power', 4, ['Rational', 3, 2]]).evaluate().json).toEqual(8);
    expect(
      ce.expr(['Power', 27, ['Rational', 2, 3]]).evaluate().json
    ).toEqual(9);
    // Negative base — odd denominator (real root)
    expect(
      ce.expr(['Power', -8, ['Rational', 2, 3]]).evaluate().json
    ).toEqual(4);
    expect(
      ce.expr(['Power', -8, ['Rational', 5, 3]]).evaluate().json
    ).toEqual(-32);
  });

  test(`Non-perfect or complex rational powers stay symbolic under evaluate()`, () => {
    // Not a perfect power → symbolic
    expect(ce.expr(['Power', 2, ['Rational', 2, 3]]).evaluate().operator).toBe(
      'Power'
    );
    // Negative base, even denominator (complex) → symbolic under evaluate()
    // (N() still gives the principal complex value)
    expect(ce.expr(['Power', -4, ['Rational', 3, 2]]).evaluate().operator).toBe(
      'Power'
    );
  });
});

describe('INVALID ROOT', () => {
  test(`Too few args`, () =>
    expect(ce.expr(['Root', 2.5]).evaluate()).toMatchSnapshot());
  test(`Too many args`, () =>
    expect(ce.expr(['Root', 2.5, -1.1, 18.4]).evaluate()).toMatchSnapshot());
});

describe('SQRT', () => {
  test(`√0`, () => expect(checkJson(['Sqrt', 0])).toMatchSnapshot());

  test(`√2.5`, () => {
    expect(checkJson(['Sqrt', 2.5])).toMatchSnapshot();
  });

  test(`√(175)`, () => expect(checkJson(['Sqrt', 175])).toMatchSnapshot());

  test(`√(12345670000000000000000000)`, () =>
    expect(
      checkJson(['Sqrt', { num: '12345670000000000000000000' }])
    ).toMatchSnapshot());

  test(`√(5/7)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 5, 7]])).toMatchSnapshot());

  // √12345678901234567890 = 3 x √1371742100137174210
  test(`√12345678901234567890`, () =>
    expect(
      checkJson(['Sqrt', { num: '12345678901234567890' }])
    ).toMatchSnapshot());

  test(`√123456789.01234567890`, () =>
    expect(
      checkJson(['Sqrt', { num: '123456789.01234567890' }])
    ).toMatchSnapshot());

  test(`√(1000000/49)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 1000000, 49]])).toMatchSnapshot());

  test(`√(1000001/7)`, () =>
    expect(checkJson(['Sqrt', ['Rational', 1000001, 7]])).toMatchSnapshot());

  test(`√(12345678901234567890/23456789012345678901)`, () =>
    expect(
      checkJson([
        'Sqrt',
        [
          'Rational',
          { num: '12345678901234567890' },
          { num: '23456789012345678901' },
        ],
      ])
    ).toMatchSnapshot());

  test(`√(3+4i)`, () =>
    expect(checkJson(['Sqrt', ['Complex', 3, 4]])).toMatchSnapshot());

  test(`√(4x)`, () =>
    expect(checkJson(['Sqrt', ['Multiply', 4, 'x']])).toMatchSnapshot());

  test(`√(3^2)`, () =>
    expect(checkJson(['Sqrt', ['Square', 3]])).toMatchSnapshot());

  test(`√(5x(3+2))`, () =>
    expect(
      checkJson(['Sqrt', ['Multiply', 5, ['Add', 3, 2]]])
    ).toMatchSnapshot());

  test('√ of list', () => {
    expect(
      ce
        .expr(['Sqrt', ['List', 4, 1, 56, 18]])
        .N()
        .toString()
    ).toMatchSnapshot();
  });

  test(`INVALID Sqrt`, () =>
    expect(checkJson(['Sqrt', 2.5, 1.1])).toMatchSnapshot());
  test(`INVALID  Sqrt`, () =>
    expect(checkJson(['Sqrt', 2.5, -1.1, 18.4])).toMatchSnapshot());
});

describe('Square', () => {
  test(`Square`, () => expect(checkJson(['Square', 2.5])).toMatchSnapshot());
  test(`INVALID Square`, () =>
    expect(checkJson(['Square', 2.5, 1.1])).toMatchSnapshot());
  test(`INVALID Square`, () =>
    expect(checkJson(['Square', 2.5, -1.1, 18.4])).toMatchSnapshot());
});

describe('Min/Max', () => {
  test(`Max`, () => {
    expect(checkJson(['Max', 2.5])).toMatchSnapshot();
    expect(checkJson(['Max', 2.5, 1.1])).toMatchSnapshot();
    expect(checkJson(['Max', 2.5, -1.1, 18.4])).toMatchSnapshot();
  });
  expect(checkJson(['Max', 2.5, -1.1, 'NaN', 18.4])).toMatchSnapshot();
  expect(checkJson(['Max', 2.5, -1.1, 'foo', 18.4])).toMatchSnapshot();
  expect(checkJson(['Max', 'foo', 'bar'])).toMatchSnapshot();

  expect(ce.expr(['Max', ['Range', 1, 10]]).N().value).toMatchInlineSnapshot(
    `10`
  );

  expect(ce.expr(['Max', ['Range', 1.2, 4.5]]).N().value).toMatchInlineSnapshot(
    `4.2`
  );

  expect(ce.expr(['Max', ['Range', 1, 10, 7]]).N().value).toMatchInlineSnapshot(
    `8`
  );
  expect(
    ce.expr(['Max', ['Interval', 1.1, 7.8]]).N().value
  ).toMatchInlineSnapshot(`7.8`);
  expect(
    ce.expr(['Max', ['List', 4, 1, 56, 18]]).N().value
  ).toMatchInlineSnapshot(`56`);
  expect(
    ce.expr(['Max', ['Set', 4, 1, 56, 18]]).N().value
  ).toMatchInlineSnapshot(`56`);

  expect(
    ce
      .expr(['Max', ['List', 4, 1, 'bar', 56, 'foo', 18]])
      .N()
      .toString()
  ).toMatchInlineSnapshot(`max(56, "bar", "foo")`);
  test(`Min`, () =>
    expect(checkJson(['Min', 2.5])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5]
      simplify  = 2.5
    `));
  expect(checkJson(['Min', 2.5, 1.1])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, 1.1]
      eval-auto = 1.1
    `);
  expect(checkJson(['Min', 2.5, -1.1, 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, 18.4]
      eval-auto = -1.1
    `);
  expect(checkJson(['Min', 2.5, -1.1, 'NaN', 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, "NaN", 18.4]
      eval-auto = NaN
    `);
  expect(checkJson(['Min', 2.5, -1.1, 'foo', 18.4])).toMatchInlineSnapshot(`
      box       = ["Min", 2.5, -1.1, "foo", 18.4]
      eval-auto = min(-1.1, "foo")
    `);
  expect(checkJson(['Min', 'foo', 'bar'])).toMatchInlineSnapshot(
    `["Min", "foo", "bar"]`
  );

  expect(ce.expr(['Min', ['Range', 1, 10]]).N().value).toMatchInlineSnapshot(
    `1`
  );

  expect(ce.expr(['Min', ['Range', 1.2, 4.5]]).N().value).toMatchInlineSnapshot(
    `1.2`
  );
  expect(ce.expr(['Min', ['Range', 1, 10, 7]]).N().value).toMatchInlineSnapshot(
    `1`
  );
  expect(
    ce.expr(['Min', ['Interval', 1.1, 7.8]]).N().value
  ).toMatchInlineSnapshot(`1.1`);
});

describe('RATIONAL', () => {
  test(`Rational`, () =>
    expect(checkJson(['Rational', 3, 4])).toMatchSnapshot());

  test(`Bignum rational`, () =>
    expect(
      checkJson([
        'Rational',
        { num: '12345678901234567890' },
        { num: '23456789012345678901' },
      ])
    ).toMatchSnapshot());

  test(`INVALID Rational`, () => {
    expect(checkJson(['Rational', 2.5, -1.1, 18.4])).toMatchSnapshot();
    expect(checkJson(['Rational', 2, 3, 5])).toMatchSnapshot();
  });
  test(`Rational as Divide`, () =>
    expect(checkJson(['Rational', 3.1, 2.8])).toMatchSnapshot());
  test(`Rational approximation`, () =>
    expect(checkJson(['Rational', 2.5])).toMatchSnapshot());
  test(`Rational approximation`, () =>
    expect(checkJson(['Rational', 'Pi'])).toMatchSnapshot());
});

describe('RATIONALIZE', () => {
  const r = (expr: any) => ce.box(expr).evaluate().toString();
  test('full-precision rationalization (as single-arg Rational)', () => {
    expect(r(['Rationalize', 1.75])).toEqual('7/4');
    expect(r(['Rationalize', 2.5])).toEqual('5/2');
  });
  test('tolerance selects the shortest convergent within the bound', () => {
    // √3 ≈ 1.7320508; 26/15 ≈ 1.73333 is within 1/500, 19/11 is not.
    expect(r(['Rationalize', ['Sqrt', 3], ['Rational', 1, 500]])).toEqual(
      '26/15'
    );
    // The classic π ≈ 22/7 within 1/100.
    expect(r(['Rationalize', 'Pi', ['Rational', 1, 100]])).toEqual('22/7');
  });
  test('integers and free variables stay put', () => {
    expect(r(['Rationalize', 4])).toEqual('4');
    expect(r(['Rationalize', 'x'])).toEqual('Rationalize(x)');
  });
});

describe('Log', () => {
  test(`Log 1.1`, () => expect(checkJson(['Log', 1.1])).toMatchSnapshot());
  test(`Log 1`, () => expect(checkJson(['Log', 1])).toMatchSnapshot());
  test(`Log 0`, () => expect(checkJson(['Log', 0])).toMatchSnapshot());
  test(`Log -1`, () => expect(checkJson(['Log', -1])).toMatchSnapshot());
  test(`Log -2`, () => expect(checkJson(['Log', -2])).toMatchSnapshot());
  test(`Log 'Pi'`, () => expect(checkJson(['Log', 'Pi'])).toMatchSnapshot());
  test(`Log ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Log', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('LN', () => {
  test(`Ln 1.1`, () => expect(checkJson(['Ln', 1.1])).toMatchSnapshot());
  test(`Ln 1`, () => expect(checkJson(['Ln', 1])).toMatchSnapshot());
  test(`Ln 0`, () => expect(checkJson(['Ln', 0])).toMatchSnapshot());
  test(`Ln -1`, () => expect(checkJson(['Ln', -1])).toMatchSnapshot());
  test(`Ln -2`, () => expect(checkJson(['Ln', -2])).toMatchSnapshot());
  test(`Ln 'Pi'`, () => expect(checkJson(['Ln', 'Pi'])).toMatchSnapshot());
  test(`Ln ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Ln', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('Ln of Root (REVIEW.md A2)', () => {
  // ln_c(root(a, b)) = (1/b)·ln_c(a). The buggy code returned the
  // reciprocal b / ln_c(a).
  test('ln(Root(x, 3)) = ln(x)/3 via .ln() API', () =>
    expect(ce.expr(['Root', 'x', 3]).ln().toString()).toEqual('1/3 * ln(x)'));

  test('Ln(Root(x, 3)) = ln(x)/3 via expression evaluation', () =>
    expect(ce.expr(['Ln', ['Root', 'x', 3]]).evaluate().toString()).toEqual(
      '1/3 * ln(x)'
    ));

  test('ln(Root(8, 3)) is numerically ln(2)', () =>
    expect(ce.expr(['Root', 8, 3]).ln().N().re).toBeCloseTo(Math.log(2), 12));
});

describe('LB', () => {
  test(`Lb 1.1`, () => expect(checkJson(['Lb', 1.1])).toMatchSnapshot());
  test(`Lb 1`, () => expect(checkJson(['Lb', 1])).toMatchSnapshot());
  test(`Lb 0`, () => expect(checkJson(['Lb', 0])).toMatchSnapshot());
  test(`Lb -1`, () => expect(checkJson(['Lb', -1])).toMatchSnapshot());
  test(`Lb -2`, () => expect(checkJson(['Lb', -2])).toMatchSnapshot());
  test(`Lb 'Pi'`, () => expect(checkJson(['Lb', 'Pi'])).toMatchSnapshot());
  test(`Lb ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Lb', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('LG', () => {
  test(`LG 1.1`, () => expect(checkJson(['Lg', 1.1])).toMatchSnapshot());
  test(`LG 1`, () => expect(checkJson(['Lg', 1])).toMatchSnapshot());
  test(`LG 0`, () => expect(checkJson(['Lg', 0])).toMatchSnapshot());
  test(`LG -1`, () => expect(checkJson(['Lg', -1])).toMatchSnapshot());
  test(`LG 'Pi'`, () => expect(checkJson(['Lg', 'Pi'])).toMatchSnapshot());
  test(`LG ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Lg', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
});

describe('LOG(a,b)', () => {
  test(`Log 1.1, 5`, () =>
    expect(checkJson(['Log', 1.1, 5])).toMatchSnapshot());
  test(`Log 1, 5`, () => expect(checkJson(['Log', 1, 5])).toMatchSnapshot());
  test(`Log 0, 5`, () => expect(checkJson(['Log', 0, 5])).toMatchSnapshot());
  test(`Log -1, 5`, () => expect(checkJson(['Log', -1, 5])).toMatchSnapshot());
  test(`Log 'Pi', 5`, () =>
    expect(checkJson(['Log', 'Pi', 5])).toMatchSnapshot());
  test(`Log ['Complex', 1.1, 1.1], 5`, () =>
    expect(checkJson(['Log', ['Complex', 1.1, 1.1], 5])).toMatchSnapshot());
});

describe('LOG common-base rational reduction', () => {
  const logEval = (a: number, b: number) =>
    ce.expr(['Log', a, b]).evaluate().toString();
  test('log_8(2) = 1/3', () => expect(logEval(2, 8)).toEqual('1/3'));
  test('log_8(32768) = 5', () => expect(logEval(32768, 8)).toEqual('5'));
  test('log_2(8) = 3', () => expect(logEval(8, 2)).toEqual('3'));
  test('log_4(8) = 3/2', () => expect(logEval(8, 4)).toEqual('3/2'));
  test('log_9(27) = 3/2', () => expect(logEval(27, 9)).toEqual('3/2'));
  test('log_27(9) = 2/3', () => expect(logEval(9, 27)).toEqual('2/3'));
  test('log_8(10) stays symbolic', () =>
    expect(logEval(10, 8)).toEqual('log(10, 8)'));
  test('log_b(1) = 0', () => expect(logEval(1, 8)).toEqual('0'));
  // Exactness contract: ln of an exact argument stays symbolic under evaluate.
  test('ln(2) stays symbolic', () =>
    expect(ce.parse('\\ln 2').evaluate().toString()).toEqual('ln(2)'));
});

describe('INVALID LOG', () => {
  test(`Ln`, () => expect(checkJson(['Ln'])).toMatchSnapshot());
  test(`Ln with string argument`, () =>
    expect(checkJson(['Ln', "'string'"])).toMatchSnapshot());
  test(`Ln with two numeric arguments`, () =>
    expect(checkJson(['Ln', 3, 4])).toMatchSnapshot());
});

describe('EXP', () => {
  test(`Exp 1.1`, () => expect(checkJson(['Exp', 1.1])).toMatchSnapshot());
  test(`Exp 1`, () => expect(checkJson(['Exp', 1])).toMatchSnapshot());
  test(`Exp 0`, () => expect(checkJson(['Exp', 0])).toMatchSnapshot());
  test(`Exp -1`, () => expect(checkJson(['Exp', -1])).toMatchSnapshot());
  test(`Exp 'Pi'`, () => expect(checkJson(['Exp', 'Pi'])).toMatchSnapshot());
  test(`Exp ['Complex', 1.1, 1.1]`, () =>
    expect(checkJson(['Exp', ['Complex', 1.1, 1.1]])).toMatchSnapshot());
  test(`Exp ['List', 1.1, 2, 4]`, () =>
    expect(checkJson(['Exp', ['List', 1.1, 2, 4]])).toMatchSnapshot());
});

describe('SUM', () => {
  it('should compute the sum of a function over a closed interval', () =>
    expect(
      ce
        .expr(['Sum', ['Divide', 1, 'x'], ['Tuple', 'x', 1, 10]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`7381/2520`));

  it('should compute the sum of a function over an open interval', () =>
    expect(
      ce
        .expr(['Sum', ['Divide', 1, 'x'], ['Tuple', 'x', 1, 100]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(
      `14466636279520351160221518043104131447711/2788815009188499086581352357412492142272`
    ));

  it('should compute the sum of a function over an open interval numerically', () => {
    // Sums 1/x over the default unbounded range (MAX_ITERATION = 10000 terms).
    // Fast locally (~60ms), but on slow/loaded CI hardware it can exceed the
    // engine's default 2000ms internal deadline and abort with a
    // CancellationError. Raise the deadline so the computation can complete.
    const savedTimeLimit = ce.timeLimit;
    ce.timeLimit = 30_000;
    try {
      const result = ce.expr(['Sum', ['Divide', 1, 'x'], 'x']).N();
      expect(result.re).toBeCloseTo(9.787606036044382);
    } finally {
      ce.timeLimit = savedTimeLimit;
    }
  }, 30_000);

  it('should compute the sum of a collection', () =>
    expect(
      ce
        .expr(['Sum', ['Range', 1, 10]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`55`));

  // Regression: summing a collection of strings used to fold to a silent NaN.
  // It must surface an incompatible-type error (consistent with Product, which
  // also yields an error-typed result rather than a numeric answer).
  it('a string element yields a typed error, not NaN', () => {
    const result = ce
      .expr(['Sum', ['List', { str: 'a' }, { str: 'b' }]])
      .evaluate();
    expect(result.type.toString()).toBe('error');
    expect(result.toString()).not.toContain('NaN');
    // A numeric element mixed with a string still errors (does not silently
    // drop the string).
    const mixed = ce
      .expr(['Sum', ['List', 1, { str: 'a' }, 3]])
      .evaluate();
    expect(mixed.type.toString()).toBe('error');
  });

  // Tycho item 32.1: a body that is not *structurally* a collection but
  // EVALUATES to one (a broadcast chain over a list literal) must reduce,
  // not return the broadcast list whole.
  it('reduces a computed list-valued body (Tycho item 32.1)', () => {
    expect(
      ce
        .parse(
          '\\operatorname{Sum}(\\operatorname{mod}(\\operatorname{floor}(7/2^{[0...10]}),2))'
        )
        .evaluate()
        .toString()
    ).toBe('3');
    // Product has the same arity-1 reducer form.
    expect(
      ce
        .box(['Product', ['Add', ['List', 1, 2, 3], 1]])
        .evaluate()
        .toString()
    ).toBe('24');
  });

  // Tycho item 44a: a big-op `Sum`/`Product` over a collection-valued body
  // (here `a(...)` returns `vector<2>`) must type as that collection, not
  // `number` — its evaluation is an elementwise `List`. The critical
  // consequence: `At` over such a Sum must canonicalize without baking an
  // incompatible-type error, and index into the element type.
  it('Sum/Product over a vector-valued body type as the vector (Tycho item 44a)', () => {
    const engine = new ComputeEngine();
    engine.parse('a(t)\\coloneq[\\cos t,\\sin t]').evaluate();
    engine.parse('h(i)\\coloneq\\operatorname{mod}(10^{4}\\sin(10^{4}i),1)').evaluate();
    engine
      .parse('A(t)\\coloneq\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))')
      .evaluate();

    const sum = engine.parse(
      '\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i))'
    );
    expect(sum.type.toString()).toBe('vector<2>');
    const prod = engine.parse('\\prod_{i=0}^{2}a(i)');
    expect(prod.type.toString()).toBe('vector<2>');

    // At over the list-valued Sum no longer bakes an incompatible-type error.
    const at = engine.parse(
      '(\\sum_{i=0}^{6}h(i)\\frac{1}{1.4^{i}}a(1.9^{i}t+h(i)))[1]'
    );
    expect(at.isValid).toBe(true);

    // A's inferred result is the vector, so A(t)[1] types the element (not
    // `any`) and evaluates to a number once `t` is bound.
    expect(engine.parse('A(t)').type.toString()).toBe('vector<2>');
    expect(engine.parse('A(t)[1]').type.toString()).toBe('number');
    engine.assign('t', 0.5);
    expect(engine.parse('A(t)[1]').evaluate().re).toBeCloseTo(-0.3883979339);

    // A scalar body still types as `number` (no over-eager collection claim).
    expect(engine.parse('\\sum_{i=0}^{6}i^2').type.toString()).toBe('number');
  });

  // Tycho item 32.2: `["Sum", body]` serializes to a bounds-less `\sum` which
  // must re-parse to `Sum` (not `Reduce(body, Add)`), and no operator name
  // may leak into `.unknowns`.
  it('bounds-less serialization round-trips without unknowns leak (Tycho item 32.2)', () => {
    const body = ['Mod', ['Floor', ['Divide', 7, ['Power', 2, 'k']]], 2];
    const reparsed = ce.parse(ce.box(['Sum', body]).latex);
    expect(reparsed.operator).toBe('Sum');
    expect(reparsed.unknowns).toEqual(['k']);
  });

  // Tycho item 33: `subs()` on a canonical Sum must not re-type the bound
  // index `i` as the imaginary unit (the raw held `Limits` index was being
  // canonicalized outside its binding scope).
  it('subs() preserves a bound index named i (Tycho item 33)', () => {
    const subbed = ce.parse('\\sum_{i=1}^{n}2^{-i}').subs({ n: 9 });
    expect(subbed.json).toEqual([
      'Sum',
      ['Power', 2, ['Negate', 'i']],
      ['Limits', 'i', 1, 9],
    ]);
    expect(subbed.latex).toBe('\\sum_{i=1}^92^{-i}');
    expect(subbed.evaluate().toString()).toBe('511/512');
  });

  // Tycho item 33 (secondary): a bare numeric bounds pair (`\sum_1^9`) is
  // preserved as an index-less `Limits`, not silently dropped.
  it('preserves a numeric bounds pair with no index', () => {
    expect(ce.parse('\\sum_1^9 2^{-k}').json).toEqual([
      'Sum',
      ['Power', 2, ['Negate', 'k']],
      ['Limits', 'Nothing', 1, 9],
    ]);
    expect(ce.parse('\\sum_1^9 2').evaluate().toString()).toBe('18');
  });

  it('should compute the sum of a function over two indices (with optional Hold)', () =>
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', 'i', 'j'],
          ['Tuple', ['Hold', 'i'], 1, 10],
          ['Tuple', 'j', 3, 13],
        ])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`4840`));

  // A `Limits`-based big-op over three or more indexing sets used to lose
  // every dimension but the last two: the fold-based
  // `indexingSetCartesianProduct` returned length-2 tuples (a 2×2×2 product
  // came back as 8 *pairs*), so `reduceBigOp`'s positional `element[i]`
  // handed `undefined` to the third-and-later loop index. The streaming
  // odometer (`indexingSetCartesianProductIterator`) yields the full
  // n-dimensional product, last index varying fastest.
  it('should compute the sum of a function over three indices', () => {
    // Base-10 digit encoding: the result pins each (i, j, k) triple.
    // Σ 100i + 10j + k over 1..2³ = 4·100·(1+2) + 4·10·(1+2) + 4·(1+2) = 1332
    expect(
      ce
        .expr([
          'Sum',
          ['Add', ['Multiply', 100, 'i'], ['Multiply', 10, 'j'], 'k'],
          ['Limits', 'i', 1, 2],
          ['Limits', 'j', 1, 2],
          ['Limits', 'k', 1, 2],
        ])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`1332`);

    // Products are order-insensitive too, but a non-symmetric body catches a
    // dropped or duplicated dimension: (11·12·21·22)² = 3719048256.
    expect(
      ce
        .expr([
          'Product',
          ['Add', ['Multiply', 10, 'i'], 'j'],
          ['Limits', 'i', 1, 2],
          ['Limits', 'j', 1, 2],
          ['Limits', 'k', 1, 2],
        ])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`3719048256`);
  });

  // The ordering the two big-ops above rely on (both are order-insensitive,
  // so it has to be pinned directly). Note the yielded array is reused
  // between iterations, hence the copy.
  it('streams the full n-dimensional index product, last index fastest', () => {
    const tuples = (
      sets: { lower: number; upper: number }[]
    ): number[][] => {
      const out: number[][] = [];
      for (const t of indexingSetCartesianProductIterator(
        sets.map(({ lower, upper }) => ({
          index: 'x',
          lower,
          upper,
          isFinite: true,
        }))
      ))
        out.push([...t]);
      return out;
    };

    expect(
      tuples([
        { lower: 1, upper: 2 },
        { lower: 1, upper: 2 },
        { lower: 1, upper: 2 },
      ])
    ).toEqual([
      [1, 1, 1],
      [1, 1, 2],
      [1, 2, 1],
      [1, 2, 2],
      [2, 1, 1],
      [2, 1, 2],
      [2, 2, 1],
      [2, 2, 2],
    ]);

    // A singleton range whose bound is above `Number.MAX_SAFE_INTEGER`:
    // `current + 1` rounds back to the same value, so the odometer wheel has
    // to be detected as exhausted rather than spun forever.
    expect(tuples([{ lower: 1e16, upper: 1e16 }])).toEqual([[1e16]]);
  });

  // A NON-degenerate range above `Number.MAX_SAFE_INTEGER` cannot be walked
  // at `number` precision (`current + 1` rounds back to `current`). It used
  // to yield a single term, silently truncating a ~11-term sum; it now
  // surfaces as an error instead.
  it('reports non-enumerable (unsafe-integer) bounds as an error', () => {
    // A genuine singleton is NOT an error: exactly one term.
    expect(
      ce.expr(['Sum', 1, ['Limits', 'n', 1e16, 1e16]]).evaluate().toString()
    ).toMatchInlineSnapshot(`1`);

    const unsafe = ce
      .expr(['Sum', 1, ['Limits', 'n', 1e16, 1e16 + 10]])
      .evaluate();
    expect(unsafe.operator).toBe('Error');
    expect(unsafe.toString()).toMatchInlineSnapshot(
      `Error(ErrorCode("out-of-range", "a bound with magnitude at most 9007199254740991", "10000000000000000..10000000000000010"))`
    );

    // Products go through the same seam.
    expect(
      ce
        .expr(['Product', 2, ['Limits', 'n', 1e16, 1e16 + 10]])
        .evaluate().operator
    ).toBe('Error');

    // Bounds that ARE enumerable keep working: a fractional upper bound
    // truncates by design, and an empty range is still empty.
    expect(
      ce.expr(['Sum', 1, ['Limits', 'n', 1, 10.5]]).evaluate().toString()
    ).toMatchInlineSnapshot(`10`);
    expect(
      ce.expr(['Sum', 1, ['Limits', 'n', 5, 1]]).evaluate().toString()
    ).toMatchInlineSnapshot(`0`);
  });

  // Regression tests for issue #252: Sum with free variables
  it('should handle sum with free variable (issue #252)', () =>
    expect(
      ce.parse('\\sum_{n=1}^{10}(x)').evaluate().toString()
    ).toMatchInlineSnapshot(`10x`));

  it('should handle sum with mixed index and free variable (issue #252)', () =>
    expect(
      ce.parse('\\sum_{n=1}^{10}(n \\cdot x)').evaluate().toString()
    ).toMatchInlineSnapshot(`55x`));

  it('should handle sum with addition of index and free variable (issue #252)', () =>
    expect(
      ce.parse('\\sum_{n=1}^{3}(n + x)').evaluate().simplify().toString()
    ).toMatchInlineSnapshot(`3x + 6`));

  // Simplification of Sum with symbolic bounds
  it('should simplify sum of constant with symbolic bounds', () => {
    expect(
      ce.parse('\\sum_{n=1}^{b}(x)').simplify().toString()
    ).toMatchInlineSnapshot(`b * x`);
  });

  it('should simplify sum of index (triangular number)', () => {
    expect(
      ce.parse('\\sum_{n=1}^{b}(n)').simplify().toString()
    ).toMatchInlineSnapshot(`1/2 * (b^2 + b)`);
  });

  it('should simplify sum of index squared', () => {
    expect(
      ce.parse('\\sum_{n=1}^{b}(n^2)').simplify().toString()
    ).toMatchInlineSnapshot(`1/3 * b^3 + 1/2 * b^2 + 1/6 * b`);
  });

  it('should factor out constant from sum', () => {
    expect(
      ce.parse('\\sum_{n=1}^{b}(3n)').simplify().toString()
    ).toMatchInlineSnapshot(`3/2 * (b^2 + b)`);
  });

  it('should factor out symbolic constant from sum', () => {
    expect(
      ce.parse('\\sum_{n=1}^{b}(x \\cdot n)').simplify().toString()
    ).toMatchInlineSnapshot(`1/2 * x * (b^2 + b)`);
  });

  it('should simplify sum of cubes', () => {
    expect(
      ce.parse('\\sum_{n=1}^{b}(n^3)').simplify().toString()
    ).toMatchInlineSnapshot(`1/4 * (b^2 + b)^2`);
  });

  it('should simplify geometric series starting at 0', () => {
    ce.declare('r', 'real');
    expect(
      ce.parse('\\sum_{n=0}^{b}(r^n)').simplify().toString()
    ).toMatchInlineSnapshot(`(1 - r^(b + 1)) / (1 - r)`);
  });

  it('should simplify geometric series starting at 1', () => {
    expect(
      ce.parse('\\sum_{n=1}^{b}(r^n)').simplify().toString()
    ).toMatchInlineSnapshot(`(r - r^(b + 1)) / (1 - r)`);
  });

  it('should evaluate geometric series numerically', () => {
    expect(
      ce.parse('\\sum_{n=0}^{5}(2^n)').simplify().toString()
    ).toMatchInlineSnapshot(`63`);
  });

  // Edge cases
  it('should return 0 for empty sum range', () => {
    expect(
      ce.parse('\\sum_{n=5}^{1}(n)').simplify().toString()
    ).toMatchInlineSnapshot(`0`);
  });

  it('should return body value for single iteration sum', () => {
    expect(
      ce.parse('\\sum_{n=5}^{5}(n^2)').simplify().toString()
    ).toMatchInlineSnapshot(`25`);
  });

  // Alternating unit series
  it('should simplify alternating unit series', () => {
    expect(
      ce.parse('\\sum_{n=0}^{b}((-1)^n)').simplify().toString()
    ).toMatchInlineSnapshot(`1/2 * (-1)^b + 1/2`);
  });

  it('should evaluate alternating unit series (even upper bound)', () => {
    expect(
      ce.parse('\\sum_{n=0}^{4}((-1)^n)').evaluate().toString()
    ).toMatchInlineSnapshot(`1`);
  });

  it('should evaluate alternating unit series (odd upper bound)', () => {
    expect(
      ce.parse('\\sum_{n=0}^{5}((-1)^n)').evaluate().toString()
    ).toMatchInlineSnapshot(`0`);
  });

  // Arithmetic progression
  it('should simplify arithmetic progression', () => {
    ce.declare('a', 'real');
    ce.declare('d', 'real');
    expect(
      ce.parse('\\sum_{n=0}^{b}(a + d*n)').simplify().toString()
    ).toMatchInlineSnapshot(`(b + 1) * (1/2 * b * d + a)`);
  });

  it('should evaluate arithmetic progression numerically', () => {
    // 2 + 5 + 8 + 11 + 14 = 40
    expect(
      ce.parse('\\sum_{n=0}^{4}(2 + 3*n)').evaluate().toString()
    ).toMatchInlineSnapshot(`40`);
  });

  // Alternating linear series
  it('should simplify alternating linear series', () => {
    expect(
      ce.parse('\\sum_{n=0}^{b}((-1)^n * n)').simplify().toString()
    ).toMatchInlineSnapshot(`floor(1/2 * (b + 1)) * (-1)^b`);
  });

  it('should evaluate alternating linear series', () => {
    // 0 - 1 + 2 - 3 + 4 = 2
    expect(
      ce.parse('\\sum_{n=0}^{4}((-1)^n * n)').evaluate().toString()
    ).toMatchInlineSnapshot(`2`);
  });

  // General bounds for triangular number
  it('should simplify sum with general lower bound', () => {
    // 'a' already declared above
    expect(
      ce.parse('\\sum_{n=a}^{b}(n)').simplify().toString()
    ).toMatchInlineSnapshot(`1/2 * (-a^2 + b^2 + a + b)`);
  });

  it('should evaluate sum with numeric lower bound', () => {
    // 3 + 4 + 5 + 6 + 7 = 25
    expect(
      ce.parse('\\sum_{n=3}^{7}(n)').simplify().toString()
    ).toMatchInlineSnapshot(`25`);
  });

  // Regression test for #287: product of Choose values losing precision
  it('should compute product of large Choose values exactly', () => {
    // Choose(35,7)*Choose(28,7)*Choose(21,7)*Choose(14,7)*Choose(7,7) = 35!/(7!)^5
    const expr1 = ce.expr([
      'Multiply',
      ['Binomial', 35, 7],
      ['Binomial', 28, 7],
      ['Binomial', 21, 7],
      ['Binomial', 14, 7],
      ['Binomial', 7, 7],
    ]);
    const expr2 = ce.expr([
      'Divide',
      ['Factorial', 35],
      ['Power', ['Factorial', 7], 5],
    ]);
    expect(expr1.evaluate().sub(expr2.evaluate()).evaluate().toString()).toBe(
      '0'
    );
  });

  // Sum of binomial coefficients
  it('should simplify sum of binomial coefficients', () => {
    expect(
      ce
        .expr(['Sum', ['Binomial', 'b', 'k'], ['Limits', 'k', 0, 'b']])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`2^b`);
  });

  it('should evaluate sum of binomial coefficients', () => {
    // C(5,0) + C(5,1) + ... + C(5,5) = 32
    expect(
      ce
        .expr(['Sum', ['Binomial', 5, 'k'], ['Limits', 'k', 0, 5]])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`32`);
  });

  // Nested sum simplification
  it('should simplify nested sums', () => {
    // sum_{k=1}^{n} sum_{j=1}^{k} 1 = sum_{k=1}^{n} k = n(n+1)/2
    expect(
      ce.parse('\\sum_{k=1}^{b}\\sum_{j=1}^{k}(1)').simplify().toString()
    ).toMatchInlineSnapshot(`1/2 * (b^2 + b)`);
  });

  // Alternating binomial sum: Sum((-1)^k * C(n,k), [k, 0, n]) = 0, valid only
  // for n > 0 (at n = 0 the sum is 1). The rule fires only when the bound is
  // *provably* positive (CORRECTNESS_FINDINGS.md CR-P1-4) — scope a local
  // `b > 0` assumption so this test still exercises the closed form.
  it('should simplify alternating binomial sum to 0 (n provably > 0)', () => {
    ce.pushScope();
    ce.assume(ce.parse('b > 0'));
    try {
      expect(
        ce
          .expr([
            'Sum',
            ['Multiply', ['Power', -1, 'k'], ['Binomial', 'b', 'k']],
            ['Tuple', 'k', 0, 'b'],
          ])
          .simplify()
          .toString()
      ).toMatchInlineSnapshot(`0`);
    } finally {
      ce.popScope();
    }
  });

  it('should NOT apply the alternating binomial sum rule when n is not provably > 0 (CR-P1-4)', () => {
    // `b` is only declared `integer` here (no positivity assumption), so the
    // n=0 edge case (sum = 1, not 0) must not be silently assumed away.
    const result = ce
      .expr([
        'Sum',
        ['Multiply', ['Power', -1, 'k'], ['Binomial', 'b', 'k']],
        ['Tuple', 'k', 0, 'b'],
      ])
      .simplify();
    expect(result.has('Sum')).toBe(true);
  });

  it('alternating binomial sum at the n=0 boundary evaluates to 1, not 0 (CR-P1-4)', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', -1, 'k'], ['Binomial', 0, 'k']],
          ['Tuple', 'k', 0, 0],
        ])
        .evaluate()
        .toString()
    ).toBe('1');
  });

  it('should evaluate alternating binomial sum', () => {
    // (-1)^0 * C(4,0) + (-1)^1 * C(4,1) + ... + (-1)^4 * C(4,4) = 1 - 4 + 6 - 4 + 1 = 0
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', -1, 'k'], ['Binomial', 4, 'k']],
          ['Tuple', 'k', 0, 4],
        ])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`0`);
  });

  // Weighted binomial sum: Sum(k * C(n,k), [k, 0, n]) = n * 2^(n-1)
  it('should simplify weighted binomial sum', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', 'k', ['Binomial', 'b', 'k']],
          ['Tuple', 'k', 0, 'b'],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`b * 2^(b - 1)`);
  });

  it('should evaluate weighted binomial sum', () => {
    // 0*C(4,0) + 1*C(4,1) + 2*C(4,2) + 3*C(4,3) + 4*C(4,4) = 0 + 4 + 12 + 12 + 4 = 32 = 4 * 2^3
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', 'k', ['Binomial', 4, 'k']],
          ['Tuple', 'k', 0, 4],
        ])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`32`);
  });

  // Partial fractions / telescoping: Sum(1/(k*(k+1)), [k, 1, n]) = n/(n+1)
  it('should simplify partial fractions (telescoping sum)', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Divide', 1, ['Multiply', 'k', ['Add', 'k', 1]]],
          ['Tuple', 'k', 1, 'b'],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`b / (b + 1)`);
  });

  it('should evaluate partial fractions (telescoping sum)', () => {
    // 1/(1*2) + 1/(2*3) + 1/(3*4) + 1/(4*5) = 1/2 + 1/6 + 1/12 + 1/20 = 4/5
    expect(
      ce
        .expr([
          'Sum',
          ['Divide', 1, ['Multiply', 'k', ['Add', 'k', 1]]],
          ['Tuple', 'k', 1, 4],
        ])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`4/5`);
  });

  // Partial fractions / telescoping with k*(k-1): Sum(1/(k*(k-1)), [k, 2, n]) = (n-1)/n
  it('should simplify partial fractions 1/(k*(k-1))', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Divide', 1, ['Multiply', 'k', ['Add', 'k', -1]]],
          ['Tuple', 'k', 2, 'b'],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`-1 / b + 1`);
  });

  it('should evaluate partial fractions 1/(k*(k-1))', () => {
    // 1/(2*1) + 1/(3*2) + 1/(4*3) + 1/(5*4) = 1/2 + 1/6 + 1/12 + 1/20 = 4/5
    expect(
      ce
        .expr([
          'Sum',
          ['Divide', 1, ['Multiply', 'k', ['Add', 'k', -1]]],
          ['Tuple', 'k', 2, 5],
        ])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`4/5`);
  });

  // Note: Sum of fourth and fifth powers don't simplify because their
  // closed-form expressions are more expensive than the Sum expression
  // (cost ratio > 1.2). They can still be evaluated numerically.
  it('should evaluate sum of fourth powers numerically', () => {
    // 1^4 + 2^4 + 3^4 + 4^4 = 1 + 16 + 81 + 256 = 354
    expect(
      ce.parse('\\sum_{n=1}^{4}(n^4)').evaluate().toString()
    ).toMatchInlineSnapshot(`354`);
  });

  it('should evaluate sum of fifth powers numerically', () => {
    // 1^5 + 2^5 + 3^5 + 4^5 = 1 + 32 + 243 + 1024 = 1300
    expect(
      ce.parse('\\sum_{n=1}^{4}(n^5)').evaluate().toString()
    ).toMatchInlineSnapshot(`1300`);
  });

  // Weighted squared binomial sum: Sum(k^2 * C(n,k), [k, 0, n]) = n(n+1) * 2^(n-2)
  it('should simplify weighted squared binomial sum', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', 'k', 2], ['Binomial', 'b', 'k']],
          ['Tuple', 'k', 0, 'b'],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`b * (b + 1) * 2^(b - 2)`);
  });

  it('should evaluate weighted squared binomial sum', () => {
    // 0^2*C(4,0) + 1^2*C(4,1) + 2^2*C(4,2) + 3^2*C(4,3) + 4^2*C(4,4) = 0 + 4 + 24 + 36 + 16 = 80 = 4*5*2^2
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', 'k', 2], ['Binomial', 4, 'k']],
          ['Tuple', 'k', 0, 4],
        ])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`80`);
  });

  // Weighted cubed binomial sum: Sum(k^3 * C(n,k), [k, 0, n]) = n²(n+3) * 2^(n-3)
  it('should simplify weighted cubed binomial sum', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', 'k', 3], ['Binomial', 'b', 'k']],
          ['Tuple', 'k', 0, 'b'],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`(b + 3) * b^2 * 2^(b - 3)`);
  });

  it('should evaluate weighted cubed binomial sum', () => {
    // 0 + 1*4 + 8*6 + 27*4 + 64*1 = 0 + 4 + 48 + 108 + 64 = 224 = 16*7*2
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', 'k', 3], ['Binomial', 4, 'k']],
          ['Tuple', 'k', 0, 4],
        ])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`224`);
  });

  // General arithmetic progression: Sum(a + d*n, [n, m, b])
  it('should simplify arithmetic progression with non-zero lower bound', () => {
    // Sum(3n+5, [n, 1, b]) = (b)(5 + 3(1+b)/2) = 3b(b+1)/2 + 5b
    expect(
      ce.parse('\\sum_{n=1}^{b}(3n + 5)').simplify().toString()
    ).toMatchInlineSnapshot(`3/2 * b * (b + 1) + 5b`);
  });

  it('should evaluate arithmetic progression with non-zero lower bound', () => {
    // 8 + 11 + 14 + 17 = 50
    expect(
      ce.parse('\\sum_{n=1}^{4}(3n + 5)').evaluate().toString()
    ).toMatchInlineSnapshot(`50`);
  });

  // Alternating weighted binomial: Sum((-1)^k * k * C(n,k)) = 0, valid only
  // for n >= 2 (n = 0 gives 0 trivially, but n = 1 gives -1). The rule fires
  // only when the bound is *provably* >= 2 (CORRECTNESS_FINDINGS.md
  // CR-P1-4) — scope a local `b >= 2` assumption so this test still
  // exercises the closed form.
  it('should simplify alternating weighted binomial sum to 0 (n provably >= 2)', () => {
    ce.pushScope();
    ce.assume(ce.parse('b \\ge 2'));
    try {
      expect(
        ce
          .expr([
            'Sum',
            ['Multiply', ['Power', -1, 'k'], 'k', ['Binomial', 'b', 'k']],
            ['Tuple', 'k', 0, 'b'],
          ])
          .simplify()
          .toString()
      ).toMatchInlineSnapshot(`0`);
    } finally {
      ce.popScope();
    }
  });

  it('should NOT apply the alternating weighted binomial sum rule when n is not provably >= 2 (CR-P1-4)', () => {
    const result = ce
      .expr([
        'Sum',
        ['Multiply', ['Power', -1, 'k'], 'k', ['Binomial', 'b', 'k']],
        ['Tuple', 'k', 0, 'b'],
      ])
      .simplify();
    expect(result.has('Sum')).toBe(true);
  });

  it('alternating weighted binomial sum at the n=1 boundary evaluates to -1, not 0 (CR-P1-4)', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', -1, 'k'], 'k', ['Binomial', 1, 'k']],
          ['Tuple', 'k', 0, 1],
        ])
        .evaluate()
        .toString()
    ).toBe('-1');
  });

  it('should evaluate alternating weighted binomial sum', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', ['Power', -1, 'k'], 'k', ['Binomial', 4, 'k']],
          ['Tuple', 'k', 0, 4],
        ])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`0`);
  });

  // Sum of binomial squares: Sum(C(n,k)^2) = C(2n, n)
  it('should simplify sum of binomial squares', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Power', ['Binomial', 'b', 'k'], 2],
          ['Tuple', 'k', 0, 'b'],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`Binomial(2b, b)`);
  });

  it('should evaluate sum of binomial squares', () => {
    // C(8,4) = 70
    expect(
      ce
        .expr(['Sum', ['Power', ['Binomial', 4, 'k'], 2], ['Tuple', 'k', 0, 4]])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`70`);
  });

  // Sum of k*(k+1): n(n+1)(n+2)/3
  it('should simplify sum of k*(k+1)', () => {
    expect(
      ce
        .expr([
          'Sum',
          ['Multiply', 'k', ['Add', 'k', 1]],
          ['Tuple', 'k', 1, 'b'],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`1/3 * b^3 + b^2 + 2/3 * b`);
  });

  it('should evaluate sum of k*(k+1)', () => {
    // 4*5*6/3 = 40
    expect(
      ce
        .expr(['Sum', ['Multiply', 'k', ['Add', 'k', 1]], ['Tuple', 'k', 1, 4]])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`40`);
  });
});

describe('PRODUCT', () => {
  it('should compute the product of a collection', () =>
    expect(
      ce
        .expr(['Product', ['Range', 1, 5]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`120`));

  it('should compute the product of a function over an interval', () =>
    expect(
      ce
        .expr(['Product', 'n', ['Tuple', 'n', 1, 5]])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`120`));

  // Regression tests for issue #252: Product with free variables
  it('should handle product with free variable (issue #252)', () =>
    expect(
      ce.parse('\\prod_{n=1}^{5}(x)').evaluate().toString()
    ).toMatchInlineSnapshot(`x^5`));

  it('should handle product with mixed index and free variable (issue #252)', () =>
    expect(
      ce.parse('\\prod_{n=1}^{3}(n \\cdot x)').evaluate().toString()
    ).toMatchInlineSnapshot(`6x^3`));

  // Simplification of Product with symbolic bounds
  it('should simplify product of constant with symbolic bounds', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(x)').simplify().toString()
    ).toMatchInlineSnapshot(`x^b`);
  });

  it('should simplify product of index (factorial)', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(n)').simplify().toString()
    ).toMatchInlineSnapshot(`b!`);
  });

  // Shifted factorial: Product(n+c, [n, 1, b]) = (b+c)!/c!
  it('should simplify product with index shift (n+1)', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(n+1)').simplify().toString()
    ).toMatchInlineSnapshot(`(b + 1)! / 1!`);
  });

  it('should evaluate product with index shift (n+1)', () => {
    // 2*3*4*5 = 120
    expect(
      ce.parse('\\prod_{n=1}^{4}(n+1)').evaluate().toString()
    ).toMatchInlineSnapshot(`120`);
  });

  it('should simplify product with larger index shift (n+3)', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(n+3)').simplify().toString()
    ).toMatchInlineSnapshot(`(b + 3)! / 3!`);
  });

  it('should evaluate product with larger index shift (n+3)', () => {
    // 4*5*6*7 = 840
    expect(
      ce.parse('\\prod_{n=1}^{4}(n+3)').evaluate().toString()
    ).toMatchInlineSnapshot(`840`);
  });

  it('should factor out constant from product', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(3n)').simplify().toString()
    ).toMatchInlineSnapshot(`b! * 3^b`);
  });

  it('should factor out symbolic constant from product', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(x \\cdot n)').simplify().toString()
    ).toMatchInlineSnapshot(`b! * x^b`);
  });

  // Double factorial formulas
  it('should simplify odd double factorial prod(2n-1)', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(2n-1)').simplify().toString()
    ).toMatchInlineSnapshot(`Factorial2(2b - 1)`);
  });

  it('should evaluate odd double factorial', () => {
    // 1 * 3 * 5 = 15
    expect(
      ce.parse('\\prod_{n=1}^{3}(2n-1)').simplify().toString()
    ).toMatchInlineSnapshot(`Factorial2(5)`);
  });

  it('should simplify even double factorial prod(2n)', () => {
    expect(
      ce.parse('\\prod_{n=1}^{b}(2n)').simplify().toString()
    ).toMatchInlineSnapshot(`b! * 2^b`);
  });

  it('should evaluate even double factorial', () => {
    // 2 * 4 * 6 = 48
    expect(
      ce.parse('\\prod_{n=1}^{3}(2n)').evaluate().toString()
    ).toMatchInlineSnapshot(`48`);
  });

  // Rising factorial (Pochhammer)
  it('should simplify rising factorial to Pochhammer', () => {
    expect(
      ce
        .expr([
          'Product',
          ['Add', 'x', 'k'],
          ['Limits', 'k', 0, ['Subtract', 'b', 1]],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`Pochhammer(x, b)`);
  });

  it('should evaluate rising factorial', () => {
    // (3)_4 = 3*4*5*6 = 360
    expect(
      ce
        .expr(['Product', ['Add', 3, 'k'], ['Limits', 'k', 0, 3]])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`360`);
  });

  // Falling factorial
  it('should simplify falling factorial', () => {
    expect(
      ce
        .expr([
          'Product',
          ['Subtract', 'x', 'k'],
          ['Limits', 'k', 0, ['Subtract', 'b', 1]],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`x! / (-b + x)!`);
  });

  it('should evaluate falling factorial', () => {
    // 5 falling 3 = 5*4*3 = 60
    expect(
      ce
        .expr(['Product', ['Subtract', 5, 'k'], ['Limits', 'k', 0, 2]])
        .evaluate()
        ?.toString()
    ).toMatchInlineSnapshot(`60`);
  });

  // Edge cases
  it('should return 1 for empty product range', () => {
    expect(
      ce.parse('\\prod_{n=5}^{1}(n)').simplify().toString()
    ).toMatchInlineSnapshot(`1`);
  });

  it('should return body value for single iteration product', () => {
    expect(
      ce.parse('\\prod_{n=5}^{5}(2n)').simplify().toString()
    ).toMatchInlineSnapshot(`10`);
  });

  // Telescoping product: Product((k+1)/k) = b+1
  it('should simplify telescoping product (k+1)/k', () => {
    expect(
      ce.parse('\\prod_{k=1}^{b}\\frac{k+1}{k}').simplify().toString()
    ).toMatchInlineSnapshot(`b + 1`);
  });

  it('should evaluate telescoping product (k+1)/k', () => {
    // (2/1)*(3/2)*(4/3)*(5/4) = 5
    expect(
      ce.parse('\\prod_{k=1}^{4}\\frac{k+1}{k}').evaluate().toString()
    ).toMatchInlineSnapshot(`5`);
  });

  // Wallis-like product: Product(1 - 1/k^2) = (b+1)/(2b) = 1/(2b) + 1/2
  it('should simplify Wallis-like product 1 - 1/k^2', () => {
    expect(
      ce.parse('\\prod_{k=2}^{b}(1 - \\frac{1}{k^2})').simplify().toString()
    ).toMatchInlineSnapshot(`1 / (2b) + 1/2`);
  });

  it('should evaluate Wallis-like product 1 - 1/k^2', () => {
    // (1-1/4)*(1-1/9)*(1-1/16) = (3/4)*(8/9)*(15/16) = 5/8 = 0.625
    expect(
      ce.parse('\\prod_{k=2}^{4}(1 - \\frac{1}{k^2})').evaluate().toString()
    ).toMatchInlineSnapshot(`5/8`);
  });
});

describe('GCD/LCM', () => {
  it('should compute the GCD of two integers', () => {
    expect(ce.expr(['GCD', 60, 12]).evaluate().toString()).toMatchInlineSnapshot(
      `12`
    );

    expect(ce.expr(['GCD', 10, 15]).evaluate().toString()).toMatchInlineSnapshot(
      `5`
    );
  });

  it('should compute the LCM of two integers', () => {
    expect(ce.expr(['LCM', 60, 12]).evaluate().toString()).toMatchInlineSnapshot(
      `60`
    );
    expect(ce.expr(['LCM', 10, 15]).evaluate().toString()).toMatchInlineSnapshot(
      `30`
    );
  });

  // Regression for G9: LCM is non-negative regardless of operand signs (it was
  // carrying the sign, e.g. LCM(-2, 3) → -6).
  it('LCM is non-negative for negative operands (REVIEW.md G9)', () => {
    expect(ce.expr(['LCM', -2, 3]).evaluate().toString()).toBe('6');
    expect(ce.expr(['LCM', 2, -3]).evaluate().toString()).toBe('6');
    expect(ce.expr(['LCM', -2, -3]).evaluate().toString()).toBe('6');
    expect(ce.expr(['LCM', -2, 3, 4]).evaluate().toString()).toBe('12');
    // Single negative operand: |n|.
    expect(ce.expr(['LCM', -7]).evaluate().toString()).toBe('7');
    expect(ce.expr(['GCD', -8]).evaluate().toString()).toBe('8');
  });

  it('should compute the GCD of some integers and other stuff', () =>
    expect(
      ce.expr(['GCD', 60, 'foo', 12]).evaluate().toString()
    ).toMatchInlineSnapshot(`gcd(12, "foo")`));

  it('should compute the GCD of only stuff', () =>
    expect(
      ce.expr(['GCD', 'foo', 'bar']).evaluate().toString()
    ).toMatchInlineSnapshot(`gcd("foo", "bar")`));

  it('should compute the GCD of a single number', () =>
    expect(ce.expr(['GCD', 42]).evaluate().toString()).toMatchInlineSnapshot(
      `42`
    ));

  // A non-integer (inexact) argument numericizes the whole GCD via the
  // tolerant floating Euclidean algorithm (exactness contract): 12 and 3.1415
  // are near-incommensurate, so their tolerant GCD is a small real.
  it('numericizes the GCD when an argument is a non-integer real', () =>
    expect(ce.expr(['GCD', 60, 12, 3.1415]).evaluate().re).toBeCloseTo(
      0.0005,
      6
    ));

  // A list argument is reduced over its elements; the non-integer 3.1415
  // numericizes the fold via the tolerant float GCD.
  it('reduces the GCD of a list over its elements', () =>
    expect(
      ce.expr(['GCD', ['List', 60, 12, 3.1415]]).evaluate().re
    ).toBeCloseTo(0.0005, 6));

  it('should compute the LCM of some integers and other stuff', () =>
    expect(
      ce.expr(['LCM', 60, 'foo', 12]).evaluate().toString()
    ).toMatchInlineSnapshot(`lcm(60, "foo")`));

  it('should compute the LCM of only stuff', () =>
    expect(
      ce.expr(['LCM', 'foo', 'bar']).evaluate().toString()
    ).toMatchInlineSnapshot(`lcm("foo", "bar")`));

  it('should compute the LCM of a single number', () =>
    expect(ce.expr(['LCM', 42]).evaluate().toString()).toMatchInlineSnapshot(
      `42`
    ));

  it('numericizes the LCM when an argument is a non-integer real', () =>
    expect(ce.expr(['LCM', 60, 12, 3.1415]).evaluate().re).toBeCloseTo(
      376980.0012,
      3
    ));

  it('reduces the LCM of a list over its elements', () =>
    expect(
      ce.expr(['LCM', ['List', 60, 12, 3.1415]]).evaluate().re
    ).toBeCloseTo(376980.0012, 3));

  // ROADMAP B5: the variadic GCD operator computes a univariate polynomial GCD
  // when the operands share a non-trivial common factor (the variable is
  // inferred). Mirrors the explicit `PolynomialGCD(p, q, x)` operator.
  describe('polynomial GCD (ROADMAP B5)', () => {
    const poly = (s: string) => ce.parse(s).canonical;
    const gcd = (...ops: ReturnType<typeof ce.parse>[]) =>
      ce.expr(['GCD', ...ops]).evaluate().toString();

    it('gcd((x+1)(x+2), (x+1)(x+3)) → x + 1', () =>
      expect(gcd(poly('(x+1)(x+2)'), poly('(x+1)(x+3)'))).toBe('x + 1'));

    it('gcd(x² − 1, x² + 2x + 1) → x + 1', () =>
      expect(gcd(poly('x^2-1'), poly('x^2+2x+1'))).toBe('x + 1'));

    it('gcd(x³ − 1, x² − 1) → x − 1', () =>
      expect(gcd(poly('x^3-1'), poly('x^2-1'))).toBe('x - 1'));

    it('gcd(x² + 3x + 2, x² + 4x + 3) → x + 1', () =>
      expect(gcd(poly('x^2+3x+2'), poly('x^2+4x+3'))).toBe('x + 1'));

    it('reduces a variadic polynomial GCD', () =>
      // gcd(x²−1, x³−1) = x−1, which divides x²+x (x(x+1)? no): use a common
      // factor that survives. (x−1) divides all three below.
      expect(
        gcd(poly('x^2-1'), poly('x^3-1'), poly('x^2-3x+2'))
      ).toBe('x - 1'));

    it('parses and evaluates \\gcd over polynomials', () =>
      expect(ce.parse('\\gcd(x^2-1, x-1)').evaluate().toString()).toBe(
        'x - 1'
      ));

    // A trivial (constant) polynomial GCD is deferred, preserving the
    // integer-GCD interpretation of a bare symbol (it may stand for an
    // unknown integer). Use PolynomialGCD(p, q, x) for the coprime → 1 answer.
    it('defers a trivial GCD: gcd(x, 6) stays unevaluated', () =>
      expect(gcd(poly('x'), ce.expr(6))).toBe('gcd(6, x)'));

    // ROADMAP B11 "Stage B": the variadic GCD operator computes a *multivariate*
    // polynomial GCD via Brown's dense modular algorithm, verified by exact
    // division. gcd(xy, x) = x (true under both the polynomial and the
    // integer-symbol reading, where gcd(xy, x) = |x|).
    it('computes a bivariate GCD: gcd(xy, x) → x', () =>
      expect(gcd(poly('x y'), poly('x'))).toBe('x'));

    it('gcd(x² − y², x² + 3xy + 2y²) → x + y', () =>
      expect(gcd(poly('x^2-y^2'), poly('x^2+3x y+2y^2'))).toBe('x + y'));

    it('gcd(x³ − y³, x² − y²) → x − y', () =>
      expect(gcd(poly('x^3-y^3'), poly('x^2-y^2'))).toBe('x - y'));

    // A repeated factor (Brown handles where a carried-coefficient Euclid bailed).
    it('gcd((x+y+1)², (x+y+1)(x−y+2)) → x + y + 1', () =>
      expect(gcd(poly('(x+y+1)^2'), poly('(x+y+1)(x-y+2)'))).toBe('x + y + 1'));

    // Non-monic leading coefficient (integer content of the lc is restored).
    it('gcd((2x+3y)(x+y), (2x+3y)(x−y)) → 2x + 3y', () =>
      expect(gcd(poly('(2x+3y)(x+y)'), poly('(2x+3y)(x-y)'))).toBe('2x + 3y'));

    // Three and four variables (the gap Stage B closes). NB: in this file `z`
    // is assigned i and `b` is an integer, so use other free variables (u,v,w).
    it('gcd((u+v+w)(u−w), (u+v+w)(v+2w)) → u + v + w', () =>
      expect(gcd(poly('(u+v+w)(u-w)'), poly('(u+v+w)(v+2w)'))).toBe(
        'u + v + w'
      ));

    it('gcd((uv+w)(u+v+w), (uv+w)(u−w)) → uv + w', () =>
      expect(gcd(poly('(u v+w)(u+v+w)'), poly('(u v+w)(u-w)'))).toBe(
        'u * v + w'
      ));

    it('gcd((t+u+v+w)(t−u), (t+u+v+w)(v−w)) → t + u + v + w', () =>
      expect(gcd(poly('(t+u+v+w)(t-u)'), poly('(t+u+v+w)(v-w)'))).toBe(
        't + u + v + w'
      ));

    // Coprime multivariate operands: trivial (constant) GCD is deferred,
    // matching the univariate convention.
    it('defers a coprime multivariate GCD', () => {
      const r = gcd(poly('x+y'), poly('x+2y'));
      expect(r.startsWith('gcd(')).toBe(true);
    });

    // Large inputs (the 7-variable Fateman products) exceed the cheap
    // complexity cap and defer instantly rather than churn — verified-or-defer,
    // never wrong (Fateman-scale needs sparse interpolation; see ROADMAP B11).
    it('defers a large multivariate GCD instead of churning', () => {
      const lin = (c: number[]) =>
        ce.expr([
          'Add',
          1,
          ...c.map((k, i) => ce.expr(['Multiply', k, `x${i + 1}`])),
        ]);
      const pow2 = (b: ReturnType<typeof ce.expr>) =>
        ce.expr(['Expand', ce.expr(['Power', b, 2])]).evaluate();
      const g = pow2(lin([2, 4, 6, 8, 10, 12, 14]));
      const a = ce
        .expr(['Expand', ce.expr(['Multiply', pow2(lin([3, 5, 7, 9, 11, 13, 15])), g])])
        .evaluate();
      const b = ce
        .expr(['Expand', ce.expr(['Multiply', pow2(lin([15, 13, 11, 9, 7, 5, 3])), g])])
        .evaluate();
      const r = ce.expr(['GCD', a, b]).evaluate().toString();
      expect(r.startsWith('gcd(')).toBe(true);
    });
  });
});

describe('GCD/LCM machine-precision path (REVIEW.md B2)', () => {
  // The machine-number path of evaluateGcdLcm never seeded the accumulator
  // (the first integer operand was pushed to `rest` instead of starting
  // `result`), so GCD/LCM stayed unevaluated under machine precision. A
  // leading non-integer was also silently dropped.
  //
  // `precision = 'machine'` mutates the GLOBAL BigDecimal.precision static,
  // so we snapshot and restore it to avoid polluting other suites.
  let savedPrecision: number;
  let ceMachine: ComputeEngine;

  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
    ceMachine = new ComputeEngine();
    ceMachine.precision = 'machine';
  });

  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  it('computes GCD of two integers', () =>
    expect(ceMachine.expr(['GCD', 4, 6]).evaluate().toString()).toEqual('2'));

  it('computes LCM of two integers', () =>
    expect(ceMachine.expr(['LCM', 4, 6]).evaluate().toString()).toEqual('12'));

  // A non-integer (inexact) real argument numericizes the whole GCD via the
  // tolerant floating Euclidean algorithm (exactness contract). A leading
  // non-integer real that is exactly commensurate stays exact: GCD(3.5,4,6)=0.5.
  it('numericizes when an argument is a non-integer real', () => {
    expect(ceMachine.expr(['GCD', 60, 12, 3.1415]).evaluate().re).toBeCloseTo(
      0.0005,
      6
    );
    expect(ceMachine.expr(['GCD', 3.5, 4, 6]).evaluate().toString()).toEqual(
      '0.5'
    );
  });

  // Integers still fold and a symbolic operand still defers: the accumulator is
  // seeded after a leading non-foldable (symbolic) operand.
  it('seeds the accumulator after a leading symbolic operand', () =>
    expect(ceMachine.expr(['GCD', 'x', 4, 6]).evaluate().toString()).toEqual(
      'gcd(2, x)'
    ));

  it('returns a single integer unchanged', () =>
    expect(ceMachine.expr(['GCD', 42]).evaluate().toString()).toEqual('42'));
});

describe('FACTOR', () => {
  it('should factor a relational operator with fractional roots', () =>
    expect(
      ce
        .expr(['Factor', ce.parse('\\sqrt{7}\\sqrt{35}x^2 \\lt \\sqrt{5}x')])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`7x^2 < x`));

  it('should factor integers', () =>
    expect(
      ce
        .expr(['Factor', ce.parse('2a \\lt 4b')])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`a < 2b`));

  it('should factor additions', () =>
    expect(
      ce
        .expr(['Factor', ce.parse('\\sqrt{3}x+2\\sqrt{3}x')])
        .evaluate()
        .toString()
    ).toMatchInlineSnapshot(`3sqrt(3) * x`));
});

// Tests for special functions type signatures (Issue #1 from TODO.md)
// These functions now have proper type signatures, allowing them to be used
// in expressions without type errors.
describe('SPECIAL FUNCTIONS TYPE SIGNATURES', () => {
  // Single-argument special functions
  test('Zeta function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['Zeta', 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`Zeta(x) + 1`);
  });

  test('LambertW function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['LambertW', 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`LambertW(x) + 1`);
  });

  test('AiryAi function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['AiryAi', 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`AiryAi(x) + 1`);
  });

  test('AiryBi function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['AiryBi', 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`AiryBi(x) + 1`);
  });

  // Two-argument special functions
  test('Beta function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['Beta', 'a', 'b']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`Beta(a, b) + 1`);
  });

  // Bessel functions (order, value)
  test('BesselJ function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['BesselJ', 0, 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`BesselJ(0, x) + 1`);
  });

  test('BesselY function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['BesselY', 1, 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`BesselY(1, x) + 1`);
  });

  test('BesselI function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['BesselI', 2, 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`BesselI(2, x) + 1`);
  });

  test('BesselK function can be used in expressions', () => {
    const expr = ce.expr(['Add', 1, ['BesselK', 0, 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`BesselK(0, x) + 1`);
  });

  // Test that these functions work with symbolic order for Bessel
  test('BesselJ with symbolic order', () => {
    const expr = ce.expr(['BesselJ', 'n', 'x']);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`BesselJ(n, x)`);
  });

  // Test composition with other functions
  test('Special functions can be composed', () => {
    const expr = ce.expr(['Multiply', ['Zeta', 2], ['LambertW', 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`LambertW(x) * Zeta(2)`);
  });

  // Test that existing special functions still work
  test('Digamma function still works', () => {
    const expr = ce.expr(['Add', 1, ['Digamma', 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`Digamma(x) + 1`);
  });

  test('Trigamma function still works', () => {
    const expr = ce.expr(['Add', 1, ['Trigamma', 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`Trigamma(x) + 1`);
  });

  test('PolyGamma function still works', () => {
    const expr = ce.expr(['Add', 1, ['PolyGamma', 2, 'x']]);
    expect(expr.isValid).toBe(true);
    expect(expr.toString()).toMatchInlineSnapshot(`PolyGamma(2, x) + 1`);
  });
});

describe('Factorial simplification', () => {
  // Factorial division: concrete integers
  it('10!/7! should simplify to 720', () => {
    expect(
      ce
        .expr(['Divide', ['Factorial', 10], ['Factorial', 7]])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`720`);
  });

  it('5!/10! should simplify to 1/30240', () => {
    expect(
      ce
        .expr(['Divide', ['Factorial', 5], ['Factorial', 10]])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`1/30240`);
  });

  it('7!/7! should simplify to 1', () => {
    expect(
      ce
        .expr(['Divide', ['Factorial', 7], ['Factorial', 7]])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`1`);
  });

  // Factorial division: symbolic
  it('(b+1)!/b! should simplify to b + 1', () => {
    expect(
      ce
        .expr(['Divide', ['Factorial', ['Add', 'b', 1]], ['Factorial', 'b']])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`b + 1`);
  });

  it('b!/(b-1)! should simplify to b', () => {
    expect(
      ce
        .expr(['Divide', ['Factorial', 'b'], ['Factorial', ['Add', 'b', -1]]])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`b`);
  });

  // Binomial detection from factorial division
  it('10!/(3!*7!) should simplify to 120', () => {
    expect(
      ce
        .expr([
          'Divide',
          ['Factorial', 10],
          ['Multiply', ['Factorial', 3], ['Factorial', 7]],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`120`);
  });

  // Factorial sums/differences: symbolic factoring
  it('(b+1)! - b! should simplify to b * b!', () => {
    expect(
      ce
        .expr(['Subtract', ['Factorial', ['Add', 'b', 1]], ['Factorial', 'b']])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`b * b!`);
  });

  it('(b+1)! + b! should simplify to (b + 2) * b!', () => {
    expect(
      ce
        .expr(['Add', ['Factorial', ['Add', 'b', 1]], ['Factorial', 'b']])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`(b + 2) * b!`);
  });

  it('b! - (b-1)! should simplify to (b - 1) * (b - 1)!', () => {
    expect(
      ce
        .expr(['Subtract', ['Factorial', 'b'], ['Factorial', ['Add', 'b', -1]]])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`(b - 1) * (b - 1)!`);
  });

  it('2*b! + (b+1)! should simplify to (b + 3) * b!', () => {
    expect(
      ce
        .expr([
          'Add',
          ['Multiply', 2, ['Factorial', 'b']],
          ['Factorial', ['Add', 'b', 1]],
        ])
        .simplify()
        .toString()
    ).toMatchInlineSnapshot(`(b + 3) * b!`);
  });
});

describe('Binomial/Choose simplification', () => {
  it('Binomial(b, 0) should simplify to 1', () => {
    expect(
      ce.expr(['Binomial', 'b', 0]).simplify().toString()
    ).toMatchInlineSnapshot(`1`);
  });

  it('Binomial(b, 1) should simplify to b', () => {
    expect(
      ce.expr(['Binomial', 'b', 1]).simplify().toString()
    ).toMatchInlineSnapshot(`b`);
  });

  it('Binomial(b, b) should simplify to 1', () => {
    expect(
      ce.expr(['Binomial', 'b', 'b']).simplify().toString()
    ).toMatchInlineSnapshot(`1`);
  });

  it('Binomial(5, 2) should evaluate to 10', () => {
    expect(
      ce.expr(['Binomial', 5, 2]).evaluate().toString()
    ).toMatchInlineSnapshot(`10`);
  });
});

// Regression for WP-2.15 / CORRECTNESS_FINDINGS P0-10 (EX-06): `Choose` threw
// or returned NaN for cases `Binomial` handled correctly (k > n, negative n),
// and non-integer exact args (rationals, π) crashed `Choose` outright. Fix
// unifies both operators on a single evaluate implementation.
describe('Binomial/Choose value table (WP-2.15 / EX-06)', () => {
  for (const op of ['Binomial', 'Choose']) {
    describe(op, () => {
      it(`${op}(5, 2) = 10`, () => {
        expect(ce.expr([op, 5, 2]).evaluate().toString()).toBe('10');
        expect(ce.expr([op, 5, 2]).N().toString()).toBe('10');
      });

      it(`${op}(2, 3) = 0  (k > n)`, () => {
        expect(ce.expr([op, 2, 3]).evaluate().toString()).toBe('0');
        expect(ce.expr([op, 2, 3]).N().toString()).toBe('0');
      });

      it(`${op}(0, 0) = 1`, () => {
        expect(ce.expr([op, 0, 0]).evaluate().toString()).toBe('1');
        expect(ce.expr([op, 0, 0]).N().toString()).toBe('1');
      });

      it(`${op}(-2, 3) = -4  (standard extension to negative n)`, () => {
        expect(ce.expr([op, -2, 3]).evaluate().toString()).toBe('-4');
        expect(ce.expr([op, -2, 3]).N().toString()).toBe('-4');
      });

      it(`${op}(5, -1) = 0  (k < 0)`, () => {
        expect(ce.expr([op, 5, -1]).evaluate().toString()).toBe('0');
        expect(ce.expr([op, 5, -1]).N().toString()).toBe('0');
      });

      it(`${op}(1/2, 2) stays symbolic under evaluate(), ≈ -0.125 under .N()`, () => {
        const expr = ce.expr([op, ['Rational', 1, 2], 2]);
        expect(expr.evaluate().operator).toBe(op);
        expect(expr.N().re).toBeCloseTo(-0.125, 10);
      });

      it(`${op}(Pi, 2) never throws`, () => {
        const expr = ce.expr([op, 'Pi', 2]);
        expect(() => expr.evaluate()).not.toThrow();
        expect(() => expr.N()).not.toThrow();
      });
    });
  }
});

// REVIEW.md A6–A12: boxed-expression core arithmetic correctness fixes.
describe('Core arithmetic correctness (REVIEW.md A6–A12)', () => {
  // A6: an even root of a negative real returned the real root of |a| (a wrong
  // real) instead of the complex principal root.
  it('A6: Root(-16, 4) is the complex principal root, not 2', () => {
    const r = ce.expr(['Root', -16, 4]).N();
    expect(r.re).toBeCloseTo(Math.SQRT2, 10); // √2
    expect(r.im).toBeCloseTo(Math.SQRT2, 10);
    // Consistent with Sqrt of a negative.
    expect(ce.expr(['Sqrt', -4]).N().im).toBeCloseTo(2, 10);
  });

  // A7: ln with a non-integer base silently dropped the base (→ natural log).
  it('A7: log with a non-integer base is honored', () => {
    expect((ce.number(8).ln(2.5) as any).re).toBeCloseTo(
      Math.log(8) / Math.log(2.5),
      10
    );
  });

  // A8: a plain symbol must not report as an empty finite collection.
  it('A8: a plain symbol has undefined collection properties', () => {
    const fresh = new ComputeEngine();
    const x = fresh.symbol('someUndeclaredSymbol');
    expect(x.count).toBeUndefined();
    expect(x.isEmptyCollection).toBeUndefined();
    expect(x.isFiniteCollection).toBeUndefined();
  });

  // A9: function-difference comparison used an exact === 0 (no tolerance).
  it('A9: function comparison uses tolerance', () => {
    // (0.1 + 0.2 + x) − (0.3 + x) = 5.55e-17 (within tolerance) → equal.
    const a = ce.expr(['Add', 0.1, 0.2, 'x']);
    const b = ce.expr(['Add', 0.3, 'x']);
    expect(a.isEqual(b)).toBe(true);
  });

  // A11: a/0 was inconsistent — ComplexInfinity for a JS-number denominator,
  // NaN for a boxed zero.
  it('A11: division by zero is ComplexInfinity for both denominator forms', () => {
    expect(ce.number(5).div(0).toString()).toBe(ce.number(5).div(ce.Zero).toString());
    expect(ce.number(5).div(ce.Zero).toString()).toBe('~oo');
  });

  // A12: negate of a product still produces the correct value.
  it('A12: negate of a product is correct', () => {
    expect(ce.expr(['Negate', ['Multiply', 3, 'x', 'y']]).N().toString()).toBe(
      ce.expr(['Multiply', -3, 'x', 'y']).N().toString()
    );
  });
});

// Paired-radical branch soundness: √(k·u) must NOT split off a constant
// √k when k < 0 (the sign is a region-dependent phase, not a constant).
// Surfaced by Rubi 1.1.1.4 #39, where √(−5+2x)/√(5−2x) was collapsed to a
// constant +i (correct value flips to −i across x = 5/2), baking an
// untraced machine-float phase into elliptic antiderivatives.
describe('Paired-radical branch soundness (Rubi 1.1.1.4 #39)', () => {
  it('√(−c·u)/√(u) keeps the region-dependent sign (not a constant phase)', () => {
    // u = 2x − 5 changes sign at x = 5/2; the ratio √(−2/11·u)/√(u) is
    // −0.4264i for u < 0 and +0.4264i for u > 0 — it must NOT fold to a
    // constant.
    const u = ['Subtract', ['Multiply', 2, 'x'], 5];
    const a = ce.expr(['Sqrt', ['Multiply', ['Rational', -2, 11], u]]);
    const b = ce.expr(['Sqrt', u]);
    const q = a.div(b);
    // The two regions must produce opposite-sign imaginary parts.
    const below = q.subs({ x: 1 }).N(); // u = −3 < 0
    const above = q.subs({ x: 3 }).N(); // u = +1 > 0
    expect(below.im).toBeCloseTo(-0.4264014327, 6);
    expect(above.im).toBeCloseTo(0.4264014327, 6);
    expect(below.im).toBeCloseTo(-above.im, 6);
  });

  it('√(positive·u)/√(u) DOES fold to a constant', () => {
    // The positive-coefficient case is sound to collapse.
    const u = ['Subtract', ['Multiply', 2, 'x'], 5];
    const a = ce.expr(['Sqrt', ['Multiply', ['Rational', 2, 11], u]]);
    const b = ce.expr(['Sqrt', u]);
    expect(a.div(b).toString()).toBe('sqrt(22)/11');
  });

  it('√(k·u) with k < 0 evaluates to the correct branch in each region', () => {
    // √(−4·x) is +2i√x for x > 0 and 2√|x| for x < 0.
    const e = ce.expr(['Sqrt', ['Multiply', -4, 'x']]);
    expect(e.subs({ x: 1 }).N().im).toBeCloseTo(2, 10); // 2i
    expect(e.subs({ x: -1 }).N().re).toBeCloseTo(2, 10); // 2
    // and squaring recovers the radicand
    expect(ce.expr(['Power', ['Sqrt', ['Multiply', -4, 'x']], 2]).N).toBeDefined();
  });

  it('a rational followed by √(negative) does not crash canonicalization', () => {
    // 11·√(−3): the radical promotion path must not assert on a negative
    // radicand (it would have asserted radical ≥ 1).
    expect(ce.expr(['Multiply', 11, ['Sqrt', -3]]).N().im).toBeCloseTo(
      11 * Math.sqrt(3),
      8
    );
  });
});

// REVIEW.md B16: Factorial rounded positive non-integer reals to an integer
// factorial instead of using Γ(x+1).
describe('Factorial of non-integer reals (REVIEW.md B16)', () => {
  it('uses Γ(x+1) for a positive non-integer (not rounding to 2)', () => {
    expect(ce.expr(['Factorial', 2.5]).N().re).toBeCloseTo(3.323350970447843, 6);
  });
  it('integer factorials are unchanged', () => {
    expect(ce.expr(['Factorial', 5]).evaluate().json).toBe(120);
  });
});

// REVIEW.md A13: a symbol whose *value* is infinite, times 0, is NaN (not 0) —
// the `BoxedSymbol.mul(0)` fastpath short-circuited to Zero.
describe('Infinite-symbol times zero (REVIEW.md A13)', () => {
  it('∞·0 = NaN for a symbol with an infinite value', () => {
    const e = new ComputeEngine();
    e.assign('bigval', e.PositiveInfinity);
    expect(e.expr('bigval').mul(0).toString()).toBe('NaN');
  });
  it('a free symbol keeps the conventional ·0 → 0', () => {
    const e = new ComputeEngine();
    expect(e.expr('freeSym').mul(0).toString()).toBe('0');
  });
});

// REVIEW.md D20: InterquartileRange used a different quartile slice than
// Quartiles (`slice(mid+1)` vs `slice(mid)`), so IQR ≠ Q3 − Q1.
//
// CORRECTNESS_FINDINGS.md CR-P1-2: `Quartiles` itself mixed an
// exclusive-of-median lower half with an inclusive-of-median upper half,
// matching no standard convention. Fixed to the Moore–McCabe convention
// (median excluded from both halves for odd n), which keeps Q1/Q3
// symmetric around the median: Quartiles([1..9]) = (2.5, 5, 7.5).
describe('InterquartileRange consistent with Quartiles (REVIEW.md D20, CR-P1-2)', () => {
  it('IQR equals Q3 − Q1', () => {
    const data = ['List', 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const iqr = ce.expr(['InterquartileRange', data]).evaluate().re;
    // Quartiles of [1..9] are (2.5, 5, 7.5) → Q3 − Q1 = 5
    expect(iqr).toBeCloseTo(5, 10);
  });

  it('Quartiles([1..9]) = (2.5, 5, 7.5) (odd n, Moore–McCabe)', () => {
    const data = ['List', 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const [q1, q2, q3] = ce
      .expr(['Quartiles', data])
      .evaluate()
      .ops!.map((x) => x.re);
    expect(q1).toBeCloseTo(2.5, 10);
    expect(q2).toBeCloseTo(5, 10);
    expect(q3).toBeCloseTo(7.5, 10);
  });

  it('Quartiles([1..8]) = (2.5, 4.5, 6.5) (even n)', () => {
    const data = ['List', 1, 2, 3, 4, 5, 6, 7, 8];
    const [q1, q2, q3] = ce
      .expr(['Quartiles', data])
      .evaluate()
      .ops!.map((x) => x.re);
    expect(q1).toBeCloseTo(2.5, 10);
    expect(q2).toBeCloseTo(4.5, 10);
    expect(q3).toBeCloseTo(6.5, 10);
  });

  it('exact Quartiles path agrees with the numeric path on exact input', () => {
    const data = ['List', 1, 2, 3, 4, 5, 6, 7, 8, 9];
    const exact = ce
      .expr(['Quartiles', data])
      .evaluate()
      .ops!.map((x) => x.N().re);
    const numeric = ce
      .expr(['Quartiles', data])
      .evaluate({ numericApproximation: true })
      .ops!.map((x) => x.re);
    expect(exact).toEqual(numeric);
  });
});

// A transcendental function of an EXACT argument is itself an exact constant
// (like √2), so `evaluate()` keeps it symbolic and only `.N()` numericizes.
// An INEXACT (float) argument has no exactness to preserve, so it numericizes.
describe('Transcendentals stay symbolic under evaluate (ROADMAP B3)', () => {
  const ev = (s: string) => ce.parse(s).evaluate().toString();

  it('ln/sin/cos/tan of an exact argument stay symbolic', () => {
    expect(ev('\\ln 2')).toBe('ln(2)');
    expect(ev('\\sin 2')).toBe('sin(2)');
    expect(ev('\\cos(5/7)')).toBe('cos(5/7)');
    expect(ev('\\arctan 2')).toBe('arctan(2)');
    expect(ev('\\log_2 3')).toBe('log(3, 2)');
  });

  it('.N() still numericizes', () => {
    expect(ce.parse('\\ln 2').N().re).toBeCloseTo(Math.log(2), 12);
    expect(ce.parse('\\sin 2').N().re).toBeCloseTo(Math.sin(2), 12);
  });

  it('an inexact (float) argument numericizes', () => {
    expect(ce.parse('\\cos(5.1)').evaluate().re).toBeCloseTo(Math.cos(5.1), 12);
    expect(ce.parse('\\ln(1.1)').evaluate().re).toBeCloseTo(Math.log(1.1), 12);
    // Inexact BASE also numericizes (REVIEW.md A7).
    expect((ce.number(8).ln(2.5) as { re: number }).re).toBeCloseTo(
      Math.log(8) / Math.log(2.5),
      12
    );
  });

  it('exact closed forms still reduce', () => {
    expect(ev('\\ln 1')).toBe('0');
    expect(ev('\\ln(e)')).toBe('1');
    expect(ev('\\log_2 8')).toBe('3');
    expect(ev('\\log 100')).toBe('2');
    expect(ev('\\log_2 1')).toBe('0');
    expect(ev('e^{\\ln 2}')).toBe('2');
    expect(ev('\\cos(\\pi)')).toBe('-1');
  });

  it('inverse-trig special values reduce (the dispatch was dead code)', () => {
    expect(ev('\\arcsin 0')).toBe('0');
    expect(ev('\\arccos 1')).toBe('0');
    expect(ev('\\arctan 0')).toBe('0');
    expect(ev('\\arctan 1')).toBe('1/4 * pi');
    expect(ev('\\arcsin(1/2)')).toBe('1/6 * pi');
    // A non-special argument must NOT snap to a wrong value.
    expect(ev('\\arcsin(1/3)')).toBe('arcsin(1/3)');
  });
});

describe('nPr / nCr (Desmos combinatorics notation)', () => {
  const n = (s: string) => ce.parse(s).N().valueOf();
  it('nCr is the binomial coefficient', () => {
    expect(n('\\operatorname{nCr}(5,2)')).toBe(10);
  });
  it('nPr counts r-permutations of n = n!/(n−r)!', () => {
    expect(ce.parse('\\operatorname{nPr}(5,2)').json).toEqual([
      'Multiply',
      ['Choose', 5, 2],
      ['Factorial', 2],
    ]);
    expect(n('\\operatorname{nPr}(5,2)')).toBe(20);
    expect(n('\\operatorname{nPr}(10,3)')).toBe(720);
    expect(n('\\operatorname{nPr}(5,0)')).toBe(1);
    expect(n('\\operatorname{nPr}(5,5)')).toBe(120);
  });
});

describe('Round with an optional precision argument (Desmos/spreadsheet)', () => {
  const n = (s: string) => ce.parse(s).N().valueOf();
  it('rounds to the nearest integer without the precision arg', () => {
    expect(n('\\operatorname{round}(2.567)')).toBe(3);
    expect(n('\\operatorname{round}(-2.5)')).toBe(-3); // half away from zero
  });
  it('rounds to n decimal places with the precision arg', () => {
    expect(n('\\operatorname{round}(2.567, 2)')).toBe(2.57);
    expect(n('\\operatorname{round}(-2.567, 2)')).toBe(-2.57);
    expect(n('\\operatorname{round}(3.14159, 4)')).toBe(3.1416);
    expect(n('\\operatorname{round}(1234.5, -2)')).toBe(1200);
  });
  it('does not manufacture an Error operand for the 2-arg form', () => {
    expect(ce.parse('\\operatorname{round}(2.567, 2)').isValid).toBe(true);
  });
});
