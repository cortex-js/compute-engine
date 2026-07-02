import { BigDecimal } from '../../src/big-decimal';

// Save and restore precision around tests
const DEFAULT_PRECISION = 50;

beforeEach(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});

afterAll(() => {
  BigDecimal.precision = DEFAULT_PRECISION;
});

// ================================================================
// sqrt
// ================================================================

describe('BigDecimal sqrt', () => {
  test('sqrt(4) = 2', () => {
    const result = new BigDecimal('4').sqrt();
    expect(result.eq(new BigDecimal('2'))).toBe(true);
  });

  test('sqrt(1) = 1', () => {
    const result = new BigDecimal('1').sqrt();
    expect(result.eq(new BigDecimal('1'))).toBe(true);
  });

  test('sqrt(0) = 0', () => {
    const result = new BigDecimal('0').sqrt();
    expect(result.isZero()).toBe(true);
  });

  test('sqrt(9) = 3', () => {
    const result = new BigDecimal('9').sqrt();
    expect(result.eq(new BigDecimal('3'))).toBe(true);
  });

  test('sqrt(100) = 10', () => {
    const result = new BigDecimal('100').sqrt();
    expect(result.eq(new BigDecimal('10'))).toBe(true);
  });

  test('sqrt(0.25) = 0.5', () => {
    const result = new BigDecimal('0.25').sqrt();
    expect(result.eq(new BigDecimal('0.5'))).toBe(true);
  });

  test('sqrt(2) starts with 1.41421356...', () => {
    const result = new BigDecimal('2').sqrt();
    const str = result.toString();
    expect(str.startsWith('1.4142135623730950488')).toBe(true);
  });

  test('sqrt(3) starts with 1.73205...', () => {
    const result = new BigDecimal('3').sqrt();
    const str = result.toString();
    expect(str.startsWith('1.7320508')).toBe(true);
  });

  test('sqrt(negative) = NaN', () => {
    expect(new BigDecimal('-1').sqrt().isNaN()).toBe(true);
    expect(new BigDecimal('-0.5').sqrt().isNaN()).toBe(true);
  });

  test('sqrt(NaN) = NaN', () => {
    expect(BigDecimal.NAN.sqrt().isNaN()).toBe(true);
  });

  test('sqrt(+Infinity) = +Infinity', () => {
    const result = BigDecimal.POSITIVE_INFINITY.sqrt();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand > 0n).toBe(true);
  });

  test('sqrt(-Infinity) = NaN', () => {
    expect(BigDecimal.NEGATIVE_INFINITY.sqrt().isNaN()).toBe(true);
  });

  test('sqrt(2) squared is close to 2', () => {
    const sqrtTwo = new BigDecimal('2').sqrt();
    const squared = sqrtTwo.mul(sqrtTwo);
    const diff = squared.sub(new BigDecimal('2')).abs();
    // At precision 50, the error should be vanishingly small
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('high precision sqrt(2)', () => {
    BigDecimal.precision = 200;
    const result = new BigDecimal('2').sqrt();
    const squared = result.mul(result);
    const diff = squared.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-195'))).toBe(true);
  });

  test('sqrt of small number', () => {
    // sqrt(0.0001) = 0.01
    const result = new BigDecimal('0.0001').sqrt();
    expect(result.eq(new BigDecimal('0.01'))).toBe(true);
  });

  test('sqrt of large number', () => {
    // sqrt(1000000) = 1000
    const result = new BigDecimal('1000000').sqrt();
    expect(result.eq(new BigDecimal('1000'))).toBe(true);
  });

  test('static BigDecimal.sqrt works', () => {
    const result = BigDecimal.sqrt(new BigDecimal('4'));
    expect(result.eq(new BigDecimal('2'))).toBe(true);
  });
});

// ================================================================
// cbrt
// ================================================================

describe('BigDecimal cbrt', () => {
  test('cbrt(8) = 2', () => {
    const result = new BigDecimal('8').cbrt();
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cbrt(27) = 3', () => {
    const result = new BigDecimal('27').cbrt();
    const diff = result.sub(new BigDecimal('3')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cbrt(1) = 1', () => {
    const result = new BigDecimal('1').cbrt();
    const diff = result.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cbrt(0) = 0', () => {
    const result = new BigDecimal('0').cbrt();
    expect(result.isZero()).toBe(true);
  });

  test('cbrt(-8) = -2', () => {
    const result = new BigDecimal('-8').cbrt();
    const diff = result.sub(new BigDecimal('-2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cbrt(-27) = -3', () => {
    const result = new BigDecimal('-27').cbrt();
    const diff = result.sub(new BigDecimal('-3')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cbrt(2) starts with 1.2599...', () => {
    const result = new BigDecimal('2').cbrt();
    const str = result.toString();
    expect(str.startsWith('1.2599')).toBe(true);
  });

  test('cbrt(NaN) = NaN', () => {
    expect(BigDecimal.NAN.cbrt().isNaN()).toBe(true);
  });

  test('cbrt(+Infinity) = +Infinity', () => {
    const result = BigDecimal.POSITIVE_INFINITY.cbrt();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand > 0n).toBe(true);
  });

  test('cbrt(-Infinity) = -Infinity', () => {
    const result = BigDecimal.NEGATIVE_INFINITY.cbrt();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand < 0n).toBe(true);
  });

  test('cbrt(2) cubed is close to 2', () => {
    const cbrtTwo = new BigDecimal('2').cbrt();
    const cubed = cbrtTwo.mul(cbrtTwo).mul(cbrtTwo);
    const diff = cubed.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('high precision cbrt(2)', () => {
    BigDecimal.precision = 200;
    const result = new BigDecimal('2').cbrt();
    const cubed = result.mul(result).mul(result);
    const diff = cubed.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-190'))).toBe(true);
  });

  test('cbrt(0.001) = 0.1', () => {
    const result = new BigDecimal('0.001').cbrt();
    const diff = result.sub(new BigDecimal('0.1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cbrt(1000000) = 100', () => {
    const result = new BigDecimal('1000000').cbrt();
    const diff = result.sub(new BigDecimal('100')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('static BigDecimal.cbrt works', () => {
    const result = BigDecimal.cbrt(new BigDecimal('8'));
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });
});

// ================================================================
// exp
// ================================================================

describe('BigDecimal exp', () => {
  test('exp(0) = 1', () => {
    expect(new BigDecimal('0').exp().eq(1)).toBe(true);
  });

  test('exp(1) ≈ 2.71828182845...', () => {
    const result = new BigDecimal('1').exp();
    expect(result.toString()).toMatch(/^2\.718281828459045/);
  });

  test('exp(-1) ≈ 0.36787944117...', () => {
    const result = new BigDecimal('-1').exp();
    expect(result.toString()).toMatch(/^0\.3678794411714/);
  });

  test('exp(10)', () => {
    const result = new BigDecimal('10').exp();
    expect(result.toString()).toMatch(/^22026\.46579/);
  });

  test('exp(NaN) = NaN', () => {
    expect(new BigDecimal(NaN).exp().isNaN()).toBe(true);
  });

  test('exp(+Inf) = +Inf', () => {
    const result = new BigDecimal(Infinity).exp();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand > 0n).toBe(true);
  });

  test('exp(-Inf) = 0', () => {
    expect(new BigDecimal(-Infinity).exp().isZero()).toBe(true);
  });

  test('exp(0.5)', () => {
    const result = new BigDecimal('0.5').exp();
    // e^0.5 ≈ 1.6487212707
    expect(result.toString()).toMatch(/^1\.648721270700/);
  });

  test('exp(-5)', () => {
    const result = new BigDecimal('-5').exp();
    // e^-5 ≈ 0.006737946999
    expect(result.toString()).toMatch(/^0\.006737946/);
  });

  test('exp(x) * exp(-x) ≈ 1', () => {
    const x = new BigDecimal('3.7');
    const product = x.exp().mul(x.neg().exp());
    const diff = product.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  // REVIEW.md D6: the fixed-point bridge used absolute precision, so a very
  // negative argument produced a result below the grid and rounded to 0.
  // Range reduction (factor out the decimal exponent via ln 10) recovers it.
  test('exp of large-magnitude negative does not underflow to 0 (D6)', () => {
    // e^-80 ≈ 1.804851387845415e-35
    const e80 = new BigDecimal('-80').exp();
    expect(e80.isZero()).toBe(false);
    expect(e80.toString()).toMatch(/^1\.8048513878454151/);

    // e^-200 ≈ 1.383896526736737e-87
    const e200 = new BigDecimal('-200').exp();
    expect(e200.isZero()).toBe(false);
    expect(e200.toString()).toMatch(/^1\.383896526736737/);

    // Round-trip: exp then ln recovers the argument to full precision.
    const back = e200.ln();
    expect(back.sub(new BigDecimal('-200')).abs().lt(new BigDecimal('1e-45'))).toBe(
      true
    );
  });

  test('exp of large-magnitude positive keeps full precision (D6)', () => {
    // e^200 ≈ 7.225973768125749e86
    const result = new BigDecimal('200').exp();
    expect(result.toString()).toMatch(/^7\.225973768125749/);
  });

  test('high precision exp(1)', () => {
    BigDecimal.precision = 200;
    const result = new BigDecimal('1').exp();
    expect(result.toString()).toMatch(
      /^2\.71828182845904523536028747135266249775724709369995/
    );
  });

  test('static BigDecimal.exp works', () => {
    const result = BigDecimal.exp(new BigDecimal('0'));
    expect(result.eq(1)).toBe(true);
  });
});

// ================================================================
// ln
// ================================================================

describe('BigDecimal ln', () => {
  test('ln(1) = 0', () => {
    const result = new BigDecimal('1').ln();
    expect(result.isZero()).toBe(true);
  });

  test('ln(e) ≈ 1', () => {
    const e = new BigDecimal('1').exp();
    const result = e.ln();
    const diff = result.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('exp(ln(x)) ≈ x', () => {
    const x = new BigDecimal('42.5');
    const result = x.ln().exp();
    const diff = result.sub(x).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('ln(exp(x)) ≈ x', () => {
    const x = new BigDecimal('7.3');
    const result = x.exp().ln();
    const diff = result.sub(x).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('ln(2) ≈ 0.693147...', () => {
    const result = new BigDecimal('2').ln();
    expect(result.toString()).toMatch(/^0\.69314718055994/);
  });

  test('ln(10) ≈ 2.302585...', () => {
    const result = new BigDecimal('10').ln();
    expect(result.toString()).toMatch(/^2\.302585092994/);
  });

  // REVIEW.md D6: a very small input underflowed its fixed-point representation
  // to 0, which returned -Infinity (and previously hung forever in the
  // sqrt-reduction loop, since `fpsqrt(0) = 0`). Range reduction keeps the
  // kernel input in [1, 10).
  test('ln of a tiny value terminates with the correct value (D6)', () => {
    // ln(1e-100) = -230.2585092994046...
    const result = new BigDecimal('1e-100').ln();
    expect(result.isFinite()).toBe(true);
    expect(result.toString()).toMatch(/^-230\.2585092994045684/);

    // Symmetric large input.
    expect(new BigDecimal('1e100').ln().toString()).toMatch(
      /^230\.2585092994045684/
    );

    // ln(1e-100) = -100 · ln(10).
    const expected = new BigDecimal('10').ln().mul(-100);
    expect(result.sub(expected).abs().lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('ln(0) = -Infinity', () => {
    const result = new BigDecimal('0').ln();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand < 0n).toBe(true);
  });

  test('ln(negative) = NaN', () => {
    expect(new BigDecimal('-1').ln().isNaN()).toBe(true);
    expect(new BigDecimal('-0.5').ln().isNaN()).toBe(true);
  });

  test('ln(NaN) = NaN', () => {
    expect(new BigDecimal(NaN).ln().isNaN()).toBe(true);
  });

  test('ln(+Inf) = +Inf', () => {
    const result = new BigDecimal(Infinity).ln();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand > 0n).toBe(true);
  });

  test('ln(-Inf) = NaN', () => {
    expect(new BigDecimal(-Infinity).ln().isNaN()).toBe(true);
  });

  test('ln(0.5) ≈ -0.693147...', () => {
    const result = new BigDecimal('0.5').ln();
    // ln(0.5) = -ln(2)
    expect(result.toString()).toMatch(/^-0\.69314718055994/);
  });

  test('ln(a*b) ≈ ln(a) + ln(b)', () => {
    const a = new BigDecimal('3.14');
    const b = new BigDecimal('2.72');
    const lnProduct = a.mul(b).ln();
    const sumLn = a.ln().add(b.ln());
    const diff = lnProduct.sub(sumLn).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('high precision ln(2)', () => {
    BigDecimal.precision = 200;
    const result = new BigDecimal('2').ln();
    expect(result.toString()).toMatch(
      /^0\.69314718055994530941723212145817656807550013436025/
    );
  });

  test('static BigDecimal.ln works', () => {
    const result = BigDecimal.ln(new BigDecimal('1'));
    expect(result.isZero()).toBe(true);
  });
});

// ================================================================
// log (arbitrary base) and log10
// ================================================================

describe('BigDecimal log', () => {
  test('log base 10 of 1000 ≈ 3', () => {
    const result = new BigDecimal('1000').log(10);
    const diff = result.sub(new BigDecimal('3')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('log base 10 of 100 ≈ 2', () => {
    const result = new BigDecimal('100').log(10);
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('log base 2 of 8 ≈ 3', () => {
    const result = new BigDecimal('8').log(2);
    const diff = result.sub(new BigDecimal('3')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('log base 2 of 1024 ≈ 10', () => {
    const result = new BigDecimal('1024').log(2);
    const diff = result.sub(new BigDecimal('10')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('BigDecimal.log10(100) ≈ 2', () => {
    const result = BigDecimal.log10(new BigDecimal('100'));
    const diff = result.sub(new BigDecimal('2')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('BigDecimal.log10(1) = 0', () => {
    const result = BigDecimal.log10(new BigDecimal('1'));
    expect(result.isZero()).toBe(true);
  });

  test('BigDecimal.log10(10) ≈ 1', () => {
    const result = BigDecimal.log10(new BigDecimal('10'));
    const diff = result.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });
});

// ================================================================
// sin
// ================================================================

describe('BigDecimal sin', () => {
  test('sin(0) = 0', () => {
    expect(new BigDecimal('0').sin().isZero()).toBe(true);
  });

  test('sin(π/2) ≈ 1', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const diff = piHalf.sin().sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin(π) ≈ 0', () => {
    const diff = BigDecimal.PI.sin().abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin(3π/2) ≈ -1', () => {
    const threePiHalf = BigDecimal.PI.mul(new BigDecimal('3')).div(new BigDecimal('2'));
    const diff = threePiHalf.sin().sub(new BigDecimal('-1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin(2π) ≈ 0', () => {
    const twoPi = BigDecimal.PI.mul(new BigDecimal('2'));
    const diff = twoPi.sin().abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin(π/6) ≈ 0.5', () => {
    const piSixth = BigDecimal.PI.div(new BigDecimal('6'));
    const diff = piSixth.sin().sub(new BigDecimal('0.5')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin(-x) = -sin(x)', () => {
    const x = new BigDecimal('1.234');
    const sinX = x.sin();
    const sinNegX = x.neg().sin();
    const diff = sinX.add(sinNegX).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin²(x) + cos²(x) ≈ 1', () => {
    const x = new BigDecimal('1.234');
    const s = x.sin();
    const c = x.cos();
    const sum = s.mul(s).add(c.mul(c));
    const diff = sum.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin(NaN) = NaN', () => {
    expect(BigDecimal.NAN.sin().isNaN()).toBe(true);
  });

  test('sin(+Infinity) = NaN', () => {
    expect(BigDecimal.POSITIVE_INFINITY.sin().isNaN()).toBe(true);
  });

  test('sin(-Infinity) = NaN', () => {
    expect(BigDecimal.NEGATIVE_INFINITY.sin().isNaN()).toBe(true);
  });

  test('sin(large angle) via reduction', () => {
    // sin(100) should work correctly via argument reduction
    const result = new BigDecimal('100').sin();
    // sin(100) ≈ -0.50636564...
    const expected = new BigDecimal('-0.506365641109759');
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-14'))).toBe(true);
  });

  test('sin(negative large angle)', () => {
    // sin(-7) ≈ -0.6569865987...
    const result = new BigDecimal('-7').sin();
    const expected = new BigDecimal('-0.6569865987');
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-9'))).toBe(true);
  });

  test('static BigDecimal.sin works', () => {
    expect(BigDecimal.sin(new BigDecimal('0')).isZero()).toBe(true);
  });
});

// ================================================================
// cos
// ================================================================

describe('BigDecimal cos', () => {
  test('cos(0) = 1', () => {
    expect(new BigDecimal('0').cos().eq(1)).toBe(true);
  });

  test('cos(π/2) ≈ 0', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const diff = piHalf.cos().abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cos(π) ≈ -1', () => {
    const diff = BigDecimal.PI.cos().sub(new BigDecimal('-1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cos(2π) ≈ 1', () => {
    const twoPi = BigDecimal.PI.mul(new BigDecimal('2'));
    const diff = twoPi.cos().sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cos(π/3) ≈ 0.5', () => {
    const piThird = BigDecimal.PI.div(new BigDecimal('3'));
    const diff = piThird.cos().sub(new BigDecimal('0.5')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cos(-x) = cos(x)', () => {
    const x = new BigDecimal('2.345');
    const cosX = x.cos();
    const cosNegX = x.neg().cos();
    const diff = cosX.sub(cosNegX).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cos(NaN) = NaN', () => {
    expect(BigDecimal.NAN.cos().isNaN()).toBe(true);
  });

  test('cos(+Infinity) = NaN', () => {
    expect(BigDecimal.POSITIVE_INFINITY.cos().isNaN()).toBe(true);
  });

  test('cos(-Infinity) = NaN', () => {
    expect(BigDecimal.NEGATIVE_INFINITY.cos().isNaN()).toBe(true);
  });

  test('static BigDecimal.cos works', () => {
    expect(BigDecimal.cos(new BigDecimal('0')).eq(1)).toBe(true);
  });
});

// ================================================================
// tan
// ================================================================

describe('BigDecimal tan', () => {
  test('tan(0) = 0', () => {
    expect(new BigDecimal('0').tan().isZero()).toBe(true);
  });

  test('tan(π/4) ≈ 1', () => {
    const piFourth = BigDecimal.PI.div(new BigDecimal('4'));
    const diff = piFourth.tan().sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tan(π) ≈ 0', () => {
    const diff = BigDecimal.PI.tan().abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tan(x) = sin(x)/cos(x)', () => {
    const x = new BigDecimal('0.7');
    const tanX = x.tan();
    const ratio = x.sin().div(x.cos());
    const diff = tanX.sub(ratio).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tan(-x) = -tan(x)', () => {
    const x = new BigDecimal('0.5');
    const tanX = x.tan();
    const tanNegX = x.neg().tan();
    const diff = tanX.add(tanNegX).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tan(NaN) = NaN', () => {
    expect(BigDecimal.NAN.tan().isNaN()).toBe(true);
  });

  test('tan(+Infinity) = NaN', () => {
    expect(BigDecimal.POSITIVE_INFINITY.tan().isNaN()).toBe(true);
  });

  test('tan(-Infinity) = NaN', () => {
    expect(BigDecimal.NEGATIVE_INFINITY.tan().isNaN()).toBe(true);
  });

  test('static BigDecimal.tan works', () => {
    expect(BigDecimal.tan(new BigDecimal('0')).isZero()).toBe(true);
  });
});

// ================================================================
// atan
// ================================================================

describe('BigDecimal atan', () => {
  test('atan(0) = 0', () => {
    expect(new BigDecimal('0').atan().isZero()).toBe(true);
  });

  test('atan(1) ≈ π/4', () => {
    const piFourth = BigDecimal.PI.div(new BigDecimal('4'));
    const diff = new BigDecimal('1').atan().sub(piFourth).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan(-1) ≈ -π/4', () => {
    const negPiFourth = BigDecimal.PI.div(new BigDecimal('4')).neg();
    const diff = new BigDecimal('-1').atan().sub(negPiFourth).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan(+Inf) = π/2', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const diff = BigDecimal.POSITIVE_INFINITY.atan().sub(piHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan(-Inf) = -π/2', () => {
    const negPiHalf = BigDecimal.PI.div(new BigDecimal('2')).neg();
    const diff = BigDecimal.NEGATIVE_INFINITY.atan().sub(negPiHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan(NaN) = NaN', () => {
    expect(BigDecimal.NAN.atan().isNaN()).toBe(true);
  });

  test('atan(tan(x)) ≈ x for x in (-π/2, π/2)', () => {
    const x = new BigDecimal('0.7');
    const diff = x.tan().atan().sub(x).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan(-x) = -atan(x)', () => {
    const x = new BigDecimal('2.5');
    const diff = x.atan().add(x.neg().atan()).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan(large value) close to π/2', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const result = new BigDecimal('1000').atan();
    const diff = result.sub(piHalf).abs();
    expect(diff.lt(new BigDecimal('0.002'))).toBe(true);
  });

  test('static BigDecimal.atan works', () => {
    expect(BigDecimal.atan(new BigDecimal('0')).isZero()).toBe(true);
  });
});

// ================================================================
// asin
// ================================================================

describe('BigDecimal asin', () => {
  test('asin(0) = 0', () => {
    expect(new BigDecimal('0').asin().isZero()).toBe(true);
  });

  test('asin(1) ≈ π/2', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const diff = new BigDecimal('1').asin().sub(piHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('asin(-1) ≈ -π/2', () => {
    const negPiHalf = BigDecimal.PI.div(new BigDecimal('2')).neg();
    const diff = new BigDecimal('-1').asin().sub(negPiHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('asin(0.5) ≈ π/6', () => {
    const piSixth = BigDecimal.PI.div(new BigDecimal('6'));
    const diff = new BigDecimal('0.5').asin().sub(piSixth).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sin(asin(x)) ≈ x', () => {
    const x = new BigDecimal('0.3');
    const diff = x.asin().sin().sub(x).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('asin(2) = NaN (out of range)', () => {
    expect(new BigDecimal('2').asin().isNaN()).toBe(true);
  });

  test('asin(-2) = NaN (out of range)', () => {
    expect(new BigDecimal('-2').asin().isNaN()).toBe(true);
  });

  test('asin(NaN) = NaN', () => {
    expect(BigDecimal.NAN.asin().isNaN()).toBe(true);
  });

  test('asin(+Inf) = NaN', () => {
    expect(BigDecimal.POSITIVE_INFINITY.asin().isNaN()).toBe(true);
  });

  test('asin(-x) = -asin(x)', () => {
    const x = new BigDecimal('0.7');
    const diff = x.asin().add(x.neg().asin()).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('static BigDecimal.asin works', () => {
    expect(BigDecimal.asin(new BigDecimal('0')).isZero()).toBe(true);
  });
});

// ================================================================
// acos
// ================================================================

describe('BigDecimal acos', () => {
  test('acos(1) ≈ 0', () => {
    const diff = new BigDecimal('1').acos().abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('acos(-1) ≈ π', () => {
    const diff = new BigDecimal('-1').acos().sub(BigDecimal.PI).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('acos(0) ≈ π/2', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const diff = new BigDecimal('0').acos().sub(piHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('acos(0.5) ≈ π/3', () => {
    const piThird = BigDecimal.PI.div(new BigDecimal('3'));
    const diff = new BigDecimal('0.5').acos().sub(piThird).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cos(acos(x)) ≈ x', () => {
    const x = new BigDecimal('0.6');
    const diff = x.acos().cos().sub(x).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('acos(2) = NaN (out of range)', () => {
    expect(new BigDecimal('2').acos().isNaN()).toBe(true);
  });

  test('acos(NaN) = NaN', () => {
    expect(BigDecimal.NAN.acos().isNaN()).toBe(true);
  });

  test('acos(+Inf) = NaN', () => {
    expect(BigDecimal.POSITIVE_INFINITY.acos().isNaN()).toBe(true);
  });

  test('asin(x) + acos(x) ≈ π/2', () => {
    const x = new BigDecimal('0.4');
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const sum = x.asin().add(x.acos());
    const diff = sum.sub(piHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('static BigDecimal.acos works', () => {
    const diff = BigDecimal.acos(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });
});

// ================================================================
// atan2
// ================================================================

describe('BigDecimal.atan2', () => {
  test('atan2(0, 1) = 0', () => {
    const result = BigDecimal.atan2(new BigDecimal('0'), new BigDecimal('1'));
    expect(result.isZero()).toBe(true);
  });

  test('atan2(1, 1) ≈ π/4', () => {
    const piFourth = BigDecimal.PI.div(new BigDecimal('4'));
    const result = BigDecimal.atan2(new BigDecimal('1'), new BigDecimal('1'));
    const diff = result.sub(piFourth).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2(1, 0) ≈ π/2', () => {
    const piHalf = BigDecimal.PI.div(new BigDecimal('2'));
    const result = BigDecimal.atan2(new BigDecimal('1'), new BigDecimal('0'));
    const diff = result.sub(piHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2(-1, 0) ≈ -π/2', () => {
    const negPiHalf = BigDecimal.PI.div(new BigDecimal('2')).neg();
    const result = BigDecimal.atan2(new BigDecimal('-1'), new BigDecimal('0'));
    const diff = result.sub(negPiHalf).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2(0, -1) ≈ π', () => {
    const result = BigDecimal.atan2(new BigDecimal('0'), new BigDecimal('-1'));
    const diff = result.sub(BigDecimal.PI).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2(0, 0) = 0', () => {
    const result = BigDecimal.atan2(new BigDecimal('0'), new BigDecimal('0'));
    expect(result.isZero()).toBe(true);
  });

  test('atan2(-1, -1) ≈ -3π/4', () => {
    const expected = BigDecimal.PI.mul(new BigDecimal('3')).div(new BigDecimal('4')).neg();
    const result = BigDecimal.atan2(new BigDecimal('-1'), new BigDecimal('-1'));
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2(1, -1) ≈ 3π/4', () => {
    const expected = BigDecimal.PI.mul(new BigDecimal('3')).div(new BigDecimal('4'));
    const result = BigDecimal.atan2(new BigDecimal('1'), new BigDecimal('-1'));
    const diff = result.sub(expected).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2 with number y argument', () => {
    const result = BigDecimal.atan2(1, new BigDecimal('1'));
    const piFourth = BigDecimal.PI.div(new BigDecimal('4'));
    const diff = result.sub(piFourth).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('atan2(NaN, x) = NaN', () => {
    expect(BigDecimal.atan2(BigDecimal.NAN, new BigDecimal('1')).isNaN()).toBe(true);
  });

  test('atan2(y, NaN) = NaN', () => {
    expect(BigDecimal.atan2(new BigDecimal('1'), BigDecimal.NAN).isNaN()).toBe(true);
  });
});

// ================================================================
// sinh
// ================================================================

describe('BigDecimal sinh', () => {
  test('sinh(0) = 0', () => {
    expect(new BigDecimal('0').sinh().isZero()).toBe(true);
  });

  test('sinh(1) starts with 1.17520...', () => {
    const result = new BigDecimal('1').sinh();
    expect(result.toString()).toMatch(/^1\.17520119364380/);
  });

  test('sinh(-1) starts with -1.17520...', () => {
    const result = new BigDecimal('-1').sinh();
    expect(result.toString()).toMatch(/^-1\.17520119364380/);
  });

  test('sinh(-x) = -sinh(x) (odd function)', () => {
    const x = new BigDecimal('2.5');
    const diff = x.sinh().add(x.neg().sinh()).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('sinh(NaN) = NaN', () => {
    expect(BigDecimal.NAN.sinh().isNaN()).toBe(true);
  });

  test('sinh(+Inf) = +Inf', () => {
    const result = BigDecimal.POSITIVE_INFINITY.sinh();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand > 0n).toBe(true);
  });

  test('sinh(-Inf) = -Inf', () => {
    const result = BigDecimal.NEGATIVE_INFINITY.sinh();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand < 0n).toBe(true);
  });

  test('static BigDecimal.sinh works', () => {
    expect(BigDecimal.sinh(new BigDecimal('0')).isZero()).toBe(true);
  });
});

// ================================================================
// cosh
// ================================================================

describe('BigDecimal cosh', () => {
  test('cosh(0) = 1', () => {
    expect(new BigDecimal('0').cosh().eq(1)).toBe(true);
  });

  test('cosh(1) starts with 1.54308...', () => {
    const result = new BigDecimal('1').cosh();
    expect(result.toString()).toMatch(/^1\.54308063481524/);
  });

  test('cosh(-x) = cosh(x) (even function)', () => {
    const x = new BigDecimal('2.5');
    const diff = x.cosh().sub(x.neg().cosh()).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('cosh(NaN) = NaN', () => {
    expect(BigDecimal.NAN.cosh().isNaN()).toBe(true);
  });

  test('cosh(+Inf) = +Inf', () => {
    const result = BigDecimal.POSITIVE_INFINITY.cosh();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand > 0n).toBe(true);
  });

  test('cosh(-Inf) = +Inf (even function)', () => {
    const result = BigDecimal.NEGATIVE_INFINITY.cosh();
    expect(result.isFinite()).toBe(false);
    expect(result.isNaN()).toBe(false);
    expect(result.significand > 0n).toBe(true);
  });

  test('static BigDecimal.cosh works', () => {
    expect(BigDecimal.cosh(new BigDecimal('0')).eq(1)).toBe(true);
  });
});

// ================================================================
// tanh
// ================================================================

describe('BigDecimal tanh', () => {
  test('tanh(0) = 0', () => {
    expect(new BigDecimal('0').tanh().isZero()).toBe(true);
  });

  test('tanh(1) starts with 0.76159...', () => {
    const result = new BigDecimal('1').tanh();
    expect(result.toString()).toMatch(/^0\.76159415595576/);
  });

  test('tanh(-x) = -tanh(x) (odd function)', () => {
    const x = new BigDecimal('1.5');
    const diff = x.tanh().add(x.neg().tanh()).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tanh(NaN) = NaN', () => {
    expect(BigDecimal.NAN.tanh().isNaN()).toBe(true);
  });

  test('tanh(+Inf) = 1', () => {
    const result = BigDecimal.POSITIVE_INFINITY.tanh();
    expect(result.eq(1)).toBe(true);
  });

  test('tanh(-Inf) = -1', () => {
    const result = BigDecimal.NEGATIVE_INFINITY.tanh();
    expect(result.eq(-1)).toBe(true);
  });

  test('cosh²(x) - sinh²(x) = 1', () => {
    const x = new BigDecimal('2');
    const s = x.sinh(), c = x.cosh();
    const diff = c.mul(c).sub(s.mul(s)).sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tanh(x) = sinh(x) / cosh(x)', () => {
    const x = new BigDecimal('1');
    const diff = x.tanh().sub(x.sinh().div(x.cosh())).abs();
    expect(diff.lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('tanh large positive ≈ 1', () => {
    const result = new BigDecimal('50').tanh();
    const diff = result.sub(new BigDecimal('1')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('tanh large negative ≈ -1', () => {
    const result = new BigDecimal('-50').tanh();
    const diff = result.sub(new BigDecimal('-1')).abs();
    expect(diff.lt(new BigDecimal('1e-40'))).toBe(true);
  });

  test('static BigDecimal.tanh works', () => {
    expect(BigDecimal.tanh(new BigDecimal('0')).isZero()).toBe(true);
  });
});

// ================================================================
// D6: range reduction across the fixed-point bridge
// ================================================================
//
// REVIEW.md D6: the fixed-point bridge (`toFixedPoint`) is an
// *absolute*-precision grid, so arguments/results far from 1 used to
// underflow to an exact 0 (exp(-200) → 0, sqrt(1e-100) → 0, sin(1e-100) → 0)
// or silently lose leading digits, and ln of a tiny value hung forever
// (`fpsqrt(0) = 0` infinite loop). The fix factors the decimal exponent out
// of the argument before the kernel: exp(x) = exp(r)·10^k (r ∈ [0, ln 10)),
// ln(x) = ln(m) + e·ln 10 (m ∈ [1, 10)), sqrt(x) = sqrt(m)·10^k
// (m ∈ [1, 100)), cbrt(x) = cbrt(m)·10^k (m ∈ [1, 1000)). Small
// trig/hyperbolic arguments short-circuit (f(x) = x·(1 + O(x²)) rounds to x)
// or compensate the lost leading digits in the working precision.

/** Number of matching leading significant digits between two decimal strings. */
function digitsAgree(a: string, b: string): number {
  const norm = (s: string) => s.replace('-', '').replace('.', '').split('e')[0];
  const [x, y] = [norm(a), norm(b)];
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i;
}

/** Decimal exponent of a finite non-zero value: |x| ∈ [10^e, 10^(e+1)). */
function decimalExponentOf(x: BigDecimal): number {
  const sig = x.significand < 0n ? -x.significand : x.significand;
  return x.exponent + sig.toString().length - 1;
}

/** Relative difference |a - b| / |b| is below `bound` (given as a string). */
function relClose(a: BigDecimal, b: BigDecimal, bound: string): boolean {
  return a.sub(b).div(b).abs().lt(new BigDecimal(bound));
}

describe('D6: exp at large magnitudes', () => {
  // References computed independently (Python decimal, 115 digits).
  test('exp(-200) is correct to full precision', () => {
    const s = new BigDecimal('-200').exp().toString();
    expect(s.startsWith('1.383896526736737530648681456979084685403047582339')).toBe(true);
    expect(s.endsWith('e-87')).toBe(true);
  });

  test('exp(-80) ≥ 48 correct digits', () => {
    const s = new BigDecimal('-80').exp().toString();
    expect(s.startsWith('1.804851387845415172312128357350027421171103097839')).toBe(true);
    expect(s.endsWith('e-35')).toBe(true);
  });

  test('exp(80) ≥ 48 correct digits', () => {
    const s = new BigDecimal('80').exp().toString();
    expect(s.startsWith('5.540622384393510052571173395831661292485672883268')).toBe(true);
    expect(s.endsWith('e+34')).toBe(true);
  });

  test('exp(700) ≥ 48 correct digits', () => {
    const s = new BigDecimal('700').exp().toString();
    expect(s.startsWith('1.014232054735004509455329595231267615204679572243')).toBe(true);
    expect(s.endsWith('e+304')).toBe(true);
  });

  test('exp(-700) ≥ 48 correct digits', () => {
    const s = new BigDecimal('-700').exp().toString();
    expect(s.startsWith('9.859676543759770856705372947849465105115600181400')).toBe(true);
    expect(s.endsWith('e-305')).toBe(true);
  });

  test('exp(1e16) is finite with the exact decimal exponent', () => {
    // ⌊1e16 / ln 10⌋ = 4342944819032518 — still a safe-integer exponent.
    const r = new BigDecimal('1e16').exp();
    expect(r.isFinite()).toBe(true);
    expect(decimalExponentOf(r)).toBe(4342944819032518);
  });

  test('exp saturates at the representational exponent bound', () => {
    // Beyond |x/ln 10| > Number.MAX_SAFE_INTEGER the decimal exponent of the
    // result is not exactly representable: saturate to +Infinity / 0
    // (documented policy), consistent with exp(±Infinity).
    const big = new BigDecimal('2.1e16').exp();
    expect(big.isFinite()).toBe(false);
    expect(big.isNaN()).toBe(false);
    expect(big.significand > 0n).toBe(true);

    expect(new BigDecimal('-2.1e16').exp().isZero()).toBe(true);

    // Astronomically large arguments saturate without building
    // magnitude-sized working bigints.
    const huge = new BigDecimal('1e9999').exp();
    expect(huge.isFinite()).toBe(false);
    expect(huge.significand > 0n).toBe(true);
    expect(new BigDecimal('-1e9999').exp().isZero()).toBe(true);
  });
});

describe('D6: ln at large magnitudes', () => {
  // This computation used to hang forever (fpln(0n) sqrt-reduction loop);
  // if the fix regresses, the jest per-test timeout will catch it.
  test('ln(1e-100) = -100·ln(10) to full precision', () => {
    const r = new BigDecimal('1e-100').ln();
    expect(
      r.toString().startsWith('-230.258509299404568401799145468436420760110148862')
    ).toBe(true);

    const expected = new BigDecimal('10').ln().mul(-100);
    expect(r.sub(expected).abs().lt(new BigDecimal('1e-45'))).toBe(true);
  });

  test('ln(1e+100) = +100·ln(10) to full precision', () => {
    expect(
      new BigDecimal('1e100')
        .ln()
        .toString()
        .startsWith('230.258509299404568401799145468436420760110148862')
    ).toBe(true);
  });

  test('ln(1e±300) = ±300·ln(10) to full precision', () => {
    const prefix = '690.775527898213705205397436405309262280330446588';
    expect(new BigDecimal('1e300').ln().toString().startsWith(prefix)).toBe(true);
    expect(new BigDecimal('1e-300').ln().toString().startsWith('-' + prefix)).toBe(
      true
    );
  });

  test('ln(2) to full precision', () => {
    expect(
      new BigDecimal('2')
        .ln()
        .toString()
        .startsWith('0.69314718055994530941723212145817656807550013436')
    ).toBe(true);
  });
});

describe('D6: exp/ln round-trips across 200 orders of magnitude', () => {
  test('exp(ln(x)) ≈ x for x spanning 1e-100 .. 1e100', () => {
    for (const s of ['1e-100', '3.7e-50', '0.5', '3.7', '4.2e50', '1e100']) {
      const x = new BigDecimal(s);
      expect(relClose(x.ln().exp(), x, '1e-45')).toBe(true);
    }
  });

  test('ln(exp(x)) ≈ x for large-magnitude x', () => {
    for (const s of ['-200', '-80', '80', '200', '700', '-700']) {
      const x = new BigDecimal(s);
      expect(x.exp().ln().sub(x).abs().lt(new BigDecimal('1e-44'))).toBe(true);
    }
  });
});

describe('D6: sqrt range reduction', () => {
  test('sqrt of tiny values does not underflow to 0', () => {
    expect(new BigDecimal('1e-100').sqrt().toString()).toBe('1e-50');
    expect(new BigDecimal('4e-100').sqrt().toString()).toBe('2e-50');
  });

  test('sqrt(2e-90) = sqrt(2)·1e-45 to full precision', () => {
    const s = new BigDecimal('2e-90').sqrt().toString();
    expect(s.startsWith('1.414213562373095048801688724209698078569671875376')).toBe(true);
    expect(s.endsWith('e-45')).toBe(true);
  });

  test('sqrt(2e300) = sqrt(2)·1e+150 to full precision', () => {
    const s = new BigDecimal('2e300').sqrt().toString();
    expect(s.startsWith('1.414213562373095048801688724209698078569671875376')).toBe(true);
    expect(s.endsWith('e+150')).toBe(true);
  });

  test('sqrt round-trips at full relative precision for tiny/huge x', () => {
    for (const s of ['1.7e-123', '5e-7', '9.4e211']) {
      const x = new BigDecimal(s);
      const root = x.sqrt();
      expect(relClose(root.mul(root), x, '1e-48')).toBe(true);
    }
  });
});

describe('D6: cbrt range reduction', () => {
  test('cbrt of tiny values does not underflow to 0', () => {
    expect(new BigDecimal('8e-99').cbrt().toString()).toBe('2e-33');
    expect(new BigDecimal('-8e-99').cbrt().toString()).toBe('-2e-33');
    expect(new BigDecimal('1e-300').cbrt().toString()).toBe('1e-100');
  });

  test('cbrt round-trips at full relative precision for tiny/huge x', () => {
    for (const s of ['2e-61', '3.1e-200', '7e155']) {
      const x = new BigDecimal(s);
      const root = x.cbrt();
      expect(relClose(root.mul(root).mul(root), x, '1e-47')).toBe(true);
    }
  });
});

describe('D6: precision sweep (20/50/100 digits)', () => {
  // References computed independently (Python decimal, 115 digits).
  const EXP_M200 =
    '1.383896526736737530648681456979084685403047582339477209393925353112436030450992987808798982287027040947149891771217e-87';
  const LN_1EM100 =
    '-230.2585092994045684017991454684364207601101488628772976033327900967572609677352480235997205089598298341967784042286';
  const SQRT_2 =
    '1.414213562373095048801688724209698078569671875376948073176679737990732478462107038850387534327641572735013846230912';

  test.each([20, 50, 100])('precision %i', (prec) => {
    BigDecimal.precision = prec;
    expect(
      digitsAgree(new BigDecimal('-200').exp().toString(), EXP_M200)
    ).toBeGreaterThanOrEqual(prec - 2);
    expect(
      digitsAgree(new BigDecimal('1e-100').ln().toString(), LN_1EM100)
    ).toBeGreaterThanOrEqual(prec - 2);
    expect(
      digitsAgree(new BigDecimal('2e-90').sqrt().toString(), SQRT_2)
    ).toBeGreaterThanOrEqual(prec - 2);
  });
});

describe('D6: trig/hyperbolic small arguments', () => {
  test('tiny arguments return x, not a wrong exact 0', () => {
    // f(x) = x·(1 + O(x²)): at 50 digits, f(1e-100) is exactly 1e-100.
    for (const fn of ['sin', 'tan', 'atan', 'asin', 'sinh', 'tanh'] as const) {
      expect(new BigDecimal('1e-100')[fn]().toString()).toBe('1e-100');
      expect(new BigDecimal('-1e-100')[fn]().toString()).toBe('-1e-100');
    }
    expect(new BigDecimal('1e-100').cos().toString()).toBe('1');
    expect(new BigDecimal('1e-100').cosh().toString()).toBe('1');
  });

  // References: x ± x³/6 etc. (Python decimal, 60 digits); the small-argument
  // working-precision compensation keeps full relative precision where the
  // absolute-precision bridge used to truncate ~|e| leading digits.
  test('small (not tiny) arguments keep full relative precision', () => {
    const x20 = new BigDecimal('1.2345678901234567890123456789e-20');
    expect(
      x20.sin().toString().startsWith('1.23456789012345678901234567889999999999996863872')
    ).toBe(true);
    expect(
      x20.atan().toString().startsWith('1.23456789012345678901234567889999999999993727745')
    ).toBe(true);
    expect(
      x20.asin().toString().startsWith('1.23456789012345678901234567890000000000003136127')
    ).toBe(true);

    const x15 = new BigDecimal('1.2345678901234567890123456789e-15');
    expect(
      x15.sinh().toString().startsWith('1.23456789012345678901234567890031361272872560962')
    ).toBe(true);
    expect(
      x15.tanh().toString().startsWith('1.23456789012345678901234567889937277454254878074')
    ).toBe(true);
  });
});

describe('D6: trig/hyperbolic large arguments', () => {
  test('sin/cos(1e300) reduce mod 2π at full precision', () => {
    // References computed independently (Python decimal, 400-digit π).
    expect(
      new BigDecimal('1e300')
        .sin()
        .toString()
        .startsWith('-0.98575042516037699660904753142989546907771531256')
    ).toBe(true);
    expect(
      new BigDecimal('1e300')
        .cos()
        .toString()
        .startsWith('-0.16821444437424507285187566443555584453305088766')
    ).toBe(true);
  });

  test('trig of huge arguments reduces via on-demand π (no longer NaN)', () => {
    // mod-2π reduction of 10^3000 needs ~3000 digits of π. Beyond the ~2370
    // stored digits, π is now computed on demand (Chudnovsky), so the result
    // is the correct value rather than NaN. Validated against an independent
    // reduction (1e3000 − ⌊1e3000/2π⌋·2π) computed at 3200 digits.
    BigDecimal.precision = 50;
    const x = new BigDecimal('1e3000');
    expect(x.sin().isNaN()).toBe(false);
    expect(x.cos().isNaN()).toBe(false);

    BigDecimal.precision = 3200;
    const twoPi = BigDecimal.PI.mul(2);
    const k = x.div(twoPi).floor();
    const r = x.sub(k.mul(twoPi));
    const refSin = r.sin().toPrecision(50).toString();
    const refCos = r.cos().toPrecision(50).toString();
    BigDecimal.precision = 50;
    expect(x.sin().toString()).toBe(refSin);
    expect(x.cos().toString()).toBe(refCos);
  });

  test('trig past the on-demand π cap still reports NaN', () => {
    // An absurd magnitude would need >1e6 digits of π to reduce — capped.
    expect(new BigDecimal('1e2000000').sin().isNaN()).toBe(true);
    expect(new BigDecimal('1e2000000').cos().isNaN()).toBe(true);
  });

  test('tanh of huge arguments rounds to ±1 (and terminates)', () => {
    // Used to attempt exp(2e9) − 1 with exponent alignment, building a
    // ~10⁹-digit bigint.
    expect(new BigDecimal('1e9').tanh().toString()).toBe('1');
    expect(new BigDecimal('-1e9').tanh().toString()).toBe('-1');
  });

  test('sinh/cosh of large arguments avoid exponent-alignment blowup', () => {
    const s = new BigDecimal('1e6').sinh();
    // log10(e^1e6 / 2) = 1e6/ln 10 − log10 2 → decimal exponent 434294
    expect(decimalExponentOf(s)).toBe(434294);
    expect(new BigDecimal('1e6').cosh().eq(s)).toBe(true);
    expect(new BigDecimal('-1e6').sinh().eq(s.neg())).toBe(true);
  });
});

// Wave-4 NU-P1 numeric-precision fixes. References independently computed with
// mpmath at ≥80 guard digits (from the exact decimal inputs), not from the code
// under test. Each asserts full working precision where the old code lost
// −log10(result) digits to cancellation.
describe('NU-P1 precision fixes (mpmath-pinned)', () => {
  test('NU-P1-4: pow integer path carries guard digits through the ladder', () => {
    BigDecimal.precision = 34;
    // 0.999999999999^1e6 was wrong from digit ~28 (per-squaring rounding).
    const s = new BigDecimal('0.999999999999').pow(1000000).toString();
    expect(s).toBe('0.9999990000004999993333338749994083');
    BigDecimal.precision = 50;
  });

  test('NU-P1-5: acos near +1 is cancellation-free', () => {
    // acos(1 − 1e-40): result ≈ 1.414e-20, needs the half-angle identity.
    const s = new BigDecimal(
      '0.9999999999999999999999999999999999999999'
    )
      .acos()
      .toString();
    expect(
      digitsAgree(s, '1.41421356237309504880168872420969807856968366049e-20')
    ).toBeGreaterThanOrEqual(47);
  });

  test('NU-P1-5: acos near +1 (1 − 1e-20)', () => {
    const s = new BigDecimal('0.99999999999999999999').acos().toString();
    expect(
      digitsAgree(s, '1.4142135623730950488028672355116756577770092676309e-10')
    ).toBeGreaterThanOrEqual(48);
  });

  test('NU-P1-5: acos near −1 via the mirror identity', () => {
    const s = new BigDecimal('-0.999999999999999999999999999999')
      .acos()
      .toString();
    expect(
      digitsAgree(s, '3.1415926535897918242490810101844540825084451895592')
    ).toBeGreaterThanOrEqual(48);
  });

  test('NU-P1-6: cos near a zero sizes the guard to the cancellation', () => {
    // cos of π/2 truncated to 40 digits ≈ 5.8e-40; a fixed 15-digit guard left
    // only ~22 correct digits.
    const s = new BigDecimal('1.570796326794896619231321691639751442098')
      .cos()
      .toString();
    expect(
      digitsAgree(s, '5.8469968755291048747229615390820314310449931401741e-40')
    ).toBeGreaterThanOrEqual(48);
  });

  test('NU-P1-6: tan near a pole sizes the guard to the cancellation', () => {
    const s = new BigDecimal('1.570796326794896619231321691639751442098')
      .tan()
      .toString();
    expect(
      digitsAgree(s, '1710279689365334692301700436803735939673.6227591018')
    ).toBeGreaterThanOrEqual(48);
  });

  test('NU-P1-6: cos/tan away from zeros unaffected', () => {
    expect(
      digitsAgree(
        new BigDecimal('0.5').cos().toString(),
        '0.87758256189037271611628158260382965199164519710974'
      )
    ).toBeGreaterThanOrEqual(48);
    expect(
      digitsAgree(
        new BigDecimal('0.5').tan().toString(),
        '0.54630248984379051325517946578028538329755172017979'
      )
    ).toBeGreaterThanOrEqual(48);
  });

  test('NU-P1-7: nthRoot snaps perfect powers and keeps full precision', () => {
    // Perfect powers snap to the exact integer root (no 3.999…9 tail).
    expect(new BigDecimal('64').nthRoot(3).toString()).toBe('4');
    expect(new BigDecimal('64').cbrt().toString()).toBe('4');
    expect(new BigDecimal('1024').nthRoot(10).toString()).toBe('2');
    // Non-perfect roots keep full working precision.
    expect(
      digitsAgree(
        new BigDecimal('2').nthRoot(3).toString(),
        '1.2599210498948731647672106072782283505702514647015'
      )
    ).toBeGreaterThanOrEqual(48);
    expect(
      digitsAgree(
        new BigDecimal('10').nthRoot(7).toString(),
        '1.389495494373137637129985217353011622113046714491'
      )
    ).toBeGreaterThanOrEqual(48);
  });
});
