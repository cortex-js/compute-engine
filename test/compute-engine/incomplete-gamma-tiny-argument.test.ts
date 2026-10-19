import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { bigGammaP } from '../../src/compute-engine/numerics/special-functions';

//
// Below x = 10⁻¹⁰⁰⁰⁰⁰ the bignum kernels of the regularized incomplete gamma
// use the leading term of the series, P(a, x) ≈ x^a/Γ(a + 1) and
// Q(a, x) = 1 − P(a, x) (`tinyGammaPLeadingTerm`,
// `src/compute-engine/numerics/special-functions.ts`). The terms after the
// leading one are smaller by a factor of about x, far below the working
// precision. Before, the kernels gave NaN there, and the machine kernel
// cannot represent x: `GammaRegularized(0.5, 1e-1000000000)` was `NaN`.
//
// The reference values are from mpmath at 100 digits: `gammainc(a, x, inf,
// regularized=True)` at x = 10⁻³⁰⁰ (where it agrees with the leading term
// to 21 digits), and `1 − x^a/gamma(a + 1)` at the tiny x below.
//

const ce = new ComputeEngine();

const Q = (a: number, x: string) =>
  ce
    .box(['GammaRegularized', a, { num: x }])
    .N()
    .toString();

describe('GammaRegularized at a tiny argument', () => {
  test.each([
    [0.5, '1e-1000000000', '1'],
    [0.5, '1e-100001', '1'],
    [2.5, '1e-200000', '1'],
    [1e-20, '1e-1000000000', '2.30258509239032052858e-11'],
    [1e-30, '1e-100001', '2.30260234668832660915e-25'],
    [-0.5, '1e-200000', '-5.64189583547756286948e+99999'],
    [-1.5, '1e-200000', '2.82094791773878143474e+299999'],
    [-2.25, '1e-150000', '-2.55015293468207181587e+337499'],
  ])('Q(%d, %s)', (a, x, expected) => {
    expect(Q(a, x)).toBe(expected);
  });

  test('the series above the limit and the leading term below it agree with mpmath', () => {
    // Series (x = 10⁻⁹⁹⁹⁹⁹) and leading term (x = 10⁻¹⁰⁰⁰⁰¹)
    expect(Q(1e-30, '1e-99999')).toBe('2.30255629498646672823e-25');
    expect(Q(-2.25, '1e-99999')).toBe('-1.43405638072717398466e+224997');
    expect(Q(-0.5, '1e-99999')).toBe('-1.78412411615277111454e+49999');
    expect(Q(-2.25, '1e-100001')).toBe('-4.53488445619546230207e+225001');
    expect(Q(-0.5, '1e-100001')).toBe('-1.78412411615277111454e+50000');
  });

  test('at 50 digits', () => {
    // An engine sets the global precision of the big decimals when it is
    // made, so the precision of the shared engine is restored after it.
    const saved = BigDecimal.precision;
    try {
      const ce50 = new ComputeEngine();
      ce50.precision = 50;
      expect(
        ce50
          .box(['GammaRegularized', 1e-30, { num: '1e-100001' }])
          .N()
          .toString()
      ).toBe('2.3026023466883266091462253043791318867141050851694e-25');
    } finally {
      BigDecimal.precision = saved;
    }
  });

  test.each([
    ['0.5', '1e-1000000000', '1.1283791670955125739e-500000000'],
    ['2.5', '1e-200000', '3.00901111225470019706e-500001'],
    ['1e-20', '1e-1000000000', '0.999999999976974149076'],
  ])('P(%s, %s)', (a, x, expected) => {
    expect(bigGammaP(ce, new BigDecimal(a), new BigDecimal(x)).toString()).toBe(
      new BigDecimal(expected).toString()
    );
  });
});

describe('GammaRegularized at a tiny order', () => {
  // For a tiny order a, Q(a, x) is about a·(−ln x − γ) at a small x, so the
  // subtraction 1 − P loses every digit. The leading term of P now gives Q
  // also above x = 10⁻¹⁰⁰⁰⁰⁰ when the upper tail declines, and ln Γ(1 + a)
  // keeps its relative precision for a tiny a (`gammalnOnePlus`). Before,
  // these values were NaN, or not evaluated for a negative order. The
  // reference values are a·(−ln x − γ) to 25 digits: the terms after it are
  // below 10⁻⁹⁰ relative to it.
  const Qt = (a: string, x: string) =>
    ce
      .box(['GammaRegularized', { num: a }, { num: x }])
      .N()
      .toString();
  test.each([
    ['1e-100', '1e-1000', '2.30200787732914415116e-97'],
    ['1e-100', '1e-90000', '2.07232081153799210029e-95'],
    ['1e-100', '1e-100001', '2.30260234668832660915e-95'],
    ['1e-100', '1e-200001', '4.60518743968237229316e-95'],
    ['-1e-100', '1e-1000', '-2.30200787732914415116e-97'],
  ])('Q(%s, %s)', (a, x, expected) => {
    expect(Qt(a, x)).toBe(expected);
  });
});
