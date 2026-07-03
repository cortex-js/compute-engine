import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { erfInv } from '../../src/compute-engine/numerics/special-functions';
import { engine } from '../utils';

const ce = engine;

// Helper: check numeric approximation within tolerance
function expectApprox(
  expr: any,
  expected: number,
  tolerance = 1e-10
) {
  const result = expr.N();
  const val = result.re;
  if (!isFinite(expected)) {
    expect(val).toBe(expected);
  } else {
    expect(Math.abs(val - expected)).toBeLessThan(
      Math.abs(expected) * tolerance + tolerance
    );
  }
}

describe('DIGAMMA FUNCTION', () => {
  test('ψ(1) = -γ (Euler-Mascheroni constant)', () => {
    expectApprox(ce.expr(['Digamma', 1]), -0.5772156649015329);
  });

  test('ψ(2) = 1 - γ', () => {
    expectApprox(ce.expr(['Digamma', 2]), 1 - 0.5772156649015329);
  });

  test('ψ(0.5) = -γ - 2ln(2)', () => {
    expectApprox(
      ce.expr(['Digamma', 0.5]),
      -0.5772156649015329 - 2 * Math.log(2)
    );
  });

  test('ψ(5) = 1 + 1/2 + 1/3 + 1/4 - γ', () => {
    expectApprox(
      ce.expr(['Digamma', 5]),
      1 + 1 / 2 + 1 / 3 + 1 / 4 - 0.5772156649015329
    );
  });

  test('ψ(10) reference value', () => {
    // NIST/Wolfram: ψ(10) ≈ 2.25175258906672
    expectApprox(ce.expr(['Digamma', 10]), 2.25175258906672, 1e-8);
  });

  test('Digamma without numericApproximation returns unevaluated', () => {
    const result = ce.expr(['Digamma', 1]).evaluate();
    expect(result.operator).toBe('Digamma');
  });
});

describe('TRIGAMMA FUNCTION', () => {
  test('ψ₁(1) = π²/6', () => {
    expectApprox(ce.expr(['Trigamma', 1]), (Math.PI * Math.PI) / 6);
  });

  test('ψ₁(2) = π²/6 - 1', () => {
    expectApprox(ce.expr(['Trigamma', 2]), (Math.PI * Math.PI) / 6 - 1);
  });

  test('ψ₁(0.5) = π²/2', () => {
    expectApprox(ce.expr(['Trigamma', 0.5]), (Math.PI * Math.PI) / 2);
  });
});

describe('POLYGAMMA FUNCTION', () => {
  test('ψ₀(1) = ψ(1) = -γ', () => {
    expectApprox(ce.expr(['PolyGamma', 0, 1]), -0.5772156649015329);
  });

  test('ψ₁(1) = π²/6 (via PolyGamma)', () => {
    expectApprox(ce.expr(['PolyGamma', 1, 1]), (Math.PI * Math.PI) / 6);
  });

  test('ψ₂(1) = -2ζ(3) ≈ -2.404113806', () => {
    // ψ₂(1) = -2 * ζ(3) where ζ(3) ≈ 1.2020569031595942
    // n = 2 is the one order that was unaffected by the missing (n−1)!
    // factor (1! = 1); tightened from 1e-6 along with the n ≥ 3 fixes.
    expectApprox(ce.expr(['PolyGamma', 2, 1]), -2.4041138063191885, 1e-12);
  });

  // Regressions for the Bernoulli-tail coefficient bug (P0-20): the
  // asymptotic term is B₂ₖ·(2k+n−1)!/((2k)!·z^{2k+n}) (DLMF 5.15.9-class);
  // both lanes omitted the (n−1)! factor, wrong from digit ~5–9 for n ≥ 3.
  // References: mpmath @40 digits.
  test('ψ⁽³⁾(2.5) ≈ 0.22390584881725206 (was 3.7 digits)', () => {
    expectApprox(ce.expr(['PolyGamma', 3, 2.5]), 0.22390584881725206, 1e-12);
  });

  test('ψ⁽⁵⁾(10) ≈ 3.059451621172682e-4 (was 1.7 digits)', () => {
    expectApprox(ce.expr(['PolyGamma', 5, 10]), 3.059451621172682e-4, 1e-12);
  });

  test('ψ⁽⁶⁾(0.5) ≈ -92203.45792380303', () => {
    expectApprox(ce.expr(['PolyGamma', 6, 0.5]), -92203.45792380303, 1e-12);
  });

  test('ψ⁽⁴⁾(2.5) ≈ -0.3137559995067314', () => {
    expectApprox(ce.expr(['PolyGamma', 4, 2.5]), -0.3137559995067314, 1e-12);
  });
});

describe('INCOMPLETE GAMMA FUNCTION Γ(s, z)', () => {
  // Reference values from mpmath `mp.gammainc(s, z)` (upper incomplete gamma,
  // Mathematica/Rubi `Gamma[s, z]` convention).
  test('Γ(2, 1) = 2/e', () => {
    expectApprox(ce.expr(['Gamma', 2, 1]), 0.7357588823428847);
  });

  test('Γ(5, 3) (positive integer s)', () => {
    expectApprox(ce.expr(['Gamma', 5, 3]), 19.56631786857053, 1e-9);
  });

  test('Γ(0, 1) = E₁(1)', () => {
    expectApprox(ce.expr(['Gamma', 0, 1]), 0.21938393439552029);
  });

  test('Γ(1/2, 1) = √π·erfc(1)', () => {
    expectApprox(
      ce.expr(['Gamma', ['Rational', 1, 2], 1]),
      0.27880558528066196
    );
  });

  test('Γ(-1, 1) (negative-integer s, recurrence)', () => {
    expectApprox(ce.expr(['Gamma', -1, 1]), 0.14849550677592205);
  });

  test('Γ(-4, 2) (negative-integer s, recurrence)', () => {
    expectApprox(ce.expr(['Gamma', -4, 2]), 0.001332650012645189, 1e-9);
  });

  test('Γ(1/3, 2) (fractional s)', () => {
    expectApprox(ce.expr(['Gamma', ['Rational', 1, 3], 2]), 0.0681364144414591);
  });

  test('Γ(s, 0) = Γ(s) reduction', () => {
    expectApprox(ce.expr(['Gamma', 2.5, 0]), 1.3293403881791370); // Γ(2.5)
  });

  test('Γ(2, -1) = 0 (real, integer s, negative z)', () => {
    const v = ce.expr(['Gamma', 2, -1]).N();
    expect(Math.abs(v.re)).toBeLessThan(1e-12);
  });

  test('Γ(3, 40) large positive z = e⁻⁴⁰(40²+2·40+2)', () => {
    // mpmath: 7.145731857400453e-15 — small but exact via CF
    const v = ce.expr(['Gamma', 3, 40]).N();
    expect(Math.abs(v.re - 7.145731857400453e-15) / 7.146e-15).toBeLessThan(
      1e-9
    );
  });

  test('Γ(2, -26) large negative z (asymptotic; was catastrophic cancellation)', () => {
    // mpmath: -4893240235720.969 = e²⁶·(−25), exact for integer s
    const v = ce.expr(['Gamma', 2, -26]).N();
    expect(Math.abs(v.re - -4893240235720.969) / 4.893e12).toBeLessThan(1e-9);
  });

  test('Γ(1/2, -1) complex result', () => {
    // mpmath: 1.77245385090552 - 2.92530349181436j
    const v = ce.expr(['Gamma', ['Rational', 1, 2], -1]).N();
    expect(Math.abs(v.re - 1.7724538509055)).toBeLessThan(1e-9);
    expect(Math.abs(v.im - -2.9253034918144)).toBeLessThan(1e-9);
  });

  test('Γ(2, x) stays symbolic without numericApproximation', () => {
    expect(ce.expr(['Gamma', 2, 'x']).evaluate().toString()).toBe('Gamma(2, x)');
  });

  test('1-argument Γ still works (Γ(5) = 24, Γ(0) = ~oo)', () => {
    expectApprox(ce.expr(['Gamma', 5]), 24);
    expect(ce.expr(['Gamma', 0]).N().toString()).toContain('oo');
  });
});

describe('BETA FUNCTION', () => {
  test('B(1, 1) = 1', () => {
    expectApprox(ce.expr(['Beta', 1, 1]), 1);
  });

  test('B(2, 3) = 1/12', () => {
    expectApprox(ce.expr(['Beta', 2, 3]), 1 / 12);
  });

  test('B(0.5, 0.5) = π', () => {
    expectApprox(ce.expr(['Beta', 0.5, 0.5]), Math.PI, 1e-8);
  });

  test('B(3, 4) = 1/60', () => {
    expectApprox(ce.expr(['Beta', 3, 4]), 1 / 60);
  });
});

