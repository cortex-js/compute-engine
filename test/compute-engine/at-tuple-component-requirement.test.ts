/**
 * An index read `g[k]` of a literal `k` in a numeric context requires a
 * number of the component `k` of a tuple `g`, not of every component
 * (`tupleComponentRequirement()`, `library/collections.ts`). With the
 * requirement `indexed_collection<number>`, a loop variable over a list of
 * tuples whose elements are a tuple and a number was typed `never`, so the
 * function that read it had the result type `never` and did not compile
 * (CE-1492).
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

type Result = { success: boolean; run: (inputs: object) => unknown };

/** The type of `f`, its value at 2, and the compiled value at 2. */
function check(source: string): {
  type: string;
  value: string;
  compiled: unknown;
} {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(r.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  const c = compile(ce.box(['f', 'n']), {
    to: 'javascript',
    fallback: false,
  } as never) as unknown as Result;
  expect(c.success).toBe(true);
  return {
    type: ce.box('f').type.toString(),
    value: ce.box(['f', 2]).evaluate().toString(),
    compiled: c.run({ n: 2 }),
  };
}

describe('AN INDEX READ OF A TUPLE REQUIRES ONE COMPONENT', () => {
  test('a sum of the second component of each tuple', () => {
    expect(
      check(
        'function f(n: integer) { let t = 0.5; for g in [((1, 2), 2), ((3, 4), 3)] { t = t + g[2] }; t }'
      )
    ).toEqual({ type: '(n: integer) -> number', value: '5.5', compiled: 5.5 });
  });

  test('a negative index counts from the end', () => {
    expect(
      check(
        'function f(n: integer) { let t = 0.5; for g in [((1, 2), 2), ((3, 4), 3)] { t = t + g[-1] }; t }'
      )
    ).toEqual({ type: '(n: integer) -> number', value: '5.5', compiled: 5.5 });
  });

  test('a chained read of the inner tuple', () => {
    expect(
      check(
        'function f(n: integer) { let t = 0.5; for g in [((1, 2), 2), ((3, 4), 3)] { t = t + g[1][2] }; t }'
      )
    ).toEqual({ type: '(n: integer) -> number', value: '6.5', compiled: 6.5 });
  });

  test('a list grown from a product of two components', () => {
    expect(
      check(`const A = (-1, 0, 0)
const B = (2, 0.5, 0)
function f(n: integer) { let L: list<real> = []; for g in [(A, 2), (B, n)] { L = [...L, g[1][2] * g[2]] }; L }`)
    ).toEqual({
      type: '(n: integer) -> list<real>',
      value: '[0,1]',
      compiled: [0, 1],
    });
  });

  test('a component of another type is still an error', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function f(n: integer) { let t = 0.5; for g in [((1, 2), true), ((3, 4), false)] { t = t + g[2] }; t }'
    );
    expect(
      r.diagnostics.some(
        (d) =>
          d.severity === 'error' &&
          String(d.message).includes('incompatible-type')
      )
    ).toBe(true);
  });
});
