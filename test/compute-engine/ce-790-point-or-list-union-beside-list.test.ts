import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';

// ROADMAP CE-790: an element-wise operation of an operand that is a point or
// a list (`U: tuple<real, real> | list<real>`, the shape a host gives a
// Desmos parameter) and a declared list was typed with one list level too
// many. With `W: list<real>`, `U + W` was typed
// `list<list<real> | tuple<real, real>>`, and its value for `U := [1, 2]`
// and `W := [10, 20]` is `[11, 22]`, which that type does not hold. A list
// literal in place of `W` was typed correctly. Each type below must hold
// the value of the application. A list with a length keeps it in the result:
// another length gives an error. `Power` pairs the components of a point
// with the elements of a list, so its point arm gives a list of numbers.

const DECLARATIONS: Record<string, string> = {
  U: 'tuple<real, real> | list<real>',
  W: 'list<real>',
  W2: 'vector<2>',
  W3: 'list<real^2>',
  D: 'number | list<number> | tuple<number, number>',
};

const VALUES: Record<string, unknown> = {
  U: ['List', 1, 2],
  W: ['List', 10, 20],
  W2: ['List', 10, 20],
  W3: ['List', 10, 20],
  D: ['List', 1, 2],
};

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, type] of Object.entries(DECLARATIONS))
    ce.declare(name, type);
  return ce;
}

const CASES: [string, unknown, string][] = [
  ['U + W', ['Add', 'U', 'W'], 'list<real>'],
  ['U - W', ['Subtract', 'U', 'W'], 'list<real>'],
  ['U + W2', ['Add', 'U', 'W2'], 'vector<2>'],
  ['U + W3', ['Add', 'U', 'W3'], 'vector<real^2>'],
  ['W2 - U', ['Subtract', 'W2', 'U'], 'vector<2>'],
  ['D + W2', ['Add', 'D', 'W2'], 'vector<2>'],
  ['U ^ W', ['Power', 'U', 'W'], 'list<number>'],
];

describe('a point-or-list union beside a declared list', () => {
  test.each(CASES)('%s is typed %s', (_label, json, expected) => {
    expect(engine().box(json as never).type.toString()).toBe(expected);
  });

  test.each(CASES)(
    '%s, with values, has a type that holds its value',
    (_label, json) => {
      const ce = engine();
      for (const [name, value] of Object.entries(VALUES))
        ce.assign(name, ce.box(value as never));
      const expr = ce.box(json as never);
      const value = expr.evaluate();
      expect(value.toString()).toMatch(/^\[/);
      expect(isSubtype(value.type.type, expr.type.type)).toBe(true);
    }
  );

  test('a product keeps the point arm', () => {
    expect(engine().box(['Multiply', 'U', 'W2']).type.toString()).toBe(
      'list<tuple<number, number>^2> | vector<2>'
    );
  });
});
