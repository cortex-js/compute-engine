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

const interp = (ce: ComputeEngine, latex: string, x: number): string =>
  ce.parse(latex).subs({ x }).evaluate().toString();

describe('CE-211: an ordering comparison with a constant pole', () => {
  const ce = new ComputeEngine();
  ce.assign('a', ce.parse('1/0'));
  const cases = [
    'x < 1/0',
    'x \\le 1/0',
    'x > 1/0',
    'x \\ge 1/0',
    'x < 1/0 + 2',
    'x < 2\\cdot\\frac{1}{0}',
    'x < (-1)!',
    'x < a',
    '0 < x < 1/0',
  ];

  test.each(cases)('%s is false on JavaScript, as in the interpreter', (s) => {
    for (const x of [1, -1, 0]) {
      expect(interp(ce, s, x)).toBe('"False"');
      expect(run(ce, s, 'javascript', { x })).toBe(false);
    }
  });

  test.each(cases)('%s is false on interval-js', (s) => {
    expect(run(ce, s, 'interval-js', { x: 1 })).toBe('false');
  });

  test('a selection over such a comparison takes the else branch', () => {
    const s = '\\begin{cases}1 & x < 1/0\\\\0 & \\text{otherwise}\\end{cases}';
    expect(interp(ce, s, 1)).toBe('0');
    expect(run(ce, s, 'javascript', { x: 1 })).toBe(0);
  });

  test('arithmetic keeps the projection of the pole', () => {
    // `x + 1/0` is `~oo` in the interpreter, spelled `Infinity` compiled.
    expect(run(ce, 'x + 1/0', 'javascript', { x: 1 })).toBe(Infinity);
  });

  test('an equality is unchanged', () => {
    expect(interp(ce, 'x = 1/0', 1)).toBe('"False"');
    expect(run(ce, 'x = 1/0', 'javascript', { x: 1 })).toBe(false);
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

  test('a list operand keeps the element-wise comparison', () => {
    const ce2 = new ComputeEngine();
    ce2.declare('L', 'list<real>');
    const r = compile(ce2.box(['Less', 'L', ['Divide', 1, 0]]), {
      to: 'javascript',
    } as any) as any;
    expect(r.success).toBe(true);
    expect(r.code).not.toBe('false');
  });
});
