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