describe('ZETA FUNCTION', () => {
  test('ζ(2) = π²/6', () => {
    expectApprox(ce.expr(['Zeta', 2]), (Math.PI * Math.PI) / 6);
  });

  test('ζ(4) = π⁴/90', () => {
    expectApprox(ce.expr(['Zeta', 4]), Math.PI ** 4 / 90);
  });

  test('ζ(3) ≈ 1.2020569031595942 (Apery constant)', () => {
    // Was 1e-6, masking the broken machine-zeta acceleration coefficients
    // (error floor ~2.4e-7); tightened after the Borwein d_k fix.
    expectApprox(ce.expr(['Zeta', 3]), 1.2020569031595942, 1e-12);
  });

  test('ζ(0) = -1/2', () => {
    expectApprox(ce.expr(['Zeta', 0]), -0.5);
  });

  test('ζ(-1) = -1/12', () => {
    expectApprox(ce.expr(['Zeta', -1]), -1 / 12, 1e-8);
  });

  test('ζ(6) = π⁶/945', () => {
    expectApprox(ce.expr(['Zeta', 6]), Math.PI ** 6 / 945);
  });

  test('ζ(1e9) = 1 (huge-s guard: no bigint blowup)', () => {
    // The bignum acceleration loop raises (k+1)^s as an exact bigint; for
    // huge s this exceeded the BigInt size limit (RangeError). ζ(s) rounds
    // to exactly 1 well before that.
    expectApprox(ce.expr(['Zeta', 1e9]), 1, 1e-14);
  });
});

describe('MACHINE-PRECISION KERNELS (P0-20/P0-21 regressions)', () => {
  // The default engine works above machine precision, so Zeta/PolyGamma
  // route to the (correct) bignum kernels. These tests pin the MACHINE
  // kernels, which previously had wrong digits at every precision:
  // - zeta: acceleration used binomial partial sums instead of the Borwein
  //   Chebyshev d_k — error floor ~2.4e-7 for every non-hardcoded argument.
  // - polygamma: Bernoulli tail missing the (n−1)! factor for n ≥ 3.
  // References: mpmath @40 digits.
  let mCe: InstanceType<typeof ComputeEngine>;
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = ce.precision;
    mCe = new ComputeEngine();
    mCe.precision = 'machine';
  });
  afterAll(() => {
    // BigDecimal.precision is process-global: re-sync it for the shared engine
    ce.precision = savedPrecision;
  });

  test('machine ζ(3) ≈ 1.2020569031595942 (was 7.1 digits)', () => {
    expectApprox(mCe.expr(['Zeta', 3]), 1.2020569031595942, 1e-14);
  });

  test('machine ζ(0.5) ≈ -1.4603545088095868 (was 8.3 digits)', () => {
    expectApprox(mCe.expr(['Zeta', 0.5]), -1.4603545088095868, 1e-14);
  });

  test('machine ζ(1.5) ≈ 2.612375348685488', () => {
    expectApprox(mCe.expr(['Zeta', 1.5]), 2.612375348685488, 1e-14);
  });

  test('machine ζ(15) ≈ 1.000030588236307 (was 6.6 digits)', () => {
    expectApprox(mCe.expr(['Zeta', 15]), 1.000030588236307, 1e-14);
  });

  test('machine ζ(30) ≈ 1.0000000009313275 (was on the wrong side of 1)', () => {
    expectApprox(mCe.expr(['Zeta', 30]), 1.0000000009313275, 1e-14);
  });

  test('machine ζ(-11) = 691/32760 exactly (DLMF 25.6.3)', () => {
    expectApprox(mCe.expr(['Zeta', -11]), 0.021092796092796094, 1e-14);
  });

  test('machine ψ⁽³⁾(2.5) ≈ 0.22390584881725206 (was 3.7 digits)', () => {
    expectApprox(mCe.expr(['PolyGamma', 3, 2.5]), 0.22390584881725206, 1e-13);
  });

  test('machine ψ⁽⁵⁾(10) ≈ 3.059451621172682e-4 (was 1.7 digits)', () => {
    expectApprox(mCe.expr(['PolyGamma', 5, 10]), 3.059451621172682e-4, 1e-13);
  });

  test('machine ψ⁽⁶⁾(0.5) ≈ -92203.45792380303', () => {
    expectApprox(mCe.expr(['PolyGamma', 6, 0.5]), -92203.45792380303, 1e-13);
  });

  test('compiled Zeta uses the fixed kernel (CO-P1-5)', () => {
    // The JavaScript compilation target imports the same machine `zeta`
    // (compilation/javascript-target.ts), so the compiled copy is fixed too.
    const out = compile(ce.expr(['Zeta', 3]))?.run?.({});
    expect(typeof out).toBe('number');
    expect(Math.abs((out as number) - 1.2020569031595942)).toBeLessThan(1e-14);
  });
});

describe('LAMBERT W FUNCTION', () => {
  test('W(0) = 0', () => {
    expectApprox(ce.expr(['LambertW', 0]), 0);
  });

  test('W(1) ≈ 0.5671432904097838 (Omega constant)', () => {
    expectApprox(ce.expr(['LambertW', 1]), 0.5671432904097838);
  });

  test('W(e) = 1', () => {
    // Use numeric value of e
    expectApprox(
      ce.expr(['LambertW', { num: '2.718281828459045' }]),
      1,
      1e-10
    );
  });

  test('W(-1/e) = -1 (branch point)', () => {
    // Use numeric value of -1/e
    expectApprox(
      ce.expr(['LambertW', { num: '-0.36787944117144233' }]),
      -1,
      1e-10
    );
  });

  test('W(x)·e^W(x) = x verification for x=2', () => {
    const w = ce.expr(['LambertW', 2]).N();
    const wVal = w.re;
    expect(Math.abs(wVal * Math.exp(wVal) - 2)).toBeLessThan(1e-12);
  });

  test('W(100) verification', () => {
    const w = ce.expr(['LambertW', 100]).N();
    const wVal = w.re;
    expect(Math.abs(wVal * Math.exp(wVal) - 100)).toBeLessThan(1e-10);
  });
});

describe('BESSEL J FUNCTION', () => {
  test('J_0(0) = 1', () => {
    expectApprox(ce.expr(['BesselJ', 0, 0]), 1);
  });

  test('J_1(0) = 0', () => {
    expectApprox(ce.expr(['BesselJ', 1, 0]), 0);
  });

  test('J_0(1) ≈ 0.7651976865579666', () => {
    expectApprox(ce.expr(['BesselJ', 0, 1]), 0.7651976865579666);
  });

  test('J_1(1) ≈ 0.44005058574493355', () => {
    expectApprox(ce.expr(['BesselJ', 1, 1]), 0.44005058574493355);
  });

  test('J_0(5) ≈ -0.17759677131433830', () => {
    expectApprox(ce.expr(['BesselJ', 0, 5]), -0.17759677131433830, 1e-8);
  });

  test('J_2(3) ≈ 0.48609126058589108', () => {
    expectApprox(ce.expr(['BesselJ', 2, 3]), 0.48609126058589108, 1e-8);
  });

  test('J_5(10) ≈ -0.23406152818679364', () => {
    // Large argument, tests Miller/asymptotic regime
    expectApprox(ce.expr(['BesselJ', 5, 10]), -0.23406152818679364, 1e-6);
  });

  test('J_0(50) asymptotic regime', () => {
    // Tests asymptotic expansion for large x
    expectApprox(ce.expr(['BesselJ', 0, 50]), 0.05581232766925048, 1e-6);
  });

  test('BesselJ without numericApproximation returns unevaluated', () => {
    const result = ce.expr(['BesselJ', 0, 1]).evaluate();
    expect(result.operator).toBe('BesselJ');
  });
});

describe('BESSEL Y FUNCTION', () => {
  test('Y_0(1) ≈ 0.08825696421567696', () => {
    expectApprox(ce.expr(['BesselY', 0, 1]), 0.08825696421567696, 1e-6);
  });

  test('Y_1(1) ≈ -0.78121282130028876', () => {
    expectApprox(ce.expr(['BesselY', 1, 1]), -0.78121282130028876, 1e-6);
  });

  test('Y_0(5) ≈ -0.30851762524903357', () => {
    expectApprox(ce.expr(['BesselY', 0, 5]), -0.30851762524903357, 1e-6);
  });

  test('Y_2(3) ≈ -0.16040039348492377', () => {
    expectApprox(ce.expr(['BesselY', 2, 3]), -0.16040039348492377, 1e-5);
  });

  test('Y_0(50) asymptotic regime', () => {
    expectApprox(ce.expr(['BesselY', 0, 50]), -0.09806499547007692, 1e-5);
  });
});

describe('BESSEL I FUNCTION', () => {
  test('I_0(0) = 1', () => {
    expectApprox(ce.expr(['BesselI', 0, 0]), 1);
  });

  test('I_1(0) = 0', () => {
    expectApprox(ce.expr(['BesselI', 1, 0]), 0);
  });

  test('I_0(1) ≈ 1.2660658777520084', () => {
    expectApprox(ce.expr(['BesselI', 0, 1]), 1.2660658777520084);
  });

  test('I_1(1) ≈ 0.56515910399248503', () => {
    expectApprox(ce.expr(['BesselI', 1, 1]), 0.56515910399248503);
  });

  test('I_0(5) ≈ 27.239871823604447', () => {
    expectApprox(ce.expr(['BesselI', 0, 5]), 27.239871823604447, 1e-12);
  });

  test('I_2(3) ≈ 2.245212440929951', () => {
    expectApprox(ce.expr(['BesselI', 2, 3]), 2.245212440929951, 1e-12);
  });

  // Regressions for the large-x asymptotic sign bug (P0-23): the I expansion
  // alternates the a_k(ν) terms (DLMF 10.40.1); reusing the K signs gave
  // only 1.1–3.4 correct digits. References: mpmath @40 digits.
  test('I_0(100) ≈ 1.0737517071310738e+42 (asymptotic, was 2.6 digits)', () => {
    expectApprox(ce.expr(['BesselI', 0, 100]), 1.0737517071310738e42, 1e-12);
  });

  test('I_1(700) ≈ 1.5285003902339006e+302 (asymptotic, was 3.0 digits)', () => {
    expectApprox(ce.expr(['BesselI', 1, 700]), 1.5285003902339006e302, 1e-12);
  });

  test('I_2(50) ≈ 2.816430640245194e+20 (asymptotic, was 1.1 digits)', () => {
    expectApprox(ce.expr(['BesselI', 2, 50]), 2.816430640245194e20, 1e-12);
  });

  test('I_0(40) ≈ 1.48947747934199e+16 (series, near crossover)', () => {
    expectApprox(ce.expr(['BesselI', 0, 40]), 1.48947747934199e16, 1e-12);
  });
});

