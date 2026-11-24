import { ComputeEngine } from '../../src/compute-engine';
import { machineNthRoot } from '../../src/compute-engine/numerics/numeric';

/**
 * CE-1256: `Root(x, n)` with a negative index, when the radicand and the index
 * are symbols with values. `Root(x, n)` is `Power(x, 1/n)`, so a zero radicand
 * gives `~oo`, and a radicand near the ends of the double range gives the
 * reciprocal of the root of degree `-n`.
 */

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  ce.declare('y', 'real');
  return ce;
}

describe('CE-1256: Root with a negative index given as a value', () => {
  test('a zero radicand gives ~oo', () => {
    const ce = engine();
    const e = ce.box(['Root', 'x', 'n']);
    ce.assign('x', 0);
    ce.assign('n', -2);
    expect(e.evaluate().toString()).toBe('~oo');
    expect(e.N().toString()).toBe('~oo');
    expect(e.subs({ x: 0, n: -2 }).evaluate().toString()).toBe('~oo');
    expect(ce.box(['Root', 0, -2]).evaluate().toString()).toBe('~oo');
  });

  test('a zero radicand with a positive index is still 0', () => {
    const ce = engine();
    const e = ce.box(['Root', 'x', 'n']);
    expect(ce.withValues({ x: 0, n: 3 }, () => e.evaluate()).toString()).toBe(
      '0'
    );
  });

  test('a very large or very small radicand at machine precision', () => {
    const ce = engine();
    ce.precision = 'machine';
    const f = ce.box(['Root', 'x', 'y']);
    const at = (x: number, y: number) =>
      ce.withValues({ x, y }, () => f.evaluate().N()).re;
    expect(at(1e300, -3)).toBe(1e-100);
    expect(at(-1e-300, -3)).toBe(-1e100);
    expect(at(1e-300, -3)).toBe(1e100);
    expect(at(-1e300, -3)).toBe(-1e-100);
    expect(at(0, -3)).toBe(Infinity);
  });

  test('machineNthRoot with a negative degree is the reciprocal root', () => {
    expect(machineNthRoot(1e300, -3)).toBe(1e-100);
    expect(machineNthRoot(1e-300, -3)).toBe(1e100);
    expect(machineNthRoot(4, -2)).toBe(0.5);
    expect(machineNthRoot(1024, -10)).toBe(0.5);
    expect(machineNthRoot(0, -2)).toBe(Infinity);
  });
});
