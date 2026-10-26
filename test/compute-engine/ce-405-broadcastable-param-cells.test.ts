/**
 * ROADMAP CE-405 (Tycho row 434, user decision 2026-10-24): a parameter
 * declared `broadcastable<T>` whose `T` cannot hold a list (a number, a
 * boolean, a string, a tuple) maps to the cells. Since 0.162.0
 * `broadcastable<T>` is `T | tensor<T>`, so a `broadcastable<number>`
 * parameter called with a matrix maps to its numbers, as an undeclared
 * function and the compiled targets do. Before, the map stopped one rank
 * down (rule 2 of the 2026-08-08 decision) and each row was an
 * `incompatible-type` error, while the call was typed `matrix<2x2>`. A
 * tuple is not mapped into: a list of points maps one point per call. A
 * `T` that can hold a list (`broadcastable<value>`) keeps the one-rank rule.
 *
 * ROADMAP CE-408 (Tycho row 436): the result of the signature of such a
 * function is typed with the parameter read as `T`, since each call of the
 * body receives one `T`.
 *
 * Each case checks that the evaluated value is a value of the static type.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const POINT = 'tuple<number, number>';

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('f', '(broadcastable<number>) -> number');
  ce.assign('f', ce.parse('x \\mapsto x+1'));
  ce.declare('m', '(broadcastable<value>) -> value');
  ce.assign('m', ce.parse('x \\mapsto (x, x)'));
  ce.declare('g', `(broadcastable<${POINT}>) -> ${POINT}`);
  ce.assign('g', ce.parse('a \\mapsto (a.x+1, a.y+1)'));
  return ce;
}

function holds(ce: ComputeEngine, expr: unknown) {
  const boxed = ce.box(expr as any);
  const value = boxed.evaluate();
  expect(value.type.matches(boxed.type)).toBe(true);
  return { type: boxed.type.toString(), value: value.toString() };
}

const L = (...xs: unknown[]) => ['List', ...xs];

describe('CE-405: A broadcastable<T> PARAMETER MAPS TO THE CELLS', () => {
  test('a matrix (Tycho row 434)', () =>
    expect(holds(engine(), ['f', L(L(1, 2), L(3, 4))])).toEqual({
      type: 'matrix<2x2>',
      value: '[[2,3],[4,5]]',
    }));
  test('controls: a vector and a number', () => {
    expect(holds(engine(), ['f', L(1, 2)])).toEqual({
      type: 'vector<2>',
      value: '[2,3]',
    });
    expect(holds(engine(), ['f', 2]).value).toBe('3');
  });
  test('rows of different lengths and depths', () => {
    expect(holds(engine(), ['f', L(L(1, 2), L(3))]).value).toBe('[[2,3],[4]]');
    expect(holds(engine(), ['f', L(1, L(2, 3))]).value).toBe('[2,[3,4]]');
  });
  test('a list of points maps one point per call (Tycho control)', () => {
    expect(
      holds(engine(), ['g', L(['Tuple', 1, 2], ['Tuple', 3, 4])]).value
    ).toBe('[(2, 3),(4, 5)]');
    expect(holds(engine(), ['g', ['Tuple', 1, 2]]).value).toBe('(2, 3)');
    expect(
      holds(engine(), ['g', L(L(['Tuple', 1, 2]), L(['Tuple', 3, 4]))]).value
    ).toBe('[[(2, 3)],[(4, 5)]]');
  });
  test('broadcastable<value> keeps the one-rank rule, typed one level', () => {
    // Each element of the list is a row, `vector<integer^2> |
    // vector<integer^3>`, and the body `(x, x)` is typed with that row.
    expect(holds(engine(), ['m', L(L(1, 2), L(3, 4, 5))])).toEqual({
      type: 'list<tuple<vector<integer^2> | vector<integer^3>, vector<integer^2> | vector<integer^3>>>',
      value: '[([1,2], [1,2]),([3,4,5], [3,4,5])]',
    });
  });
});

describe('CE-405: COMPILED', () => {
  test('a matrix argument compiles to the element-wise call', () => {
    const ce = engine();
    ce.declare('M', 'matrix<number>');
    const r = compile(ce.box(['f', 'M']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(
      r.run({
        M: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });
  test('a list of points compiles one call per point (ROADMAP CE-412)', () => {
    const ce = engine();
    ce.declare('P', `list<${POINT}>`);
    const r = compile(ce.box(['g', 'P']), {
      to: 'javascript',
      fallback: false,
    } as any) as any;
    expect(r.success).toBe(true);
    expect(
      r.run({
        P: [
          [1, 2],
          [3, 4],
        ],
      })
    ).toEqual([
      [2, 3],
      [4, 5],
    ]);
  });
});

describe('CE-408: THE BODY SEES ONE T (Tycho row 436)', () => {
  test('the result of the signature is typed for one point', () => {
    const ce = new ComputeEngine();
    ce.declare('l', { signature: `(broadcastable<${POINT}>) -> unknown` });
    ce.assign(
      'l',
      ce.expr([
        'Function',
        [
          'Sqrt',
          ['Add', ['Square', ['PointX', 'A']], ['Square', ['PointY', 'A']]],
        ],
        ['Typed', 'A', `broadcastable<${POINT}>`],
      ])
    );
    ce.declare('P', `${POINT} | list<${POINT}>`);
    ce.assign('P', ce.parse('[(3,4),(6,8)]'));
    expect(String(ce.expr('l').type)).not.toContain('-> broadcastable');
    expect(String(ce.parse('\\frac{P}{l(P)}').type)).not.toContain('tensor');
    expect(ce.parse('l(P)').evaluate().toString()).toBe('[5,10]');
    expect(ce.parse('l((3,4))').evaluate().toString()).toBe('5');
  });
});

describe('CE-405: EDGE CASES', () => {
  test('evaluateAsync gives the value evaluate gives', async () => {
    const ce = engine();
    const expr = ce.box(['f', L(L(1, 2), L(3, 4))]);
    expect((await expr.evaluateAsync()).toString()).toBe(
      expr.evaluate().toString()
    );
  });

  test('an element that is not a number is an error in its cell', () => {
    const ce = engine();
    const value = ce.box(['f', L(L(1, "'a'"), 3)]).evaluate();
    expect(value.op1.op1.toString()).toBe('2');
    expect(value.op1.op2.toString()).toContain('incompatible-type');
    expect(value.op2.toString()).toBe('4');
  });

  test('the other mapped elements are checked before a row is mapped again', () => {
    const ce = new ComputeEngine();
    ce.declare(
      'two',
      '(broadcastable<number>, broadcastable<number>) -> number'
    );
    ce.assign('two', ce.box(['Function', 7, 'a', 'b'] as any));
    const value = ce.box(['two', L(L(1, 2)), L("'a'")]).evaluate();
    expect(value.op1.toString()).toContain('incompatible-type');
  });

  test('a call that maps a broadcastable<value> slot keeps the one-rank rule', () => {
    // Mapping one operand to the cells and another one rank down would give
    // results that depend on the size of the source.
    const ce = new ComputeEngine();
    ce.declare('k', '(broadcastable<number>, broadcastable<value>) -> value');
    ce.assign('k', ce.box(['Function', ['Tuple', 'a', 'b'], 'a', 'b'] as any));
    const value = ce.box(['k', L(L(1, 2), 3), L(L(0), L(1))]).evaluate();
    expect(value.op1.toString()).toContain('incompatible-type');
    expect(value.op2.toString()).toBe('(3, [1])');
    // Only the number slot maps: the call maps to the cells.
    const cells = ce.box(['k', L(L(1, 2), L(3, 4)), 5]);
    const v = cells.evaluate();
    expect(v.toString()).toBe('[[(1, 5),(2, 5)],[(3, 5),(4, 5)]]');
    expect(v.type.matches(cells.type)).toBe(true);
  });
});
