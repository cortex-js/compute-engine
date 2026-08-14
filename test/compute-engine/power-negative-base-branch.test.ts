import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { realPowerBranchTerms } from '../../src/compute-engine/boxed-expression/arithmetic-power';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';

/**
 * A negative base with an exact rational exponent `p/q` in lowest terms and an
 * ODD `q` has a real principal value — `(−8)^(2/3) = 4`, matching
 * `Root(−8, 3) = −2`. Three components used to answer this question
 * separately: the `Power` type handler read the EXACT rational, while `.N()`
 * and the compiled constant fold both recovered `p/q` from the exponent's
 * DOUBLE by continued fractions. `100/3` reconstructs to the dyadic
 * `4691249611844267/140737488355328`, whose denominator is EVEN, so
 * `(−2)^(100/3)` was `finite_number` to the type, complex to `.N()`, and `NaN`
 * to the compiler. They now share one decision (`realPowerBranchTerms`).
 */

const ce = new ComputeEngine();

function parts(e: any): { re: number; im: number } {
  const n = e.N();
  return { re: n.re, im: n.im };
}

/**
 * Compile with `constantFold: false`. This file exists to exercise the
 * COMPILER's own negative-base branch decision (`negativeBaseRealPow`), which
 * runs while lowering a structural `Power`. Whole-expression compile-time
 * constant folding evaluates a variable-free `Power` through the interpreter
 * instead and emits its value as a literal, so leaving folding on would make
 * every assertion here a test of `.N()` rather than of the peephole.
 */
function folded(e: any): number | { re: number; im: number } {
  const r = compile(e, { fallback: false, constantFold: false });
  return (r.run as any)!() as any;
}

/**
 * What the callers actually read off `realPowerBranchTerms`: the real branch is
 * taken only for an ODD denominator. `undefined` (no trustworthy rational) and
 * an even denominator both mean the principal COMPLEX value.
 */
function isRealBranch(t: [number, number] | undefined): boolean {
  return t !== undefined && t[1] % 2 !== 0;
}

/**
 * `realPowerBranchTerms` sizes its reconstruction window from the
 * PROCESS-GLOBAL `BigDecimal.precision` — the precision that actually rounded
 * the double — so exercising it at a given precision means writing that global,
 * not passing an argument. (It took an engine `precision` parameter once; that
 * was the bug — see the "creation order" suite at the bottom of this file.)
 */
function atPrecision<T>(digits: number, fn: () => T): T {
  const saved = BigDecimal.precision;
  BigDecimal.precision = digits;
  try {
    return fn();
  } finally {
    BigDecimal.precision = saved;
  }
}

