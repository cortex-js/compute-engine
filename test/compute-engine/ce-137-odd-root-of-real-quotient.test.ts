import { ComputeEngine } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

/**
 * ROADMAP CE-137.1: the type of an odd root of a base that can be infinite
 * or NaN but is otherwise real, and the `Solve` that depends on it.
 *
 * With `x: real`, `1/x` is `infinity | nan | real` (`1/0` is `~oo`). An odd
 * root keeps that set: the root of a finite real is real (the real-root
 * convention, `Root(-8, 3) = -2`), and `Root(~oo, 3)` is `~oo`. A real
 * unknown rejects a root typed `number`, so `Solve(t^3 x = 1, t)` with
 * `t: real` needs this narrower type to give its root.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('t', 'real');
  ce.declare('x', 'real');
  return ce;
}

describe('CE-137.1: odd root of a real quotient', () => {
  test('an odd root of `1/x` is real or non-finite, and can be `~oo`', () => {
    const ce = engine();
    // `above: 'real'`: at `x = 0` the value is `~oo`, so `real` over-claims.
    expectTypeBetween(ce.box(['Root', ['Divide', 1, 'x'], 3]), {
      atMost: 'real | infinity | nan',
      above: 'real',
    });
    expectTypeBetween(ce.box(['Root', ['Divide', 'x', ['Add', 'x', 1]], 5]), {
      atMost: 'real | infinity | nan',
      above: 'real',
    });
  });

  test('an odd root keeps only the non-finite values of its base', () => {
    const ce = engine();
    // A finite tier below `real` joined with an infinity must not widen to
    // `number`: the finite values of the root are still real.
    ce.declare('a', 'rational | infinity | nan');
    expectTypeBetween(ce.box(['Root', 'a', 3]), {
      atMost: 'real | infinity | nan',
      above: 'real',
    });
    // No infinity in the base, so none in the root.
    ce.declare('b', 'real | nan');
    expectTypeBetween(ce.box(['Root', 'b', 3]), {
      atMost: 'real | nan',
      above: 'real',
    });
    // No NaN in the base, so none in the root.
    ce.declare('c', 'integer | ~oo');
    expectTypeBetween(ce.box(['Root', 'c', 3]), {
      atMost: 'real | infinity',
      above: 'real',
    });
  });

  test('an even root of `1/x` can be complex, so it is not narrowed', () => {
    const ce = engine();
    expect(
      ce
        .box(['Root', ['Divide', 1, 'x'], 2])
        .type.matches('real | infinity | nan')
    ).toBe(false);
    expect(
      ce
        .box(['Root', ['Divide', 1, 'x'], 4])
        .type.matches('real | infinity | nan')
    ).toBe(false);
  });

  test('a degree of unknown parity is not narrowed', () => {
    const ce = engine();
    ce.declare('n', 'integer');
    expect(
      ce
        .box(['Root', ['Divide', 1, 'x'], 'n'])
        .type.matches('real | infinity | nan')
    ).toBe(false);
  });

  test('`Solve(t^3 x = 1, t)` with `t: real` gives the real cube root', () => {
    const ce = engine();
    const result = ce
      .box(['Solve', ce.parse('t^3 x = 1').json, 't'])
      .evaluate();
    expect(result.json).toEqual(['List', ['Root', ['Divide', 1, 'x'], 3]]);
    // The root satisfies the equation: at `x = -8` it is `-1/2`.
    const root = ce.box(['Root', ['Divide', 1, 'x'], 3]).subs({ x: -8 });
    expect(root.evaluate().json).toEqual(['Rational', -1, 2]);
  });

  test('`Solve(t^3 = 2/x, t)` with `t: real` gives the real cube root', () => {
    const ce = engine();
    const result = ce
      .box(['Solve', ce.parse('t^3 = 2/x').json, 't'])
      .evaluate();
    expect(result.json).toEqual(['List', ['Root', ['Divide', 2, 'x'], 3]]);
  });
});
