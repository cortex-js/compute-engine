import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// `ND(f, x)` where `f` is the NAME of a function: the function is applied to
// the point, as `NIntegrate(Sin, 0, 1)` does (CE-1376).

describe('ND of a function given by its name', () => {
  test('a library function gives the value of the call form', () => {
    const ce = new ComputeEngine();
    const named = ce.box(['ND', 'Sin', 1]).N().re;
    const call = ce.box(['ND', ['Sin', 'x'], 1]).N().re;
    expect(named).toBeCloseTo(Math.cos(1), 9);
    expect(named).toBe(call);
    expect(ce.box(['ND', 'Sin', 1]).evaluate().re).toBe(named);
  });

  test('other library functions', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['ND', 'Exp', 0]).N().re).toBeCloseTo(1, 9);
    expect(ce.box(['ND', 'Ln', 2]).N().re).toBeCloseTo(0.5, 7);
    expect(ce.parse('\\mathrm{ND}(\\cos, \\pi)').N().re).toBeCloseTo(0, 9);
  });

  test('a declared operator with an evaluate handler', () => {
    const ce = new ComputeEngine();
    ce.declare('F', {
      signature: '(real) -> real',
      evaluate: ([x]) => ce.number(x.re ** 3),
    });
    expect(ce.box(['ND', 'F', 2]).N().re).toBeCloseTo(12, 7);
  });

  test('a symbol that holds a number stays the body of a constant function', () => {
    const ce = new ComputeEngine();
    ce.assign('y', 5);
    expect(ce.box(['ND', 'y', 1]).N().re).toBeCloseTo(0, 9);
  });

  test('a symbol declared `function` with no value stays unevaluated', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'function');
    expect(ce.box(['ND', 'q', 1]).N().json).toEqual(['ND', 'q', 1]);
  });

  test('an operator that is not pure stays unevaluated', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['ND', 'Random', 1]).N().json).toEqual(['ND', 'Random', 1]);
  });

  test('an operator that takes no number stays unevaluated', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['ND', 'Length', 1]).N().json).toEqual(['ND', 'Length', 1]);
  });

  test('Epsil nd(sin, 1)', () => {
    const r = executeEpsil(new ComputeEngine(), 'nd(sin, 1)');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.re).toBeCloseTo(Math.cos(1), 9);
  });
});
