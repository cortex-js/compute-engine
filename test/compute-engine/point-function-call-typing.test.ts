import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

/**
 * Two cases of a call of a user function whose parameter is declared as a
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
