import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Three cases of a call of a user function whose parameter is declared as a
 * point (`tuple<real, real>`).
 *
 * - CE-469: with `f: (broadcastable<tuple<real, real>>, tuple<real, real>)
 *   -> real`, a tuple argument binds to a parameter declared as a point, so
 *   the declared result describes the call. Before, every call of `f` with a
 *   tuple argument was typed `any`, the type of a tuple at a SCALAR
 *   parameter.
 * - CE-468: with `g: (tuple<real, real>) -> real` and a symbol typed as a
 *   list or a tensor of points that has no value, `g(L)` stays `g(L)` until
 *   `L` has a value. Before, it was an `incompatible-type` error.
 * - With `E = real | signed_infinity | nan` and `k: (tuple<E, E>) -> unknown`,
 *   a list of points whose components are typed `number` gives a call per
 *   point, as one such point is accepted as the whole argument. Before,
 *   `k(T)` was accepted for `T: tuple<number, number>`, and `k(L)` was an
 *   `incompatible-type` error for `L: list<tuple<number, number>>`.
 */

const POINT = 'tuple<real, real>';
const P = (a: number, b: number) => ['Tuple', a, b];

/** `f(p, q) = p.x + p.y + q.x + 2 q.y`, declared with a `broadcastable`
 * point parameter and a point parameter. */
function engineF(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('f', `(broadcastable<${POINT}>, ${POINT}) -> real`);
  ce.assign(
    'f',
    ce.box([
      'Function',
      [
        'Add',
        ['PointX', 'p'],
        ['PointY', 'p'],
        ['PointX', 'q'],
        ['Multiply', 2, ['PointY', 'q']],
      ],
      'p',
      'q',
    ])
  );
  return ce;
}

/** `g(p) = p.x + 10 p.y`, declared `(tuple<real, real>) -> real`. */
function engineG(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', `(${POINT}) -> real`);
  ce.assign(
    'g',
    ce.box([
      'Function',
      ['Add', ['PointX', 'p'], ['Multiply', 10, ['PointY', 'p']]],
      'p',
    ])
  );
  return ce;
}

describe('CE-469: a tuple at a parameter declared as a point', () => {
  test.each([
    [
      'a matrix of points',
      ['List', ['List', P(1, 2), P(3, 4)], ['List', P(5, 6), P(7, 8)]],
      'matrix<real^(2x2)>',
      '[[6,10],[14,18]]',
    ],
    [
      'a list of points',
      ['List', P(1, 2), P(3, 4)],
      'vector<real^2>',
      '[6,10]',
    ],
    ['one point', P(1, 2), 'real', '6'],
  ])('%s', (_name, arg, type, value) => {
    const ce = engineF();
    const call = ce.box(['f', arg, P(1, 1)] as any);
    expect(call.type.toString()).toBe(type);
    const v = call.evaluate();
    expect(v.toString()).toBe(value);
    expect(v.type.matches(call.type)).toBe(true);
  });
});

describe('CE-468: a valueless list of points keeps the call', () => {
  test.each([
    ['L', `list<${POINT}>`, 'list<real>'],
    ['T', `tensor<${POINT}>`, 'tensor<real>'],
    ['S', `list<list<${POINT}>>`, 'list<list<real>>'],
    ['M', `matrix<${POINT}>`, 'list<list<real>>'],
    ['B', `broadcastable<${POINT}>`, 'broadcastable<real>'],
  ])('g(%s) with %s stays symbolic', (name, decl, type) => {
    const ce = engineG();
    ce.declare(name, decl);
    const call = ce.box(['g', name]);
    expect(call.type.toString()).toBe(type);
    const v = call.evaluate();
    expect(v.toString()).toBe(`g(${name})`);
    expect(v.type.matches(call.type)).toBe(true);
  });

  test('the call maps once the symbol has a value', () => {
    const ce = engineG();
    ce.declare('L', `list<${POINT}>`);
    const call = ce.box(['g', 'L']);
    expect(call.evaluate().toString()).toBe('g(L)');
    ce.assign('L', ce.box(['List', P(1, 2), P(3, 4)]));
    expect(call.evaluate().toString()).toBe('[21,43]');
  });

  test('the asynchronous evaluation keeps the call', async () => {
    const ce = engineG();
    ce.declare('L', `list<${POINT}>`);
    expect((await ce.box(['g', 'L']).evaluateAsync()).toString()).toBe('g(L)');
  });

  test('an Epsil function with an annotated point parameter', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(
      ce,
      'function h(p: tuple<real, real>) -> real { p.x + 10 * p.y }\nlet M: list<tuple<real, real>>\nh(M)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value?.toString()).toBe('h(M)');
  });
});

