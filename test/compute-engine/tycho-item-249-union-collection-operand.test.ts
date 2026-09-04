/**
 * Tycho item 249: on the `javascript` target, an operand whose static type is
 * a scalar-or-collection UNION — `integer | vector<integer^2>`, the type of a
 * `Which` whose arms return a 2-element list or the scalar `-1`, or a declared
 * `u: integer | list<integer>` — was claimed by the scalar code paths. The
 * collection form `Sum(x)` / `Product(x)` (Desmos `.total`) failed closed
 * with "no indexing set", and arithmetic over it compiled to the bare scalar
 * operators, which return wrong values behind `success: true` (`2 * [1, 2]`
 * is `NaN`, `[1, 2] + 1` is the string `"1,21"`).
 *
 * Two mechanisms:
 *
 * 1. The compile-side possibly-collection predicates
 *    (`isPossiblyCollectionTypedJS`, `isBoundPossiblyCollectionTyped`) admit
 *    such a union through the shared `unionAdmitsIndexedCollection`, so the
 *    operand takes the run-time-dispatching lowerings: the `Array.isArray`
 *    guarded reduce for `Sum`/`Product`, `_SYS.bcast` for arithmetic and
 *    comparisons, the element-wise fold for an indexed big op whose body is
 *    such a union. A scalar at run time answers as a scalar, an array
 *    element-wise, as the interpreter does.
 * 2. The TYPING of arithmetic over a union whose collection branch is a
 *    dimensioned list (`integer | vector<integer^2>`) fell through to the
 *    scalar tiers — `2·u` and `sin(u)` typed `number` — because a fixed shape
 *    is left to the tensor handlers, which never see a union. Inside a union
 *    the branch now counts as a broadcast collection and keeps its dimensions
 *    (`number | vector<2>`).
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { Expression } from '../../src/compute-engine/global-types';

const ce = new ComputeEngine();
ce.declare('c', 'boolean');
ce.declare('u', 'integer | list<integer>');
ce.declare('v', 'integer | vector<integer^2>');
ce.declare('x', 'number');
// The witness's helper: a piecewise returning a 2-element list OR the scalar
// `-1`, whose `.total` the document takes.
ce.assign(
  'h',
  ce.box([
    'Function',
    ['Which', ['Greater', 't', 0], ['List', 't', 1], 'True', -1],
    't',
  ])
);

/** `Which(c, [1, 2], True, -1)` — typed `integer | vector<integer^2>`. */
const w = ['Which', 'c', ['List', 1, 2], 'True', -1];

function js(expr: Expression) {
  const r = compile(expr, { to: 'javascript', fallback: false }) as any;
  if (!r.success) throw new Error(`declined: ${String(r.error)}`);
  return r as { code: string; run: (vars: Record<string, unknown>) => any };
}

/** A boxed result as the plain JS value the compiled runner answers: a
 * `List` as an array (recursively), `True`/`False` as booleans, a number as a
 * number. */
function plain(e: Expression): unknown {
  if (e.operator === 'List') return e.ops!.map(plain);
  if (e.symbol === 'True') return true;
  if (e.symbol === 'False') return false;
  return e.valueOf();
}

/** The interpreter's answer with `c` (and the union symbols) substituted. */
function interpret(expr: Expression, c: boolean) {
  const list = ce.box(['List', 1, 2]);
  const scalar = ce.box(-1);
  return plain(
    expr
      .subs({
        c: ce.box(c ? 'True' : 'False'),
        u: c ? list : scalar,
        v: c ? list : scalar,
        x: ce.box(c ? 2 : -1),
      })
      .N()
  );
}

describe('Tycho item 249 — Sum/Product over a scalar-or-collection union', () => {
  it('the Which shape types a union and takes the guarded reduce', () => {
    const expr = ce.box(['Sum', w]);
    expect(expr.op1.type.toString()).toBe('integer | vector<integer^2>');
    const { code, run } = js(expr);
    expect(code).toContain('Array.isArray(_c) ? _c.reduce(');
    expect(run({ c: true })).toBe(3);
    expect(run({ c: false })).toBe(-1);
    expect(interpret(expr, true)).toBe(3);
    expect(interpret(expr, false)).toBe(-1);
  });

  it('Product takes the same guarded reduce', () => {
    const expr = ce.box(['Product', w]);
    const { run } = js(expr);
    expect(run({ c: true })).toBe(2);
    expect(run({ c: false })).toBe(-1);
  });

  it('a declared union symbol reduces the same way', () => {
    const expr = ce.box(['Sum', 'u']);
    const { run } = js(expr);
    expect(run({ u: [1, 2] })).toBe(3);
    expect(run({ u: -1 })).toBe(-1);
  });

  it('the witness: `.total` of a helper returning a list or a scalar', () => {
    const expr = ce.box(['Sum', ['h', 'x']]);
    const { run } = js(expr);
    expect(run({ x: 2 })).toBe(3);
    expect(run({ x: -1 })).toBe(-1);
    expect(interpret(expr, true)).toBe(3);
    expect(interpret(expr, false)).toBe(-1);
  });

  it('a union of collections only is provably array-shaped and reduces bare', () => {
    const expr = ce.box(['Sum', ['Which', 'c', ['List', 1, 2], 'True', ['List', 3]]]);
    const { code, run } = js(expr);
    expect(code).not.toContain('Array.isArray(_c)');
    expect(run({ c: true })).toBe(3);
    expect(run({ c: false })).toBe(3);
  });
});

