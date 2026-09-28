/**
 * The imaginary part of a big-decimal numeric value (`BigNumericValue`) is a
 * big decimal, as its real part is. It was a machine double, so an imaginary
 * part too small for a double (`10^{-800}`) read as `0`, one too large
 * (`10^{800}`) read as complex infinity, and every imaginary part had 16
 * digits where the real part had the working precision.
 *
 * Design: `docs/plans/2026-09-27-big-decimal-imaginary-part.md` (§1 table,
 * §2.3 kernels and the two regimes of the rounding-noise rule).
 *
 * Every expected value below was computed independently with Python
 * `mpmath` at 10 more digits than the working precision, then rounded to the
 * working precision (`mpmath.nstr(x, precision)`). For the values with a
 * simple closed form, the algebra is in the comment of the test.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { BigNumericValue } from '../../src/compute-engine/numeric-value/big-numeric-value';
import { MachineNumericValue } from '../../src/compute-engine/numeric-value/machine-numeric-value';
import type { NumericValue } from '../../src/compute-engine/numeric-value/types';

const ce = new ComputeEngine();

/** Run `fn` at the working precision `precision`, then restore it. */
function atPrecision<T>(precision: number, fn: () => T): T {
  const saved = ce.precision;
  try {
    ce.precision = precision;
    return fn();
  } finally {
    ce.precision = saved;
  }
}

const N = (latex: string) => ce.parse(latex).N().toString();

describe('THE §1 TABLE UNDER N(), 21 DIGITS', () => {
  test('the working precision is 21 digits', () =>
    expect(ce.precision).toBe(21));

  // (1+i)·10^800: each part is 10^800, a finite value beyond the double
  // range. It was complex infinity.
  test('(1+i)10^{800}', () =>
    expect(N('(1+i)10^{800}')).toBe('(1e+800 + 1e+800i)'));

  // (10^{-200}(1+i))^2 = 10^{-400}·(1+i)^2 = 10^{-400}·2i.
  test('(10^{-200}(1+i))^2', () =>
    expect(N('(10^{-200}(1+i))^2')).toBe('2e-400i'));

  // √(i·10^{-600}) = 10^{-300}·√i = 10^{-300}·(1+i)/√2. Check:
  // (7.07…e-301·(1+i))^2 = 2·(7.07…e-301)^2·i = 10^{-600}·i.
  // 1/√2 = 0.70710678118654752440084…, 21 digits: 7.07106781186547524401.
  // (The design note prints `7.0710678118654752440e-301`, which is 20
  // digits; the 21-digit rounding of …524400|84 is …524401.)
  test('\\sqrt{i\\cdot10^{-600}}', () =>
    expect(N('\\sqrt{i\\cdot10^{-600}}')).toBe(
      '(7.07106781186547524401e-301 + 7.07106781186547524401e-301i)'
    ));

  // e^{iε} = cos ε + i·sin ε = 1 + iε to far more than 21 digits for
  // ε = 10^{-800}.
  test('e^{i\\,10^{-800}}', () =>
    expect(N('e^{i\\,10^{-800}}')).toBe('(1 + 1e-800i)'));

  // √2 = 1.41421356237309504880168…, 21 digits: 1.41421356237309504880
  // (the trailing zero is not printed). The imaginary part had 17 digits.
  test('\\sqrt2+\\sqrt2 i', () =>
    expect(N('\\sqrt2+\\sqrt2 i')).toBe(
      '(1.4142135623730950488 + 1.4142135623730950488i)'
    ));
});