describe('CE-468: the held call keeps its binding', () => {
  test('a definition of the same name in the current scope does not take the held call', async () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'function h(p: tuple<real, real>) -> real { p.x + 10 * p.y }\nlet M: list<tuple<real, real>>'
    );
    const call = ce.box(['h', 'M']);
    ce.pushScope();
    ce.declare('h', '(number) -> number');
    const v = call.evaluate();
    const w = await call.evaluateAsync();
    ce.popScope();
    expect(v.toString()).toBe('h(M)');
    expect(v.baseDefinition).toBe(call.baseDefinition);
    expect(w.baseDefinition).toBe(call.baseDefinition);
  });

  test('the same for a function held as a value', () => {
    const ce = engineG();
    ce.declare('L', `list<${POINT}>`);
    const call = ce.box(['g', 'L']);
    ce.pushScope();
    ce.declare('g', '(number) -> number');
    const v = call.evaluate();
    ce.popScope();
    expect(v.toString()).toBe('g(L)');
    expect(v.baseDefinition).toBe(call.baseDefinition);
  });
});

describe('a list of points accepted by the rule for one point', () => {
  const E = 'real | signed_infinity | nan';
  const NUMBER_POINT = 'tuple<number, number>';

  /** `k(p) = p.x + p.y`, declared with an extended-real point parameter,
   * and symbols for one point, a list and a matrix of points, and a point
   * or a list of points, all with `number` components. */
  function engineK(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.declare('k', `(tuple<${E}, ${E}>) -> unknown`);
    ce.assign('k', ce.parse('p \\mapsto p.x + p.y'));
    ce.declare('T', NUMBER_POINT);
    ce.declare('L', `list<${NUMBER_POINT}>`);
    ce.declare('M', `matrix<${NUMBER_POINT}>`);
    ce.declare('U', `${NUMBER_POINT} | list<${NUMBER_POINT}>`);
    return ce;
  }

  test('the call over a list or a matrix of points is a call per point', () => {
    const ce = engineK();
    expect(ce.box(['k', 'T']).type.toString()).toBe(
      'nan | real | signed_infinity'
    );
    expect(ce.box(['k', 'L']).type.toString()).toBe(
      'list<nan | real | signed_infinity>'
    );
    expect(ce.box(['k', 'M']).type.toString()).toBe(
      'list<list<nan | real | signed_infinity>>'
    );
    expect(ce.box(['k', 'U']).type.toString()).toBe(
      'list<nan | real | signed_infinity> | nan | real | signed_infinity'
    );
  });

  test('a point type the parameter refuses is refused in a list', () => {
    const ce = engineK();
    ce.declare('S', 'list<tuple<integer, string>>');
    expect(ce.box(['k', 'S']).type.toString()).toBe('error');
  });

  test('the evaluation maps over the points', () => {
    const ce = engineK();
    ce.assign('L', ce.box(['List', P(1, 2), P(3, 4)]));
    expect(ce.box(['k', 'L']).evaluate().toString()).toBe('[3,7]');
  });

  test('the compiled call maps over the points', () => {
    const ce = engineK();
    const r = compile(ce.box(['k', 'L']));
    expect(r.success).toBe(true);
    expect(r.run!({ L: [[1, 2], [3, Infinity]] })).toEqual([3, Infinity]);
  });
});
