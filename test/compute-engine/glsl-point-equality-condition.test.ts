/**
 * A selection whose condition compares two points (`If(p = q, 1, 2)` with
 * `p` and `q` of type `tuple<real, real>`) compiles on GLSL. The condition is
 * one boolean: the interpreter compares a point as one value, and GLSL `==` on
 * two `vec2` values is true when every component is equal. The GLSL fragment
 * admits this condition, so `canCompile()` and `compile()` both accept it.
 *
 * `Less` of two points has no reading as one boolean, and is refused.
 */

import { ComputeEngine } from '../../src/compute-engine';
import {
  canCompile,
  compile,
} from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('p', 'tuple<real, real>');
  ce.declare('q', 'tuple<real, real>');
  ce.declare('x', 'real');
  return ce;
}

function glsl(ce: ComputeEngine, json: any) {
  const expr = ce.box(json);
  return {
    check: canCompile(expr, { to: 'glsl' }),
    result: compile(expr, { to: 'glsl' } as any) as any,
  };
}

describe('GLSL: a selection on the equality of two points', () => {
  test('If(p = q, 1, 2) compiles to a comparison of two vec2 values', () => {
    const { check, result } = glsl(engine(), ['If', ['Equal', 'p', 'q'], 1, 2]);
    expect(check.ok).toBe(true);
    expect(result.success).toBe(true);
    expect(result.code).toBe('((p == q) ? (1.0) : (2.0))');
  });

  test('NotEqual and And with a scalar comparison compile', () => {
    const ce = engine();
    for (const json of [
      ['If', ['NotEqual', 'p', 'q'], 1, 2],
      ['If', ['And', ['Equal', 'p', 'q'], ['Less', 'x', 1]], 1, 2],
    ]) {
      const { check, result } = glsl(ce, json);
      expect(check.ok).toBe(true);
      expect(result.success).toBe(true);
    }
  });

  test('the interpreter selects the first value only when every component is equal', () => {
    // The value that GLSL `p == q` gives for a `vec2`.
    const ce = engine();
    const expr = ce.box(['If', ['Equal', 'p', 'q'], 1, 2]);
    const at = (p: number[], q: number[]) =>
      expr
        .subs({ p: ce.tuple(...p), q: ce.tuple(...q) })
        .evaluate()
        .toString();
    expect(at([1, 2], [1, 2])).toBe('1');
    expect(at([1, 2], [1, 3])).toBe('2');
    expect(at([1, 2], [0, 2])).toBe('2');
  });

  test('Less of two points is refused by canCompile() and compile()', () => {
    const { check, result } = glsl(engine(), ['If', ['Less', 'p', 'q'], 1, 2]);
    expect(check.ok).toBe(false);
    expect(result.success).toBe(false);
  });
});
