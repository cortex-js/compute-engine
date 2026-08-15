import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * The acceptance PAIR for the follow-up to the `unknown`-placeholder ruling
 * (ruled 2026-08-15; `refineDeclaredPlaceholders` in
 * `boxed-expression/effects-inference.ts`). The ruling fixed declared
 * `unknown` in the DECLARATION direction — a declared placeholder slot is
 * refined by the definition that follows. The open follow-up was stated as
 * "refine an `unknown` PARAMETER from the call site", with two consumer cases
 * named as the acceptance pair:
 *
 *   1. the D-240 indexed-access class — `f(t)[k]` should compile rather than
 *      fail closed;
 *   2. Tycho item 190 — `z(t) := sqrt(t-1)` compiles to a real `Math.sqrt`
 *      and returns `NaN` where the interpreter returns 1.08397416943394.
 *
 * MEASURED 2026-08-15, and the two halves came apart:
 *
 * - Half 1 is ALREADY FIXED by the landed ruling. Every indexed-access shape
 *   below compiles and agrees with the interpreter. The one shape that still
 *   fails closed is a head that is DECLARED but never assigned, which is the
 *   intended D6 posture (nothing exists to refine from) and is pinned as such.
 *
 * - Half 2 is NOT a call-site-refinement defect at all, and the fix direction
 *   recorded for it is refuted below. Restoring `finite_complex` on the chain
 *   changes NOTHING, because no target picks its real-vs-complex lowering from
 *   the result type: `Sqrt`/`Ln`/`Log` pick it from the OPERAND, and
 *   `BaseCompiler.isComplexValued` carries an explicit carve-out (added
 *   2026-07-31) that forces the REAL kernel for a real operand of merely
 *   unknown sign. The `sqrtOfRealOfUnknownSign` block proves this by supplying
 *   a fully concrete `real` parameter — maximal type information, complex
 *   admission present — and still measuring `Math.sqrt` and `NaN`.
 *
 * RESOLUTION for half 2 (ruled 2026-08-15): the default contract stays — it is
 * what keeps radical chains on the fast path and what lets an ordering
 * comparison over a radical compile at all — and the correct emission becomes
 * available through an opt-in compile option, `complexPromotion`. A consumer
 * with a per-document "complex mode" maps that switch onto this option. The
 * last describe block pins both sides of it.
 */

const Z_DEF = 'z(t) \\coloneq \\sqrt{t-1}';
const Z_CHAIN = '\\left|\\frac{z(t)}{2} - 1\\right|';
const INLINE_CHAIN = '\\left|\\frac{\\sqrt{u-1}}{2} - 1\\right|';

/** `|√(0.3−1)/2 − 1|` — the interpreter's answer, complex-promoted. */
const PROMOTED = 1.08397416943394;

