import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import { isSubtype } from '../../src/common/type/subtype';
import { reduceType } from '../../src/common/type/reduce';
import {
  negateNumericType,
  positiveRangeType,
  negativeRangeType,
  signOfType,
  stripNumericRanges,
} from '../../src/common/type/utils';
import {
  addIntervals,
  mulIntervals,
  absInterval,
  powInterval,
  finalizeInterval,
  intervalOfType,
} from '../../src/compute-engine/numerics/interval-arithmetic';

/**
 * Open bounds in ranged types — the open-bounds half of ROADMAP "Ranged
 * types: interval arithmetic and open bounds", ruled 2026-08-28
 * (`docs/plans/2026-08-28-open-bounds-in-ranged-types.md`): the markers
 * `0<..` ("0 < x") and `..<3` ("x < 3"), the open range as the canonical
 * spelling of `(real<0..>) & !0`, openness through the interval kernel by
 * ATTAINABILITY, and the descriptor `facts.bounds` retired in favor of
 * the type.
 */

const T = (s: string) => typeToString(parseType(s));
const R = (s: string) => typeToString(reduceType(parseType(s)));

describe('OPEN BOUNDS — grammar', () => {
  it('parses and round-trips every marker combination', () => {
    for (const s of [
      'real<0<..>',
      'real<0..<3>',
      'real<0<..<3>',
      'real<..<3>',
      'real<0..3>',
      'real<-1.5<..<-1.4>',
      'real<0..<1e-10>',
      'finite_rational<0<..<1>',
      'list<real<0<..<3>>',
    ])
      expect(T(s)).toBe(s);
  });

  it('marker adjacency is lexically mandatory', () => {
    for (const s of ['real<0 <..>', 'real<0< ..>', 'real<0..< 3>', 'real<0 > ..>'])
      expect(() => parseType(s)).toThrow();
  });

  it('a marker needs a finite bound', () => {
    for (const s of ['real<0<..<>', 'real<<..3>', 'real<0<..<oo>', 'real<-oo<..>'])
      expect(() => parseType(s)).toThrow();
  });

  it('the where-clause scanner does not read a marker as a bracket', () => {
    const s = '(x: T, y: U) -> T where T: real<0..<3>, U: real<1<..<2>';
    expect(T(s)).toBe(s);
    // …and still reads the opening bracket of an unbounded-lower range
    // (`real<..3>`) as a bracket, not as a `<..` marker — otherwise the
    // depth count goes negative and the next clause comma is lost
    // (dual-review catch).
    const u = '(x: T, y: U) -> T where T: real<..3>, U: integer';
    expect(T(u)).toBe(u);
  });

  it('a negative bound after an open marker lexes', () => {
    expect(T('real<-5<..<-3>')).toBe('real<-5<..<-3>');
    expect(T('real<..<-3>')).toBe('real<..<-3>');
    // An inverted range is a parse error, open or closed (`real<3..1>`
    // errors today; the open form does not get a different answer).
    expect(() => parseType('real<0<..<-3>')).toThrow();
  });

  it('old spellings stay parseable and reduce to the open range', () => {
    expect(R('(real<0..>) & !0')).toBe('real<0<..>');
    expect(R('(real<..0>) & !0')).toBe('real<..<0>');
  });
});