describe('THE §1 TABLE UNDER N(), 50 DIGITS', () => {
  test('(1+i)10^{800}', () =>
    atPrecision(50, () =>
      expect(N('(1+i)10^{800}')).toBe('(1e+800 + 1e+800i)')
    ));

  test('(10^{-200}(1+i))^2', () =>
    atPrecision(50, () => expect(N('(10^{-200}(1+i))^2')).toBe('2e-400i')));

  // 1/√2 to 50 digits: 0.70710678118654752440084436210484903928483593768847.
  test('\\sqrt{i\\cdot10^{-600}}', () =>
    atPrecision(50, () =>
      expect(N('\\sqrt{i\\cdot10^{-600}}')).toBe(
        '(7.0710678118654752440084436210484903928483593768847e-301 + 7.0710678118654752440084436210484903928483593768847e-301i)'
      )
    ));

  test('e^{i\\,10^{-800}}', () =>
    atPrecision(50, () =>
      expect(N('e^{i\\,10^{-800}}')).toBe('(1 + 1e-800i)')
    ));

  // √2 to 50 digits: 1.4142135623730950488016887242096980785696718753769.
  test('\\sqrt2+\\sqrt2 i', () =>
    atPrecision(50, () =>
      expect(N('\\sqrt2+\\sqrt2 i')).toBe(
        '(1.4142135623730950488016887242096980785696718753769 + 1.4142135623730950488016887242096980785696718753769i)'
      )
    ));
});

