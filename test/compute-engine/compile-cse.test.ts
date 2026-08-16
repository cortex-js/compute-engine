import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { harvestCse } from '../../src/compute-engine/compilation/cse';
import type { CompileTarget } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';

const glsl = new GLSLTarget();

/** The design's motivating probe: `sin(6u)` three times in one expression. */
const PROBE_LATEX = '\\sin(6u)^2 + \\frac{\\sin(6u)}{2+\\sin(6u)}';

/** The same expression built through the box route (no LaTeX parsing). */
const probeBoxed = () =>
  ce.box([
    'Add',
    ['Square', ['Sin', ['Multiply', 6, 'u']]],
    [
      'Divide',
      ['Sin', ['Multiply', 6, 'u']],
      ['Add', 2, ['Sin', ['Multiply', 6, 'u']]],
    ],
  ]);

const occurrences = (code: string, needle: string): number =>
  code.split(needle).length - 1;

/** The `sin(6·v)` atom of the probe, as raw MathJSON. */
const sin6 = (v: string | number): any => ['Sin', ['Multiply', 6, v]];

/** `sin(6v)² + sin(6v) + sin(6v)` — a size-4 candidate occurring three times
 * (score 8, exactly at `CSE_MIN_SCORE`). */
const probe3 = (v: string | number): any => [
  'Add',
  ['Square', sin6(v)],
  sin6(v),
  sin6(v),
];

/** Run a compiled artifact with and without CSE and assert they agree. */
function parity(
  expr: Expression,
  vars: Record<string, unknown> | number = {},
  digits = 12
): void {
  const on = compile(expr, { fallback: false });
  const off = compile(expr, { fallback: false, cse: false });
  const a = (on.run as (v: any) => number)(vars);
  const b = (off.run as (v: any) => number)(vars);
  if (typeof a === 'number' && typeof b === 'number')
    expect(a).toBeCloseTo(b, digits);
  else expect(a).toEqual(b);
}

/**
 * Deterministic temp naming (`docs/plans/2026-07-28-compile-cse-design.md` §2,
 * §4.1, §6.3). `BaseCompiler.tempVar()` numbers `_tv1`, `_tv2`, … from the
 * target's naming context instead of drawing a `Math.random()` name, so two
 * compilations of one expression emit byte-identical source — on EVERY target,
 * with or without CSE. Neither the `_tv` nor the `_cse` prefix is reserved:
 * a name already used by the expression is skipped, not assumed unique.
 */
describe('COMPILE deterministic naming', () => {
  it('emits byte-identical code for two compiles of a chained relation', () => {
    // A chained relation binds its shared middle operand to a temporary
    // (`bindExpr`), so this expression exercises `tempVar()`.
    const expr = ce.parse('0 < x + 1 < 10');

    const first = compile(expr).code;
    const second = compile(expr).code;
    const third = compile(expr).code;

    expect(first).toContain('_tv1');
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first).toMatchInlineSnapshot(
      `((_tv1) => (0 < _tv1) && (_tv1 < 10))(_.x + 1)`
    );
  });

  it('emits byte-identical GLSL for two compiles of a loop accumulator', () => {
    // Symbolic bounds force the for-loop form, whose accumulator comes from
    // `tempVar()` (`gpu-target.ts`, `compileGPUSumProduct`).
    const expr = ce.parse('\\sum_{i=1}^{n} \\sin(i)');

    const first = glsl.compile(expr).code;
    const second = glsl.compile(expr).code;
    const third = glsl.compile(expr).code;

    expect(first).toContain('_tv1');
    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(first).toMatchInlineSnapshot(`
      float _tv1 = 0.0;
      for (int i = 1; i <= int(floor(n)); i++) {
        _tv1 += sin(float(i));
      }
      return _tv1;
    `);
  });

  it('does not capture a lambda parameter named `_tv1`', () => {
    // `Round(x, n)` binds two temporaries; the parameter is emitted BARE, so a
    // generated name that collided with it would shadow the argument.
    const expr = ce.box(['Function', ['Round', '_tv1', 2], '_tv1']);
    const result = compile(expr);

    expect(result.code).not.toMatch(/const _tv1\b/);
    expect((result.run as (x: number) => number)(3.14159)).toBe(
      ce.box(['Round', 3.14159, 2]).N().re
    );
    expect(result.code).toMatchInlineSnapshot(
      `(_tv1) => (() => { const _tv3 = Math.pow(10, 2); const _tv2 = _tv1 * _tv3; return (Math.sign(_tv2) * Math.round(Math.abs(_tv2))) / _tv3; })()`
    );
  });

  it('does not capture a loop index named `_tv1`', () => {
    // The `Sum` index is emitted bare too, and the loop accumulator is a
    // `tempVar()` — it must skip `_tv1` and take `_tv2`.
    const expr = ce.box([
      'Sum',
      ['Square', '_tv1'],
      ['Limits', '_tv1', 1, 'n'],
    ]);
    const result = compile(expr);

    expect(result.code).not.toMatch(/let _tv1 = 0\b/);
    expect(
      (result.run as (v: Record<string, number>) => number)({ n: 4 })
    ).toBe(
      ce.box(['Sum', ['Square', '_tv1'], ['Limits', '_tv1', 1, 4]]).evaluate()
        .re
    );
  });

  it('restarts the numbering on a REUSED caller-built direct target', () => {
    // The direct custom-target route stamps a fresh naming context per
    // `compile()` call, so a target the caller built once and reuses never
    // carries stale numbering into the next compilation.
    const target = new JavaScriptTarget().createTarget();
    const expr = ce.parse('0 < x + 1 < 10');

    const first = compile(expr, { target, fallback: false }).code;
    const second = compile(expr, { target, fallback: false }).code;

    expect(first).toContain('_tv1');
    expect(second).toBe(first);
  });
});

/**
 * Emission-level common-subexpression elimination
 * (`docs/plans/2026-07-28-compile-cse-design.md` §6): a repeated PURE subtree
 * inside one compiled expression is evaluated once, bound to a `_cseN`
 * temporary at the top of its region, and referenced at every occurrence.
 *
 * Values are unchanged (same operations, no reassociation), and no binding
 * ever crosses a region boundary — a conditional arm, a short-circuited tail,
 * a binder body — so selection laziness and capture-soundness are structural.
 */
describe('COMPILE CSE — dedup', () => {
  it('evaluates a thrice-repeated subtree once (parse route)', () => {
    const expr = ce.parse(PROBE_LATEX);
    const result = compile(expr, { fallback: false });

    // ONE `Math.sin` call for three occurrences.
    expect(occurrences(result.code, 'Math.sin')).toBe(1);
    expect(occurrences(result.code, '_cse1')).toBe(4); // 1 binding + 3 uses
    expect(result.code).toMatchInlineSnapshot(
      `(() => { const _cse1 = Math.sin(6 * _.u); return Math.pow(_cse1, 2) + _cse1 / (_cse1 + 2); })()`
    );

    for (const u of [0.3, -1.25, 2]) {
      const compiled = (result.run as (v: Record<string, number>) => number)({
        u,
      });
      const interpreted = expr.subs({ u }).N().re;
      expect(compiled).toBeCloseTo(interpreted!, 12);
    }
  });

  it('evaluates a thrice-repeated subtree once (box route)', () => {
    const result = compile(probeBoxed(), { fallback: false });

    expect(occurrences(result.code, 'Math.sin')).toBe(1);
    expect(
      (result.run as (v: Record<string, number>) => number)({ u: 0.3 })
    ).toBeCloseTo(
      compile(ce.parse(PROBE_LATEX), { fallback: false, cse: false }).run!({
        u: 0.3,
      }) as number,
      12
    );
  });

  it('binds a nested candidate first, so the outer temp can reference it', () => {
    // `sin(6u)` occurs 3×, `cos(u)·sin(6u)²` 2×: different per-region counts,
    // so subsumption keeps both — and the outer right-hand side must reference
    // the inner temporary (§6.1: the binding is appended AFTER its right-hand
    // side compiles, which makes the list dependency-ordered for free).
    const expr = ce.parse(
      '\\frac{\\sin(6u)^2\\cos(u)}{1+\\sin(6u)^2\\cos(u)} + \\sin(6u)'
    );
    const result = compile(expr, { fallback: false });

    expect(result.code).toMatchInlineSnapshot(
      `(() => { const _cse1 = Math.sin(6 * _.u); const _cse2 = Math.cos(_.u) * Math.pow(_cse1, 2); return _cse1 + _cse2 / (_cse2 + 1); })()`
    );
    // The outer binding references the inner temp, and is bound after it.
    expect(result.code.indexOf('const _cse1')).toBeLessThan(
      result.code.indexOf('const _cse2')
    );
    expect(
      (result.run as (v: Record<string, number>) => number)({ u: 0.4 })
    ).toBeCloseTo(
      compile(expr, { fallback: false, cse: false }).run!({ u: 0.4 }) as number,
      12
    );
  });

  it('emits the duplicated form with `cse: false`', () => {
    const expr = ce.parse(PROBE_LATEX);
    const off = compile(expr, { fallback: false, cse: false });

    expect(off.code).not.toContain('_cse');
    expect(occurrences(off.code, 'Math.sin')).toBe(3);
    expect(off.code).toMatchInlineSnapshot(
      `Math.pow(Math.sin(6 * _.u), 2) + Math.sin(6 * _.u) / (Math.sin(6 * _.u) + 2)`
    );
  });
});

describe('COMPILE CSE — conditionality', () => {
  it('binds an arm-only candidate INSIDE the arm, and never evaluates an unselected arm', () => {
    // The repeated subtree lives only in the `x > 0` arm, so its region is
    // that arm — the binding must sit inside the ternary branch, not be
    // hoisted in front of the condition (§7.3).
    const expr = ce.box([
      'Which',
      ['Greater', 'x', 0],
      ce.parse(PROBE_LATEX),
      'True',
      0,
    ]);
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'Math.sin')).toBe(1);
    // The binding is inside the selected branch: it appears AFTER the `?`.
    expect(result.code.indexOf('_cse1')).toBeGreaterThan(
      result.code.indexOf('?')
    );
    expect(result.code).toMatchInlineSnapshot(
      `((0 < _.x) ? ((() => { const _cse1 = Math.sin(6 * _.u); return Math.pow(_cse1, 2) + _cse1 / (_cse1 + 2); })()) : (0))`
    );

    // The unselected arm evaluates NOTHING: a getter on the vars object counts
    // every read of `u`, which only the arm's code performs.
    let reads = 0;
    const vars = {
      x: -1,
      get u() {
        reads += 1;
        return 0.3;
      },
    };
    expect(
      (result.run as (v: Record<string, number>) => number)(vars as any)
    ).toBe(0);
    expect(reads).toBe(0);

    // …and the selected arm still computes the right value.
    expect(
      (result.run as (v: Record<string, number>) => number)({ x: 1, u: 0.3 })
    ).toBeCloseTo(
      compile(ce.parse(PROBE_LATEX), { fallback: false, cse: false }).run!({
        u: 0.3,
      }) as number,
      12
    );
  });
});

describe('COMPILE CSE — binder bodies', () => {
  it('keeps unrolled `Sum` terms in agreement with the interpreter', () => {
    // `emitSumProduct` compiles the SAME body node objects once per index
    // value, varying only the index `var` mapping. Each term opens a FRESH
    // region instance (§6.1); a node-keyed reuse would emit iteration 1's
    // temporary for every later iteration — silently wrong values.
    const expr = ce.parse('\\sum_{i=1}^{5}(\\sin(i)\\sin(i)+i)');
    // Opt out of constant folding: the body has no free variables, so the
    // folder would collapse the whole sum to one numeric literal and the
    // code-shape comparison below would compare two identical literals
    // instead of the unrolled emission this test is about.
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(
      (result.run as (v: Record<string, number>) => number)({})
    ).toBeCloseTo(expr.evaluate().N().re!, 12);
    expect(result.code).toBe(
      compile(expr, { fallback: false, cse: false, constantFold: false }).code
    );
  });

  it('gives every unrolled term its own temporary', () => {
    // The candidate-bearing version of the same trap: each term must bind its
    // OWN `_cseN` over its own index value.
    const expr = ce.parse(`\\sum_{i=1}^{4}(${PROBE_LATEX.replace(/u/g, 'i')})`);
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(occurrences(result.code, 'const _cse')).toBe(4);
    expect(result.code).toContain('const _cse1 = Math.sin(6 * 1)');
    expect(result.code).toContain('const _cse4 = Math.sin(6 * 4)');
    expect(
      (result.run as (v: Record<string, number>) => number)({})
    ).toBeCloseTo(expr.N().re!, 12);
  });

  it('binds inside the loop body of a symbolic-bound `Sum`', () => {
    // The binding belongs to the binder BODY region: it must sit inside the
    // emitted loop, recomputed per iteration, never hoisted out of it.
    const expr = ce.parse(`\\sum_{i=1}^{n}(${PROBE_LATEX.replace(/u/g, 'i')})`);
    const result = compile(expr, { fallback: false });

    expect(result.code.indexOf('while')).toBeLessThan(
      result.code.indexOf('const _cse1')
    );
    expect(
      (result.run as (v: Record<string, number>) => number)({ n: 5 })
    ).toBeCloseTo(
      compile(expr, { fallback: false, cse: false }).run!({ n: 5 }) as number,
      12
    );
  });
});

