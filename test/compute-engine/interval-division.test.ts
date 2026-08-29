import { ComputeEngine } from '../../src/compute-engine';
import {
  recipInterval,
  divIntervals,
  powIntervalSigned,
  intervalExcludesZero,
  mulIntervals,
  type Interval,
} from '../../src/compute-engine/numerics/interval-arithmetic';

/**
 * Interval arithmetic for QUOTIENTS — `Divide`, and `Power` with a
 * negative literal exponent (ROADMAP "Interval kernel: `Divide` and
 * `Power` with exponent ≤ 0", ruled and designed 2026-08-29,
 * `docs/plans/2026-08-29-interval-division.md`). A divisor that excludes
 * zero gives the quotient its interval through a directed reciprocal; a
 * divisor that ADMITS zero gets no bounds and the sound tier
 * `real | infinity | nan` (user-ruled; spelled with its branches per
 * lattice ruling L3, not the over-admitting `number`).
 */

const iv = (lo: number, hi: number, loOpen?: boolean, hiOpen?: boolean): Interval => {
  const r: Interval = { lo, hi };
  if (loOpen) r.loOpen = true;
  if (hiOpen) r.hiOpen = true;
  return r;
};

/** Exact dyadic comparison helpers: a double is a dyadic rational. */
const dy = (x: number): [bigint, bigint] => {
  let n = x;
  let d = 1n;
  while (!Number.isInteger(n)) {
    n *= 2;
    d *= 2n;
  }
  return [BigInt(n), d];
};

