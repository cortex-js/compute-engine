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
 *   recorded for it is refuted below. Restoring `complex` on the chain
 *   changes NOTHING, because no target picks its real-vs-complex lowering from
 *   the result type: `Sqrt`/`Ln`/`Log` pick it from the OPERAND, and
 *   `BaseCompiler.isComplexValued` carries an explicit carve-out (added
 *   2026-07-31) that forces the REAL kernel for a real operand of merely
 *   unknown sign. The `sqrtOfRealOfUnknownSign` block proves this by supplying
 *   a fully concrete `real` parameter — maximal type information, complex
 *   admission present — and still measuring `Math.sqrt` and `NaN`.
 *
 * RESOLUTION for half 2: `mode: 'complex'` on `javascript`
 * promotes `Sqrt`/`Ln`/`Log` of an operand of unknown sign. The default
 * `mode: 'strict'` keeps the real kernel, and its value is `NaN` where the
 * exact value is complex (`docs/COMPILATION-MODEL.md`, "Caveats of
 * compiled code"). The mode `auto`, which promoted by default, was removed
 * after 0.177.0. Each test below pins the promoted value of the complex
 * mode beside the real kernel of the default.
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
    ce.declare('t', 'real');
    setup(ce);
    const r = compile(ce.parse('f(t)[1]', { strict: false }))!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 3 })).toEqual(3);
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
    expect(r.error).toMatch(/Could not compile/);
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

  test('compiled promotes in the complex mode; the default strict mode emits the real kernel', () => {
    // The `complex` mode promotes the unknown-sign radical, so the compiled
    // value is the interpreter's. The default `strict` mode keeps the real
    // kernel, and its value is `NaN` where the exact value is complex
    // (`docs/COMPILATION-MODEL.md`, "Caveats of compiled code").
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.parse(Z_DEF, { strict: false }).evaluate();
    const r = compile(ce.parse(Z_CHAIN, { strict: false }), {
      mode: 'complex',
    })!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.3 })).toBeCloseTo(PROMOTED, 12);
    const strict = compile(ce.parse(Z_CHAIN, { strict: false }))!;
    expect(strict.run!({ t: 0.3 })).toBeNaN();
  });

  describe('sqrtOfRealOfUnknownSign — refutes the recorded fix direction', () => {
    // The recorded diagnosis was that `z`'s `unknown` parameter widens
    // `sqrt(unknown)` to `number`, dropping complex admission, and that
    // refining the parameter from the call site would restore `complex`
    // "and with it a correct emission". The second half does not follow: with
    // `u` declared `real` — no placeholder anywhere, and the node ALREADY
    // typed `complex` — `mode: 'strict'` still emits the real kernel
    // and still returns NaN. Complex admission in the type is not what selects
    // the lane; the MODE is, which is why the same source promotes under
    // `mode: 'complex'` with the type unchanged.
    test('the node is typed complex with a fully concrete parameter', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      expect(
        ce.parse('\\sqrt{u-1}', { strict: false }).type.toString()
      ).toEqual('complex');
    });
  });
});

describe('promotion in mode: complex', () => {
  test('strict, the default, keeps the real kernel and its NaN; complex does not', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.parse(Z_DEF, { strict: false }).evaluate();
    const strict = compile(ce.parse(Z_CHAIN, { strict: false }))!;
    expect(strict.run!({ t: 0.3 })).toBeNaN();
    const r = compile(ce.parse(Z_CHAIN, { strict: false }), {
      mode: 'complex',
    })!;
    expect(r.run!({ t: 0.3 })).toBeCloseTo(PROMOTED, 12);
  });

  test('ON: the item-190 witness matches the interpreter', () => {
    // The radical sits inside the user function `z`, so this only works if the
    // CALL SITE follows the lane that the emitted definition of `z` records
    // — `z(t)` types the wide `number`, which says nothing about complexness
    // on its own. See `userCallLane` in `base-compiler.ts`.
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    ce.parse(Z_DEF, { strict: false }).evaluate();
    const r = compile(ce.parse(Z_CHAIN, { strict: false }), {
      mode: 'complex',
    })!;
    expect(r.success).toBe(true);
    expect(r.run!({ t: 0.3 })).toBeCloseTo(PROMOTED, 12);
  });

  test('ON: the inline chain matches too, taking plain real inputs', () => {
    // A real-typed free symbol is lifted to `{re, im: 0}` by the emitter, so
    // the complex mode does not change the caller's argument convention.
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const r = compile(ce.parse(INLINE_CHAIN, { strict: false }), {
      mode: 'complex',
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
      { mode: 'complex' }
    )!;
    expect(r.run!({ u: 0.3 })).toBeCloseTo(0.429912287450431, 12);
  });

  test('ON: Ln of a negative operand promotes as well', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const chain = '\\left|\\ln(u-1)\\right|';
    const r = compile(ce.parse(chain, { strict: false }), {
      mode: 'complex',
    })!;
    const ce2 = new ComputeEngine();
    ce2.declare('u', 'real');
    ce2.assign('u', 0.3);
    expect(r.run!({ u: 0.3 })).toBeCloseTo(
      ce2.parse(chain, { strict: false }).N().re,
      12
    );
  });

  test('that same comparison compiles in the default mode as well', () => {
    const ce = new ComputeEngine();
    const r = compile(ce.box(['Less', ['Sqrt', 'x'], 2]))!;
    expect(r.success).toBe(true);
    expect(r.run!({ x: 9 })).toBe(false);
    expect(r.run!({ x: 1 })).toBe(true);
  });

  test('the mode does not leak between compilations', () => {
    // Latched per outermost compile and restored on the way out: a promoted
    // compile must not leave the next one promoting. (The witness used to be
    // a promoting compile followed by the plain default; the default now
    // promotes on its own, so the second compile asks for `strict`.)
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    const promoted = compile(ce.parse(INLINE_CHAIN, { strict: false }), {
      mode: 'complex',
    })!;
    expect(promoted.run!({ u: 0.3 })).toBeCloseTo(PROMOTED, 12);
    const plain = compile(ce.parse(INLINE_CHAIN, { strict: false }), {
      mode: 'strict',
    })!;
    expect(plain.code).toContain('Math.sqrt');
    expect(plain.run!({ u: 0.3 })).toBeNaN();
  });

  test('glsl keeps the real kernel regardless (item 144’s render states)', () => {
    // The shader targets have no runtime-failure channel and their
    // unknown-sign behavior is pinned by the Desmos corpus, so they never
    // promote: the real kernel in the default mode and in `strict`; an
    // EXPLICIT `mode: 'complex'` is the `unsupported-mode` decline rather
    // than a promotion (compile-mode step 4, 2026-08-16).
    const ce = new ComputeEngine();
    for (const options of [
      { to: 'glsl' as const },
      { to: 'glsl' as const, mode: 'strict' as const },
    ]) {
      const r = compile(ce.box(['Sqrt', ['Subtract', 'x', 1]]), options)!;
      expect(r.success).toBe(true);
      expect(r.code).toContain('sqrt');
      expect(r.code).not.toContain('vec2');
    }
    // An explicit `mode: 'complex'` compiles too: a complex value on the
    // real lane is `NaN`.
    expect(
      compile(ce.box(['Sqrt', ['Subtract', 'x', 1]]), {
        to: 'glsl',
        mode: 'complex',
      })!.success
    ).toBe(true);
  });
});