describe('Tycho item 249 — arithmetic and comparison over the union', () => {
  it.each([
    ['Multiply', ['Multiply', 2, w], [2, 4], -2],
    ['Add', ['Add', w, 1], [2, 3], 0],
    ['Subtract', ['Subtract', w, 1], [0, 1], -2],
    ['Sin', ['Sin', w], [Math.sin(1), Math.sin(2)], Math.sin(-1)],
    ['Power', ['Power', w, 2], [1, 4], 1],
    ['Less', ['Less', w, 1.5], [true, false], true],
  ])('%s broadcasts on the run-time shape', (_head, body, onList, onScalar) => {
    const expr = ce.box(body as any);
    const { code, run } = js(expr);
    expect(code).toContain('_SYS.bcast(');
    expect(run({ c: true })).toEqual(onList);
    expect(run({ c: false })).toEqual(onScalar);
  });

  it('matches the interpreter on both branches', () => {
    // Element-wise within a tolerance: the interpreter evaluates `sin` at its
    // own precision, JavaScript through `Math.sin`, and the two can differ in
    // the last bit.
    const expectClose = (got: unknown, want: unknown): void => {
      if (Array.isArray(want)) {
        expect(Array.isArray(got)).toBe(true);
        expect((got as unknown[]).length).toBe(want.length);
        want.forEach((w, i) => expectClose((got as unknown[])[i], w));
      } else expect(got as number).toBeCloseTo(want as number, 12);
    };
    for (const body of [
      ['Multiply', 2, w],
      ['Add', w, 1],
      ['Multiply', 2, 'u'],
      ['Sin', 'v'],
    ]) {
      const expr = ce.box(body as any);
      const { run } = js(expr);
      expectClose(
        run({ c: true, u: [1, 2], v: [1, 2] }),
        interpret(expr, true)
      );
      expectClose(run({ c: false, u: -1, v: -1 }), interpret(expr, false));
    }
  });

  it('an indexed Sum whose body is the union takes the element-wise fold', () => {
    // Before: the body typed `number`, the scalar arm unrolled `a + b + c`
    // over arrays, and the result was the string `"2,42,42,4"`.
    const expr = ce.box(['Sum', ['Multiply', 2, w], ['Limits', 'k', 1, 3]]);
    const { run } = js(expr);
    expect(run({ c: true })).toEqual([6, 12]);
    expect(run({ c: false })).toBe(-6);
    expect(interpret(expr, true)).toEqual([6, 12]);
    expect(interpret(expr, false)).toBe(-6);
  });
});

describe('Tycho item 249 — what the union admission refuses', () => {
  it('a tuple branch is atomic: a `boolean | tuple` condition selects as a scalar', () => {
    // The interpreter refuses a tuple condition (a tuple is a point, never an
    // element-wise mask), so the compiled selection must not route such a
    // condition through `_SYS.select`.
    ce.declare('tb', 'boolean | tuple<boolean, boolean>');
    const r = compile(ce.box(['Which', 'tb', 1, 'True', 0]), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.select');
    expect(r.run!({ tb: true })).toBe(1);
  });

  it('a nominal branch keeps the whole union atomic', () => {
    // `Bag` is an opaque nominal over a list: the interpreter binds a `Bag`
    // value whole and leaves `2·w` symbolic, so compilation must not
    // broadcast over the erased array (the 2026-08-12 atomicity ruling).
    const engine = new ComputeEngine();
    engine.declareType('Bag', 'list<number>');
    engine.declare('w2', 'integer | Bag');
    const r = compile(engine.box(['Multiply', 2, 'w2']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).not.toContain('_SYS.bcast');
    expect(r.run!({ w2: 3 })).toBe(6);
  });

  it('a complex-valued scalar-or-collection union fails closed', () => {
    // Before, the union was claimed by the scalar path and `2 * [a, b]`
    // compiled to a silent `NaN`; the element lane analysis now sees a
    // possibly-array operand with complex evidence and declines, as it does
    // for `broadcastable<complex>`.
    ce.declare('zc', 'complex | vector<complex^2>');
    expect(() =>
      compile(ce.box(['Multiply', 2, 'zc']), { to: 'javascript', fallback: false })
    ).toThrow(/Fail closed/);
  });
});

describe('Tycho item 249 — typing of a union with a dimensioned list branch', () => {
  it.each([
    [['Multiply', 2, 'v'], 'number | vector<2>'],
    [['Sin', 'v'], 'number | vector<2>'],
    [['Power', 'v', 2], 'number | vector<2>'],
    [['Multiply', 2, w], 'number | vector<2>'],
    [['Negate', w], 'integer | vector<integer^2>'],
  ])('%j types %s', (body, type) => {
    expect(ce.box(body as any).type.toString()).toBe(type);
  });

  it('a bare vector operand is still typed by the tensor handlers', () => {
    expect(ce.box(['Multiply', 2, ['List', 1, 2]]).type.toString()).toBe(
      'vector<integer^2>'
    );
    ce.declare('m', 'matrix<2x2>');
    expect(ce.box(['Multiply', 2, 'm']).type.toString()).toBe('matrix<2x2>');
  });

  it('a union with no genuine scalar branch is not recruited by the lift', () => {
    // A fixed-shape branch broadcasts against a SCALAR sibling. Beside a
    // tuple or another fixed shape there is nothing to broadcast against,
    // and typing the tuple branch through the scalar lift would describe a
    // tuple value by a scalar cell — so these keep the typing they had (the
    // tensor handlers' gap for a union is unchanged by this change).
    ce.declare('tv', 'tuple<number, number> | vector<number^2>');
    ce.declare('vv', 'vector<2> | vector<3>');
    expect(ce.box(['Sin', 'tv']).type.toString()).toBe('number');
    expect(ce.box(['Multiply', 2, 'vv']).type.toString()).toBe('number');
  });

  it('a dimensionless union still types per branch', () => {
    expect(ce.box(['Multiply', 2, 'u']).type.toString()).toBe(
      'list<number> | number'
    );
  });
});
