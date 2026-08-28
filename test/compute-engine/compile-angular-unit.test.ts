/**
 * Angular-unit support in compilation targets, and the evaluate() contract it
 * relies on.
 *
 * Contract (see `compilation/angular-unit.ts`):
 * - Direct trig (`Sin`…`Csc`) interprets its argument in `ce.angularUnit`.
 * - Inverse trig (`Arcsin`…`Arccsc`, `Arctan2`) returns an angle in
 *   `ce.angularUnit` — exactly when possible (deg mode: `arcsin(1)` → `90`).
 * - Hyperbolic and inverse hyperbolic functions are unit-INDEPENDENT (their
 *   argument/result is dimensionless, not an angle).
 * - Compiled output (all targets) agrees with `evaluate()`/`.N()`.
 */

import { ComputeEngine } from '../../src/compute-engine';

function degEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.angularUnit = 'deg';
  return ce;
}

describe('ANGULAR UNIT — evaluate() contract', () => {
  test('deg: exact inverse trig returns exact degrees (matches .N())', () => {
    const ce = degEngine();
    expect(ce.parse('\\arcsin(1)').evaluate().json).toEqual(90);
    expect(ce.parse('\\arctan(1)').evaluate().json).toEqual(45);
    expect(ce.parse('\\arccos(\\frac12)').evaluate().json).toEqual(60);
    expect(ce.parse('\\arcsin(1)').N().re).toBeCloseTo(90, 10);
  });

  test('grad/turn: exact inverse trig in the current unit', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'grad';
    expect(ce.parse('\\arcsin(1)').evaluate().json).toEqual(100);
    ce.angularUnit = 'turn';
    expect(ce.parse('\\arcsin(1)').evaluate().toString()).toEqual('1/4');
  });

  test('rad: exact inverse trig unchanged (π-based)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\arcsin(1)').evaluate().toString()).toEqual('1/2 * pi');
  });

  test('deg: Arctan2 is consistent with Arctan in every quadrant', () => {
    const ce = degEngine();
    expect(ce.box(['Arctan2', 1, 1]).evaluate().json).toEqual(45);
    expect(ce.box(['Arctan2', 1, -1]).evaluate().json).toEqual(135);
    expect(ce.box(['Arctan2', -1, -1]).evaluate().json).toEqual(-135);
    expect(ce.box(['Arctan2', 0, -2]).evaluate().json).toEqual(180);
    expect(ce.box(['Arctan2', 3, 0]).evaluate().json).toEqual(90);
    expect(ce.box(['Arctan2', 1, 1]).N().re).toBeCloseTo(45, 10);
  });

  test('rad: Arctan2 unchanged (π-based)', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Arctan2', 1, 1]).evaluate().toString()).toEqual(
      '1/4 * pi'
    );
    expect(ce.box(['Arctan2', 1, -1]).evaluate().toString()).toEqual(
      '3/4 * pi'
    );
  });

  test('deg: hyperbolics are unit-independent', () => {
    const ce = degEngine();
    expect(ce.parse('\\sinh(1)').N().re).toBeCloseTo(Math.sinh(1), 10);
    expect(ce.parse('\\cosh(2)').N().re).toBeCloseTo(Math.cosh(2), 10);
    expect(ce.parse('\\tanh(3)').N().re).toBeCloseTo(Math.tanh(3), 10);
    expect(ce.parse('\\coth(2)').N().re).toBeCloseTo(1 / Math.tanh(2), 10);
    expect(ce.parse('\\operatorname{sech}(1)').N().re).toBeCloseTo(
      1 / Math.cosh(1),
      10
    );
    expect(ce.parse('\\operatorname{csch}(1)').N().re).toBeCloseTo(
      1 / Math.sinh(1),
      10
    );
  });

  test('deg: inverse hyperbolics are unit-independent', () => {
    const ce = degEngine();
    expect(ce.parse('\\operatorname{arsinh}(1)').N().re).toBeCloseTo(
      Math.asinh(1),
      10
    );
    expect(ce.parse('\\operatorname{arcosh}(2)').N().re).toBeCloseTo(
      Math.acosh(2),
      10
    );
    expect(ce.parse('\\operatorname{artanh}(0.5)').N().re).toBeCloseTo(
      Math.atanh(0.5),
      10
    );
  });
});

