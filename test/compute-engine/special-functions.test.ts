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
    expectApprox(ce.box(['Digamma', 1]), -0.5772156649015329);
  });

  test('ψ(2) = 1 - γ', () => {
    expectApprox(ce.box(['Digamma', 2]), 1 - 0.5772156649015329);
  });

  test('ψ(0.5) = -γ - 2ln(2)', () => {
    expectApprox(
      ce.box(['Digamma', 0.5]),
      -0.5772156649015329 - 2 * Math.log(2)
    );
  });

  test('ψ(5) = 1 + 1/2 + 1/3 + 1/4 - γ', () => {
    expectApprox(
      ce.box(['Digamma', 5]),
      1 + 1 / 2 + 1 / 3 + 1 / 4 - 0.5772156649015329
    );
  });

  test('ψ(10) reference value', () => {
    // NIST/Wolfram: ψ(10) ≈ 2.25175258906672
    expectApprox(ce.box(['Digamma', 10]), 2.25175258906672, 1e-8);
  });

  test('Digamma without numericApproximation returns unevaluated', () => {
    const result = ce.box(['Digamma', 1]).evaluate();
    expect(result.operator).toBe('Digamma');
  });
});

describe('TRIGAMMA FUNCTION', () => {
  test('ψ₁(1) = π²/6', () => {
    expectApprox(ce.box(['Trigamma', 1]), (Math.PI * Math.PI) / 6);
  });

  test('ψ₁(2) = π²/6 - 1', () => {
    expectApprox(ce.box(['Trigamma', 2]), (Math.PI * Math.PI) / 6 - 1);
  });

  test('ψ₁(0.5) = π²/2', () => {
    expectApprox(ce.box(['Trigamma', 0.5]), (Math.PI * Math.PI) / 2);
  });
});

describe('POLYGAMMA FUNCTION', () => {
  test('ψ₀(1) = ψ(1) = -γ', () => {
    expectApprox(ce.box(['PolyGamma', 0, 1]), -0.5772156649015329);
  });

  test('ψ₁(1) = π²/6 (via PolyGamma)', () => {
    expectApprox(ce.box(['PolyGamma', 1, 1]), (Math.PI * Math.PI) / 6);
  });

  test('ψ₂(1) = -2ζ(3) ≈ -2.404113806', () => {
    // ψ₂(1) = -2 * ζ(3) where ζ(3) ≈ 1.2020569031595942
    expectApprox(ce.box(['PolyGamma', 2, 1]), -2 * 1.2020569031595942, 1e-6);
  });
});

describe('BETA FUNCTION', () => {
  test('B(1, 1) = 1', () => {
    expectApprox(ce.box(['Beta', 1, 1]), 1);
  });

  test('B(2, 3) = 1/12', () => {
    expectApprox(ce.box(['Beta', 2, 3]), 1 / 12);
  });

  test('B(0.5, 0.5) = π', () => {
    expectApprox(ce.box(['Beta', 0.5, 0.5]), Math.PI, 1e-8);
  });

  test('B(3, 4) = 1/60', () => {
    expectApprox(ce.box(['Beta', 3, 4]), 1 / 60);
  });
});

describe('ZETA FUNCTION', () => {
  test('ζ(2) = π²/6', () => {
    expectApprox(ce.box(['Zeta', 2]), (Math.PI * Math.PI) / 6);
  });

  test('ζ(4) = π⁴/90', () => {
    expectApprox(ce.box(['Zeta', 4]), Math.PI ** 4 / 90);
  });

  test('ζ(3) ≈ 1.2020569031595942 (Apery constant)', () => {
    expectApprox(ce.box(['Zeta', 3]), 1.2020569031595942, 1e-6);
  });

  test('ζ(0) = -1/2', () => {
    expectApprox(ce.box(['Zeta', 0]), -0.5);
  });

  test('ζ(-1) = -1/12', () => {
    expectApprox(ce.box(['Zeta', -1]), -1 / 12, 1e-8);
  });

  test('ζ(6) = π⁶/945', () => {
    expectApprox(ce.box(['Zeta', 6]), Math.PI ** 6 / 945);
  });
});

