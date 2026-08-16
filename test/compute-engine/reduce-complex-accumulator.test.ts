import { ComputeEngine } from '../../src/compute-engine';

// `Reduce`'s compiled fast path (numeric approximation over a real seed and a
// real collection) folds with JS numbers. It gated the SEED and the ELEMENTS
// on being real but not the reducer's RESULT: a reducer whose body turns
// complex — `(z, k) ↦ z² + c` with a complex `c` — returned a `{re, im}` object
// into the number accumulator, the real-lane body then computed `z * z` on an
// object, and boxing the result raised `unexpected-mathjson` from `.N()` while
// `.evaluate()` was correct (reported by Tycho against 0.112.0 / 0.113.0).
// The fast path now hands the fold to the interpreted reducer at the first
// non-number result, redoing that step from the still-valid numeric
// accumulator.
describe('Reduce: a reducer whose accumulator turns complex mid-fold', () => {
  const REF = { re: -0.25, im: 0.5 }; // ((0² + c)² + c)² + c at c = −0.5 + 0.5i

  test('declared complex `c` bound by subs: .N() agrees with .evaluate()', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'complex');
    const e = ce.parse('\\operatorname{Reduce}([1,2,3], (z,k) \\mapsto z^2 + c, 0)');
    const sub = e.subs({ c: ce.box(['Complex', -0.5, 0.5]) });
    for (const v of [sub.evaluate(), sub.N()]) {
      expect(v.operator).not.toBe('Error');
      expect(v.re).toBeCloseTo(REF.re, 12);
      expect(v.im).toBeCloseTo(REF.im, 12);
    }
  });

  test('assigned complex `c` and a complex literal take the same path', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'complex');
    ce.assign('c', ce.box(['Complex', -0.5, 0.5]));
    const viaAssign = ce
      .parse('\\operatorname{Reduce}([1,2,3], (z,k) \\mapsto z^2 + c, 0)')
      .N();
    const viaLiteral = ce
      .parse('\\operatorname{Reduce}([1,2,3], (z,k) \\mapsto z^2 + (-0.5+0.5i), 0)')
      .N();
    for (const v of [viaAssign, viaLiteral]) {
      expect(v.re).toBeCloseTo(REF.re, 12);
      expect(v.im).toBeCloseTo(REF.im, 12);
    }
  });

  test('a real reducer keeps the compiled fast path (seeded and seedless)', () => {
    const ce = new ComputeEngine();
    expect(
      ce.parse('\\operatorname{Reduce}([1,2,3], (a,x) \\mapsto a + x^2, 0)').N().re
    ).toBe(14);
    expect(
      ce.parse('\\operatorname{Reduce}([1,2,3], (a,x) \\mapsto a + x^2)').N().re
    ).toBe(14);
  });

  test('a free `c` stays symbolic on both surfaces (no error)', () => {
    const ce = new ComputeEngine();
    ce.declare('c', 'complex');
    const e = ce.parse('\\operatorname{Reduce}([1,2,3], (z,k) \\mapsto z^2 + c, 0)');
    expect(e.evaluate().operator).not.toBe('Error');
    expect(e.N().operator).not.toBe('Error');
  });
});
