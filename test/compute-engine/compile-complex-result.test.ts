/**
 * A head whose ARGUMENT is real but whose RESULT is complex.
 *
 * The type system reads an assigned value's sign, so with `a := -2` the node
 * `Sqrt(a)` is typed `complex` while the operand `a` is typed `integer`. The
 * ENCLOSING expression decides its codegen from the node
 * (`BaseCompiler.isComplexValued`), so it emits `{re, im}` (JS) /
 * `vec2(re, im)` (GLSL/WGSL) arithmetic. A handler that picked its lowering
 * from the argument alone emitted `Math.sqrt(-2)` — a `NaN` *number* — and the
 * parent then read `.re`/`.im` off it, producing `{re: NaN, im: undefined}`
 * behind `success: true`.
 *
 * Each case is checked against the INTERPRETER's value, not against source.
 *
 * `Power`/`Root` over a NEGATIVE base joined this set on 2026-07-30: the type
 * handlers now narrow to `finite_complex` when the exponent's reduced-rational
 * denominator is EVEN (an ODD denominator has a real principal root —
 * `(−8)^(2/3) = 4` — and stays `finite_number`). The emitters had to follow;
 * until they did, the parent emitted `{re, im}` arithmetic around a real `NaN`
 * fold. Both branches are pinned below.
 *
 * The BOUNDED inverse trig / inverse hyperbolic heads (`Arcsin`, `Arccos`,
 * `Arcosh`, `Artanh`, `Arcoth`, `Arsech`, `Arcsec`, `Arccsc`) joined this set
 * on 2026-07-30. They used to be typed the coarse `number` outside their real
 * domain — not a complex type — so the parent emitted real arithmetic and the
 * value projected to `NaN`. Now that a provably out-of-domain argument is
 * typed by the value it actually takes (`arcsin(2) = π/2 − 1.3169…i`, a finite
 * complex; see `inverse-trig-domain-type.test.ts`), their emitters had to
 * follow — otherwise `Math.asin(2)`, a `NaN` NUMBER, sits under a parent
 * reading `.re`/`.im`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** A fresh engine with `a := -2` (negative) and `r` declared real. */
function engineWithNegativeAssignment(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.assign('a', ce.number(-2));
  ce.declare('r', 'real');
  return ce;
}

/** The interpreter's value of `expr`, as `{re, im}`. */
function interpreted(expr: any): { re: number; im: number } {
  const n = expr.N();
  return { re: n.re, im: n.im };
}

