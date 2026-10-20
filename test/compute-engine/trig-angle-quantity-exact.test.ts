import { ComputeEngine } from '../../src/compute-engine';

//
// A trigonometric function of an angle quantity converts the angle to
// radians. An exact magnitude is converted with the exact factor of its unit
// (a fraction and a power of π, `exactUnitConversion()`), so `sin(30°)` is
// `sin(π/6)` and evaluates to `1/2`, as `sin(π/6)` does. A float magnitude
// is converted with the machine factor.
//

const ce = new ComputeEngine();
const evaluate = (latex: string): string =>
  ce.parse(latex).evaluate().toString();

describe('AN EXACT ANGLE QUANTITY IS CONVERTED EXACTLY', () => {
  test.each([
    ['\\sin(30\\,\\mathrm{deg})', '1/2'],
    ['\\cos(60\\,\\mathrm{deg})', '1/2'],
    ['\\tan(45\\,\\mathrm{deg})', '1'],
    ['\\cot(45\\,\\mathrm{deg})', '1'],
    ['\\sec(60\\,\\mathrm{deg})', '2'],
    ['\\sin(100\\,\\mathrm{grad})', '1'],
    ['\\cos(\\frac{1}{2}\\,\\mathrm{turn})', '-1'],
    ['\\sin(1800\\,\\mathrm{arcmin})', '1/2'],
    ['\\sin(108000\\,\\mathrm{arcsec})', '1/2'],
    ['\\sin(\\pi\\,\\mathrm{rad})', '0'],
    ['\\sin(\\frac{\\pi}{6}\\,\\mathrm{rad})', '1/2'],
  ])('%s evaluates to %s', (latex, value) => {
    expect(evaluate(latex)).toBe(value);
  });

  test('the converted angle is exact', () => {
    expect(ce.parse('\\sin(30\\,\\mathrm{deg})').json).toEqual([
      'Sin',
      ['Multiply', ['Rational', 1, 6], 'Pi'],
    ]);
  });

  test('`.N()` gives the float', () => {
    expect(ce.parse('\\sin(30\\,\\mathrm{deg})').N().re).toBe(0.5);
  });

  test('a float magnitude is converted with the machine factor', () => {
    const value = ce.parse('\\sin(30.0\\,\\mathrm{deg})').evaluate();
    expect(value.re).toBeCloseTo(0.5, 15);
    expect(value.toString()).not.toBe('1/2');
  });
});
