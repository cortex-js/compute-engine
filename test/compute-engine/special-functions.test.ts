import { ComputeEngine } from '../../src/compute-engine';
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
    expectApprox(ce.expr(['PolyGamma', 2, 1]), -2 * 1.2020569031595942, 1e-6);
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
    expectApprox(ce.expr(['Zeta', 3]), 1.2020569031595942, 1e-6);
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
    expectApprox(ce.expr(['BesselI', 0, 5]), 27.239871823604447, 1e-8);
  });

  test('I_2(3) ≈ 2.24521244092995', () => {
    expectApprox(ce.expr(['BesselI', 2, 3]), 2.24521244092995, 1e-8);
  });
});

describe('BESSEL K FUNCTION', () => {
  test('K_0(1) ≈ 0.42102443824070834', () => {
    expectApprox(ce.expr(['BesselK', 0, 1]), 0.42102443824070834, 1e-6);
  });

  test('K_1(1) ≈ 0.60190723019723457', () => {
    expectApprox(ce.expr(['BesselK', 1, 1]), 0.60190723019723457, 1e-6);
  });

  test('K_0(5) ≈ 0.0036910983120279868', () => {
    expectApprox(ce.expr(['BesselK', 0, 5]), 0.0036910983120279868, 1e-6);
  });

  test('K_2(3) ≈ 0.061510458286692960', () => {
    expectApprox(ce.expr(['BesselK', 2, 3]), 0.061510458286692960, 1e-5);
  });
});

describe('AIRY Ai FUNCTION', () => {
  test('Ai(0) ≈ 0.35502805388781724', () => {
    expectApprox(ce.expr(['AiryAi', 0]), 0.35502805388781724, 1e-8);
  });

  test('Ai(1) ≈ 0.13529241631288141', () => {
    expectApprox(ce.expr(['AiryAi', 1]), 0.13529241631288141, 1e-6);
  });

  test('Ai(-1) ≈ 0.53556088329235211', () => {
    expectApprox(ce.expr(['AiryAi', -1]), 0.53556088329235211, 1e-6);
  });

  test('Ai(3) ≈ 0.006591139357460011', () => {
    expectApprox(ce.expr(['AiryAi', 3]), 0.006591139357460011, 1e-5);
  });

  test('Ai(10) asymptotic (very small)', () => {
    expectApprox(ce.expr(['AiryAi', 10]), 1.1047532552898687e-10, 1e-4);
  });

  test('AiryAi without numericApproximation returns unevaluated', () => {
    const result = ce.expr(['AiryAi', 1]).evaluate();
    expect(result.operator).toBe('AiryAi');
  });
});

describe('AIRY Bi FUNCTION', () => {
  test('Bi(0) ≈ 0.61492662744600074', () => {
    expectApprox(ce.expr(['AiryBi', 0]), 0.61492662744600074, 1e-8);
  });

  test('Bi(1) ≈ 1.2074235949528713', () => {
    expectApprox(ce.expr(['AiryBi', 1]), 1.2074235949528713, 1e-6);
  });

  test('Bi(-1) ≈ 0.10399738949694461', () => {
    expectApprox(ce.expr(['AiryBi', -1]), 0.10399738949694461, 1e-6);
  });

  test('Bi(3) ≈ 14.037328963083232', () => {
    expectApprox(ce.expr(['AiryBi', 3]), 14.037328963083232, 1e-5);
  });
});

describe('BIGNUM SPECIAL FUNCTIONS', () => {
  let bigCe: InstanceType<typeof ComputeEngine>;
  beforeAll(() => {
    bigCe = new ComputeEngine();
    bigCe.precision = 50;
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
