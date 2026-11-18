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
 * A `Which` whose branches are a list and a number now declines with
 * `unsettled-shape` (`docs/COMPILATION-MODEL.md`, "Fail closed"): the
 * compiled code gives each value one shape. The tests check that decline for
 * the `Which`, and check the run-time dispatch with the symbol `v`, declared
 * with the same union type, `integer | vector<integer^2>`.
 *
 * Two mechanisms:
 *
 * 1. The compile-side possibly-collection predicates
 *    (`isPossiblyCollectionTypedJS`, `isBoundPossiblyCollectionTyped`) admit
 *    such a union through the shared `unionAdmitsIndexedCollection`, so the
 *    operand takes the run-time-dispatching lowerings: the `Array.isArray`
 *    guarded reduce for `Sum`/`Product`, one `Array.isArray` test of the
 *    union symbol for arithmetic and comparisons, with one body for each
 *    member of the union, the element-wise fold for an indexed big op whose body is
 *    such a union. A scalar at run time answers as a scalar, an array
 *    element-wise, as the interpreter does.
 * 2. The TYPING of arithmetic over a union whose collection branch is a
 *    dimensioned list (`integer | vector<integer^2>`) fell through to the
 *    scalar tiers — `2·u` and `sin(u)` typed `number` — because a fixed shape
 *    is left to the tensor handlers, which never see a union. Inside a union
 *    the branch now counts as a broadcast collection and keeps its dimensions
 *    (`integer | vector<integer^2>` for `2·u`).
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

/** Expect the compilation of `expr` to decline because a `Which` in it has
 * branches of different shapes (a list and a number), so the shape of its
 * value is known only at run time. The symbol `v`, declared with the same
 * union type, `integer | vector<integer^2>`, takes the run-time dispatch that
 * the `Which` took before this decline. */
function expectUnsettled(expr: Expression): void {
  const r = compile(expr, { to: 'javascript' });
  expect(r.success).toBe(false);
  expect(r.diagnostic?.code).toBe('unsettled-shape');
}

/** Expect the compilation of `expr` to decline because the body of one
 * member of a declared union input declines. */
function expectMemberDecline(expr: Expression): void {
  const r = compile(expr, { to: 'javascript' });
  expect(r.success).toBe(false);
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
    expectUnsettled(expr);
    expect(interpret(expr, true)).toBe(3);
    expect(interpret(expr, false)).toBe(-1);
    // The symbol `v`, declared with the union, has one body for each
    // member. The body of the member `integer` declines (`Sum` of a number
    // has no indexing set), so the compilation declines: one body for both
    // members would test the shape of `v` inside the body.
    expectMemberDecline(ce.box(['Sum', 'v']));
  });

  it('Product takes the same guarded reduce', () => {
    expectUnsettled(ce.box(['Product', w]));
    expectMemberDecline(ce.box(['Product', 'v']));
  });

  it('a declared union symbol declines the same way', () => {
    expectMemberDecline(ce.box(['Sum', 'u']));
  });

  it('the witness: `.total` of a helper returning a list or a scalar', () => {
    // The body of `h` is a `Which` whose branches are a list and a number.
    const expr = ce.box(['Sum', ['h', 'x']]);
    expectUnsettled(expr);
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

describe('Tycho item 249 — what the union admission refuses', () => {

  it('a complex-valued scalar-or-collection union fails closed', () => {
    // Before, the union was claimed by the scalar path and `2 * [a, b]`
    // compiled to a silent `NaN`; the element lane analysis now sees a
    // possibly-array operand with complex evidence and declines, as it does
    // for `broadcastable<complex>`.
    ce.declare('zc', 'complex | vector<complex^2>');
    expect(() =>
      compile(ce.box(['Multiply', 2, 'zc']), { to: 'javascript', fallback: false })
    ).toThrow(/Could not compile/);
  });
});

describe('Tycho item 249 — typing of a union with a dimensioned list branch', () => {
  it.each([
    // Each cell is typed from the union's cell type, `integer`
    // (`scalarOrListUnionCellType`), so the per-element result is narrow.
    [['Multiply', 2, 'v'], 'integer | vector<integer^2>'],
    [['Sin', 'v'], 'real | vector<real^2>'],
    [['Power', 'v', 2], 'integer<0..> | list<integer<0..>^2>'],
    [['Multiply', 2, w], 'integer | vector<integer^2>'],
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
    // tuple there is nothing to broadcast against. A union of a point and a
    // fixed shape is typed arm by arm: the value of `Sin(tv)` is a point or
    // a vector, and `number` held neither. A union of
    // fixed shapes alone is mapped as each of its lists is
    // (`isFixedShapeCollectionTypeOf`, Tycho row 425): `2·vv` is a list of
    // numbers, which `number` did not hold.
    ce.declare('tv', 'tuple<number, number> | vector<number^2>');
    ce.declare('vv', 'vector<2> | vector<3>');
    expect(ce.box(['Sin', 'tv']).type.toString()).toBe(
      'tuple<number, number> | vector<2>'
    );
    expect(ce.box(['Multiply', 2, 'vv']).type.toString()).toBe('list<number>');
  });

  it('a dimensionless union still types per branch', () => {
    expect(ce.box(['Multiply', 2, 'u']).type.toString()).toBe(
      'integer | list<integer>'
    );
  });
});