describe('ANGULAR UNIT — compiled output agrees with evaluate()', () => {
  test('deg: javascript target — direct trig args are scaled', () => {
    const ce = degEngine();
    const js = ce._getCompilationTarget('javascript')!;
    const run = js.compile(ce.parse('\\sin(x)')).run!;
    expect(run({ x: 90 })).toBeCloseTo(1, 12);
    expect(run({ x: 30 })).toBeCloseTo(0.5, 12);
    // Agreement with the interpreter:
    expect(run({ x: 37 })).toBeCloseTo(ce.parse('\\sin(37)').N().re, 12);
  });

  test('deg: javascript target — inverse trig results are scaled', () => {
    const ce = degEngine();
    const js = ce._getCompilationTarget('javascript')!;
    expect(js.compile(ce.parse('\\arcsin(x)')).run!({ x: 1 })).toBeCloseTo(
      90,
      10
    );
    expect(js.compile(ce.parse('\\arctan(x)')).run!({ x: 1 })).toBeCloseTo(
      45,
      10
    );
    const atan2 = js.compile(
      ce.box(['Arctan2', ce.symbol('y'), ce.symbol('x')])
    ).run!;
    expect(atan2({ y: 1, x: 1 })).toBeCloseTo(45, 10);
    expect(atan2({ y: 1, x: -1 })).toBeCloseTo(135, 10);
  });

  test('deg: hyperbolics compile without scaling', () => {
    const ce = degEngine();
    const js = ce._getCompilationTarget('javascript')!;
    const r = js.compile(ce.parse('\\sinh(x)'));
    expect(r.code).toBe('Math.sinh(_.x)');
    expect(r.run!({ x: 1 })).toBeCloseTo(Math.sinh(1), 12);
  });

  test('deg: interval-js target', () => {
    const ce = degEngine();
    const ijs = ce._getCompilationTarget('interval-js')!;
    const r = ijs.compile(ce.parse('\\sin(x)')).run!({ x: 90 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeCloseTo(1, 10);
    expect(r.value.hi).toBeCloseTo(1, 10);
  });

  test('deg: glsl target emits scaled radian-based code', () => {
    const ce = degEngine();
    const glsl = ce._getCompilationTarget('glsl')!;
    expect(glsl.compile(ce.parse('\\sin(x)')).code).toContain(
      'sin(0.017453292519943295 * x)'
    );
    expect(glsl.compile(ce.parse('\\arctan(x)')).code).toContain(
      '57.29577951308232 * atan(x)'
    );
  });

  test('grad and turn: javascript target', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'grad';
    const js = ce._getCompilationTarget('javascript')!;
    expect(js.compile(ce.parse('\\sin(x)')).run!({ x: 100 })).toBeCloseTo(
      1,
      12
    );
    ce.angularUnit = 'turn';
    expect(js.compile(ce.parse('\\sin(x)')).run!({ x: 0.25 })).toBeCloseTo(
      1,
      12
    );
  });

  test('deg: Haversine/InverseHaversine agree with evaluate()', () => {
    // Haversine evaluates as ½(1−cos z) (angle argument); InverseHaversine as
    // 2·arcsin(√z) (angle result). Compiled code must scale the same way.
    const ce = degEngine();
    const js = ce._getCompilationTarget('javascript')!;
    expect(
      js.compile(ce.box(['Haversine', ce.symbol('x')])).run!({ x: 30 })
    ).toBeCloseTo(ce.box(['Haversine', 30]).N().re, 10);
    // InverseHaversine types `complex` for a symbolic real (honest
    // domain join, like the Arcsin family — it is complex outside [0, 1]),
    // so the compiled arithmetic is complex; the angle scaling applies
    // linearly to the complex value, matching `radiansToAngle`. In domain the
    // value is real, and the runner's result convention (design §5,
    // 2026-08-16) hands it back as a plain NUMBER — the kernel chops its
    // roundoff dust and an exactly-zero imaginary part is dropped.
    const inv = js.compile(ce.box(['InverseHaversine', ce.symbol('x')])).run!({
      x: 0.5,
    });
    expect(typeof inv).toBe('number');
    expect(inv).toBeCloseTo(90, 10);
    // Out of domain the compiled value is genuinely complex, agreeing with
    // the interpreter (2.0634… rad scaled by 180/π).
    const out = js.compile(ce.box(['InverseHaversine', ce.symbol('x')])).run!({
      x: 2.5,
    });
    expect(out.re).toBeCloseTo(180, 10);
    expect(out.im).toBeCloseTo(
      ce.box(['InverseHaversine', 2.5]).N().im,
      10
    );
  });

  test('rad: no rewrite (codegen unchanged)', () => {
    const ce = new ComputeEngine();
    const js = ce._getCompilationTarget('javascript')!;
    expect(js.compile(ce.parse('\\sin(x)')).code).toBe('Math.sin(_.x)');
    expect(js.compile(ce.parse('\\arcsin(x)')).code).toBe('Math.asin(_.x)');
  });

  test('deg: composite expression (Fourier-style sum) agrees with .N()', () => {
    const ce = degEngine();
    const js = ce._getCompilationTarget('javascript')!;
    const latex = '\\sum_{k=1}^{3} \\frac{\\sin(k x)}{k}';
    const run = js.compile(ce.parse(latex)).run!;
    const interp = ce
      .box(['Sum', ['Divide', ['Sin', ['Multiply', 'k', 25]], 'k'], ['Limits', 'k', 1, 3]])
      .N().re;
    expect(run({ x: 25 })).toBeCloseTo(interp, 10);
  });
});

//
// ── Symbolic derivatives ────────────────────────────────────────────────
//
// `Sin(x)` denotes `sin(k·x)` in a non-radian unit, so its derivative carries
// the chain factor `k` (`π/180` in degree mode). Every route must produce it:
// the BY-REFERENCE path (`f'` over a function literal assigned to `f`) used to
// miss it in both the interpreter and the compiler, while the INLINE Leibniz
// path (`d/dx sin x`) only got it in compiled code — by accident of the
// entry-point rewrite running before the differentiation (Tycho 0.100.0
// adoption item 6).
//
// Each engine is created fresh, so `angularUnit` never leaks between tests.
//

/** An engine with `f := x ↦ sin x` declared. */
function fEngine(unit: 'rad' | 'deg'): ComputeEngine {
  const ce = new ComputeEngine();
  ce.angularUnit = unit;
  ce.parse('f \\coloneq x \\mapsto \\sin x').evaluate();
  return ce;
}

/** `d/dx sin x` as an inert Leibniz derivative. */
function inlineD(ce: ComputeEngine) {
  return ce.box(['D', ['Sin', 'x'], 'x']);
}

describe('ANGULAR UNIT — symbolic derivative (by-reference vs inline)', () => {
  // sin(k·x)' = k·cos(k·x), sampled at 0 and at the quarter turn.
  const CASES = [
    { unit: 'rad' as const, k: 1, points: [0, Math.PI / 2, 0.5] },
    { unit: 'deg' as const, k: Math.PI / 180, points: [0, 90, 30] },
  ];

  for (const { unit, k, points } of CASES) {
    test(`${unit}: interpreted — f'(x) and d/dx sin x agree with k·cos(k·x)`, () => {
      const ce = fEngine(unit);
      // The two closed forms are the same expression. Compared as MathJSON:
      // applying a lambda re-nests a rational-coefficient product
      // (`1/180·(π·cos x)` vs `1/180·π·cos x`), which `isSame` sees but the
      // associative MathJSON serialization does not — a pre-existing quirk of
      // the apply path, unrelated to angular units.
      const byRef = ce.parse("f'(x)").evaluate();
      const inline = inlineD(ce).evaluate();
      expect(byRef.json).toEqual(inline.json);

      for (const p of points) {
        const expected = k * Math.cos(k * p);
        expect(ce.parse(`f'(${p})`).N().re).toBeCloseTo(expected, 12);
        expect(inline.subs({ x: p }).N().re).toBeCloseTo(expected, 12);
      }
    });

    test(`${unit}: compiled — f'(x) and d/dx sin x agree with k·cos(k·x)`, () => {
      const ce = fEngine(unit);
      const js = ce._getCompilationTarget('javascript')!;
      const byRef = js.compile(ce.parse("f'(x)"));
      const inline = js.compile(inlineD(ce));
      expect(byRef.success).toBe(true);
      expect(inline.success).toBe(true);

      for (const p of points) {
        const expected = k * Math.cos(k * p);
        expect(byRef.run!({ x: p }) as number).toBeCloseTo(expected, 12);
        expect(inline.run!({ x: p }) as number).toBeCloseTo(expected, 12);
      }
    });

    test(`${unit}: second derivative carries k²`, () => {
      const ce = fEngine(unit);
      const js = ce._getCompilationTarget('javascript')!;
      const compiled = js.compile(ce.parse("f''(x)"));
      for (const p of points) {
        const expected = -k * k * Math.sin(k * p);
        expect(ce.parse(`f''(${p})`).N().re).toBeCloseTo(expected, 12);
        expect(compiled.run!({ x: p }) as number).toBeCloseTo(expected, 12);
      }
    });
  }

  test('deg: cos and the chain rule agree on both routes', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    const js = ce._getCompilationTarget('javascript')!;
    const k = Math.PI / 180;

    // g := x ↦ cos x — d/dx cos(k·x) = −k·sin(k·x).
    ce.parse('g \\coloneq x \\mapsto \\cos x').evaluate();
    const gCompiled = js.compile(ce.parse("g'(x)"));
    for (const p of [0, 30, 60, 90]) {
      const expected = -k * Math.sin(k * p);
      expect(ce.parse(`g'(${p})`).N().re).toBeCloseTo(expected, 12);
      expect(gCompiled.run!({ x: p }) as number).toBeCloseTo(expected, 12);
      expect(
        ce.box(['D', ['Cos', 'x'], 'x']).evaluate().subs({ x: p }).N().re
      ).toBeCloseTo(expected, 12);
    }

    // h := x ↦ sin(2x) — the chain rule composes with the unit factor:
    // d/dx sin(k·2x) = 2k·cos(2k·x).
    ce.parse('h \\coloneq x \\mapsto \\sin(2x)').evaluate();
    const hCompiled = js.compile(ce.parse("h'(x)"));
    for (const p of [0, 30, 45]) {
      const expected = 2 * k * Math.cos(2 * k * p);
      expect(ce.parse(`h'(${p})`).N().re).toBeCloseTo(expected, 12);
      expect(hCompiled.run!({ x: p }) as number).toBeCloseTo(expected, 12);
    }
    // The reported sample: 2·(π/180)·cos(60°) = π/180.
    expect(ce.parse("h'(30)").N().re).toBeCloseTo(k, 12);
  });

  test('deg: the by-reference derivative is not the radian value', () => {
    // The regression itself: `f'(0)` used to be 1 (cos 0) on both routes.
    const ce = fEngine('deg');
    const js = ce._getCompilationTarget('javascript')!;
    const run = js.compile(ce.parse("f'(x)")).run!;
    expect(ce.parse("f'(0)").N().re).toBeCloseTo(Math.PI / 180, 15);
    expect(run({ x: 0 }) as number).toBeCloseTo(Math.PI / 180, 15);
    // 30°: the radian answer (cos 30 ≈ 0.154251) is not a coincidental match.
    expect(ce.parse("f'(30)").N().re).toBeCloseTo(0.015114994701951816, 15);
    expect(run({ x: 30 }) as number).toBeCloseTo(0.015114994701951816, 15);
  });

  test('deg: the chain factor stays exact', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    expect(inlineD(ce).evaluate().toString()).toBe('1/180 * pi * cos(x)');
    // Inverse trig: the result is an angle, so the derivative is DIVIDED by k.
    expect(ce.box(['D', ['Arcsin', 'x'], 'x']).evaluate().toString()).toBe(
      '180 / (pi * sqrt(1 - x^2))'
    );
  });

  test('deg: ND is not converted twice', () => {
    // `ND` numerically differentiates a body it compiles itself, so the
    // entry-point rewrite must not scale that body a second time.
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    const js = ce._getCompilationTarget('javascript')!;
    const nd = ce.box(['ND', ['Function', ['Sin', 'x'], 'x'], 0]);
    expect(nd.N().re).toBeCloseTo(Math.PI / 180, 10);
    expect(js.compile(nd).run!({}) as number).toBeCloseTo(Math.PI / 180, 10);
  });
});