describe('half 1 — the D-240 indexed-access class (fixed by the ruling)', () => {
  // Each row: a way of arriving at a head whose result is a collection, then
  // indexing the CALL. Before the ruling, a declared `-> unknown` erased the
  // call's type and `At` failed closed on it.
  const rows: [label: string, setup: (ce: ComputeEngine) => void][] = [
    [
      'no declaration',
      (ce) => {
        ce.parse('f(t) \\coloneq [t, 2t]', { strict: false }).evaluate();
      },
    ],
    [
      'declared (unknown) -> unknown',
      (ce) => {
        ce.declare('f', { signature: '(unknown) -> unknown' });
        ce.parse('f(t) \\coloneq [t, 2t]', { strict: false }).evaluate();
      },
    ],
    [
      'declared bare `function`',
      (ce) => {
        ce.declare('f', { signature: 'function' });
        ce.parse('f(t) \\coloneq [t, 2t]', { strict: false }).evaluate();
      },
    ],
    [
      'declared (unknown) -> unknown, assigned a lambda value',
      (ce) => {
        ce.declare('f', { signature: '(unknown) -> unknown' });
        ce.assign('f', ce.parse('t \\mapsto [t, 2t]', { strict: false }));
      },
    ],
  ];

  test.each(rows)('%s: f(t)[1] compiles and runs', (_label, setup) => {
    const ce = new ComputeEngine();
    setup(ce);
    const r = compile(ce.parse('f(t)[1]', { strict: false }))!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 3 })).toEqual(3);
  });

  test.each(rows)('%s: f(t)[k] with a SYMBOLIC index', (_label, setup) => {
    const ce = new ComputeEngine();
    setup(ce);
    const r = compile(ce.parse('f(t)[k]', { strict: false }))!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 3, k: 2 })).toEqual(6);
  });

  test('an `unknown` PARAMETER indexed in the body compiles and agrees', () => {
    // The `l_P` shape of the ruling, on the compile route: the parameter is
    // refined to `dictionary | indexed_collection`, so the call passes the
    // list WHOLE instead of broadcasting over its elements.
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.parse('g(p) \\coloneq p[1] + p[2]', { strict: false }).evaluate();
    expect(ce.box('g').type.toString()).toEqual(
      '(dictionary | indexed_collection) -> broadcastable<number>'
    );
    const r = compile(ce.parse('g([3,4])', { strict: false }))!;
    expect(r.success).toBe(true);
    expect(r.run!({})).toEqual(7);
  });

  test('a SYMBOLIC collection argument reaches the refined parameter', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(unknown) -> unknown' });
    ce.parse('g(p) \\coloneq p[1] + p[2]', { strict: false }).evaluate();
    const r = compile(ce.parse('g(v)', { strict: false }))!;
    expect(r.success).toBe(true);
    expect(r.run!({ v: [3, 4] })).toEqual(7);
  });

  test('a DECLARED-but-unassigned head still fails closed (intended)', () => {
    // Nothing refines a head that was only declared, so `At` has no evidence
    // that its first operand is an indexed collection. This is the D6
    // fail-closed posture the ruling deliberately preserved, and it is the
    // coverage case for it.
    const ce = new ComputeEngine();
    ce.declare('f', { signature: '(unknown) -> unknown' });
    const r = compile(ce.parse('f(t)[1]', { strict: false }))!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not an indexed collection.*Fail closed \(D6\)/s);
  });
});

describe('half 2 — Tycho item 190: the real-kernel carve-out, not refinement', () => {
  test('the interpreter promotes to complex and is the reference value', () => {
    const ce = new ComputeEngine();
    ce.parse(Z_DEF, { strict: false }).evaluate();
    ce.assign('t', 0.3);
    expect(ce.parse(Z_CHAIN, { strict: false }).N().re).toBeCloseTo(
      PROMOTED,
      12
    );
  });

  test('compiled emits the real kernel and returns NaN (today’s contract)', () => {
    const ce = new ComputeEngine();
    ce.parse(Z_DEF, { strict: false }).evaluate();
    const r = compile(ce.parse(Z_CHAIN, { strict: false }))!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.3 })).toBeNaN();
  });

  describe('sqrtOfRealOfUnknownSign — refutes the recorded fix direction', () => {
    // The recorded diagnosis was that `z`'s `unknown` parameter widens
    // `sqrt(unknown)` to `finite_number`, dropping complex admission, and that
    // refining the parameter from the call site would restore `finite_complex`
    // "and with it a correct emission". The second half does not follow: with
    // `u` declared `real` — no placeholder anywhere, and the node ALREADY
    // typed `finite_complex` — the emission is still the real kernel and the
    // value is still NaN. Complex admission in the type is not what selects
    // the lane.
    test('the node is typed finite_complex with a fully concrete parameter', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      expect(ce.parse('\\sqrt{u-1}', { strict: false }).type.toString()).toEqual(
        'finite_complex'
      );
    });

    test('...and it STILL compiles to Math.sqrt and returns NaN', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const r = compile(ce.parse(INLINE_CHAIN, { strict: false }))!;
      expect(r.success).toBe(true);
      expect(r.code).toContain('Math.sqrt');
      expect(r.run!({ u: 0.3 })).toBeNaN();
    });

    test('the complex lane, when selected, produces the interpreter’s value', () => {
      // Selecting the lane is all that is missing: with `u` declared
      // `complex` the same chain lowers through `_SYS.csqrt`/`_SYS.cabs` and
      // agrees with `.N()` to full precision. So the fix for 190 is a lane
      // decision, not a typing repair.
      const ce = new ComputeEngine();
      ce.declare('u', 'complex');
      const r = compile(ce.parse(INLINE_CHAIN, { strict: false }))!;
      expect(r.success).toBe(true);
      expect(r.code).toContain('_SYS.csqrt');
      expect(r.run!({ u: { re: 0.3, im: 0 } })).toBeCloseTo(PROMOTED, 12);
    });
  });
});

