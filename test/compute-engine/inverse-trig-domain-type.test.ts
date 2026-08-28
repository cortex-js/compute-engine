/**
 * Result TYPE of the inverse trig / inverse hyperbolic heads with a BOUNDED
 * real domain (`Arcsin`, `Arccos`, `Arcosh`, `Artanh`, `Arcoth`, `Arsech`,
 * `Arcsec`, `Arccsc`).
 *
 * User ruling 2026-07-30. Every one of these heads takes a COMPLEX value
 * outside its real domain (`arcsin(−2) = −π/2 + 1.3169…i`,
 * `arcosh(−2) = 1.3169… + iπ`, `arcsec(0.5) = 1.3169…i`), and `finite_real`
 * EXCLUDES complex — `ce.type('finite_complex').matches('finite_real')` is
 * `false`. The `finite_real` these heads claimed for any symbolic real
 * argument was therefore unsound, not merely imprecise. The claim is now
 * three-way:
 *
 * - argument provably IN domain  → `finite_real` (tight, unchanged)
 * - argument provably OUT        → a complex type
 * - magnitude unknown            → the join (the tightest SOUND type)
 *
 * The in/out decision is made with the numeric predicates
 * (`isGreater`/`isLessEqual`/…), which consult the assumptions system, so
 * `w ≥ 2` proves `Arcosh(w)` real AND `Arcsin(w)` complex.
 *
 * The real-closed heads (`Arsinh`, `Arctan`, `Arccot`) are real-valued on all
 * of ℝ: `finite_real` is correct and tight for them, and is guarded below.
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
  ['Arcsin', -1, 'finite_real'],
  ['Arcsin', 0.5, 'finite_real'],
  ['Arcsin', 1, 'finite_real'],
  ['Arcsin', 2, 'finite_complex'],
  ['Arcsin', -2, 'finite_complex'],
  ['Arccos', 0.5, 'finite_real'],
  ['Arccos', 2, 'finite_complex'],
  ['Arccos', -2, 'finite_complex'],
  // x ≥ 1
  ['Arcosh', 1, 'finite_real'],
  ['Arcosh', 2, 'finite_real'],
  ['Arcosh', 0, 'finite_complex'],
  ['Arcosh', 0.5, 'finite_complex'],
  ['Arcosh', -2, 'finite_complex'],
  // |x| < 1, ±∞ at ±1
  ['Artanh', 0, 'finite_real'],
  ['Artanh', -0.5, 'finite_real'],
  ['Artanh', 1, 'non_finite_number'],
  ['Artanh', -1, 'non_finite_number'],
  ['Artanh', 2, 'finite_complex'],
  ['Artanh', -2, 'finite_complex'],
  // |x| > 1, ±∞ at ±1
  ['Arcoth', 2, 'finite_real'],
  ['Arcoth', -2, 'finite_real'],
  ['Arcoth', 1, 'non_finite_number'],
  ['Arcoth', -1, 'non_finite_number'],
  ['Arcoth', 0, 'finite_complex'],
  ['Arcoth', 0.5, 'finite_complex'],
  // 0 < x ≤ 1, +∞ at 0
  ['Arsech', 0.5, 'finite_real'],
  ['Arsech', 1, 'finite_real'],
  ['Arsech', 0, 'non_finite_number'],
  ['Arsech', 2, 'finite_complex'],
  ['Arsech', -2, 'finite_complex'],
  // |x| ≥ 1, NaN at 0
  ['Arcsec', 1, 'finite_real'],
  ['Arcsec', -2, 'finite_real'],
  ['Arcsec', 0.5, 'finite_complex'],
  ['Arcsec', -0.5, 'finite_complex'],
  // Mathematically `arcsec(0) = ~oo`, which IS a member of `complex`, but the
  // evaluator currently yields NaN at 0 (`arcsec(0).N() → NaN`) and NaN is a
  // member only of `number`. The claim must not exclude the produced value.
  ['Arcsec', 0, 'number'],
  ['Arccsc', 1, 'finite_real'],
  ['Arccsc', -2, 'finite_real'],
  ['Arccsc', 0.5, 'finite_complex'],
  ['Arccsc', -0.5, 'finite_complex'],
  ['Arccsc', 0, 'number'],
];

/**
 * `[head, bare real symbol, `w ≥ 2`, `0 < v < 1`]`.
 *
 * The bare-symbol column is the JOIN: `finite_complex` for a head with no real
 * pole, `complex | non_finite_number` for one whose pole value is `±∞`, and
 * `number` when the pole value may be NaN. The signed pair is spelled out in
 * that union because the bare name `complex` denotes the FINITE complex
 * numbers and cannot absorb the pole on its own.
 * (Arcsec/Arccsc join to `number`: their pole value is mathematically `~oo`,
 * but the evaluator produces NaN at 0, so any narrower claim would exclude a
 * value the head actually produces.)
 *
 * The claim is printed with its disjuncts in the lattice's own order, which
 * is why the expected string reads `complex | non_finite_number`.
 */
