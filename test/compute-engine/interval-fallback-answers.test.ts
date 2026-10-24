import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * When `interval-js` cannot compile an expression, the result runs the
 * interpreter at the midpoint of each interval input and wraps its value as
 * an interval answer (`buildIntervalFallback`,
 * `compilation/interval-javascript-target.ts`). `Fibonacci` has no lowering
 * on this target, so it takes that route.
 *
 * - A boolean is the answer string of a comparison, `'true'` or `'false'`, as
 *   compiled code of this target gives it (user decision of 2026-10-23,
 *   ROADMAP CE-210). It was `{ kind: 'entire' }`.
 * - When an input is wider than a point, the value at the midpoint does not
 *   bound the values over the input: a boolean expression is `'maybe'` and a
 *   number is `entire`. `Fibonacci(x)` over `[1, 10]` was `empty`, the value
 *   at 5.5, although it takes the values 1 to 55 there.
 */
const ce = new ComputeEngine();

function run(json: unknown, vars: Record<string, unknown>): unknown {
  const result = compile(ce.box(json as never), { to: 'interval-js' } as never);
  return (result as { run: (v: unknown) => unknown }).run(vars);
}

const GREATER = ['Greater', ['Fibonacci', 'x'], 0];

describe('the interval fallback answers a comparison with its answer string', () => {
  test('a decided comparison at a point', () => {
    expect(run(GREATER, { x: 5 })).toBe('true');
    expect(run(['Less', ['Fibonacci', 'x'], 0], { x: 5 })).toBe('false');
    expect(run(GREATER, { x: { lo: 5, hi: 5 } })).toBe('true');
  });

  test('a comparison inside a list', () => {
    expect(run(['List', GREATER, 1], { x: 5 })).toEqual([
      'true',
      { kind: 'interval', value: { lo: 1, hi: 1 } },
    ]);
  });
});

describe('an input wider than a point is not sampled as if it were one', () => {
  test('a boolean expression is maybe', () => {
    expect(run(GREATER, { x: { lo: 1, hi: 10 } })).toBe('maybe');
    expect(
      run(['And', GREATER, ['Less', 'x', 3]], { x: { lo: 1, hi: 10 } })
    ).toBe('maybe');
  });

  test('a number is entire, not the value at the midpoint', () => {
    expect(run(['Fibonacci', 'x'], { x: { lo: 1, hi: 10 } })).toEqual({
      kind: 'entire',
    });
    // At a point the value is exact: a point interval, or `empty` where the
    // function has no value.
    expect(run(['Fibonacci', 'x'], { x: 5 })).toEqual({
      kind: 'interval',
      value: { lo: 5, hi: 5 },
    });
    expect(run(['Fibonacci', 'x'], { x: 5.5 })).toEqual({ kind: 'empty' });
  });

  test('a collection is entire: its length can differ at another point', () => {
    const json = [
      'If',
      ['Greater', 'x', 0],
      ['List', ['Fibonacci', 'x'], 1],
      ['List', 2],
    ];
    expect(run(json, { x: { lo: -1, hi: 1 } })).toEqual({ kind: 'entire' });
    expect(run(json, { x: 2 })).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 1 } },
      { kind: 'interval', value: { lo: 1, hi: 1 } },
    ]);
  });

  test('a wide input inside a collection argument counts', () => {
    expect(
      run(['Fibonacci', ['At', 'xs', 1]], { xs: [{ lo: 1, hi: 10 }, 2] })
    ).toEqual({ kind: 'entire' });
  });
});