describe('the complexPromotion opt-in (ruled 2026-08-15)', () => {
  test('OFF by default: the witness keeps the real kernel and its NaN', () => {
    const ce = new ComputeEngine();
    ce.parse(Z_DEF, { strict: false }).evaluate();
    const r = compile(ce.parse(Z_CHAIN, { strict: false }))!;
    expect(r.run!({ t: 0.3 })).toBeNaN();
  });

  test('ON: the item-190 witness matches the interpreter', () => {
    // The radical sits inside the user function `z`, so this only works if the
    // CALL SITE follows the body's lane — `z(t)` types the wide
    // `finite_number`, which says nothing about complexness on its own. See
    // `isComplexValuedUserCall`.
    const ce = new ComputeEngine();
    ce.parse(Z_DEF, { strict: false }).evaluate();
    const r = compile(ce.parse(Z_CHAIN, { strict: false }), {
      complexPromotion: true,
    })!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.3 })).toBeCloseTo(PROMOTED, 12);
  });

  test('ON: the inline chain matches too, taking plain real inputs', () => {
    // A real-typed free symbol is lifted to `{re, im: 0}` by the emitter, so
    // enabling the option does not change the caller's argument convention.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const r = compile(ce.parse(INLINE_CHAIN, { strict: false }), {
      complexPromotion: true,
    })!;
    expect(r.run!({ u: 0.3 })).toBeCloseTo(PROMOTED, 12);
  });

  test('ON: a NON-negative operand still gives the ordinary real answer', () => {
    // Promotion must not perturb the values that were already right: the
    // complex lane's imaginary part is zero here and `Abs` returns a number.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const r = compile(
      ce.parse('\\left|\\frac{\\sqrt{u+1}}{2} - 1\\right|', { strict: false }),
      { complexPromotion: true }
    )!;
    expect(r.run!({ u: 0.3 })).toBeCloseTo(0.429912287450431, 12);
  });

  test('ON: Ln of a negative operand promotes as well', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const chain = '\\left|\\ln(u-1)\\right|';
    const r = compile(ce.parse(chain, { strict: false }), {
      complexPromotion: true,
    })!;
    const ce2 = new ComputeEngine();
    ce2.declare('u', 'real');
    ce2.assign('u', 0.3);
    expect(r.run!({ u: 0.3 })).toBeCloseTo(
      ce2.parse(chain, { strict: false }).N().re,
      12
    );
  });

  test('ON: an ordering comparison over a radical fails closed (documented)', () => {
    // `Less(Sqrt(x), 2)` has no truth value once `Sqrt(x)` may be complex, and
    // the interpreter leaves it symbolic. Declining is the honest answer, and
    // it is the cost the option's documentation names.
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Less', ['Sqrt', 'x'], 2]), {
      complexPromotion: true,
    })!;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not ordered.*Fail closed \(D6\)/s);
  });

  test('OFF: that same comparison still compiles (the default’s whole point)', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Less', ['Sqrt', 'x'], 2]))!;
    expect(r.success).toBe(true);
    expect(r.run!({ x: 9 })).toBe(false);
    expect(r.run!({ x: 1 })).toBe(true);
  });

  test('the option does not leak between compilations', () => {
    // Latched per outermost compile and restored on the way out: a promoted
    // compile must not leave the next one promoting.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const promoted = compile(ce.parse(INLINE_CHAIN, { strict: false }), {
      complexPromotion: true,
    })!;
    expect(promoted.run!({ u: 0.3 })).toBeCloseTo(PROMOTED, 12);
    const plain = compile(ce.parse(INLINE_CHAIN, { strict: false }))!;
    expect(plain.code).toContain('Math.sqrt');
    expect(plain.run!({ u: 0.3 })).toBeNaN();
  });

  test('python: the opt-in reaches that target too', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const off = compile(ce.parse('\\sqrt{u-1}', { strict: false }), {
      to: 'python',
    })!;
    expect(off.code).toContain('np.sqrt');
    const on = compile(ce.parse('\\sqrt{u-1}', { strict: false }), {
      to: 'python',
      complexPromotion: true,
    })!;
    // `np.emath`, not `cmath` — see the zero-domain test below.
    expect(on.code).toContain('np.emath.sqrt');
  });

  test('a COLLECTION-returning body does not make an extracted scalar complex', () => {
    // The user-function look-through must decline a body that may build a
    // collection: `isComplexValued` answers for a list from `ops.some(…)`, so
    // one complex ELEMENT would report the whole call complex, and `At` — whose
    // result type is `unknown` — would hand that verdict to the plain number
    // pulled out of it. Before the guard this returned `{re: null}`.
    const ce = new ComputeEngine();
    ce.parse('g(t) \\coloneq [\\sqrt{t-1}, 1]', { strict: false }).evaluate();
    const r = compile(ce.parse('g(t)[2] + 1', { strict: false }), {
      complexPromotion: true,
    })!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.3 })).toEqual(2);
  });

  test('a DIRECT (non-registered) shader target does not latch the option', () => {
    // The direct `compile(expr, { target })` route stamps the caller's option
    // onto whatever target object it is handed, so the language restriction
    // has to be enforced where the option is latched rather than at the
    // registered-target entry. A shader target's emitters never consult
    // `promotesRadicalToComplex`; letting the flag through made the analysis
    // report complex over scalar-producing emitters and declined the compile.
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(['Mod', ['Multiply', 1e5, ['Sqrt', ['Subtract', 'x', 1]]], 1]);
    const expected = 'mod(100000.0 * sqrt(x + -1.0), 1.0)';

    const plain = ce.getCompilationTarget('glsl')!.createTarget();
    expect(compile(expr, { target: plain }).code).toBe(expected);

    const promoted = ce.getCompilationTarget('glsl')!.createTarget();
    const r = compile(expr, { target: promoted, complexPromotion: true });
    expect(r.success).toBe(true);
    expect(r.code).toBe(expected);
  });

  test('python promotes through np.emath, which is defined at zero', () => {
    // `cmath.log(0)` raises `ValueError` where the interpreter answers `-∞`,
    // and `cmath` rejects the numpy arrays this target supports elsewhere.
    // `np.emath` is the domain-relaxed variant: complex for a negative input,
    // `-inf` at zero.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const on = compile(ce.parse('\\ln(u-1)', { strict: false }), {
      to: 'python',
      complexPromotion: true,
    })!;
    expect(on.code).toContain('np.emath.log');
    expect(on.code).not.toContain('cmath.log');
    expect(ce.parse('\\ln(0)', { strict: false }).N().toString()).toEqual('-oo');
  });

  test('glsl keeps the real kernel regardless (item 144’s render states)', () => {
    // The shader targets have no runtime-failure channel and their
    // unknown-sign behavior is pinned by the Desmos corpus, so they do not
    // accept the option.
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Sqrt', ['Subtract', 'x', 1]]), {
      to: 'glsl',
      complexPromotion: true,
    })!;
    expect(r.code).toContain('sqrt');
    expect(r.code).not.toContain('vec2');
  });
});