describe('NEGATIVE BASE: exact-rational branch decision', () => {
  describe('realPowerBranchTerms', () => {
    it('uses the EXACT rational when one is available', () => {
      expect(realPowerBranchTerms([100, 3], 100 / 3)).toEqual([100, 3]);
      expect(realPowerBranchTerms([2, 3], 2 / 3)).toEqual([2, 3]);
      // Reduced, not as-written.
      expect(realPowerBranchTerms([200, 6], 100 / 3)).toEqual([100, 3]);
      // An even denominator stays even.
      expect(realPowerBranchTerms([3, 2], 1.5)).toEqual([3, 2]);
    });

    it('recovers the rational a double was rounded from', () => {
      // Without the ulp-scale tolerance this is the dyadic
      // 4691249611844267/140737488355328 — an EVEN denominator.
      expect(realPowerBranchTerms(undefined, 100 / 3)).toEqual([100, 3]);
      expect(realPowerBranchTerms(undefined, -100 / 3)).toEqual([-100, 3]);
      expect(realPowerBranchTerms(undefined, 1000 / 7)).toEqual([1000, 7]);
      expect(realPowerBranchTerms(undefined, 2 / 3)).toEqual([2, 3]);
    });

    it('does NOT snap a genuine decimal to a nearby small rational', () => {
      // 0.3333333333 is not 1/3: it never reaches the real branch. (Its own
      // terms have a ~1e10 denominator, which the coincidence budget declines
      // outright — `undefined` and an even denominator are the same answer to
      // the caller: the principal complex value.)
      expect(isRealBranch(realPowerBranchTerms(undefined, 0.3333333333))).toBe(
        false
      );
      expect(realPowerBranchTerms(undefined, 0.3)).toEqual([3, 10]);
      expect(realPowerBranchTerms(undefined, 0.25)).toEqual([1, 4]);
      // ...not even at machine precision, where the tolerance is widest.
      atPrecision(15, () => {
        expect(
          isRealBranch(realPowerBranchTerms(undefined, 0.3333333333))
        ).toBe(false);
        expect(realPowerBranchTerms(undefined, 0.3)).toEqual([3, 10]);
      });
    });

    /**
     * EVERY irrational has continued-fraction convergents with
     * `|x − p/q| ~ 1/q²`, so at any fixed tolerance some convergent eventually
     * lands inside the admission window — `π` on `5419351/1725033`, `√2` on
     * `9369319/6625109`, both with an ODD denominator. A closeness-only
     * reconstruction therefore put `(−2)^π` and `(−2)^(√2)` on the REAL branch,
     * and since each precision picks a DIFFERENT convergent, the machine and
     * bignum lanes disagreed about which irrationals were "rational".
     *
     * The coincidence budget rejects these: their `(6/π²)·q²·2tol` runs from
     * 1e-1 to 2, four orders of magnitude past the 1e-4 budget, where a real
     * `.N()`-rounded rational (terms as large as `1000001/15`) tops out at
     * 2e-11.
     *
     * What that budget does NOT buy is a proof of irrationality for an
     * arbitrary double. It bounds a coincidence RATE: ~5e-5 of arbitrary
     * doubles still reconstruct to something (~3e-5 onto the real branch), so
     * accepted coincidences exist just under budget at `q ~ 1e4–7e5`. The
     * constants below are the ones that matter in practice, not an exhaustive
     * guarantee — and symmetrically, a true odd-`q` rational whose `q` exceeds
     * `~0.009/√tol` is REJECTED here, because at double precision it is
     * genuinely indistinguishable from an irrational.
     */
    it('does NOT snap an IRRATIONAL to a continued-fraction convergent', () => {
      const irrationals: [string, number][] = [
        ['π', Math.PI],
        ['e', Math.E],
        ['√2', Math.SQRT2],
        ['√5', Math.sqrt(5)],
        ['ln 2', Math.LN2],
        ['1/π', 1 / Math.PI],
      ];
      const snapped: string[] = [];
      for (const [label, v] of irrationals)
        for (const digits of [15, 16, 17])
          atPrecision(digits, () => {
            const t = realPowerBranchTerms(undefined, v);
            if (isRealBranch(t))
              snapped.push(`${label} @${digits}: ${JSON.stringify(t)}`);
          });
      expect(snapped).toEqual([]);
    });

    it('ignores a precision configured BELOW machine precision', () => {
      // `new ComputeEngine({ precision: 3 })` does not apply the
      // MACHINE_PRECISION floor `setPrecision` does — it writes a GLOBAL of 3,
      // a 1%-wide window, which snaps anything to a small rational. The window
      // is clamped at 15 digits, so the branch cannot depend on it.
      const at3 = atPrecision(3, () =>
        realPowerBranchTerms(undefined, 1.234567)
      );
      const at15 = atPrecision(15, () =>
        realPowerBranchTerms(undefined, 1.234567)
      );
      expect(at3).toEqual(at15);
      expect(isRealBranch(at3)).toBe(false);
      expect(
        isRealBranch(
          atPrecision(3, () => realPowerBranchTerms(undefined, Math.PI))
        )
      ).toBe(false);
      expect(
        atPrecision(3, () => realPowerBranchTerms(undefined, 100 / 3))
      ).toEqual([100, 3]);
    });

    it('recovers a rational rounded at the WORKING precision, not the ulp', () => {
      // A machine-precision lane numericizes an exact rational by rounding to
      // 15 significant digits BEFORE forming the double, so the double is not
      // the nearest one: 100/3 becomes 33.3333333333333. At the 4-ulp tolerance
      // that reconstructs to 335089257988833/10052677739665 — odd denominator,
      // ODD numerator — which flipped the sign of (-2)^(100/3). Those terms are
      // now declined outright: a 1e13 denominator inside a 1e-14 window is a
      // coincidence, not evidence of where the double came from.
      const machine100over3 = 33.3333333333333;
      expect(machine100over3).not.toBe(100 / 3);
      expect(
        atPrecision(17, () => realPowerBranchTerms(undefined, machine100over3))
      ).toBeUndefined();
      atPrecision(15, () => {
        expect(realPowerBranchTerms(undefined, machine100over3)).toEqual([
          100, 3,
        ]);
        // Large terms: 1000001/3 numericizes to 333333.666666667, 2.9e-10 from
        // its exact value — past the 1e-12 absolute bound this gate used to
        // carry, and well inside the 3.3e-9 precision-scaled tolerance that
        // replaced it.
        expect(realPowerBranchTerms(undefined, 333333.666666667)).toEqual([
          1000001, 3,
        ]);
        // An EVEN denominator must survive the wider tolerance: 7/6 numericizes
        // to 1.16666666666667 and must stay on the complex branch.
        expect(realPowerBranchTerms(undefined, 1.16666666666667)).toEqual([
          7, 6,
        ]);
      });
    });

    /**
     * The faithfulness gate and the coincidence budget must measure the SAME
     * window. They did not: acceptance used `max(1e-12, tol)` while the budget
     * was charged at the bare `tol`, and for |value| < 100 the 1e-12 floor
     * dominated. `rationalize` can fall out of its convergent loop on its own
     * internal 1e-15 guard and return terms it never checked against `tol`, so
     * the floor admitted reconstructions tens of times wider than the window
     * their coincidence odds were computed for — 0.0249… → 24737/993426 was
     * charged 2.7e-5 against the 1e-4 budget when its true expected-coincidence
     * count over the window it was actually admitted at is 1.2, i.e. a
     * certainty. Measured over 2e6 arbitrary doubles at 17 digits, that
     * undercharge pushed the real acceptance rate to 1.05e-4 — past the budget
     * the gate exists to enforce.
     */
    it('measures faithfulness at the same width the budget is charged for', () => {
      // Admitted through the old 1e-12 floor; its own tolerance is ~2.2e-17.
      expect(
        atPrecision(17, () =>
          realPowerBranchTerms(undefined, 0.02490069718328337)
        )
      ).toBeUndefined();
      // The floor was never load-bearing for a genuine rounding: a p/q rounded
      // at the working precision lands well inside `tol` (worst case ~0.47·tol
      // over the terms exercised here), so tightening cannot cost a legitimate
      // reconstruction — the rows above still resolve.
      expect(
        atPrecision(16, () =>
          realPowerBranchTerms(undefined, 11.44444444444444)
        )
      ).toEqual([103, 9]);
    });

    it('declines a non-finite value with no exact rational', () => {
      expect(realPowerBranchTerms(undefined, NaN)).toBeUndefined();
      expect(realPowerBranchTerms(undefined, Infinity)).toBeUndefined();
    });
  });

  describe('the 100/3 witness', () => {
    const expr = ce.box(['Power', -2, ['Rational', 100, 3]]);
    const expected = Math.pow(2, 100 / 3); // ≈ 1.0822639e10, REAL

    it('is typed finite_number', () => {
      expect(expr.type.toString()).toBe('finite_number');
    });

    it('.N() is the REAL +2^(100/3)', () => {
      const { re, im } = parts(expr);
      expect(im).toBe(0);
      expect(re / expected).toBeCloseTo(1, 12);
    });

    it('the compiled constant agrees with .N()', () => {
      expect(folded(expr)).toBe(expected);
    });

    it('a FLOAT exponent of the same value decides the same branch', () => {
      // `.N()` only ever sees the double, so the float route must land on the
      // same branch as the exact one.
      const f = ce.box(['Power', -2, 100 / 3]);
      expect(f.type.toString()).toBe('finite_number');
      expect(parts(f).im).toBe(0);
      expect(folded(f)).toBe(expected);
    });
  });

  describe('branch decisions that must not move', () => {
    const rows: [string, any, 'real' | 'complex'][] = [
      ['(-8)^(2/3)', ['Power', -8, ['Rational', 2, 3]], 'real'],
      ['(-2)^(2/3)', ['Power', -2, ['Rational', 2, 3]], 'real'],
      ['(-8)^(5/3)', ['Power', -8, ['Rational', 5, 3]], 'real'],
      ['Root(-8, 3)', ['Root', -8, 3], 'real'],
      ['(-2)^0.3', ['Power', -2, 0.3], 'complex'],
      ['(-8)^(3/2)', ['Power', -8, ['Rational', 3, 2]], 'complex'],
      ['Root(-8, 4)', ['Root', -8, 4], 'complex'],
      ['(-2)^(1/4)', ['Power', -2, ['Rational', 1, 4]], 'complex'],
    ];

    for (const [label, json, branch] of rows) {
      it(`${label} is ${branch}, and type/.N()/compiled agree`, () => {
        const e = ce.box(json);
        const { re, im } = parts(e);
        if (branch === 'real') {
          expect(Math.abs(im)).toBe(0);
          expect(e.type.matches('complex') && !e.type.matches('real')).toBe(
            false
          );
          expect(folded(e)).toBeCloseTo(re, 6);
        } else {
          expect(im).not.toBe(0);
          expect(e.type.toString()).toBe('finite_complex');
          const f = folded(e) as { re: number; im: number };
          expect(f.re).toBeCloseTo(re, 6);
          expect(f.im).toBeCloseTo(im, 6);
        }
      });
    }

    it('(-2)^2 is the plain integer power', () => {
      const e = ce.box(['Power', -2, 2]);
      expect(e.type.toString()).toBe('finite_integer');
      expect(e.N().re).toBe(4);
      expect(folded(e)).toBe(4);
    });

    it('a symbolic real base keeps the real Math.pow lowering', () => {
      const ce2 = new ComputeEngine();
      ce2.declare('r', 'real');
      const e = ce2.box(['Power', 'r', 0.3]);
      expect(e.type.toString()).toBe('finite_number');
      expect(compile(e, { fallback: false }).code).toBe('Math.pow(_.r, 0.3)');
    });
  });

  describe('compiled ≡ .N() sweep over negative bases', () => {
    it('agrees on every base/exponent pair', () => {
      const bases = [-2, -8, -1, -3, -27, -0.5, -1.5, -100, -7, -1000];
      const exps: any[] = [];
      for (const q of [1, 2, 3, 4, 5, 6, 7, 8, 9, 12, 15, 16])
        for (const p of [1, 2, 3, 5, 7, 11, 100, 101, -1, -2, -5, -100])
          exps.push(['Rational', p, q]);
      for (const f of [
        0.3,
        0.5,
        1.5,
        2.5,
        0.25,
        0.75,
        1 / 3,
        2 / 3,
        5 / 3,
        100 / 3,
        1 / 7,
        22 / 7,
        0.3333333333,
        -0.3,
        -100 / 3,
        0.1,
        1.2,
        4.9,
        -2.5,
        3.75,
      ])
        exps.push(f);

      let compared = 0;
      const mismatches: string[] = [];
      for (const b of bases) {
        for (const e of exps) {
          const expr = ce.box(['Power', b, e]);
          const r = compile(expr, { fallback: false });
          if (!r.success || !r.run) continue;
          const v = (r.run as any)() as any;
          const c =
            typeof v === 'number' ? { re: v, im: 0 } : { re: v.re, im: v.im };
          const n = parts(expr);
          if (!Number.isFinite(n.re) || !Number.isFinite(n.im)) continue;
          compared += 1;
          // Complex agreement is measured against the MODULUS: the polar
          // `Complex.pow` leaves ~1e-15 relative dust on a component the
          // interpreter snaps to an exact zero, which is not a disagreement
          // about the value.
          const scale = Math.max(
            1e-300,
            Math.hypot(c.re, c.im),
            Math.hypot(n.re, n.im)
          );
          const d = Math.hypot(c.re - n.re, c.im - n.im);
          if (!(d <= 1e-9 * scale))
            mismatches.push(
              `(${b})^${JSON.stringify(e)}: compiled ${JSON.stringify(c)} vs N ${JSON.stringify(n)}`
            );
        }
      }
      expect(mismatches).toEqual([]);
      expect(compared).toBeGreaterThan(1000);
    });
  });
});

