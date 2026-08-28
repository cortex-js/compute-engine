import { ComputeEngine } from '../../src/compute-engine';
import {
  addIntervals,
  mulIntervals,
  absInterval,
  powInterval,
  finalizeInterval,
  intervalOfType,
  type Interval,
} from '../../src/compute-engine/numerics/interval-arithmetic';
import { parseType } from '../../src/common/type/parse';
import { reduceType } from '../../src/common/type/reduce';

/**
 * Interval arithmetic for arithmetic RESULT types — the interval-
 * arithmetic half of the ROADMAP entry "Ranged types: interval arithmetic
 * and open bounds", ruled and scoped 2026-08-27
 * (`docs/plans/2026-08-27-interval-arithmetic-result-types.md`): `Add`,
 * `Multiply`, `Abs` and positive-integer-exponent `Power` compute a
 * result range from the operands' ranged types. Joins still strip
 * (`stripNumericRanges`) — the bounds here come from the SEPARATE
 * interval fold, which is sound where the join is not.
 */

const ce = new ComputeEngine();

describe('INTERVAL RESULT TYPES — the headline claims', () => {
  it('a sum of assume-bounded symbols carries the interval sum', () => {
    const e = new ComputeEngine();
    e.assume(e.box(['Greater', 'x', 2]));
    e.assume(e.box(['Greater', 'y', 3]));
    expect(e.box(['Add', 'x', 'y']).type.toString()).toBe('real<5<..>');
    expect(e.box(['Multiply', 'x', 'y']).type.toString()).toBe(
      'real<6<..>'
    );
  });

  it('the historical join-leak regression stays sound, now WITH a bound', () => {
    // `assume(x > −1); assume(y > −1)` once typed `x + y` as `real<-1..>`
    // (refuted by x = y = −0.9) — the reason joins strip. The interval
    // fold claims the SOUND bound −2 instead.
    const e = new ComputeEngine();
    e.assume(e.box(['Greater', 'x', -1]));
    e.assume(e.box(['Greater', 'y', -1]));
    expect(e.box(['Add', 'x', 'y']).type.toString()).toBe('real<-2<..>');
  });

  it('|x| tightens with the operand interval; the old scope boundary moves', () => {
    const e = new ComputeEngine();
    e.declare('a', 'real<-3..2>');
    expect(e.box(['Abs', 'a']).type.toString()).toBe('real<0..3>');
    // `|x| + |y|` used to be pinned BARE `real` as the interval-arithmetic
    // scope boundary; the boundary moved — the sum of two non-negative
    // ranges is non-negative.
    e.declare('p', 'real');
    e.declare('q', 'real');
    expect(
      e.box(['Add', ['Abs', 'p'], ['Abs', 'q']]).type.toString()
    ).toBe('real<0..>');
  });

  it('positive-integer powers follow the case table', () => {
    const e = new ComputeEngine();
    e.declare('a', 'real<-3..2>');
    // even, crossing zero
    expect(e.box(['Power', 'a', 2]).type.toString()).toBe('real<0..9>');
    // odd: monotone on all of ℝ, no sign proof needed
    expect(e.box(['Power', 'a', 3]).type.toString()).toBe(
      'real<-27..8>'
    );
    // even, same-sign negative base: the tightened nonzero lower bound
    e.declare('b', 'real<-3..-2>');
    expect(e.box(['Power', 'b', 2]).type.toString()).toBe('real<4..9>');
    // integer base tier is preserved
    e.declare('k', 'integer<2..5>');
    expect(e.box(['Power', 'k', 2]).type.toString()).toBe(
      'integer<4..25>'
    );
    // n = 0 and negative exponents are deferred (the pole story rides the
    // lattice flip): no interval claim — the pre-existing positive-base
    // sign arm answers, not a computed range.
    e.declare('c', 'real<2..3>');
    expect(e.box(['Power', 'c', -2]).type.toString()).toBe(
      'real<0<..>'
    );
  });

  it('an even power whose tiny lower bound hits the subnormal veto keeps its non-negativity', () => {
    // The even-exponent arms pass `clampNonNegative`: when the computed
    // lower bound underflows into the subnormal veto (dropped to −∞ by
    // `finalizeInterval`), the clamp restores the `x² ≥ 0` fact — the
    // claim must never be unbounded below.
    const e = new ComputeEngine();
    // A provably NEGATIVE base reaches the even-exponent clamp arm (a
    // positive base takes the `requirePositive` arm instead, which
    // declines the refinement and keeps its `& !0` claim). The square's
    // lower bound 1e-320 is subnormal — vetoed, clamped back to 0; the
    // upper bound 1e-300 is normal and survives.
    e.declare('t', 'real<-1e-150..-1e-160>');
    expect(e.box(['Power', 't', 2]).type.toString()).toBe(
      'real<0..1e-300>'
    );
    // Both bounds subnormal: the claim degrades to non-negative alone,
    // never to unbounded-below.
    e.declare('u', 'real<-1e-160..1e-155>');
    expect(e.box(['Power', 'u', 2]).type.toString()).toBe('real<0..>');
  });

  it('a literal enclosure feeds the fold', () => {
    const e = new ComputeEngine();
    e.declare('u', 'real<0..1>');
    // `1/3` carries `rational<0.33..0.34>`; the sum interval is
    // [0.33, 1.34] (the plan's worked example).
    expect(e.box(['Add', 'u', ['Rational', 1, 3]]).type.toString()).toBe(
      'real<0.33..1.34>'
    );
  });

  it('a NaN-admitting operand aborts the whole claim', () => {
    const e = new ComputeEngine();
    e.declare('n', 'number');
    expect(e.box(['Add', 'n', 1]).type.toString()).toBe('number');
    e.declare('r', 'real<0..1>');
    expect(e.box(['Add', 'n', 'r']).type.toString()).toBe('number');
  });

  it('admitted infinities keep sound sides only', () => {
    // Under the finite-by-default lattice `real<0..>` is a half-line of
    // FINITE reals — no infinity inhabits it. The assertion still holds,
    // for a different reason than when it was written: the sum of two
    // opposite unbounded half-lines covers every real, so no finite bound
    // survives on either side, and the fold correctly attaches nothing.
    const e = new ComputeEngine();
    e.declare('p', 'real<0..>');
    e.declare('q', 'real<..0>');
    const t = e.box(['Add', 'p', 'q']).type.toString();
    // Whatever the tier says, no range with a finite bound may be attached.
    expect(t.includes('..')).toBe(false);
  });
});