describe('OPEN BOUNDS — the normal form', () => {
  it('composes exclusions at both endpoints in either order', () => {
    expect(R('(real<0..1>) & !0 & !1')).toBe('real<0<..<1>');
    expect(R('(real<0..1>) & !1 & !0')).toBe('real<0<..<1>');
    // Negations written FIRST merge by De Morgan into `!(0 | 1)` before
    // the range is offered to them; the rewrite reads every excluded
    // value out of that union (dual-review catch — this order used to
    // stop at `!(0 | 1) & real<0..1>`).
    expect(R('!0 & !1 & real<0..1>')).toBe('real<0<..<1>');
    // A merged exclusion with an INTERIOR value keeps that hole.
    expect(R('!0 & !0.5 & real<0..1>')).toBe('(real<0<..1>) & !0.5');
  });

  it('a closed non-integral bound on an integer tier tightens inward', () => {
    // Not open-bound syntax at all — the single range constructor now
    // normalizes every integer-tier bound to the tier's own members
    // (`integer<0.5..3.5>` has exactly the members of `integer<1..3>`).
    expect(T('integer<0.5..3.5>')).toBe('integer<1..3>');
    expect(T('integer<0.5..0.9>')).toBe('never');
  });

  it('drops redundant and outside exclusions, keeps interior ones', () => {
    expect(R('(real<0<..>) & !0')).toBe('real<0<..>');
    expect(R('(real<0..1>) & !5')).toBe('real<0..1>');
    expect(R('(real<0..1>) & !0.5')).toBe('(real<0..1>) & !0.5');
  });

  it('empties normalize to never', () => {
    expect(T('real<0<..0>')).toBe('never');
    expect(T('real<0..<0>')).toBe('never');
    expect(R('(real<5..5>) & !5')).toBe('never');
    expect(R('real<0..<1> & real<1..2>')).toBe('never');
  });

  it('an open integer bound beyond 2^53 keeps its flag (successor unrepresentable)', () => {
    // `floor(k) + 1` rounds back to `k` itself there; clearing the flag
    // would admit the excluded endpoint (dual-review catch).
    expect(T('integer<9007199254740992<..>')).toBe(
      'integer<9007199254740992<..>'
    );
    expect(
      isSubtype(parseType('9007199254740992'), parseType('integer<9007199254740992<..>'))
    ).toBe(false);
  });

  it('integer tiers normalize open bounds away', () => {
    expect(T('integer<0<..>')).toBe('integer<1..>');
    expect(T('integer<0<..<2>')).toBe('integer<1..1>');
    expect(T('integer<0<..<1>')).toBe('never');
    expect(T('finite_integer<-0.5<..>')).toBe('finite_integer<0..>');
    expect(R('(integer<0..>) & !0')).toBe('integer<1..>');
  });

  it('-0 is the endpoint 0', () => {
    expect(T('real<-0<..>')).toBe('real<0<..>');
  });

  it('positive/negative constructors build open ranges', () => {
    expect(typeToString(positiveRangeType('finite_real'))).toBe(
      'finite_real<0<..>'
    );
    expect(typeToString(negativeRangeType('real'))).toBe('real<..<0>');
    expect(typeToString(positiveRangeType('integer'))).toBe('integer<1..>');
  });
});

describe('OPEN BOUNDS — algebra', () => {
  it('meet: tighter wins, open wins on ties', () => {
    expect(R('real<0..2> & real<0<..3>')).toBe('real<0<..2>');
    expect(R('real<0<..3> & real<1..2>')).toBe('real<1..2>');
  });

  it('subtype, range vs range: open ⊂ closed, closed ⊄ open', () => {
    expect(isSubtype(parseType('real<0<..>'), parseType('real<0..>'))).toBe(true);
    expect(isSubtype(parseType('real<0..>'), parseType('real<0<..>'))).toBe(false);
    expect(isSubtype(parseType('real<1..2>'), parseType('real<0<..<3>'))).toBe(
      true
    );
  });

  it('subtype, value vs range: an open endpoint excludes its own value', () => {
    expect(isSubtype(parseType('0'), parseType('real<0<..>'))).toBe(false);
    expect(isSubtype(parseType('0'), parseType('real<0..>'))).toBe(true);
    expect(isSubtype(parseType('3'), parseType('real<0..<3>'))).toBe(false);
    expect(isSubtype(parseType('2.9'), parseType('real<0..<3>'))).toBe(true);
  });

  it('sign reads strictness off the flag', () => {
    expect(signOfType(parseType('real<0<..>'))).toBe('positive');
    expect(signOfType(parseType('real<..<0>'))).toBe('negative');
    expect(signOfType(parseType('real<0..>'))).toBe('non-negative');
  });

  it('negate reflects bounds and flags; strip drops both', () => {
    expect(typeToString(negateNumericType(parseType('real<0<..<3>')))).toBe(
      'real<-3<..<0>'
    );
    expect(typeToString(stripNumericRanges(parseType('real<0<..<3>')))).toBe(
      'real'
    );
  });

  it('the bounds reader carries flags; the hull opens only when all members do', () => {
    expect(intervalOfType(parseType('real<0<..<3>'))).toEqual({
      lo: 0,
      hi: 3,
      loOpen: true,
      hiOpen: true,
    });
    expect(intervalOfType(parseType('real<0<..1> | real<0..2>'))).toEqual({
      lo: 0,
      hi: 2,
    });
    expect(intervalOfType(parseType('real<0<..1> | real<0<..2>'))).toEqual({
      lo: 0,
      hi: 2,
      loOpen: true,
    });
  });
});