describe('THE TWO REGIMES OF THE ROUNDING-NOISE RULE', () => {
  // Small-component regime: exp(a + ib) = e^a·(1 + ib) for a small b.
  test('e^{i·10^{-800}} keeps its imaginary part (kernel)', () => {
    const z = new BigNumericValue({ re: 0, im: new BigDecimal('1e-800') });
    const r = z.exp();
    expect(r.bignumRe!.eq(1)).toBe(true);
    expect(r.bignumIm!.eq(new BigDecimal('1e-800'))).toBe(true);
  });

  // √(−1 + iε) for ε = ±10^{-800}. With m = |z| = 1 (to far more than 21
  // digits), the imaginary part is sign(ε)·√((m + 1)/2) = ±1 and the real
  // part is |ε|/(2·1) = 5·10^{-801}. The principal root has a non-negative
  // real part on both sides of the branch cut.
  test('\\sqrt{-1 + i·10^{-800}} (above the branch cut)', () =>
    expect(N('\\sqrt{-1+i\\cdot10^{-800}}')).toBe('(5e-801 + i)'));

  test('\\sqrt{-1 - i·10^{-800}} (below the branch cut)', () =>
    expect(N('\\sqrt{-1-i\\cdot10^{-800}}')).toBe('(5e-801 - i)'));

  // (1 + iε)^3 = 1 + 3iε − 3ε² − iε³ = 1 + 3·10^{-30}i at 21 digits for
  // ε = 10^{-30}. The chop at 10^{-14} of the modulus removed the
  // imaginary part.
  test('(1 + i·10^{-30})^3', () =>
    expect(N('(1+i\\cdot10^{-30})^3')).toBe('(1 + 3e-30i)'));

  test('(1 + i·10^{-30})^3 (kernel)', () => {
    const z = new BigNumericValue({ re: 1, im: new BigDecimal('1e-30') });
    const r = z.pow(3);
    expect(r.bignumRe!.eq(1)).toBe(true);
    expect(r.bignumIm!.eq(new BigDecimal('3e-30'))).toBe(true);
  });

  // ln(1 + iε) = ln|1 + iε| + i·atan(ε) = ε²/2 + i·(ε − ε³/3) = 5·10^{-61}
  // + 10^{-30}i. The real part is 10^{-31} times the imaginary part, below
  // the working precision of the result, so it prints as 0.
  test('\\ln(1 + i·10^{-30})', () =>
    expect(N('\\ln(1+i\\cdot10^{-30})')).toBe('1e-30i'));

  test('ln(1 + i·10^{-30}) (kernel)', () => {
    const z = new BigNumericValue({ re: 1, im: new BigDecimal('1e-30') });
    const r = z.ln();
    expect(r.bignumIm!.eq(new BigDecimal('1e-30'))).toBe(true);
  });

  // (ε + i)^2 = ε² − 1 + 2εi: the small real part gives the imaginary part
  // 2·10^{-30}, which the polar form (angle π/2 − 10^{-30}, rounded to π/2)
  // loses.
  test('(10^{-30} + i)^2 (kernel, small real part)', () => {
    const z = new BigNumericValue({ re: new BigDecimal('1e-30'), im: 1 });
    const r = z.pow(2);
    expect(r.bignumRe!.eq(-1)).toBe(true);
    expect(r.bignumIm!.eq(new BigDecimal('2e-30'))).toBe(true);
  });

  // Normal regime: the mathematically-zero part is exactly 0, not rounding
  // noise of size 10^{-21}.
  test('e^{iπ} is -1', () => expect(N('e^{i\\pi}')).toBe('-1'));

  test('e^{iπ} is -1 (kernel, π at the working precision)', () => {
    const r = new BigNumericValue({ re: 0, im: BigDecimal.PI }).exp();
    expect(r.bignumRe!.eq(-1)).toBe(true);
    expect(r.bignumIm!.isZero()).toBe(true);
    expect(r.isComplex).toBe(false);
  });

  test('e^{iπ/2} is i (kernel)', () => {
    const r = new BigNumericValue({
      re: 0,
      im: BigDecimal.PI.div(2),
    }).exp();
    expect(r.bignumRe!.isZero()).toBe(true);
    expect(r.bignumIm!.eq(1)).toBe(true);
  });

  test('((-1)^{1/2})^2 is -1', () => {
    expect(N('((-1)^{1/2})^2')).toBe('-1');
    const i = new BigNumericValue(-1).sqrt();
    expect(i.bignumRe!.isZero()).toBe(true);
    expect(i.bignumIm!.eq(1)).toBe(true);
    const r = i.pow(2);
    expect(r.bignumRe!.eq(-1)).toBe(true);
    expect(r.bignumIm!.isZero()).toBe(true);
  });

  test('\\sqrt{-4} is 2i', () => {
    expect(N('\\sqrt{-4}')).toBe('2i');
    const r = new BigNumericValue(-4).sqrt();
    expect(r.bignumRe!.isZero()).toBe(true);
    expect(r.bignumIm!.eq(2)).toBe(true);
  });

  // (1 + i)^4 = (2i)^2 = −4; (1 + i)^8 = 16. The polar form computes the
  // angle 4·π/4 = π and 8·π/4 = 2π, whose sine is rounding noise.
  test('(1 + i)^4 and (1 + i)^8 (kernel)', () => {
    const z = new BigNumericValue({ re: 1, im: 1 });
    const r4 = z.pow(4);
    expect(r4.bignumRe!.eq(-4)).toBe(true);
    expect(r4.bignumIm!.isZero()).toBe(true);
    const r8 = z.pow(8);
    expect(r8.bignumRe!.eq(16)).toBe(true);
    expect(r8.bignumIm!.isZero()).toBe(true);
  });

  // (10^{-6}i)^3 = −10^{-18}i: a small RESULT is not noise; the chop is
  // relative to the modulus of the result.
  test('(10^{-6}i)^3 is -10^{-18}i (kernel)', () => {
    const r = new BigNumericValue({ re: 0, im: new BigDecimal('1e-6') }).pow(3);
    expect(r.bignumRe!.isZero()).toBe(true);
    expect(r.bignumIm!.eq(new BigDecimal('-1e-18'))).toBe(true);
  });
});

describe('A FINITE IMAGINARY PART BEYOND THE DOUBLE RANGE', () => {
  const big = () => new BigNumericValue({ re: 0, im: new BigDecimal('1e800') });

  test('10^{800}i is not complex infinity', () => {
    const z = big();
    expect(z.isComplex).toBe(true);
    expect(z.isComplexInfinity).toBe(false);
    expect(z.type).toBe('imaginary');
    // The double projection is `Infinity`; it is only a projection.
    expect(z.im).toBe(Infinity);
  });

  test('10^{800}i prints its digits', () => {
    expect(big().toString()).toBe('1e+800i');
    expect(N('10^{800}i')).toBe('1e+800i');
  });

  test('10^{800}i multiplies correctly', () => {
    // 2·10^{800}i
    const twice = big().mul(2);
    expect(twice.bignumIm!.eq(new BigDecimal('2e800'))).toBe(true);
    // (10^{800}i)^2 = −10^{1600}
    const square = big().mul(big());
    expect(square.isComplex).toBe(false);
    expect(square.bignumRe!.eq(new BigDecimal('-1e1600'))).toBe(true);
    // (10^{800}i)(1 + i) = −10^{800} + 10^{800}i
    const turned = big().mul(new BigNumericValue({ re: 1, im: 1 }));
    expect(turned.bignumRe!.eq(new BigDecimal('-1e800'))).toBe(true);
    expect(turned.bignumIm!.eq(new BigDecimal('1e800'))).toBe(true);
    expect(N('10^{800}i\\cdot 2')).toBe('2e+800i');
  });
});