describe('BESSEL K FUNCTION', () => {
  test('K_0(1) ≈ 0.42102443824070834', () => {
    expectApprox(ce.expr(['BesselK', 0, 1]), 0.42102443824070834, 1e-12);
  });

  test('K_1(1) ≈ 0.6019072301972346', () => {
    expectApprox(ce.expr(['BesselK', 1, 1]), 0.6019072301972346, 1e-12);
  });

  test('K_0(5) ≈ 0.0036910983340425942', () => {
    // The previous expected value (0.0036910983120279868, tolerance 1e-6)
    // was fitted to the cancellation-broken ascending series (P0-22).
    expectApprox(ce.expr(['BesselK', 0, 5]), 0.0036910983340425942, 1e-12);
  });

  test('K_2(3) ≈ 0.06151045847174204', () => {
    expectApprox(ce.expr(['BesselK', 2, 3]), 0.06151045847174204, 1e-12);
  });

  // Regressions for the mid-range cancellation bug (P0-22): the ascending
  // series was used to x = 40, losing ~0.87·x digits (K₂(20) was a factor
  // 21 wrong). Now: CF2 for 1.5 ≤ x < 20, asymptotic beyond.
  // References: mpmath @40 digits.
  test('K_0(10) ≈ 1.778006231616765e-5 (CF2, was 6.7 digits)', () => {
    expectApprox(ce.expr(['BesselK', 0, 10]), 1.778006231616765e-5, 1e-12);
  });

  test('K_2(20) ≈ 6.329543612292228e-10 (asymptotic, was 21× wrong)', () => {
    expectApprox(ce.expr(['BesselK', 2, 20]), 6.329543612292228e-10, 1e-12);
  });

  test('K_3(15) ≈ 1.312086725377046e-7 (CF2 + recurrence, was 3.5 digits)', () => {
    expectApprox(ce.expr(['BesselK', 3, 15]), 1.312086725377046e-7, 1e-12);
  });

  test('K_1(40) ≈ 8.497131954861039e-19 (asymptotic, was -19 digits)', () => {
    expectApprox(ce.expr(['BesselK', 1, 40]), 8.497131954861039e-19, 1e-12);
  });

  test('K_0(100) ≈ 4.656628229175902e-45', () => {
    expectApprox(ce.expr(['BesselK', 0, 100]), 4.656628229175902e-45, 1e-12);
  });
});

describe('AIRY Ai FUNCTION', () => {
  test('Ai(0) ≈ 0.35502805388781724', () => {
    expectApprox(ce.expr(['AiryAi', 0]), 0.35502805388781724, 1e-8);
  });

  test('Ai(1) ≈ 0.13529241631288141', () => {
    expectApprox(ce.expr(['AiryAi', 1]), 0.13529241631288141, 1e-12);
  });

  test('Ai(-1) ≈ 0.5355608832923521', () => {
    expectApprox(ce.expr(['AiryAi', -1]), 0.5355608832923521, 1e-12);
  });

  test('Ai(3) ≈ 0.006591139357460719', () => {
    // Previous expected value (…7460011, tolerance 1e-5) was fitted to the
    // plain-double series; the series now sums in double-double (P0-24).
    expectApprox(ce.expr(['AiryAi', 3]), 0.006591139357460719, 1e-12);
  });

  test('Ai(10) ≈ 1.1047532552898686e-10 (asymptotic, was 7.6 digits)', () => {
    // Was 1e-4, masking the 5-fixed-term truncation of the asymptotic
    // series; now DLMF 9.7.5 with optimal truncation.
    expectApprox(ce.expr(['AiryAi', 10]), 1.1047532552898686e-10, 1e-12);
  });

  // Regressions for the negative-x leading-term-only asymptotic (P0-24):
  // Ai(−10) had 1.6 correct digits. Now DLMF 9.7.9 P/Q pairs for x < −9 and
  // a double-double series for the cancelling mid-range.
  // References: mpmath @40 digits.
  test('Ai(-10) ≈ 0.04024123848644319 (P/Q asymptotic, was 1.6 digits)', () => {
    expectApprox(ce.expr(['AiryAi', -10]), 0.04024123848644319, 1e-12);
  });

  test('Ai(-5) ≈ 0.35076100902411433 (dd series, was 13.5 digits)', () => {
    expectApprox(ce.expr(['AiryAi', -5]), 0.35076100902411433, 1e-12);
  });

  test('Ai(5.1) ≈ 8.613242706478852e-5 (dd series, was 5.5 digits)', () => {
    expectApprox(ce.expr(['AiryAi', 5.1]), 8.613242706478852e-5, 1e-12);
  });

  test('AiryAi without numericApproximation returns unevaluated', () => {
    const result = ce.expr(['AiryAi', 1]).evaluate();
    expect(result.operator).toBe('AiryAi');
  });
});

describe('AIRY Bi FUNCTION', () => {
  test('Bi(0) ≈ 0.6149266274460007', () => {
    expectApprox(ce.expr(['AiryBi', 0]), 0.6149266274460007, 1e-12);
  });

  test('Bi(1) ≈ 1.2074235949528713', () => {
    expectApprox(ce.expr(['AiryBi', 1]), 1.2074235949528713, 1e-12);
  });

  test('Bi(-1) ≈ 0.1039973894969446', () => {
    expectApprox(ce.expr(['AiryBi', -1]), 0.1039973894969446, 1e-12);
  });

  test('Bi(3) ≈ 14.037328963730232', () => {
    // Previous expected value (14.037328963083232, tolerance 1e-5) was
    // fitted to the plain-double series (P0-24).
    expectApprox(ce.expr(['AiryBi', 3]), 14.037328963730232, 1e-12);
  });

  test('Bi(10) ≈ 455641153.54822516 (asymptotic, was 7.5 digits)', () => {
    expectApprox(ce.expr(['AiryBi', 10]), 455641153.54822516, 1e-12);
  });

  test('Bi(-10) ≈ -0.3146798296438386 (P/Q asymptotic, was 3.3 digits)', () => {
    expectApprox(ce.expr(['AiryBi', -10]), -0.3146798296438386, 1e-12);
  });

  test('Bi(-5) ≈ -0.13836913490160058 (dd series, was 13.2 digits)', () => {
    expectApprox(ce.expr(['AiryBi', -5]), -0.13836913490160058, 1e-12);
  });
});