describe('INTERVAL RESULT TYPES — kernel adversarial matrix', () => {
  const iv = (lo: number, hi: number): Interval => ({ lo, hi });

  it('mul: a zero-containing interval times an unbounded one drops NaN candidates per side', () => {
    // [0, 1] × [0, ∞]: candidates 0·0, 0·∞(NaN), 1·0, 1·∞ → [0, ∞].
    const r = mulIntervals(iv(0, 1), iv(0, Infinity));
    expect(r.lo).toBe(0);
    expect(r.hi).toBe(Infinity);
  });

  it('mul: the all-NaN case claims nothing (the empty-candidate hazard)', () => {
    // [0,0] × [−∞,+∞]: all four endpoint products are NaN. A naive
    // `Math.min(...survivors)` over the empty set would answer +∞ — the
    // WRONG-signed lower bound.
    const r = mulIntervals(iv(0, 0), iv(-Infinity, Infinity));
    expect(r.lo).toBe(-Infinity);
    expect(r.hi).toBe(Infinity);
  });

  it('add: ∞ + (−∞) drops the affected side only', () => {
    const r = addIntervals(iv(-Infinity, 0), iv(3, Infinity));
    // lo: −∞ + 3 = −∞ (genuine); hi: 0 + ∞ = ∞ (genuine) — both unbounded.
    expect(r.lo).toBe(-Infinity);
    expect(r.hi).toBe(Infinity);
    const s = addIntervals(iv(2, 5), iv(3, Infinity));
    expect(s.lo).toBe(5); // exact — no spurious ulp-step on exact sums
    expect(s.hi).toBe(Infinity);
  });

  it('add/mul: overflowed endpoints fall to the sound extreme', () => {
    const r = addIntervals(iv(1.5e308, 1.5e308), iv(1.5e308, 1.5e308));
    // The true sum 3e308 overflows: the lower bound falls back to
    // MAX_VALUE (sound: 3e308 > MAX_VALUE), the upper to +∞.
    expect(r.lo).toBe(Number.MAX_VALUE);
    expect(r.hi).toBe(Infinity);
  });

  it('mul: an underflowed product steps to the signed MIN_VALUE', () => {
    const r = mulIntervals(iv(1e-200, 1e-200), iv(-1e-200, -1e-200));
    // True product −1e-400: below the double range. The lower bound must
    // be ≤ it (−MIN_VALUE works), the upper ≥ it (0 works, since the
    // product of nonzero factors of opposite sign is < 0... but the sound
    // claim from the kernel is the enclosing [−MIN_VALUE, 0]).
    expect(r.lo).toBe(-Number.MIN_VALUE);
    expect(r.hi).toBe(0);
  });

  it('abs: exact reflection and zero-crossing', () => {
    expect(absInterval(iv(-3, 2))).toEqual(iv(0, 3));
    expect(absInterval(iv(-3, -2))).toEqual(iv(2, 3));
    expect(absInterval(iv(2, 3))).toEqual(iv(2, 3));
    expect(absInterval(iv(-Infinity, 2))).toEqual(iv(0, Infinity));
  });

  it('pow: infinite endpoints follow the signed arithmetic', () => {
    expect(powInterval(iv(2, Infinity), 2)).toEqual(iv(4, Infinity));
    expect(powInterval(iv(-Infinity, -2), 3)!.hi).toBe(-8);
    expect(powInterval(iv(-Infinity, -2), 3)!.lo).toBe(-Infinity);
    expect(powInterval(iv(-Infinity, 2), 2)).toEqual(iv(0, Infinity));
    // n ≤ 0 is out of scope by ruling
    expect(powInterval(iv(2, 3), 0)).toBeUndefined();
    expect(powInterval(iv(2, 3), -1)).toBeUndefined();
  });

  it('pow: a huge literal exponent terminates fast (binary exponentiation)', () => {
    // A linear multiplication chain here spun a full-suite worker for the
    // better part of an hour on the corpus exponent `10000003`.
    const t0 = Date.now();
    const r = powInterval(iv(0.5, 2), 10000003)!;
    expect(Date.now() - t0).toBeLessThan(100);
    expect(r.lo).toBe(0); // 0.5^10000003 underflows to 0 outward
    expect(r.hi).toBe(Infinity); // 2^10000003 overflows outward
    const e = new ComputeEngine();
    e.declare('x', 'real<2..3>');
    const t1 = Date.now();
    // 2^10000003 overflows outward to +∞ (side dropped); the lower bound
    // saturates soundly at MAX_VALUE and survives coarsening.
    expect(e.box(['Power', 'x', 10000003]).type.toString()).toBe(
      'real<1.797e+308..>'
    );
    expect(Date.now() - t1).toBeLessThan(500);
    // The mirror case underflows both bounds into the subnormal veto; the
    // pre-existing positive-base sign claim is kept, not lost.
    e.declare('y', 'real<0.25..0.5>');
    expect(e.box(['Power', 'y', 10000003]).type.toString()).toBe(
      'real<0<..>'
    );
  });

  it('mul: a subnormal operand with a normal product uses the sound fallback step', () => {
    // One subnormal factor times a large one lands back in the normal
    // range, but Dekker's split is only proven exact for NORMAL inputs —
    // the kernel must take the unconditional outward step there. The
    // sound outcome is simply an enclosing interval (verified exactly).
    const a = 5e-315; // subnormal
    const b = 1e10;
    const r = mulIntervals(iv(a, a), iv(b, b));
    expect(r.lo).toBeLessThanOrEqual(a * b);
    expect(r.hi).toBeGreaterThanOrEqual(a * b);
    expect(r.lo).toBeGreaterThan(0);
  });

  it('finalize: subnormal bounds are dropped, -0 normalizes', () => {
    const r = finalizeInterval(iv(1e-320, 5));
    expect(r.lo).toBe(-Infinity); // subnormal veto
    expect(r.hi).toBe(5);
    expect(Object.is(finalizeInterval(iv(-0, 1)).lo, 0)).toBe(true);
  });

  it('reader: intersections, unions, and NaN-admitting bases', () => {
    expect(intervalOfType(parseType('real<0..1>'))).toEqual(iv(0, 1));
    // The reader ignores `!0` in an UNREDUCED intersection (a negation
    // proves no interval); the reducer turns the spelling into the open
    // range, whose flag the reader then carries.
    expect(intervalOfType(parseType('(real<0..>) & !0'))).toEqual({
      lo: 0,
      hi: Infinity,
    });
    expect(intervalOfType(reduceType(parseType('(real<0..>) & !0')))).toEqual({
      lo: 0,
      hi: Infinity,
      loOpen: true,
    });
    expect(intervalOfType(parseType('real<0..1> | real<3..4>'))).toEqual(
      iv(0, 4)
    );
    expect(intervalOfType('number')).toBeUndefined();
    expect(intervalOfType('nan')).toBeUndefined();
    expect(intervalOfType('infinity')).toBeUndefined(); // admits ~oo
    expect(intervalOfType('string')).toBeUndefined();
    // A contradictory intersection claims nothing (never an inverted pair).
    expect(
      intervalOfType(parseType('real<0..1> & real<3..4>'))
    ).toBeUndefined();
  });
});

