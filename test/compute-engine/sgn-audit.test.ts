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

  it('Random: derived from the DOMAIN endpoints', () => {
    // No-arg `Random()` ∈ [0, 1).
    expect(ce.box(['Random']).sgn).toBe('non-negative');
    expect(ce.box(['Random', ['Interval', 2, 5]]).sgn).toBe('non-negative');
    expect(ce.box(['Random', ['Range', 2, 5]]).sgn).toBe('non-negative');
    expect(ce.box(['Random', ['Interval', -5, 0]]).sgn).toBe('negative');
    expect(ce.box(['Random', ['Range', -5, -1]]).sgn).toBe('non-positive');
    // A domain straddling zero can be negative.
    expect(ce.box(['Random', ['Interval', -5, 5]]).sgn).toBeUndefined();
    expect(ce.box(['Random', ['Range', -5, 5]]).sgn).toBeUndefined();
    // A general collection: no endpoints to derive from.
    expect(ce.box(['Random', ['List', 1, 2, 3]]).sgn).toBeUndefined();
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

  it('Abs type follows the operand finiteness', () => {
    ce.declare('ff', 'real');
    ce.declare('rr', 'real');
    // Since the ranged-results round, each `Abs` tier claim carries `<0..>`.
    expect(ce.box(['Abs', 'ff']).type.toString()).toBe('real<0..>');
    expect(ce.box(['Abs', 'ff']).isFinite).toBe(true);
    // `real` admits ±∞, so no finiteness claim.
    expect(ce.box(['Abs', 'rr']).type.toString()).toBe('real<0..>');
    expect(ce.box(['Abs', ['Complex', 2, 3]]).type.toString()).toBe(
      'real<0..>'
    );
    expect(ce.box(['Abs', 'PositiveInfinity']).type.toString()).toBe(
      'signed_infinity'
    );
  });

  it('Multiply: parity of weak-signed finite factors', () => {
    // The parity result was inverted (a product of non-negatives claimed
    // 'non-positive'); it was latent while |x| dropped finiteness and the
    // ∞·0 guard preempted the branch.
    ce.declare('m1', 'real');
    ce.declare('m2', 'real');
    const nn = ce.box(['Multiply', ['Abs', 'm1'], ['Abs', 'm2']]);
    expect(nn.sgn).toBe('non-negative');
    expect(nn.isNonNegative).toBe(true);
    const np = ce.box(['Multiply', ['Abs', 'm1'], ['Negate', ['Abs', 'm2']]]);
    expect(np.sgn).toBe('non-positive');
  });
});