describe('BIGNUM SPECIAL FUNCTIONS', () => {
  let bigCe: InstanceType<typeof ComputeEngine>;
  beforeAll(() => {
    bigCe = new ComputeEngine();
    bigCe.precision = 50;
    // These tests assert VALUES, not timing. Under a fully-parallel jest
    // sweep on a loaded machine the default 2 s wall-clock deadline can
    // expire from CPU contention alone (observed at load ≥35), so give the
    // high-precision computations a generous limit.
    bigCe.timeLimit = 20_000;
  });

  // Helper to check that a bignum result starts with expected digits
  function expectBignum(expr: any, expectedPrefix: string) {
    const result = expr.N();
    // Use toString() which preserves full bignum precision
    const str = result.toString();
    // Remove leading minus if present and compare digits
    const expected = expectedPrefix.replace('-', '');
    const actual = str.replace('-', '');
    const isNeg = expectedPrefix.startsWith('-');
    const actualNeg = str.startsWith('-');
    expect(actualNeg).toBe(isNeg);
    // Check at least 20 matching digits (ignoring leading zeros and decimal points)
    const expectedDigits = expected.replace('.', '').replace(/^0+/, '');
    const actualDigits = actual.replace('.', '').replace(/^0+/, '');
    expect(actualDigits.substring(0, 20)).toBe(expectedDigits.substring(0, 20));
  }

  test('high-precision ψ(1) = -γ', () => {
    // Euler-Mascheroni constant to 50+ digits
    expectBignum(
      bigCe.expr(['Digamma', 1]),
      '-0.57721566490153286060651209008240243104215933594'
    );
  });

  test('ψ(1) = -γ to 1000 digits — EulerGamma honors precision (ROADMAP B12)', () => {
    // EulerGamma is computed on demand (Brent–McMillan), not read from a fixed
    // ~858-digit literal. ψ(1), computed by an independent asymptotic series,
    // must agree with -γ to the full working precision.
    const ce = new ComputeEngine();
    ce.precision = 1000;
    ce.timeLimit = 20_000; // value test; see the beforeAll note on contention
    // γ is delivered to the full requested precision (was capped at ~858).
    expect(ce.expr('EulerGamma').N().toString().length).toBe(1002);
    const diff = ce
      .expr(['Subtract', ['Digamma', 1], ['Negate', 'EulerGamma']])
      .N();
    expect(diff.isSame(0)).toBe(true);
  });

  test('high-precision ψ(0.5) = -γ - 2ln(2)', () => {
    // ψ(0.5) = -γ - 2ln(2) ≈ -1.96351002602142347...
    expectBignum(
      bigCe.expr(['Digamma', 0.5]),
      '-1.9635100260214234794187796391751542578575793939'
    );
  });

  test('high-precision ψ₁(1) = π²/6', () => {
    // π²/6 to 50+ digits
    expectBignum(
      bigCe.expr(['Trigamma', 1]),
      '1.6449340668482264364724151666460251892189499012'
    );
  });

  test('high-precision ζ(3) (Apéry constant)', () => {
    // Apéry's constant to 50+ digits
    expectBignum(
      bigCe.expr(['Zeta', 3]),
      '1.2020569031595942853997381615114499907649862923'
    );
  });

  test('high-precision ζ(2) = π²/6', () => {
    expectBignum(
      bigCe.expr(['Zeta', 2]),
      '1.6449340668482264364724151666460251892189499012'
    );
  });

  test('high-precision B(0.5, 0.5) = π', () => {
    // bigGamma uses Lanczos-7 which limits precision to ~15 digits
    // so just check that result is close to π
    const result = bigCe.expr(['Beta', 0.5, 0.5]).N();
    const val = result.toString();
    expect(val.startsWith('3.14159265358979')).toBe(true);
  });

  test('high-precision B(2, 3) = 1/12', () => {
    const result = bigCe.expr(['Beta', 2, 3]).N();
    const val = result.toString();
    // For integer args, bigGamma is more accurate
    expect(val.startsWith('0.0833333333333333')).toBe(true);
  });

  test('high-precision W(1) (Omega constant)', () => {
    // Omega constant to 50+ digits
    expectBignum(
      bigCe.expr(['LambertW', 1]),
      '0.56714329040978387299996866221035554975381578718'
    );
  });

  test('high-precision W(e) = 1', () => {
    const result = bigCe.expr(['LambertW', { num: '2.71828182845904523536028747135266249775724709370' }]).N();
    const val = result.toString();
    // Should be 1 or very close to 1
    expect(val === '1' || val.startsWith('1.0000000000000000000') || val.startsWith('0.9999999999999999999')).toBe(true);
  });

  test('high-precision PolyGamma(2, 1) = -2ζ(3)', () => {
    // ψ₂(1) = -2 * ζ(3)
    expectBignum(
      bigCe.expr(['PolyGamma', 2, 1]),
      '-2.4041138063191885707994763230228999815299725846'
    );
  });
});

describe('B1: special functions honor requested precision', () => {
  // Regression for ROADMAP B1. The bignum Gamma/Zeta kernels (and the
  // digamma/trigamma/polygamma siblings) were effectively limited to ~machine
  // precision regardless of ce.precision: ζ(3) at p=40 diverged after ~16
  // digits because the Dirichlet-eta acceleration converged only as 2^{-n}
  // while using a (3+√8)-sized term budget, and Gamma lost its last few digits
  // to rounding. They now run with working-precision guard digits, and ζ uses
  // the genuine Cohen–Villegas–Zagier acceleration. The existing high-precision
  // tests above only checked the first 20 digits, which masked the shortfall.

  // Count leading significant digits shared by two decimal strings (ignoring
  // sign and decimal point). Both operands have the same magnitude here, so the
  // significand digits line up.
  function matchingSigDigits(a: string, b: string): number {
    const da = a.replace('-', '').replace('.', '');
    const db = b.replace('-', '').replace('.', '');
    let m = 0;
    while (m < da.length && m < db.length && da[m] === db[m]) m++;
    return m;
  }

  // Verify an exact mathematical identity holds to (p − 2) significant digits.
  // Self-checking — no external reference value to get wrong.
  function identity(name: string, lhs: string, rhs: string, p = 60) {
    test(`${name} to full precision (p=${p})`, () => {
      const ce = new ComputeEngine();
      ce.precision = p;
      const a = ce.parse(lhs).N().toString();
      const b = ce.parse(rhs).N().toString();
      expect(matchingSigDigits(a, b)).toBeGreaterThanOrEqual(p - 2);
    });
  }

  identity('Γ(1/2) = √π', '\\Gamma(1/2)', '\\sqrt{\\pi}');
  identity('Γ(5/2) = 3√π/4', '\\Gamma(5/2)', '\\frac{3\\sqrt{\\pi}}{4}');
  // Reflection Γ(s)Γ(1−s) = π/sin(πs): exercises the general Stirling path.
  identity(
    'Γ(1/3)Γ(2/3) = π/sin(π/3)',
    '\\Gamma(1/3)\\Gamma(2/3)',
    '\\frac{\\pi}{\\sin(\\pi/3)}'
  );
  identity(
    'Γ(1/7)Γ(6/7) = π/sin(π/7)',
    '\\Gamma(1/7)\\Gamma(6/7)',
    '\\frac{\\pi}{\\sin(\\pi/7)}'
  );
  // ζ even integers (exact Bernoulli path) and negative (functional equation).
  identity('ζ(2) = π²/6', '\\zeta(2)', '\\frac{\\pi^2}{6}');
  identity('ζ(4) = π⁴/90', '\\zeta(4)', '\\frac{\\pi^4}{90}');
  identity('ζ(-1) = -1/12', '\\zeta(-1)', '-1/12');
  identity('ζ(-3) = 1/120', '\\zeta(-3)', '\\frac{1}{120}');
  // ψ and ψ₂ at 1 in terms of γ and ζ(3).
  identity('ψ(1) = -γ', '\\operatorname{Digamma}(1)', '-\\gamma');
  identity('ψ₁(1) = π²/6', '\\operatorname{Trigamma}(1)', '\\frac{\\pi^2}{6}');
  identity(
    'ψ₂(1) = -2ζ(3)',
    '\\operatorname{PolyGamma}(2,1)',
    '-2\\zeta(3)'
  );

  // Trusted external constant: Apéry's ζ(3). This is the CVZ general path (odd
  // s, no closed form). 56-digit prefix avoids any last-digit rounding noise.
  test('ζ(3) matches Apéry constant at p=60', () => {
    const ce = new ComputeEngine();
    ce.precision = 60;
    const apery = '1.2020569031595942853997381615114499907649862923404988817922';
    const z3 = ce.parse('\\zeta(3)').N().toString();
    expect(z3.startsWith(apery.slice(0, 58))).toBe(true);
  });

  // The headline B1 symptom: ζ(3) at p=40 used to diverge after ~16 digits.
  test('ζ(3) is correct past 16 digits at p=40 (B1 symptom)', () => {
    const ce = new ComputeEngine();
    ce.precision = 40;
    const z3 = ce.parse('\\zeta(3)').N().toString();
    // Digits 17–40 were wrong before the fix.
    expect(z3.startsWith('1.20205690315959428539973816151144999076')).toBe(
      true
    );
  });
});

describe('GAMMA FUNCTION', () => {
  // Regression for G11: complex Gamma was an unimplemented stub that returned
  // its argument unchanged (e.g. Gamma(i).N() → i).
  function expectComplex(
    expr: any,
    re: number,
    im: number,
    tolerance = 1e-8
  ) {
    const v = expr.N();
    expect(Math.abs(v.re - re)).toBeLessThan(tolerance);
    expect(Math.abs(v.im - im)).toBeLessThan(tolerance);
  }

  test('Γ(4) = 6 (real)', () => {
    expectApprox(ce.expr(['Gamma', 4]), 6);
  });

  test('Γ(1/2) = √π (real)', () => {
    expectApprox(ce.expr(['Gamma', ['Rational', 1, 2]]), Math.sqrt(Math.PI));
  });

  test('Γ(i) ≈ -0.15495 - 0.49802i (complex)', () => {
    expectComplex(ce.expr(['Gamma', 'ImaginaryUnit']), -0.1549498283, -0.4980156681);
  });

  test('Γ(1+i) ≈ 0.49802 - 0.15495i (complex)', () => {
    expectComplex(ce.expr(['Gamma', ['Complex', 1, 1]]), 0.4980156681, -0.1549498283);
  });

  test('Γ at non-positive integers is ComplexInfinity (poles)', () => {
    expect(ce.expr(['Gamma', 0]).evaluate().json).toBe('ComplexInfinity');
    expect(ce.expr(['Gamma', -1]).evaluate().json).toBe('ComplexInfinity');
    expect(ce.expr(['Gamma', -2]).evaluate().json).toBe('ComplexInfinity');
  });

  test('GammaLn(1+i): exp(logΓ) matches Γ', () => {
    const g = ce.expr(['Gamma', ['Complex', 1, 1]]).N();
    const lg = ce.expr(['GammaLn', ['Complex', 1, 1]]).N();
    const back = ce.expr(['Exp', lg]).N();
    expect(Math.abs(back.re - g.re)).toBeLessThan(1e-8);
    expect(Math.abs(back.im - g.im)).toBeLessThan(1e-8);
  });
});

