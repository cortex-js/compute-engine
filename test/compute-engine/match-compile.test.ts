import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

import type { MathJsonExpression } from '../../src/math-json/types';

/** `compile()` to `interval-js`, called as a target's `compile()` is. */
const intervalCompile = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { ...options, to: 'interval-js' } as any) as any;

/**
 * `compile()` of the `Match` head (docs/LANGUAGE-MODEL.md §5). The compiler
 * declines `Match`, and the interpreter fallback gives its value.
 */

const ce = new ComputeEngine();
ce.declare('xs', 'real | list<real> | list<list<real>>');
// Boxing declares no name, and a `Match` does not type its subject: the
// subject `x` of the tests on this engine is declared.
ce.declare('x', 'number');

describe('COMPILE Match — interval-js fails closed', () => {
  const m: MathJsonExpression = [
    'Match',
    'x',
    ['MatchCase', 1, 10],
    ['MatchCase', '_', -1],
  ];

  it('interval-js reports failure (no interval-Which treatment invented, §5)', () => {
    const r = compile(ce.box(m), { to: 'interval-js' });
    expect(r.success).toBe(false);
  });
});

describe('COMPILE Match — typed bindings (`MatchesType` with a literal type)', () => {

  it('the interval target keeps failing closed (its values are intervals)', () => {
    const r = intervalCompile(
      ce.box(['MatchesType', 'x', { str: 'integer' }])
    );
    expect(r.success).toBe(false);
  });
});