describe('COMPILE: complex RESULT of a real argument (assigned symbol)', () => {
  describe('JavaScript target', () => {
    for (const [name, latex] of [
      ['Sqrt', '1 + \\sqrt{a}'],
      ['Ln', '1 + \\ln(a)'],
      ['Log', '1 + \\log(a)'],
      ['Log base 2', '1 + \\log_2(a)'],
    ] as const) {
      it(`${name}: agrees with the interpreter`, () => {
        const ce = engineWithNegativeAssignment();
        const expr = ce.parse(latex);
        const result = compile(expr, { fallback: false });
        expect(result.success).toBe(true);
        const val = result.run!() as { re: number; im: number };
        const expected = interpreted(expr);
        // The bug produced `{re: NaN, im: undefined}` here.
        expect(typeof val).toBe('object');
        expect(val.re).toBeCloseTo(expected.re, 12);
        expect(val.im).toBeCloseTo(expected.im, 12);
      });
    }

    // Bounded inverse trig / inverse hyperbolic heads, each at a literal
    // argument OUTSIDE its real domain (ruling 2026-07-30). Checked against
    // the interpreter, not against source.
    for (const [name, latex] of [
      ['Arcsin', '1 + \\arcsin(2)'],
      ['Arccos', '1 + \\arccos(2)'],
      ['Arcosh', '1 + \\operatorname{arcosh}(0)'],
      ['Artanh', '1 + \\operatorname{artanh}(2)'],
      ['Arcoth', '1 + \\operatorname{arcoth}(0.5)'],
      ['Arsech', '1 + \\operatorname{arsech}(-2)'],
      ['Arcsec', '1 + \\operatorname{arcsec}(0.5)'],
      ['Arccsc', '1 + \\operatorname{arccsc}(0.5)'],
    ] as const) {
      it(`${name} out of domain: agrees with the interpreter`, () => {
        const ce = engineWithNegativeAssignment();
        const expr = ce.parse(latex);
        expect(expr.type.toString()).toBe('finite_complex');
        const result = compile(expr, { fallback: false });
        expect(result.success).toBe(true);
        const val = result.run!() as { re: number; im: number };
        const expected = interpreted(expr);
        // Emitting the real lowering here produced `{re: NaN, im: undefined}`.
        expect(typeof val).toBe('object');
        expect(val.re).toBeCloseTo(expected.re, 12);
        expect(val.im).toBeCloseTo(expected.im, 12);
      });
    }

    it('an IN-domain inverse-trig argument still emits the real lowering', () => {
      const ce = engineWithNegativeAssignment();
      for (const [latex, code] of [
        ['\\arcsin(0.5)', 'Math.asin(0.5)'],
        ['\\arccos(0.5)', 'Math.acos(0.5)'],
        ['\\operatorname{arcosh}(2)', 'Math.acosh(2)'],
        ['\\operatorname{artanh}(0.5)', 'Math.atanh(0.5)'],
      ] as const) {
        const result = compile(ce.parse(latex), { fallback: false });
        expect(result.success).toBe(true);
        expect(result.code).toBe(code);
        expect(typeof result.run!()).toBe('number');
      }
    });

    it('Sqrt of a real-typed symbol still emits the real lowering', () => {
      const ce = engineWithNegativeAssignment();
      const result = compile(ce.parse('\\sqrt{r}'), { fallback: false });
      expect(result.code).toBe('Math.sqrt(_.r)');
      expect(result.run!({ r: 4 })).toBe(2);
    });

    it('Ln of a real-typed symbol still emits the real lowering', () => {
      const ce = engineWithNegativeAssignment();
      const result = compile(ce.parse('\\ln(r)'), { fallback: false });
      expect(result.code).toBe('Math.log(_.r)');
      expect(result.run!({ r: 1 })).toBe(0);
    });

    it('Log of a real-typed symbol still emits the real lowering', () => {
      const ce = engineWithNegativeAssignment();
      const result = compile(ce.parse('\\log(r)'), { fallback: false });
      expect(result.code).toBe('Math.log10(_.r)');
      expect(result.run!({ r: 100 })).toBe(2);
    });

    it('Log of a negative literal no longer lowers to Math.log10', () => {
      // `Math.log10(-2)` is `NaN`; the enclosing expression reads `{re, im}`.
      // Base 10 of a complex value is `ln(z) / ln(10)`.
      const ce = new ComputeEngine();
      const expr = ce.expr(['Log', -2]);
      const result = compile(expr, { fallback: false });
      const val = result.run!() as { re: number; im: number };
      expect(val.re).toBeCloseTo(Math.log10(2), 12);
      expect(val.im).toBeCloseTo(Math.PI / Math.LN10, 12);
    });

    it('Log of a genuinely complex operand lowers to the complex helper', () => {
      // `Log` had NO complex dispatch at all: `Math.log10({re, im})` is `NaN`.
      const ce = new ComputeEngine();
      const expr = ce.expr(['Log', ['Complex', 1, 1]]);
      const result = compile(expr, { fallback: false });
      const val = result.run!() as { re: number; im: number };
      const expected = interpreted(expr);
      expect(val.re).toBeCloseTo(expected.re, 12);
      expect(val.im).toBeCloseTo(expected.im, 12);
    });

    it('Power/Root on the COMPLEX branch of a negative base agree with the interpreter', () => {
      // SUPERSEDED CONTRACT (2026-07-30 ruling). This test used to assert that
      // these stayed real (typed `finite_number`) and ran to `NaN` — true only
      // because the type handlers did not yet track the negative-base branch.
      // They now do: a negative base with an exponent whose reduced-rational
      // denominator is EVEN (or an even root degree) is typed `finite_complex`,
      // so the ENCLOSING `1 + …` emits `{re, im}` arithmetic. Leaving the real
      // NaN fold in place made the parent read `.re`/`.im` off a `NaN` *number*
      // — `{re: NaN, im: undefined}` behind `success: true`, the very defect
      // this file exists to pin. Do NOT restore the `toBeNaN` assertion.
      const ce = engineWithNegativeAssignment();
      for (const latex of ['1 + (-2)^{0.3}', '1 + \\sqrt[4]{-8}']) {
        const expr = ce.parse(latex);
        expect(expr.type.toString()).toBe('finite_complex');
        const result = compile(expr, { fallback: false });
        expect(result.success).toBe(true);
        const val = result.run!() as { re: number; im: number };
        const expected = interpreted(expr);
        expect(typeof val).toBe('object');
        expect(val.re).toBeCloseTo(expected.re, 12);
        expect(val.im).toBeCloseTo(expected.im, 12);
      }
    });

    it('Power/Root on the REAL branch of a negative base fold to the real root', () => {
      // The other half of the 2026-07-30 ruling, and a pre-existing
      // compiled/interpreted divergence independent of the type change: an ODD
      // reduced-rational denominator has a real principal root, which
      // `Math.pow` misses (`Math.pow(-8, 2/3)` is `NaN`). `Root` already
      // corrected for this; `Power` did not, so `(-8)^(2/3)` compiled to `NaN`
      // while the interpreter returned `4`. The node correctly stays
      // `finite_number` — the parent emits real arithmetic — so the FOLD is
      // what had to change.
      const ce = engineWithNegativeAssignment();
      const expr = ce.parse('(-8)^{\\frac{2}{3}}');
      expect(expr.type.toString()).toBe('finite_number');
      const result = compile(expr, { fallback: false });
      expect(result.code).toBe('4');
      expect(result.run!()).toBe(4);
      expect(result.run!()).toBe(expr.N().re);
      // The odd-degree `Root` correction this was ported from is unchanged.
      expect(
        compile(ce.parse('\\sqrt[3]{-8}'), { fallback: false }).run!()
      ).toBe(-2);
    });

    it('an odd EXACT denominator folds real even when its double does not', () => {
      // The branch is decided by the exponent's EXACT rational, which is what
      // the type handler reads. `100/3`'s double reconstructs by continued
      // fractions to the dyadic `4691249611844267/140737488355328` — an EVEN
      // denominator — so a float-first decision reported this complex (fold:
      // NaN) while the type said `finite_number`. Type, `.N()` and the compiled
      // constant now tell one story: the real `+2^(100/3)`.
      const ce = engineWithNegativeAssignment();
      const expr = ce.parse('(-2)^{\\frac{100}{3}}');
      expect(expr.type.toString()).toBe('finite_number');
      const folded = compile(expr, { fallback: false }).run!() as number;
      expect(folded).toBe(Math.pow(2, 100 / 3));
      expect(folded).toBeCloseTo(expr.N().re, 0);
      expect(expr.N().im).toBe(0);
    });
  });

  describe('GPU targets', () => {
    // A shader carries complex as `vec2(re, im)`, and shader scalar-broadcast
    // makes `sqrt(-2.0) + vec2(1.0, 0.0)` VALID source — a silent
    // `vec2(NaN, NaN)` rather than a compile error.
    for (const language of ['glsl', 'wgsl'] as const) {
      const v2 = language === 'wgsl' ? 'vec2f' : 'vec2';

      it(`${language}: Sqrt of an assigned negative emits the complex helper`, () => {
        const ce = engineWithNegativeAssignment();
        const code = ce
          .getCompilationTarget(language)!
          .compile(ce.parse('1 + \\sqrt{a}')).code;
        expect(code).toBe(`_gpu_csqrt(${v2}((-2.0), 0.0)) + ${v2}(1.0, 0.0)`);
      });

      it(`${language}: Ln of an assigned negative emits the complex helper`, () => {
        const ce = engineWithNegativeAssignment();
        const code = ce
          .getCompilationTarget(language)!
          .compile(ce.parse('1 + \\ln(a)')).code;
        expect(code).toBe(`_gpu_cln(${v2}((-2.0), 0.0)) + ${v2}(1.0, 0.0)`);
      });

      it(`${language}: Log of an assigned negative emits the complex helper`, () => {
        const ce = engineWithNegativeAssignment();
        const code = ce
          .getCompilationTarget(language)!
          .compile(ce.parse('1 + \\log(a)')).code;
        expect(code).toContain(`_gpu_cln(${v2}((-2.0), 0.0))`);
        expect(code).not.toContain('log((-2.0))');
      });

      it(`${language}: a bounded inverse head out of domain emits the complex helper`, () => {
        const ce = engineWithNegativeAssignment();
        const target = ce.getCompilationTarget(language)!;
        // Direct helper available.
        expect(target.compile(ce.parse('1 + \\arcsin(2)')).code).toBe(
          `${v2}(1.0, 0.0) + _gpu_casin(${v2}(2.0, 0.0))`
        );
        expect(
          target.compile(ce.parse('1 + \\operatorname{artanh}(2)')).code
        ).toBe(`${v2}(1.0, 0.0) + _gpu_catanh(${v2}(2.0, 0.0))`);
        // No direct `_gpu_casec`: the complex lift of the head's own real
        // lowering, `acos(1/x)`.
        expect(
          target.compile(ce.parse('1 + \\operatorname{arcsec}(0.5)')).code
        ).toBe(
          `${v2}(1.0, 0.0) + ` +
            `_gpu_cacos(_gpu_cdiv(${v2}(1.0, 0.0), ${v2}(0.5, 0.0)))`
        );
        // Never a scalar under a `vec2` parent (shader scalar-broadcast makes
        // that valid source and a silent `vec2(NaN, NaN)`).
        for (const latex of [
          '1 + \\arccos(2)',
          '1 + \\operatorname{arcosh}(0)',
          '1 + \\operatorname{arcoth}(0.5)',
          '1 + \\operatorname{arsech}(-2)',
          '1 + \\operatorname{arccsc}(0.5)',
        ]) {
          const code = target.compile(ce.parse(latex)).code!;
          expect([latex, /_gpu_c/.test(code)]).toEqual([latex, true]);
        }
      });

      it(`${language}: an IN-domain inverse-trig argument stays scalar`, () => {
        const ce = engineWithNegativeAssignment();
        const target = ce.getCompilationTarget(language)!;
        expect(target.compile(ce.parse('\\arcsin(0.5)')).code).toBe(
          'asin(0.5)'
        );
        expect(target.compile(ce.parse('\\operatorname{arcosh}(2)')).code).toBe(
          'acosh(2.0)'
        );
      });

      it(`${language}: a real-typed symbol still emits the scalar lowering`, () => {
        const ce = engineWithNegativeAssignment();
        const target = ce.getCompilationTarget(language)!;
        expect(target.compile(ce.parse('\\sqrt{r}')).code).toBe('sqrt(r)');
        expect(target.compile(ce.parse('\\ln(r)')).code).toBe('log(r)');
        expect(target.compile(ce.parse('\\log(r)')).code).toBe(
          '(log(r) / log(10.0))'
        );
      });
    }
  });
});