describe('INTERVAL DIVISION — headline claims', () => {
  it('a quotient of zero-excluding ranges carries the reciprocal interval', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real<2<..<3>');
    e.declare('y', 'real<1<..<2>');
    expect(e.box(['Divide', 'x', 'y']).type.toString()).toBe('real<1<..<3>');
    expect(e.box(['Divide', 1, 'y']).type.toString()).toBe('real<0.5<..<1>');
    // 1/4 is EXACT (4 is a power of two) and inherits the open flag from
    // the open endpoint at 3 → the upper bound stays open; 1/9 is inexact
    // and coarsened → closed.
    expect(e.box(['Power', 'x', -2]).type.toString()).toBe(
      'real<0.1111..<0.25>'
    );
  });

  it('a divisor that admits zero gets no bounds and the sound pole tier (ruled)', () => {
    // `1/z` claimed `real` before this round — unsound: `1/0` evaluates to
    // `~oo` (type `~oo <: infinity`) and `0/0` to `NaN`, neither a `real`.
    // The union is strictly tighter than `number`: a real ÷ real quotient
    // is never a non-real finite complex.
    const e = new ComputeEngine();
    e.declare('z', 'real<-1..1>');
    e.declare('w', 'real<0..1>');
    e.declare('r', 'real');
    for (const d of ['z', 'w', 'r']) {
      const t = e.box(['Divide', 1, d]).type;
      expect(t.toString()).toBe('infinity | nan | real');
      expect(t.matches('number')).toBe(true);
      expect(e.type('complex').matches(t)).toBe(false);
      expect(e.type('~oo').matches(t)).toBe(true);
      expect(e.type('nan').matches(t)).toBe(true);
    }
    // A sign proof restores the real tier even without an interval.
    e.assume(e.box(['Greater', 'g', 0]));
    expect(e.box(['Divide', 1, 'g']).type.toString()).toBe('real<0<..>');
  });

  it('an open endpoint at zero excludes zero; an unbounded divisor gives an open 0', () => {
    const e = new ComputeEngine();
    e.declare('p', 'real<0<..>');
    expect(e.box(['Divide', 1, 'p']).type.toString()).toBe('real<0<..>');
    e.declare('q', 'real<3<..>');
    // 1/x for x > 3 lies in (0, 1/3): the 0 is the OPEN limit of the
    // unbounded side; 1/3 is inexact, coarsened outward and CLOSED.
    expect(e.box(['Divide', 1, 'q']).type.toString()).toBe(
      'real<0<..0.3334>'
    );
  });

  it('the integer arms: quotient and negative power keep the rational tier with bounds', () => {
    const e = new ComputeEngine();
    e.declare('k', 'integer<1..3>');
    expect(e.box(['Divide', 1, 'k']).type.toString()).toBe(
      'rational<0.3333..1>'
    );
    e.declare('n', 'integer<2..3>');
    expect(e.box(['Power', 'n', -2]).type.toString()).toBe(
      'rational<0.1111..0.25>'
    );
    expect(e.box(['Power', 'n', -3]).type.toString()).toBe(
      'rational<0.03703..0.125>'
    );
  });

  it('a negative power of a base that may be zero is the pole tier, not a finite fallback', () => {
    // `0^-2` evaluates to `~oo`; a base range admitting 0 must not fall
    // back to `rational<0..>` / `real<0..>` (dual-review catch — the same
    // obligation `Divide` meets for a zero-admitting divisor).
    const e = new ComputeEngine();
    e.declare('n', 'integer<-2..2>');
    e.declare('q', 'real<-1..1>');
    e.declare('w', 'real<0..1>');
    for (const [b, n] of [['n', -2], ['n', -1], ['q', -2], ['q', -3], ['w', -2]] as const)
      expect(e.box(['Power', b, n]).type.toString()).toBe('infinity | nan | real');
    // A sign proof or a zero-excluding range restores the finite tier.
    // p ∈ (0, 1], and p = 1 is ATTAINED, so 1/p² attains 1: closed at 1.
    e.declare('p', 'real<0<..1>');
    expect(e.box(['Power', 'p', -2]).type.toString()).toBe('real<1..>');
    e.assume(e.box(['Greater', 'g', 0]));
    expect(e.box(['Power', 'g', -2]).type.matches('real')).toBe(true);
  });

  it('a numerator of unproven finiteness widens the quotient to the pole tier', () => {
    // `x: real | non_finite_number` may be `+oo`; `x / p` is then `+oo`, not
    // a `real`. The non-finite arm handles a PROVABLY infinite numerator;
    // this is the unknown-finiteness residue (pre-existing, found by the
    // review of this round).
    const e = new ComputeEngine();
    e.declare('x', 'real | non_finite_number');
    e.declare('p', 'real<1..2>');
    expect(e.box(['Divide', 'x', 'p']).type.toString()).toBe('infinity | nan | real');
    e.declare('f', 'real<0..1>');
    expect(e.box(['Divide', 'f', 'p']).type.toString()).toBe('real<0..1>');
  });

  it('the underflow gate: a tiny closed base squares to a closed 0, so no reciprocal claim', () => {
    // `real<1e-300..>` mathematically excludes 0, but its square's lower
    // bound underflows to a CLOSED 0 in double arithmetic; feeding that
    // to a reciprocal would be unsound, so the gate is on the COMPUTED
    // power and the pre-existing sign arm answers (dual-review catch).
    const e = new ComputeEngine();
    e.declare('t', 'real<1e-300..>');
    expect(e.box(['Power', 't', -2]).type.toString()).toBe('real<0<..>');
    expect(powIntervalSigned(iv(1e-300, Infinity), -2)).toBeUndefined();
  });

  it('route parity: a structural Power(x, -1) agrees with Divide(1, x)', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real<2<..<3>');
    const viaDivide = e.box(['Divide', 1, 'x']).type.toString();
    const structural = e
      .function('Power', [e.symbol('x'), e.number(-1)], { form: 'structural' })
      .type.toString();
    expect(structural).toBe(viaDivide);
    // 1/3 is inexact (coarsened → CLOSED); 1/2 is exact (2 is a power of
    // two) and inherits the open flag from the open endpoint at 2.
    expect(viaDivide).toBe('real<0.3333..<0.5>');
  });

  it('a structural n-ary Divide gets no bounds (only two operands are read)', () => {
    const e = new ComputeEngine();
    e.declare('x', 'real<2<..<3>');
    e.declare('y', 'real<1<..<2>');
    const t = e
      .function('Divide', [e.symbol('x'), e.symbol('y'), e.symbol('y')], {
        form: 'structural',
      })
      .type.toString();
    expect(t).toBe('real');
  });

  it('a numerator that attains zero attains the quotient 0', () => {
    const e = new ComputeEngine();
    e.declare('a', 'real<0..1>');
    e.declare('y', 'real<1<..<2>');
    expect(e.box(['Divide', 'a', 'y']).type.toString()).toBe('real<0..<1>');
  });
});