describe('COMPILE CSE — emission purity (G1b)', () => {
  /** `Sum(Map(cb, [1,2,3,4]))` twice, over a fresh engine (assigning a symbol
   * retypes it for the engine's lifetime). */
  const mappedTwice = (engine: ComputeEngine, cb: string) => {
    const mapped = ['Sum', ['Map', cb, ['List', 1, 2, 3, 4]]];
    return engine.box(['Add', mapped, mapped]);
  };

  it('merges two identical `Map(f, xs)` with a PURE named callback', () => {
    // A named callback used to be opaque outright — invisible to purity
    // inference (`docs/EFFECTS-MODEL.md`). It is now resolved through the
    // same transitive admission gate as a call site
    // (`isAdmissibleUserFnCallee`): a callback whose literal body validates
    // pure and emission-clean no longer blocks the application.
    const engine = new ComputeEngine();
    engine.assign('mapper', engine.parse('x \\mapsto x^2 + 3x + 1'));
    const expr = mappedTwice(engine, 'mapper');
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    // The mapping itself is emitted ONCE.
    expect(occurrences(result.code, '.map(')).toBe(1);

    const value = (result.run as (v: Record<string, number>) => number)({});
    expect(value).toBe(
      compile(expr, { fallback: false, cse: false, constantFold: false }).run!(
        {}
      ) as number
    );
    expect(value).toBe(expr.evaluate().N().re);
  });

  it('does not merge two identical `Map(f, xs)` with a DRAWING named callback', () => {
    // The relaxation is gated on the callback's body: `f` drawing makes
    // `Map(f, xs)` impure (G1) and `f` itself inadmissible, so merging — which
    // would change the draw stream — never happens.
    const engine = new ComputeEngine();
    engine.assign(
      'drawer',
      engine.parse('x \\mapsto x + \\operatorname{Random}()')
    );
    const expr = mappedTwice(engine, 'drawer');
    const result = compile(expr, { fallback: false });

    expect(result.code).not.toMatch(/_cse\d/);
    // Both applications are still emitted, in full.
    expect(occurrences(result.code, '.map(')).toBe(2);
  });

  it('merges two identical `Map(Sin, xs)` with a BUILT-IN operator callback', () => {
    // `Sin` resolves to the engine-authored system-scope operator definition,
    // is `pure`, and has a FIXED unary signature — so the compiler
    // eta-expands it into the shared local `_fn_Sin` and the harvest admits
    // it exactly like a pure user-function callback.
    const engine = new ComputeEngine();
    const expr = mappedTwice(engine, 'Sin');
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(occurrences(result.code, '.map(')).toBe(1);

    const value = (result.run as (v: Record<string, number>) => number)({});
    expect(value).toBe(
      compile(expr, { fallback: false, cse: false, constantFold: false }).run!(
        {}
      ) as number
    );
    expect(value).toBeCloseTo(expr.evaluate().N().re!, 12);
  });

  it('merges two identical `Map(Ln, xs)` — an OPTIONAL-tail built-in', () => {
    // `Ln` expands at its REQUIRED arity (1 of 1 required + 1 optional), so
    // it is admitted exactly like `Sin`.
    const engine = new ComputeEngine();
    const expr = mappedTwice(engine, 'Ln');
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(occurrences(result.code, '.map(')).toBe(1);

    const value = (result.run as (v: Record<string, number>) => number)({});
    expect(value).toBe(
      compile(expr, { fallback: false, cse: false, constantFold: false }).run!(
        {}
      ) as number
    );
    expect(value).toBeCloseTo(expr.evaluate().N().re!, 12);
  });

  it('merges two identical `Map(Negate, xs)` — an OPERATOR-MAPPED built-in', () => {
    const engine = new ComputeEngine();
    const expr = mappedTwice(engine, 'Negate');
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(occurrences(result.code, '.map(')).toBe(1);
    expect((result.run as (v: Record<string, number>) => number)({})).toBe(
      expr.evaluate().N().re!
    );
  });

  it('keeps a DRAWING built-in callback (`Random`) opaque', () => {
    // `Random` is impure AND has no expandable arity (zero required
    // parameters), so it never becomes CSE-eligible. Emission now REFUSES it
    // outright rather than emitting a broken artifact, so the opacity is
    // pinned on the harvest itself.
    const engine = new ComputeEngine();
    const expr = mappedTwice(engine, 'Random');
    expect(() => compile(expr, { fallback: false })).toThrow(/Fail closed/);

    const harvest = harvestCse(expr, { admitPureUserFunctions: true });
    expect(harvest.candidates).toHaveLength(0);
  });

  it('refuses a VARIADIC-tail built-in callback (`Or`) outright', () => {
    // `Or` is `(boolean+) -> boolean`: a variadic tail, so it has no single
    // wrapper arity, emission refuses it with `Fail closed`, and the harvest
    // agrees (no candidate).
    //
    // The probe used to be spelled with `Less` (`(any, any+) -> boolean`), but
    // since the static callback-arity check (2026-08-15) that call never
    // reaches the compiler: `Less` needs at least TWO arguments and `Map`
    // supplies one, so it is rejected while it is canonicalized. `Or`'s `+`
    // tail admits ONE argument, so the arity check declines on it, the call
    // stays valid, and the emission gate under test is reached.
    const engine = new ComputeEngine();
    const expr = mappedTwice(engine, 'Or');
    expect(expr.isValid).toBe(true);
    expect(() => compile(expr, { fallback: false })).toThrow(/Fail closed/);

    const harvest = harvestCse(expr, { admitPureUserFunctions: true });
    expect(harvest.candidates).toHaveLength(0);

    // The `Less` spelling is still refused, one stage earlier.
    const bad = mappedTwice(new ComputeEngine(), 'Less');
    expect(bad.isValid).toBe(false);
    expect(() => compile(bad, { fallback: false })).toThrow(
      /invalid expression/
    );
    // …and the harvest of that INVALID tree is empty too: an `Error` node is
    // a diagnostic, not a computation, so no subtree containing one becomes a
    // candidate the emission gate would only refuse.
    const badHarvest = harvestCse(bad, { admitPureUserFunctions: true });
    expect(badHarvest.candidates).toHaveLength(0);
  });

  it('keeps a `vars`-MAPPED built-in name opaque', () => {
    // A `vars` entry is the caller's external-input contract and WINS at
    // emission over the eta route, so the name is not the built-in it is
    // spelled like — admitting it would rest on a false premise. A NON-string
    // `vars` value is a baked constant, so the source-splicing gate
    // (`isStringVar`) does not cover it; the broader `isVarsKey` test does.
    // (The user-function relaxation is gated on the identical test.)
    const engine = new ComputeEngine();
    const expr = mappedTwice(engine, 'Sin');
    const code = new JavaScriptTarget().compile(expr, {
      vars: { Sin: 5 } as unknown as Record<string, string>,
    }).code;

    expect(code).not.toMatch(/_cse\d/);
    expect(occurrences(code, '.map(')).toBe(2);
    expect(code).not.toContain('_fn_Sin');
  });

  it('keeps a CALLER-OVERRIDDEN built-in callback opaque', () => {
    // A `functions` mapping splices caller source of unknowable purity into
    // the wrapper BODY, so the operand must stay opaque for MERGING even
    // though emission still routes through the eta-expanded wrapper.
    const engine = new ComputeEngine();
    const expr = mappedTwice(engine, 'Sin');
    const result = compile(expr, {
      fallback: false,
      functions: { Sin: 'mySin' },
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, '.map(')).toBe(2);
  });
});

describe('COMPILE CSE — other targets', () => {
  it('binds with a flat comprehension on the Python target', () => {
    const code = new PythonTarget().compileToSource(ce.parse(PROBE_LATEX));

    expect(occurrences(code, 'np.sin')).toBe(1);
    expect(code).toMatchInlineSnapshot(
      `[_cse1 ** 2 + _cse1 / (_cse1 + 2) for _cse1 in [np.sin(6 * u)]][0]`
    );
  });

  it('binds with a sequential-const IIFE on the interval-js target', () => {
    const expr = ce.parse(PROBE_LATEX);
    const result = compile(expr, { to: 'interval-js', fallback: false });

    expect(occurrences(result.code, '_IA.sin')).toBe(1);
    expect(result.code).toMatchInlineSnapshot(
      `(() => { const _cse1 = _IA.sin(_IA.mul(_IA.point(6), _.u)); return _IA.add(_IA.square(_cse1), _IA.div(_cse1, _IA.add(_cse1, _IA.point(2)))); })()`
    );

    // A point interval reproduces the scalar value; a proper interval encloses
    // the values of the scalar function over it.
    const point = (result.run as any)({ u: { lo: 0.3, hi: 0.3 } });
    expect(point.value.lo).toBeCloseTo(
      compile(expr, { fallback: false }).run!({ u: 0.3 }) as number,
      12
    );
    const box = (result.run as any)({ u: { lo: 0.3, hi: 0.31 } });
    expect(box.value.lo).toBeLessThanOrEqual(point.value.lo);
    expect(box.value.hi).toBeGreaterThanOrEqual(point.value.hi);
  });
});

describe('COMPILE CSE — determinism', () => {
  it('emits byte-identical source for two compiles of a candidate-bearing expression', () => {
    const expr = ce.parse(PROBE_LATEX);
    const first = compile(expr, { fallback: false }).code;
    const second = compile(expr, { fallback: false }).code;
    const third = compile(ce.parse(PROBE_LATEX), { fallback: false }).code;

    expect(first).toContain('_cse1');
    expect(second).toBe(first);
    expect(third).toBe(first);
  });

  it('emits byte-identical source when candidates and `tempVar()` temps share the counter', () => {
    // A chained relation allocates `_tv` temporaries; the repeated middle
    // operand is also a candidate, so both allocators draw from one counter.
    const expr = ce.parse(`0 < ${PROBE_LATEX} < 10`);
    const first = compile(expr, { fallback: false }).code;
    const second = compile(expr, { fallback: false }).code;

    expect(second).toBe(first);
    expect(first).toMatchInlineSnapshot(
      `(() => { const _cse1 = Math.sin(6 * _.u); return ((_tv2) => (0 < _tv2) && (_tv2 < 10))(Math.pow(_cse1, 2) + _cse1 / (_cse1 + 2)); })()`
    );
  });
});

/**
 * §5.1(a) — capture. A binder body is its own region, so a subtree that reads
 * a name bound by the binder can never share a temporary with the
 * same-*spelled* subtree outside it: the two are different values.
 */