//
// CONSTANT FOLDING × ANGULAR UNIT — regression, 0.108.0.
//
// Whole-subtree constant folding shipped in 0.108.0 and applied the angular
// conversion TWICE in degree mode. The subtree reaching `tryConstantFold` has
// already had the conversion lowered into it — under `deg` the tree is
// `sin(90 * 0.01745…)`, not `sin(90)` — so evaluating it through `.N()` on an
// engine still set to degrees converted a second time: `sin(90)` folded to
// 0.0274 (the sine of 90° re-read as degrees) instead of 1, and `arctan(1)` to
// 2578.31 (45 × 180/π) on the way out.
//
// The failure was silent — no decline, no error, just wrong numbers that
// disagreed with interpretation — and it hit every angular function with a
// CONSTANT argument on a user-facing engine setting. A free-variable argument
// was always correct, since only constant subtrees are folded, which is why
// the shape of the bug is "constant arguments only".
//
// Reported by Tycho against 0.108.0 as their item 185, caught by their
// `degree-mode compile parity` test. Fix: `tryConstantFold` neutralizes
// `angularUnit` for the duration of its evaluation, alongside the
// `maxCollectionSize` clamp it already applied.
//
describe('ANGULAR UNIT — constant folding must not convert twice', () => {
  const CASES: [string, number][] = [
    ['\\sin(90)', 1],
    ['\\sin(30)', 0.5],
    ['\\sin(1)', 0.017452406437283512],
    ['\\cos(0)', 1],
    ['\\cos(60)', 0.5],
    ['\\tan(45)', 1],
    ['\\arcsin(1)', 90],
    ['\\arctan(1)', 45],
    ['\\arccos(0)', 90],
  ];

  test.each(CASES)(
    'deg: %s compiles to the interpreted value with folding ON',
    (latex, expected) => {
      const ce = degEngine();
      const js = ce._getCompilationTarget('javascript')!;
      const compiled = js.compile(ce.parse(latex)).run!({}) as number;
      expect(compiled).toBeCloseTo(expected, 9);
      // …and agrees with interpretation, which was always correct.
      expect(compiled).toBeCloseTo(ce.parse(latex).N().re as number, 9);
    }
  );

  test('folding ON and OFF agree in degree mode', () => {
    for (const [latex] of CASES) {
      const ce = degEngine();
      const js = ce._getCompilationTarget('javascript')!;
      const on = js.compile(ce.parse(latex), {
        constantFold: true,
      } as never).run!({}) as number;
      const off = js.compile(ce.parse(latex), {
        constantFold: false,
      } as never).run!({}) as number;
      expect(on).toBeCloseTo(off, 9);
    }
  });

  test('a FREE argument was never affected, and still is not', () => {
    const ce = degEngine();
    const js = ce._getCompilationTarget('javascript')!;
    const f = js.compile(ce.parse('\\sin(x)')).run!({ x: 90 }) as number;
    expect(f).toBeCloseTo(1, 9);
  });

  test('the engine is left in its original angular unit after a fold', () => {
    // The neutralization is restored in a `finally`, so a fold — including one
    // that declines — must not leak radians into the caller's engine.
    const ce = degEngine();
    const js = ce._getCompilationTarget('javascript')!;
    js.compile(ce.parse('\\sin(90)'));
    expect(ce.angularUnit).toBe('deg');
    expect(ce.parse('\\sin(90)').N().re).toBeCloseTo(1, 9);
  });

  test('radian mode is unchanged', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'rad';
    const js = ce._getCompilationTarget('javascript')!;
    for (const latex of ['\\sin(1)', '\\arctan(1)', '\\cos(0)']) {
      const compiled = js.compile(ce.parse(latex)).run!({}) as number;
      expect(compiled).toBeCloseTo(ce.parse(latex).N().re as number, 9);
    }
  });
});
