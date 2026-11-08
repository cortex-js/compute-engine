/**
 * The derivative of a symbol that holds a point is the zero point, not the
 * scalar `0`, because `Add` of a point and a number is a type error. With
 * `p := (1, 2)`, the derivative of a coordinate of a sum, a product or a
 * call that holds `p` gives the same value as with the literal point
 * `(1, 2)` in its place.
 *
 * The zero is built from the value of the symbol when it is known (an
 * absent element stays absent), otherwise from its type. A symbol whose
 * type cannot hold a point (a number, a list of numbers) keeps the scalar
 * `0`. The product rule leaves out the zero term of a constant point.
 *
 * The chain rule `F′(g)·g′` declines when the argument `g` is a point: the
 * partial derivative is then a gradient, and the product would give a
 * point for the derivative of a number (`Norm(p - (sin u, u))`).
 *
 * Corpus: the "Sorry" text of the Desmos document `art/2ki2hjsouf` (Tycho)
 * offsets a curve along its normal with `d/du S(u).y`, and pieces of the
 * curve add the named points `p_1` and `p_2`.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('p', {
  type: 'tuple<real, real>',
  value: ce.box(['Tuple', 1, 2]),
});
ce.declare('S', {
  type: 'list<tuple<real, real>>',
  value: ce.box(['List', ['Tuple', 1, 2], ['Tuple', 3, 4]]),
});
ce.declare('M', {
  type: 'list<tuple<real, real>>',
  value: ce.box(['List', ['Tuple', 1, 2], 'Missing']),
});
ce.declare('q', 'tuple<real, real>');
ce.declare('V', { type: 'list<real>', value: ce.box(['List', 1, 2, 3]) });
ce.parse('g(t, z) \\coloneq t^2 z').evaluate();

const curve = ['Tuple', ['Sin', 'u'], ['Power', 'u', 2]];
const u2 = ['Power', 'u', 2];

function d(json: unknown): unknown {
  return ce.box(json as never).evaluate().json;
}

describe('CE-1115: the derivative of an expression with a named point', () => {
  test('a coordinate of a named point plus a curve', () => {
    expect(d(['D', ['PointY', ['Add', 'p', curve]], 'u'])).toEqual(
      d(['Multiply', 2, 'u'])
    );
    expect(d(['D', ['PointX', ['Add', 'p', curve]], 'u'])).toEqual([
      'Cos',
      'u',
    ]);
  });

  test('a coordinate of a named point times a function', () => {
    expect(d(['D', ['PointY', ['Multiply', u2, 'p']], 'u'])).toEqual(
      d(['Multiply', 4, 'u'])
    );
  });

  test('a coordinate of a call with a named point as an argument', () => {
    expect(d(['D', ['PointY', ['g', 'u', 'p']], 'u'])).toEqual(
      d(['Multiply', 4, 'u'])
    );
  });

  test('a coordinate of a named list of points times a function', () => {
    expect(d(['D', ['PointY', ['Multiply', u2, 'S']], 'u'])).toEqual(
      d(['List', ['Multiply', 4, 'u'], ['Multiply', 8, 'u']])
    );
  });

  test('a point bound by a Block, as a Desmos `with` binding', () => {
    expect(
      d([
        'Block',
        ['Declare', 'w', "'unknown'", ['Tuple', 1, 2]],
        ['D', ['PointY', ['Multiply', u2, 'w']], 'u'],
      ])
    ).toEqual(d(['Multiply', 4, 'u']));
  });

  test('LaTeX: a function whose formula adds a named point', () => {
    const engine = new ComputeEngine();
    engine.assign('p_1', engine.box(['Tuple', 1, 2]));
    engine.parse('C(u) \\coloneq p_1 + (\\sin u, u^2)').evaluate();
    expect(engine.parse('\\frac{d}{du} C(u).y').evaluate().json).toEqual(
      engine.box(['Multiply', 2, 'u']).evaluate().json
    );
  });

  test('the derivative of a named point is the zero point', () => {
    expect(d(['D', 'p', 'u'])).toEqual(['Tuple', 0, 0]);
    // A point with no value: the zero is built from its type.
    expect(d(['D', 'q', 'u'])).toEqual(['Tuple', 0, 0]);
    expect(d(['D', ['Add', 'p', curve], 'u'])).toEqual(
      d(['Tuple', ['Cos', 'u'], ['Multiply', 2, 'u']])
    );
  });

  test('an absent element of a named list stays absent', () => {
    expect(d(['D', ['Multiply', u2, 'M'], 'u'])).toEqual(
      d([
        'List',
        ['Tuple', ['Multiply', 2, 'u'], ['Multiply', 4, 'u']],
        'Missing',
      ])
    );
  });

  test('a named list of numbers keeps the scalar zero', () => {
    expect(d(['D', 'V', 'u'])).toEqual(0);
    expect(d(['D', ['Multiply', 'u', 'V'], 'u'])).toEqual(['List', 1, 2, 3]);
    // A declared length over the size limit of a differentiation: no zero
    // list is built.
    const engine = new ComputeEngine();
    engine.declare('W', 'vector<real^30000>');
    expect(engine.box(['D', 'W', 'u']).evaluate().json).toEqual(0);
  });

  test('the product rule leaves out the zero term of a constant point', () => {
    expect(d(['D', ['Multiply', u2, 'q'], 'u'])).toEqual(
      d(['Multiply', 2, 'u', 'q'])
    );
    // Every factor is constant: the result is the zero point.
    expect(d(['D', ['Multiply', 2, 'p'], 'u'])).toEqual(['Tuple', 0, 0]);
  });

  test('a function of a point argument declines', () => {
    // The partial derivative with respect to a point is a gradient: the
    // chain rule cannot multiply it by the derivative of the point.
    for (const arg of [
      ['Subtract', 'p', ['Tuple', ['Sin', 'u'], 'u']],
      ['Subtract', ['Tuple', 1, 2], ['Tuple', ['Sin', 'u'], 'u']],
      ['Multiply', 'u', 'p'],
    ]) {
      const result = ce.box(['D', ['Norm', arg], 'u']).evaluate();
      expect(result.operator).toBe('D');
    }
    expect(
      ce.box(['D', ['f', ['Tuple', 'u', u2]], 'u']).evaluate().operator
    ).toBe('D');
  });

  test('a derivative key that gives a number for a point argument', () => {
    // The Jacobian of `G` is `2·I`, so the chain rule multiplies `2` by the
    // derivative of the point.
    const engine = new ComputeEngine();
    engine.declare('G', {
      signature: '(tuple<real, real>) -> tuple<real, real>',
      derivative: [['Function', 2, 'z']],
    });
    expect(
      engine.box(['D', ['G', ['Tuple', 'u', u2]], 'u']).evaluate().json
    ).toEqual(engine.box(['Tuple', 2, ['Multiply', 4, 'u']]).evaluate().json);
  });

  test('a constant point inside a call that gives a number', () => {
    // `h(u, (1, 2))` is a number: the chain rule of `k` applies.
    const engine = new ComputeEngine();
    engine.declare('h', '(real, tuple<real, real>) -> real');
    engine.declare('k', '(real) -> real');
    const result = engine
      .box(['D', ['k', ['h', 'u', ['Tuple', 1, 2]]], 'u'])
      .evaluate();
    expect(result.operator).toBe('Multiply');
  });
});
