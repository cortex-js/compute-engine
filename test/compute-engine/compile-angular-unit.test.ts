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
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/** `compile()` to `interval-js`, with the call shape of a target's `compile()`. */
const INTERVAL_JS = {
  compile: (expr: any, options: Record<string, unknown> = {}) =>
    compile(expr, { ...options, to: 'interval-js' } as any) as any,
};

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

  test('deg: interval-js target', () => {
    const ce = degEngine();
    const ijs = INTERVAL_JS;
    const r = ijs.compile(ce.parse('\\sin(x)')).run!({ x: 90 }) as {
      kind: string;
      value: { lo: number; hi: number };
    };
    expect(r.kind).toBe('interval');
    expect(r.value.lo).toBeCloseTo(1, 10);
    expect(r.value.hi).toBeCloseTo(1, 10);
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
  ce.declare('x', 'real');
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

  }

  test('deg: the chain factor stays exact', () => {
    const ce = new ComputeEngine();
    ce.angularUnit = 'deg';
    expect(inlineD(ce).evaluate().toString()).toBe('1/180 * pi * cos(x)');
    // Inverse trig: the result is an angle, so the derivative is DIVIDED by k.
    expect(ce.box(['D', ['Arcsin', 'x'], 'x']).evaluate().toString()).toBe(
      '180 / (pi * sqrt(1 - x^2))'
    );
  });

});

