import { ComputeEngine } from '../../src/compute-engine';

/**
 * B13 Wester cluster, round 1 — two simplify() improvements:
 *
 *  1. Trig Pythagorean factoring: a sum with a common trig factor is reduced
 *     via cos²+sin² = 1 even when the shared factor is not a bare coefficient
 *     (e.g. cos³x + cos x·sin²x − cos x → 0).
 *
 *  2. Rational-function cancellation in simplify(): a common polynomial factor
 *     is cancelled (Wester 14: (x²−4)/(x²+4x+4) → (x−2)/(x+2)), and — crucially
 *     — the cancellation is no longer re-inflated by a following expand step.
 *
 * All identities below were verified numerically before being encoded.
 */

const ce = new ComputeEngine();

describe('B13 round 1 — trig Pythagorean factoring', () => {
  test('cos³x + cos x·sin²x − cos x → 0', () => {
    expect(
      ce.parse('\\cos^3{x} + \\cos{x}\\sin^2{x} - \\cos{x}').simplify().json
    ).toBe(0);
  });

  test('bare Pythagorean sin²x + cos²x → 1', () => {
    expect(ce.parse('\\sin^2{x} + \\cos^2{x}').simplify().json).toBe(1);
  });

  test('coefficient Pythagorean 3cos²x + 3sin²x → 3', () => {
    expect(ce.parse('3\\cos^2{x} + 3\\sin^2{x}').simplify().json).toBe(3);
  });

  test('common non-numeric factor 2x·cos²t + 2x·sin²t → 2x', () => {
    expect(
      ce.parse('2x\\cos^2{t} + 2x\\sin^2{t}').simplify().isSame(ce.parse('2x'))
    ).toBe(true);
  });

  // Negative: different arguments must NOT collapse.
  test('cos²x + sin²y (different args) does NOT collapse', () => {
    const r = ce.parse('\\cos^2{x} + \\sin^2{y}').simplify();
    expect(r.isSame(ce.One)).toBe(false);
    expect(r.json).toEqual([
      'Add',
      ['Power', ['Cos', 'x'], 2],
      ['Power', ['Sin', 'y'], 2],
    ]);
  });
});

describe('B13 round 1 — rational-function cancellation in simplify()', () => {
  // Wester 14. NOTE: CE serializes `x − 2` canonically as ['Add', 'x', -2],
  // not ['Subtract', 'x', 2].
  test('(x²−4)/(x²+4x+4) → (x−2)/(x+2)', () => {
    const r = ce.parse('\\frac{x^2-4}{x^2+4x+4}').simplify();
    expect(r.json).toEqual(['Divide', ['Add', 'x', -2], ['Add', 'x', 2]]);
    expect(r.isSame(ce.parse('\\frac{x-2}{x+2}'))).toBe(true);
  });

  test('(x²−1)/(x−1) → x + 1', () => {
    expect(ce.parse('\\frac{x^2-1}{x-1}').simplify().json).toEqual([
      'Add',
      'x',
      1,
    ]);
  });

  test('(x²−4)/(x−2) → x + 2 (denominator collapses to 1)', () => {
    expect(ce.parse('\\frac{x^2-4}{x-2}').simplify().json).toEqual([
      'Add',
      'x',
      2,
    ]);
  });

  test('(x+1)/(x²+3x+2) → 1/(x+2)', () => {
    expect(ce.parse('\\frac{x+1}{x^2+3x+2}').simplify().json).toEqual([
      'Divide',
      1,
      ['Add', 'x', 2],
    ]);
  });

  // Negative: coprime numerator/denominator must stay unchanged.
  test('(x²+1)/(x+1) does NOT change', () => {
    expect(ce.parse('\\frac{x^2+1}{x+1}').simplify().json).toEqual([
      'Divide',
      ['Add', ['Power', 'x', 2], 1],
      ['Add', 'x', 1],
    ]);
  });
});

describe('B13 round 1 — recursion / cancellation regressions', () => {
  // Historical hazard: n/π triggered infinite recursion in cancellation.
  test('n/π does not recurse and stays n/π', () => {
    const start = Date.now();
    const r = ce.parse('\\frac{n}{\\pi}').simplify();
    expect(Date.now() - start).toBeLessThan(2000);
    expect(r.json).toEqual(['Divide', 'n', 'Pi']);
  });

  // x/x is folded to 1 at canonicalization (generic-symbol convention), not by
  // the cancellation rule — confirm it still holds.
  test('x/x → 1 (at canonicalization)', () => {
    expect(ce.parse('\\frac{x}{x}').json).toBe(1);
    expect(ce.parse('\\frac{x}{x}').simplify().json).toBe(1);
  });

  test('(x²−4)/(x−2) cancellation does not hang', () => {
    const start = Date.now();
    const r = ce.parse('\\frac{x^2-4}{x-2}').simplify();
    expect(Date.now() - start).toBeLessThan(2000);
    expect(r.json).toEqual(['Add', 'x', 2]);
  });
});
