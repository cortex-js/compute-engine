import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

// Residue of `f` (function of `v`) at `v = a`, evaluated exactly.
function res(f: any, v: string, a: any) {
  return ce.box(['Residue', f, v, a]).evaluate();
}
// Numeric value of the residue (re + i·im).
function resN(f: any, v: string, a: any) {
  const r = ce.box(['Residue', f, v, a]).N();
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
      expect(ce.box(['Residue', ['Gamma', 'x'], 'x', -2]).N().re).toBeCloseTo(
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
    test('a second singularity defers rather than returning a wrong value', () => {
      // Gamma(x)/(x+2) at -2 is an order-2 pole; the simple-pole factorization
      // must not fire, and the generic method can't expand Gamma → unevaluated.
      const r = res(['Divide', ['Gamma', 'x'], ['Add', 'x', 2]], 'x', -2);
      expect(r.operator).toBe('Residue');
    });
  });

  describe('deferral', () => {
    test('residue at infinity stays unevaluated', () => {
      const r = ce.box([
        'Residue',
        ['Divide', 1, 'x'],
        'x',
        { num: '+Infinity' },
      ]);
      expect(r.evaluate().operator).toBe('Residue');
    });
  });
});