describe('COMPILE CSE — capture', () => {
  it('never merges across a `Sum` binder (inside and outside share a name)', () => {
    // `sin(6n)` occurs three times OUTSIDE (over the free `n`) and three times
    // INSIDE the sum (over the loop index `n`). Two regions, two temporaries.
    const expr = ce.parse(
      '\\sin(6n)^2+\\sin(6n)+\\sin(6n)+\\sum_{n=1}^{m}(\\sin(6n)^2+\\sin(6n)+\\sin(6n))'
    );
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(2);
    // The inner temporary reads the LOOP index, the outer one the free symbol.
    expect(result.code).toContain('const _cse1 = Math.sin(6 * n);');
    expect(result.code).toContain('const _cse3 = Math.sin(6 * _.n);');
    // …and the inner binding sits inside the emitted loop.
    expect(result.code.indexOf('while')).toBeLessThan(
      result.code.indexOf('const _cse1')
    );

    parity(expr, { n: 0.3, m: 4 });
  });

  it('never merges across an `Integrate` binder', () => {
    // A non-elementary integrand keeps the integral at run time (`_SYS.integrate`
    // over a lambda). The integrand's `sin(sin(6x))` reads the lambda's `x`; the
    // outer occurrences read the free `x`.
    const inner = '\\sin(\\sin(6x))';
    const expr = ce.parse(
      `\\int_0^t (${inner}^2+${inner}+${inner}) dx + ${inner}^2+${inner}+${inner}`
    );
    const result = compile(expr, { fallback: false });

    // ONE temporary — the outer one, over `_.x`.
    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(result.code).toContain('const _cse1 = Math.sin(Math.sin(6 * _.x));');
    // The integrand is emitted intact over its OWN `x`; the temp never leaks in.
    const integrand = result.code.slice(
      result.code.indexOf('_SYS.integrate((x) =>'),
      result.code.indexOf(', 0, _.t)')
    );
    expect(integrand).not.toContain('_cse');
    expect(occurrences(integrand, 'Math.sin(Math.sin(6 * x))')).toBe(3);

    parity(expr, { x: 0.4, t: 1 }, 9);
  });

  it('never merges across a `Sum` binder on the interval-js target', () => {
    const expr = ce.parse(
      '\\sin(6n)^2+\\sin(6n)+\\sin(6n)+\\sum_{n=1}^{m}(\\sin(6n)^2+\\sin(6n)+\\sin(6n))'
    );
    const code = compile(expr, { to: 'interval-js', fallback: false }).code;

    // The outer occurrences bind; the loop body is emitted unshared, and the
    // outer temporary never appears inside the loop.
    expect(code).toContain('const _cse2 = _IA.sin(_IA.mul(_IA.point(6), _.n))');
    const loop = code.slice(
      code.indexOf('for (let n'),
      code.indexOf('return _tv1')
    );
    expect(loop).not.toContain('_cse');
  });

  it('never merges across a `Sum` binder on the Python target', () => {
    const code = new PythonTarget().compileToSource(
      ce.parse(
        '\\sin(6n)^2+\\sin(6n)+\\sin(6n)+\\sum_{n=1}^{m}(\\sin(6n)^2+\\sin(6n)+\\sin(6n))'
      )
    );
    // One binding clause, whose right-hand side reads the ENCLOSING `n` (the
    // generator's `for n in range(...)` has its own scope in Python).
    expect(occurrences(code, 'for _cse')).toBe(1);
    expect(code).toContain('for _cse1 in [np.sin(6 * n)]');
    const genexp = code.slice(code.indexOf('sum('), code.indexOf(') + _cse1'));
    expect(genexp).not.toContain('_cse');
  });
});

/**
 * §2, §5.1(b) — `Match` is fully CSE-inert in Phase 1: its guards and bodies
 * are compiled from plan-constructed closure trees, not from the harvested
 * operands, so the occurrence machinery cannot see them. Emission pushes a
 * BLIND instance, which resolves no candidate.
 */
describe('COMPILE CSE — `Match` is inert', () => {
  it('emits no `_cse` anywhere in a Match, subject included (javascript)', () => {
    const expr = ce.box(['Match', probe3('u'), ['MatchCase', '_a', 'a']]);
    const result = compile(expr, { fallback: false });

    expect(result.code).not.toMatch(/_cse\d/);
    // The repeated subtree is still emitted in full, three times.
    expect(occurrences(result.code, 'Math.sin(6 * _.u)')).toBe(3);
    // …and identically to the `cse: false` baseline.
    expect(result.code).toBe(
      compile(ce.box(['Match', probe3('u'), ['MatchCase', '_a', 'a']]), {
        fallback: false,
        cse: false,
      }).code
    );
  });

  it('emits no `_cse` in a Match BODY either', () => {
    // The body is reached through the plan's closure tree, which harvest never
    // sees — the blind instance is what keeps an enclosing candidate out.
    const expr = ce.box(['Match', 'x', ['MatchCase', '_t', probe3('t')]]);
    const result = compile(expr, { fallback: false });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, 'Math.sin(6 * _tv')).toBe(3);
  });

  it('keeps the interval-js fail-closed contract', () => {
    const result = compile(
      ce.box(['Match', probe3('u'), ['MatchCase', '_a', 'a']]),
      { to: 'interval-js', fallback: false }
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(
      /Match: pattern matching is not supported by the interval-js compile target/
    );
    expect(result.code).not.toMatch(/_cse/);
  });

  it('keeps the Python fail-closed contract', () => {
    expect(() =>
      new PythonTarget().compileToSource(
        ce.box(['Match', probe3('u'), ['MatchCase', '_a', 'a']])
      )
    ).toThrow(
      /Match: pattern matching is not supported by the Python compile target/
    );
  });
});

/**
 * §5.1(c) — statement regions. A `Block` statement list and an imperative
 * `Loop` body are INERT: nothing binds at the statement-list level, so
 * `Return`/`Break`/`Continue` reachability and inter-statement ordering never
 * interact with CSE. Each statement's own value expressions ARE bindable.
 */