/**
 * `realOnly: true` over an IN-DOMAIN argument — the path every plotting
 * consumer compiles a function body through.
 *
 * REGRESSION (2026-07-30). Typing the eight bounded heads `complex` for an
 * argument of unknown magnitude routed EVERY call through the `_SYS.c…`
 * helper, including the in-domain ones. `Complex(0.5, 0).asin()` returns
 * `im: 5.55e-17` — dust from the complex log/sqrt formulation — and
 * `wrapRealOnly` projected `im !== 0` to `NaN` by an EXACT test. `y =
 * arcsin(x)` therefore compiled to a curve that was `NaN` at every point of
 * its domain.
 *
 * The projection now CHOPS the imaginary part at the kernel-roundoff scale
 * (`ROUNDOFF_TOLERANCE`, matching `apply.ts`'s complex-result chop) — NOT at
 * `ce.tolerance`: whether the dust is noise is a property of the arithmetic,
 * so the projection must not change when the user tunes their comparison
 * tolerance (see ARCHITECTURE.md § "Chopping and the `im === 0` convention").
 * A genuinely complex value is nowhere near the roundoff scale and still
 * fails closed to `NaN` — pinned below.
 *
 * Both shapes are pinned: the BARE head, and the head under a parent that
 * emits `{re, im}` arithmetic around it (`1 + …`) — the compound form is what a
 * real function body looks like, and it is NOT fixed by anything the emitter
 * could decide on its own, since the parent's codegen is driven by the node's
 * TYPE, and the dust then flows through the parent's complex arithmetic.
 */
