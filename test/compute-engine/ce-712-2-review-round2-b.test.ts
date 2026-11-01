/**
 * CE-712.2: an absent list argument beside a list argument in the static
 * map of a user-function call on interval-js.
 *
 * `g := (a, b) ↦ 2a + b`, `L: list<real> | missing` absent and
 * `M: list<real> = [1, 2]`: the interpreter and JavaScript give
 * `[NaN, NaN]`. On interval-js, the absent argument reaches `g` as the
 * absence marker `{ kind: 'empty' }` at each element, and each element of
 * the result is `empty`, the interval form of NaN. Before, the map gave
 * `g` the raw `undefined`, and each element was `{ kind: 'entire' }`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<real> | missing');
  ce.declare('M', 'list<real>');
  ce.assign(
    'g',
    ce.box(['Function', ['Add', ['Multiply', 2, 'a'], 'b'], 'a', 'b'])
  );
  return ce;
}

describe('CE-712.2: an absent list argument beside a list argument', () => {
  test('g(L, M) with L absent and M = [1, 2]', () => {
    const ce = engine();
    const expr = ce.box(['g', 'L', 'M']);
    const interpreted = expr
      .subs({ L: ce.box('Missing'), M: ce.box(['List', 1, 2]) })
      .evaluate();
    expect(interpreted.operator).toBe('List');
    expect(interpreted.ops!.map((x) => x.re)).toEqual([NaN, NaN]);

    const js = compile(expr, { fallback: false });
    expect(js.success).toBe(true);
    expect(js.run!({ L: undefined, M: [1, 2] } as any)).toEqual([NaN, NaN]);

    const ia = compile(expr, { to: 'interval-js', fallback: false });
    expect(ia.success).toBe(true);
    expect(ia.code).toContain('_IA.mapFn(');
    expect(ia.run!({ L: undefined, M: [1, 2] } as any)).toEqual([
      { kind: 'empty' },
      { kind: 'empty' },
    ]);
  });
});
