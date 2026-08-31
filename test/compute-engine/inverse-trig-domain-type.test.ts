/**
 * Result TYPE of the inverse trig / inverse hyperbolic heads with a BOUNDED
 * real domain (`Arcsin`, `Arccos`, `Arcosh`, `Artanh`, `Arcoth`, `Arsech`,
 * `Arcsec`, `Arccsc`).
 *
 * User ruling 2026-07-30. Every one of these heads takes a COMPLEX value
 * outside its real domain (`arcsin(−2) = −π/2 + 1.3169…i`,
 * `arcosh(−2) = 1.3169… + iπ`, `arcsec(0.5) = 1.3169…i`), and `real`
 * EXCLUDES complex — `ce.type('complex').matches('real')` is
 * `false`. The `real` these heads claimed for any symbolic real
 * argument was therefore unsound, not merely imprecise. The claim is now
 * three-way:
 *
 * - argument provably IN domain  → `real` (tight, unchanged)
 * - argument provably OUT        → a complex type
 * - magnitude unknown            → the join (the tightest SOUND type)
 *
 * The in/out decision is made with the numeric predicates
 * (`isGreater`/`isLessEqual`/…), which consult the assumptions system, so
 * `w ≥ 2` proves `Arcosh(w)` real AND `Arcsin(w)` complex.
 *
 * The real-closed heads (`Arsinh`, `Arctan`, `Arccot`) are real-valued on all
 * of ℝ: `real` is correct and tight for them, and is guarded below.
 * `Arcsch` is real-valued on every non-zero real and keeps the documented
 * generic-point convention.
 */

import { ComputeEngine } from '../../src/compute-engine';

const BOUNDED_HEADS = [
  'Arcsin',
  'Arccos',
  'Arcosh',
  'Artanh',
  'Arcoth',
  'Arsech',
  'Arcsec',
  'Arccsc',
] as const;

function typeOf(ce: ComputeEngine, head: string, arg: number | string): string {
  const x = typeof arg === 'number' ? ce.number(arg) : ce.symbol(arg);
  return ce.function(head, [x]).type.toString();
}

/**
 * `[head, argument, expected type]` for LITERAL arguments: one in-domain
 * witness per head, one out-of-domain witness (the value is complex), and the
 * real poles (the value is `±∞`, or NaN where the head has no limit).
 */
const LITERAL_CASES: [string, number, string][] = [
  // |x| ≤ 1
  ['Arcsin', -1, 'real'],
  ['Arcsin', 0.5, 'real'],
  ['Arcsin', 1, 'real'],
  ['Arcsin', 2, 'complex'],
  ['Arcsin', -2, 'complex'],
  ['Arccos', 0.5, 'real'],
  ['Arccos', 2, 'complex'],
  ['Arccos', -2, 'complex'],
  // x ≥ 1
  ['Arcosh', 1, 'real'],
  ['Arcosh', 2, 'real'],
  ['Arcosh', 0, 'complex'],
  ['Arcosh', 0.5, 'complex'],
  ['Arcosh', -2, 'complex'],
  // |x| < 1, ±∞ at ±1
  ['Artanh', 0, 'real'],
  ['Artanh', -0.5, 'real'],
  ['Artanh', 1, 'signed_infinity'],
  ['Artanh', -1, 'signed_infinity'],
  ['Artanh', 2, 'complex'],
  ['Artanh', -2, 'complex'],
  // |x| > 1, ±∞ at ±1
  ['Arcoth', 2, 'real'],
  ['Arcoth', -2, 'real'],
  ['Arcoth', 1, 'signed_infinity'],
  ['Arcoth', -1, 'signed_infinity'],
  ['Arcoth', 0, 'complex'],
  ['Arcoth', 0.5, 'complex'],
  // 0 < x ≤ 1, +∞ at 0
  ['Arsech', 0.5, 'real'],
  ['Arsech', 1, 'real'],
  ['Arsech', 0, 'signed_infinity'],
  ['Arsech', 2, 'complex'],
  ['Arsech', -2, 'complex'],
  // |x| ≥ 1, NaN at 0
  ['Arcsec', 1, 'real'],
  ['Arcsec', -2, 'real'],
  ['Arcsec', 0.5, 'complex'],
  ['Arcsec', -0.5, 'complex'],
  // Mathematically `arcsec(0) = ~oo`, which IS a member of `complex`, but the
  // evaluator currently yields NaN at 0 (`arcsec(0).N() → NaN`) and NaN is a
  // member only of `number`. The claim must not exclude the produced value.
  ['Arcsec', 0, 'number'],
  ['Arccsc', 1, 'real'],
  ['Arccsc', -2, 'real'],
  ['Arccsc', 0.5, 'complex'],
  ['Arccsc', -0.5, 'complex'],
  ['Arccsc', 0, 'number'],
];

/**
 * `[head, bare real symbol, `w ≥ 2`, `0 < v < 1`]`.
 *
 * The bare-symbol column is the JOIN: `complex` for a head with no real
 * pole, `complex | signed_infinity` for one whose pole value is `±∞`, and
 * `number` when the pole value may be NaN. The signed pair is spelled out in
 * that union because the bare name `complex` denotes the FINITE complex
 * numbers and cannot absorb the pole on its own.
 * (Arcsec/Arccsc join to `number`: their pole value is mathematically `~oo`,
 * but the evaluator produces NaN at 0, so any narrower claim would exclude a
 * value the head actually produces.)
 *
 * The claim is printed with its disjuncts in the lattice's own order, which
 * is why the expected string reads `complex | signed_infinity`.
 */