describe('COMPILE CSE — statement regions', () => {
  const loopBlock = () =>
    ce.box([
      'Block',
      ['Assign', 'acc', 0],
      [
        'Loop',
        ['Assign', 'acc', ['Add', 'acc', probe3('u')]],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'acc',
    ]);

  it('deduplicates an Assign right-hand side inside a Loop body', () => {
    const result = compile(loopBlock(), { fallback: false });

    // The binding is INSIDE the loop, in the assignment's own value region.
    expect(occurrences(result.code, 'const _cse1')).toBe(1);
    expect(result.code.indexOf('for (let i')).toBeLessThan(
      result.code.indexOf('const _cse1')
    );
    expect(occurrences(result.code, 'Math.sin(6 * _.u)')).toBe(1);
  });

  it('deduplicates an Assign right-hand side inside a Loop body (Python)', () => {
    const code = new PythonTarget().compileFunction(loopBlock(), 'f', ['u']);
    expect(code).toContain('    for i in range(1, 4):');
    expect(code).toContain(
      'acc = [acc + _cse1 + _cse1 + _cse1 ** 2 for _cse1 in [np.sin(6 * u)]][0]'
    );
  });

  it('never binds across two statements of one Block', () => {
    // Both statements have the same right-hand side. If the statement LIST
    // bound, one temporary would serve both; it must be two.
    const expr = ce.box([
      'Block',
      ['Declare', 'y', 'number'],
      ['Declare', 'z', 'number'],
      ['Assign', 'y', probe3('u')],
      ['Assign', 'z', probe3('u')],
      ['Add', 'y', 'z'],
    ]);
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(2);
    expect(result.code).toContain('const _cse1 = Math.sin(6 * _.u)');
    expect(result.code).toContain('const _cse2 = Math.sin(6 * _.u)');
    parity(expr, { u: 0.3 });
  });

  it('does not hoist a candidate past a conditional `Return`', () => {
    // The candidate lives only in the statement AFTER the early exit. Its
    // binding must stay in that statement's own region.
    const expr = ce.box([
      'Block',
      ['Assign', 'acc', 0],
      [
        'Loop',
        [
          'Block',
          ['If', ['Less', 'u', 0], ['Return', 0]],
          ['Assign', 'acc', probe3('u')],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'acc',
    ]);
    const result = compile(expr, { fallback: false });

    expect(result.code).toContain('if (_.u < 0) { return 0 }');
    expect(result.code.indexOf('if (_.u < 0)')).toBeLessThan(
      result.code.indexOf('const _cse1')
    );
  });

  it('deduplicates inside a multi-statement lambda body', () => {
    const expr = ce.box([
      'Function',
      [
        'Block',
        ['Declare', 'y', 'number'],
        ['Assign', 'y', probe3('u')],
        ['Multiply', 'y', 2],
      ],
      'u',
    ]);
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse1')).toBe(1);
    expect(result.code).toContain('const _cse1 = Math.sin(6 * u)');
    expect(occurrences(result.code, 'Math.sin(6 * u)')).toBe(1);
    expect((result.run as (x: number) => number)(0.3)).toBeCloseTo(
      compile(expr, { fallback: false, cse: false }).run!(0.3) as number,
      12
    );
  });
});

/**
 * §5, §6.1 — DAG shapes. Harvest counts *edge-occurrences* (paths), and
 * emission resolves a candidate through the REGION, so one shared node object
 * reached from two regions is two candidates and gets two temporaries.
 */
describe('COMPILE CSE — DAG sharing', () => {
  /** ONE `sin(6u)` node object, reused everywhere below. */
  const shared = () => {
    const s = ce.box(sin6('u'));
    const arm = ce.function('Add', [ce.function('Square', [s]), s, s]);
    return { s, arm };
  };

  it('binds one shared node object once when it is reused within one region', () => {
    const { arm } = shared();
    const result = compile(arm, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(occurrences(result.code, 'Math.sin')).toBe(1);
    expect(occurrences(result.code, '_cse1')).toBe(4); // 1 binding + 3 uses
    parity(arm, { u: 0.3 });
  });

  it('gives one shared node object a separate temporary in each region', () => {
    const { s, arm } = shared();
    const expr = ce.function('Add', [
      ce.function('Square', [s]),
      s,
      s,
      ce.function('Which', [
        ce.parse('0 < x'),
        arm,
        ce.symbol('True'),
        ce.number(0),
      ]),
    ]);
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(2);
    expect(result.code).toContain('const _cse1 = Math.sin(6 * _.u)');
    expect(result.code).toContain('const _cse2 = Math.sin(6 * _.u)');
    // The arm's temporary is bound INSIDE the ternary branch.
    expect(result.code.indexOf('?')).toBeLessThan(
      result.code.indexOf('const _cse2')
    );
    parity(expr, { u: 0.3, x: 1 });
    parity(expr, { u: 0.3, x: -1 });
  });

  it('keeps the two differently-lazy operand positions of one construct apart', () => {
    // The SAME node object in both arms of an `If`: two lazy edges, two region
    // instances, two temporaries — the `compileOp` operand-index wiring.
    const { arm } = shared();
    const expr = ce.function('If', [ce.parse('0 < x'), arm, arm]);
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(2);
    expect(result.code).toContain('const _cse1 = Math.sin(6 * _.u)');
    expect(result.code).toContain('const _cse2 = Math.sin(6 * _.u)');
    // Neither binding is hoisted in front of the condition.
    expect(result.code.indexOf('?')).toBeLessThan(
      result.code.indexOf('const _cse1')
    );
    parity(expr, { u: 0.3, x: 1 });
    parity(expr, { u: 0.3, x: -1 });
  });
});

/**
 * §5.2 G3 — mutation. A candidate is dropped when any symbol it mentions is
 * the target of an `Assign`/`Declare` anywhere in its region's subtree,
 * descendant regions included. Deliberately conservative.
 */
describe('COMPILE CSE — mutation (G3)', () => {
  it('does not merge reads separated by a rebinding `Block`', () => {
    const expr = () =>
      ce.box([
        'Block',
        ['Declare', 'u', 'number'],
        ['Assign', 'u', 1],
        [
          'Add',
          ['Square', sin6('u')],
          ['Block', ['Assign', 'u', 2], 0],
          sin6('u'),
          sin6('u'),
        ],
      ]);
    const on = compile(expr(), { fallback: false });
    const off = compile(expr(), { fallback: false, cse: false });

    expect(on.code).not.toMatch(/_cse\d/);
    expect(on.code).toBe(off.code);
    expect((on.run as (v: any) => number)({})).toBe(
      (off.run as (v: any) => number)({})
    );
  });
});

/**
 * §5.2 steps 5–6 — subsumption and the post-filter.
 */
describe('COMPILE CSE — subsumption and the post-filter', () => {
  it('binds only the outer candidate when the counts match', () => {
    // `sin(6u)` and `sin(sin(6u))` both occur three times; every inner
    // occurrence sits inside an outer one, so only the outer binds.
    const nested = ['Sin', sin6('u')] as any;
    const expr = ce.box(['Add', nested, nested, nested]);
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(result.code).toBe(
      '(() => { const _cse1 = Math.sin(Math.sin(6 * _.u)); ' +
        'return _cse1 + _cse1 + _cse1; })()'
    );
  });

  it('emits no temporary when a region sees the subtree only once', () => {
    // Five occurrences in total — but one per `Which` arm, and every arm is its
    // own region, so no region reaches the same-region count of two.
    const expr = ce.box([
      'Which',
      ['Less', 0, 'x'],
      probe3('u'),
      ['Less', 1, 'x'],
      probe3('u'),
      'True',
      probe3('u'),
    ]);
    const result = compile(expr, { fallback: false });

    // Each arm's own three occurrences DO bind (three arms, three temps); no
    // temp is shared across arms.
    expect(occurrences(result.code, 'const _cse')).toBe(3);

    // …and a candidate that reaches a region only once binds nothing.
    const once = ce.box([
      'Which',
      ['Less', 0, 'x'],
      sin6('u'),
      ['Less', 1, 'x'],
      sin6('u'),
      'True',
      sin6('u'),
    ]);
    expect(compile(once, { fallback: false }).code).not.toMatch(/_cse\d/);
  });
});

/**
 * §6.3 — temp naming. Neither `_cse` nor `_tv` is a reserved prefix:
 * collisions are PREVENTED, not assumed away. Both allocators skip any name
 * the compilation already uses, whether CSE is on or off.
 */
describe('COMPILE CSE — name collisions', () => {
  it('does not capture a lambda parameter named `_cse1`', () => {
    const expr = ce.box(['Function', probe3('_cse1'), '_cse1']);
    const on = compile(expr, { fallback: false });
    const off = compile(expr, { fallback: false, cse: false });

    expect(on.code).toContain('const _cse2 = Math.sin(6 * _cse1)');
    expect(on.code).not.toMatch(/const _cse1\b/);
    expect(off.code).not.toMatch(/_cse\d\s*=/);
    expect((on.run as (x: number) => number)(0.3)).toBeCloseTo(
      (off.run as (x: number) => number)(0.3),
      12
    );
  });

  it('does not capture a lambda parameter named `_tv1`', () => {
    const expr = ce.box(['Function', probe3('_tv1'), '_tv1']);
    const result = compile(expr, { fallback: false });

    // `_cse1` is free here, so the CSE temp takes it; `_tv1` stays the param.
    expect(result.code).toBe(
      '(_tv1) => (() => { const _cse1 = Math.sin(6 * _tv1); ' +
        'return _cse1 + _cse1 + Math.pow(_cse1, 2); })()'
    );
    expect((result.run as (x: number) => number)(0.3)).toBeCloseTo(
      compile(expr, { fallback: false, cse: false }).run!(0.3) as number,
      12
    );
  });

  it('does not capture a Block local named `_cse1`', () => {
    const expr = ce.box([
      'Block',
      ['Declare', '_cse1', 'number'],
      ['Assign', '_cse1', 0.3],
      probe3('_cse1'),
    ]);
    const on = compile(expr, { fallback: false });

    expect(on.code).toContain('let _cse1;');
    expect(on.code).toContain('const _cse2 = Math.sin(6 * _cse1)');
    expect(on.code).not.toMatch(/const _cse1\b/);
    parity(expr);
  });

  it('does not capture a Match capture named `_tv1`', () => {
    // The pattern symbol `_tv1` is in the tree, so the generated name skips it.
    // (`Match` is CSE-inert, so the repeated body emits in full.)
    const expr = ce.box(['Match', 'x', ['MatchCase', '_tv1', probe3('tv1')]]);
    const on = compile(expr, { fallback: false });
    const off = compile(
      ce.box(['Match', 'x', ['MatchCase', '_tv1', probe3('tv1')]]),
      { fallback: false, cse: false }
    );

    expect(on.code).toContain('((_tv2) =>');
    expect(on.code).not.toMatch(/\b_tv1\b/);
    expect(on.code).toBe(off.code);
  });

  it('does not capture a Python parameter named `_cse1`', () => {
    const code = new PythonTarget().compileFunction(
      ce.box(probe3('_cse1')),
      'f',
      ['_cse1']
    );
    expect(code).toBe(
      'def f(_cse1):\n' +
        '    return [_cse2 + _cse2 + _cse2 ** 2 for _cse2 in [np.sin(6 * _cse1)]][0]\n'
    );
  });
});

/**
 * §5.2 G4 and §6.2 — the benefit threshold and the per-region binding cap.
 */
describe('COMPILE CSE — threshold and the per-region cap', () => {
  it('leaves a sub-threshold repeat inline', () => {
    // `sin(6u)` is size 4 but occurs only twice: score 4 < `CSE_MIN_SCORE`.
    const expr = ce.parse('\\sin(6u)+\\sin(6u)');
    const result = compile(expr, { fallback: false });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(result.code).toBe('Math.sin(6 * _.u) + Math.sin(6 * _.u)');
  });

  /** 40 distinct thrice-repeated candidates in ONE region. */
  const capped = () => {
    const terms: any[] = [];
    for (let k = 0; k < 40; k++) {
      const t = ['Sin', ['Multiply', k + 2, 'u']];
      terms.push(t, t, t);
    }
    return ce.box(['Add', ...terms]);
  };

  it('keeps the highest-scoring 32 candidates, deterministically', () => {
    const first = compile(capped(), { fallback: false }).code;
    const second = compile(capped(), { fallback: false }).code;

    expect(occurrences(first, 'const _cse')).toBe(32);
    expect(first).toContain('const _cse32 = Math.sin(33 * _.u)');
    expect(first).not.toContain('const _cse33');
    // Every score is equal here, so the tie-break is first-occurrence order:
    // coefficients 2…33 bind, 34…41 stay inline.
    expect(occurrences(first, 'Math.sin(34 * _.u)')).toBe(3);
    expect(second).toBe(first);
    parity(capped(), { u: 0.3 }, 9);
  });

  it('keeps the cap on the Python target too', () => {
    const code = new PythonTarget().compileToSource(capped());
    expect(occurrences(code, 'for _cse')).toBe(32);
    expect(code).toContain('for _cse32 in [np.sin(33 * u)]');
  });
});

/**
 * §5 — the deterministic per-bucket verification budget. A structural-hash
 * bucket that exhausts `CSE_MAX_VERIFY_NODES_PER_BUCKET` compared nodes is
 * dropped WHOLE: its occurrences emit inline, unchanged.
 *
 * Real collisions of the cached structural hash are not constructible by hand,
 * so the bucket is forced: an own `hash` property shadows the memoized getter
 * on 80 structurally distinct subtrees. The budget then runs out on the
 * quadratic `isSame` verification, and the whole compilation degrades to the
 * `cse: false` emission — a lost optimization, never a correctness change.
 */
describe('COMPILE CSE — harvest verification budget', () => {
  const collided = () => {
    const nodes: Expression[] = [];
    for (let k = 0; k < 80; k++) {
      const n = ce.box(['Sin', ['Multiply', k + 2, 'u']]);
      Object.defineProperty(n, 'hash', { value: 0x5eed, configurable: true });
      nodes.push(n, n, n);
    }
    return ce.function('Add', nodes);
  };

  it('drops the exhausted bucket whole, emitting the `cse: false` source', () => {
    const expr = collided();
    const on = compile(expr, { fallback: false }).code;
    const off = compile(expr, { fallback: false, cse: false }).code;

    expect(on).not.toMatch(/_cse\d/);
    expect(on).toBe(off);
  });

  it('is deterministic — two compiles of the collided tree agree', () => {
    const expr = collided();
    expect(compile(expr, { fallback: false }).code).toBe(
      compile(expr, { fallback: false }).code
    );
  });
});

/**
 * §7.2 — draw streams. Two occurrences of one `RandomChoice` subtree are
 * DIFFERENT draws (counter-based streams) and must never merge; the pure part
 * around them may. G1 excludes draws structurally, and G1b excludes
 * user-defined function applications, whose purity inference is documented
 * dependency-order-unsound.
 */
describe('COMPILE CSE — draw streams', () => {
  const seeded = () =>
    ce.box([
      'WithRandomSeed',
      42,
      [
        'List',
        ['Square', sin6('u')],
        sin6('u'),
        sin6('u'),
        ['At', ['RandomChoice', ['Range', 1, 1000000], 3], 1],
        ['At', ['RandomChoice', ['Range', 1, 1000000], 3], 2],
        ['At', ['RandomChoice', ['Range', 1, 1000000], 3], 3],
      ],
    ]);

  it('draws the same sequence with CSE on, off, and in the interpreter', () => {
    const on = compile(seeded(), { fallback: false });
    const off = compile(seeded(), { fallback: false, cse: false });

    // The pure repeat IS shared; the two draws are NOT.
    expect(occurrences(on.code, 'const _cse')).toBe(1);
    expect(occurrences(on.code, '_SYS.randomChoice')).toBe(3);

    const a = (on.run as (v: any) => number[])({ u: 0.3 });
    const b = (off.run as (v: any) => number[])({ u: 0.3 });
    const interpreted = seeded()
      .subs({ u: 0.3 })
      .N()
      .ops!.map((x) => x.re!);

    expect(a).toEqual(b);
    // Draw for draw — the three sampled positions, integers, not close-to.
    expect(a.slice(3)).toEqual(interpreted.slice(3));
    // …and the draws really are three DIFFERENT values (a merge would show up
    // as a repeated one).
    expect(new Set(a.slice(3)).size).toBe(3);
    for (let i = 0; i < 3; i++) expect(a[i]).toBeCloseTo(interpreted[i], 12);

    // Reseeded on every call: the same sequence again.
    expect((on.run as (v: any) => number[])({ u: 0.3 })).toEqual(a);
  });

  it('does not merge applications of a forward-referencing definition', () => {
    // `docs/EFFECTS-MODEL.md` §"Dependency-order inference is unsound", RULED
    // in v5 and implemented by the Stage 2 inference: `f() := g()` declared
    // BEFORE `g` exists sees an UNRESOLVED named head and infers `{any}` —
    // honest, at the cost of caching for forward references. (Stage 0 marked
    // it pure; that was hole 3.) The admission gate needs a RESOLVABLE pure
    // callee body, and `f`'s is impure through `g`, so two effectful calls can
    // never merge.
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('() \\mapsto g()'));
    engine.assign('g', engine.parse('() \\mapsto \\operatorname{Random}()'));

    // No longer falsely pure — the forward reference infers `{any}`:
    expect(engine.box(['f']).isPure).toBe(false);

    const expr = engine.box([
      'Add',
      ['Multiply', ['f'], ['f']],
      ['Multiply', ['f'], ['f']],
      ['Multiply', ['f'], ['f']],
    ]);
    const result = compile(expr, { fallback: false });

    expect(result.code).not.toMatch(/_cse\d/);
    // All six applications survive: no call count changed.
    expect(occurrences(result.code, '_fn_f()')).toBe(6);
  });
});

/**
 * §4.2, §4.3 — the option surface.
 */
describe('COMPILE CSE — options', () => {
  it('`cse: false` is byte-identical to a target with no `cseBind`', () => {
    // A target without the capability behaves exactly as `cse: false` — the
    // session is stamped `enabled: false` either way (§4.3).
    class NoCseBindTarget extends JavaScriptTarget {
      createTarget(
        options: Partial<CompileTarget<Expression>> = {}
      ): CompileTarget<Expression> {
        const target = super.createTarget(options);
        delete (target as { cseBind?: unknown }).cseBind;
        return target;
      }
    }
    const expr = ce.parse(PROBE_LATEX);
    const absent = new NoCseBindTarget().compile(expr).code;
    const off = new JavaScriptTarget().compile(expr, { cse: false }).code;

    expect(absent).toBe(off);
    expect(absent).not.toMatch(/_cse/);
  });

  it('a direct custom target never emits `_cse`, even carrying `cseBind`', () => {
    // §4.2: a direct target is caller-supplied code end to end. `cseBind`
    // attests binding SYNTAX, not that the target's other emitters are pure
    // and eager, and its resolvers carry no override provenance for G1b.
    const target = new JavaScriptTarget().createTarget();
    expect(typeof target.cseBind).toBe('function');

    const result = compile(ce.parse(PROBE_LATEX), { target, fallback: false });
    expect(result.code).not.toMatch(/_cse/);
    expect(occurrences(result.code, 'Math.sin')).toBe(3);
  });

  it('a REUSED caller-built direct target compiles identically twice', () => {
    const target = new JavaScriptTarget().createTarget();
    const first = compile(ce.parse(PROBE_LATEX), {
      target,
      fallback: false,
    }).code;
    const second = compile(ce.parse(PROBE_LATEX), {
      target,
      fallback: false,
    }).code;

    expect(second).toBe(first);
    expect(first).not.toMatch(/_cse/);
  });

  it('leaves a zero-candidate expression untouched', () => {
    for (const latex of ['x+y', '\\sin(x)+\\cos(x)', '2x^2+3x+1']) {
      const expr = ce.parse(latex);
      expect(compile(expr, { fallback: false }).code).toBe(
        compile(expr, { fallback: false, cse: false }).code
      );
    }
  });

  it('gives the Python no-options entries a default-enabled session', () => {
    // `compileFunction`/`compileLambda` take no options bag (a stated v1 gap):
    // they get a default-enabled session (§4.2).
    const python = new PythonTarget();
    const expr = ce.parse(PROBE_LATEX);

    expect(python.compileFunction(expr, 'f', ['u'])).toBe(
      'def f(u):\n' +
        '    return [_cse1 ** 2 + _cse1 / (_cse1 + 2) for _cse1 in [np.sin(6 * u)]][0]\n'
    );
    expect(python.compileLambda(expr, ['u'])).toBe(
      'lambda u: [_cse1 ** 2 + _cse1 / (_cse1 + 2) for _cse1 in [np.sin(6 * u)]][0]'
    );
  });
});

/**
 * §5.4 — the harvest boundary. A user-defined function's definition body is
 * emitted once, under its OWN nested harvest scope (own regions and
 * candidates, shared naming counter). The call sites belong to the ENCLOSING
 * harvest, which admits pure user-function applications too (item 120
 * follow-up), so a repeated call binds there — independently of, and without
 * disturbing, the body's own bindings.
 */
describe('COMPILE CSE — user-function body dedup', () => {
  const engineWithF = () => {
    const engine = new ComputeEngine();
    engine.assign(
      'f',
      engine.parse('x \\mapsto \\sin(6x)^2 + \\sin(6x) + \\sin(6x)')
    );
    return engine;
  };

  it('deduplicates inside the emitted `_fn_f`, independently of the call sites', () => {
    const engine = engineWithF();
    // The `Function`-literal route puts the emitted definitions in `code`.
    const expr = engine.parse('t \\mapsto f(t) + f(2t)');
    const result = compile(expr, { fallback: false });

    // ONE `Math.sin` in the whole artifact: the definition body deduplicated.
    expect(occurrences(result.code, 'Math.sin')).toBe(1);
    expect(result.code).toContain(
      'const _fn_f = (x) => (() => { const _cse1 = Math.sin(6 * x); ' +
        'return _cse1 + _cse1 + Math.pow(_cse1, 2); })()'
    );
    // …and the two call sites are still two calls: `f(t)` and `f(2t)` are
    // different expressions, so there is nothing to merge.
    expect(occurrences(result.code, '_fn_f(')).toBe(2);

    expect((result.run as (t: number) => number)(0.3)).toBeCloseTo(
      compile(engineWithF().parse('t \\mapsto f(t) + f(2t)'), {
        fallback: false,
        cse: false,
      }).run!(0.3) as number,
      12
    );
  });

  it('binds three identical call sites once', () => {
    const engine = engineWithF();
    const expr = engine.parse('t \\mapsto f(2t) + f(2t) + f(2t)');
    const result = compile(expr, { fallback: false });

    // ONE call for the three occurrences (item 120 follow-up), …
    expect(occurrences(result.code, '_fn_f(2 * t)')).toBe(1);
    // …plus the body's own binding: two temporaries in the artifact.
    expect(occurrences(result.code, 'const _cse')).toBe(2);
    // The body still deduplicates its three `sin(6x)`.
    expect(occurrences(result.code, 'Math.sin')).toBe(1);

    expect((result.run as (t: number) => number)(0.3)).toBeCloseTo(
      compile(engineWithF().parse('t \\mapsto f(2t) + f(2t) + f(2t)'), {
        fallback: false,
        cse: false,
      }).run!(0.3) as number,
      12
    );
  });

  it('keeps the definition value unchanged on the interval-js target', () => {
    // The interval target collects user-function definitions into the runner's
    // PREAMBLE, which the public `CompilationResult` does not expose — so the
    // body's dedup is asserted here by value parity, not by shape.
    const engine = engineWithF();
    const expr = () => engine.parse('f(2u)');
    const on = compile(expr(), { to: 'interval-js', fallback: false });
    const off = compile(expr(), {
      to: 'interval-js',
      fallback: false,
      cse: false,
    });
    const point = { lo: 0.3, hi: 0.3 };

    expect((on.run as any)({ u: point }).value).toEqual(
      (off.run as any)({ u: point }).value
    );
  });
});

/**
 * Item 120 — a repeated PURE user-function call inside an emitted definition
 * body binds once (`admitPureUserFunctions`, nested harvests only). The
 * flagship shape is a recursive definition: `R(i-1,…) + 0.5·S(…, R(i-1,…))`
 * evaluates 2^depth calls without the binding, `depth` calls with it. The
 * size/score heuristics do not apply to admitted calls (a call's runtime
 * cost is unrelated to its syntactic size), purity is the G1 gate (an
 * application of a `Random`-drawing function stays inert), and the binding
 * lands INSIDE the conditional arm, so a base case never evaluates the
 * recursive call.
 */
describe('COMPILE CSE — repeated pure calls in definition bodies (item 120)', () => {
  const engineWithR = () => {
    const engine = new ComputeEngine();
    engine.declare('S_0', '(number, number, number) -> number');
    engine.assign('S_0', engine.parse('(x,y,r)\\mapsto\\sin(xy)+0.1r'));
    engine.declare('R_0', '(number, number, number) -> number');
    engine.assign(
      'R_0',
      engine.parse(
        '(i,x,y)\\mapsto\\begin{cases}0&i=0\\\\R_0(i-1,x,y)+0.5S_0(x,y,R_0(i-1,x,y))&\\text{otherwise}\\end{cases}'
      )
    );
    return engine;
  };

  it('binds a repeated recursive self-call once, inside the conditional arm', () => {
    const engine = engineWithR();
    const result = compile(engine.parse('(t)\\mapsto R_0(20,t,0.7)'), {
      fallback: false,
    });

    // ONE self-call site in the emitted definition (plus the root call site).
    const def = result.code
      .split('\n')
      .find((l) => l.includes('const _fn_R_0'))!;
    expect(occurrences(def, '_fn_R_0(')).toBe(1);
    // The binding sits INSIDE the ternary's recursive arm: the base case
    // must not evaluate the recursive call.
    expect(def.indexOf('?')).toBeLessThan(def.indexOf('const _cse'));

    // Sharing makes depth 20 linear: 2^20 calls would be milliseconds; the
    // base case terminates (finite value, not a stack overflow).
    const v = (result.run as (t: number) => number)(0.3);
    expect(Number.isFinite(v)).toBe(true);

    // Value parity at a depth the un-CSE'd form can still afford.
    const parity = compile(engineWithR().parse('(t)\\mapsto R_0(10,t,0.7)'), {
      fallback: false,
    });
    const parityOff = compile(
      engineWithR().parse('(t)\\mapsto R_0(10,t,0.7)'),
      { fallback: false, cse: false }
    );
    expect((parity.run as (t: number) => number)(0.3)).toBeCloseTo(
      (parityOff.run as (t: number) => number)(0.3),
      12
    );
  });

  it('does not bind a repeated IMPURE call (two draws stay two draws)', () => {
    const engine = new ComputeEngine();
    engine.declare('D_0', '(number) -> number');
    engine.assign(
      'D_0',
      engine.parse('(n)\\mapsto n+\\operatorname{Random}()')
    );
    engine.declare('W_0', '(number) -> number');
    engine.assign('W_0', engine.parse('(t)\\mapsto D_0(t)+D_0(t)'));
    const result = compile(engine.parse('(u)\\mapsto W_0(u)'), {
      fallback: false,
    });
    const def = result.code
      .split('\n')
      .find((l) => l.includes('const _fn_W_0'))!;
    expect(occurrences(def, '_fn_D_0(')).toBe(2);
    expect(def).not.toContain('_cse');
  });

  it('binds a repeated pure call in a NON-recursive coloneq-defined body', () => {
    const engine = new ComputeEngine();
    engine
      .parse('h(i)\\coloneq\\operatorname{mod}(10^4\\sin(10^4i),1)')
      .evaluate();
    engine.parse('g(t)\\coloneq h(t)+h(t)^2').evaluate();
    const result = compile(engine.parse('(u)\\mapsto g(u)'), {
      fallback: false,
    });
    const def = result.code.split('\n').find((l) => l.includes('const _fn_g'))!;
    // The two h(t) occurrences share one binding.
    expect(occurrences(def, 'const _cse')).toBe(1);
  });

  it('does not merge a call whose callee body splices a string-`vars` entry', () => {
    // The call site is engine-pure, but the emitted `_fn_f_1` BODY contains
    // the live `next()` source the caller spliced through `vars` — merging
    // the two calls would evaluate it once instead of twice. The admission
    // gate must validate the resolved callee body, not just the call site.
    const engine = new ComputeEngine();
    engine.assign('f_1', engine.parse('(t)\\mapsto u+t'));
    engine.assign('g_1', engine.parse('(t)\\mapsto f_1(t)+f_1(t)^2'));
    const result = compile(engine.parse('(w)\\mapsto g_1(w)'), {
      vars: { u: 'next()' },
      functions: {},
      fallback: false,
    });
    const def = result.code
      .split('\n')
      .find((l) => l.includes('const _fn_g_1'))!;
    expect(occurrences(def, '_fn_f_1(')).toBe(2);
    expect(def).not.toContain('_cse');
  });

  it('does not merge through a stale installed signature (callee reassigned to draw)', () => {
    // `h_1`'s installed signature was inferred while `k_1` was pure; after
    // `k_1` is reassigned to draw, the `h_1`-APPLICATION node still reports
    // `isPure: true` (install-time staleness, one level removed). The
    // admission gate re-derives the callee body's purity against CURRENT
    // bindings, so the two `h_1` calls — each drawing through `k_1` — stay
    // two calls.
    const engine = new ComputeEngine();
    engine.assign('k_1', engine.parse('(n)\\mapsto n+1'));
    engine.assign('h_1', engine.parse('(t)\\mapsto k_1(t)+1'));
    engine.assign('m_1', engine.parse('(t)\\mapsto h_1(t)+h_1(t)^2'));
    engine.assign(
      'k_1',
      engine.parse('(n)\\mapsto n+\\operatorname{Random}()')
    );
    const result = compile(engine.parse('(w)\\mapsto m_1(w)'), {
      functions: {},
      fallback: false,
    });
    const def = result.code
      .split('\n')
      .find((l) => l.includes('const _fn_m_1'))!;
    expect(occurrences(def, '_fn_h_1(')).toBe(2);
    expect(def).not.toContain('_cse');
  });
});

/**
 * Item 120, follow-up — the ROOT harvest admits pure user-function
 * applications on the same terms as a definition-body harvest. A repeated
 * `f(x+1)` written directly by the caller is exactly the redundant call the
 * nested harvest already collapsed; the only reason it survived was the
 * conservative Phase-1 stance, not a soundness argument. The admission gate is
 * shared, so a drawing callee stays inert here too.
 */
describe('COMPILE CSE — repeated pure calls at the ROOT (item 120 follow-up)', () => {
  it('binds a repeated pure call once (assign route)', () => {
    const engine = new ComputeEngine();
    engine.assign('f_2', engine.parse('(t)\\mapsto\\sin(6t)+\\cos(t)'));
    const expr = engine.parse('f_2(x+1) + f_2(x+1)^2');
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    // The single call is the binding's initializer — no other call site.
    expect(occurrences(result.code, '_fn_f_2(')).toBe(1);
    expect(result.code).toContain('const _cse1 = _fn_f_2(');

    expect((result.run as (v: any) => number)({ x: 0.3 })).toBeCloseTo(
      compile(expr, { fallback: false, cse: false }).run!({
        x: 0.3,
      }) as number,
      12
    );
  });

  it('binds a repeated pure call once (coloneq route)', () => {
    // The `\coloneq` route mints an OPERATOR definition carrying a lambda
    // literal; the assign route stores a VALUE. Both resolve through
    // `userFnLiteralBody`.
    const engine = new ComputeEngine();
    engine.parse('f_3(t)\\coloneq\\sin(6t)+\\cos(t)').evaluate();
    const expr = engine.parse('f_3(x+1) + f_3(x+1)^2');
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(occurrences(result.code, '_fn_f_3(')).toBe(1);

    expect((result.run as (v: any) => number)({ x: 0.3 })).toBeCloseTo(
      compile(expr, { fallback: false, cse: false }).run!({
        x: 0.3,
      }) as number,
      12
    );
  });

  it('leaves a repeated DRAWING call as two calls at the root', () => {
    const engine = new ComputeEngine();
    engine.assign(
      'd_2',
      engine.parse('(t)\\mapsto t+\\operatorname{Random}()')
    );
    const result = compile(engine.parse('d_2(x+1) + d_2(x+1)^2'), {
      fallback: false,
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, '_fn_d_2(')).toBe(2);
  });
});

/**
 * The admission gates (`isAdmissibleUserFnCallee` and the named-callback
 * relaxation) resolve a NAME through engine-GLOBAL lookups
 * (`lookupDefinition` / `_getSymbolValue`). A name bound by an enclosing
 * binder — a lambda parameter, a definition parameter — denotes that binding,
 * not the global, so admitting it would validate the wrong callee's body.
 * Every such name is refused, fail closed: the harvester collects the binder
 * names of the tree it walks, and the compiler threads in the parameter names
 * of the definition whose body a NESTED harvest covers (§5.4).
 *
 * Two of the cases below never reach CSE any more. Since the user's 2026-08-14
 * ruling, a CALL whose head is a bound parameter has no lowering at all — the
 * compiler declines and the interpreter evaluates it — so for those shapes the
 * decline supersedes the merge question, and each test pins the decline. The
 * shapes where the shadowed name is an OPERAND rather than a head still
 * compile, and still pin that CSE leaves them unmerged.
 */
describe('COMPILE CSE — shadowed names are never admitted', () => {
  it('refuses a call whose HEAD is a lambda parameter', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('(t)\\mapsto \\sin(t)+t^2'));
    const source = '(f,x)\\mapsto f(x)+f(x)+f(x)';

    // CONTRACT: a head-position parameter must never resolve to a same-named
    // engine global. `f` here is the literal's own first parameter, so
    // `f(x)` applies whatever function the caller passes — the engine-level
    // `f` is a different function and is not what the three calls mean. The
    // compiler has no lowering for a call of a bound parameter, so it declines
    // and the interpreter (which resolves the parameter correctly as of
    // 2026-08-14) evaluates the expression instead.
    //
    // Ruled by the user 2026-08-14: fail closed now. Emitting a direct call of
    // the bound parameter — true higher-order compilation — remains a possible
    // future feature; until then, declining is the only answer that cannot be
    // wrong. Before the ruling the three calls emitted `_fn_f(…)` against the
    // GLOBAL `f`, so the compiled function silently ignored its own `f`
    // argument.
    //
    // CSE is not reached at all for this shape now (there is nothing to
    // merge), so the merge behavior this test used to pin no longer has a
    // subject; the decline supersedes it.
    expect(() => compile(engine.parse(source), { fallback: false })).toThrow(
      /^f: cannot compile/
    );

    // With the fallback allowed the result reports the decline rather than
    // carrying wrong code: nothing is emitted, and in particular nothing that
    // calls the global.
    const fallbackResult = compile(engine.parse(source));
    expect(fallbackResult.success).toBe(false);
    expect(fallbackResult.code).not.toContain('_fn_f');
  });

  it('refuses a named-callback OPERAND that is a lambda parameter', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('(t)\\mapsto \\sin(t)+t^2'));
    const mapped = ['Sum', ['Map', 'f', ['List', 1, 2, 3, 4]]];
    const expr = engine.box(['Function', ['Add', mapped, mapped], 'f'] as any);
    const result = compile(expr, { fallback: false });

    // Both traversals survive: the callback `f` is the PARAMETER, and the
    // global `f` the relaxation would have validated is a different function.
    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, '.map(')).toBe(2);

    // Call counts are preserved: 4 elements × 2 traversals.
    let calls = 0;
    const value = (result.run as (cb: (t: number) => number) => number)(
      (t: number) => {
        calls += 1;
        return t;
      }
    );
    expect(calls).toBe(8);
    expect(value).toBe(20);
  });

  it('refuses a callee that is a PARAMETER of the definition being emitted', () => {
    // `q_2` takes its callee as its FIRST parameter: `q_2 = (g_2, t) ↦
    // g_2(t) + g_2(t)²`. Inside that body `g_2` is the parameter, even though
    // an engine-level `g_2` of the same name exists — the same head-position
    // shadowing rule as above, one level down, where the shadowed name is a
    // parameter of the definition being EMITTED rather than of the expression
    // being compiled.
    //
    // The contract is therefore the same: the compiler has no lowering for a
    // call of a bound parameter, so emitting `_fn_q_2` fails closed and the
    // whole compilation declines; the interpreter evaluates it. Ruled by the
    // user 2026-08-14 (fail closed now; direct higher-order compilation is a
    // possible future feature). Before the ruling the two calls in the emitted
    // `_fn_q_2` body ran against the GLOBAL `_fn_g_2`, so the compiled
    // definition ignored its own first argument.
    const engine = new ComputeEngine();
    engine.assign('g_2', engine.parse('(t)\\mapsto \\sin(t)+t^2'));
    engine.assign(
      'q_2',
      engine.box([
        'Function',
        ['Add', ['g_2', 't'], ['Power', ['g_2', 't'], 2]],
        'g_2',
        't',
      ])
    );
    const source = '(h,v)\\mapsto q_2(h,v)';

    expect(() => compile(engine.parse(source), { fallback: false })).toThrow(
      /^g_2: cannot compile/
    );

    const fallbackResult = compile(engine.parse(source));
    expect(fallbackResult.success).toBe(false);
    expect(fallbackResult.code).not.toContain('_fn_g_2');
  });

  it('still merges an UNSHADOWED named callback (canary)', () => {
    const engine = new ComputeEngine();
    engine.assign('f', engine.parse('(t)\\mapsto \\sin(t)+t^2'));
    const mapped = ['Sum', ['Map', 'f', ['List', 1, 2, 3, 4]]];
    const result = compile(engine.box(['Add', mapped, mapped] as any), {
      fallback: false,
      constantFold: false,
    });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(occurrences(result.code, '.map(')).toBe(1);
  });
});