/**
 * A MACHINE-precision engine numericizes an exact rational by rounding it to
 * 15 significant digits before projecting to a double, so `.N()`'s exponent is
 * NOT the nearest double to `p/q`. Reconstructing `p/q` from it at an ulp-scale
 * tolerance recovered different terms — different denominator PARITY and
 * different numerator parity — so the machine lane disagreed with the bignum
 * lane about both the branch and the sign: `(-2)^(100/3)` was negative at
 * machine precision and positive at bignum precision.
 *
 * `ce.precision` is written here, and `BigDecimal.precision` is process-global,
 * so this block owns its engines and never touches the shared bignum `ce`
 * above. (Jest gives each test FILE its own module registry, so the global does
 * not leak to other suites.)
 */
describe('NEGATIVE BASE: machine lane agrees with the bignum lane', () => {
  // `ce.precision = 'machine'` writes the process-global `BigDecimal.precision`
  // (to 15). Restore it so later suites in this process are unaffected.
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  const rows: [p: number, q: number, sign: 'pos' | 'neg' | 'complex'][] = [
    [100, 3, 'pos'], // p even, q odd
    [7, 5, 'neg'], // p odd, q odd
    [103, 7, 'neg'],
    [7, 3, 'neg'],
    [200, 9, 'pos'],
    [200, 15, 'pos'],
    [2, 3, 'pos'],
    [1, 2, 'complex'], // even q: principal complex value
    [3, 4, 'complex'],
    [7, 6, 'complex'],
  ];

  function classify(e: any): 'pos' | 'neg' | 'complex' | 'other' {
    const n = e.N();
    if (n.im !== 0) return 'complex';
    if (!Number.isFinite(n.re) || n.re === 0) return 'other';
    return n.re > 0 ? 'pos' : 'neg';
  }

  for (const [p, q, sign] of rows) {
    it(`(-2)^(${p}/${q}) is ${sign} on BOTH lanes`, () => {
      const machine = new ComputeEngine();
      machine.precision = 'machine';
      expect(classify(machine.box(['Power', -2, ['Rational', p, q]]))).toBe(
        sign
      );

      const bignum = new ComputeEngine();
      expect(classify(bignum.box(['Power', -2, ['Rational', p, q]]))).toBe(
        sign
      );
    });
  }

  it('(-2)^(100/3) is the REAL +2^(100/3) at machine precision', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const n = machine.box(['Power', -2, ['Rational', 100, 3]]).N();
    expect(n.im).toBe(0);
    expect(n.re).toBeGreaterThan(0);
    expect(n.re / Math.pow(2, 100 / 3)).toBeCloseTo(1, 12);
  });

  it.each(['machine', 'bignum'])(
    'agrees with (-1)^p·|b|^(p/q) over a %s-lane sweep',
    (lane) => {
      const engine = new ComputeEngine();
      if (lane === 'machine') engine.precision = 'machine';
      const mismatches: string[] = [];
      let compared = 0;
      for (const b of [-2, -8, -0.5, -3.7]) {
        for (const q of [3, 5, 7, 9, 15]) {
          // 1000001/3 numericizes to 333333.666666667, whose reconstruction
          // needs the widest window this helper ever opens.
          for (const p of [1, 2, 7, 100, 103, 200, 1000001]) {
            if (p % q === 0) continue;
            const mag = Math.pow(Math.abs(b), p / q);
            if (!Number.isFinite(mag) || mag === 0) continue;
            const want = p % 2 === 0 ? mag : -mag;
            const n = engine.box(['Power', b, ['Rational', p, q]]).N();
            compared += 1;
            if (n.im !== 0 || !(Math.abs(n.re / want - 1) < 1e-9))
              mismatches.push(
                `(${b})^(${p}/${q}): want ${want}, got ${n.re}${n.im ? `+${n.im}i` : ''}`
              );
          }
        }
      }
      expect(mismatches).toEqual([]);
      expect(compared).toBe(108);
    }
  );

  /**
   * The counterpart of the sweep above: an IRRATIONAL exponent must reach the
   * principal complex value on every lane. Before the coincidence budget each
   * precision snapped a different set of these to a continued-fraction
   * convergent with an odd denominator and returned a REAL value — machine
   * `(−2)^π = −8.825`, bignum `(−2)^e = −6.581`, both lanes `(−2)^(√2)` and
   * `(−2)^(1/π)` real with OPPOSITE signs.
   */
  it.each(['machine', 'bignum'])(
    'takes the complex branch for an irrational exponent on the %s lane',
    (lane) => {
      const engine = new ComputeEngine();
      if (lane === 'machine') engine.precision = 'machine';
      const exps: [string, any][] = [
        ['π', 'Pi'],
        ['e', 'ExponentialE'],
        ['√2', ['Sqrt', 2]],
        ['√5', ['Sqrt', 5]],
        ['ln 2', ['Ln', 2]],
        ['1/π', ['Divide', 1, 'Pi']],
        ['1.234567', 1.234567],
      ];
      const real: string[] = [];
      for (const [label, e] of exps) {
        const n = engine.box(['Power', -2, e]).N();
        if (n.im === 0) real.push(`(-2)^${label} = ${n.re}`);
      }
      expect(real).toEqual([]);
    }
  );

  /**
   * `new ComputeEngine({ precision: 3 })` skips the MACHINE_PRECISION floor
   * that `ce.precision = 3` applies, so the branch helper used to be handed a
   * precision of 3 — a 1%-wide reconstruction window, which snapped
   * `(−2)^1.234567` to a real value while every other engine returned the
   * complex one.
   */
  it('a below-machine-precision engine decides the same branch', () => {
    const tiny = new ComputeEngine({ precision: 3 });
    for (const e of ['Pi', ['Sqrt', 2], 1.234567] as any[])
      expect(tiny.box(['Power', -2, e]).N().im).not.toBe(0);
    // An exact rational is unaffected by the engine's precision: `.N()` reads
    // the branch off the RAW exponent (`Power`'s `expression.op2`), which is
    // still `100/3` however coarsely it would numericize, so `(-2)^(100/3)` is
    // REAL here — same answer as the type handler and the compiled fold. Only
    // the magnitude is 3-digit. (Before the exponent's provenance was threaded,
    // the double `33.3` was the only handle and reconstructed to `333/10` — an
    // even denominator — making this one engine disagree with the other two
    // legs.)
    expect(tiny.box(['Power', -2, ['Rational', 100, 3]]).N().im).toBe(0);
  });
});