describe('eq IS SYMMETRIC ACROSS THE THREE CLASSES', () => {
  const exact = (re: number, im: number) =>
    ce._numericValue({ rational: [re, 1], imRational: [im, 1] });

  const cases: [string, () => NumericValue, () => NumericValue, boolean][] = [
    [
      'exact 1+i, big 1+i',
      () => exact(1, 1),
      () => new BigNumericValue({ re: 1, im: 1 }),
      true,
    ],
    [
      'exact 1+i, machine 1+i',
      () => exact(1, 1),
      () => new MachineNumericValue({ re: 1, im: 1 }),
      true,
    ],
    [
      'big 1+i, machine 1+i',
      () => new BigNumericValue({ re: 1, im: 1 }),
      () => new MachineNumericValue({ re: 1, im: 1 }),
      true,
    ],
    // The imaginary part 1 + 10^{-20} has the double projection 1.
    [
      'big 1+(1+10^{-20})i, machine 1+i',
      () =>
        new BigNumericValue({
          re: 1,
          im: new BigDecimal('1.00000000000000000001'),
        }),
      () => new MachineNumericValue({ re: 1, im: 1 }),
      false,
    ],
    [
      'big 1+(1+10^{-20})i, exact 1+i',
      () =>
        new BigNumericValue({
          re: 1,
          im: new BigDecimal('1.00000000000000000001'),
        }),
      () => exact(1, 1),
      false,
    ],
    // The imaginary part 10^{-800} has the double projection 0.
    [
      'big 10^{-800}i, machine 0',
      () => new BigNumericValue({ re: 0, im: new BigDecimal('1e-800') }),
      () => new MachineNumericValue(0),
      false,
    ],
    [
      'big 10^{-800}i, exact 10^{-800}i',
      () => new BigNumericValue({ re: 0, im: new BigDecimal('1e-800') }),
      () =>
        ce._numericValue({
          rational: [0, 1],
          imRational: [BigInt(1), BigInt(10) ** BigInt(800)],
        }),
      true,
    ],
    [
      'big 10^{800}i, machine ~oo',
      () => new BigNumericValue({ re: 0, im: new BigDecimal('1e800') }),
      () => new MachineNumericValue({ re: Infinity, im: Infinity }),
      false,
    ],
  ];

  test.each(cases)('%s', (_, a, b, expected) => {
    expect(a().eq(b())).toBe(expected);
    expect(b().eq(a())).toBe(expected);
  });
});

describe('THE MACHINE LANE PROJECTS A BIG-DECIMAL IMAGINARY PART', () => {
  test('a big-decimal imaginary part becomes the nearest double', () => {
    expect(
      new MachineNumericValue({ re: 1, im: new BigDecimal('0.25') }).im
    ).toBe(0.25);
    // 10^{-800} underflows to 0: the value is real in the machine lane.
    expect(
      new MachineNumericValue({ re: 1, im: new BigDecimal('1e-800') }).isComplex
    ).toBe(false);
  });
});

