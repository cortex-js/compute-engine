import { BigDecimal } from '../../src/big-decimal';

// Helper to check internal representation
function rep(d: BigDecimal): { sig: bigint; exp: number } {
  return { sig: d.significand, exp: d.exponent };
}

// ================================================================
// Construction from strings
// ================================================================

describe('Construction from string', () => {
  test('integer string', () => {
    const d = new BigDecimal('123');
    expect(d.significand).toBe(123n);
    expect(d.exponent).toBe(0);
  });

  test('negative integer string', () => {
    const d = new BigDecimal('-42');
    expect(d.significand).toBe(-42n);
    expect(d.exponent).toBe(0);
  });

  test('zero string', () => {
    const d = new BigDecimal('0');
    expect(rep(d)).toEqual({ sig: 0n, exp: 0 });
  });

  test('decimal string', () => {
    const d = new BigDecimal('123.456');
    // 123456 * 10^-3
    expect(d.significand).toBe(123456n);
    expect(d.exponent).toBe(-3);
  });

  test('negative decimal string', () => {
    const d = new BigDecimal('-42.5');
    expect(d.significand).toBe(-425n);
    expect(d.exponent).toBe(-1);
  });

  test('leading zeros', () => {
    const d = new BigDecimal('00123');
    expect(d.significand).toBe(123n);
    expect(d.exponent).toBe(0);
  });

  test('trailing zeros are stripped', () => {
    const d = new BigDecimal('12.300');
    // After normalization: 123 * 10^-1
    expect(d.significand).toBe(123n);
    expect(d.exponent).toBe(-1);
  });

  test('leading decimal point', () => {
    const d = new BigDecimal('.5');
    expect(d.significand).toBe(5n);
    expect(d.exponent).toBe(-1);
  });

  test('leading zeros in fractional part', () => {
    const d = new BigDecimal('-0.001');
    expect(d.significand).toBe(-1n);
    expect(d.exponent).toBe(-3);
  });

  test('integer with trailing zeros', () => {
    const d = new BigDecimal('12000');
    // 12 * 10^3
    expect(d.significand).toBe(12n);
    expect(d.exponent).toBe(3);
  });

  test('explicit positive sign', () => {
    const d = new BigDecimal('+7.5');
    expect(d.significand).toBe(75n);
    expect(d.exponent).toBe(-1);
  });

  test('whitespace is trimmed', () => {
    const d = new BigDecimal('  42  ');
    expect(d.significand).toBe(42n);
    expect(d.exponent).toBe(0);
  });
});

// ================================================================
// Construction from string — scientific notation
// ================================================================

describe('Construction from string (scientific notation)', () => {
  test('positive exponent', () => {
    const d = new BigDecimal('1.5e10');
    // 15 * 10^9
    expect(d.significand).toBe(15n);
    expect(d.exponent).toBe(9);
  });

  test('negative exponent', () => {
    const d = new BigDecimal('1.5E-3');
    // 15 * 10^-4
    expect(d.significand).toBe(15n);
    expect(d.exponent).toBe(-4);
  });

  test('explicit positive exponent sign', () => {
    const d = new BigDecimal('-2.5e+4');
    // -25 * 10^3
    expect(d.significand).toBe(-25n);
    expect(d.exponent).toBe(3);
  });

  test('integer mantissa with exponent', () => {
    const d = new BigDecimal('5e3');
    // 5 * 10^3
    expect(d.significand).toBe(5n);
    expect(d.exponent).toBe(3);
  });

  test('zero exponent', () => {
    const d = new BigDecimal('2.5e0');
    expect(d.significand).toBe(25n);
    expect(d.exponent).toBe(-1);
  });

  test('large exponent', () => {
    const d = new BigDecimal('1e100');
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(100);
  });

  test('very negative exponent', () => {
    const d = new BigDecimal('3e-50');
    expect(d.significand).toBe(3n);
    expect(d.exponent).toBe(-50);
  });
});

// ================================================================
// Construction from number
// ================================================================

