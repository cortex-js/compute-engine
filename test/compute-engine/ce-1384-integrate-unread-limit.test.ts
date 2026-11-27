import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// CE-1384: an operand of `Integrate` that is not a limit is an error, not
// left out: left out, the integral became indefinite.

const ce = new ComputeEngine();
const value = (source: string) =>
  String(executeEpsil(new ComputeEngine(), source).value);

describe('AN OPERAND OF INTEGRATE THAT IS NOT A LIMIT', () => {
  test('a limit with a step is an error', () => {
    expect(value('integrate(x, (x, 0, 1, 2))')).toContain('incompatible-type');
    expect(
      ce
        .box(['Integrate', ['Square', 'x'], ['Limits', 'x', 0, 1, 5]])
        .evaluate()
        .toString()
    ).toContain('incompatible-type');
  });

  test('an `in` clause, a set and a number are errors', () => {
    // `0..1` is the discrete range {0, 1}, not an interval.
    expect(value('integrate(x, x in 0..1)')).toContain('incompatible-type');
    expect(
      ce.box(['Integrate', 'x', ['Set', 'x', 0, 1]]).evaluate().toString()
    ).toContain('incompatible-type');
    expect(value('integrate(x, 2)')).toContain('incompatible-type');
  });

  test('the limits that Integrate reads are unchanged', () => {
    expect(value('integrate(x, (x, 0, 1))')).toBe('1/2');
    expect(value('integrate(x, x, 0, 1)')).toBe('1/2');
    expect(value('integrate(x, x)')).toBe('1/2 * x^2');
    expect(value('integrate(x * y, x, y)')).toBe('1/4 * x^2 * y^2');
    expect(ce.parse('\\int_0^1 x^2 dx').evaluate().toString()).toBe('1/3');
    expect(
      ce.parse('\\oint_{|z|=2} \\frac{1}{z} dz').evaluate().toString()
    ).toBe('2i * pi');
  });
});