const SYMBOLIC_CASES: [string, string, string, string][] = [
  ['Arcsin', 'finite_complex', 'finite_complex', 'finite_real'],
  ['Arccos', 'finite_complex', 'finite_complex', 'finite_real'],
  ['Arcosh', 'finite_complex', 'finite_real', 'finite_complex'],
  ['Artanh', 'complex | non_finite_number', 'finite_complex', 'finite_real'],
  ['Arcoth', 'complex | non_finite_number', 'finite_real', 'finite_complex'],
  ['Arsech', 'complex | non_finite_number', 'finite_complex', 'finite_real'],
  ['Arcsec', 'number', 'finite_real', 'finite_complex'],
  ['Arccsc', 'number', 'finite_real', 'finite_complex'],
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
  it('`finite_real` excludes complex (why the old claim was unsound)', () => {
    const ce = new ComputeEngine();
    expect(ce.type('finite_complex').matches('finite_real')).toBe(false);
    // …and the join direction that makes `finite_complex` the tightest sound
    // type for an argument of unknown magnitude.
    expect(ce.type('finite_real').matches('finite_complex')).toBe(true);
    // …and why a pole-carrying head cannot claim `complex` alone: the bare
    // name denotes the FINITE complex numbers, so the signed infinities are
    // NOT below it and have to be named in the union.
    expect(ce.type('non_finite_number').matches('complex')).toBe(false);
    expect(
      ce.type('non_finite_number').matches('complex | non_finite_number')
    ).toBe(true);
    expect(ce.type('finite_complex').matches('complex | non_finite_number')).toBe(
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
        if (expected === 'finite_real')
          expect([witness, finite && real]).toEqual([witness, true]);
        else if (expected === 'finite_complex')
          expect([witness, finite]).toEqual([witness, true]);
        else if (expected === 'non_finite_number')
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

    it('no bounded head claims `finite_real` for a bare real symbol', () => {
      const ce = engineWithAssumptions();
      for (const head of BOUNDED_HEADS)
        expect([head, typeOf(ce, head, 'u')]).not.toEqual([
          head,
          'finite_real',
        ]);
    });

    it('`w ≥ 2` proves Arcosh in-domain and Arcsin out-of-domain', () => {
      const ce = engineWithAssumptions();
      expect(ce.box('w').isGreaterEqual(1)).toBe(true);
      expect(typeOf(ce, 'Arcosh', 'w')).toBe('finite_real');
      expect(typeOf(ce, 'Arcsin', 'w')).toBe('finite_complex');
      expect(ce.type(typeOf(ce, 'Arcsin', 'w')).matches('finite_real')).toBe(
        false
      );
    });

    it('a provably non-zero argument drops the pole arm (Arcsec/Arccsc)', () => {
      const ce = new ComputeEngine();
      ce.declare('p', 'real');
      ce.assume(ce.parse('p \\gt 0'));
      // Not provably in `|x| ≥ 1` nor in `(0, 1)`, but provably not 0, so the
      // NaN arm is gone: the value is finite, real or complex.
      expect(typeOf(ce, 'Arcsec', 'p')).toBe('finite_complex');
      expect(typeOf(ce, 'Arccsc', 'p')).toBe('finite_complex');
    });
  });

  describe('real-closed heads are UNCHANGED', () => {
    for (const head of ['Arsinh', 'Arctan', 'Arccot'] as const) {
      it(`${head} stays finite_real everywhere`, () => {
        const ce = engineWithAssumptions();
        for (const arg of [-2, -1, -0.5, 0, 0.5, 1, 2])
          expect(typeOf(ce, head, arg)).toBe('finite_real');
        for (const sym of ['u', 'w', 'v'])
          expect(typeOf(ce, head, sym)).toBe('finite_real');
      });
    }

    it('Arcsch keeps the generic-point convention', () => {
      // Real-valued on every non-zero real; only a PROVABLE 0 widens.
      const ce = engineWithAssumptions();
      for (const arg of [-2, -1, -0.5, 0.5, 1, 2])
        expect(typeOf(ce, 'Arcsch', arg)).toBe('finite_real');
      expect(typeOf(ce, 'Arcsch', 0)).toBe('number');
      for (const sym of ['u', 'w', 'v'])
        expect(typeOf(ce, 'Arcsch', sym)).toBe('finite_real');
    });
  });
});