/**
 * The named-callback relaxation must be reachable for a callback whose
 * operand node carries a DECLARED function type. `CountIf(xs, p)` binds `p`
 * eagerly, so the symbol arrives typed (`(unknown) -> boolean`); testing the
 * operand's type before its literal would reject it before the relaxation
 * ever ran, and only the operand's `List` — not the repeated application —
 * would bind.
 */
describe('COMPILE CSE — typed named callback of an eager operator', () => {
  it('merges repeated `CountIf(xs, p)` with a PURE named predicate', () => {
    const engine = new ComputeEngine();
    engine.assign('p_1', engine.parse('(t)\\mapsto t>1'));
    const countIf = (): any => ['CountIf', ['List', 1, 2, 3, 4, 5], 'p_1'];
    const expr = engine.box([
      'Add',
      ['Square', countIf()],
      countIf(),
      countIf(),
    ] as any);
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    // The whole application binds once — not just its collection operand.
    expect(occurrences(result.code, '.filter(')).toBe(1);
    expect(result.code).toContain('const _cse1 = ((_f)');

    const off = compile(expr, {
      fallback: false,
      cse: false,
      constantFold: false,
    });
    expect((result.run as (v: any) => number)({})).toBe(
      (off.run as (v: any) => number)({})
    );
  });

  it('keeps a DRAWING typed named callback out', () => {
    const engine = new ComputeEngine();
    engine.assign(
      'p_2',
      engine.parse('(t)\\mapsto t+\\operatorname{Random}()>1')
    );
    const countIf = (): any => ['CountIf', ['List', 1, 2, 3, 4, 5], 'p_2'];
    const result = compile(
      engine.box(['Add', ['Square', countIf()], countIf(), countIf()] as any),
      { fallback: false }
    );

    expect(occurrences(result.code, '.filter(')).toBe(3);
  });

  it('merges repeated `CountIf(xs, Abs)` with a BUILT-IN predicate', () => {
    // The same relaxation for a callback naming a pure, fixed-arity built-in.
    // (`Abs` rather than `IsPrime`: the natural predicate has no JavaScript
    // lowering, so its wrapper body would fail closed before merging is even
    // reachable — see `compile.test.ts`.)
    const engine = new ComputeEngine();
    const countIf = (): any => ['CountIf', ['List', 1, 2, 3, 4, 5], 'Abs'];
    const expr = engine.box(['Add', countIf(), countIf(), countIf()] as any);
    const result = compile(expr, { fallback: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(occurrences(result.code, '.filter(')).toBe(1);

    const off = compile(expr, { fallback: false, cse: false });
    expect((result.run as (v: any) => number)({})).toBe(
      (off.run as (v: any) => number)({})
    );
  });

  it('routes a SHADOWED built-in name through the user-function gate', () => {
    // A user definition assigned over a built-in name is not identity-equal
    // to the system-scope binding, so the built-in provenance test refuses it
    // and the user-function relaxation (which validates the literal body)
    // owns the verdict.
    const engine = new ComputeEngine();
    engine.assign('Sin', engine.parse('x \\mapsto x + 1'));
    const mapped = ['Sum', ['Map', 'Sin', ['List', 1, 2, 3, 4, 5]]];
    const expr = engine.box(['Add', mapped, mapped] as any);
    const result = compile(expr, { fallback: false, constantFold: false });

    expect(occurrences(result.code, 'const _cse')).toBe(1);
    expect(result.code).not.toContain('Math.sin');
    // 2 × (2 + 3 + 4 + 5 + 6) — the USER definition, not the built-in.
    expect((result.run as (v: any) => number)({})).toBe(40);
  });
});

/**
 * §7.4 — error behavior at a guard edge. In `x ≠ 0 && f(1/x) && f(1/x)` the
 * repeated occurrences sit in a POST-GUARD region (`And`'s operands after the
 * first are lazy edges), so the binding is emitted behind the guard and the
 * short circuit still protects it.
 */
describe('COMPILE CSE — guard edge (§7.4)', () => {
  it('keeps a short-circuited guard short-circuiting', () => {
    const expr = ce.parse(
      'x \\ne 0 \\land \\sin(6u/x)^2 + \\sin(6u/x) + \\sin(6u/x) > 0'
    );
    const result = compile(expr, { fallback: false });

    // The binding is INSIDE the guarded operand.
    expect(result.code).toContain('const _cse1 = Math.sin((6 * _.u) / _.x)');
    expect(result.code.indexOf('&&')).toBeLessThan(
      result.code.indexOf('const _cse1')
    );

    // At `x = 0` the guarded operand evaluates NOTHING: a getter counts every
    // read of `u`, which only the guarded code performs.
    let reads = 0;
    const guarded = {
      x: 0,
      get u() {
        reads += 1;
        return 0.3;
      },
    };
    expect((result.run as (v: any) => boolean)(guarded)).toBe(false);
    expect(reads).toBe(0);

    // …and past the guard the value is unchanged.
    expect((result.run as (v: any) => boolean)({ x: 1, u: 0.3 })).toBe(
      compile(expr, { fallback: false, cse: false }).run!({
        x: 1,
        u: 0.3,
      }) as unknown as boolean
    );
  });
});

/**
 * §5.3 — non-scalar candidates and aliasing. Binding a `List`-valued candidate
 * makes every occurrence reference ONE shared runtime object. The invariant it
 * rests on — no `_SYS` / interval helper mutates its input — was audited before
 * landing; this pins it where it matters, by routing one shared array through
 * the two helpers that would otherwise sort/reverse in place.
 */
describe('COMPILE CSE — non-scalar aliasing', () => {
  const aliased = () =>
    ce.box([
      'Add',
      [
        'At',
        [
          'Sort',
          ['List', ['Sin', 'u'], ['Cos', 'u'], ['Sinh', 'u'], ['Cosh', 'u']],
        ],
        1,
      ],
      [
        'At',
        [
          'Reverse',
          ['List', ['Sin', 'u'], ['Cos', 'u'], ['Sinh', 'u'], ['Cosh', 'u']],
        ],
        1,
      ],
      [
        'At',
        ['List', ['Sin', 'u'], ['Cos', 'u'], ['Sinh', 'u'], ['Cosh', 'u']],
        1,
      ],
      [
        'At',
        ['List', ['Sin', 'u'], ['Cos', 'u'], ['Sinh', 'u'], ['Cosh', 'u']],
        2,
      ],
    ]);

  it('shares one array across Sort, Reverse and direct access without drift', () => {
    const expr = aliased();
    const on = compile(expr, { fallback: false });
    const off = compile(expr, { fallback: false, cse: false });

    // One temporary, the LIST itself.
    expect(on.code).toContain(
      'const _cse1 = [Math.sin(_.u), Math.cos(_.u), Math.sinh(_.u), Math.cosh(_.u)]'
    );
    expect(occurrences(on.code, '_cse1')).toBe(5); // 1 binding + 4 uses
    // The mutation-prone helpers copy first — the audited invariant, in the
    // emitted source.
    expect(on.code).toContain('(_cse1).slice().sort(');
    expect(on.code).toContain('(_cse1).slice().reverse(');

    for (const u of [0.7, -1.3, 0]) {
      const a = (on.run as (v: any) => number)({ u });
      expect(a).toBeCloseTo((off.run as (v: any) => number)({ u }), 12);
      expect(a).toBeCloseTo(expr.subs({ u }).N().re!, 12);
    }
  });

  it('is not reachable on the interval-js target (no collection lowering)', () => {
    // Recorded rather than skipped: the interval target has no `At`/`Sort`/
    // `Reverse` lowering at all, so a non-scalar candidate cannot be built for
    // it. The aliasing invariant is pinned above on the JS target, where the
    // audited `_SYS` helpers actually live.
    const result = compile(aliased(), { to: 'interval-js', fallback: false });
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/At: cannot compile/);
  });
});

/**
 * §7.6 — determinism, on every target: two compiles of one expression emit
 * byte-identical source. The expression below bears BOTH a CSE candidate and a
 * `tempVar()` temporary (a chained relation binds its shared middle operand),
 * so both allocators draw from the one naming counter.
 */
describe('COMPILE CSE — determinism across targets', () => {
  const CHAINED = `0 < ${PROBE_LATEX} < 10`;

  it.each(['javascript', 'interval-js'] as const)(
    'emits byte-identical source twice on %s',
    (to) => {
      const first = compile(ce.parse(CHAINED), { to, fallback: false }).code;
      const second = compile(ce.parse(CHAINED), { to, fallback: false }).code;

      expect(first).toContain('_cse1');
      expect(first).toContain('_tv2');
      expect(second).toBe(first);
    }
  );

  it('emits byte-identical source twice on python', () => {
    const python = new PythonTarget();
    const first = python.compileToSource(ce.parse(CHAINED));
    const second = python.compileToSource(ce.parse(CHAINED));

    expect(first).toContain('_cse1');
    expect(first).toContain('_tv2');
    expect(second).toBe(first);
  });

  it('emits byte-identical GLSL twice (naming context, no CSE)', () => {
    const first = glsl.compile(ce.parse(CHAINED)).code;
    const second = glsl.compile(ce.parse(CHAINED)).code;

    expect(first).not.toMatch(/_cse/);
    expect(second).toBe(first);
  });
});

/**
 * §8 pyexec — the Python target's emitted source is validated with the real
 * `ast` module, and (when a `python3` is on PATH) EXECUTED against a stub
 * `np` whose `sin` counts its calls. That is what proves the flat binding
 * comprehension `[body for _cse1 in [rhs1] for _cse2 in [rhs2]][0]` really
 * evaluates each right-hand side exactly once and makes earlier names visible
 * to later clauses — a shape no amount of source inspection can establish.
 *
 * The suite SKIPS, with a reason, when `python3` is unavailable. numpy is NOT
 * required: the harness supplies the `np.sin` the emitted source calls.
 */
const PYTHON3: string | undefined = (() => {
  try {
    execFileSync('python3', ['--version'], { stdio: 'ignore' });
    return 'python3';
  } catch {
    return undefined;
  }
})();

if (PYTHON3 === undefined)
  console.warn(
    'COMPILE CSE — Python emitted source: SKIPPED, no `python3` on PATH ' +
      '(the emitted-source shape assertions elsewhere still run).'
  );

const pyDescribe = PYTHON3 ? describe : describe.skip;

pyDescribe('COMPILE CSE — Python emitted source (pyexec)', () => {
  let dir: string;
  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'ce-cse-py-'));
  });
  // The scratch `.py` files are only inputs to `python3`; clean them up rather
  // than leaking a temp directory per run.
  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  /** `ast.parse` the emitted expression — a real Python parse, not a regexp. */
  const astParse = (source: string, name: string): void => {
    const file = join(dir, `${name}.py`);
    writeFileSync(file, `_ = (\n${source}\n)\n`);
    execFileSync(
      PYTHON3!,
      ['-c', 'import ast,sys; ast.parse(open(sys.argv[1]).read())', file],
      { stdio: 'pipe' }
    );
  };

  /**
   * Execute the emitted expression against a stub `np` that counts `sin`
   * calls, and return `{ calls, value }`.
   */
  const run = (
    source: string,
    name: string,
    bindings: string
  ): { calls: number; value: unknown } => {
    const file = join(dir, `${name}.py`);
    writeFileSync(
      file,
      [
        'import math, json',
        'class _NP:',
        '    def __init__(self): self.calls = 0',
        '    def sin(self, x):',
        '        self.calls += 1',
        '        return math.sin(x)',
        'np = _NP()',
        bindings,
        `_value = (\n${source}\n)`,
        'print(json.dumps({"calls": np.calls, "value": _value}))',
      ].join('\n') + '\n'
    );
    const out = execFileSync(PYTHON3!, [file], { encoding: 'utf-8' });
    return JSON.parse(out);
  };

  it('parses, and evaluates the bound right-hand side exactly once', () => {
    const source = new PythonTarget().compileToSource(ce.parse(PROBE_LATEX));
    astParse(source, 'probe');

    const { calls, value } = run(source, 'probe-run', 'u = 0.3');
    // ONE `np.sin` call for three occurrences — the point of the exercise.
    expect(calls).toBe(1);
    expect(value as number).toBeCloseTo(
      compile(ce.parse(PROBE_LATEX), { fallback: false }).run!({
        u: 0.3,
      }) as number,
      12
    );
  });

  it('keeps later binding clauses able to see earlier ones', () => {
    // `sin(6u)` occurs 3×, `cos(u)·sin(6u)²` 2×: two dependent temporaries, the
    // second referencing the first.
    const expr = ce.parse(
      '\\frac{\\sin(6u)^2\\cos(u)}{1+\\sin(6u)^2\\cos(u)} + \\sin(6u)'
    );
    const source = new PythonTarget().compileToSource(expr);
    expect(occurrences(source, 'for _cse')).toBe(2);
    expect(source.indexOf('for _cse1 in')).toBeLessThan(
      source.indexOf('for _cse2 in')
    );
    astParse(source, 'dependent');

    const { calls, value } = run(
      source,
      'dependent-run',
      'np.cos = math.cos\nu = 0.4'
    );
    expect(calls).toBe(1);
    expect(value as number).toBeCloseTo(
      compile(expr, { fallback: false }).run!({ u: 0.4 }) as number,
      12
    );
  });

  it('scopes a nested generator correctly (binder capture)', () => {
    // The outer clause's right-hand side reads the ENCLOSING `n`; the inner
    // `sum(… for n in range(…))` has its own Python scope.
    const expr = ce.parse(
      '\\sin(6n)^2+\\sin(6n)+\\sin(6n)+\\sum_{n=1}^{3}(\\sin(6n)^2+\\sin(6n)+\\sin(6n))'
    );
    const source = new PythonTarget().compileToSource(expr, {
      constantFold: false,
    });
    astParse(source, 'capture');

    const { calls, value } = run(source, 'capture-run', 'n = 0.3');
    // 1 for the outer temp + 9 inside the (undeduplicated) generator body.
    expect(calls).toBe(10);
    expect(value as number).toBeCloseTo(
      compile(expr, { fallback: false }).run!({ n: 0.3 }) as number,
      10
    );
  });

  it('emits a per-statement binding that parses and runs inside a def', () => {
    const expr = ce.box([
      'Block',
      ['Assign', 'acc', 0],
      [
        'Loop',
        ['Assign', 'acc', ['Add', 'acc', probe3('u')]],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      'acc',
    ]);
    const source = new PythonTarget().compileFunction(expr, 'f', ['u']);
    const file = join(dir, 'stmt.py');
    writeFileSync(
      file,
      [
        'import math, json',
        'class _NP:',
        '    def __init__(self): self.calls = 0',
        '    def sin(self, x):',
        '        self.calls += 1',
        '        return math.sin(x)',
        'np = _NP()',
        source,
        // `f` must run BEFORE `np.calls` is read: a dict literal evaluates its
        // values left to right.
        '_value = f(0.3)',
        'print(json.dumps({"calls": np.calls, "value": _value}))',
      ].join('\n') + '\n'
    );
    const out = JSON.parse(
      execFileSync(PYTHON3!, [file], { encoding: 'utf-8' })
    );
    // Three iterations, ONE `np.sin` per iteration.
    expect(out.calls).toBe(3);
    // Three accumulated iterations of the deduplicated right-hand side.
    expect(out.value as number).toBeCloseTo(
      3 *
        (compile(ce.box(probe3('u')), { fallback: false }).run!({
          u: 0.3,
        }) as number),
      12
    );
  });

  it('keeps a 32-binding stress source within the Python parser', () => {
    // The per-region cap (§6.2) exists so a many-candidate region cannot grow
    // source past what the parser accepts. The FLAT comprehension form is what
    // keeps the nesting depth constant.
    const terms: any[] = [];
    for (let k = 0; k < 40; k++) {
      const t = ['Sin', ['Multiply', k + 2, 'u']];
      terms.push(t, t, t);
    }
    const source = new PythonTarget().compileToSource(
      ce.box(['Add', ...terms])
    );
    expect(occurrences(source, 'for _cse')).toBe(32);
    astParse(source, 'stress');

    const { calls, value } = run(source, 'stress-run', 'u = 0.3');
    // 32 bound right-hand sides + 8 uncapped candidates emitted inline (3× each).
    expect(calls).toBe(32 + 8 * 3);
    expect(value as number).toBeCloseTo(
      compile(ce.box(['Add', ...terms]), { fallback: false }).run!({
        u: 0.3,
      }) as number,
      9
    );
  });
});

