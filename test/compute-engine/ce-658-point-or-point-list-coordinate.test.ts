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

const EXAMPLES: [string, unknown, string][] = [
  // name, expression, javascript code
  ['At(P, 1) + x', ['Add', ['At', 'P', 1], 'x'], '_.x + 3'],
  ['At(P, 2) - x', ['Subtract', ['At', 'P', 2], 'x'], '-_.x + 4'],
  ['f(x) + x', ['Add', ['f', 'x'], 'x'], '_.x + 3'],
  ['PointX(P) + x', ['Add', ['PointX', 'P'], 'x'], '_.x + 3'],
];

const SAMPLES = [-2, 0.5, 5];

/** The value that the interpreter gives for `expr` at `x`. */
function interpreted(expr: Expression, x: number): number {
  return expr.subs({ x }).N().re;
}

/** The single number of a point interval that `interval-js` gives. */
function pointInterval(result: any): number {
  expect(result.kind).toBe('interval');
  expect(result.value.lo).toBe(result.value.hi);
  return result.value.lo;
}

describe('CE-658: javascript and interval-js give the interpreter values', () => {
  test.each(EXAMPLES)('%s', (_name, json, jsCode) => {
    const ce = engine(['Tuple', 3, 4]);
    const expr = ce.box(json as any);
    const js = compile(expr, { fallback: false });
    expect(js.success).toBe(true);
    expect(js.code).toBe(jsCode);
    const interval = compile(expr, { to: 'interval-js', fallback: false });
    expect(interval.success).toBe(true);
    for (const x of SAMPLES) {
      const expected = interpreted(expr, x);
      expect(js.run!({ x })).toBe(expected);
      expect(pointInterval(interval.run!({ x }))).toBe(expected);
    }
  });

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

  test.each(['javascript'] as const)(
    '%s: no assigned value compiles the point member',
    (to) => {
      const ce = engine();
      expect(declineOf(ce.box(sum as any), to)).toBeUndefined();
    }
  );

  test('no assigned value: the point member gives the interpreter value', () => {
    const ce = engine();
    const expr = ce.box(sum as any);
    const js = compile(expr, { fallback: false });
    for (const x of SAMPLES) {
      const expected = expr
        .subs({ x, P: ce.box(['Tuple', 3, 4]) })
        .N().re;
      expect(js.run!({ x, P: [3, 4] } as any)).toBe(expected);
    }
  });

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
          /an operand may be a point/
        );
    }
  );

  test('a vars entry wins over the assigned value', () => {
    // `P` is read from the vars object, not replaced by `(3, 4)`.
    const ce = engine(['Tuple', 3, 4]);
    const r = compile(ce.box(['Add', ['PointX', 'P'], 'x']), {
      fallback: false,
      vars: { P: '_.P' },
    });
    expect(r.success).toBe(true);
    expect(r.code).toContain('_.P');
    expect(r.run!({ x: 1, P: [10, 20] } as any)).toBe(11);
    const mapped = compile(ce.box(sum as any), {
      fallback: false,
      vars: { P: '_.P' },
    });
    expect(mapped.success).toBe(true);
    expect(mapped.run!({ x: 1, P: [10, 20] } as any)).toBe(11);
  });
});

describe('CE-658: a call that runs code of the caller is left as written', () => {
  test('a head that a function-form `operators` overrides', () => {
    // `operators` maps `f` to `+`, so `f(x, y)` is `x + y`, not the body of
    // `f` with `(3, 4)` in place of `P`.
    const ce = engine(['Tuple', 3, 4]);
    ce.declare('y', 'real');
    ce.declare('f2', 'function');
    ce.assign('f2', ce.box(['Function', ['At', 'P', 1], 'a', 'b']));
    const r = compile(ce.box(['f2', 'x', 'y']), {
      fallback: false,
      operators: (op: string) => (op === 'f2' ? ['+', 11] : undefined),
    } as any);
    expect(r.success).toBe(true);
    expect(r.run!({ x: 10, y: 20 })).toBe(30);
  });

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

  test('a body that reads its parameter twice is not substituted', () => {
    // A substitution would write `_.draw()` twice.
    const ce = engine(['Tuple', 3, 4]);
    ce.declare('h', 'function');
    ce.assign(
      'h',
      ce.box(['Function', ['Multiply', ['Add', 't', 't'], ['At', 'P', 1]], 't'])
    );
    // The call stays a call, and its body is compiled with the point-or-list
    // type of `P`, which the JavaScript target declines.
    expect(() =>
      compile(ce.box(['h', 'x']), {
        fallback: false,
        vars: { x: '_.draw()' },
      })
    ).toThrow(/scalar arithmetic over a possibly list-valued operand/);
    // Control: without the `vars` entry, the call is replaced by the body of
    // `h`, with the point `(3, 4)` in place of `P`.
    const r = compile(ce.box(['h', 'x']), { fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe('(_.x + _.x) * 3');
    expect(r.run!({ x: 2 })).toBe(12);
  });
});
