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
    const js = ce.getCompilationTarget('javascript')!;
    const run = js.compile(ce.parse('\\sin(x)')).run!;
    expect(run({ x: 90 })).toBeCloseTo(1, 12);
    expect(run({ x: 30 })).toBeCloseTo(0.5, 12);
    // Agreement with the interpreter:
    expect(run({ x: 37 })).toBeCloseTo(ce.parse('\\sin(37)').N().re, 12);
  });

  test('deg: javascript target — inverse trig results are scaled', () => {
    const ce = degEngine();
    const js = ce.getCompilationTarget('javascript')!;
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
    const js = ce.getCompilationTarget('javascript')!;
    const r = js.compile(ce.parse('\\sinh(x)'));
    expect(r.code).toBe('Math.sinh(_.x)');
    expect(r.run!({ x: 1 })).toBeCloseTo(Math.sinh(1), 12);
  });

  test('deg: interval-js target', () => {
    const ce = degEngine();
    const ijs = ce.getCompilationTarget('interval-js')!;
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
    const glsl = ce.getCompilationTarget('glsl')!;
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
    const js = ce.getCompilationTarget('javascript')!;
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

  test('rad: no rewrite (codegen unchanged)', () => {
    const ce = new ComputeEngine();
    const js = ce.getCompilationTarget('javascript')!;
    expect(js.compile(ce.parse('\\sin(x)')).code).toBe('Math.sin(_.x)');
    expect(js.compile(ce.parse('\\arcsin(x)')).code).toBe('Math.asin(_.x)');
  });

  test('deg: composite expression (Fourier-style sum) agrees with .N()', () => {
    const ce = degEngine();
    const js = ce.getCompilationTarget('javascript')!;
    const latex = '\\sum_{k=1}^{3} \\frac{\\sin(k x)}{k}';
    const run = js.compile(ce.parse(latex)).run!;
    const interp = ce
      .box(['Sum', ['Divide', ['Sin', ['Multiply', 'k', 25]], 'k'], ['Limits', 'k', 1, 3]])
      .N().re;
    expect(run({ x: 25 })).toBeCloseTo(interp, 10);
  });
});