/**
 * `BigDecimal.precision` is PROCESS-GLOBAL and every engine construction writes
 * it, so an engine's own `precision` is not what rounds its numbers — the most
 * recently constructed engine's is. Sizing the reconstruction window off
 * `ce.precision` therefore computed a 17-digit tolerance for a double that had
 * been rounded at 15, missed the reconstruction, and put `(-2)^(100/3)` back on
 * the COMPLEX branch — the exact bug this helper exists to fix, resurrected by
 * nothing but the order the engines were created in.
 *
 * The window is now sized from the global, which is both the value that
 * actually governed the rounding and the only one there is — so same-moment
 * lanes agree by construction.
 */
describe('NEGATIVE BASE: engine CREATION ORDER does not move the branch', () => {
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  const expected = Math.pow(2, 100 / 3);

  it('a default engine created BEFORE a machine engine still resolves the real branch', () => {
    const bignum = new ComputeEngine();
    // Constructing this one rewrites the global to 15 under `bignum`'s feet.
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    expect(bignum.precision).toBe(21);
    expect(BigDecimal.precision).toBe(15);

    for (const engine of [bignum, machine]) {
      const n = engine.box(['Power', -2, ['Rational', 100, 3]]).N();
      expect(n.im).toBe(0);
      expect(n.re).toBeGreaterThan(0);
      expect(n.re / expected).toBeCloseTo(1, 12);
    }
  });

  it('a default engine created AFTER a machine engine resolves it too', () => {
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    const bignum = new ComputeEngine();
    expect(BigDecimal.precision).toBe(21);

    for (const engine of [bignum, machine]) {
      const n = engine.box(['Power', -2, ['Rational', 100, 3]]).N();
      expect(n.im).toBe(0);
      expect(n.re).toBeGreaterThan(0);
      expect(n.re / expected).toBeCloseTo(1, 12);
    }
  });

  it('an irrational stays complex whichever engine was built last', () => {
    const bignum = new ComputeEngine();
    const machine = new ComputeEngine();
    machine.precision = 'machine';
    for (const engine of [bignum, machine])
      for (const e of ['Pi', ['Sqrt', 2], 1.234567] as any[])
        expect(engine.box(['Power', -2, e]).N().im).not.toBe(0);
  });
});

