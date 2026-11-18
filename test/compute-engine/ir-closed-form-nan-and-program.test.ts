import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';

describe('the closed form of an integral that is NaN at a bound', () => {
  test('the quadrature gives the value at an integrable singularity', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    // The closed form is `a − a·ln(a) − 2 + 2·ln(2)`: NaN at a = 0.
    const e = ce.box(['Integrate', ['Ln', 't'], ['Limits', 't', 'a', 2]]);
    const r = compile(e);
    expect(r.success).toBe(true);
    for (const a of [0, 0.5, 1])
      expect(r.run({ a }) as number).toBeCloseTo(e.subs({ a }).N().re, 8);
  });
});

describe('a user function named Program', () => {
  test('compiles as a call of the user function, not as a Block', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.box(['Assign', 'Program', ['Function', ['Add', 'y', 1], 'y']]).evaluate();
    const r = compile(ce.box(['Program', 'x']));
    expect(r.success).toBe(true);
    expect(r.run({ x: 2 })).toBe(3);
  });
});
