import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

import type { MathJsonExpression } from '../../src/math-json/types';

/** `compile()` to `interval-js`, called as a target's `compile()` is. */
const intervalCompile = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { ...options, to: 'interval-js' } as any) as any;

/**
 * `compile()` of the `Match` head on `interval-js`. The cases of constants
 * and `_` lower as the clauses of a `Which` on the subject
 * (`compile-match.test.ts` has the cases of every target, CE-1652).
 */

const ce = new ComputeEngine();
ce.declare('xs', 'real | list<real> | list<list<real>>');
// Boxing declares no name, and a `Match` does not type its subject: the
// subject `x` of the tests on this engine is declared.
ce.declare('x', 'number');

describe('COMPILE Match — interval-js', () => {
  const m: MathJsonExpression = [
    'Match',
    'x',
    ['MatchCase', 1, 10],
    ['MatchCase', '_', -1],
  ];

  it('compiles as the Which of its cases, with the interpreter\'s values', () => {
    const r = intervalCompile(ce.box(m));
    expect(r.success).toBe(true);
    expect(r.run({ x: 1 })).toEqual({
      kind: 'interval',
      value: { lo: 10, hi: 10 },
    });
    expect(r.run({ x: 2 })).toEqual({
      kind: 'interval',
      value: { lo: -1, hi: -1 },
    });
  });
});

describe('COMPILE Match — typed bindings (`MatchesType` with a literal type)', () => {

  it('declines a type that the static type of the subject does not decide', () => {
    const r = intervalCompile(
      ce.box(['MatchesType', 'x', { str: 'integer' }])
    );
    expect(r.success).toBe(false);
  });
});
