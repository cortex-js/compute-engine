/**
 * One-sided limits at JUMP discontinuities.
 *
 * Direct substitution used to claim the value AT the point for a
 * jump-discontinuous subterm: `lim_{x→0⁻} |x|/x` reached `sgn(x)/1` through
 * L'Hôpital and answered `sgn(0) = 0` — where the one-sided limits are ∓1
 * and the two-sided limit does not exist. `substituteAtFinitePoint`
 * (`symbolic/limit.ts`) now resolves an on-jump `JUMP_FNS` subterm per
 * direction (the side read from the offset's leading Laurent sign), and a
 * two-sided limit over a jump combines the two directions — equal sides are
 * the limit, unequal sides stay inert.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

function limitOf(
  body: unknown,
  point: number,
  dir?: number
): string {
  const ops: unknown[] = [['Function', body, 'x'], point];
  if (dir !== undefined) ops.push(dir);
  return ce.box(['Limit', ...ops] as any).evaluate().toString();
}

describe('one-sided limits at jump discontinuities', () => {
  test('|x|/x — the L’Hôpital-to-Sign witness', () => {
    expect(ce.parse('\\lim_{x\\to 0^-}\\frac{|x|}{x}').evaluate().toString())
      .toBe('-1');
    expect(ce.parse('\\lim_{x\\to 0^+}\\frac{|x|}{x}').evaluate().toString())
      .toBe('1');
    // Sides disagree: the two-sided limit stays inert.
    expect(
      ce.parse('\\lim_{x\\to 0}\\frac{|x|}{x}').evaluate().operator
    ).toBe('Limit');
  });

  test('Sign', () => {
    expect(limitOf(['Sign', 'x'], 0, -1)).toBe('-1');
    expect(limitOf(['Sign', 'x'], 0, 1)).toBe('1');
    expect(ce.box(['Limit', ['Function', ['Sign', 'x'], 'x'], 0]).evaluate().operator).toBe('Limit');
    // Equal sides resolve the two-sided limit.
    expect(limitOf(['Power', ['Sign', 'x'], 2], 0)).toBe('1');
  });

  test('Heaviside', () => {
    expect(limitOf(['Heaviside', 'x'], 0, -1)).toBe('0');
    expect(limitOf(['Heaviside', 'x'], 0, 1)).toBe('1');
  });

  test('Floor and Ceil at an integer', () => {
    expect(limitOf(['Floor', 'x'], 1, -1)).toBe('0');
    expect(limitOf(['Floor', 'x'], 1, 1)).toBe('1');
    // `Ceil` is the engine's ceiling operator (`Ceiling` is an inert
    // name and gets NO invented limit semantics).
    expect(limitOf(['Ceil', 'x'], 1, -1)).toBe('1');
    expect(limitOf(['Ceil', 'x'], 1, 1)).toBe('2');
    expect(limitOf(['Floor', 'x'], -1, -1)).toBe('-2');
    expect(limitOf(['Floor', 'x'], -1, 1)).toBe('-1');
    // Off the jump, substitution is direct, as before.
    expect(limitOf(['Floor', 'x'], 0.5)).toBe('0');
  });

  test('unclassifiable shapes decline instead of substituting', () => {
    // Two-operand Round jumps on a scaled lattice this analysis does not
    // model: the limit stays inert rather than claim the point value.
    expect(
      ce.box(['Limit', ['Function', ['Round', 'x', 1], 'x'], 0.5, 1])
        .evaluate().operator
    ).toBe('Limit');
  });

  test('a negative modulus swaps the plateaus', () => {
    // The engine's Mod takes the divisor's sign: for m = −3 the value is
    // in (−3, 0], decaying to −3 from ABOVE a multiple.
    expect(limitOf(['Mod', 'x', -3], 0, 1)).toBe('-3');
    expect(limitOf(['Mod', 'x', -3], 0, -1)).toBe('0');
    expect(limitOf(['Mod', 'x', 3], -3, -1)).toBe('3');
    expect(limitOf(['Mod', 'x', 3], -3, 1)).toBe('0');
  });

  test('nested jumps resolve innermost first', () => {
    expect(limitOf(['Sign', ['Sign', 'x']], 0, 1)).toBe('1');
    expect(limitOf(['Sign', ['Sign', 'x']], 0, -1)).toBe('-1');
    expect(limitOf(['Power', ['Sign', ['Sign', 'x']], 2], 0)).toBe('1');
  });

  test('Round at a half-integer', () => {
    expect(limitOf(['Round', 'x'], 0.5, -1)).toBe('0');
    expect(limitOf(['Round', 'x'], 0.5, 1)).toBe('1');
    expect(limitOf(['Round', 'x'], -0.5, -1)).toBe('-1');
    expect(limitOf(['Round', 'x'], -0.5, 1)).toBe('0');
  });

  test('Mod at a multiple of the modulus', () => {
    expect(limitOf(['Mod', 'x', 3], 3, -1)).toBe('3');
    expect(limitOf(['Mod', 'x', 3], 3, 1)).toBe('0');
  });

  test('a jump under a composite argument reads the argument’s approach', () => {
    // sgn(x³): the offset x³ has odd valuation, so the left side is still
    // negative — the Laurent sign, not a naive "direction of x", decides.
    expect(limitOf(['Sign', ['Power', 'x', 3]], 0, -1)).toBe('-1');
    // sgn(x²): both sides approach 0 from above — the two-sided limit is 1.
    expect(limitOf(['Sign', ['Power', 'x', 2]], 0)).toBe('1');
  });

  test('continuous cases are untouched', () => {
    expect(ce.parse('\\lim_{x\\to 0}\\frac{\\sin x}{x}').evaluate().toString())
      .toBe('1');
    // |x| itself is kink-continuous, not a jump.
    expect(limitOf(['Abs', 'x'], 0)).toBe('0');
  });
});
