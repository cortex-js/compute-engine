/**
 * Branch-cut-safe simplification (ROADMAP item 7a).
 *
 * The analytic-property store records each function's branch cuts; `onBranchCut`
 * exposes "is this argument provably on the cut", and the log-combination rules
 * consult it so they never combine across a branch cut.
 *
 * The motivating bug: `ln(a) + ln(b) → ln(ab)` is only valid on the principal
 * branch. For arguments on the negative real axis the principal values differ
 * by a multiple of `2πi` — e.g. `ln(-2) + ln(-3) = ln(6) + 2πi`, NOT `ln(6)`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { onBranchCut } from '../../src/compute-engine/function-properties';

const ce = new ComputeEngine();

/** Numeric value as a [re, im] pair (NaN-safe). */
function nv(src: string): [number, number] {
  const n = ce.parse(src).simplify().N();
  return [n.re ?? NaN, n.im ?? NaN];
}
function trueNv(src: string): [number, number] {
  const n = ce.parse(src).N();
  return [n.re ?? NaN, n.im ?? NaN];
}
const close = (a: [number, number], b: [number, number]) =>
  Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

describe('onBranchCut — store-driven branch-cut membership', () => {
  it('reports negative reals on the Ln branch cut', () => {
    expect(onBranchCut(ce, 'Ln', ce.parse('-2'))).toBe(true);
    expect(onBranchCut(ce, 'Ln', ce.parse('-1/2'))).toBe(true);
  });

  it('reports positive reals and non-real points off the cut', () => {
    expect(onBranchCut(ce, 'Ln', ce.parse('2'))).toBe(false);
    expect(onBranchCut(ce, 'Ln', ce.parse('\\imaginaryI'))).toBe(false);
  });

  it('fails closed on undecidable / symbolic arguments', () => {
    expect(onBranchCut(ce, 'Ln', ce.parse('x'))).toBe(false);
  });

  it('returns false for operators with no branch-cut record', () => {
    expect(onBranchCut(ce, 'Sqrt', ce.parse('-2'))).toBe(false);
    expect(onBranchCut(ce, 'NotAFunction', ce.parse('-2'))).toBe(false);
  });
});

describe('log-combination is blocked across a branch cut', () => {
  it('does not combine ln of two negative reals', () => {
    const r = ce.parse('\\ln(-2)+\\ln(-3)').simplify();
    // The wrong answer would be ln(6); the result must NOT equal it.
    expect(r.isSame(ce.parse('\\ln(6)'))).toBe(false);
    // ...and it must stay numerically faithful to the input (ln 6 + 2πi).
    expect(close(nv('\\ln(-2)+\\ln(-3)'), trueNv('\\ln(-2)+\\ln(-3)'))).toBe(
      true
    );
    // sanity: the true value really is off the real axis (im = 2π)
    expect(Math.abs(trueNv('\\ln(-2)+\\ln(-3)')[1] - 2 * Math.PI)).toBeLessThan(
      1e-9
    );
  });

  it('does not combine three negative-real ln terms', () => {
    const r = ce.parse('\\ln(-2)+\\ln(-3)+\\ln(-5)').simplify();
    expect(r.isSame(ce.parse('\\ln(-30)'))).toBe(false);
    expect(r.isSame(ce.parse('\\ln(30)'))).toBe(false);
  });

  it('does not combine log (base 10) of negative reals', () => {
    const r = ce.parse('\\log(-2)+\\log(-5)').simplify();
    expect(r.isSame(ce.parse('\\log(10)'))).toBe(false);
    expect(close(nv('\\log(-2)+\\log(-5)'), trueNv('\\log(-2)+\\log(-5)'))).toBe(
      true
    );
  });
});

describe('sound and symbolic combinations are unaffected (no churn)', () => {
  // Each of these must keep its pre-guard simplified form.
  const cases: [string, string][] = [
    ['\\ln(2)+\\ln(3)', 'ln(6)'],
    ['\\ln(x)+\\ln(y)', 'ln(x * y)'],
    ['\\ln(a)-\\ln(b)', 'ln(a / b)'],
    ['\\log(x)+\\log(y)', 'log(x * y)'],
  ];
  for (const [src, expected] of cases) {
    it(`${src} → ${expected}`, () => {
      expect(ce.parse(src).simplify().toString()).toBe(expected);
    });
  }

  it('positive-real combine stays numerically faithful', () => {
    expect(close(nv('\\ln(2)+\\ln(3)'), trueNv('\\ln(2)+\\ln(3)'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// log-power / quotient expansion: ln(b^n) → n·ln(b), ln(a/b) → ln(a) − ln(b)
//
// Done by the `.ln()` method (boxed-function.ts) and simplify-log.ts; both are
// now gated on `onBranchCut`. `ln(√a)` is exempt — √ shares Ln's principal
// branch, so `ln(√a) = ½ln(a)` holds on the whole plane.
// ---------------------------------------------------------------------------

/** [re, im] of `expr` simplified then evaluated at x = v, and of the exact
 *  (un-simplified) expression — used to assert the rewrite is faithful. */
function soundAt(engine: ComputeEngine, src: string, v: number): boolean {
  const e = engine.parse(src);
  const s = e.simplify();
  const o = e.subs({ x: v, a: v }).N();
  const w = s.subs({ x: v, a: v }).N();
  return (
    Math.abs((o.re ?? NaN) - (w.re ?? NaN)) < 1e-9 &&
    Math.abs((o.im ?? 0) - (w.im ?? 0)) < 1e-9
  );
}

describe('log-power expansion is blocked across a branch cut', () => {
  it('ln(x^n) with x provably negative stays numerically sound', () => {
    const neg = new ComputeEngine();
    neg.assume(neg.parse('x<0'));
    for (const src of ['\\ln(x^2)', '\\ln(x^3)', '\\ln(x^4)', '\\ln(x^5)'])
      expect(soundAt(neg, src, -3)).toBe(true);
    // odd powers cannot use a |x| form, so they stay symbolic (not 3ln(x))
    expect(neg.parse('\\ln(x^3)').simplify().toString()).toBe('ln(x^3)');
    // even powers take the sound |x| form (printed as -x since x < 0)
    expect(neg.parse('\\ln(x^2)').simplify().toString()).toBe('2ln(-x)');
  });

  it('ln(x^n) with x unconstrained keeps the optimistic n·ln(x) (no churn)', () => {
    const u = new ComputeEngine();
    expect(u.parse('\\ln(x^2)').simplify().toString()).toBe('2ln(x)');
    expect(u.parse('\\ln(x^3)').simplify().toString()).toBe('3ln(x)');
  });

  it('ln(√a) stays ½ln(a) and is sound even for a < 0', () => {
    const neg = new ComputeEngine();
    neg.assume(neg.parse('a<0'));
    expect(neg.parse('\\ln(\\sqrt{a})').simplify().toString()).toBe(
      '1/2 * ln(a)'
    );
    expect(soundAt(neg, '\\ln(\\sqrt{a})', -3)).toBe(true);
  });
});
