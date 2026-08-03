import { ComputeEngine } from '../../src/compute-engine';
import { BigDecimal } from '../../src/big-decimal';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { realPowerBranchTerms } from '../../src/compute-engine/boxed-expression/arithmetic-power';

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

function folded(e: any): number | { re: number; im: number } {
  const r = compile(e, { fallback: false });
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
        expect(isRealBranch(realPowerBranchTerms(undefined, 0.3333333333))).toBe(
          false
        );
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
      const at3 = atPrecision(3, () => realPowerBranchTerms(undefined, 1.234567));
      const at15 = atPrecision(15, () =>
        realPowerBranchTerms(undefined, 1.234567)
      );
      expect(at3).toEqual(at15);
      expect(isRealBranch(at3)).toBe(false);
      expect(
        isRealBranch(atPrecision(3, () => realPowerBranchTerms(undefined, Math.PI)))
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
        atPrecision(17, () => realPowerBranchTerms(undefined, 0.02490069718328337))
      ).toBeUndefined();
      // The floor was never load-bearing for a genuine rounding: a p/q rounded
      // at the working precision lands well inside `tol` (worst case ~0.47·tol
      // over the terms exercised here), so tightening cannot cost a legitimate
      // reconstruction — the rows above still resolve.
      expect(
        atPrecision(16, () => realPowerBranchTerms(undefined, 11.44444444444444))
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
    // NOT asserted: an exact rational round-tripping through a 3-digit engine.
    // `(100/3).N()` there IS `33.3` — the exponent itself is destroyed before
    // the branch helper sees it — so `(-2)^(100/3)` is complex (33.3 = 333/10).
    // That is a property of `{ precision: 3 }`, not of the branch decision.
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
