/**
 * Written-out DATA evaluates to itself.
 *
 * A canonical `List` or `Tuple` whose every element is a number literal, or
 * such a `List` or `Tuple` in turn, has nothing to evaluate: `evaluate()`
 * answers the node itself, where the general route evaluated every element as
 * a function expression and built an equal node — 25 ms for a list of ten
 * thousand points, at every use of a symbol that holds one — whose caches
 * (its type among them) started empty.
 *
 * The identity is an optimization, so every case also checks the VALUE
 * against what the general route answers.
 */

import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

const POINTS = [
  'List',
  ['Tuple', 1, 2.5, -3],
  ['Tuple', 0.25, 4, 5],
  ['Tuple', 7, 8, 9.75],
];

describe('Written-out data evaluates to itself', () => {
  test.each([
    ['a list of machine numbers', ['List', 0.5, 1.25, -3.75]],
    ['a list of integers', ['List', 1, 2, 3]],
    ['a list of points', POINTS],
    ['a tuple', ['Tuple', 1, 2.5]],
    ['a nested list', ['List', ['List', 1, 2], ['List', 3, 4]]],
    ['an empty list', ['List']],
    ['NaN and the infinities', ['List', 'NaN', 'PositiveInfinity', -1]],
  ])('%s, under evaluate() and under N()', (_label, json) => {
    const e = ce.box(json as never);
    expect(e.evaluate()).toBe(e);
    expect(e.N()).toBe(e);
    expect(e.evaluate().json).toEqual(e.json);
  });

  test('exact rationals: itself under evaluate(), floats under N()', () => {
    const e = ce.box(['List', ['Rational', 1, 4], ['Tuple', ['Rational', 1, 2], 3]]);
    expect(e.evaluate()).toBe(e);
    const n = e.N();
    expect(n).not.toBe(e);
    expect(n.json).toEqual(['List', 0.25, ['Tuple', 0.5, 3]]);
  });

  test('a symbol that holds data answers the same list at every use', () => {
    const data = ce.box(POINTS as never);
    ce.assign('Cdata', data);
    const first = ce.box('Cdata').evaluate();
    expect(first).toBe(data);
    expect(ce.box('Cdata').evaluate()).toBe(first);
    expect(ce.box(['PointY', 'Cdata']).evaluate().json).toEqual([
      'List',
      2.5,
      4,
      8,
    ]);
  });
});

describe('What is not data takes the general route', () => {
  test.each([
    ['a symbol with a value', ['List', 1, 'kdata'], ['List', 1, 5]],
    ['an operation', ['List', ['Add', 1, 'kdata'], 2], ['List', 6, 2]],
    ['a point with an operation', ['List', ['Tuple', 1, ['Multiply', 2, 'kdata']]], ['List', ['Tuple', 1, 10]]],
  ])('%s is evaluated', (_label, json, want) => {
    ce.assign('kdata', 5);
    const e = ce.box(json as never);
    const v = e.evaluate();
    expect(v).not.toBe(e);
    expect(v.json).toEqual(want);
  });

  test('an exact radical stays, and is a float under N()', () => {
    const e = ce.box(['List', ['Sqrt', 2], 1]);
    expect(e.evaluate().json).toEqual(['List', ['Sqrt', 2], 1]);
    // At the default precision the float is a big number, so read its value.
    expect(e.N().ops![0].re).toBeCloseTo(Math.SQRT2, 12);
  });

  test('a list that is not canonical is made canonical first', () => {
    const raw = ce.box(['List', ['Tuple', 1, 2], 3], { form: 'raw' });
    const v = raw.evaluate();
    expect(v.isCanonical).toBe(true);
    expect(v.json).toEqual(['List', ['Tuple', 1, 2], 3]);
  });

  test('any other evaluation option takes the general route', () => {
    const e = ce.box(POINTS as never);
    const v = e.evaluate({ materialization: true });
    expect(v.json).toEqual(e.json);
  });
});

describe('A host operator named `List` or `Tuple` keeps its handler', () => {
  test.each([['List'], ['Tuple']])(
    'a declared `%s` with an evaluate handler is called on number literals',
    (name) => {
      const engine = new ComputeEngine();
      let calls = 0;
      engine.declare(name, {
        signature: '(any*) -> number',
        evaluate: (ops) => {
          calls += 1;
          return engine.number(ops.length);
        },
      });
      const e = engine.box([name, 1, 2, 3] as never);
      expect(e.evaluate().re).toBe(3);
      expect(e.N().re).toBe(3);
      expect(calls).toBe(2);
    }
  );

  test('the library definitions are still recognized in a nested scope', () => {
    const engine = new ComputeEngine();
    engine.pushScope();
    try {
      const e = engine.box(POINTS as never);
      expect(e.evaluate()).toBe(e);
    } finally {
      engine.popScope();
    }
  });
});

describe('A list that holds its numbers unboxed, inside written-out data', () => {
  test('evaluates to itself, under evaluate() and under N()', () => {
    const engine = new ComputeEngine();
    const e = engine.function('List', [
      engine.list([1, 2, 3]),
      engine.list([4.5, 5]),
    ]);
    expect(e.evaluate()).toBe(e);
    expect(e.N()).toBe(e);
  });
});

describe('The answer follows the precision of the engine', () => {
  test('a precision change after the first evaluation', () => {
    const engine = new ComputeEngine();
    engine.precision = 40;
    const third = { num: '0.3333333333333333333333333333333333333333' };
    const e = engine.box(['List', third, ['Tuple', ['Rational', 1, 3], 2]]);
    expect(e.evaluate()).toBe(e);
    const wide = e.N().json as [string, unknown, [string, { num: string }, number]];
    expect(wide[2][1].num.length).toBeGreaterThan(30);
    engine.precision = 'machine';
    expect(e.evaluate()).toBe(e);
    const narrow = e.N().json as [string, unknown, [string, number, number]];
    expect(narrow[2][1]).toBeCloseTo(1 / 3, 15);
  });
});