/**
 * §5.1(b) — one test per `LAZY_OPERANDS` entry, plus the chained relation the
 * table cannot name (it lowers to `(a<m) && (m<b)` with no `And` node in the
 * boxed tree). Each pins BOTH the laziness and the region behavior: the
 * binding must be emitted INSIDE the conditional position, never hoisted in
 * front of it. Drift between the table and an emitter's actual laziness shows
 * up here.
 */
describe('COMPILE CSE — conditionality, per lazy-operand entry', () => {
  /** The index at which the guarded region begins in the emitted source. */
  const guardAt = (code: string, marker: string): number =>
    code.indexOf(marker);

  it.each([
    ['If (value arms)', ce.box(['If', ['Less', 'x', 0], probe3('u'), 0]), '?'],
    [
      'When (the value arm)',
      ce.box(['When', probe3('u'), ['Less', 'x', 0]]),
      '?',
    ],
    [
      'And (operands after the first)',
      ce.box(['And', ['Less', 'x', 0], ['Less', 0, probe3('u')]]),
      '&&',
    ],
    [
      'Or (operands after the first)',
      ce.box(['Or', ['Less', 'x', 0], ['Less', 0, probe3('u')]]),
      '||',
    ],
    [
      'Coalesce (the default)',
      ce.box(['Coalesce', 'x', probe3('u')]),
      'Number.isNaN',
    ],
    [
      'chained relation (comparison after the first)',
      ce.box(['Less', 0, 'x', probe3('u')]),
      '&&',
    ],
  ])('binds inside the conditional position: %s', (_name, expr, marker) => {
    const result = compile(expr as Expression, { fallback: false });

    expect(occurrences(result.code, 'const _cse1')).toBe(1);
    expect(occurrences(result.code, 'Math.sin(6 * _.u)')).toBe(1);
    // The binding sits AFTER the construct's conditional marker.
    expect(guardAt(result.code, marker as string)).toBeGreaterThanOrEqual(0);
    expect(guardAt(result.code, marker as string)).toBeLessThan(
      result.code.indexOf('const _cse1')
    );
  });

  it('never evaluates the guarded region when the guard decides', () => {
    // One probe per short-circuiting entry: a getter counts every read of `u`,
    // which only the guarded code performs.
    const cases: Array<[string, Expression, Record<string, unknown>]> = [
      ['If', ce.box(['If', ['Less', 'x', 0], probe3('u'), 0]), { x: 1 }],
      [
        'And',
        ce.box(['And', ['Less', 'x', 0], ['Less', 0, probe3('u')]]),
        { x: 1 },
      ],
      [
        'Or',
        ce.box(['Or', ['Less', 'x', 0], ['Less', 0, probe3('u')]]),
        { x: -1 },
      ],
      ['Coalesce', ce.box(['Coalesce', 'x', probe3('u')]), { x: 1 }],
    ];
    for (const [name, expr, base] of cases) {
      const run = compile(expr, { fallback: false }).run as (v: any) => unknown;
      let reads = 0;
      run({
        ...base,
        get u() {
          reads += 1;
          return 0.3;
        },
      });
      expect(`${name}:${reads}`).toBe(`${name}:0`);
    }
  });
});