describe('LAMBERT W FUNCTION', () => {
  test('W(0) = 0', () => {
    expectApprox(ce.box(['LambertW', 0]), 0);
  });

  test('W(1) ≈ 0.5671432904097838 (Omega constant)', () => {
    expectApprox(ce.box(['LambertW', 1]), 0.5671432904097838);
  });

  test('W(e) = 1', () => {
    // Use numeric value of e
    expectApprox(
      ce.box(['LambertW', { num: '2.718281828459045' }]),
      1,
      1e-10
    );
  });

  test('W(-1/e) = -1 (branch point)', () => {
    // Use numeric value of -1/e
    expectApprox(
      ce.box(['LambertW', { num: '-0.36787944117144233' }]),
      -1,
      1e-10
    );
  });

  test('W(x)·e^W(x) = x verification for x=2', () => {
    const w = ce.box(['LambertW', 2]).N();
    const wVal = w.re;
    expect(Math.abs(wVal * Math.exp(wVal) - 2)).toBeLessThan(1e-12);
  });

  test('W(100) verification', () => {
    const w = ce.box(['LambertW', 100]).N();
    const wVal = w.re;
    expect(Math.abs(wVal * Math.exp(wVal) - 100)).toBeLessThan(1e-10);
  });
});

describe('BESSEL J FUNCTION', () => {
  test('J_0(0) = 1', () => {
    expectApprox(ce.box(['BesselJ', 0, 0]), 1);
  });

  test('J_1(0) = 0', () => {
    expectApprox(ce.box(['BesselJ', 1, 0]), 0);
  });

  test('J_0(1) ≈ 0.7651976865579666', () => {
    expectApprox(ce.box(['BesselJ', 0, 1]), 0.7651976865579666);
  });

  test('J_1(1) ≈ 0.44005058574493355', () => {
    expectApprox(ce.box(['BesselJ', 1, 1]), 0.44005058574493355);
  });

  test('J_0(5) ≈ -0.17759677131433830', () => {
    expectApprox(ce.box(['BesselJ', 0, 5]), -0.17759677131433830, 1e-8);
  });

  test('J_2(3) ≈ 0.48609126058589108', () => {
    expectApprox(ce.box(['BesselJ', 2, 3]), 0.48609126058589108, 1e-8);
  });

  test('J_5(10) ≈ -0.23406152818679364', () => {
    // Large argument, tests Miller/asymptotic regime
    expectApprox(ce.box(['BesselJ', 5, 10]), -0.23406152818679364, 1e-6);
  });

  test('J_0(50) asymptotic regime', () => {
    // Tests asymptotic expansion for large x
    expectApprox(ce.box(['BesselJ', 0, 50]), 0.05581232766925048, 1e-6);
  });

  test('BesselJ without numericApproximation returns unevaluated', () => {
    const result = ce.box(['BesselJ', 0, 1]).evaluate();
    expect(result.operator).toBe('BesselJ');
  });
});

describe('BESSEL Y FUNCTION', () => {
  test('Y_0(1) ≈ 0.08825696421567696', () => {
    expectApprox(ce.box(['BesselY', 0, 1]), 0.08825696421567696, 1e-6);
  });

  test('Y_1(1) ≈ -0.78121282130028876', () => {
    expectApprox(ce.box(['BesselY', 1, 1]), -0.78121282130028876, 1e-6);
  });

  test('Y_0(5) ≈ -0.30851762524903357', () => {
    expectApprox(ce.box(['BesselY', 0, 5]), -0.30851762524903357, 1e-6);
  });

  test('Y_2(3) ≈ -0.16040039348492377', () => {
    expectApprox(ce.box(['BesselY', 2, 3]), -0.16040039348492377, 1e-5);
  });

  test('Y_0(50) asymptotic regime', () => {
    expectApprox(ce.box(['BesselY', 0, 50]), -0.09806499547007692, 1e-5);
  });
});