describe('FACTORIAL', () => {
  test('5! = 120', () => {
    expect(ce.expr(['Factorial', 5]).evaluate().toString()).toBe('120');
  });

  // Regression for G11: explicit Factorial(-2) was canonicalized to -(2!) = -2.
  // n! = Γ(n+1), and Γ has poles at the non-positive integers, so the
  // factorial of a negative integer is ComplexInfinity.
  test('(-2)! is ComplexInfinity (Γ pole)', () => {
    expect(ce.expr(['Factorial', -2]).evaluate().json).toBe('ComplexInfinity');
    expect(ce.expr(['Factorial', -3]).evaluate().json).toBe('ComplexInfinity');
  });

  test('(-1/2)! = √π (negative non-integer via Gamma)', () => {
    expectApprox(ce.expr(['Factorial', -0.5]), Math.sqrt(Math.PI), 1e-12);
  });

  // The unary-minus precedence convention `-3! = -(3!)` is handled by the LaTeX
  // parser, not by canonicalizing the explicit function form.
  test('LaTeX -3! parses as -(3!) and evaluates to -6', () => {
    expect(ce.parse('-3!').json).toEqual(['Negate', ['Factorial', 3]]);
    expect(ce.parse('-3!').N().toString()).toBe('-6');
  });
});

// REVIEW.md G1: the Erf/Erfc kernel was the 5-term Abramowitz & Stegun
// approximation, only ~7-digit accurate. It now uses a full machine-precision
// series (erf) and continued fraction (erfc, for large |x|).
describe('ERROR FUNCTION (REVIEW.md G1)', () => {
  test('Erf(1) full precision ≈ 0.84270079294971...', () => {
    expectApprox(ce.expr(['Erf', 1]), 0.8427007929497149, 1e-14);
  });

  test('Erf(0.5) full precision', () => {
    expectApprox(ce.expr(['Erf', 0.5]), 0.5204998778130465, 1e-14);
  });

  test('Erf is odd: Erf(-1) = -Erf(1)', () => {
    expectApprox(ce.expr(['Erf', -1]), -0.8427007929497149, 1e-14);
  });

  test('Erfc(0.5) full precision ≈ 0.47950012218695...', () => {
    expectApprox(ce.expr(['Erfc', 0.5]), 0.4795001221869534, 1e-14);
  });

  // For large x, the old `1 - erf(x)` lost all precision (erf ≈ 1). The
  // continued-fraction path keeps these accurate.
  test('Erfc(5) ≈ 1.5374597944e-12 (no 1-erf cancellation)', () => {
    expectApprox(ce.expr(['Erfc', 5]), 1.5374597944280349e-12, 1e-12);
  });

  test('Erfc(10) ≈ 2.0884875838e-45', () => {
    expectApprox(ce.expr(['Erfc', 10]), 2.0884875837625448e-45, 1e-12);
  });

  test('Erf(0) = 0, Erfc(0) = 1', () => {
    expect(ce.expr(['Erf', 0]).N().re).toBe(0);
    expect(ce.expr(['Erfc', 0]).N().re).toBe(1);
  });
});

// Imaginary error function erfi(x) = −i·erf(i·x) (ROADMAP B2 Gaussian
// antiderivative ∫e^(x²) → (√π/2)·Erfi(x)).
describe('IMAGINARY ERROR FUNCTION (Erfi)', () => {
  test('Erfi(1) ≈ 1.6504257587975428', () =>
    expectApprox(ce.expr(['Erfi', 1]), 1.6504257587975428, 1e-13));

  test('Erfi(0.5) ≈ 0.6149520946965109', () =>
    expectApprox(ce.expr(['Erfi', 0.5]), 0.6149520946965109, 1e-13));

  test('Erfi is odd: Erfi(−1) = −Erfi(1)', () =>
    expectApprox(ce.expr(['Erfi', -1]), -1.6504257587975428, 1e-13));

  test('Erfi(0) = 0, Erfi(±∞) = ±∞', () => {
    expect(ce.expr(['Erfi', 0]).N().re).toBe(0);
    expect(ce.expr(['Erfi', ce.PositiveInfinity]).evaluate().re).toBe(Infinity);
    expect(ce.expr(['Erfi', ce.NegativeInfinity]).evaluate().re).toBe(-Infinity);
  });

  test("d/dx Erfi(x) = (2/√π)·e^(x²)", () =>
    expect(ce.expr(['D', ['Erfi', 'x'], 'x']).evaluate().toString()).toEqual(
      '(2e^(x^2)) / sqrt(pi)'
    ));
});

// Sine and cosine integrals (ROADMAP B2: ∫sin x/x → Si, ∫cos x/x → Ci).
// Numeric evaluation is machine-precision only (no bignum kernel; ROADMAP B1).
describe('SINE & COSINE INTEGRALS (Si, Ci)', () => {
  test('Si(1) ≈ 0.9460830703671830', () =>
    expectApprox(ce.expr(['SinIntegral', 1]), 0.946083070367183, 1e-12));

  test('Si(2) ≈ 1.6054129768026948', () =>
    expectApprox(ce.expr(['SinIntegral', 2]), 1.6054129768026948, 1e-12));

  test('Si(10) ≈ 1.6583475942188740 (continued-fraction regime)', () =>
    expectApprox(ce.expr(['SinIntegral', 10]), 1.658347594218874, 1e-12));

  test('Si is odd: Si(−1) = −Si(1)', () =>
    expectApprox(ce.expr(['SinIntegral', -1]), -0.946083070367183, 1e-12));

  test('Si(0) = 0, Si(∞) = π/2', () => {
    expect(ce.expr(['SinIntegral', 0]).N().re).toBe(0);
    expectApprox(
      ce.expr(['SinIntegral', ce.PositiveInfinity]),
      Math.PI / 2,
      1e-12
    );
  });

  test('Ci(1) ≈ 0.3374039229009681', () =>
    expectApprox(ce.expr(['CosIntegral', 1]), 0.3374039229009681, 1e-12));

  test('Ci(2) ≈ 0.4229808287748649', () =>
    expectApprox(ce.expr(['CosIntegral', 2]), 0.4229808287748649, 1e-12));

  test('Ci(10) ≈ −0.04545643300445537', () =>
    expectApprox(ce.expr(['CosIntegral', 10]), -0.04545643300445537, 1e-12));

  test('Ci(0) = −∞', () =>
    expect(ce.expr(['CosIntegral', 0]).evaluate().re).toBe(-Infinity));

  test('d/dx Si(x) = sin(x)/x, d/dx Ci(x) = cos(x)/x', () => {
    expect(
      ce.expr(['D', ['SinIntegral', 'x'], 'x']).evaluate().toString()
    ).toEqual('sin(x) / x');
    expect(
      ce.expr(['D', ['CosIntegral', 'x'], 'x']).evaluate().toString()
    ).toEqual('cos(x) / x');
  });
});

// Exponential and logarithmic integrals (ROADMAP B2: ∫eˣ/x → Ei,
// ∫1/ln x → li). Machine-precision only (no bignum kernel; ROADMAP B1).
describe('EXPONENTIAL & LOGARITHMIC INTEGRALS (Ei, li)', () => {
  test('Ei(1) ≈ 1.8951178163559368', () =>
    expectApprox(ce.expr(['ExpIntegralEi', 1]), 1.8951178163559368, 1e-12));

  test('Ei(2) ≈ 4.954234356001890 (asymptotic-free regime)', () =>
    expectApprox(ce.expr(['ExpIntegralEi', 2]), 4.95423435600189, 1e-12));

  test('Ei(10) ≈ 2492.2289762418777', () =>
    expectApprox(ce.expr(['ExpIntegralEi', 10]), 2492.2289762418777, 1e-9));

  test('Ei(40) ≈ 6.0397182636112e15 (asymptotic-series regime)', () =>
    expectApprox(ce.expr(['ExpIntegralEi', 40]), 6.0397182636112e15, 1e-12));

  test('Ei is not odd: Ei(−1) ≈ −0.21938393439552029', () =>
    expectApprox(ce.expr(['ExpIntegralEi', -1]), -0.21938393439552029, 1e-12));

  test('Ei(0) = −∞, Ei(+∞) = +∞, Ei(−∞) = 0', () => {
    expect(ce.expr(['ExpIntegralEi', 0]).evaluate().re).toBe(-Infinity);
    expect(
      ce.expr(['ExpIntegralEi', ce.PositiveInfinity]).evaluate().re
    ).toBe(Infinity);
    expect(
      ce.expr(['ExpIntegralEi', ce.NegativeInfinity]).evaluate().re
    ).toBe(0);
  });

  // Exactness contract: a transcendental of an exact argument stays symbolic
  // under evaluate(); only .N() numericizes.
  test('Ei(2) stays symbolic under evaluate(), numericizes under N()', () => {
    expect(ce.expr(['ExpIntegralEi', 2]).evaluate().toString()).toEqual(
      'ExpIntegralEi(2)'
    );
    expectApprox(ce.expr(['ExpIntegralEi', 2]).N(), 4.95423435600189, 1e-12);
  });

  test('li(2) ≈ 1.0451637801174927', () =>
    expectApprox(ce.expr(['LogIntegral', 2]), 1.0451637801174927, 1e-12));

  test('li(10) ≈ 6.165599504787297', () =>
    expectApprox(ce.expr(['LogIntegral', 10]), 6.165599504787297, 1e-11));

  // Ramanujan–Soldner constant μ: li(μ) = 0.
  test('li(μ) = 0 at the Ramanujan–Soldner constant', () =>
    expect(
      Math.abs(ce.expr(['LogIntegral', 1.4513692348833810502]).N().re!)
    ).toBeLessThan(1e-12));

  test('li(0) = 0, li(1) = −∞', () => {
    expect(ce.expr(['LogIntegral', 0]).evaluate().re).toBe(0);
    expect(ce.expr(['LogIntegral', 1]).evaluate().re).toBe(-Infinity);
  });

  test('d/dx Ei(x) = e^x/x, d/dx li(x) = 1/ln x', () => {
    expect(
      ce.expr(['D', ['ExpIntegralEi', 'x'], 'x']).evaluate().toString()
    ).toEqual('e^x / x');
    expect(
      ce.expr(['D', ['LogIntegral', 'x'], 'x']).evaluate().toString()
    ).toEqual('1 / ln(x)');
  });
});

