/**
 * `.N()` of a sum of exact terms that cancel computes the sum again at a
 * raised precision (CE-1311, CE-1249): at the working precision, the
 * difference of two large terms loses its digits. The expected values were
 * computed with mpmath at 60 digits.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('N of an exact sum that cancels', () => {
  test('the closed form of a definite integral of x^100 e^-x (CE-1311)', () => {
    const ce = new ComputeEngine();
    const I = ce.box([
      'Integrate',
      ['Multiply', ['Power', 'x', 100], ['Exp', ['Negate', 'x']]],
      ['Limits', 'x', 0, 20],
    ]);
    const exact = I.evaluate();
    expect(exact.operator).toBe('Add');
    expect(exact.N().toString()).toBe('6.43215797205551260137e+120');
  });

  test('the exact remainder of Mod by an irrational divisor (CE-1249)', () => {
    const ce = new ComputeEngine();
    const r = ce
      .box([
        'Mod',
        { num: '81129638414606663681390495662081' },
        ['Sqrt', 2],
      ])
      .evaluate();
    expect(r.N().toString()).toBe('1.05464095093706286692');
  });

  test('a constant times a power of ten minus an integer', () => {
    const ce = new ComputeEngine();
    const x = ce.box([
      'Subtract',
      ['Multiply', 'Pi', { num: '1e30' }],
      { num: '3141592653589793238462643383279' },
    ]);
    expect(x.N().toString()).toBe('0.502884197169399375106');
  });

  test('a loss of a few digits', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('\\pi-\\frac{22}{7}').N().toString()).toBe(
      '-0.00126448926734961868021'
    );
  });

  test('at machine precision', () => {
    const ce = new ComputeEngine();
    ce.precision = 'machine';
    expect(ce.parse('e^{40}-235385266837019985').N().re).toBeCloseTo(
      0.4078999107490348,
      14
    );
  });

  test('a sum whose exact value is 0 stays near 0', () => {
    const ce = new ComputeEngine();
    const x = ce.box([
      'Subtract',
      ['Sin', ['Divide', 'Pi', 12]],
      ['Divide', ['Subtract', ['Sqrt', 6], ['Sqrt', 2]], 4],
    ]);
    expect(Math.abs(x.N().re)).toBeLessThan(1e-20);
  });

  test('on the asynchronous route', async () => {
    const ce = new ComputeEngine();
    const x = ce.parse('e^{40}-235385266837019985');
    const r = await x.evaluateAsync({ numericApproximation: true });
    expect(r.toString()).toBe('0.407899910749034804509');
  });

  test('an operand with a bound variable is not evaluated again', () => {
    const ce = new ComputeEngine();
    let calls = 0;
    ce.declare('f', {
      signature: '(integer) -> real',
      evaluate: ([k]) => {
        calls += 1;
        return ce.box(['Divide', 1, ['Power', k, 2]]).N();
      },
    });
    const x = ce.box([
      'Subtract',
      ['Sum', ['f', 'k'], ['Limits', 'k', 1, 50]],
      ['Divide', ['Power', 'Pi', 2], 6],
    ]);
    expect(x.N().re).toBeCloseTo(-0.0198013332266971, 14);
    expect(calls).toBe(50);
  });

  test('the precision of the engine is restored', () => {
    const ce = new ComputeEngine();
    ce.parse('e^{40}-235385266837019985').N();
    expect(ce.precision).toBe(21);
    expect(ce.box('Pi').N().toString()).toBe('3.14159265358979323846');
  });
});