/**
 * Reconstructing `p/q` from the exponent's DOUBLE is bounded by a coincidence
 * budget, which caps the recoverable denominator at `~0.009/√tol` — around
 * 3e5 at 17 digits. Past that cap a genuine odd-`q` rational is
 * indistinguishable from an irrational and was DECLINED, so `.N()` returned
 * the principal complex value for `(−2)^(1000003/1000001)` while the type
 * handler and the compiled constant fold — both of which still hold the exact
 * rational — said real. Three legs, two stories.
 *
 * `.N()` now holds the exact rational too: the evaluation driver hands every
 * `evaluate` handler the node itself (`options.expression`), whose `ops` are
 * the RAW, pre-numericization operands, and `Power` reads its exponent's terms
 * off `expression.op2` instead of guessing them back from a double. The
 * reconstruction survives only as the fallback for an exponent that HAS no
 * exact rational — a float, `Pi`, `Ln(2)` — where nothing was lost to
 * numericization in the first place.
 */
describe('NEGATIVE BASE: exact exponent provenance under .N()', () => {
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  /** `.N()`, the compiled constant fold, and `.type`, as one row. */
  function legs(e: any): {
    n: { re: number; im: number };
    compiled: { re: number; im: number } | undefined;
    typeIsComplex: boolean;
  } {
    const n = parts(e);
    const r = compile(e, { fallback: false });
    let compiled: { re: number; im: number } | undefined = undefined;
    if (r.success && r.run) {
      const v = (r.run as any)() as any;
      compiled =
        typeof v === 'number' ? { re: v, im: 0 } : { re: v.re, im: v.im };
    }
    return {
      n,
      compiled,
      typeIsComplex:
        e.type.matches('complex') && !e.type.matches('real') ? true : false,
    };
  }

  /**
   * The witnesses of the recorded disagreement. Both denominators are far past
   * the reconstruction cap, so before the exponent's provenance was threaded
   * `.N()` was COMPLEX here (`(−2)^(1000003/1000001)` → −2.0000027… −
   * 1.2566e−5·i) while `run()` returned the real −2.0000027725878717. The
   * numerators are odd, so the real value is negative: `(−1)^p·|b|^(p/q)`.
   */
  const flipped: [p: number, q: number][] = [
    [1000003, 1000001],
    [10000003, 10000001],
  ];

  for (const [p, q] of flipped) {
    it(`(-2)^(${p}/${q}) is REAL, and .N()/compiled/type agree`, () => {
      const e = ce.box(['Power', -2, ['Rational', p, q]]);
      const want = (p % 2 === 0 ? 1 : -1) * Math.pow(2, p / q);
      const { n, compiled, typeIsComplex } = legs(e);

      // `.N()`: real, and on the `(−1)^p` sign.
      expect(Math.abs(n.im)).toBe(0);
      expect(n.re).toBeLessThan(0);
      expect(n.re / want).toBeCloseTo(1, 12);

      // ...agreeing with the compiled fold and with the type.
      expect(compiled).toBeDefined();
      expect(compiled!.im).toBe(0);
      expect(compiled!.re / want).toBeCloseTo(1, 12);
      expect(typeIsComplex).toBe(false);
    });
  }

  /**
   * Denominators spanning the reconstruction cap: 3 and 65839 were always
   * recoverable from the double, 224219 sits just under the budget, 1000001 is
   * over it and only the exact rational reaches the real branch, and
   * 18014398509481985 is past 2^53, where the exact terms themselves survive
   * only if their PARITY does. All five must behave identically, on both
   * lanes, on all three legs.
   *
   * The numerators are `2q+1`/`2q+2` up to the safe range; past it that ratio
   * rounds to the double 2 exactly and the node folds at canonicalization, so
   * the last row uses a ratio (~11/3) that stays away from an integer.
   */
  it.each(['machine', 'bignum'])(
    'agrees on all three legs across the reconstruction cap (%s lane)',
    (lane) => {
      const engine = new ComputeEngine();
      if (lane === 'machine') engine.precision = 'machine';
      const mismatches: string[] = [];
      let compared = 0;
      const pairs: [p: bigint, q: bigint][] = [];
      for (const q of [3n, 65839n, 224219n, 1000001n])
        // One odd and one even numerator, so both signs of the real branch are
        // exercised at every denominator.
        for (const p of [2n * q + 1n, 2n * q + 2n]) pairs.push([p, q]);
      pairs.push([66052794534767279n, 18014398509481985n]); // odd p
      pairs.push([66052794534767278n, 18014398509481985n]); // even p
      for (const [p, q] of pairs) {
        const e = engine.box(['Power', -2, engine.number([p, q])]);
        const want =
          (p % 2n === 0n ? 1 : -1) * Math.pow(2, Number(p) / Number(q));
        const { n, compiled, typeIsComplex } = legs(e);
        compared += 1;
        if (Math.abs(n.im) !== 0 || !(Math.abs(n.re / want - 1) < 1e-9))
          mismatches.push(`N (-2)^(${p}/${q}) = ${n.re} + ${n.im}i`);
        if (
          compiled === undefined ||
          compiled.im !== 0 ||
          !(Math.abs(compiled.re / want - 1) < 1e-9)
        )
          mismatches.push(
            `compiled (-2)^(${p}/${q}) = ${JSON.stringify(compiled)}`
          );
        if (typeIsComplex)
          mismatches.push(`type (-2)^(${p}/${q}) = ${e.type.toString()}`);
      }
      expect(mismatches).toEqual([]);
      expect(compared).toBe(10);
    }
  );

  /**
   * The exponent's provenance reaches `.N()` only for the routes where `op2`
   * IS a number literal (an inline rational, a `Rational` node, a `Sum` body)
   * or a SYMBOL bound to one. `asRational` reads a literal, so `(-2)^u` with
   * `u := 1000003/1000001` used to decide its branch from the double — COMPLEX
   * — while the same exponent written inline decided it from the exact terms —
   * REAL. Following the symbol's binding (which `.value` resolves without
   * evaluating anything) closes that divergence.
   */
  it('follows a SYMBOL bound to an exact rational', () => {
    const engine = new ComputeEngine();
    engine.assign('u', engine.box(['Rational', 1000003, 1000001]));
    const want = -Math.pow(2, 1000003 / 1000001); // odd numerator ⇒ negative

    for (const e of [engine.box(['Power', -2, 'u']), engine.parse('(-2)^u')]) {
      const n = e.N();
      expect(Math.abs(n.im)).toBe(0);
      expect(n.re / want).toBeCloseTo(1, 12);
    }
    // ...the same value the literal route returns.
    const literal = engine.box(['Power', -2, ['Rational', 1000003, 1000001]]);
    expect(literal.N().re).toBe(engine.box(['Power', -2, 'u']).N().re);
  });

  /**
   * KNOWN RESIDUAL, pinned rather than left unstated. Provenance is read off
   * the node's own `op2`, so it survives exactly one hop: a number literal, or
   * a symbol bound to one. An `op2` whose exact value only exists once
   * something ELSE has run — a lambda parameter bound at application, a
   * `When`'s selected arm — reaches the handler as a plain expression, and the
   * float reconstruction decides. Past its cap (`q = 1000001`) that is the
   * COMPLEX branch, so these routes still disagree with the literal one.
   *
   * Recovering them would mean evaluating an arbitrary `op2` inside the engine's
   * hottest operator — a re-entrancy and cost hazard deliberately not taken.
   */
  it('does NOT recover provenance through a lambda parameter or a When (residual)', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('t \\mapsto (-2)^t'));
    const residual = [
      engine.box(['f', ['Rational', 1000003, 1000001]]),
      engine.box(['Power', -2, ['When', ['Rational', 1000003, 1000001], true]]),
    ];
    for (const e of residual) expect(e.N().im).not.toBe(0);

    // The routes where `op2` IS the literal — including one nested in a `Sum`
    // body — do resolve, and are the reference these residuals differ from.
    expect(
      Math.abs(engine.box(['Power', -2, ['Rational', 1000003, 1000001]]).N().im)
    ).toBe(0);
    expect(
      Math.abs(
        engine
          .box([
            'Sum',
            ['Power', -2, ['Rational', 1000003, 1000001]],
            ['Limits', 'k', 1, 1],
          ])
          .N().im
      )
    ).toBe(0);
  });

  /**
   * The provenance-free controls. An exponent with no exact rational loses
   * nothing to numericization, so the rate-bounded reconstruction remains the
   * decision — unchanged in both directions.
   */
  it('leaves an exponent with no exact rational on the reconstruction path', () => {
    const rows: [string, any][] = [
      ['0.333333333333334', 0.333333333333334],
      ['0.3333333333', 0.3333333333],
      ['1.234567', 1.234567],
      ['π', 'Pi'],
      ['e', 'ExponentialE'],
      ['√2', ['Sqrt', 2]],
      ['ln 2', ['Ln', 2]],
    ];
    const real: string[] = [];
    for (const [label, ex] of rows) {
      const n = ce.box(['Power', -2, ex]).N();
      if (n.im === 0) real.push(`(-2)^${label} = ${n.re}`);
    }
    expect(real).toEqual([]);

    // ...and a float that DOES reconstruct still decides from the double: 0.3
    // is 3/10, an even denominator, hence complex — as is 0.25 (1/4). Only an
    // odd reconstructed denominator goes real, and it still does (2/3).
    expect(ce.box(['Power', -2, 0.3]).N().im).not.toBe(0);
    expect(ce.box(['Power', -2, 0.25]).N().im).not.toBe(0);
    expect(ce.box(['Power', -2, 2 / 3]).N().im).toBe(0);
  });
});