//
// ---------------- Tier-2 kernels (ROADMAP item 4) ----------------
// Reference values computed independently (Simpson quadrature for K/E,
// direct series for ₂F₁/₁F₁/θ/η, closed forms where available).
//

describe('ELLIPTIC INTEGRALS (parameter convention m = k²)', () => {
  test('K(0) = π/2', () => {
    expectApprox(ce.expr(['EllipticK', 0]), Math.PI / 2, 1e-14);
  });

  test('K(0.5) ≈ 1.8540746773013719', () => {
    expectApprox(ce.expr(['EllipticK', 0.5]), 1.8540746773013719, 1e-13);
  });

  test('E(0.5) ≈ 1.3506438810476755', () => {
    expectApprox(ce.expr(['EllipticE', 0.5]), 1.3506438810476755, 1e-13);
  });

  test('K(−1) ≈ 1.3110287771460598 (negative parameter)', () => {
    expectApprox(ce.expr(['EllipticK', -1]), 1.3110287771460598, 1e-13);
  });

  test('E(−1) ≈ 1.9100988945138560 (negative parameter)', () => {
    expectApprox(ce.expr(['EllipticE', -1]), 1.910098894513856, 1e-13);
  });

  test('K(0.99) ≈ 3.6956373629898747 (near the singularity)', () => {
    expectApprox(ce.expr(['EllipticK', 0.99]), 3.6956373629898747, 1e-12);
  });

  test('K(1) = +∞ exactly (Fungrim 45b157)', () => {
    expect(ce.expr(['EllipticK', 1]).evaluate().toString()).toBe('+oo');
  });

  test('E(1) = 1 exactly', () => {
    expect(ce.expr(['EllipticE', 1]).evaluate().re).toBe(1);
  });

  test('K(2) is complex: ≈ 1.3110287771 − 1.3110287771i (m > 1)', () => {
    const r = ce.expr(['EllipticK', 2]).N();
    expect(Math.abs(r.re - 1.3110287771460598)).toBeLessThan(1e-12);
    expect(Math.abs(r.im + 1.3110287771460598)).toBeLessThan(1e-12);
  });

  test('Legendre relation: E(m)K(1−m) + E(1−m)K(m) − K(m)K(1−m) = π/2', () => {
    const m = 0.3;
    const K = (x: number) => ce.expr(['EllipticK', x]).N().re;
    const E = (x: number) => ce.expr(['EllipticE', x]).N().re;
    const lhs = E(m) * K(1 - m) + E(1 - m) * K(m) - K(m) * K(1 - m);
    expect(Math.abs(lhs - Math.PI / 2)).toBeLessThan(1e-13);
  });

  test('AGM relation: K(m) = π/(2·AGM(1, √(1−m))) (Fungrim e15f43)', () => {
    const m = 0.7;
    const agmVal = ce.expr(['AGM', 1, Math.sqrt(1 - m)]).N().re;
    expectApprox(ce.expr(['EllipticK', m]), Math.PI / (2 * agmVal), 1e-13);
  });

  test('AGM(1, 2) ≈ 1.4567910310469068', () => {
    expectApprox(ce.expr(['AGM', 1, 2]), 1.4567910310469068, 1e-14);
  });

  test('AGM(z) is shorthand for AGM(1, z)', () => {
    expectApprox(ce.expr(['AGM', 2]), 1.4567910310469068, 1e-14);
  });
});

//
// ---------------- Incomplete elliptic integrals (Carlson kernels) ----------------
// Reference values from mpmath 1.4 (ellipf/ellipe/ellippi, which share the
// Mathematica argument conventions: amplitude first, parameter m = k² last).
//

describe('INCOMPLETE ELLIPTIC INTEGRALS', () => {
  test('F(0|m) = 0 exactly', () => {
    expect(ce.expr(['EllipticF', 0, 0.7]).evaluate().re).toBe(0);
  });

  test('F(0.5|0.3) ≈ 0.5061402119623553', () => {
    expectApprox(ce.expr(['EllipticF', 0.5, 0.3]), 0.5061402119623553, 1e-13);
  });

  test('F(π/2|m) = K(m)', () => {
    const F = ce.expr(['EllipticF', ['Divide', 'Pi', 2], 0.6]).N().re;
    const K = ce.expr(['EllipticK', 0.6]).N().re;
    expect(Math.abs(F - K)).toBeLessThan(1e-13);
  });

  test('F(0.7|35/33) ≈ 0.7705379731043967 (parameter > 1)', () => {
    expectApprox(
      ce.expr(['EllipticF', 0.7, ['Rational', 35, 33]]),
      0.7705379731043967,
      1e-13
    );
  });

  test('F(2.5|0.4) ≈ 2.8960580511047858 (quasi-periodic extension)', () => {
    expectApprox(ce.expr(['EllipticF', 2.5, 0.4]), 2.8960580511047858, 1e-13);
  });

  test('F(−1.1|0.7) is odd in the amplitude', () => {
    expectApprox(ce.expr(['EllipticF', -1.1, 0.7]), -1.2745510218519169, 1e-13);
  });

  test('F(1.2|1.5) is complex when m·sin²φ > 1', () => {
    // mpmath: ellipf(1.2, 1.5) ≈ 1.6566381702 − 0.8479746002i
    const r = ce.expr(['EllipticF', 1.2, 1.5]).N();
    expect(Math.abs(r.re - 1.6566381702365942)).toBeLessThan(1e-12);
    expect(Math.abs(r.im - -0.8479746001827331)).toBeLessThan(1e-12);
  });

  test('E(0|m) = 0 exactly (two-argument form)', () => {
    expect(ce.expr(['EllipticE', 0, 0.7]).evaluate().re).toBe(0);
  });

  test('E(1.2|0.9) ≈ 0.9670376602886750 (incomplete, 2-arg)', () => {
    expectApprox(ce.expr(['EllipticE', 1.2, 0.9]), 0.967037660288675, 1e-13);
  });

  test('E(π/2|m) = E(m) (incomplete at π/2 is the complete integral)', () => {
    const Einc = ce.expr(['EllipticE', ['Divide', 'Pi', 2], 0.6]).N().re;
    const E = ce.expr(['EllipticE', 0.6]).N().re;
    expect(Math.abs(Einc - E)).toBeLessThan(1e-13);
  });

  test('E(0.9|−23/39) ≈ 0.9578110789725323 (negative parameter)', () => {
    expectApprox(
      ce.expr(['EllipticE', 0.9, ['Rational', -23, 39]]),
      0.9578110789725323,
      1e-13
    );
  });

  test('Π(0.3; 0.5|0.2) ≈ 0.5166436894954441 (incomplete, 3-arg)', () => {
    expectApprox(
      ce.expr(['EllipticPi', 0.3, 0.5, 0.2]),
      0.5166436894954441,
      1e-13
    );
  });

  test('Π(0.5; 2.2|0.3) ≈ 3.7827124221245074 (quasi-periodic extension)', () => {
    expectApprox(
      ce.expr(['EllipticPi', 0.5, 2.2, 0.3]),
      3.7827124221245074,
      1e-12
    );
  });

  test('Π(0.3|0.2) ≈ 1.9935011581986862 (complete, 2-arg)', () => {
    expectApprox(ce.expr(['EllipticPi', 0.3, 0.2]), 1.9935011581986862, 1e-13);
  });

  test('Π(0; φ|m) = F(φ|m) (zero characteristic)', () => {
    const P = ce.expr(['EllipticPi', 0, 0.8, 0.4]).N().re;
    const F = ce.expr(['EllipticF', 0.8, 0.4]).N().re;
    expect(Math.abs(P - F)).toBeLessThan(1e-13);
  });
});