describe('Construction from number', () => {
  test('integer number', () => {
    const d = new BigDecimal(42);
    expect(d.significand).toBe(42n);
    expect(d.exponent).toBe(0);
  });

  test('negative integer number', () => {
    const d = new BigDecimal(-7);
    expect(d.significand).toBe(-7n);
    expect(d.exponent).toBe(0);
  });

  test('zero number', () => {
    const d = new BigDecimal(0);
    expect(rep(d)).toEqual({ sig: 0n, exp: 0 });
  });

  test('float number', () => {
    const d = new BigDecimal(3.14);
    // 3.14 => 314 * 10^-2  (toString gives "3.14")
    expect(d.significand).toBe(314n);
    expect(d.exponent).toBe(-2);
  });

  test('float number with many decimals', () => {
    const d = new BigDecimal(0.1);
    // 0.1.toString() === "0.1", so significand=1, exponent=-1
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(-1);
  });

  test('large integer number', () => {
    const d = new BigDecimal(1000000);
    // 1 * 10^6
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(6);
  });

  test('NaN number', () => {
    const d = new BigDecimal(NaN);
    expect(d.significand).toBe(0n);
    expect(d.exponent).toBeNaN();
  });

  test('Infinity number', () => {
    const d = new BigDecimal(Infinity);
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('-Infinity number', () => {
    const d = new BigDecimal(-Infinity);
    expect(d.significand).toBe(-1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('negative zero is just zero', () => {
    const d = new BigDecimal(-0);
    // -0 is integer 0 -> normalize(0n, 0)
    expect(rep(d)).toEqual({ sig: 0n, exp: 0 });
  });

  test('number in scientific notation range', () => {
    // 1.5e10 as a JS number
    const d = new BigDecimal(1.5e10);
    // 15000000000 is an integer
    expect(d.significand).toBe(15n);
    expect(d.exponent).toBe(9);
  });

  test('small float', () => {
    const d = new BigDecimal(0.0025);
    // 0.0025.toString() === "0.0025"
    expect(d.significand).toBe(25n);
    expect(d.exponent).toBe(-4);
  });
});

// ================================================================
// Construction from bigint
// ================================================================

describe('Construction from bigint', () => {
  test('positive bigint', () => {
    const d = new BigDecimal(123n);
    expect(d.significand).toBe(123n);
    expect(d.exponent).toBe(0);
  });

  test('negative bigint', () => {
    const d = new BigDecimal(-456n);
    expect(d.significand).toBe(-456n);
    expect(d.exponent).toBe(0);
  });

  test('zero bigint', () => {
    const d = new BigDecimal(0n);
    expect(rep(d)).toEqual({ sig: 0n, exp: 0 });
  });

  test('bigint with trailing zeros', () => {
    const d = new BigDecimal(12000n);
    expect(d.significand).toBe(12n);
    expect(d.exponent).toBe(3);
  });

  test('very large bigint', () => {
    const d = new BigDecimal(123456789012345678901234567890n);
    expect(d.significand).toBe(12345678901234567890123456789n);
    expect(d.exponent).toBe(1);
  });
});

// ================================================================
// Construction from BigDecimal (copy)
// ================================================================

describe('Construction from BigDecimal (copy)', () => {
  test('copies a normal value', () => {
    const original = new BigDecimal('3.14');
    const copy = new BigDecimal(original);
    expect(copy.significand).toBe(original.significand);
    expect(copy.exponent).toBe(original.exponent);
  });

  test('copies NaN', () => {
    const original = new BigDecimal(NaN);
    const copy = new BigDecimal(original);
    expect(copy.isNaN()).toBe(true);
  });

  test('copies Infinity', () => {
    const original = new BigDecimal(Infinity);
    const copy = new BigDecimal(original);
    expect(copy.significand).toBe(1n);
    expect(copy.exponent).toBe(Infinity);
  });
});

// ================================================================
// Normalization
// ================================================================

describe('Normalization', () => {
  test('trailing zeros in significand are stripped', () => {
    const d = new BigDecimal('12.300');
    expect(d.significand).toBe(123n);
    expect(d.exponent).toBe(-1);
  });

  test('integer trailing zeros', () => {
    const d = new BigDecimal('45000');
    expect(d.significand).toBe(45n);
    expect(d.exponent).toBe(3);
  });

  test('zero normalizes to 0n, 0', () => {
    expect(rep(new BigDecimal('0'))).toEqual({ sig: 0n, exp: 0 });
    expect(rep(new BigDecimal('0.0'))).toEqual({ sig: 0n, exp: 0 });
    expect(rep(new BigDecimal('0.000'))).toEqual({ sig: 0n, exp: 0 });
    expect(rep(new BigDecimal('0e5'))).toEqual({ sig: 0n, exp: 0 });
  });

  test('single trailing zero', () => {
    const d = new BigDecimal('1.0');
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(0);
  });

  test('all zeros after decimal', () => {
    const d = new BigDecimal('100.00');
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(2);
  });
});

// ================================================================
// Special values
// ================================================================

describe('Special values', () => {
  test('NaN from string', () => {
    const d = new BigDecimal('NaN');
    expect(d.significand).toBe(0n);
    expect(d.exponent).toBeNaN();
  });

  test('NaN from number', () => {
    const d = new BigDecimal(NaN);
    expect(d.significand).toBe(0n);
    expect(d.exponent).toBeNaN();
  });

  test('+Infinity from string', () => {
    const d = new BigDecimal('Infinity');
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('+Infinity from +Infinity string', () => {
    const d = new BigDecimal('+Infinity');
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('-Infinity from string', () => {
    const d = new BigDecimal('-Infinity');
    expect(d.significand).toBe(-1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('+Infinity from number', () => {
    const d = new BigDecimal(Infinity);
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('-Infinity from number', () => {
    const d = new BigDecimal(-Infinity);
    expect(d.significand).toBe(-1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('empty string becomes NaN', () => {
    const d = new BigDecimal('');
    expect(d.isNaN()).toBe(true);
  });

  test('invalid string becomes NaN', () => {
    const d = new BigDecimal('abc');
    expect(d.isNaN()).toBe(true);
  });
});

// ================================================================
// State checks
// ================================================================

describe('State checks', () => {
  describe('isNaN()', () => {
    test('true for NaN', () => {
      expect(new BigDecimal(NaN).isNaN()).toBe(true);
      expect(new BigDecimal('NaN').isNaN()).toBe(true);
    });

    test('false for normal values', () => {
      expect(new BigDecimal(0).isNaN()).toBe(false);
      expect(new BigDecimal(42).isNaN()).toBe(false);
      expect(new BigDecimal(Infinity).isNaN()).toBe(false);
    });
  });

  describe('isZero()', () => {
    test('true for zero', () => {
      expect(new BigDecimal(0).isZero()).toBe(true);
      expect(new BigDecimal('0').isZero()).toBe(true);
      expect(new BigDecimal('0.0').isZero()).toBe(true);
      expect(new BigDecimal(0n).isZero()).toBe(true);
    });

    test('false for non-zero', () => {
      expect(new BigDecimal(1).isZero()).toBe(false);
      expect(new BigDecimal(-1).isZero()).toBe(false);
    });

    test('false for NaN (significand is 0n but isNaN)', () => {
      expect(new BigDecimal(NaN).isZero()).toBe(false);
    });
  });

  describe('isFinite()', () => {
    test('true for normal values', () => {
      expect(new BigDecimal(0).isFinite()).toBe(true);
      expect(new BigDecimal(42).isFinite()).toBe(true);
      expect(new BigDecimal(-3.14).isFinite()).toBe(true);
      expect(new BigDecimal('1e100').isFinite()).toBe(true);
    });

    test('false for NaN', () => {
      expect(new BigDecimal(NaN).isFinite()).toBe(false);
    });

    test('false for Infinity', () => {
      expect(new BigDecimal(Infinity).isFinite()).toBe(false);
      expect(new BigDecimal(-Infinity).isFinite()).toBe(false);
    });
  });

  describe('isInteger()', () => {
    test('true for integers', () => {
      expect(new BigDecimal(42).isInteger()).toBe(true);
      expect(new BigDecimal('123').isInteger()).toBe(true);
      expect(new BigDecimal(0).isInteger()).toBe(true);
      expect(new BigDecimal(-7).isInteger()).toBe(true);
      expect(new BigDecimal('1000').isInteger()).toBe(true); // exponent = 3
    });

    test('false for non-integers', () => {
      expect(new BigDecimal('3.14').isInteger()).toBe(false);
      expect(new BigDecimal('0.1').isInteger()).toBe(false);
    });

    test('false for non-finite', () => {
      expect(new BigDecimal(NaN).isInteger()).toBe(false);
      expect(new BigDecimal(Infinity).isInteger()).toBe(false);
    });
  });

  describe('isPositive()', () => {
    test('true for positive finite values', () => {
      expect(new BigDecimal(42).isPositive()).toBe(true);
      expect(new BigDecimal('0.5').isPositive()).toBe(true);
      expect(new BigDecimal('1e100').isPositive()).toBe(true);
    });

    test('false for zero', () => {
      expect(new BigDecimal(0).isPositive()).toBe(false);
    });

    test('false for negative', () => {
      expect(new BigDecimal(-1).isPositive()).toBe(false);
    });

    test('true for Infinity', () => {
      expect(new BigDecimal(Infinity).isPositive()).toBe(true);
    });

    test('false for NaN', () => {
      expect(new BigDecimal(NaN).isPositive()).toBe(false);
    });
  });

  describe('isNegative()', () => {
    test('true for negative finite values', () => {
      expect(new BigDecimal(-42).isNegative()).toBe(true);
      expect(new BigDecimal('-0.5').isNegative()).toBe(true);
      expect(new BigDecimal('-1e100').isNegative()).toBe(true);
    });

    test('false for zero', () => {
      expect(new BigDecimal(0).isNegative()).toBe(false);
    });

    test('false for positive', () => {
      expect(new BigDecimal(1).isNegative()).toBe(false);
    });

    test('true for -Infinity', () => {
      expect(new BigDecimal(-Infinity).isNegative()).toBe(true);
    });

    test('false for NaN', () => {
      expect(new BigDecimal(NaN).isNegative()).toBe(false);
    });
  });
});

// ================================================================
// Edge cases
// ================================================================

describe('Edge cases', () => {
  test('very long decimal string', () => {
    const d = new BigDecimal('1.' + '0'.repeat(100) + '1');
    // digits = "1" + "0"*100 + "1" = 10^101 + 1
    expect(d.significand).toBe(100000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000000001n);
    expect(d.exponent).toBe(-101);
  });

  test('scientific notation with decimal mantissa and trailing zeros', () => {
    const d = new BigDecimal('1.200e5');
    // 1200 * 10^(5-3) = 1200 * 10^2 -> normalize -> 12 * 10^4
    expect(d.significand).toBe(12n);
    expect(d.exponent).toBe(4);
  });

  test('negative zero bigint', () => {
    // -0n === 0n in BigInt
    const d = new BigDecimal(-0n);
    expect(rep(d)).toEqual({ sig: 0n, exp: 0 });
  });

  test('MAX_SAFE_INTEGER as number', () => {
    const d = new BigDecimal(Number.MAX_SAFE_INTEGER);
    // 9007199254740991
    expect(d.significand).toBe(9007199254740991n);
    expect(d.exponent).toBe(0);
  });

  test('MIN_SAFE_INTEGER as number', () => {
    const d = new BigDecimal(Number.MIN_SAFE_INTEGER);
    expect(d.significand).toBe(-9007199254740991n);
    expect(d.exponent).toBe(0);
  });
});

// ================================================================
// toNumber()
// ================================================================

describe('toNumber()', () => {
  test('integer values', () => {
    expect(new BigDecimal('123').toNumber()).toBe(123);
    expect(new BigDecimal('-42').toNumber()).toBe(-42);
    expect(new BigDecimal('0').toNumber()).toBe(0);
  });

  test('decimal values', () => {
    expect(new BigDecimal('3.14').toNumber()).toBeCloseTo(3.14, 10);
    expect(new BigDecimal('-0.5').toNumber()).toBe(-0.5);
    expect(new BigDecimal('0.001').toNumber()).toBe(0.001);
  });

  test('zero', () => {
    expect(new BigDecimal(0).toNumber()).toBe(0);
    expect(new BigDecimal('0.0').toNumber()).toBe(0);
  });

  test('NaN', () => {
    expect(new BigDecimal(NaN).toNumber()).toBeNaN();
    expect(new BigDecimal('NaN').toNumber()).toBeNaN();
  });

  test('Infinity', () => {
    expect(new BigDecimal(Infinity).toNumber()).toBe(Infinity);
    expect(new BigDecimal(-Infinity).toNumber()).toBe(-Infinity);
    expect(new BigDecimal('Infinity').toNumber()).toBe(Infinity);
    expect(new BigDecimal('-Infinity').toNumber()).toBe(-Infinity);
  });

  test('large integer', () => {
    expect(new BigDecimal('1000000').toNumber()).toBe(1000000);
    expect(new BigDecimal('1e10').toNumber()).toBe(1e10);
  });

  test('large value that overflows to Infinity', () => {
    expect(new BigDecimal('1e309').toNumber()).toBe(Infinity);
    expect(new BigDecimal('-1e309').toNumber()).toBe(-Infinity);
  });

  test('small float', () => {
    expect(new BigDecimal('0.0025').toNumber()).toBeCloseTo(0.0025, 10);
  });

  test('round-trips for typical JS numbers', () => {
    const values = [1, -1, 0.1, 3.14, 1e15, -7.5, 100];
    for (const v of values) {
      expect(new BigDecimal(v).toNumber()).toBe(v);
    }
  });
});

// ================================================================
// toString()
// ================================================================

describe('toString()', () => {
  test('integer', () => {
    expect(new BigDecimal('123').toString()).toBe('123');
    expect(new BigDecimal('0').toString()).toBe('0');
    expect(new BigDecimal('-42').toString()).toBe('-42');
  });

  test('decimal', () => {
    expect(new BigDecimal('123.456').toString()).toBe('123.456');
    expect(new BigDecimal('-42.5').toString()).toBe('-42.5');
    expect(new BigDecimal('0.1').toString()).toBe('0.1');
  });

  test('leading zeros in fractional part', () => {
    expect(new BigDecimal('-0.001').toString()).toBe('-0.001');
    expect(new BigDecimal('0.0025').toString()).toBe('0.0025');
  });

  test('integer with trailing zeros (normalized)', () => {
    // 12000 normalizes to sig=12, exp=3, so toString should give "12000"
    expect(new BigDecimal('12000').toString()).toBe('12000');
    expect(new BigDecimal('100').toString()).toBe('100');
  });

  test('zero', () => {
    expect(new BigDecimal('0').toString()).toBe('0');
    expect(new BigDecimal('0.0').toString()).toBe('0');
    expect(new BigDecimal(0).toString()).toBe('0');
  });

  test('NaN', () => {
    expect(new BigDecimal(NaN).toString()).toBe('NaN');
    expect(new BigDecimal('NaN').toString()).toBe('NaN');
  });

  test('Infinity', () => {
    expect(new BigDecimal(Infinity).toString()).toBe('Infinity');
    expect(new BigDecimal(-Infinity).toString()).toBe('-Infinity');
  });

  test('large exponent uses scientific notation', () => {
    // 1.5e25 = sig=15, exp=24 -> adjustedExp = 2+24-1 = 25 > 20
    expect(new BigDecimal('1.5e25').toString()).toBe('1.5e+25');
    expect(new BigDecimal('1e100').toString()).toBe('1e+100');
    expect(new BigDecimal('-3e30').toString()).toBe('-3e+30');
  });

  test('very small exponent uses scientific notation', () => {
    // 3e-50 = sig=3, exp=-50 -> adjustedExp = 1+(-50)-1 = -50 < -6
    expect(new BigDecimal('3e-50').toString()).toBe('3e-50');
    expect(new BigDecimal('1.5e-10').toString()).toBe('1.5e-10');
    expect(new BigDecimal('-2.5e-20').toString()).toBe('-2.5e-20');
  });

  test('borderline exponents stay as plain decimal', () => {
    // adjustedExp = 20 -> still plain decimal
    expect(new BigDecimal('1e20').toString()).toBe('100000000000000000000');
    // adjustedExp = -6 -> still plain decimal
    expect(new BigDecimal('1e-6').toString()).toBe('0.000001');
  });

  test('borderline exponents just past threshold use scientific', () => {
    // adjustedExp = 21 -> scientific
    expect(new BigDecimal('1e21').toString()).toBe('1e+21');
    // adjustedExp = -7 -> scientific
    expect(new BigDecimal('1e-7').toString()).toBe('1e-7');
  });

  test('negative decimal with leading fractional zeros', () => {
    expect(new BigDecimal('-0.0001').toString()).toBe('-0.0001');
  });

  test('single digit', () => {
    expect(new BigDecimal('5').toString()).toBe('5');
    expect(new BigDecimal('-9').toString()).toBe('-9');
  });
});

// ================================================================
// toFixed()
// ================================================================

describe('toFixed()', () => {
  test('rounding to fewer decimal places', () => {
    expect(new BigDecimal('123.456').toFixed(2)).toBe('123.46');
    expect(new BigDecimal('123.454').toFixed(2)).toBe('123.45');
    expect(new BigDecimal('123.455').toFixed(2)).toBe('123.46');
  });

  test('zero digits (truncate to integer)', () => {
    expect(new BigDecimal('123.456').toFixed(0)).toBe('123');
    expect(new BigDecimal('123.999').toFixed(0)).toBe('124');
    expect(new BigDecimal('-2.7').toFixed(0)).toBe('-3');
  });

  test('undefined digits behaves like toFixed(0)', () => {
    expect(new BigDecimal('123.456').toFixed()).toBe('123');
    expect(new BigDecimal('-5.9').toFixed()).toBe('-6');
  });

  test('padding with zeros', () => {
    expect(new BigDecimal('123.456').toFixed(5)).toBe('123.45600');
    expect(new BigDecimal('42').toFixed(3)).toBe('42.000');
    expect(new BigDecimal('0').toFixed(4)).toBe('0.0000');
  });

  test('small value with fewer digits than requested', () => {
    expect(new BigDecimal('0.001').toFixed(2)).toBe('0.00');
    expect(new BigDecimal('0.001').toFixed(3)).toBe('0.001');
    expect(new BigDecimal('0.001').toFixed(5)).toBe('0.00100');
  });

  test('negative values', () => {
    expect(new BigDecimal('-123.456').toFixed(2)).toBe('-123.46');
    // -0.5 rounds to 0 (even), sign is suppressed when result is zero
    expect(new BigDecimal('-0.5').toFixed(0)).toBe('0');
  });

  test('round half-to-even (bankers rounding)', () => {
    // 2.5 -> round to 2 (even)
    expect(new BigDecimal('2.5').toFixed(0)).toBe('2');
    // 3.5 -> round to 4 (even)
    expect(new BigDecimal('3.5').toFixed(0)).toBe('4');
    // 0.5 -> round to 0 (even)
    expect(new BigDecimal('0.5').toFixed(0)).toBe('0');
    // 1.5 -> round to 2 (even)
    expect(new BigDecimal('1.5').toFixed(0)).toBe('2');
  });

  test('exact value with matching digits', () => {
    expect(new BigDecimal('1.23').toFixed(2)).toBe('1.23');
  });

  test('integer input', () => {
    expect(new BigDecimal('100').toFixed(0)).toBe('100');
    expect(new BigDecimal('100').toFixed(2)).toBe('100.00');
  });

  test('NaN and Infinity', () => {
    expect(new BigDecimal(NaN).toFixed(2)).toBe('NaN');
    expect(new BigDecimal(Infinity).toFixed(2)).toBe('Infinity');
    expect(new BigDecimal(-Infinity).toFixed(2)).toBe('-Infinity');
  });

  test('large number of digits', () => {
    expect(new BigDecimal('1').toFixed(10)).toBe('1.0000000000');
  });

  test('negative value rounds to zero', () => {
    // -0.001 rounded to 2 digits is -0.00 but should display as 0.00
    expect(new BigDecimal('-0.001').toFixed(2)).toBe('0.00');
  });
});

// ================================================================
// toBigInt()
// ================================================================

describe('toBigInt()', () => {
  test('integer values', () => {
    expect(new BigDecimal('123').toBigInt()).toBe(123n);
    expect(new BigDecimal('-42').toBigInt()).toBe(-42n);
    expect(new BigDecimal('0').toBigInt()).toBe(0n);
  });

  test('truncates fractional part (does not round)', () => {
    expect(new BigDecimal('123.9').toBigInt()).toBe(123n);
    expect(new BigDecimal('123.1').toBigInt()).toBe(123n);
    expect(new BigDecimal('0.999').toBigInt()).toBe(0n);
  });

  test('negative values truncate toward zero', () => {
    expect(new BigDecimal('-5.7').toBigInt()).toBe(-5n);
    expect(new BigDecimal('-0.9').toBigInt()).toBe(0n);
    expect(new BigDecimal('-100.001').toBigInt()).toBe(-100n);
  });

  test('large integer', () => {
    expect(new BigDecimal('1e20').toBigInt()).toBe(100000000000000000000n);
    expect(new BigDecimal('12000').toBigInt()).toBe(12000n);
  });

  test('throws for NaN', () => {
    expect(() => new BigDecimal(NaN).toBigInt()).toThrow(RangeError);
    expect(() => new BigDecimal(NaN).toBigInt()).toThrow('Cannot convert NaN to BigInt');
  });

  test('throws for Infinity', () => {
    expect(() => new BigDecimal(Infinity).toBigInt()).toThrow(RangeError);
    expect(() => new BigDecimal(-Infinity).toBigInt()).toThrow('Cannot convert Infinity to BigInt');
  });

  test('value with exponent > 0', () => {
    // sig=5, exp=3 -> 5000
    expect(new BigDecimal('5e3').toBigInt()).toBe(5000n);
  });

  test('very small value truncates to zero', () => {
    expect(new BigDecimal('0.0001').toBigInt()).toBe(0n);
    expect(new BigDecimal('-0.0001').toBigInt()).toBe(0n);
  });
});

// ================================================================
// cmp()
// ================================================================

describe('cmp()', () => {
  test('equal values', () => {
    expect(new BigDecimal('5').cmp(new BigDecimal('5'))).toBe(0);
    expect(new BigDecimal('3.14').cmp(new BigDecimal('3.14'))).toBe(0);
    expect(new BigDecimal('0').cmp(new BigDecimal('0'))).toBe(0);
    expect(new BigDecimal('-7').cmp(new BigDecimal('-7'))).toBe(0);
  });

  test('less than', () => {
    expect(new BigDecimal('1').cmp(new BigDecimal('2'))).toBe(-1);
    expect(new BigDecimal('-5').cmp(new BigDecimal('5'))).toBe(-1);
    expect(new BigDecimal('-10').cmp(new BigDecimal('-1'))).toBe(-1);
    expect(new BigDecimal('0').cmp(new BigDecimal('1'))).toBe(-1);
  });

  test('greater than', () => {
    expect(new BigDecimal('2').cmp(new BigDecimal('1'))).toBe(1);
    expect(new BigDecimal('5').cmp(new BigDecimal('-5'))).toBe(1);
    expect(new BigDecimal('-1').cmp(new BigDecimal('-10'))).toBe(1);
    expect(new BigDecimal('1').cmp(new BigDecimal('0'))).toBe(1);
  });

  test('different exponents, same value', () => {
    // 1.5 (sig=15, exp=-1) vs 150 * 10^-2 (sig=15, exp=-1) => same
    const a = new BigDecimal('1.5');
    const b = new BigDecimal('1.50');
    expect(a.cmp(b)).toBe(0);
  });

  test('different exponents, different values', () => {
    // 1.5 vs 150
    expect(new BigDecimal('1.5').cmp(new BigDecimal('150'))).toBe(-1);
    expect(new BigDecimal('150').cmp(new BigDecimal('1.5'))).toBe(1);
  });

  test('small values with different exponents', () => {
    // 0.0015 vs 0.15
    expect(new BigDecimal('0.0015').cmp(new BigDecimal('0.15'))).toBe(-1);
    expect(new BigDecimal('0.15').cmp(new BigDecimal('0.0015'))).toBe(1);
  });

  test('NaN compared to anything returns 0', () => {
    expect(new BigDecimal(NaN).cmp(new BigDecimal('5'))).toBe(0);
    expect(new BigDecimal('5').cmp(new BigDecimal(NaN))).toBe(0);
    expect(new BigDecimal(NaN).cmp(new BigDecimal(NaN))).toBe(0);
  });

  test('infinity comparisons', () => {
    const inf = new BigDecimal(Infinity);
    const negInf = new BigDecimal(-Infinity);
    const five = new BigDecimal('5');

    expect(inf.cmp(five)).toBe(1);
    expect(five.cmp(inf)).toBe(-1);
    expect(negInf.cmp(five)).toBe(-1);
    expect(five.cmp(negInf)).toBe(1);
    expect(inf.cmp(inf)).toBe(0);
    expect(negInf.cmp(negInf)).toBe(0);
    expect(inf.cmp(negInf)).toBe(1);
    expect(negInf.cmp(inf)).toBe(-1);
  });

  test('zero comparisons', () => {
    const zero = new BigDecimal(0);
    expect(zero.cmp(new BigDecimal(0))).toBe(0);
    expect(zero.cmp(new BigDecimal('1'))).toBe(-1);
    expect(zero.cmp(new BigDecimal('-1'))).toBe(1);
  });
});

// ================================================================
// eq()
// ================================================================

describe('eq()', () => {
  test('equal values', () => {
    expect(new BigDecimal('5').eq(new BigDecimal('5'))).toBe(true);
    expect(new BigDecimal('3.14').eq(new BigDecimal('3.14'))).toBe(true);
    expect(new BigDecimal('0').eq(new BigDecimal('0'))).toBe(true);
  });

  test('unequal values', () => {
    expect(new BigDecimal('5').eq(new BigDecimal('6'))).toBe(false);
    expect(new BigDecimal('3.14').eq(new BigDecimal('3.15'))).toBe(false);
  });

  test('NaN !== NaN', () => {
    expect(new BigDecimal(NaN).eq(new BigDecimal(NaN))).toBe(false);
  });

  test('NaN !== number', () => {
    expect(new BigDecimal(NaN).eq(new BigDecimal('5'))).toBe(false);
    expect(new BigDecimal('5').eq(new BigDecimal(NaN))).toBe(false);
  });

  test('different exponents, same value', () => {
    // 1.50 and 1.5 normalize to same representation
    expect(new BigDecimal('1.50').eq(new BigDecimal('1.5'))).toBe(true);
    // 100 (sig=1, exp=2) and 100.0 (sig=1, exp=2) should be equal
    expect(new BigDecimal('100').eq(new BigDecimal('100.0'))).toBe(true);
  });

  test('accepts number argument', () => {
    expect(new BigDecimal('42').eq(42)).toBe(true);
    expect(new BigDecimal('42').eq(43)).toBe(false);
    expect(new BigDecimal('3.14').eq(3.14)).toBe(true);
    expect(new BigDecimal('0').eq(0)).toBe(true);
  });

  test('infinity equality', () => {
    expect(new BigDecimal(Infinity).eq(new BigDecimal(Infinity))).toBe(true);
    expect(new BigDecimal(-Infinity).eq(new BigDecimal(-Infinity))).toBe(true);
    expect(new BigDecimal(Infinity).eq(new BigDecimal(-Infinity))).toBe(false);
    expect(new BigDecimal(Infinity).eq(new BigDecimal('5'))).toBe(false);
  });
});

// ================================================================
// lt()
// ================================================================

describe('lt()', () => {
  test('strictly less', () => {
    expect(new BigDecimal('1').lt(new BigDecimal('2'))).toBe(true);
    expect(new BigDecimal('-5').lt(new BigDecimal('5'))).toBe(true);
    expect(new BigDecimal('0').lt(new BigDecimal('0.001'))).toBe(true);
  });

  test('not less when equal', () => {
    expect(new BigDecimal('5').lt(new BigDecimal('5'))).toBe(false);
    expect(new BigDecimal('0').lt(new BigDecimal('0'))).toBe(false);
  });

  test('not less when greater', () => {
    expect(new BigDecimal('2').lt(new BigDecimal('1'))).toBe(false);
    expect(new BigDecimal('5').lt(new BigDecimal('-5'))).toBe(false);
  });

  test('NaN comparisons return false', () => {
    expect(new BigDecimal(NaN).lt(new BigDecimal('5'))).toBe(false);
    expect(new BigDecimal('5').lt(new BigDecimal(NaN))).toBe(false);
  });

  test('accepts number argument', () => {
    expect(new BigDecimal('1').lt(2)).toBe(true);
    expect(new BigDecimal('5').lt(3)).toBe(false);
    expect(new BigDecimal('5').lt(5)).toBe(false);
  });
});

// ================================================================
// lte()
// ================================================================

describe('lte()', () => {
  test('less than', () => {
    expect(new BigDecimal('1').lte(new BigDecimal('2'))).toBe(true);
  });

  test('equal', () => {
    expect(new BigDecimal('5').lte(new BigDecimal('5'))).toBe(true);
  });

  test('not lte when greater', () => {
    expect(new BigDecimal('2').lte(new BigDecimal('1'))).toBe(false);
  });

  test('NaN comparisons return false', () => {
    expect(new BigDecimal(NaN).lte(new BigDecimal('5'))).toBe(false);
    expect(new BigDecimal('5').lte(new BigDecimal(NaN))).toBe(false);
  });

  test('accepts number argument', () => {
    expect(new BigDecimal('1').lte(2)).toBe(true);
    expect(new BigDecimal('5').lte(5)).toBe(true);
    expect(new BigDecimal('6').lte(5)).toBe(false);
  });
});

// ================================================================
// gt()
// ================================================================

describe('gt()', () => {
  test('strictly greater', () => {
    expect(new BigDecimal('2').gt(new BigDecimal('1'))).toBe(true);
    expect(new BigDecimal('5').gt(new BigDecimal('-5'))).toBe(true);
    expect(new BigDecimal('0.001').gt(new BigDecimal('0'))).toBe(true);
  });

  test('not greater when equal', () => {
    expect(new BigDecimal('5').gt(new BigDecimal('5'))).toBe(false);
  });

  test('not greater when less', () => {
    expect(new BigDecimal('1').gt(new BigDecimal('2'))).toBe(false);
  });

  test('NaN comparisons return false', () => {
    expect(new BigDecimal(NaN).gt(new BigDecimal('5'))).toBe(false);
    expect(new BigDecimal('5').gt(new BigDecimal(NaN))).toBe(false);
  });

  test('accepts number argument', () => {
    expect(new BigDecimal('5').gt(3)).toBe(true);
    expect(new BigDecimal('1').gt(2)).toBe(false);
    expect(new BigDecimal('5').gt(5)).toBe(false);
  });
});

// ================================================================
// gte()
// ================================================================

describe('gte()', () => {
  test('greater than', () => {
    expect(new BigDecimal('2').gte(new BigDecimal('1'))).toBe(true);
  });

  test('equal', () => {
    expect(new BigDecimal('5').gte(new BigDecimal('5'))).toBe(true);
  });

  test('not gte when less', () => {
    expect(new BigDecimal('1').gte(new BigDecimal('2'))).toBe(false);
  });

  test('NaN comparisons return false', () => {
    expect(new BigDecimal(NaN).gte(new BigDecimal('5'))).toBe(false);
    expect(new BigDecimal('5').gte(new BigDecimal(NaN))).toBe(false);
  });

  test('accepts number argument', () => {
    expect(new BigDecimal('5').gte(3)).toBe(true);
    expect(new BigDecimal('5').gte(5)).toBe(true);
    expect(new BigDecimal('1').gte(2)).toBe(false);
  });
});

// ================================================================
// neg()
// ================================================================

describe('neg()', () => {
  test('positive to negative', () => {
    const d = new BigDecimal('5').neg();
    expect(d.significand).toBe(-5n);
    expect(d.exponent).toBe(0);
  });

  test('negative to positive', () => {
    const d = new BigDecimal('-3.14').neg();
    expect(d.significand).toBe(314n);
    expect(d.exponent).toBe(-2);
  });

  test('zero stays zero', () => {
    const d = new BigDecimal('0').neg();
    expect(d.isZero()).toBe(true);
    expect(d.significand).toBe(0n);
  });

  test('NaN stays NaN', () => {
    expect(new BigDecimal(NaN).neg().isNaN()).toBe(true);
  });

  test('Infinity negation', () => {
    const d = new BigDecimal(Infinity).neg();
    expect(d.significand).toBe(-1n);
    expect(d.exponent).toBe(Infinity);

    const d2 = new BigDecimal(-Infinity).neg();
    expect(d2.significand).toBe(1n);
    expect(d2.exponent).toBe(Infinity);
  });

  test('double negation', () => {
    const d = new BigDecimal('42.5').neg().neg();
    expect(d.eq(new BigDecimal('42.5'))).toBe(true);
  });
});

// ================================================================
// abs()
// ================================================================

describe('abs()', () => {
  test('negative to positive', () => {
    const d = new BigDecimal('-5').abs();
    expect(d.significand).toBe(5n);
    expect(d.exponent).toBe(0);
  });

  test('positive stays positive', () => {
    const original = new BigDecimal('5');
    const d = original.abs();
    expect(d).toBe(original); // should return same object
  });

  test('zero stays zero', () => {
    const original = new BigDecimal('0');
    const d = original.abs();
    expect(d).toBe(original); // 0n >= 0n is true, returns this
    expect(d.isZero()).toBe(true);
  });

  test('NaN stays NaN', () => {
    expect(new BigDecimal(NaN).abs().isNaN()).toBe(true);
  });

  test('negative Infinity becomes positive Infinity', () => {
    const d = new BigDecimal(-Infinity).abs();
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('positive Infinity stays', () => {
    const d = new BigDecimal(Infinity).abs();
    expect(d.significand).toBe(1n);
    expect(d.exponent).toBe(Infinity);
  });

  test('negative decimal', () => {
    const d = new BigDecimal('-3.14').abs();
    expect(d.significand).toBe(314n);
    expect(d.exponent).toBe(-2);
  });
});

// ================================================================
// add()
// ================================================================

describe('add()', () => {
  test('simple addition', () => {
    const result = new BigDecimal('2').add(new BigDecimal('3'));
    expect(result.eq(new BigDecimal('5'))).toBe(true);
  });

  test('different exponents (100 + 0.001)', () => {
    const result = new BigDecimal('100').add(new BigDecimal('0.001'));
    expect(result.toString()).toBe('100.001');
  });

  test('negative + positive', () => {
    const result = new BigDecimal('-3').add(new BigDecimal('5'));
    expect(result.eq(new BigDecimal('2'))).toBe(true);
  });

  test('positive + negative', () => {
    const result = new BigDecimal('5').add(new BigDecimal('-3'));
    expect(result.eq(new BigDecimal('2'))).toBe(true);
  });

  test('negative + negative', () => {
    const result = new BigDecimal('-3').add(new BigDecimal('-7'));
    expect(result.eq(new BigDecimal('-10'))).toBe(true);
  });

  test('adding zero', () => {
    const a = new BigDecimal('42');
    const result = a.add(new BigDecimal('0'));
    expect(result.eq(a)).toBe(true);
  });

  test('zero + zero', () => {
    const result = new BigDecimal('0').add(new BigDecimal('0'));
    expect(result.isZero()).toBe(true);
  });

  test('decimal addition (0.1 + 0.2)', () => {
    const result = new BigDecimal('0.1').add(new BigDecimal('0.2'));
    expect(result.eq(new BigDecimal('0.3'))).toBe(true);
  });

  test('NaN propagation', () => {
    expect(new BigDecimal(NaN).add(new BigDecimal('1')).isNaN()).toBe(true);
    expect(new BigDecimal('1').add(new BigDecimal(NaN)).isNaN()).toBe(true);
  });

  test('Infinity + finite → Infinity', () => {
    const result = new BigDecimal(Infinity).add(new BigDecimal('1'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('finite + Infinity → Infinity', () => {
    const result = new BigDecimal('1').add(new BigDecimal(Infinity));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('-Infinity + finite → -Infinity', () => {
    const result = new BigDecimal(-Infinity).add(new BigDecimal('1'));
    expect(result.toNumber()).toBe(-Infinity);
  });

  test('Infinity + (-Infinity) → NaN', () => {
    const result = new BigDecimal(Infinity).add(new BigDecimal(-Infinity));
    expect(result.isNaN()).toBe(true);
  });

  test('-Infinity + Infinity → NaN', () => {
    const result = new BigDecimal(-Infinity).add(new BigDecimal(Infinity));
    expect(result.isNaN()).toBe(true);
  });

  test('Infinity + Infinity → Infinity', () => {
    const result = new BigDecimal(Infinity).add(new BigDecimal(Infinity));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('large + small', () => {
    const result = new BigDecimal('1e20').add(new BigDecimal('1e-20'));
    // Exact — no precision loss. adjustedExp = 20, which is the borderline (plain decimal).
    expect(result.toString()).toBe('100000000000000000000.00000000000000000001');
  });
});

// ================================================================
// sub()
// ================================================================

describe('sub()', () => {
  test('simple subtraction', () => {
    const result = new BigDecimal('5').sub(new BigDecimal('3'));
    expect(result.eq(new BigDecimal('2'))).toBe(true);
  });

  test('a - a = 0', () => {
    const a = new BigDecimal('42.5');
    const result = a.sub(new BigDecimal('42.5'));
    expect(result.isZero()).toBe(true);
  });

  test('negative result', () => {
    const result = new BigDecimal('3').sub(new BigDecimal('5'));
    expect(result.eq(new BigDecimal('-2'))).toBe(true);
  });

  test('subtracting negative', () => {
    const result = new BigDecimal('5').sub(new BigDecimal('-3'));
    expect(result.eq(new BigDecimal('8'))).toBe(true);
  });

  test('subtracting zero', () => {
    const result = new BigDecimal('42').sub(new BigDecimal('0'));
    expect(result.eq(new BigDecimal('42'))).toBe(true);
  });

  test('NaN propagation', () => {
    expect(new BigDecimal(NaN).sub(new BigDecimal('1')).isNaN()).toBe(true);
    expect(new BigDecimal('1').sub(new BigDecimal(NaN)).isNaN()).toBe(true);
  });

  test('Infinity - Infinity → NaN', () => {
    const result = new BigDecimal(Infinity).sub(new BigDecimal(Infinity));
    expect(result.isNaN()).toBe(true);
  });

  test('Infinity - finite → Infinity', () => {
    const result = new BigDecimal(Infinity).sub(new BigDecimal('5'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('finite - Infinity → -Infinity', () => {
    const result = new BigDecimal('5').sub(new BigDecimal(Infinity));
    expect(result.toNumber()).toBe(-Infinity);
  });
});

// ================================================================
// mul()
// ================================================================

describe('mul()', () => {
  test('simple multiplication', () => {
    const result = new BigDecimal('3').mul(new BigDecimal('4'));
    expect(result.eq(new BigDecimal('12'))).toBe(true);
  });

  test('decimal * decimal (0.1 * 0.2 = 0.02)', () => {
    const result = new BigDecimal('0.1').mul(new BigDecimal('0.2'));
    expect(result.eq(new BigDecimal('0.02'))).toBe(true);
  });

  test('negative * positive', () => {
    const result = new BigDecimal('-3').mul(new BigDecimal('4'));
    expect(result.eq(new BigDecimal('-12'))).toBe(true);
  });

  test('negative * negative', () => {
    const result = new BigDecimal('-3').mul(new BigDecimal('-4'));
    expect(result.eq(new BigDecimal('12'))).toBe(true);
  });

  test('multiply by zero', () => {
    const result = new BigDecimal('42').mul(new BigDecimal('0'));
    expect(result.isZero()).toBe(true);
  });

  test('multiply by one', () => {
    const result = new BigDecimal('42.5').mul(new BigDecimal('1'));
    expect(result.eq(new BigDecimal('42.5'))).toBe(true);
  });

  test('large multiplication', () => {
    const result = new BigDecimal('1e50').mul(new BigDecimal('1e50'));
    expect(result.eq(new BigDecimal('1e100'))).toBe(true);
  });

  test('NaN propagation', () => {
    expect(new BigDecimal(NaN).mul(new BigDecimal('1')).isNaN()).toBe(true);
    expect(new BigDecimal('1').mul(new BigDecimal(NaN)).isNaN()).toBe(true);
  });

  test('Infinity * finite → Infinity', () => {
    const result = new BigDecimal(Infinity).mul(new BigDecimal('5'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Infinity * negative → -Infinity', () => {
    const result = new BigDecimal(Infinity).mul(new BigDecimal('-5'));
    expect(result.toNumber()).toBe(-Infinity);
  });

  test('-Infinity * negative → Infinity', () => {
    const result = new BigDecimal(-Infinity).mul(new BigDecimal('-5'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Infinity * 0 → NaN', () => {
    const result = new BigDecimal(Infinity).mul(new BigDecimal('0'));
    expect(result.isNaN()).toBe(true);
  });

  test('0 * Infinity → NaN', () => {
    const result = new BigDecimal('0').mul(new BigDecimal(Infinity));
    expect(result.isNaN()).toBe(true);
  });

  test('Infinity * Infinity → Infinity', () => {
    const result = new BigDecimal(Infinity).mul(new BigDecimal(Infinity));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Infinity * -Infinity → -Infinity', () => {
    const result = new BigDecimal(Infinity).mul(new BigDecimal(-Infinity));
    expect(result.toNumber()).toBe(-Infinity);
  });
});

// ================================================================
// trunc()
// ================================================================

describe('trunc()', () => {
  test('positive decimal truncates toward zero', () => {
    expect(new BigDecimal('3.7').trunc().eq(new BigDecimal('3'))).toBe(true);
    expect(new BigDecimal('3.2').trunc().eq(new BigDecimal('3'))).toBe(true);
  });

  test('negative decimal truncates toward zero', () => {
    expect(new BigDecimal('-3.7').trunc().eq(new BigDecimal('-3'))).toBe(true);
    expect(new BigDecimal('-3.2').trunc().eq(new BigDecimal('-3'))).toBe(true);
  });

  test('integer returns itself', () => {
    const d = new BigDecimal('42');
    expect(d.trunc()).toBe(d); // same reference for integer
  });

  test('zero returns itself', () => {
    const d = new BigDecimal('0');
    expect(d.trunc()).toBe(d);
  });

  test('small value truncates to zero', () => {
    expect(new BigDecimal('0.999').trunc().isZero()).toBe(true);
    expect(new BigDecimal('-0.999').trunc().isZero()).toBe(true);
  });

  test('NaN → NaN', () => {
    expect(new BigDecimal(NaN).trunc().isNaN()).toBe(true);
  });

  test('Infinity → Infinity', () => {
    expect(new BigDecimal(Infinity).trunc().toNumber()).toBe(Infinity);
    expect(new BigDecimal(-Infinity).trunc().toNumber()).toBe(-Infinity);
  });

  test('large integer is unchanged', () => {
    const d = new BigDecimal('1e20');
    expect(d.trunc()).toBe(d);
  });
});

// ================================================================
// div()
// ================================================================

describe('div()', () => {
  beforeAll(() => {
    BigDecimal.precision = 50;
  });

  afterAll(() => {
    BigDecimal.precision = 50;
  });

  test('10 / 3 ≈ 3.333...', () => {
    const result = new BigDecimal('10').div(new BigDecimal('3'));
    const s = result.toString();
    // Should start with 3.333...
    expect(s.startsWith('3.3333')).toBe(true);
    // Should have many 3s
    expect(s.replace('.', '').replace(/3/g, '').length).toBeLessThanOrEqual(2);
  });

  test('1 / 4 = 0.25 (exact)', () => {
    const result = new BigDecimal('1').div(new BigDecimal('4'));
    expect(result.sub(new BigDecimal('0.25')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('0 / 5 = 0', () => {
    const result = new BigDecimal('0').div(new BigDecimal('5'));
    expect(result.isZero()).toBe(true);
  });

  test('1 / 0 = Infinity', () => {
    const result = new BigDecimal('1').div(new BigDecimal('0'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('-1 / 0 = -Infinity', () => {
    const result = new BigDecimal('-1').div(new BigDecimal('0'));
    expect(result.toNumber()).toBe(-Infinity);
  });

  test('0 / 0 = NaN', () => {
    const result = new BigDecimal('0').div(new BigDecimal('0'));
    expect(result.isNaN()).toBe(true);
  });

  test('NaN / x = NaN', () => {
    expect(new BigDecimal(NaN).div(new BigDecimal('5')).isNaN()).toBe(true);
  });

  test('x / NaN = NaN', () => {
    expect(new BigDecimal('5').div(new BigDecimal(NaN)).isNaN()).toBe(true);
  });

  test('Inf / finite = Inf', () => {
    const result = new BigDecimal(Infinity).div(new BigDecimal('5'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Inf / negative finite = -Inf', () => {
    const result = new BigDecimal(Infinity).div(new BigDecimal('-5'));
    expect(result.toNumber()).toBe(-Infinity);
  });

  test('-Inf / positive finite = -Inf', () => {
    const result = new BigDecimal(-Infinity).div(new BigDecimal('5'));
    expect(result.toNumber()).toBe(-Infinity);
  });

  test('-Inf / negative finite = Inf', () => {
    const result = new BigDecimal(-Infinity).div(new BigDecimal('-5'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('finite / Inf = 0', () => {
    const result = new BigDecimal('5').div(new BigDecimal(Infinity));
    expect(result.isZero()).toBe(true);
  });

  test('finite / -Inf = 0', () => {
    const result = new BigDecimal('5').div(new BigDecimal(-Infinity));
    expect(result.isZero()).toBe(true);
  });

  test('Inf / Inf = NaN', () => {
    const result = new BigDecimal(Infinity).div(new BigDecimal(Infinity));
    expect(result.isNaN()).toBe(true);
  });

  test('-6 / 3 = -2', () => {
    const result = new BigDecimal('-6').div(new BigDecimal('3'));
    // Should be very close to -2
    expect(result.sub(new BigDecimal('-2')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('6 / -3 = -2', () => {
    const result = new BigDecimal('6').div(new BigDecimal('-3'));
    expect(result.sub(new BigDecimal('-2')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('-6 / -3 = 2', () => {
    const result = new BigDecimal('-6').div(new BigDecimal('-3'));
    expect(result.sub(new BigDecimal('2')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('100 / 10 = 10', () => {
    const result = new BigDecimal('100').div(new BigDecimal('10'));
    expect(result.sub(new BigDecimal('10')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('high precision division', () => {
    BigDecimal.precision = 100;
    const result = new BigDecimal('1').div(new BigDecimal('7'));
    // 1/7 = 0.142857142857... repeating
    const s = result.toString();
    // Should contain the repeating pattern 142857
    expect(s).toContain('142857142857');
    // Check we have approximately 100 significant digits
    const digits = s.replace('-', '').replace('0.', '').replace(/0+$/, '');
    expect(digits.length).toBeGreaterThanOrEqual(95);
    BigDecimal.precision = 50;
  });

  test('1/3 precision check', () => {
    BigDecimal.precision = 50;
    const result = new BigDecimal('1').div(new BigDecimal('3'));
    const s = result.toString();
    // Should have many 3s after 0.
    const fracPart = s.replace('0.', '');
    // All digits should be 3 (possibly with trailing rounding artifact)
    const threeCount = (fracPart.match(/3/g) || []).length;
    expect(threeCount).toBeGreaterThanOrEqual(45);
  });
});

// ================================================================
// inv()
// ================================================================

describe('inv()', () => {
  beforeAll(() => {
    BigDecimal.precision = 50;
  });

  test('inv of 2 = 0.5', () => {
    const result = new BigDecimal('2').inv();
    expect(result.sub(new BigDecimal('0.5')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('inv of 4 = 0.25', () => {
    const result = new BigDecimal('4').inv();
    expect(result.sub(new BigDecimal('0.25')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('inv of 0 = Infinity', () => {
    expect(new BigDecimal('0').inv().toNumber()).toBe(Infinity);
  });

  test('inv of NaN = NaN', () => {
    expect(new BigDecimal(NaN).inv().isNaN()).toBe(true);
  });

  test('inv of Infinity = 0', () => {
    expect(new BigDecimal(Infinity).inv().isZero()).toBe(true);
  });

  test('inv of negative', () => {
    const result = new BigDecimal('-4').inv();
    expect(result.sub(new BigDecimal('-0.25')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });
});

// ================================================================
// mod()
// ================================================================

describe('mod()', () => {
  beforeAll(() => {
    BigDecimal.precision = 50;
  });

  test('10 mod 3 = 1', () => {
    const result = new BigDecimal('10').mod(new BigDecimal('3'));
    expect(result.sub(new BigDecimal('1')).abs().lt(new BigDecimal('1e-30'))).toBe(true);
  });

  test('10.5 mod 3 = 1.5', () => {
    const result = new BigDecimal('10.5').mod(new BigDecimal('3'));
    expect(result.sub(new BigDecimal('1.5')).abs().lt(new BigDecimal('1e-30'))).toBe(true);
  });

  test('-10 mod 3 = -1', () => {
    const result = new BigDecimal('-10').mod(new BigDecimal('3'));
    expect(result.sub(new BigDecimal('-1')).abs().lt(new BigDecimal('1e-30'))).toBe(true);
  });

  test('7 mod 7 = 0', () => {
    const result = new BigDecimal('7').mod(new BigDecimal('7'));
    expect(result.abs().lt(new BigDecimal('1e-30'))).toBe(true);
  });

  test('0 mod 5 = 0', () => {
    const result = new BigDecimal('0').mod(new BigDecimal('5'));
    expect(result.isZero()).toBe(true);
  });

  test('x mod 0 = NaN', () => {
    expect(new BigDecimal('5').mod(new BigDecimal('0')).isNaN()).toBe(true);
  });

  test('NaN mod x = NaN', () => {
    expect(new BigDecimal(NaN).mod(new BigDecimal('3')).isNaN()).toBe(true);
  });

  test('x mod NaN = NaN', () => {
    expect(new BigDecimal('3').mod(new BigDecimal(NaN)).isNaN()).toBe(true);
  });

  test('Inf mod x = NaN', () => {
    expect(new BigDecimal(Infinity).mod(new BigDecimal('3')).isNaN()).toBe(true);
  });

  test('x mod Inf = x', () => {
    const result = new BigDecimal('5').mod(new BigDecimal(Infinity));
    expect(result.eq(new BigDecimal('5'))).toBe(true);
  });

  test('5.5 mod 2 = 1.5', () => {
    const result = new BigDecimal('5.5').mod(new BigDecimal('2'));
    expect(result.sub(new BigDecimal('1.5')).abs().lt(new BigDecimal('1e-30'))).toBe(true);
  });
});

// ================================================================
// pow()
// ================================================================

describe('pow()', () => {
  beforeAll(() => {
    BigDecimal.precision = 50;
  });

  afterAll(() => {
    BigDecimal.precision = 50;
  });

  test('2^10 = 1024', () => {
    const result = new BigDecimal('2').pow(new BigDecimal('10'));
    expect(result.eq(new BigDecimal('1024'))).toBe(true);
  });

  test('3^0 = 1', () => {
    const result = new BigDecimal('3').pow(new BigDecimal('0'));
    expect(result.eq(new BigDecimal('1'))).toBe(true);
  });

  test('2^-1 = 0.5', () => {
    const result = new BigDecimal('2').pow(new BigDecimal('-1'));
    expect(result.sub(new BigDecimal('0.5')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('2^-2 = 0.25', () => {
    const result = new BigDecimal('2').pow(new BigDecimal('-2'));
    expect(result.sub(new BigDecimal('0.25')).abs().lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('(-3)^3 = -27', () => {
    const result = new BigDecimal('-3').pow(new BigDecimal('3'));
    expect(result.eq(new BigDecimal('-27'))).toBe(true);
  });

  test('(-3)^2 = 9', () => {
    const result = new BigDecimal('-3').pow(new BigDecimal('2'));
    expect(result.eq(new BigDecimal('9'))).toBe(true);
  });

  test('0^5 = 0', () => {
    const result = new BigDecimal('0').pow(new BigDecimal('5'));
    expect(result.isZero()).toBe(true);
  });

  test('0^0 = 1', () => {
    const result = new BigDecimal('0').pow(new BigDecimal('0'));
    expect(result.eq(new BigDecimal('1'))).toBe(true);
  });

  test('1^anything = 1', () => {
    expect(new BigDecimal('1').pow(new BigDecimal('100')).eq(new BigDecimal('1'))).toBe(true);
    expect(new BigDecimal('1').pow(new BigDecimal('0')).eq(new BigDecimal('1'))).toBe(true);
  });

  test('x^1 = x', () => {
    const x = new BigDecimal('42.5');
    expect(x.pow(new BigDecimal('1')).eq(x)).toBe(true);
  });

  test('NaN base → NaN', () => {
    expect(new BigDecimal(NaN).pow(new BigDecimal('2')).isNaN()).toBe(true);
  });

  test('NaN exponent → NaN', () => {
    expect(new BigDecimal('2').pow(new BigDecimal(NaN)).isNaN()).toBe(true);
  });

  test('non-integer exponent on negative base → NaN', () => {
    expect(new BigDecimal('-2').pow(new BigDecimal('1.5')).isNaN()).toBe(true);
  });

  test('Infinity exponent → NaN', () => {
    expect(new BigDecimal('2').pow(new BigDecimal(Infinity)).isNaN()).toBe(true);
  });

  test('0^negative → Infinity', () => {
    const result = new BigDecimal('0').pow(new BigDecimal('-1'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Infinity^positive → Infinity', () => {
    const result = new BigDecimal(Infinity).pow(new BigDecimal('3'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('(-Infinity)^3 → -Infinity', () => {
    const result = new BigDecimal(-Infinity).pow(new BigDecimal('3'));
    expect(result.toNumber()).toBe(-Infinity);
  });

  test('(-Infinity)^2 → Infinity', () => {
    const result = new BigDecimal(-Infinity).pow(new BigDecimal('2'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Infinity^negative → 0', () => {
    const result = new BigDecimal(Infinity).pow(new BigDecimal('-2'));
    expect(result.isZero()).toBe(true);
  });

  test('large exponent', () => {
    const result = new BigDecimal('2').pow(new BigDecimal('100'));
    // 2^100 = 1267650600228229401496703205376
    expect(result.eq(new BigDecimal('1267650600228229401496703205376'))).toBe(true);
  });

  test('decimal base with integer exponent', () => {
    const result = new BigDecimal('0.5').pow(new BigDecimal('3'));
    // 0.5^3 = 0.125
    expect(result.eq(new BigDecimal('0.125'))).toBe(true);
  });

  test('negative exponent uses precision', () => {
    BigDecimal.precision = 50;
    const result = new BigDecimal('3').pow(new BigDecimal('-2'));
    // 3^-2 = 1/9 ≈ 0.1111...
    const s = result.toString();
    expect(s.startsWith('0.1111')).toBe(true);
    // Should have many 1s
    const oneCount = (s.replace('0.', '').match(/1/g) || []).length;
    expect(oneCount).toBeGreaterThanOrEqual(40);
  });

  // Non-integer exponent tests
  test('4^0.5 = 2', () => {
    const result = new BigDecimal('4').pow(new BigDecimal('0.5'));
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('8^(1/3) ≈ 2', () => {
    const exp = new BigDecimal('1').div(new BigDecimal('3'));
    const result = new BigDecimal('8').pow(exp);
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('e^π via pow', () => {
    const e = new BigDecimal('1').exp();
    const result = e.pow(BigDecimal.PI);
    const expected = BigDecimal.PI.exp();
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('(-2)^0.5 = NaN (real)', () => {
    expect(new BigDecimal('-2').pow(new BigDecimal('0.5')).isNaN()).toBe(true);
  });

  test('2^1.5 ≈ 2*sqrt(2)', () => {
    const result = new BigDecimal('2').pow(new BigDecimal('1.5'));
    const expected = new BigDecimal('2').mul(new BigDecimal('2').sqrt());
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('10^0.5 = sqrt(10)', () => {
    const result = new BigDecimal('10').pow(new BigDecimal('0.5'));
    const expected = new BigDecimal('10').sqrt();
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('0^0.5 = 0', () => {
    const result = new BigDecimal('0').pow(new BigDecimal('0.5'));
    expect(result.isZero()).toBe(true);
  });

  test('0^(-0.5) = Infinity', () => {
    const result = new BigDecimal('0').pow(new BigDecimal('-0.5'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Infinity^0.5 = Infinity', () => {
    const result = new BigDecimal(Infinity).pow(new BigDecimal('0.5'));
    expect(result.toNumber()).toBe(Infinity);
  });

  test('Infinity^(-0.5) = 0', () => {
    const result = new BigDecimal(Infinity).pow(new BigDecimal('-0.5'));
    expect(result.isZero()).toBe(true);
  });

  test('(-Inf)^0.5 = NaN', () => {
    expect(new BigDecimal(-Infinity).pow(new BigDecimal('0.5')).isNaN()).toBe(true);
  });
});

// ================================================================
// floor()
// ================================================================

describe('floor()', () => {
  test('positive decimal rounds toward -Infinity', () => {
    expect(new BigDecimal('3.7').floor().eq(new BigDecimal('3'))).toBe(true);
    expect(new BigDecimal('3.2').floor().eq(new BigDecimal('3'))).toBe(true);
    expect(new BigDecimal('3.999').floor().eq(new BigDecimal('3'))).toBe(true);
  });

  test('negative decimal rounds toward -Infinity', () => {
    expect(new BigDecimal('-3.7').floor().eq(new BigDecimal('-4'))).toBe(true);
    expect(new BigDecimal('-3.2').floor().eq(new BigDecimal('-4'))).toBe(true);
    expect(new BigDecimal('-3.001').floor().eq(new BigDecimal('-4'))).toBe(true);
  });

  test('integer returns itself', () => {
    const d = new BigDecimal('5');
    expect(d.floor()).toBe(d); // same reference
    expect(new BigDecimal('5').floor().eq(5)).toBe(true);
  });

  test('zero returns itself', () => {
    const d = new BigDecimal('0');
    expect(d.floor()).toBe(d);
    expect(new BigDecimal('0').floor().isZero()).toBe(true);
  });

  test('NaN → NaN', () => {
    expect(new BigDecimal(NaN).floor().isNaN()).toBe(true);
  });

  test('Infinity → Infinity', () => {
    expect(new BigDecimal(Infinity).floor().toNumber()).toBe(Infinity);
    expect(new BigDecimal(-Infinity).floor().toNumber()).toBe(-Infinity);
  });
});

// ================================================================
// ceil()
// ================================================================

describe('ceil()', () => {
  test('positive decimal rounds toward +Infinity', () => {
    expect(new BigDecimal('3.2').ceil().eq(new BigDecimal('4'))).toBe(true);
    expect(new BigDecimal('3.7').ceil().eq(new BigDecimal('4'))).toBe(true);
    expect(new BigDecimal('3.001').ceil().eq(new BigDecimal('4'))).toBe(true);
  });

  test('negative decimal rounds toward +Infinity', () => {
    expect(new BigDecimal('-3.2').ceil().eq(new BigDecimal('-3'))).toBe(true);
    expect(new BigDecimal('-3.7').ceil().eq(new BigDecimal('-3'))).toBe(true);
    expect(new BigDecimal('-3.999').ceil().eq(new BigDecimal('-3'))).toBe(true);
  });

  test('integer returns itself', () => {
    const d = new BigDecimal('5');
    expect(d.ceil()).toBe(d); // same reference
    expect(new BigDecimal('5').ceil().eq(5)).toBe(true);
  });

  test('zero returns itself', () => {
    const d = new BigDecimal('0');
    expect(d.ceil()).toBe(d);
    expect(new BigDecimal('0').ceil().isZero()).toBe(true);
  });

  test('NaN → NaN', () => {
    expect(new BigDecimal(NaN).ceil().isNaN()).toBe(true);
  });

  test('Infinity → Infinity', () => {
    expect(new BigDecimal(Infinity).ceil().toNumber()).toBe(Infinity);
    expect(new BigDecimal(-Infinity).ceil().toNumber()).toBe(-Infinity);
  });
});

// ================================================================
// round()
// ================================================================

describe('round()', () => {
  test('rounds half away from zero (positive)', () => {
    expect(new BigDecimal('3.5').round().eq(new BigDecimal('4'))).toBe(true);
    expect(new BigDecimal('3.6').round().eq(new BigDecimal('4'))).toBe(true);
  });

  test('rounds down when below half (positive)', () => {
    expect(new BigDecimal('3.4').round().eq(new BigDecimal('3'))).toBe(true);
    expect(new BigDecimal('3.1').round().eq(new BigDecimal('3'))).toBe(true);
  });

  test('rounds half away from zero (negative)', () => {
    expect(new BigDecimal('-3.5').round().eq(new BigDecimal('-4'))).toBe(true);
    expect(new BigDecimal('-3.6').round().eq(new BigDecimal('-4'))).toBe(true);
  });

  test('rounds toward zero when below half (negative)', () => {
    expect(new BigDecimal('-3.4').round().eq(new BigDecimal('-3'))).toBe(true);
    expect(new BigDecimal('-3.1').round().eq(new BigDecimal('-3'))).toBe(true);
  });

  test('integer returns itself', () => {
    const d = new BigDecimal('5');
    expect(d.round()).toBe(d); // same reference
    expect(new BigDecimal('5').round().eq(5)).toBe(true);
  });

  test('zero returns itself', () => {
    const d = new BigDecimal('0');
    expect(d.round()).toBe(d);
  });

  test('NaN → NaN', () => {
    expect(new BigDecimal(NaN).round().isNaN()).toBe(true);
  });

  test('Infinity → Infinity', () => {
    expect(new BigDecimal(Infinity).round().toNumber()).toBe(Infinity);
    expect(new BigDecimal(-Infinity).round().toNumber()).toBe(-Infinity);
  });
});

// ================================================================
// Static constants
// ================================================================

describe('Static constants', () => {
  test('ZERO', () => {
    expect(BigDecimal.ZERO.isZero()).toBe(true);
    expect(BigDecimal.ZERO.eq(0)).toBe(true);
  });

  test('ONE', () => {
    expect(BigDecimal.ONE.eq(1)).toBe(true);
  });

  test('TWO', () => {
    expect(BigDecimal.TWO.eq(2)).toBe(true);
  });

  test('NEGATIVE_ONE', () => {
    expect(BigDecimal.NEGATIVE_ONE.eq(-1)).toBe(true);
  });

  test('HALF', () => {
    expect(BigDecimal.HALF.toString()).toBe('0.5');
    expect(BigDecimal.HALF.eq(new BigDecimal('0.5'))).toBe(true);
  });

  test('NAN', () => {
    expect(BigDecimal.NAN.isNaN()).toBe(true);
  });

  test('POSITIVE_INFINITY', () => {
    expect(BigDecimal.POSITIVE_INFINITY.isFinite()).toBe(false);
    expect(BigDecimal.POSITIVE_INFINITY.toNumber()).toBe(Infinity);
  });

  test('NEGATIVE_INFINITY', () => {
    expect(BigDecimal.NEGATIVE_INFINITY.isFinite()).toBe(false);
    expect(BigDecimal.NEGATIVE_INFINITY.toNumber()).toBe(-Infinity);
    // isNegative works for -Infinity (significand < 0)
    expect(BigDecimal.NEGATIVE_INFINITY.isNegative()).toBe(true);
  });

  test('PI has correct digits', () => {
    expect(BigDecimal.PI.toString()).toMatch(/^3\.14159265358979323846/);
  });

  test('constants are frozen (immutable)', () => {
    expect(Object.isFrozen(BigDecimal.ZERO)).toBe(true);
    expect(Object.isFrozen(BigDecimal.ONE)).toBe(true);
    expect(Object.isFrozen(BigDecimal.NAN)).toBe(true);
    expect(Object.isFrozen(BigDecimal.PI)).toBe(false); // PI is lazy-computed, not frozen
  });

  test('precision getter/setter works', () => {
    const original = BigDecimal.precision;
    BigDecimal.precision = 100;
    expect(BigDecimal.precision).toBe(100);
    BigDecimal.precision = original; // restore
  });
});