/**
 * §5.2 G1b — emission purity. `isPure` describes the boxed operator, not the
 * emitted code. A subtree that resolves through a caller-supplied mapping
 * splices LIVE SOURCE whose evaluation count the engine does not control, and
 * a subtree BELOW such a mapping is evaluated as often (or as seldom) as the
 * custom emitter chooses. Neither may count toward a candidate.
 */
describe('COMPILE CSE — emission purity (G1b), caller mappings', () => {
  const overridden = (op: string) =>
    ce.box([
      'Add',
      ['Square', [op, ['Multiply', 6, 'u']]],
      [op, ['Multiply', 6, 'u']],
      [op, ['Multiply', 6, 'u']],
    ]);

  it('never binds a subtree that resolves through a `functions` mapping', () => {
    const result = compile(overridden('Sin'), {
      fallback: false,
      functions: { Sin: 'mySin' },
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, 'mySin(6 * _.u)')).toBe(3);
  });

  it('never binds an occurrence BELOW a caller-mapped operator', () => {
    // The mapping is on the enclosing `Foo`; the repeated `sin(6u)` beneath it
    // does not count, because the custom emitter controls how often — or
    // whether — everything beneath it evaluates.
    const result = compile(ce.box(['Foo', probe3('u')]), {
      fallback: false,
      functions: { Foo: 'myFoo' },
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, 'Math.sin(6 * _.u)')).toBe(3);
  });

  it('never binds a subtree containing a STRING-valued `vars` entry', () => {
    const result = compile(ce.parse(PROBE_LATEX), {
      fallback: false,
      vars: { u: 'Math.PI/4' },
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, 'Math.sin(6 * Math.PI/4)')).toBe(3);
  });

  it('does not collide with a `_cse1` a caller splice introduces', () => {
    // §4.1/§6.3: the collision inventory includes `_tv`/`_cse` tokens found in
    // caller-supplied source strings, so the generated temp skips `_cse1`.
    const result = compile(ce.parse(PROBE_LATEX), {
      fallback: false,
      preamble: 'const _cse1 = 1;',
    });

    expect(result.code).toContain('const _cse2 = Math.sin(6 * _.u)');
    expect(result.code).not.toMatch(/const _cse1\b/);
  });
});