describe('GAUSS HYPERGEOMETRIC ₂F₁', () => {
  test('₂F₁(a,b;c;0) = 1 exactly', () => {
    expect(ce.expr(['Hypergeometric2F1', 0.3, 1.7, 2.1, 0]).evaluate().re).toBe(
      1
    );
  });

  test('₂F₁(1,1;2;z) = −ln(1−z)/z at z = 0.3', () => {
    expectApprox(
      ce.expr(['Hypergeometric2F1', 1, 1, 2, 0.3]),
      -Math.log(0.7) / 0.3,
      1e-14
    );
  });

  test('₂F₁(½,½;1;m) = 2K(m)/π at m = 0.5', () => {
    expectApprox(
      ce.expr(['Hypergeometric2F1', 0.5, 0.5, 1, 0.5]),
      (2 * 1.8540746773013719) / Math.PI,
      1e-12
    );
  });

  test('connection formula region: ₂F₁(0.3,0.7;1.5;0.75)', () => {
    expectApprox(
      ce.expr(['Hypergeometric2F1', 0.3, 0.7, 1.5, 0.75]),
      1.1741475518454894,
      1e-12
    );
  });

  test('Pfaff region z < 0: ₂F₁(½,½;1;−3) = 2K(−3)/π', () => {
    expectApprox(
      ce.expr(['Hypergeometric2F1', 0.5, 0.5, 1, -3]),
      0.6864402503091752,
      1e-12
    );
  });

  test('terminating polynomial: ₂F₁(−3,2;0.5;7) = −3297.4', () => {
    expectApprox(
      ce.expr(['Hypergeometric2F1', -3, 2, 0.5, 7]),
      -3297.4,
      1e-12
    );
  });

  test('Gauss summation at z = 1: ₂F₁(1,2;4;1) = Γ(4)Γ(1)/(Γ(3)Γ(2)) = 3', () => {
    expectApprox(ce.expr(['Hypergeometric2F1', 1, 2, 4, 1]), 3, 1e-12);
  });

  test('complex z inside the unit disk: ₂F₁(1,1;2;0.3+0.4i)', () => {
    // −ln(1−z)/z at z = 0.3+0.4i = 1.0891035324499092 + 0.2783490042218641i
    const r = ce.expr(['Hypergeometric2F1', 1, 1, 2, ['Complex', 0.3, 0.4]]).N();
    expect(Math.abs(r.re - 1.0891035324499092)).toBeLessThan(1e-12);
    expect(Math.abs(r.im - 0.2783490042218641)).toBeLessThan(1e-12);
  });
});

describe('GAUSS HYPERGEOMETRIC ₂F₁: ANALYTIC CONTINUATION z ≥ 1', () => {
  // Reference values from mpmath 1.4.1 (mp.dps = 30). Principal branch on
  // the cut z ∈ (1, ∞) is the limit from below (z − i0 convention),
  // matching mpmath and Mathematica.

  const check2F1 = (
    args: (number | unknown[])[],
    re: number,
    im: number,
    tol = 1e-12
  ) => {
    const r = ce.expr(['Hypergeometric2F1', ...args] as any).N();
    expect(Math.abs(r.re - re)).toBeLessThan(tol * Math.max(1, Math.abs(re)));
    expect(Math.abs(r.im - im)).toBeLessThan(tol * Math.max(1, Math.abs(im)));
  };

  test('generic parameters, z = 1.5', () =>
    check2F1(
      [0.3, 0.7, 1.9, 1.5],
      1.26275036536263559882960164948,
      -0.286877976158431065167345248105
    ));

  test('generic parameters, z = 3', () =>
    check2F1(
      [0.3, 0.7, 1.9, 3],
      1.03684144495064269226671491587,
      -0.485809692269339686052848039296
    ));

  test('generic parameters, z = 10', () =>
    check2F1(
      [0.3, 0.7, 1.9, 10],
      0.676634666573655551748265963152,
      -0.514792555149136754326091983874
    ));

  test('complex z outside Pfaff region: z = −2+4i', () =>
    check2F1(
      [0.3, 0.7, 1.9, ['Complex', -2, 4]],
      0.798048453819626480568708748294,
      0.129766092851309196142030013979
    ));

  test('degenerate c−a−b ∈ ℤ: ₂F₁(½,1;3/2;2)', () =>
    check2F1(
      [0.5, 1, 1.5, 2],
      0.623225240140230513394020080251,
      -1.11072073453959156175397024752
    ));

  test('degenerate a−b ∈ ℤ: ₂F₁(½,½;3/2;3)', () =>
    check2F1(
      [0.5, 0.5, 1.5, 3],
      0.906899682117108925297039128821,
      -0.661768020759984578967052612674
    ));

  test('doubly degenerate ₂F₁(1,1;2;4) = −ln(1−z)/z (perturbed path, ~1e-9)', () =>
    check2F1(
      [1, 1, 2, 4],
      -0.274653072167027422848811309231,
      -0.78539816339744830961566084582,
      1e-8
    ));

  test('near-degenerate parameters: ₂F₁(2.5,1.5;4.001;2.5)', () =>
    check2F1(
      [2.5, 1.5, 4.001, 2.5],
      -1.7292523919101244716764712394,
      0.224706399221015210639347904464,
      1e-12
    ));

  test('far along the cut: ₂F₁(½,1;3/2;1000)', () =>
    check2F1(
      [0.5, 1, 1.5, 1000],
      0.001000333533673446908569856316,
      -0.049672941327234008204255470241,
      1e-11
    ));

  test('degenerate slow-convergence gap z → 1⁻: ₂F₁(½,½;2;0.99)', () =>
    check2F1([0.5, 0.5, 2, 0.99], 1.25914024483453058004986685984, 0, 1e-12));

  test('just above/below the cut are conjugates', () => {
    const above = ce
      .expr(['Hypergeometric2F1', 0.7, 1.3, 2.1, ['Complex', 2, 1e-8]])
      .N();
    const below = ce
      .expr(['Hypergeometric2F1', 0.7, 1.3, 2.1, ['Complex', 2, -1e-8]])
      .N();
    expect(Math.abs(above.re - below.re)).toBeLessThan(1e-6);
    expect(Math.abs(above.im + below.im)).toBeLessThan(1e-6);
    // On-cut value matches the limit from below
    const onCut = ce.expr(['Hypergeometric2F1', 0.7, 1.3, 2.1, 2]).N();
    expect(Math.abs(onCut.im - below.im)).toBeLessThan(1e-6);
    expect(onCut.im).toBeLessThan(0);
  });
});

describe('APPELL F₁', () => {
  // Reference values from mpmath 1.4.1 appellf1 (mp.dps = 25)
  test('F₁(a; b₁, b₂; c; 0, 0) = 1 exactly', () => {
    expect(
      ce.expr(['AppellF1', 0.5, 0.3, 0.7, 1.5, 0, 0]).evaluate().re
    ).toBe(1);
  });

  test('generic arguments in the unit bidisk', () => {
    expectApprox(
      ce.expr(['AppellF1', 0.5, 0.3, 0.7, 1.5, 0.4, -0.6]),
      0.9300535584584346754744453,
      1e-13
    );
    expectApprox(
      ce.expr(['AppellF1', 2, 0.5, 1.5, 3.5, -0.8, 0.9]),
      3.774476419098384890015794,
      1e-12
    );
  });

  test('terminating b₁ index allows |x| > 1', () => {
    expectApprox(
      ce.expr(['AppellF1', 0.5, -2, 0.5, 1.5, 3, 0.2]),
      0.847918058054131974583958,
      1e-13
    );
  });

  test('outside the convergence domain stays symbolic', () => {
    const r = ce.expr(['AppellF1', 0.5, 0.3, 0.7, 1.5, 2, 3]).N();
    expect(r.operator).toBe('AppellF1');
  });
});

describe('KUMMER CONFLUENT HYPERGEOMETRIC ₁F₁', () => {
  test('₁F₁(a;b;0) = 1 exactly', () => {
    expect(ce.expr(['Hypergeometric1F1', 0.3, 1.7, 0]).evaluate().re).toBe(1);
  });

  test('₁F₁(1;2;z) = (eᶻ−1)/z at z = 2', () => {
    expectApprox(
      ce.expr(['Hypergeometric1F1', 1, 2, 2]),
      (Math.exp(2) - 1) / 2,
      1e-14
    );
  });

  test('Kummer transformation region z < 0: ₁F₁(½;3/2;−4) = √π·erf(2)/4', () => {
    expectApprox(
      ce.expr(['Hypergeometric1F1', 0.5, 1.5, -4]),
      0.44104069538121077,
      1e-13
    );
  });

  test('generic parameters: ₁F₁(2.5;1.2;3.7) ≈ 235.41539872666385', () => {
    expectApprox(
      ce.expr(['Hypergeometric1F1', 2.5, 1.2, 3.7]),
      235.41539872666385,
      1e-12
    );
  });
});