/**
 * The exact terms decide the branch by their PARITY, and parity is the one
 * property that does not survive narrowing a bigint to a double: EVERY double
 * at or above 2^53 is an even integer. `Number(66052794534767279n)` is `…280`,
 * so an odd denominator read as even sent a REAL value down the complex branch
 * — and an odd numerator read as even dropped the `(−1)^p` sign. The narrowing
 * now keeps the parity (giving up magnitude, which nothing but the compiled
 * fold's ≤64 root-then-power split reads, and which declines either way).
 *
 * The three rows are the same ~11/3 ratio with each parity combination, all
 * coprime with both terms above 2^53 after reduction.
 */
describe('NEGATIVE BASE: exact terms beyond the safe-integer range', () => {
  const ODD_P = 66052794534767279n;
  const EVEN_P = 66052794534767278n;
  const ODD_Q = 18014398509481985n;
  const EVEN_Q = 18014398509481986n;

  const rows: [
    label: string,
    p: bigint,
    q: bigint,
    branch: 'real' | 'complex',
  ][] = [
    ['odd p / odd q', ODD_P, ODD_Q, 'real'],
    ['even p / odd q', EVEN_P, ODD_Q, 'real'],
    ['odd p / even q', ODD_P, EVEN_Q, 'complex'],
  ];

  it('decides parity on the exact terms, not on their narrowing', () => {
    for (const [label, p, q] of rows) {
      const t = realPowerBranchTerms([p, q], Number(p) / Number(q));
      expect(t).toBeDefined();
      expect(`${label}: p odd? ${t![0] % 2 !== 0}`).toBe(
        `${label}: p odd? ${p % 2n !== 0n}`
      );
      expect(`${label}: q odd? ${t![1] % 2 !== 0}`).toBe(
        `${label}: q odd? ${q % 2n !== 0n}`
      );
      // A term that cannot be narrowed faithfully must still read as "large",
      // so the compiled fold's root-then-power split declines it as it would
      // the true term.
      expect(Math.abs(t![0])).toBeGreaterThan(64);
      expect(Math.abs(t![1])).toBeGreaterThan(64);
    }
  });

  for (const [label, p, q, branch] of rows) {
    it(`(-2)^(${label}) is ${branch}, and .N()/compiled/type agree`, () => {
      const e = ce.box(['Power', -2, ce.number([p, q])]);
      const { re, im } = parts(e);
      const f = folded(e);

      if (branch === 'real') {
        // `(−1)^p·|b|^(p/q)`: the odd numerator is the NEGATIVE root.
        const want =
          (p % 2n === 0n ? 1 : -1) * Math.pow(2, Number(p) / Number(q));
        expect(Math.abs(im)).toBe(0);
        expect(re / want).toBeCloseTo(1, 12);
        expect(e.type.matches('complex') && !e.type.matches('real')).toBe(
          false
        );
        expect(typeof f).toBe('number');
        expect((f as number) / want).toBeCloseTo(1, 12);
      } else {
        expect(Math.abs(im)).not.toBe(0);
        expect(e.type.toString()).toBe('finite_complex');
        const c = f as { re: number; im: number };
        expect(c.re / re).toBeCloseTo(1, 9);
        expect(c.im / im).toBeCloseTo(1, 9);
      }
    });
  }
});