describe('COMPILE: realOnly over an in-domain bounded inverse-trig argument', () => {
  // head, LaTeX command, in-domain probe, out-of-domain probe
  const HEADS = [
    ['Arcsin', '\\arcsin', 0.5, 2],
    ['Arccos', '\\arccos', 0.5, 2],
    ['Arcosh', '\\operatorname{arcosh}', 2, 0.5],
    ['Artanh', '\\operatorname{artanh}', 0.5, 2],
    ['Arcoth', '\\operatorname{arcoth}', 2, 0.5],
    ['Arsech', '\\operatorname{arsech}', 0.5, 2],
    ['Arcsec', '\\operatorname{arcsec}', 2, 0.5],
    ['Arccsc', '\\operatorname{arccsc}', 2, 0.5],
  ] as const;

  for (const [name, cmd, inDomain, outOfDomain] of HEADS) {
    for (const [shape, latex] of [
      ['bare', `${cmd}(u)`],
      ['under a complex-emitting parent', `1 + ${cmd}(u)`],
    ] as const) {
      it(`${name} (${shape}): in-domain matches the interpreter, out-of-domain is NaN`, () => {
        const ce = new ComputeEngine();
        ce.declare('u', 'real');
        const expr = ce.parse(latex);
        const result = compile(expr, { realOnly: true, fallback: false });
        expect(result.success).toBe(true);

        const val = result.run!({ u: inDomain });
        // The bug made this `NaN` for every in-domain argument.
        expect(typeof val).toBe('number');
        expect(val).toBeCloseTo(
          interpreted(expr.subs({ u: ce.number(inDomain) })).re,
          12
        );

        // Out of domain there is no real value: `realOnly` must still fail
        // closed to `NaN`, not leak a `{re, im}` object.
        expect(result.run!({ u: outOfDomain })).toBeNaN();
      });
    }
  }

  it('chopping has not swallowed a genuinely complex value', () => {
    // The chop is a ROUNDOFF-DUST test, not a "close enough to real" test: an
    // imaginary part above the roundoff scale (1e-14) must still fail closed
    // to `NaN` — including one well below `ce.tolerance` (1e-10), which the
    // old `ce.tolerance`-based projection silently realized.
    const ce = new ComputeEngine();
    expect(ce.tolerance).toBe(1e-10);
    for (const expr of [
      ['Arcsin', 2], // im = -1.3169…
      ['Sqrt', -4], // im = 2
      ['Complex', 1, 1e-9], // above ce.tolerance
      ['Complex', 1, 1e-11], // BELOW ce.tolerance, above roundoff — genuine
    ] as const) {
      const result = compile(ce.box(expr as any), {
        realOnly: true,
        fallback: false,
      });
      expect(result.run!()).toBeNaN();
    }
    // …and one below the roundoff scale projects.
    const below = compile(ce.box(['Complex', 1, 1e-15]), {
      realOnly: true,
      fallback: false,
    });
    expect(below.run!()).toBe(1);
  });

  it('dust from a head with no real branch projects, independent of ce.tolerance', () => {
    // `realDomainComplexFn` gives the eight bounded heads an exact real
    // branch; the chop is the systemic net beneath it, for every head that has
    // no such branch. `Exp(Ln(-2))` is exactly `-2` interpreted, but the
    // compiled complex `exp`/`log` pair leaves `im = 2.449e-16`.
    const ce = new ComputeEngine();
    const expr = ce.box(['Exp', ['Ln', -2]]);
    expect(interpreted(expr)).toEqual({ re: -2, im: 0 });
    expect(compile(expr, { fallback: false }).run!()).toMatchObject({
      re: -2,
      im: expect.any(Number),
    });
    expect(compile(expr, { realOnly: true, fallback: false }).run!()).toBe(-2);

    // A list/tuple result is projected COMPONENTWISE: dust projects, a
    // genuinely complex component still fails closed.
    expect(
      compile(ce.box(['List', ['Exp', ['Ln', -2]], 3]), {
        realOnly: true,
        fallback: false,
      }).run!()
    ).toEqual([-2, 3]);
    const tuple = compile(ce.box(['Tuple', ['Exp', ['Ln', -2]], ['Sqrt', -2]]), {
      realOnly: true,
      fallback: false,
    }).run!() as number[];
    expect(tuple[0]).toBe(-2);
    expect(tuple[1]).toBeNaN();

    // The chop scale is the FIXED kernel-roundoff scale, decoupled from
    // `ce.tolerance`: tightening the user tolerance to 0 must NOT re-break
    // the projection (under the old `ce.tolerance`-based chop it degenerated
    // to the exact `im === 0` test and this returned `NaN`), and loosening it
    // must not swallow a genuinely complex value.
    const strict = new ComputeEngine();
    strict.tolerance = 0;
    const strictExpr = strict.box(['Exp', ['Ln', -2]]);
    expect(
      compile(strictExpr, { realOnly: true, fallback: false }).run!()
    ).toBe(-2);
    const loose = new ComputeEngine();
    loose.tolerance = 1e-3;
    expect(
      compile(loose.box(['Complex', 1, 1e-4]), {
        realOnly: true,
        fallback: false,
      }).run!()
    ).toBeNaN();
  });

  it('Sqrt/Ln/Log under realOnly keep their real lowering', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'real');
    for (const [latex, code, arg, expected] of [
      ['\\sqrt{u}', 'Math.sqrt(_.u)', 4, 2],
      ['\\ln(u)', 'Math.log(_.u)', 1, 0],
      ['\\log(u)', 'Math.log10(_.u)', 100, 2],
    ] as const) {
      const result = compile(ce.parse(latex), {
        realOnly: true,
        fallback: false,
      });
      expect(result.code).toBe(code);
      expect(result.run!({ u: arg })).toBe(expected);
      expect(result.run!({ u: -1 })).toBeNaN();
    }
  });
});
