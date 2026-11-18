/**
 * ROADMAP CE-214.4: the marker of an element read whose base is absent.
 *
 * With `tup := t ↦ (t, 2t)` (typed `(unknown) -> tuple<number, number>`),
 * `x: any` and `x = []`, `tup(x)` is an empty list, its first element
 * `At(tup(x), 1)` is absent, and the interpreter answers `NaN` for
 * `At(At(tup(x), 1), 2)`: it types the read from the values, as `number`
 * (slot 2 of `tuple<number, number>`). The compiled code answered `Missing`
 * (`undefined`), because the static type of the base, built from `x: any`,
 * also has a `list<any>` arm. The user decided on 2026-10-25 (option (c))
 * that the interpreter is unchanged and that the compiled code takes the
 * marker from the slots of the tuples in the static type of the base.
 *
 * The same rule applies to a base typed by one tuple
 * (`b: list<tuple<number, string>>`, `At(At(b, 1), 1)`), and a slot typed
 * `unknown` is no longer read as a number: the join of the slots of
 * `tuple<unknown, number>` is `number`, and the compiled read of slot 1 gave
 * `NaN` where the interpreter gives `Missing`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const TUP: unknown = ['Function', ['Tuple', 't', ['Multiply', 2, 't']], 't'];

describe('CE-214.4: tup(x) with x: any, and with x declared as a list', () => {
  function engine(type = 'list<number>'): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('x', type);
    ce.assign('tup', ce.box(TUP as never));
    return ce;
  }
  const R: unknown = ['At', ['tup', 'x'], 1];

  test('a call of `tup` with an argument typed `any` declines', () => {
    // The parameter of `tup` is a scalar, so the interpreter maps `tup`
    // over a list argument and applies it to a scalar: with `x: any`, the
    // shape of `tup(x)` is known only at run time, and the call declines
    // (`docs/plans/2026-10-31-static-shape-compilation.md`, R3).
    const ce = engine('any');
    const r = compile(
      ce.box([
        'Function',
        ['At', R, 2],
        ['Typed', 'x', { str: 'any' }],
      ] as never),
      { to: 'javascript' } as never
    );
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
  });
});