describe('THE COMPLEX POWER READS THE BIG-DECIMAL PARTS', () => {
  // The zero test of `complexPowN()` read the double projections `re` and
  // `im`, which are `0` and `0` for parts of size 10^{-800}, so the power
  // was `0`. It now reads the numeric value. Algebra:
  // |z| = √2·10^{-800}, arg z = π/4, so
  // z^{0.3} = 2^{0.15}·10^{-240}·(cos 0.075π + i·sin 0.075π).
  test('(10^{-800}(1+i))^{0.3} is not zero', () =>
    expect(N('(10^{-800}+10^{-800}i)^{0.3}')).toBe(
      '(1.07891197923030250263e-240 + 2.5902384913028295451e-241i)'
    ));

  // `complexNumericValueRoute()` converted each operand with `N()`, which
  // keeps the integer 2 exact, and `ExactNumericValue.pow` computes a
  // complex exponent in doubles, where 10^{-800} is 0: the result was `1`.
  // The operands are now inexact big decimals. Algebra:
  // 2^{iε} = e^{iε·ln 2} ≈ 1 + i·ε·ln 2 for ε = 10^{-800}.
  test('2^{i·10^{-800}} keeps its imaginary part', () =>
    expect(N('2^{i\\cdot10^{-800}}')).toBe(
      '(1 + 6.93147180559945309417e-801i)'
    ));

  test('a real power of a real integer is unchanged', () => {
    expect(N('2^{0.5}')).toBe('1.4142135623730950488');
    expect(N('2^{i}')).toBe(
      '(0.769238901363972126578 + 0.63896127631363480115i)'
    );
  });
});

describe('THE CARTESIAN INTEGER POWER KEEPS A SMALL PART', () => {
  // The integer power by repeated multiplication removed a part below
  // 10^{2-precision} times the larger part, as the polar kernels do. The
  // products of big decimals make no polar noise, so that part is the value:
  // with b = 1.00000000000000000001, (1 + ib)^2 = (1 - b²) + 2ib and
  // 1 - b² = -2.00000000000000000001e-20 at 21 digits (the exact value is
  // -(2e-20 + 1e-40)).
  test('z.pow(2) equals z.mul(z)', () => {
    const z = ce._numericValue({
      re: new BigDecimal('1'),
      im: new BigDecimal('1.00000000000000000001'),
    });
    const square = z.pow(2);
    expect(square.toString()).toBe(
      '(-2.00000000000000000001e-20 + 2.00000000000000000002i)'
    );
    expect(square.eq(z.mul(z))).toBe(true);
  });

  // A Gaussian integer operand gives exact parts: (1 + i)^2 = 2i and
  // (2i)^2 = -4, with an imaginary part that is exactly zero.
  test('(1+i)^4 is -4 with a zero imaginary part', () => {
    const z = ce._numericValue({
      re: new BigDecimal('1'),
      im: new BigDecimal('1'),
    });
    const p = z.pow(4);
    expect(p.bignumRe!.toString()).toBe('-4');
    expect(p.bignumIm!.isZero()).toBe(true);
    expect(N('(1+i)^4')).toBe('-4');
  });
});

/** Whether `actual` is within `10^{-38}` of `expected`, relative to
 * `scale` (the modulus of the result): a polar computation at 40 digits is
 * accurate compared with the modulus, to about one unit in the last place. */
function near(actual: BigDecimal, expected: string, scale: string): boolean {
  return actual
    .sub(new BigDecimal(expected))
    .abs()
    .lte(new BigDecimal(scale).mul(new BigDecimal('1e-38')));
}

describe('A REAL EXPONENT IS READ AS A BIG DECIMAL, 40 DIGITS', () => {
  // `BigNumericValue.pow` read a real exponent as its double, so every
  // digit past the 17th of the result was wrong, and `2.000000000000000000001`
  // became the integer `2`. Expected values: mpmath at 80 digits.
  const cases: [string, string, string, string][] = [
    [
      '(1+i)^{2/3}',
      '1.091123635971721403560072614189808881326',
      '0.6299605249474365823836053036391141752851',
      '1.26',
    ],
    [
      '(1.5+i)^{\\pi}',
      '-1.738453990117320062983322166241935179378',
      '6.127044851466640057880947806807650775729',
      '6.37',
    ],
    // (1+i)^{2+ε} = 2i·(1+i)^ε ≈ 2i·(1 + ε·(ln√2 + iπ/4)), so the real part
    // is -2·ε·π/4 = -(π/2)·10^{-21} and the imaginary part is
    // 2 + 2·ε·ln√2 = 2 + ln 2·10^{-21}.
    [
      '(1+i)^{2.000000000000000000001}',
      '-1.570796326794896619231866088162327342631e-21',
      '2.000000000000000000000693147180559945309',
      '2',
    ],
  ];
  test.each(cases)('%s', (latex, re, im, scale) =>
    atPrecision(40, () => {
      const value = ce.parse(latex).N().numericValue as NumericValue;
      expect(near(value.bignumRe!, re, scale)).toBe(true);
      expect(near(value.bignumIm!, im, scale)).toBe(true);
    })
  );
});

