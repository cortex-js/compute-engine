/**
 * A function defined by a statement of the compiled program (Epsil's
 * `f(x) = x^2 + 1` at the top level, `DefineFunction`): a call of it is a
 * call of the user function of the binding that the canonical form installed,
 * and the statement writes nothing (CE-1443; README of
 * `src/compute-engine/compilation/ir/`, "User functions").
 */

import { compile } from '../../src/compile';
import { ComputeEngine } from '../../src/compute-engine';

type Json = unknown;

const define = (name: string, body: Json, ...params: string[]): Json => [
  'DefineFunction',
  name,
  ['Function', ['Block', body], ...params],
];
const F = define('f', ['Add', ['Power', 'x', 2], 1], 'x');

const run = (json: Json, to = 'javascript') => {
  const ce = new ComputeEngine();
  ce.declare('y', 'real');
  const interpreted = ce.box(json as never).evaluate();
  const r = compile(ce.box(json as never), {
    to,
    fallback: false,
  } as never) as { run: (x: object) => unknown };
  return { interpreted, compiled: r.run({ y: 2 }) };
};

describe('IR profile: a function defined in the program', () => {
  test('f(x) = x^2 + 1; f(3) is 10', () => {
    const { interpreted, compiled } = run(['Program', F, ['f', 3]]);
    expect(interpreted.toString()).toBe('10');
    expect(compiled).toBe(10);
  });

  test('a call of an input: f(y) at y = 2 is 5', () => {
    expect(run(['Program', F, ['f', 'y']]).compiled).toBe(5);
  });

  test('interval-js: the point interval [10, 10]', () => {
    expect(run(['Program', F, ['f', 3]], 'interval-js').compiled).toEqual({
      kind: 'interval',
      value: { lo: 10, hi: 10 },
    });
  });

  test('a function that calls another', () => {
    const g = define('g', ['Multiply', 2, ['f', 'u']], 'u');
    const { interpreted, compiled } = run(['Program', F, g, ['g', 3]]);
    expect(interpreted.toString()).toBe('20');
    expect(compiled).toBe(20);
  });

  test('a recursive function', () => {
    // prettier-ignore
    const fact = define('fact', ['If', ['LessEqual', 'n', 0], 1, ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]]], 'n');
    const { interpreted, compiled } = run(['Program', fact, ['fact', 5]]);
    expect(interpreted.toString()).toBe('120');
    expect(compiled).toBe(120);
  });

  // prettier-ignore
  test.each([
    ['a function of two clauses', ['Program', define('h', 1, ['Typed', 'k', "'0'"] as never), define('h', 2, 'k'), ['h', 3]], /DefineFunction|h\(3\)/],
    ['a definition as the last statement (Nothing)', ['Program', F], /a block that ends in an assignment/],
  ])('%s declines', (_, json, cause) => {
    expect(() => run(json)).toThrow(cause);
  });
});