describe('INTERVAL DIVISION — an empty-range operand (found alongside)', () => {
  it('a never-typed operand makes the application never, not a matrix', () => {
    // `integer<2<..<3>` normalizes to the EMPTY type `never`, and the
    // bottom type matches every type — `matrix` included — so the shape
    // rewrite in `canonicalPower` turned `Power(m, 2)` into a
    // `MatrixPower` typed `matrix`, and the broadcast exemption saw a
    // matrix too. A value-less operand has no shape: the application is
    // `never`, on every route (pre-existing defect, fixed 2026-08-29).
    const e = new ComputeEngine();
    e.declare('m', 'integer<2<..<3>');
    expect(e.box('m').type.toString()).toBe('never');
    for (const n of [2, -2, -1, 3])
      expect(e.box(['Power', 'm', n]).type.toString()).toBe('never');
    expect(e.box(['Add', 'm', 1]).type.toString()).toBe('never');
    expect(e.box(['Sin', 'm']).type.toString()).toBe('never');
    // Genuine matrices still take the rewrites.
    e.declare('M', 'matrix');
    expect(e.box(['Power', 'M', 2]).operator).toBe('MatrixPower');
    expect(e.box(['Power', 'M', -1]).operator).toBe('Inverse');
  });
});

describe('INTERVAL DIVISION — kernel boundary cases (the review list)', () => {
  it('reciprocal overflow saturates by direction, gated on the RESULT', () => {
    // 1/x is finite iff |x| >= 2^-1023: MIN_VALUE and 1/MAX_VALUE overflow.
    for (const x of [Number.MIN_VALUE, 1 / Number.MAX_VALUE, Math.pow(2, -1024)]) {
      const r = recipInterval(iv(x, x))!;
      expect(r.lo).toBe(Number.MAX_VALUE);
      expect(r.hi).toBe(Infinity);
    }
    // A subnormal divisor with a FINITE reciprocal must NOT saturate
    // (saturating the lower bound to MAX_VALUE would exceed 5e307).
    const s = recipInterval(iv(2e-308, 2e-308))!;
    expect(s.lo).toBeLessThanOrEqual(5e307);
    expect(s.hi).toBeGreaterThanOrEqual(5e307);
    expect(Number.isFinite(s.hi)).toBe(true);
    // The exact threshold: 2^-1023 reciprocates exactly.
    const t = recipInterval(iv(Math.pow(2, -1023), Math.pow(2, -1023)))!;
    expect(t.lo).toBe(t.hi);
  });

  it('exactness is a bit test, not Math.log2', () => {
    // A near-neighbor of a power of two: Math.log2 rounds to an integer
    // here, but the reciprocal is NOT exact and must be stepped.
    const nb = 2.225073858507202e-308;
    expect(Number.isInteger(Math.log2(nb))).toBe(true); // the trap
    const r = recipInterval(iv(nb, nb))!;
    expect(r.lo).toBeLessThan(r.hi);
    // Genuine powers of two reciprocate exactly across the exponent range.
    for (const ex of [-1022, -600, -1, 0, 1, 40, 600, 1023]) {
      const x = Math.pow(2, ex);
      const e = recipInterval(iv(x, x))!;
      expect(e.lo).toBe(e.hi);
      expect(e.lo).toBe(1 / x);
    }
  });

  it('a saturating power-of-two divisor endpoint stays sound with either flag', () => {
    // 2^-1030 is a power of two whose reciprocal overflows: dirRecip
    // saturates to MAX_VALUE, and the openness flag is decided from the
    // divisor endpoint alone. Either flag is sound (the true value exceeds
    // MAX_VALUE), but the bound must be MAX_VALUE, finite, on the inside.
    const tiny = Math.pow(2, -1030);
    for (const open of [false, true]) {
      const r = recipInterval(iv(tiny, tiny, false, open))!;
      expect(r.lo).toBe(Number.MAX_VALUE);
      expect(r.hi).toBe(Infinity);
    }
  });

  it('open-at-zero limits and infinite endpoints, all four shapes', () => {
    expect(recipInterval(iv(0, 1, true))).toEqual({ lo: 1, hi: Infinity });
    expect(recipInterval(iv(-1, 0, false, true))).toEqual({ lo: -Infinity, hi: -1 });
    expect(recipInterval(iv(0, Infinity, true))).toEqual({ lo: 0, hi: Infinity, loOpen: true });
    expect(recipInterval(iv(-Infinity, 0, false, true))).toEqual({ lo: -Infinity, hi: 0, hiOpen: true });
    // A closed zero admits zero: no reciprocal.
    expect(recipInterval(iv(0, 1))).toBeUndefined();
    expect(recipInterval(iv(-1, 1))).toBeUndefined();
    expect(intervalExcludesZero(iv(-1, 1))).toBe(false);
  });

  it('openness follows attainability plus exactness', () => {
    // 1/4 exact + open 4 → open; 1/3 inexact → closed even from an open 3.
    const r = recipInterval(iv(3, 4, true, true))!;
    expect(r.lo).toBe(0.25);
    expect(r.loOpen).toBe(true);
    expect(r.hiOpen).toBeUndefined();
    expect(r.hi).toBeGreaterThan(1 / 3);
  });

  it('the composition needs no signed zero: the open 0 corner never attains', () => {
    // (-∞, 0) recip → (-∞, 0 open); times [1, 2] → (-∞, 0 open).
    const q = divIntervals(iv(1, 2), iv(-Infinity, 0, false, true))!;
    expect(q.hi).toBe(0);
    expect(q.hiOpen).toBe(true);
    expect(q.lo).toBe(-Infinity);
    // A numerator attaining 0 makes the quotient attain 0 (closed corner).
    const z = divIntervals(iv(0, 2), iv(1, 2))!;
    expect(z.lo).toBe(0);
    expect(z.loOpen).toBeUndefined();
  });

  it('exact enclosure: random reciprocals and quotients, bigint-verified', () => {
    for (let i = 0; i < 20000; i++) {
      const ex = Math.floor(Math.random() * 2000) - 1000;
      const x = (Math.random() < 0.5 ? -1 : 1) * (1 + Math.random()) * Math.pow(2, ex);
      if (!Number.isFinite(x) || x === 0) continue;
      const r = recipInterval(iv(x, x))!;
      const [xn, xd] = dy(x); // 1/x = xd/xn
      const pos = xn > 0n;
      if (Number.isFinite(r.lo)) {
        const [ln, ld] = dy(r.lo);
        expect(pos ? ln * xn <= ld * xd : ln * xn >= ld * xd).toBe(true);
      }
      if (Number.isFinite(r.hi)) {
        const [hn, hd] = dy(r.hi);
        expect(pos ? hn * xn >= hd * xd : hn * xn <= hd * xd).toBe(true);
      }
    }
    for (let i = 0; i < 10000; i++) {
      const a = (Math.random() - 0.5) * 1e6;
      const b = (Math.random() < 0.5 ? -1 : 1) * (0.001 + Math.random() * 1e3);
      const q = divIntervals(iv(a, a), iv(b, b))!;
      const [an, ad] = dy(a);
      const [bn, bd] = dy(b);
      let num = an * bd;
      let den = ad * bn;
      if (den < 0n) {
        num = -num;
        den = -den;
      }
      const [ln, ld] = dy(q.lo);
      const [hn, hd] = dy(q.hi);
      expect(ln * den <= ld * num).toBe(true);
      expect(hn * den >= hd * num).toBe(true);
    }
  });

  it('attainability battery for quotients over small-integer intervals', () => {
    const flags = [false, true];
    const attained = (x: Interval) => [
      ...(x.loOpen ? [] : [x.lo]),
      ...(x.hiOpen ? [] : [x.hi]),
      (x.lo + x.hi) / 2,
    ];
    for (const [alo, ahi] of [[-2, 3], [0, 4], [-3, 0], [1, 5]])
      for (const [blo, bhi] of [[1, 2], [2, 4], [-4, -1], [-2, -1]])
        for (const alo_o of flags)
          for (const ahi_o of flags)
            for (const blo_o of flags)
              for (const bhi_o of flags) {
                const A = iv(alo, ahi, alo_o, ahi_o);
                const B = iv(blo, bhi, blo_o, bhi_o);
                const r = divIntervals(A, B)!;
                const quotients = attained(A).flatMap((x) => attained(B).map((y) => x / y));
                if (r.loOpen) expect(quotients.includes(r.lo)).toBe(false);
                if (r.hiOpen) expect(quotients.includes(r.hi)).toBe(false);
                for (const q of quotients) {
                  expect(q).toBeGreaterThanOrEqual(r.lo);
                  expect(q).toBeLessThanOrEqual(r.hi);
                }
              }
  });

  it('powIntervalSigned: negative exponents, both parities, n = 0 declined', () => {
    expect(powIntervalSigned(iv(2, 3), -2)).toEqual(
      mulIntervals(iv(1, 1), recipInterval(iv(4, 9))!)
    );
    const odd = powIntervalSigned(iv(-3, -2), -3)!;
    expect(odd.lo).toBeLessThanOrEqual(-1 / 8);
    expect(odd.hi).toBeGreaterThanOrEqual(-1 / 27);
    expect(powIntervalSigned(iv(2, 3), 0)).toBeUndefined();
    expect(powIntervalSigned(iv(-1, 1), -2)).toBeUndefined(); // admits zero
  });
});