const SYMBOLIC_CASES: [string, string, string, string][] = [
  ['Arcsin', 'complex', 'complex', 'real'],
  ['Arccos', 'complex', 'complex', 'real'],
  ['Arcosh', 'complex', 'real', 'complex'],
  ['Artanh', 'complex | signed_infinity', 'complex', 'real'],
  ['Arcoth', 'complex | signed_infinity', 'real', 'complex'],
  ['Arsech', 'complex | signed_infinity', 'complex', 'real'],
  ['Arcsec', 'number', 'real', 'complex'],
  ['Arccsc', 'number', 'real', 'complex'],
];

/** A fresh engine with `u` a bare real, `w ≥ 2` and `0 < v < 1`. */
function engineWithAssumptions(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.declare('w', 'real');
  ce.assume(ce.parse('w \\ge 2'));
  ce.declare('v', 'real');
  ce.assume(ce.parse('0 \\lt v \\lt 1'));
  return ce;
}

describe('INVERSE TRIG: bounded real domain — result type', () => {
  it('`real` excludes complex (why the old claim was unsound)', () => {
    const ce = new ComputeEngine();
    expect(ce.type('complex').matches('real')).toBe(false);
    // …and the join direction that makes `complex` the tightest sound
    // type for an argument of unknown magnitude.
    expect(ce.type('real').matches('complex')).toBe(true);
    // …and why a pole-carrying head cannot claim `complex` alone: the bare
    // name denotes the FINITE complex numbers, so the signed infinities are
    // NOT below it and have to be named in the union.
    expect(ce.type('signed_infinity').matches('complex')).toBe(false);
    expect(
      ce.type('signed_infinity').matches('complex | signed_infinity')
    ).toBe(true);
    expect(ce.type('complex').matches('complex | signed_infinity')).toBe(
      true
    );
  });

  describe('literal arguments', () => {
    for (const [head, arg, expected] of LITERAL_CASES) {
      it(`${head}(${arg}) is ${expected}`, () => {
        const ce = new ComputeEngine();
        expect(typeOf(ce, head, arg)).toBe(expected);
      });
    }

    it('every literal claim is honored by the VALUE', () => {
      const ce = new ComputeEngine();
      for (const [head, arg, expected] of LITERAL_CASES) {
        const v = ce.function(head, [ce.number(arg)]).N();
        const finite = Number.isFinite(v.re) && Number.isFinite(v.im ?? 0);
        const real = (v.im ?? 0) === 0;
        const witness = `${head}(${arg}) = ${v.toString()}`;
        if (expected === 'real')
          expect([witness, finite && real]).toEqual([witness, true]);
        else if (expected === 'complex')
          expect([witness, finite]).toEqual([witness, true]);
        else if (expected === 'signed_infinity')
          expect([witness, real && !finite && !Number.isNaN(v.re)]).toEqual([
            witness,
            true,
          ]);
      }
    });
  });

  describe('symbolic arguments, refined by assumptions', () => {
    for (const [head, bare, geTwo, unitOpen] of SYMBOLIC_CASES) {
      it(`${head}: bare real → ${bare}, w ≥ 2 → ${geTwo}, 0 < v < 1 → ${unitOpen}`, () => {
        const ce = engineWithAssumptions();
        expect(typeOf(ce, head, 'u')).toBe(bare);
        expect(typeOf(ce, head, 'w')).toBe(geTwo);
        expect(typeOf(ce, head, 'v')).toBe(unitOpen);
      });
    }

    it('no bounded head claims `real` for a bare real symbol', () => {
      const ce = engineWithAssumptions();
      for (const head of BOUNDED_HEADS)
        expect([head, typeOf(ce, head, 'u')]).not.toEqual([
          head,
          'real',
        ]);
    });

    it('`w ≥ 2` proves Arcosh in-domain and Arcsin out-of-domain', () => {
      const ce = engineWithAssumptions();
      expect(ce.box('w').isGreaterEqual(1)).toBe(true);
      expect(typeOf(ce, 'Arcosh', 'w')).toBe('real');
      expect(typeOf(ce, 'Arcsin', 'w')).toBe('complex');
      expect(ce.type(typeOf(ce, 'Arcsin', 'w')).matches('real')).toBe(
        false
      );
    });

    it('a provably non-zero argument drops the pole arm (Arcsec/Arccsc)', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'real');
      ce.assume(ce.parse('p \\gt 0'));
      // Not provably in `|x| ≥ 1` nor in `(0, 1)`, but provably not 0, so the
      // NaN arm is gone: the value is finite, real or complex.
      expect(typeOf(ce, 'Arcsec', 'p')).toBe('complex');
      expect(typeOf(ce, 'Arccsc', 'p')).toBe('complex');
    });
  });

  describe('real-closed heads are UNCHANGED', () => {
    for (const head of ['Arsinh', 'Arctan', 'Arccot'] as const) {
      it(`${head} stays real everywhere`, () => {
        const ce = engineWithAssumptions();
        for (const arg of [-2, -1, -0.5, 0, 0.5, 1, 2])
          expect(typeOf(ce, head, arg)).toBe('real');
        for (const sym of ['u', 'w', 'v'])
          expect(typeOf(ce, head, sym)).toBe('real');
      });
    }

    it('Arcsch keeps the generic-point convention', () => {
      // Real-valued on every non-zero real; only a PROVABLE 0 widens.
      const ce = engineWithAssumptions();
      for (const arg of [-2, -1, -0.5, 0.5, 1, 2])
        expect(typeOf(ce, 'Arcsch', arg)).toBe('real');
      expect(typeOf(ce, 'Arcsch', 0)).toBe('number');
      for (const sym of ['u', 'w', 'v'])
        expect(typeOf(ce, 'Arcsch', sym)).toBe('real');
    });
  });
});