describe('INTERVAL RESULT TYPES — randomized soundness', () => {
  // Sample values inside random operand ranges, compute the expression
  // numerically, and assert the value lies inside the claimed range.
  const randIn = (lo: number, hi: number) => lo + Math.random() * (hi - lo);

  it('Add and Multiply results contain sampled values', () => {
    for (let trial = 0; trial < 300; trial++) {
      const e = new ComputeEngine();
      const a1 = Math.round(randIn(-50, 50));
      const b1 = a1 + Math.round(randIn(0, 50));
      const a2 = Math.round(randIn(-50, 50));
      const b2 = a2 + Math.round(randIn(0, 50));
      e.declare('x', `real<${a1}..${b1}>`);
      e.declare('y', `real<${a2}..${b2}>`);
      const op = trial % 2 === 0 ? 'Add' : 'Multiply';
      const t = e.box([op, 'x', 'y']).type.type;
      if (typeof t === 'string' || t.kind !== 'numeric') continue;
      for (let s = 0; s < 20; s++) {
        const xv = randIn(a1, b1);
        const yv = randIn(a2, b2);
        const v = op === 'Add' ? xv + yv : xv * yv;
        if (t.lower !== undefined) expect(v).toBeGreaterThanOrEqual(t.lower);
        if (t.upper !== undefined) expect(v).toBeLessThanOrEqual(t.upper);
      }
    }
  });

  it('powers of sampled values stay inside the claimed range', () => {
    for (let trial = 0; trial < 200; trial++) {
      const e = new ComputeEngine();
      const a = Math.round(randIn(-20, 20));
      const b = a + Math.round(randIn(0, 20));
      const n = 1 + Math.floor(Math.random() * 5);
      e.declare('x', `real<${a}..${b}>`);
      const t = e.box(['Power', 'x', n]).type.type;
      if (typeof t === 'string' || t.kind !== 'numeric') continue;
      for (let s = 0; s < 20; s++) {
        const xv = randIn(a, b);
        const v = xv ** n;
        if (t.lower !== undefined) expect(v).toBeGreaterThanOrEqual(t.lower);
        if (t.upper !== undefined) expect(v).toBeLessThanOrEqual(t.upper);
      }
    }
  });
});

describe('INTERVAL RESULT TYPES — downstream consumers see through arithmetic', () => {
  it('a domain proof reads the computed bounds', () => {
    // arcsin's real domain is [−1, 1]: the SUM of two eighth-bounded
    // symbols provably lands inside it, which only the computed interval
    // can say.
    const e = new ComputeEngine();
    e.declare('x', 'real<0..0.125>');
    e.declare('y', 'real<0..0.125>');
    expect(e.box(['Arcsin', ['Add', 'x', 'y']]).type.toString()).toBe(
      'real'
    );
  });

  it('signOfType reads the computed bounds', () => {
    const e = new ComputeEngine();
    e.assume(e.box(['Greater', 'x', 2]));
    e.assume(e.box(['Greater', 'y', 3]));
    expect(e.box(['Add', 'x', 'y']).isPositive).toBe(true);
  });
});