/**
 * G1b, second provenance channel: a per-operator `compile` handler on the
 * operator DEFINITION (`ce.declare(name, { compile })`).
 * `BaseCompiler.compileExpr` consults it before any built-in mapping and
 * splices whatever source it returns, exactly like a caller-supplied
 * `functions` entry — while an operator definition defaults to `pure: true`,
 * so G1 does not catch it. The head is therefore ineligible AND everything
 * beneath it is under-mapped.
 *
 * The clause is about CALLER-supplied handlers only — see the built-in
 * exemption block below (2026-08-01).
 */
describe('COMPILE CSE — emission purity (G1b), per-operator compile handlers', () => {
  /** A fresh engine whose `Quadrance` carries a custom compile handler. */
  const withHandler = (): ComputeEngine => {
    const e = new ComputeEngine();
    e.declare('Quadrance', {
      signature: '(number, number) -> number',
      compile: (args, c, { language }) =>
        language === 'javascript'
          ? `((${c(args[0])})**2 + (${c(args[1])})**2)`
          : undefined,
    });
    return e;
  };

  it('never binds a subtree whose head carries a `compile` handler', () => {
    const e = withHandler();
    const call = (): any => ['Quadrance', ['Multiply', 6, 'u'], 'u'];
    const result = compile(e.box(['Add', call(), call(), call()]), {
      fallback: false,
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, '((6 * _.u)**2 + (_.u)**2)')).toBe(3);
  });

  it('never binds an occurrence BELOW a head with a `compile` handler', () => {
    // The handler controls how often — or whether — its operands are emitted,
    // so the repeated `sin(6u)` beneath it does not count toward a candidate.
    const e = withHandler();
    const result = compile(e.box(['Quadrance', probe3('u'), 0]), {
      fallback: false,
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, 'Math.sin(6 * _.u)')).toBe(3);
  });
});

/**
 * §5.2 G1b — the BUILT-IN exemption (2026-08-01).
 *
 * The definition-`compile`-handler clause above exists because
 * `ce.declare(name, { compile })` is the same caller-supplied splice channel
 * as a `functions` entry: the emitted code's purity is unknowable. A BUILT-IN
 * definition's handler (`PointList`, `ListFrom`, …) is engine-authored,
 * deterministic, effect-free emission — exactly like the built-in TABLE
 * mappings (`Sin`, `Add`), which were never under-mapped nor ineligible.
 * Hoisting a pure subtree across a built-in table emission is already
 * sanctioned; a built-in definition handler is the same trust class. G1
 * (`isPure`) independently excludes impure heads, so the exemption rides on
 * the same purity guarantee the table path always relied on.
 *
 * Provenance is decided by OBJECT IDENTITY against the system-scope binding,
 * never by name — a user definition shadowing a built-in name is not the
 * system binding, so it stays ineligible.
 */
describe('COMPILE CSE — emission purity (G1b), built-in compile handlers', () => {
  const listEngine = (): ComputeEngine => {
    const e = new ComputeEngine();
    e.declare('u', 'number');
    e.declare('n', 'list<number>');
    return e;
  };

  it('binds a repeated subtree whose head carries a BUILT-IN `compile` handler', () => {
    const e = listEngine();
    const pl = (): any => ['PointList', sin6('u'), 'n'];
    const expr = e.box(['List', pl(), pl(), pl()] as any);
    const on = compile(expr, { fallback: false });
    const off = compile(expr, { fallback: false, cse: false });

    // The whole `PointList` construction is bound once…
    expect(on.code).toMatch(/const _cse\d+ = \(\(\) => \{[\s\S]*PointList:/);
    // …so exactly ONE zip loop is emitted instead of three.
    expect(occurrences(on.code, 'new Array(')).toBe(1);
    expect(occurrences(off.code, 'new Array(')).toBe(3);
    expect(off.code).not.toContain('_cse');

    const state = { u: 0.25, n: [1, 2, 3] };
    expect((on.run as (s: any) => unknown)(state)).toEqual(
      (off.run as (s: any) => unknown)(state)
    );
  });

  it('harvests occurrences BELOW a built-in `compile` handler', () => {
    // No longer under-mapped: the repeated `sin(6u)` inside the point lists
    // counts toward a candidate.
    const e = listEngine();
    const pl = (): any => ['PointList', probe3('u'), 'n'];
    const on = compile(e.box(['List', pl(), 0] as any), { fallback: false });

    expect(on.code).toMatch(/const _cse\d+ = Math\.sin\(6 \* _\.u\)/);
    expect(occurrences(on.code, 'Math.sin(6 * _.u)')).toBe(1);
  });

  it('a user `compile` handler SHADOWING a built-in NAME is still ineligible', () => {
    // The identity test, not a name test: `Sin` is a built-in name, but the
    // definition carrying the handler is the user's, declared in a non-system
    // scope — so it is NOT the system-scope binding and stays ineligible.
    const e = new ComputeEngine();
    e.declare('u', 'number');
    e.declare('Sin', {
      signature: '(number) -> number',
      compile: (args, c, { language }) =>
        language === 'javascript' ? `mySin(${c(args[0])})` : undefined,
    });

    const result = compile(e.box(probe3('u')), { fallback: false });
    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, 'mySin(6 * _.u)')).toBe(3);
  });

  it('an IMPURE subtree under a built-in `compile` handler still never binds', () => {
    // The load-bearing interaction: the exemption relies entirely on G1. Three
    // `PointList`s over four draws each stay three independent draw sequences.
    const e = listEngine();
    const draws = (): any => [
      'Add',
      ['Random'],
      ['Random'],
      ['Random'],
      ['Random'],
    ];
    const pl = (): any => ['PointList', draws(), 'n'];
    const result = compile(e.box(['List', pl(), pl(), pl()] as any), {
      fallback: false,
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, '_SYS.drawNextRandomNumber()')).toBe(12);
    expect(occurrences(result.code, 'new Array(')).toBe(3);
  });
});

/**
 * §5.2 G1b — the built-in exemption vs. a CALLER-supplied library.
 *
 * A `LibraryDefinition` object passed to the constructor's `libraries` option
 * is installed in the SYSTEM scope, exactly like a standard library
 * (`bootstrapLibraries` runs between `pushScope('system')` and
 * `pushScope('global')`). Scope identity alone would therefore classify a
 * caller-authored `compile` handler as engine-authored and exempt it — the
 * exact unsoundness G1b prevents. Provenance is recorded at bootstrap
 * (`engine._customLibraryOperators`) by OBJECT IDENTITY against
 * `STANDARD_LIBRARIES`, so re-passing a standard entry (by reference or by
 * name) stays standard while a caller's own library is custom.
 */
describe('COMPILE CSE — emission purity (G1b), caller-supplied libraries', () => {
  /** A caller-authored library whose `Quadrance` splices custom source. */
  const customLibrary = (): any => ({
    name: 'cse-caller-library',
    definitions: {
      Quadrance: {
        signature: '(number, number) -> number',
        compile: (args: any, c: any, { language }: any) =>
          language === 'javascript'
            ? `((${c(args[0])})**2 + (${c(args[1])})**2)`
            : undefined,
      },
    },
  });

  it('never binds a subtree whose head comes from a CALLER-supplied library', () => {
    const e = new ComputeEngine({
      libraries: [...ComputeEngine.getStandardLibrary(), customLibrary()],
    });
    e.declare('u', 'number');
    const call = (): any => ['Quadrance', ['Multiply', 6, 'u'], 'u'];
    const result = compile(e.box(['Add', call(), call(), call()]), {
      fallback: false,
    });

    expect(result.code).not.toMatch(/_cse\d/);
    expect(occurrences(result.code, '((6 * _.u)**2 + (_.u)**2)')).toBe(3);
  });

  it('keeps built-ins exempt when the standard libraries are named explicitly', () => {
    const e = new ComputeEngine({
      libraries: ComputeEngine.getStandardLibrary().map((lib) => lib.name),
    });
    e.declare('u', 'number');
    e.declare('n', 'list<number>');
    const pl = (): any => ['PointList', sin6('u'), 'n'];
    const on = compile(e.box(['List', pl(), pl(), pl()] as any), {
      fallback: false,
    });

    expect(on.code).toMatch(/const _cse\d+ = \(\(\) => \{[\s\S]*PointList:/);
    expect(occurrences(on.code, 'new Array(')).toBe(1);
  });
});