describe('OPEN BOUNDS — the assume refinement is the single channel', () => {
  it('a strict machine bound refines to an open range', () => {
    const e = new ComputeEngine();
    e.assume(e.box(['Greater', 'x', 2]));
    expect(e.box('x').type.toString()).toBe('real<2<..>');
    e.assume(e.box(['GreaterEqual', 'w', 2]));
    expect(e.box('w').type.toString()).toBe('real<2..>');
    e.assume(e.box(['Less', 0, 'v', 1]));
    expect(e.box('v').type.toString()).toBe('real<0<..<1>');
  });

  it('an open domain is proven from the type alone', () => {
    // Artanh's real domain is the OPEN (−1, 1). Before open bounds this
    // needed the descriptor `facts.bounds` side channel; the type now
    // says it.
    const e = new ComputeEngine();
    e.assume(e.box(['Less', 0, 'v', 1]));
    expect(e.box(['Artanh', 'v']).type.toString()).toBe('finite_real');
    // A closed bound at the pole is NOT enough.
    e.declare('c', 'real<0..1>');
    expect(e.box(['Artanh', 'c']).type.toString()).not.toBe('finite_real');
  });

  it('a non-machine bound rounds OUTWARD and closes (the direction-blind fix)', () => {
    // `1/3` has no machine value: the range takes the projection rounded
    // DOWN for a lower bound, closed — never `>= 0.3333333333333333` on
    // the rounded-up side, which would exclude admissible values.
    const e = new ComputeEngine();
    e.assume(e.box(['Greater', 'q', ['Rational', 1, 3]]));
    const t = e.box('q').type.type;
    expect(typeof t).toBe('object');
    if (typeof t === 'object' && t.kind === 'numeric') {
      expect(t.lower).toBeLessThan(1 / 3);
      expect(t.lowerOpen).toBeUndefined();
    }
  });

  it('part-subject assumptions keep the fact-index channel (no type slot)', () => {
    const e = new ComputeEngine();
    e.declare('s', 'complex');
    expect(e.assume(e.box(['Greater', ['Real', 's'], 1]))).toBe('ok');
    // The symbol's own type is untouched — a bound on Re(s) says nothing
    // about s.
    expect(e.box('s').type.toString()).toBe('complex');
  });
});