describe('JACOBI THETA FUNCTIONS (Fungrim convention, q = e^{iπτ})', () => {
  test('θ₃(0, i) = π^{1/4}/Γ(3/4) ≈ 1.0864348112133080', () => {
    expectApprox(
      ce.expr(['JacobiTheta', 3, 0, 'ImaginaryUnit']),
      1.086434811213308,
      1e-13
    );
  });

  test('θ₁(0, τ) = 0 (odd function)', () => {
    const r = ce.expr(['JacobiTheta', 1, 0, 'ImaginaryUnit']).N();
    expect(Math.abs(r.re)).toBeLessThan(1e-15);
  });

  test('θ₁(0.2, 0.3+0.5i) ≈ 0.80085043984 + 0.13798118531i', () => {
    const r = ce
      .expr(['JacobiTheta', 1, 0.2, ['Complex', 0.3, 0.5]])
      .N();
    expect(Math.abs(r.re - 0.8008504398413848)).toBeLessThan(1e-12);
    expect(Math.abs(r.im - 0.13798118530588993)).toBeLessThan(1e-12);
  });

  test('Jacobi identity: θ₂⁴(0,τ) + θ₄⁴(0,τ) = θ₃⁴(0,τ)', () => {
    const th = (j: number) =>
      ce.expr(['JacobiTheta', j, 0, ['Complex', 0.1, 1.2]]).N();
    const p4 = (c: any) => {
      // (re+im·i)⁴ via complex arithmetic on the boxed result
      const re = c.re;
      const im = c.im;
      const r2 = re * re - im * im;
      const i2 = 2 * re * im;
      return [r2 * r2 - i2 * i2, 2 * r2 * i2];
    };
    const [t2r, t2i] = p4(th(2));
    const [t3r, t3i] = p4(th(3));
    const [t4r, t4i] = p4(th(4));
    expect(Math.abs(t2r + t4r - t3r)).toBeLessThan(1e-12);
    expect(Math.abs(t2i + t4i - t3i)).toBeLessThan(1e-12);
  });

  test('derivative order r > 0 stays symbolic', () => {
    const r = ce.expr(['JacobiTheta', 3, 0, 'ImaginaryUnit', 1]).N();
    expect(r.operator).toBe('JacobiTheta');
  });

  test('Im(τ) ≤ 0 stays symbolic', () => {
    const r = ce.expr(['JacobiTheta', 3, 0, 0.5]).N();
    expect(r.operator).toBe('JacobiTheta');
  });
});

describe('DEDEKIND ETA FUNCTION', () => {
  test('η(i) = Γ(1/4)/(2π^{3/4}) ≈ 0.7682254223260566', () => {
    expectApprox(
      ce.expr(['DedekindEta', 'ImaginaryUnit']),
      0.7682254223260566,
      1e-13
    );
  });

  test('η(0.25+0.75i) ≈ 0.82051454510 + 0.04638173129i', () => {
    const r = ce.expr(['DedekindEta', ['Complex', 0.25, 0.75]]).N();
    expect(Math.abs(r.re - 0.8205145451012408)).toBeLessThan(1e-12);
    expect(Math.abs(r.im - 0.04638173128620445)).toBeLessThan(1e-12);
  });

  test('η(τ+1) = e^{iπ/12}·η(τ) (modular transformation)', () => {
    const a = ce.expr(['DedekindEta', ['Complex', 1.3, 0.8]]).N();
    const b = ce.expr(['DedekindEta', ['Complex', 0.3, 0.8]]).N();
    const phase = Math.PI / 12;
    const expectedRe = b.re * Math.cos(phase) - b.im * Math.sin(phase);
    const expectedIm = b.re * Math.sin(phase) + b.im * Math.cos(phase);
    expect(Math.abs(a.re - expectedRe)).toBeLessThan(1e-13);
    expect(Math.abs(a.im - expectedIm)).toBeLessThan(1e-13);
  });

  test('real τ stays symbolic (needs Im(τ) > 0)', () => {
    const r = ce.expr(['DedekindEta', 0.5]).N();
    expect(r.operator).toBe('DedekindEta');
  });
});

describe('EISENSTEIN SERIES', () => {
  test('E₂(i) = 3/π ≈ 0.954929658551372', () => {
    expectApprox(
      ce.expr(['EisensteinE', 2, 'ImaginaryUnit']),
      3 / Math.PI,
      1e-12
    );
  });

  test('E₄(i) ≈ 1.4557628922687093', () => {
    expectApprox(
      ce.expr(['EisensteinE', 4, 'ImaginaryUnit']),
      1.4557628922687093,
      1e-12
    );
  });

  test('E₆(i) = 0 (i is an elliptic fixed point)', () => {
    const r = ce.expr(['EisensteinE', 6, 'ImaginaryUnit']).N();
    expect(Math.hypot(r.re, r.im ?? 0)).toBeLessThan(1e-12);
  });

  test('E₄(e^{2πi/3}) = 0 (the other elliptic fixed point)', () => {
    const r = ce
      .expr(['EisensteinE', 4, ['Complex', -0.5, Math.sqrt(3) / 2]])
      .N();
    expect(Math.hypot(r.re, r.im ?? 0)).toBeLessThan(1e-11);
  });

  test('Eisenstein relation E₈ = E₄²: E₈(i) = E₄(i)²', () => {
    const e4 = ce.expr(['EisensteinE', 4, 'ImaginaryUnit']).N().re;
    expectApprox(ce.expr(['EisensteinE', 8, 'ImaginaryUnit']), e4 * e4, 1e-11);
  });

  test('real τ stays symbolic (needs Im(τ) > 0)', () => {
    const r = ce.expr(['EisensteinE', 4, 0.5]).N();
    expect(r.operator).toBe('EisensteinE');
  });

  test('odd weight stays symbolic', () => {
    const r = ce.expr(['EisensteinE', 3, 'ImaginaryUnit']).N();
    expect(r.operator).toBe('EisensteinE');
  });

  test('exact argument stays symbolic under evaluate()', () => {
    expect(
      ce.expr(['EisensteinE', 4, 'ImaginaryUnit']).evaluate().operator
    ).toBe('EisensteinE');
  });
});

describe('TIER-2 KERNELS: BIGNUM PRECISION', () => {
  // `ce.precision` mutates the GLOBAL BigDecimal.precision static:
  // use a dedicated engine and restore precision afterwards.
  let bigCe: ComputeEngine;
  beforeAll(() => {
    bigCe = new ComputeEngine();
    bigCe.precision = 50;
  });
  afterAll(() => {
    bigCe.precision = 21;
  });

  test('K(0.5) to 50 digits', () => {
    // mpmath: 1.8540746773013719184338503471952600462175988235217
    expect(bigCe.expr(['EllipticK', 0.5]).N().toString()).toMatch(
      /^1\.854074677301371918433850347195260046217598823521/
    );
  });

  test('₂F₁(1,1;2;0.5) = 2·ln 2 to 50 digits', () => {
    // 2ln2 = 1.3862943611198906188344642429163531361510002687205
    expect(
      bigCe.expr(['Hypergeometric2F1', 1, 1, 2, 0.5]).N().toString()
    ).toMatch(/^1\.386294361119890618834464242916353136151000268720/);
  });

  test('₁F₁(1;2;2) = (e²−1)/2 to 50 digits', () => {
    // (e^2-1)/2 = 3.1945280494653251136152137302875039065901577852759
    expect(
      bigCe.expr(['Hypergeometric1F1', 1, 2, 2]).N().toString()
    ).toMatch(/^3\.194528049465325113615213730287503906590157785275/);
  });
});

// Wave-4 NU-P1 numeric-precision fixes. References independently computed with
// mpmath (≥25 guard digits). erfInv references are of the exact IEEE double
// input (the value a machine kernel actually receives), not the exact real.
describe('WAVE-4 NU-P1 numeric precision', () => {
  let bigCe: InstanceType<typeof ComputeEngine>;
  let saved: number;
  beforeAll(() => {
    saved = ce.precision;
    bigCe = new ComputeEngine();
    bigCe.precision = 50;
  });
  afterAll(() => {
    // BigDecimal.precision is process-global: re-sync the shared engine.
    ce.precision = saved;
  });

  test('NU-P1-9: erfInv near +1 recovers full machine precision', () => {
    // Newton on erf(y)−ax cancels near ±1; the fix iterates on erfc.
    expect(erfInv(1 - 1e-12)).toBeCloseTo(5.0420318985726961, 10);
    expect(erfInv(1 - 1e-8)).toBeCloseTo(4.0522372432687634, 10);
    expect(erfInv(-(1 - 1e-12))).toBeCloseTo(-5.0420318985726961, 10);
    // Away from ±1 unchanged.
    expect(erfInv(0.5)).toBeCloseTo(0.47693627620446987, 15);
  });

  test('NU-P1-10: high-precision LambertW is rounded to working precision', () => {
    // Was printing 2× precision with a ~100-digit garbage tail.
    const s = bigCe.expr(['LambertW', 3]).N().toString();
    expect(s).toMatch(/^1\.0499088949640399599886970705528979045894669437063/);
    // No garbage tail: at precision 50 the mantissa is ≤ ~51 digits.
    expect(s.replace('.', '').length).toBeLessThanOrEqual(52);
  });

  test('NU-P1-2: 2F1 integer c−a−b, z near 1 (was NaN → symbolic)', () => {
    // Direct series now covers z ∈ (0.95, 1) at full working precision.
    expect(bigCe.expr(['Hypergeometric2F1', 1, 1, 2, 0.99]).N().toString()).toMatch(
      /^4\.6516870565536276444807908175/
    );
    expect(bigCe.expr(['Hypergeometric2F1', 1, 2, 3, 0.97]).N().toString()).toMatch(
      /^5\.3917693640556524107572274895/
    );
  });

  test('NU-P1-2: 2F1 Pfaff image z ≲ −19 (was NaN → symbolic)', () => {
    expect(bigCe.expr(['Hypergeometric2F1', 1, 1, 2, -40]).N().toString()).toMatch(
      /^0\.0928393016676076950966690843259/
    );
  });
});
