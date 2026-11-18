/**
 * CE-658: a coordinate of a symbol declared
 * `tuple<number, number> | list<tuple<number, number>>` (a point or a list
 * of points), when the symbol has an assigned point.
 *
 * With `P := (3, 4)`, the interpreter gives `At(P, 1) + x` = `3 + x`. The
 * declared type of `At(P, 1)` is `missing | number | tuple<number, number>`,
 * and the checks of the `javascript` and `interval-js` targets
 * that read it declined the sum ("an operand may be a point"). Every
 * target now writes the assigned point in place of `P` at its compile
 * entry, and replaces a call whose body then is a point or a number by its
 * body, as the shader targets did before (`inlinePointValuesAtRoot()` in
 * `src/compute-engine/compilation/point-value-inlining.ts`). The
 * compilation then reads the type of the tuple `(3, 4)`.
 *
 * The declines that stay: an assigned list of points (the interpreter gives
 * an error for `At(P, 1) + x` too). A `P` with no assigned value, or that a
 * `vars` entry maps (the value of the entry wins over the assigned value,
 * as on the shader targets), is an input declared with a union of shapes:
 * the code has one body per member (CE-712.2). For a list of points, the
 * interpreter gives an error for `At(P, 1) + x`, and the static type of the
 * sum does not show it, so that member has no body, and the code reads
 * `P` as a point.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';

const UNION = 'tuple<number, number> | list<tuple<number, number>>';

function engine(value?: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('P', UNION);
  if (value !== undefined) ce.assign('P', ce.box(value as any));
  ce.declare('f', 'function');
  ce.assign('f', ce.box(['Function', ['At', 'P', 1], 't']));
  return ce;
}

/** The single number of a point interval that `interval-js` gives. */
function pointInterval(result: any): number {
  expect(result.kind).toBe('interval');
  expect(result.value.lo).toBe(result.value.hi);
  return result.value.lo;
}

describe('CE-658: javascript and interval-js give the interpreter values', () => {

  test('the compiled code holds the value at compile time', () => {
    // A later assignment does not change the compiled code, as for any
    // other symbol whose value the code holds.
    const ce = engine(['Tuple', 3, 4]);
    const js = compile(ce.box(['Add', ['At', 'P', 1], 'x']), {
      fallback: false,
    });
    ce.assign('P', ce.box(['Tuple', 10, 20]));
    expect(js.run!({ x: 1 })).toBe(4);
  });
});

/**
 * The message of the decline of `expr` on `to`: a target throws it or
 * returns it in `error`. `undefined` when the compilation succeeds.
 */
function declineOf(
  expr: Expression,
  to: 'javascript' | 'interval-js',
  vars?: Record<string, string>
): string | undefined {
  try {
    const r = compile(expr, { to, fallback: false, vars });
    return r.success ? undefined : (r.error ?? '');
  } catch (e) {
    return (e as Error).message;
  }
}

describe('CE-658: the declines that stay', () => {
  const sum = ['Add', ['At', 'P', 1], 'x'];

  test.each(['javascript', 'interval-js'] as const)(
    '%s: an assigned list of points',
    (to) => {
      // The first element of a list of points is a point, and the
      // interpreter gives an error for the sum of a point and a number.
      const ce = engine(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]);
      expect(ce.box(sum as any).subs({ x: 5 }).evaluate().operator).toBe(
        'Error'
      );
      if (to === 'interval-js') {
        // The decline is at the sum of the point and the number.
        let diagnostic: { code: string; operator?: string } | undefined;
        try {
          compile(ce.box(sum as any), { to, fallback: false });
        } catch (e) {
          diagnostic = compileDiagnosticOf(e);
        }
        expect(diagnostic?.code).toBe('outside-profile');
        expect(diagnostic?.operator).toBe('Add');
      } else
        expect(declineOf(ce.box(sum as any), to)).toMatch(
          /Add of a tuple: its value on a tuple is not its value on a list/
        );
    }
  );

});

describe('CE-658: a call that runs code of the caller is left as written', () => {

  test.each(['javascript'] as const)(
    '%s: an argument that a `vars` entry gives as caller source',
    (to) => {
      // The body of `f` does not read its parameter. The call stays a
      // call, and its code evaluates `_.draw()` once per run, as before the
      // rewrite.
      const ce = engine(['Tuple', 3, 4]);
      const r = compile(ce.box(['f', 'x']), {
        to,
        fallback: false,
        vars: { x: '_.draw()' },
      });
      expect(r.success).toBe(true);
      let calls = 0;
      const draw = () => {
        calls += 1;
        return 2;
      };
      const value = r.run!({ draw } as any);
      expect(calls).toBe(1);
      if (to === 'javascript') expect(value).toBe(3);
      else expect(pointInterval(value)).toBe(3);
    }
  );

});