/**
 * An exponent's integer-ness is a property of the exponent, not of the double
 * it numericized to. At `precision: 3` the exact `6000001/2000000` numericizes
 * to EXACTLY 3, and reading the integer power off that double took the plain
 * real power where the raw — even — denominator says the value is complex, so
 * `.N()` alone left the branch the type handler and the compiled fold were on.
 * The raw exponent's own reduced denominator decides now.
 *
 * The two paths coincide NUMERICALLY here, and necessarily so: `cos(nπ)` is
 * `(−1)^n`, so the principal complex value of an integer exponent IS the
 * integer power. What this pins is therefore the ledger — that all three legs
 * report the complex branch — not a change in the returned value. (`.N()`'s
 * magnitude is the 3-digit one, per "branch from raw, magnitude from the
 * coarse float"; the compiled fold holds the full-precision exponent and so
 * carries the genuine 1.3e−5 imaginary part.)
 */
describe('NEGATIVE BASE: an exponent that ROUNDS to an integer', () => {
  let savedPrecision: number;
  beforeAll(() => {
    savedPrecision = BigDecimal.precision;
  });
  afterAll(() => {
    BigDecimal.precision = savedPrecision;
  });

  it('takes the complex branch from the raw (even) denominator', () => {
    const tiny = new ComputeEngine({ precision: 3 });
    const e = tiny.box(['Power', -2, ['Rational', 6000001, 2000000]]);
    // The exponent is NOT an integer; only its precision-3 double is.
    expect(e.op2.isInteger).toBe(false);
    expect(e.op2.N().re).toBe(3);

    expect(e.type.toString()).toBe('finite_complex');
    const c = folded(e) as { re: number; im: number };
    expect(c.im).not.toBe(0);
    expect(c.re).toBeCloseTo(-8, 5);
    // `.N()` at precision 3: the complex branch with an integer phase, which
    // is the integer power to the last digit.
    expect(e.N().re).toBeCloseTo(-8, 12);
  });

  it('leaves a genuine integer exponent on the plain integer power', () => {
    const engine = new ComputeEngine();
    // A reduced denominator of 1 is an integer exponent however it is written
    // — these fold to the integer power at canonicalization and must stay
    // there.
    const rows: [exp: any, want: number][] = [
      [3, -8],
      [['Rational', 6, 2], -8],
      [['Rational', -9, 3], -0.125],
      [['Rational', 4, 2], 4],
    ];
    for (const [exp, want] of rows) {
      const n = engine.box(['Power', -2, exp]).N();
      expect(n.im).toBe(0);
      expect(n.re).toBe(want);
    }
  });
});

