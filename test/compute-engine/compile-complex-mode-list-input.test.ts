import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json/types';

describe('statistics of complex data', () => {
  it('the machine-precision interpreter computes the standard deviation scaled', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(
      ce.box(['StandardDeviation', ['List', 1e200, -1e200]]).N().re
    ).toBeCloseTo(Math.SQRT2 * 1e200, -190);
    expect(
      ce.box(['PopulationStandardDeviation', ['List', 1e200, -1e200]]).N().re
    ).toBe(1e200);
  });
});

describe('Power of a base whose rank is not known', () => {
  it('a list of extended reals is a vector, with no shape test', () => {
    // `signed_infinity` is a union of the literal value types `Infinity`
    // and `-Infinity`. A literal value type is a scalar, so a list whose
    // cells are `real | signed_infinity | nan` is a list of numbers, as a
    // list of `real` is.
    const code = (type: string, expr: MathJsonExpression): string => {
      const ce = new ComputeEngine();
      ce.declare('p', type);
      return compile(ce.box(expr), { to: 'javascript', fallback: false }).code!;
    };
    const C = 'real | signed_infinity | nan';
    expect(code(`list<${C}>`, ['Power', 'p', 2])).toBe(
      code('list<real>', ['Power', 'p', 2])
    );
    const y: MathJsonExpression = ['Power', ['PointY', 'p'], 2];
    expect(code(`list<tuple<${C}, ${C}>>`, y)).toBe(
      code('list<tuple<real, real>>', y)
    );
    expect(code(`list<tuple<${C}, ${C}>>`, y)).not.toContain(
      'matrixPowerShape'
    );
  });
});
