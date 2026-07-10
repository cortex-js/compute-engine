import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// Residue of `f` (function of `v`) at `v = a`, evaluated exactly.
function res(f: any, v: string, a: any) {
  return ce.expr(['Residue', f, v, a]).evaluate();
}
// Numeric value of the residue (re + i·im).
function resN(f: any, v: string, a: any) {
  const r = ce.expr(['Residue', f, v, a]).N();
  return { re: r.re, im: r.im };
}

describe('RESIDUE (ROADMAP item 7c)', () => {
  describe('rational functions — simple poles', () => {
    test('1/(x-1) at 1 → 1', () => {
      expect(res(['Divide', 1, ['Subtract', 'x', 1]], 'x', 1).re).toBe(1);
    });
    test('1/(x²-1) at ±1 → ±1/2', () => {
      const f = ['Divide', 1, ['Subtract', ['Power', 'x', 2], 1]];
      expect(res(f, 'x', 1).re).toBeCloseTo(0.5, 12);
      expect(res(f, 'x', -1).re).toBeCloseTo(-0.5, 12);
    });
    test('a pole at a complex point: 1/(z²+1) at i → -i/2', () => {
      const r = resN(['Divide', 1, ['Add', ['Power', 'z', 2], 1]], 'z', [
        'Complex',
        0,
        1,
      ]);
      expect(r.re).toBeCloseTo(0, 12);
      expect(r.im).toBeCloseTo(-0.5, 12);
    });
  });

  describe('higher-order poles', () => {
    test('1/(x-1)² at 1 → 0', () => {
      expect(res(['Divide', 1, ['Power', ['Subtract', 'x', 1], 2]], 'x', 1).re).toBe(
        0
      );
    });
    test('(3x+2)/(x-1)² at 1 → 3', () => {
      const f = [
        'Divide',
        ['Add', ['Multiply', 3, 'x'], 2],
        ['Power', ['Subtract', 'x', 1], 2],
      ];
      expect(res(f, 'x', 1).re).toBe(3);
    });
    test('eˣ/(x-1)² at 1 → e', () => {
      const f = ['Divide', ['Exp', 'x'], ['Power', ['Subtract', 'x', 1], 2]];
      expect(res(f, 'x', 1).N().re).toBeCloseTo(Math.E, 10);
    });
    test('eˣ/(x-1)³ at 1 → e/2', () => {
      const f = ['Divide', ['Exp', 'x'], ['Power', ['Subtract', 'x', 1], 3]];
      expect(res(f, 'x', 1).N().re).toBeCloseTo(Math.E / 2, 10);
    });
  });

  describe('transcendental and analytic', () => {
    test('cot x = cos/sin at 0 → 1', () => {
      expect(res(['Divide', ['Cos', 'x'], ['Sin', 'x']], 'x', 0).re).toBeCloseTo(
        1,
        12
      );
    });
    test('an analytic function has residue 0', () => {
      expect(res(['Power', 'x', 2], 'x', 1).re).toBe(0);
      expect(res(['Exp', 'x'], 'x', 0).re).toBe(0);
    });
  });

  describe('special functions (analytic-property store gated)', () => {
    test('Gamma at -n → (-1)ⁿ/n!', () => {
      expect(res(['Gamma', 'x'], 'x', 0).re).toBe(1); // 1/0!
      expect(res(['Gamma', 'x'], 'x', -1).re).toBe(-1); // -1/1!
      expect(res(['Gamma', 'x'], 'x', -2).re).toBeCloseTo(0.5, 12); // 1/2!
      expect(res(['Gamma', 'x'], 'x', -3).re).toBeCloseTo(-1 / 6, 12); // -1/3!
    });
    test('Digamma at non-positive integers → -1', () => {
      expect(res(['Digamma', 'x'], 'x', 0).re).toBe(-1);
      expect(res(['Digamma', 'x'], 'x', -2).re).toBe(-1);
    });
    test('Zeta at 1 → 1', () => {
      expect(res(['Zeta', 's'], 's', 1).re).toBe(1);
    });
    test('a special function away from its poles has residue 0', () => {
      expect(res(['Gamma', 'x'], 'x', 2).re).toBe(0);
    });
    test('numeric evaluation', () => {
      expect(ce.expr(['Residue', ['Gamma', 'x'], 'x', -2]).N().re).toBeCloseTo(
        0.5,
        12
      );
    });
  });

  describe('composite special-function residues (h·s factorization)', () => {
    test('a constant multiple: 2·Gamma(x) at -2 → 1', () => {
      expect(res(['Multiply', 2, ['Gamma', 'x']], 'x', -2).re).toBeCloseTo(1, 12);
    });
    test('an analytic cofactor: Gamma(x)/(x-5) at -2 → -1/14', () => {
      const r = res(
        ['Divide', ['Gamma', 'x'], ['Subtract', 'x', 5]],
        'x',
        -2
      ).N();
      expect(r.re).toBeCloseTo(-1 / 14, 12);
    });
    test('a polynomial cofactor: x²·Digamma(x) at -1 → -1', () => {
      expect(
        res(['Multiply', ['Power', 'x', 2], ['Digamma', 'x']], 'x', -1).re
      ).toBe(-1);
    });
    test('the factorization is gated: 1/(x-1) at 1 is NOT spuriously 0', () => {
      // 1 is a recorded pole of Zeta; the body has no Zeta, so the residue must
      // come from the generic method (→ 1), not a spurious Zeta factorization.
      expect(res(['Divide', 1, ['Subtract', 'x', 1]], 'x', 1).re).toBe(1);
    });
    test('a second singularity is resolved exactly by the Laurent kernel (item 7c)', () => {
      // Gamma(x)/(x+2) at -2 is an order-2 pole (Γ's own pole times the
      // rational one). This used to defer; the Laurent expansion gives the
      // exact residue: Γ(x) = ½·u⁻¹ + (¾ − γ/2) + O(u) with u = x+2, so
      // Γ(x)/(x+2) has c₋₁ = ¾ − γ/2 ≈ 0.46139. Verified numerically against
      // ε-probes of u·(Γ(−2+u)/u − ½u⁻²).
      const r = res(['Divide', ['Gamma', 'x'], ['Add', 'x', 2]], 'x', -2);
      expect(r.N().re).toBeCloseTo(0.75 - 0.5772156649015329 / 2, 10);
    });
  });

  describe('Laurent-kernel residues (item 7c)', () => {
    test('a special-function cofactor: Γ(x)·ζ(x) at 1 → Γ(1) = 1', () => {
      // The h·s factorization can't reach this (the cofactor is itself a
      // special function); the Laurent product expansion can.
      const r = res(['Multiply', ['Gamma', 'x'], ['Zeta', 'x']], 'x', 1);
      expect(r.N().re).toBeCloseTo(1, 12);
    });
    test('a double special pole: Γ(x)² at 0 → −2γ', () => {
      // Γ(x)² = x⁻² − 2γ·x⁻¹ + …; verified numerically against
      // ε·(Γ(ε)² − ε⁻²) → −2γ.
      const r = res(['Square', ['Gamma', 'x']], 'x', 0);
      expect(r.json).toEqual(['Multiply', -2, 'EulerGamma']);
    });
    test('a double special pole: ζ(s)² at 1 → 2γ', () => {
      // (1/u + γ + …)² = u⁻² + 2γ·u⁻¹ + …
      const r = res(['Square', ['Zeta', 'x']], 'x', 1);
      expect(r.json).toEqual(['Multiply', 2, 'EulerGamma']);
    });
    test('the polygamma ladder: ψ₁(x)/x at 0 → π²/6', () => {
      // ψ₁(x) = x⁻² + π²/6 − 2ζ(3)x + …, so ψ₁/x has c₋₁ = ψ₁'s constant
      // term π²/6. Verified numerically against ε·(ψ₁(ε)/ε − ε⁻³).
      const r = res(['Divide', ['Trigamma', 'x'], 'x'], 'x', 0);
      expect(r.N().re).toBeCloseTo(Math.PI ** 2 / 6, 10);
    });
    test('a deep rational pole through the kernel: 1/(x⁵(1−x)) at 0 → 1', () => {
      const r = res(
        ['Divide', 1, ['Multiply', ['Power', 'x', 5], ['Subtract', 1, 'x']]],
        'x',
        0
      );
      expect(r.re).toBe(1);
    });
  });

  describe('residue at infinity (7c follow-up rung)', () => {
    // Res_∞ f = −Res_{s=0} f(1/s)/s²; any infinite point spelling names the
    // Riemann-sphere point at infinity. For a rational function, Res_∞ is
    // the negated sum of the finite residues (total residue over the
    // sphere is 0) — each value below is checked against that identity.
    test('1/x at ∞ → −1', () => {
      expect(res(['Divide', 1, 'x'], 'x', 'ComplexInfinity').re).toBe(-1);
      // +∞ spelling names the same sphere point
      expect(res(['Divide', 1, 'x'], 'x', { num: '+Infinity' }).re).toBe(-1);
    });
    test('an entire function: x at ∞ → 0', () => {
      expect(res('x', 'x', 'ComplexInfinity').re).toBe(0);
    });
    test('1/(x²+1) at ∞ → 0 (finite residues cancel)', () => {
      expect(
        res(['Divide', 1, ['Add', ['Power', 'x', 2], 1]], 'x', 'ComplexInfinity')
          .re
      ).toBe(0);
    });
    test('(3x²+2)/(x³+x) at ∞ → −3 (= −Σ finite residues −(2+½+½))', () => {
      const f = [
        'Divide',
        ['Add', ['Multiply', 3, ['Power', 'x', 2]], 2],
        ['Add', ['Power', 'x', 3], 'x'],
      ];
      expect(res(f, 'x', 'ComplexInfinity').re).toBe(-3);
    });
  });

  describe('Beta poles via the Γ-quotient rewrite (7c follow-up rung)', () => {
    // B(a, b) = Γ(a)Γ(b)/Γ(a+b); values verified numerically:
    // ε·B(ε, 3) → 1 and (x+1)·B(x, ½)|_{x=−1+ε} → ½ at ε = 1e−6.
    test('Res_{x=0} B(x, 3) = 1', () => {
      expect(res(['Beta', 'x', 3], 'x', 0).re).toBe(1);
    });
    test('Res_{x=−1} B(x, ½) = ½ (exact Γ-quotient form)', () => {
      const r = res(['Beta', 'x', ['Rational', 1, 2]], 'x', -1);
      expect(r.N().re).toBeCloseTo(0.5, 10);
    });
    test('lim_{x→0} x·B(x, 3) = 1', () => {
      expect(
        ce
          .expr([
            'Limit',
            ['Function', ['Multiply', 'x', ['Beta', 'x', 3]], 'x'],
            0,
          ])
          .evaluate().re
      ).toBe(1);
    });
  });
});
