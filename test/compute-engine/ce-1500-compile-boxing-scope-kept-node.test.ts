import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compilationScope } from '../../src/compute-engine/compilation/compile-scope';

// CE-1500: `ce.expr(x, { scope })` gives the scope it boxes in to the nodes
// that canonicalization keeps as they were boxed (`PointX(P)`) and to the
// binders (`Sum`), as their `localScope`. The compiler took that scope for
// a scope of the expression: it chose no scope for the compilation, and read `a` from
// the current scope (1), where the evaluation reads the `a` of the boxing
// scope (10). Each compiled value is compared with the interpreter's.

const POINT =
  'tuple<real | signed_infinity | nan, real | signed_infinity | nan>';

/** `P = (3, 4)` and `a = 1` in the document; `a = 10` in a popped scope
 * that `json` is boxed in. */
function witness(json: unknown, pointType = 'tuple<real, real>') {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('P', pointType);
  ce.assign('P', ce.box(['Tuple', 3, 4]));
  ce.declare('a', 'real');
  ce.assign('a', 1);
  const scope = ce.createScope(undefined);
  ce.pushScope(scope);
  ce.declare('a', 'real');
  ce.assign('a', 10);
  ce.popScope();
  return { ce, expr: ce.expr(json as never, { scope }) };
}

/** The interpreter's value of `expr` with `x = 2`. */
function interpreted(
  ce: ComputeEngine,
  expr: ReturnType<typeof witness>['expr']
) {
  return ce.withValues({ x: 2 }, () => expr.evaluate()).re;
}

describe('CE-1500 a node kept from the boxing scope binds no name', () => {
  test.each([
    ['PointX(P) + a', ['Add', ['PointX', 'P'], 'a'], 13],
    ['PointY(P) * a', ['Multiply', ['PointY', 'P'], 'a'], 40],
    ['PointX(P) + a + x', ['Add', ['PointX', 'P'], 'a', 'x'], 15],
    ['a + 0.5 (control)', ['Add', 'a', 0.5], 10.5],
  ])('javascript: %s', (_, json, value) => {
    const { ce, expr } = witness(json);
    expect(interpreted(ce, expr)).toBe(value);
    const result = compile(expr, { fallback: false });
    expect(result.run!({ x: 2 })).toBe(value);
  });

  test('a point type with the non-finite reals (the Tycho witness)', () => {
    const { ce, expr } = witness(
      ['Add', ['PointX', 'P'], 'a'],
      `${POINT} | list<${POINT}>`
    );
    expect(interpreted(ce, expr)).toBe(13);
    const result = compile(expr, { fallback: false });
    expect(result.run!({})).toBe(13);
  });

  test('a binder beside the kept node', () => {
    const json = [
      'Add',
      ['PointX', 'P'],
      ['Sum', ['Multiply', 'a', 'k'], ['Limits', 'k', 1, 3]],
    ];
    const { ce, expr } = witness(json);
    expect(interpreted(ce, expr)).toBe(63);
    const result = compile(expr, { fallback: false });
    expect(result.run!({})).toBe(63);
  });

  test('a binder at the root, which holds the boxing scope', () => {
    const { ce, expr } = witness([
      'Sum',
      ['Multiply', 'a', 'k'],
      ['Limits', 'k', 1, 3],
    ]);
    expect(interpreted(ce, expr)).toBe(60);
    const result = compile(expr, { fallback: false });
    expect(result.run!({})).toBe(60);
  });

  test('a function declared in the boxing scope', () => {
    const ce = new ComputeEngine();
    ce.declare('P', 'tuple<real, real>');
    ce.assign('P', ce.box(['Tuple', 3, 4]));
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('t \\mapsto t + 1'));
    const scope = ce.createScope(undefined);
    ce.pushScope(scope);
    ce.declare('f', 'function');
    ce.assign('f', ce.parse('t \\mapsto 100 t'));
    ce.popScope();
    const expr = ce.expr(['f', ['PointX', 'P']], { scope });
    expect(expr.evaluate().re).toBe(300);
    const result = compile(expr, { fallback: false });
    expect(result.run!({})).toBe(300);
  });

  test('interval-js', () => {
    const { ce, expr } = witness(['Add', ['PointX', 'P'], 'a', 'x']);
    expect(interpreted(ce, expr)).toBe(15);
    const result = compile(expr, { to: 'interval-js', fallback: false });
    expect(result.run!({ x: 2 })).toEqual({
      kind: 'interval',
      value: { lo: 15, hi: 15 },
    });
  });
});

describe('CE-1500 a variable that the expression binds keeps its binding', () => {
  // Each binder names `a`: its own variable, not the `a` of the scope.
  test.each([
    [
      'Sum(2a, a, 1, 3)',
      ['Sum', ['Multiply', 2, 'a'], ['Limits', 'a', 1, 3]],
      12,
    ],
    [
      'PointX(P) + a block local a',
      [
        'Add',
        ['PointX', 'P'],
        [
          'Block',
          [
            'Declare',
            'a',
            ['Dictionary', ['KeyValuePair', { str: 'value' }, 5]],
          ],
          ['Add', 'a', 1],
        ],
      ],
      9,
    ],
    [
      'PointX(P) + a parameter a',
      [
        'Add',
        ['PointX', 'P'],
        ['Apply', ['Function', ['Multiply', 2, 'a'], 'a'], 4],
      ],
      11,
    ],
  ])('javascript: %s', (_, json, value) => {
    const { ce, expr } = witness(json);
    expect(interpreted(ce, expr)).toBe(value);
    const result = compile(expr, { fallback: false });
    expect(result.run!({ x: 2 })).toBe(value);
  });
});

describe('CE-1500 the scope of a binder is not the scope of the compilation', () => {
  test('a Program in a Sum hoists its variable into the Sum: still a scope of the expression', () => {
    const ce = new ComputeEngine();
    ce.declare('a', 'real');
    ce.assign('a', 1);
    const sum = ce.box([
      'Sum',
      ['Program', ['Declare', 'b', 'real', 'k'], ['Multiply', 'b', 'a']],
      ['Limits', 'k', 1, 3],
    ] as never);
    const scope = compilationScope(sum);
    expect(scope).not.toBe(sum.localScope);
  });
});