describe('BESSEL I FUNCTION', () => {
  test('I_0(0) = 1', () => {
    expectApprox(ce.box(['BesselI', 0, 0]), 1);
  });

  test('I_1(0) = 0', () => {
    expectApprox(ce.box(['BesselI', 1, 0]), 0);
  });

  test('I_0(1) ≈ 1.2660658777520084', () => {
    expectApprox(ce.box(['BesselI', 0, 1]), 1.2660658777520084);
  });

  test('I_1(1) ≈ 0.56515910399248503', () => {
    expectApprox(ce.box(['BesselI', 1, 1]), 0.56515910399248503);
  });

  test('I_0(5) ≈ 27.239871823604447', () => {
    expectApprox(ce.box(['BesselI', 0, 5]), 27.239871823604447, 1e-8);
  });

  test('I_2(3) ≈ 2.24521244092995', () => {
    expectApprox(ce.box(['BesselI', 2, 3]), 2.24521244092995, 1e-8);
  });
});

describe('BESSEL K FUNCTION', () => {
  test('K_0(1) ≈ 0.42102443824070834', () => {
    expectApprox(ce.box(['BesselK', 0, 1]), 0.42102443824070834, 1e-6);
  });

  test('K_1(1) ≈ 0.60190723019723457', () => {
    expectApprox(ce.box(['BesselK', 1, 1]), 0.60190723019723457, 1e-6);
  });

  test('K_0(5) ≈ 0.0036910983120279868', () => {
    expectApprox(ce.box(['BesselK', 0, 5]), 0.0036910983120279868, 1e-6);
  });

  test('K_2(3) ≈ 0.061510458286692960', () => {
    expectApprox(ce.box(['BesselK', 2, 3]), 0.061510458286692960, 1e-5);
  });
});

describe('AIRY Ai FUNCTION', () => {
  test('Ai(0) ≈ 0.35502805388781724', () => {
    expectApprox(ce.box(['AiryAi', 0]), 0.35502805388781724, 1e-8);
  });

  test('Ai(1) ≈ 0.13529241631288141', () => {
    expectApprox(ce.box(['AiryAi', 1]), 0.13529241631288141, 1e-6);
  });

  test('Ai(-1) ≈ 0.53556088329235211', () => {
    expectApprox(ce.box(['AiryAi', -1]), 0.53556088329235211, 1e-6);
  });

  test('Ai(3) ≈ 0.006591139357460011', () => {
    expectApprox(ce.box(['AiryAi', 3]), 0.006591139357460011, 1e-5);
  });

  test('Ai(10) asymptotic (very small)', () => {
    expectApprox(ce.box(['AiryAi', 10]), 1.1047532552898687e-10, 1e-4);
  });

  test('AiryAi without numericApproximation returns unevaluated', () => {
    const result = ce.box(['AiryAi', 1]).evaluate();
    expect(result.operator).toBe('AiryAi');
  });
});

describe('AIRY Bi FUNCTION', () => {
  test('Bi(0) ≈ 0.61492662744600074', () => {
    expectApprox(ce.box(['AiryBi', 0]), 0.61492662744600074, 1e-8);
  });

  test('Bi(1) ≈ 1.2074235949528713', () => {
    expectApprox(ce.box(['AiryBi', 1]), 1.2074235949528713, 1e-6);
  });

  test('Bi(-1) ≈ 0.10399738949694461', () => {
    expectApprox(ce.box(['AiryBi', -1]), 0.10399738949694461, 1e-6);
  });

  test('Bi(3) ≈ 14.037328963083232', () => {
    expectApprox(ce.box(['AiryBi', 3]), 14.037328963083232, 1e-5);
  });
});
