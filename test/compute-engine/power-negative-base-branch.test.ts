import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { realPowerBranchTerms } from '../../src/compute-engine/boxed-expression/arithmetic-power';

/**
 * A negative base with an exact rational exponent `p/q` in lowest terms and an
 * ODD `q` has a real principal value — `(−8)^(2/3) = 4`, matching
 * `Root(−8, 3) = −2`. Three components used to answer this question
 * separately: the `Power` type handler read the EXACT rational, while `.N()`
 * and the compiled constant fold both recovered `p/q` from the exponent's
 * DOUBLE by continued fractions. `100/3` reconstructs to the dyadic
 * `4691249611844267/140737488355328`, whose denominator is EVEN, so
 * `(−2)^(100/3)` was `finite_number` to the type, complex to `.N()`, and `NaN`
 * to the compiler. They now share one decision (`realPowerBranchTerms`).
 */

const ce = new ComputeEngine();

function parts(e: any): { re: number; im: number } {
  const n = e.N();
  return { re: n.re, im: n.im };
}

function folded(e: any): number | { re: number; im: number } {
  const r = compile(e, { fallback: false });
  return (r.run as any)!() as any;
}

describe('NEGATIVE BASE: exact-rational branch decision', () => {
  describe('realPowerBranchTerms', () => {
    it('uses the EXACT rational when one is available', () => {
      expect(realPowerBranchTerms([100, 3], 100 / 3)).toEqual([100, 3]);
      expect(realPowerBranchTerms([2, 3], 2 / 3)).toEqual([2, 3]);
      // Reduced, not as-written.
      expect(realPowerBranchTerms([200, 6], 100 / 3)).toEqual([100, 3]);
      // An even denominator stays even.
      expect(realPowerBranchTerms([3, 2], 1.5)).toEqual([3, 2]);
    });

    it('recovers the rational a double was rounded from', () => {
      // Without the ulp-scale tolerance this is the dyadic
      // 4691249611844267/140737488355328 — an EVEN denominator.
      expect(realPowerBranchTerms(undefined, 100 / 3)).toEqual([100, 3]);
      expect(realPowerBranchTerms(undefined, -100 / 3)).toEqual([-100, 3]);
      expect(realPowerBranchTerms(undefined, 1000 / 7)).toEqual([1000, 7]);
      expect(realPowerBranchTerms(undefined, 2 / 3)).toEqual([2, 3]);
    });

    it('does NOT snap a genuine decimal to a nearby small rational', () => {
      // 0.3333333333 is not 1/3: it keeps its own (even-denominator) terms.
      const t = realPowerBranchTerms(undefined, 0.3333333333)!;
      expect(t[1] % 2).toBe(0);
      expect(realPowerBranchTerms(undefined, 0.3)).toEqual([3, 10]);
      expect(realPowerBranchTerms(undefined, 0.25)).toEqual([1, 4]);
    });

    it('declines a non-finite value with no exact rational', () => {
      expect(realPowerBranchTerms(undefined, NaN)).toBeUndefined();
      expect(realPowerBranchTerms(undefined, Infinity)).toBeUndefined();
    });
  });

  describe('the 100/3 witness', () => {
    const expr = ce.box(['Power', -2, ['Rational', 100, 3]]);
    const expected = Math.pow(2, 100 / 3); // ≈ 1.0822639e10, REAL

    it('is typed finite_number', () => {
      expect(expr.type.toString()).toBe('finite_number');
    });

    it('.N() is the REAL +2^(100/3)', () => {
      const { re, im } = parts(expr);
      expect(im).toBe(0);
      expect(re / expected).toBeCloseTo(1, 12);
    });

    it('the compiled constant agrees with .N()', () => {
      expect(folded(expr)).toBe(expected);
    });

    it('a FLOAT exponent of the same value decides the same branch', () => {
      // `.N()` only ever sees the double, so the float route must land on the
      // same branch as the exact one.
      const f = ce.box(['Power', -2, 100 / 3]);
      expect(f.type.toString()).toBe('finite_number');
      expect(parts(f).im).toBe(0);
      expect(folded(f)).toBe(expected);
    });
  });

  describe('branch decisions that must not move', () => {
    const rows: [string, any, 'real' | 'complex'][] = [
      ['(-8)^(2/3)', ['Power', -8, ['Rational', 2, 3]], 'real'],
      ['(-2)^(2/3)', ['Power', -2, ['Rational', 2, 3]], 'real'],
      ['(-8)^(5/3)', ['Power', -8, ['Rational', 5, 3]], 'real'],
      ['Root(-8, 3)', ['Root', -8, 3], 'real'],
      ['(-2)^0.3', ['Power', -2, 0.3], 'complex'],
      ['(-8)^(3/2)', ['Power', -8, ['Rational', 3, 2]], 'complex'],
      ['Root(-8, 4)', ['Root', -8, 4], 'complex'],
      ['(-2)^(1/4)', ['Power', -2, ['Rational', 1, 4]], 'complex'],
    ];

    for (const [label, json, branch] of rows) {
      it(`${label} is ${branch}, and type/.N()/compiled agree`, () => {
        const e = ce.box(json);
        const { re, im } = parts(e);
        if (branch === 'real') {
          expect(Math.abs(im)).toBe(0);
          expect(e.type.matches('complex') && !e.type.matches('real')).toBe(
            false
          );
          expect(folded(e)).toBeCloseTo(re, 6);
        } else {
          expect(im).not.toBe(0);
          expect(e.type.toString()).toBe('finite_complex');
          const f = folded(e) as { re: number; im: number };
          expect(f.re).toBeCloseTo(re, 6);
          expect(f.im).toBeCloseTo(im, 6);
        }
      });
    }

    it('(-2)^2 is the plain integer power', () => {
      const e = ce.box(['Power', -2, 2]);
      expect(e.type.toString()).toBe('finite_integer');
      expect(e.N().re).toBe(4);
      expect(folded(e)).toBe(4);
    });

    it('a symbolic real base keeps the real Math.pow lowering', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('r', 'real');
      const e = ce2.box(['Power', 'r', 0.3]);
      expect(e.type.toString()).toBe('finite_number');
      expect(compile(e, { fallback: false }).code).toBe('Math.pow(_.r, 0.3)');
    });
  });

  describe('compiled ≡ .N() sweep over negative bases', () => {
    it('agrees on every base/exponent pair', () => {
      const bases = [-2, -8, -1, -3, -27, -0.5, -1.5, -100, -7, -1000];
      const exps: any[] = [];
      for (const q of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16])
        for (const p of [1, 2, 3, 5, 7, 11, 100, 101, -1, -2, -5, -100])
          exps.push(['Rational', p, q]);
      for (const f of [
        0.3, 0.5, 1.5, 2.5, 0.25, 0.75, 1 / 3, 2 / 3, 5 / 3, 100 / 3, 1 / 7,
        22 / 7, 0.3333333333, -0.3, -100 / 3, 0.1, 1.2, 4.9, -2.5, 3.75,
      ])
        exps.push(f);

      let compared = 0;
      const mismatches: string[] = [];
      for (const b of bases) {
        for (const e of exps) {
          const expr = ce.box(['Power', b, e]);
          const r = compile(expr, { fallback: false });
          if (!r.success || !r.run) continue;
          const v = (r.run as any)() as any;
          const c =
            typeof v === 'number' ? { re: v, im: 0 } : { re: v.re, im: v.im };
          const n = parts(expr);
          if (!Number.isFinite(n.re) || !Number.isFinite(n.im)) continue;
          compared += 1;
          // Complex agreement is measured against the MODULUS: the polar
          // `Complex.pow` leaves ~1e-15 relative dust on a component the
          // interpreter snaps to an exact zero, which is not a disagreement
          // about the value.
          const scale = Math.max(
            1e-300,
            Math.hypot(c.re, c.im),
            Math.hypot(n.re, n.im)
          );
          const d = Math.hypot(c.re - n.re, c.im - n.im);
          if (!(d <= 1e-9 * scale))
            mismatches.push(
              `(${b})^${JSON.stringify(e)}: compiled ${JSON.stringify(c)} vs N ${JSON.stringify(n)}`
            );
        }
      }
      expect(mismatches).toEqual([]);
      expect(compared).toBeGreaterThan(1000);
    });
  });
});
