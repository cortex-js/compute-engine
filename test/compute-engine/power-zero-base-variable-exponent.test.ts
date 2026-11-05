/**
 * `0^b` folds at canonicalization only when the exponent is made of numbers
 * and constants (`0^{-1}`, `0^{2\pi}`). The sign of an exponent that contains
 * a variable can change after the expression is boxed (`0^x` with
 * `x := 2`, then `x := -1`), so that power stays unfolded and `evaluate()`
 * folds it with the value or the assumptions of that moment.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('POWER — a zero base with a variable exponent', () => {
  test('a symbol with a value folds with its current value', () => {
    const ce = new ComputeEngine();
    ce.assign('x', 2);
    const e = ce.box(['Power', 0, 'x']);
    expect(e.json).toEqual(['Power', 0, 'x']);
    expect(e.evaluate().json).toBe(0);
    ce.assign('x', -1);
    expect(e.evaluate().json).toBe('ComplexInfinity');
    expect(e.N().json).toBe('ComplexInfinity');
    ce.assign('x', 3);
    expect(e.evaluate().json).toBe(0);
    ce.assign('x', 0);
    expect(e.evaluate().json).toBe('NaN');
    expect(e.N().json).toBe('NaN');
    ce.assign('x', -Infinity);
    expect(e.evaluate().json).toBe('ComplexInfinity');
  });

  test('a symbol with an infinite value folds when it is evaluated', () => {
    const ce = new ComputeEngine();
    ce.assign('z', Infinity);
    const e = ce.box(['Power', 0, 'z']);
    expect(e.json).toEqual(['Power', 0, 'z']);
    expect(e.evaluate().json).toBe(0);
  });

  test('an exponent with a known sign from an assumption folds when it is evaluated', () => {
    const ce = new ComputeEngine();
    ce.assume(ce.parse('w > 0'));
    ce.assume(ce.parse('v < 0'));
    expect(ce.parse('0^w').json).toEqual(['Power', 0, 'w']);
    expect(ce.parse('0^w').evaluate().json).toBe(0);
    expect(ce.parse('0^{w+1}').evaluate().json).toBe(0);
    expect(ce.parse('0^{-w}').evaluate().json).toBe('ComplexInfinity');
    expect(ce.parse('0^v').evaluate().json).toBe('ComplexInfinity');
    const float = ce.box(['Power', { num: '0.0' }, 'w']).evaluate();
    expect(float.isExact).toBe(false);
    expect(float.re).toBe(0);
  });

  test('an exponent with no known sign stays unfolded', () => {
    const ce = new ComputeEngine();
    ce.declare('t', 'real');
    expect(ce.parse('0^t').evaluate().json).toEqual(['Power', 0, 't']);
  });

  test('an exponent made of numbers and constants folds at canonicalization', () => {
    const ce = new ComputeEngine();
    expect(ce.box(['Power', 0, 'Pi']).json).toBe(0);
    expect(ce.box(['Power', 0, ['Multiply', 2, 'Pi']]).json).toBe(0);
    expect(ce.box(['Power', 0, ['Negate', 'Pi']]).json).toBe(
      'ComplexInfinity'
    );
    expect(ce.box(['Power', 0, -2]).json).toBe('ComplexInfinity');
  });
});