/**
 * The mechanism the `Power` fix rides on: the evaluation driver passes the
 * canonical node to every `evaluate` handler as `options.expression`. Its `ops`
 * are the RAW operands — what the `type` handler sees — while the handler's
 * first parameter holds the evaluated ones, which under `.N()` have been
 * numericized. A handler that needs its operands' EXACTNESS (branch cuts,
 * provenance, error messages that quote the input) has nowhere else to get it.
 */
describe('evaluate handler receives the canonical expression', () => {
  it('exposes the RAW operands, which differ from the evaluated ones under .N()', () => {
    const engine = new ComputeEngine();
    const seen: {
      raw: string;
      evaluated: string;
      isSameNode: boolean;
      operator: string;
    }[] = [];

    engine.declare('ProvenanceProbe', {
      signature: '(number) -> number',
      evaluate: ([x], { expression, engine: ce }) => {
        // `expression` is an `Expression`; `op1` lives on the narrowed
        // function interface, so reach it through `isFunction()` — the same
        // narrowing the `Power` handler uses.
        const raw =
          expression !== undefined && isFunction(expression)
            ? expression.op1
            : undefined;
        seen.push({
          raw: raw?.toString() ?? '<none>',
          evaluated: x.toString(),
          isSameNode: raw === x,
          operator: expression?.operator ?? '<none>',
        });
        return ce.number(1);
      },
    });

    const expr = engine.box(['ProvenanceProbe', ['Rational', 1, 3]]);

    // Under `evaluate()` nothing is numericized: the operand IS the raw node.
    expr.evaluate();
    expect(seen[0].operator).toBe('ProvenanceProbe');
    expect(seen[0].raw).toBe('1/3');
    expect(seen[0].evaluated).toBe('1/3');
    expect(seen[0].isSameNode).toBe(true);

    // Under `.N()` the operand is a double while `expression.op1` still holds
    // the exact rational — the whole point of the field.
    expr.N();
    expect(seen[1].raw).toBe('1/3');
    expect(seen[1].evaluated).not.toBe('1/3');
    expect(Number(seen[1].evaluated)).toBeCloseTo(1 / 3, 12);
    expect(seen[1].isSameNode).toBe(false);
  });

  it('reaches the async handler too', async () => {
    const engine = new ComputeEngine();
    let raw: string | undefined = undefined;
    engine.declare('AsyncProvenanceProbe', {
      signature: '(number) -> number',
      evaluateAsync: async ([_x], { expression, engine: ce }) => {
        if (expression !== undefined && isFunction(expression))
          raw = expression.op1.toString();
        return ce.number(1);
      },
    });
    await engine
      .box(['AsyncProvenanceProbe', ['Rational', 1, 3]])
      .evaluateAsync({
        numericApproximation: true,
      });
    expect(raw).toBe('1/3');
  });
});
