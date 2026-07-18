import { ComputeEngine } from '../../src/compute-engine';

// Regression tests for the 2026-07-18 mathematical-correctness audit of the
// `sgn` handlers. Each case pins a claim that was previously wrong (or
// missing) against the evaluated ground truth.

describe('SGN HANDLER AUDIT', () => {
  const ce = new ComputeEngine();

  it('Gamma: 0 and negative integers are poles (~oo), not zero', () => {
    // Γ(0) was reported as 'zero'; Γ never vanishes.
    expect(ce.box(['Gamma', 0]).sgn).toBe('unsigned');
    expect(ce.box(['Gamma', -3]).sgn).toBe('unsigned');
    expect(ce.box(['Gamma', 2]).sgn).toBe('positive');
    // Negative non-integer: sign alternates between poles — no claim.
    expect(ce.box(['Gamma', ['Rational', -1, 2]]).sgn).toBeUndefined();
  });

  it('Log: the sign only flips for a base in (0,1), not for base ≤ 0', () => {
    // log_(-2)(2) is complex; it was reported 'negative'.
    expect(ce.box(['Log', 2, -2]).sgn).toBe('unsigned');
    expect(ce.box(['Log', 2, ['Rational', 1, 2]]).sgn).toBe('negative');
    expect(ce.box(['Log', 2, 10]).sgn).toBe('positive');
  });

  it('Truncate: |x| < 1 truncates to zero', () => {
    // trunc(1/2) = 0; the sign of x alone was previously claimed.
    expect(ce.box(['Truncate', ['Rational', 1, 2]]).sgn).toBe('zero');
    expect(ce.box(['Truncate', ['Rational', -1, 2]]).sgn).toBe('zero');
    expect(ce.box(['Truncate', ['Rational', 3, 2]]).sgn).toBe('positive');
    expect(ce.box(['Truncate', ['Rational', -3, 2]]).sgn).toBe('negative');
  });

  it('Round: halves round away from zero, matching evaluate', () => {
    // Round(-1/2) evaluates to -1; the literal branch used Math.round
    // (ties toward +∞) and claimed 'zero'.
    expect(ce.box(['Round', ['Rational', -1, 2]]).sgn).toBe('negative');
    expect(ce.box(['Round', ['Rational', 1, 2]]).sgn).toBe('positive');
    expect(ce.box(['Round', ['Rational', -1, 4]]).sgn).toBe('zero');
  });

  it('GCD/LCM: zero arguments', () => {
    // gcd(0,0) = 0 and lcm(0,n) = 0; both were reported 'positive'.
    expect(ce.box(['GCD', 0, 0]).sgn).toBe('non-negative');
    expect(ce.box(['GCD', 0, 6]).sgn).toBe('positive');
    expect(ce.box(['LCM', 0, 5]).sgn).toBe('zero');
    expect(ce.box(['LCM', 4, 6]).sgn).toBe('positive');
  });

  it('Floor/Ceil of a complex: sign of the rounded real part', () => {
    // ⌊0.5+0.5i⌋ = 0 and ⌈-0.5-0.5i⌉ = 0; the raw real part's sign was
    // previously claimed.
    expect(ce.box(['Floor', ['Complex', 0.5, 0.5]]).sgn).toBe('zero');
    expect(ce.box(['Ceil', ['Complex', -0.5, -0.5]]).sgn).toBe('zero');
    expect(ce.box(['Floor', ['Complex', 1.5, 0.5]]).sgn).toBe('positive');
  });

  it('Factorial: only negative INTEGERS are poles', () => {
    // (-1/2)! = Γ(1/2) = √π > 0; it was reported 'unsigned'.
    expect(ce.box(['Factorial', ['Rational', -1, 2]]).sgn).toBeUndefined();
    expect(ce.box(['Factorial', -3]).sgn).toBe('unsigned');
    expect(ce.box(['Factorial', 3]).sgn).toBe('positive');
  });

  it('Abs(NaN) is NaN, not positive', () => {
    expect(ce.box(['Abs', 'NaN']).sgn).toBe('unsigned');
    expect(ce.box(['Abs', -2]).sgn).toBe('positive');
  });

  it('Random: only non-negative when the bounds are', () => {
    expect(ce.box(['Random']).sgn).toBe('non-negative');
    expect(ce.box(['Random', 2, 5]).sgn).toBe('non-negative');
    // Random(-5, 5) can be negative; it was reported 'non-negative'.
    expect(ce.box(['Random', -5, 5]).sgn).toBeUndefined();
  });

  it('Arctan preserves the sign of its argument', () => {
    // Previously always undefined (quadrant lookup with no Arctan entry).
    expect(ce.box(['Arctan', 2]).sgn).toBe('positive');
    expect(ce.box(['Arctan', -2]).sgn).toBe('negative');
    expect(ce.box(['Arctan', 0]).sgn).toBe('zero');
  });

  it('Rank of a scalar is 0', () => {
    expect(ce.box(['Rank', 5]).evaluate().toString()).toBe('0');
    expect(ce.box(['Rank', 5]).sgn).toBe('non-negative');
  });
});