describe('OPEN BOUNDS — kernel attainability', () => {
  it('add: strict + anything at an exact sum is strict', () => {
    const e = new ComputeEngine();
    e.assume(e.box(['Greater', 'x', 2]));
    e.assume(e.box(['Greater', 'y', 3]));
    expect(e.box(['Add', 'x', 'y']).type.toString()).toBe('real<5<..>');
    expect(e.box(['Multiply', 'x', 'y']).type.toString()).toBe(
      'finite_real<6<..>'
    );
    const r = addIntervals({ lo: 2, hi: 5, loOpen: true }, { lo: 3, hi: 7 });
    expect(r).toEqual({ lo: 5, hi: 12, loOpen: true });
  });

  it('an inexact endpoint demotes to closed', () => {
    const r = addIntervals(
      { lo: 0.1, hi: 0.1, loOpen: true },
      { lo: 0.2, hi: 0.2, loOpen: true }
    );
    expect(r.loOpen).toBeUndefined();
  });

  it('mul: the closed-zero corner is attained (the review-critical case)', () => {
    // [0, 5] closed at 0 times (2, 3): 0 · anything = 0 is attained at
    // x = 0, so the infimum 0 is CLOSED even though the other factor is
    // open everywhere.
    const e = new ComputeEngine();
    e.declare('b', 'real<0..5>');
    e.declare('c', 'real<2<..<3>');
    expect(e.box(['Multiply', 'b', 'c']).type.toString()).toBe(
      'finite_real<0..<15>'
    );
    // An OPEN zero never attains 0.
    e.declare('d', 'real<0<..5>');
    expect(e.box(['Multiply', 'd', 'c']).type.toString()).toBe(
      'finite_real<0<..<15>'
    );
  });

  it('mul: a closed zero in EITHER operand attains the product 0', () => {
    // `(0, ∞) × {0}`: the open zero of the first operand does not make the
    // product open — the second operand's closed 0 attains it for every
    // point. The naive rule produced an EMPTY open singleton here
    // (dual-review catch).
    expect(mulIntervals({ lo: 0, hi: Infinity, loOpen: true }, { lo: 0, hi: 0 })).toEqual({
      lo: 0,
      hi: 0,
    });
    // Both zeros open: 0 is never attained.
    const r = mulIntervals(
      { lo: 0, hi: Infinity, loOpen: true },
      { lo: 0, hi: 1, loOpen: true }
    );
    expect(r.lo).toBe(0);
    expect(r.loOpen).toBe(true);
  });

  it('mul: a tie between corners keeps the attained one', () => {
    // [-1,1] × [-1,1): lower extreme −1 via (−1)·1 (1 open → not attained)
    // and via 1·(−1) (both closed → attained) — closed wins.
    const r = mulIntervals({ lo: -1, hi: 1 }, { lo: -1, hi: 1, hiOpen: true });
    expect(r).toEqual({ lo: -1, hi: 1 });
  });

  it('abs and even power: the interior zero is always closed', () => {
    const e = new ComputeEngine();
    e.declare('a', 'real<-3<..<2>');
    expect(e.box(['Abs', 'a']).type.toString()).toBe('finite_real<0..<3>');
    expect(e.box(['Power', 'a', 2]).type.toString()).toBe('finite_real<0..<9>');
    expect(e.box(['Power', 'a', 3]).type.toString()).toBe(
      'finite_real<-27<..<8>'
    );
    expect(absInterval({ lo: -3, hi: 2, loOpen: true, hiOpen: true })).toEqual({
      lo: 0,
      hi: 3,
      hiOpen: true,
    });
    expect(powInterval({ lo: -3, hi: 2, loOpen: true }, 2)).toEqual({
      lo: 0,
      hi: 9,
      hiOpen: true,
    });
  });

  it('finalize: a coarsened bound demotes, an untouched one keeps its flag', () => {
    expect(finalizeInterval({ lo: 5, hi: 12, loOpen: true })).toEqual({
      lo: 5,
      hi: 12,
      loOpen: true,
    });
    const c = finalizeInterval({ lo: 1.23456789, hi: 9, loOpen: true });
    expect(c.lo).toBeLessThan(1.23456789);
    expect(c.loOpen).toBeUndefined();
  });

  it('endpoint attainability, exhaustively, for add and mul', () => {
    // For every flag combination over small integer intervals: a bound
    // claimed OPEN is never produced by any attained corner pair; a bound
    // claimed CLOSED is produced by some attained pair.
    const flags = [false, true];
    const attained = (iv: { lo: number; hi: number; loOpen?: boolean; hiOpen?: boolean }) =>
      [
        ...(iv.loOpen ? [] : [iv.lo]),
        ...(iv.hiOpen ? [] : [iv.hi]),
        (iv.lo + iv.hi) / 2,
      ];
    for (const [alo, ahi] of [[-2, 3], [0, 4], [-3, 0], [1, 5]])
      for (const [blo, bhi] of [[-1, 2], [0, 3], [-4, 0], [2, 6]])
        for (const alo_o of flags)
          for (const ahi_o of flags)
            for (const blo_o of flags)
              for (const bhi_o of flags) {
                const A = { lo: alo, hi: ahi, loOpen: alo_o, hiOpen: ahi_o };
                const B = { lo: blo, hi: bhi, loOpen: blo_o, hiOpen: bhi_o };
                for (const [op, fn] of [
                  ['add', (x: number, y: number) => x + y],
                  ['mul', (x: number, y: number) => x * y],
                ] as const) {
                  const r = op === 'add' ? addIntervals(A, B) : mulIntervals(A, B);
                  const products = attained(A).flatMap((x) =>
                    attained(B).map((y) => fn(x, y))
                  );
                  // Claimed open → never produced by attained pairs.
                  if (r.loOpen) expect(products.includes(r.lo)).toBe(false);
                  if (r.hiOpen) expect(products.includes(r.hi)).toBe(false);
                  // Every attained product lies inside the claim.
                  for (const p of products) {
                    expect(p).toBeGreaterThanOrEqual(r.lo);
                    expect(p).toBeLessThanOrEqual(r.hi);
                  }
                }
              }
  });
});
