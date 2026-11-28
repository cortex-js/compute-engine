import { ComputeEngine } from '../../src/compute-engine';

// A lone symbol that holds a number, as the integrand of `NIntegrate`, is
// the body of a constant function, as for `ND` and `NLimit`
// (`loneSymbolFormula()`: a symbol whose value has no candidate is "a
// constant for the others").

describe('NIntegrate of a lone symbol that holds a number', () => {
  test('a user symbol with a number value', () => {
    const ce = new ComputeEngine();
    ce.assign('c', 5);
    expect(ce.box(['NIntegrate', 'c', 0, 2]).evaluate().re).toBeCloseTo(
      10,
      12
    );
    // The same value as the function literal of the workaround.
    expect(
      ce.box(['NIntegrate', ['Function', 'c', 'x'], 0, 2]).evaluate().re
    ).toBeCloseTo(10, 12);
    // Bounds in decreasing order negate the integral.
    expect(ce.box(['NIntegrate', 'c', 2, 0]).evaluate().re).toBeCloseTo(
      -10,
      12
    );
    expect(
      ce.box(['NIntegrate', 'c', 0, 'PositiveInfinity']).evaluate().toString()
    ).toBe('+oo');
  });

  test('the value is read at evaluation', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['NIntegrate', 'w', 0, 3]);
    ce.assign('w', 2);
    expect(expr.evaluate().re).toBeCloseTo(6, 12);
    ce.assign('w', 4);
    expect(expr.evaluate().re).toBeCloseTo(12, 12);
  });

  test('a constant and a complex value', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['NIntegrate', 'Pi', 0, 2]).evaluate().re).toBeCloseTo(
      2 * Math.PI,
      12
    );
    ce.assign('z', ce.box(['Complex', 1, 2]));
    const z = ce.box(['NIntegrate', 'z', 0, 2]).evaluate();
    expect(z.re).toBeCloseTo(2, 12);
    expect(z.im).toBeCloseTo(4, 12);
  });

  test('a symbol that names a function keeps its reading', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Square', 'x'], 'x']));
    expect(ce.box(['NIntegrate', 'g', 0, 2]).evaluate().re).toBeCloseTo(
      8 / 3,
      10
    );
    expect(ce.box(['NIntegrate', 'Sin', 0, 1]).evaluate().re).toBeCloseTo(
      1 - Math.cos(1),
      10
    );
  });
});