// The operator `sgn` handlers are a PURE family: the type path dispatches
// them while deriving an application's type (the `sgn` operand fact in
// `describe()`), so a handler that evaluates, canonicalizes or declares
// invalidates the very caches the derivation is filling. Contract on
// `OperatorDefinition.sgn`; audit record at open item O7 of
// `docs/plans/2026-08-22-type-handlers-on-types.md`.
describe('SGN HANDLERS ARE PURE (state-drift regression)', () => {
  it('a sgn read advances no engine invalidation axis', () => {
    const ce = new ComputeEngine();
    // The two former violators, on their once-drifting witnesses: a bound
    // that only evaluation can numericize (the `Sum`), and a lazy view
    // whose emptiness probe would run its predicate (the `Filter`).
    const sum = ['Sum', ['Square', 'j'], ['Tuple', 'j', 1, 3]];
    const witnesses = [
      ce.box(['Random', ['Range', 1, sum]]),
      ce.box(['Count', ['Range', 1, sum]]),
      ce.box(['Count', ['Filter', ['List', 1, 2, 3], ['Greater', '_', 1]]]),
      // A compound-operand recursion through several handlers.
      ce.box(['Sqrt', ['Abs', ['Negate', ['Floor', 'Pi']]]]),
    ];
    for (const expr of witnesses) {
      const before = [ce._anyVersion, ce._semanticVersion, ce._worldVersion];
      void expr.sgn;
      expect([ce._anyVersion, ce._semanticVersion, ce._worldVersion]).toEqual(
        before
      );
    }
  });

  it('Random/Count answer from literal bounds and structure, not evaluation', () => {
    const ce = new ComputeEngine();
    // Literal bounds still decide (pure reads)...
    expect(ce.box(['Random', ['Range', 2, 5]]).sgn).toBe('non-negative');
    expect(ce.box(['Count', ['Range', 1, 10]]).sgn).toBe('positive');
    expect(ce.box(['Count', ['List', 1, 2, 3]]).sgn).toBe('positive');
    expect(ce.box(['Count', ['List']]).sgn).toBe('zero');
    // A dictionary keeps its entries in a plain record (not operands): its
    // count is a direct field read.
    expect(
      ce.box(['Count', ['Dictionary', ['Tuple', { str: 'a' }, 1]]]).sgn
    ).toBe('positive');
    expect(ce.box(['Count', ['Dictionary']]).sgn).toBe('zero');
    // A symbol answers for its held value.
    ce.assign('heldList', ce.box(['List', 1, 2, 3]));
    expect(ce.box(['Count', 'heldList']).sgn).toBe('positive');
    // Range emptiness follows the count arithmetic of the Range collection
    // handler, not a bounds-direction test: `Range(1, 5, -∞)` holds exactly
    // one element (1), and a zero step or sign-mismatched bounds hold none.
    expect(ce.box(['Count', ['Range', 1, 5, { num: '-Infinity' }]]).sgn).toBe(
      'positive'
    );
    expect(ce.box(['Count', ['Range', 1, 5, 0]]).sgn).toBe('zero');
    expect(ce.box(['Count', ['Range', 5, 1, 1]]).sgn).toBe('zero');
    // A domain the Random draw provably rejects (empty or unbounded) gets
    // no sign claim: it evaluates to an error, not a draw.
    expect(ce.box(['Random', ['Interval', 1, 0]]).sgn).toBeUndefined();
    expect(ce.box(['Random', ['Interval', 1, 1]]).sgn).toBeUndefined();
    expect(
      ce.box(['Random', ['Interval', 0, { num: '+Infinity' }]]).sgn
    ).toBeUndefined();
    expect(ce.box(['Random', ['Range', 5, 1, 1]]).sgn).toBeUndefined();
    expect(ce.box(['Random', ['Range', 1, 5, 0]]).sgn).toBeUndefined();
    // ...and one literal Interval endpoint suffices for its one-sided claim,
    // even when the other endpoint is compound.
    expect(
      ce.box(['Random', ['Interval', 0, ['Multiply', 50, 'Pi']]]).sgn
    ).toBe('non-negative');
    // A bound or emptiness that only evaluation could decide is declined.
    const sum = ['Sum', ['Square', 'j'], ['Tuple', 'j', 1, 3]];
    expect(ce.box(['Random', ['Range', 1, sum]]).sgn).toBeUndefined();
    expect(ce.box(['Count', ['Range', 1, sum]]).sgn).toBeUndefined();
    expect(
      ce.box(['Count', ['Filter', ['List', 1, 2, 3], ['Greater', '_', 1]]]).sgn
    ).toBeUndefined();
  });

  it("an application operand's sign reaches the descriptor channel", () => {
    const ce = new ComputeEngine();
    ce.declare('r', 'real');
    // `Neg(Floor(Abs(r)))` is provably non-positive only through the
    // operator `sgn` handlers; the Γ pole gate widening to `number` proves
    // the descriptor consulted them.
    expect(
      ce.box(['Gamma', ['Negate', ['Floor', ['Abs', 'r']]]]).type.toString()
    ).toBe('number');
    // And `Ln` of the same operand takes its proven-non-positive gate.
    expect(
      ce.box(['Ln', ['Negate', ['Floor', ['Abs', 'r']]]]).type.toString()
    ).toBe('number');
  });
});