describe('AN INTEGER POWER BEYOND THE BIG-DECIMAL RANGE, 40 DIGITS', () => {
  // The repeated multiplication of `integerPower()` has no limit on the
  // exponent of the result, where `BigDecimal.pow` stops at a decimal
  // exponent of 9e15: `(1.1+i)^{10^{20}}` printed an exponent of about
  // 1.7e19. The magnitude is now estimated first: log10|1.1+i| ≈ 0.172, so
  // 10^{20}·0.172 is above 9e15 (complex infinity), and
  // log10|0.1+0.1i| ≈ -0.85 gives a result below 10^{-9e15} (zero).
  test('(1.1+i)^{10^{20}} is the complex infinity', () =>
    atPrecision(40, () => expect(N('(1.1+i)^{10^{20}}')).toBe('~oo')));
  test('(1.1+i)^{10^{100}} is the complex infinity', () =>
    atPrecision(40, () => expect(N('(1.1+i)^{10^{100}}')).toBe('~oo')));
  test('(0.1+0.1i)^{10^{20}} is zero', () =>
    atPrecision(40, () => expect(N('(0.1+0.1i)^{10^{20}}')).toBe('0')));
  // mpmath at 80 digits.
  test('(1.1+i)^{100} is finite and unchanged', () =>
    atPrecision(40, () =>
      expect(N('(1.1+i)^{100}')).toBe(
        '(-7611594738721149.100461911778183950762964 - 165636333937240014.1245510423840169985325i)'
      )
    ));
});

describe('A NEGATIVE REAL PART AND A NON-INTEGER EXPONENT', () => {
  // The argument of -4 + ib is sgn(b)·π + atan(b/(-4)). The polar form
  // rounded it to ±π and removed the small real part of the result as
  // noise. For n = 1.5:
  //   (-4 + ib)^{1.5} = 8·e^{±1.5πi}·e^{-1.5i·atan(b/4)}
  //                   ≈ ∓8i·(1 - 0.375i·b) = -3b ∓ 8i,
  // with a relative error of about b² (the next terms of the expansion).
  const cases: [string, string, string][] = [
    ['1e-800', '-3e-800', '-8'],
    ['-1e-800', '-3e-800', '8'],
    ['1e-30', '-3e-30', '-8'],
    ['-1e-30', '-3e-30', '8'],
  ];
  test.each(cases)('(-4 + %si)^{1.5} at 40 digits', (b, re, im) =>
    atPrecision(40, () => {
      const value = new BigNumericValue({
        re: new BigDecimal(-4),
        im: new BigDecimal(b),
      }).pow(1.5);
      expect(value.bignumRe.eq(new BigDecimal(re))).toBe(true);
      expect(value.bignumIm.eq(new BigDecimal(im))).toBe(true);
    })
  );

  // A case in the normal regime, compared with mpmath at 80 digits.
  test('(-1 - 0.001i)^{1.5} at 40 digits', () =>
    atPrecision(40, () =>
      expect(
        new BigNumericValue({
          re: new BigDecimal(-1),
          im: new BigDecimal('-0.001'),
        })
          .pow(1.5)
          .toString()
      ).toBe(
        '(-0.001500000062499988281254394529067994428634 + 0.9999996250000234374931640655212385978709i)'
      )
    ));
});
