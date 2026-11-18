/**
 * CE-778: a chained comparison with three operands or more lowers to a
 * conjunction of pairs, `Less(3, y, x)` → `(3 < y) && (y < x)`. The operator
 * at the root of that code is the conjunction, not `<`. Under a parent that
 * binds tighter than the conjunction (a prefix `!` or `not`), the code must
 * be in parentheses: without them, `Not(Less(3, y, x))` emitted
 * `!(3.0 < y) && (y < x)`, which negates only the first pair. At y = 4,
 * x = 1 that code gives false, and the interpreter gives True.
 *
 * Under `And` or `Or` the conjunction needs no parentheses, and the code
 * stays as it was.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');

function code(json: unknown, to: string): string {
  const result = compile(ce.box(json as any), { to } as any);
  expect(result.success).toBe(true);
  return result.code;
}

const NEGATED_CHAIN = ['Not', ['Less', 3, 'y', 'x']];

describe('CE-778: a negated comparison chain keeps its parentheses', () => {

  test('the compiled value is the value of the interpreter', () => {
    const expr = ce.box(NEGATED_CHAIN as any);
    const fn = compile(expr, { to: 'javascript' });
    for (const [x, y] of [
      [1, 4],
      [5, 4],
      [1, 2],
      [5, 2],
    ]) {
      const expected = expr.subs({ x, y }).evaluate().symbol === 'True';
      expect(fn.run!({ x, y })).toBe(expected);
    }
  });

});
