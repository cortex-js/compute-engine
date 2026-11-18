import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * An ordering comparison with a constant pole operand (ROADMAP CE-211, Tycho
 * row 413). The interpreter answers `False` for `x < 1/0` whatever `x` is:
 * `1/0` is the complex infinity `~oo`, which has no order (user decision
 * 2026-10-21). Compiled code spells the pole as the IEEE `Infinity`, so
 * `x < 1/0` compiled to `x < Infinity`, `true` at `x = 1`. The comparison now
 * compiles to the target's `False`.
 */

function run(
  ce: ComputeEngine,
  latex: string,
  to: string,
  args: Record<string, unknown>
): unknown {
  const r = compile(ce.parse(latex), { to, fallback: false } as any) as any;
  expect(r.success).toBe(true);
  return r.run(args);
}

describe('CE-211: an ordering comparison with a constant pole', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('a', ce.parse('1/0'));
  // On JavaScript, the compiler declines the pole `1/0` (a complex number
  // with an infinite part), and compiled code gives no fidelity at a pole
  // (`(-1)!`): `docs/COMPILATION-MODEL.md`, "Caveats of compiled code".

  test.each(['x < (-1)!'])('%s is false on interval-js', (s) => {
    expect(run(ce, s, 'interval-js', { x: 1 })).toBe('false');
  });

  test('a comparison of a variable with a finite operand is unchanged', () => {
    expect(run(ce, 'x < 2', 'javascript', { x: 1 })).toBe(true);
  });

  test('a bound name is not read as the engine value of the same name', () => {
    // `a` is a parameter of the lambda here, not the engine symbol `a := 1/0`.
    const r = compile(
      ce.box(['Map', ['Function', ['Less', 1, 'a'], 'a'], ['List', 0, 2]]),
      { to: 'javascript', fallback: false } as any
    ) as any;
    expect(r.run({})).toEqual([false, true]);
  });
});
