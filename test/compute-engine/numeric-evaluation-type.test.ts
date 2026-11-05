import { ComputeEngine } from '../../src/compute-engine';

//
// A numeric evaluation gives a float for an exact rational, and a float is
// not a rational (`docs/TYPE-SYSTEM.md`). So `N` makes each rational member of
// the type of its operand a real, with its range. It was typed as its operand:
// `N(1/3)` was typed `rational<0.33..0.34>` and its value is typed
// `real<0.33..0.34>`, which does not match it.
//

const ce = new ComputeEngine();
ce.declare('r', 'rational');
ce.declare('n', 'integer');
ce.declare('z', 'complex');
ce.declare('lr', 'list<rational>');
ce.declare('fr', '(rational) -> integer');

describe('THE TYPE OF A NUMERIC EVALUATION', () => {
  test.each([
    [['N', ['Rational', 1, 3]], 'real<0.33..0.34>'],
    [['N', ['Add', 1, ['Rational', 1, 3]]], 'real<1.3..1.4>'],
    [['N', 'r'], 'real'],
    [['N', ['Divide', 'n', 3]], 'real'],
    [['N', ['List', ['Rational', 1, 3], 2]], 'vector<real^2>'],
    [['N', ['Tuple', ['Rational', 1, 3], 2]], 'tuple<real, integer>'],
    [['N', ['Set', ['Rational', 1, 3]]], 'set<real>'],
    [['N', ['Dictionary', ['KeyValuePair', "'a'", ['Rational', 1, 3]]]], 'record{a: real}'],
    [['N', 'lr'], 'list<real>'],
    // An integer, a complex and a value that is not a number are kept.
    [['N', 5], 'integer'],
    [['N', 'n'], 'integer'],
    [['N', 'z'], 'complex'],
    [['N', "'a'"], 'string'],
    [['NumericApproximation', ['Rational', 1, 3]], 'real<0.33..0.34>'],
    // A precision goal rounds the value, so the range of the operand is gone:
    // `N(1/3, 1)` is `0.3`, outside `0.33..0.34`.
    [['N', ['Rational', 1, 3], 1], 'real'],
    [['N', 'Pi', 1], 'real'],
    [['N', 1234, 1], 'integer'],
    // A float operand makes a float result, also when the float comes from `N`
    // as a direct operand.
    [['Divide', ['N', 5], 3], 'real'],
    [['Add', ['N', 5], ['Rational', 1, 3]], 'real'],
  ])('%j is %s', (json, type) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe(type);
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });

  // A function literal whose body is `N(...)`, at the top or inside a body.
  test.each([
    [
      ['Map', ['Function', ['N', ['Divide', 'k', 3]], 'k'], ['List', 1, 2]],
      'vector<real^2>',
    ],
    [
      ['Tabulate', ['Function', ['N', ['Divide', 'k', 3]], 'k'], 3],
      'vector<real^3>',
    ],
    [
      ['Tabulate', ['Function', ['Add', 1, ['N', ['Divide', 'k', 3]]], 'k'], 3],
      'vector<3>',
    ],
    [
      ['Map', ['Function', ['Divide', ['N', 'k'], 3], 'k'], ['List', 1, 2]],
      'vector<real^2>',
    ],
    [['Tabulate', ['Function', ['Add', ['N', 'k'], 1], 'k'], 3], 'vector<integer^3>'],
    // A rational is not narrowed: the type of the literal applies.
    [['Tabulate', ['Function', ['Divide', 'k', 3], 'k'], 3], 'vector<3>'],
  ])('%j is %s', (json, type) => {
    const expr = ce.box(json as any);
    expect(expr.type.toString()).toBe(type);
    const value = ce.function('List', [...expr.evaluate().each()]);
    expect(value.type.matches(expr.type)).toBe(true);
  });

  // A float inside the body: the open type of the function literal holds it.
  test.each([
    [['Function', ['Divide', ['N', 'k'], 3], 'k']],
    [['Function', ['Add', ['N', 'k'], ['Rational', 1, 3]], 'k']],
    [['Function', ['Divide', ['Add', 'k', ['N', 2]], 3], 'k']],
    [['Function', ['Divide', ['Add', 'k', 2.0], 3], 'k']],
  ])('Tabulate(%j, 3): the values are in the type', (fn) => {
    const expr = ce.box(['Tabulate', fn, 3] as any);
    expect(expr.type.toString()).not.toMatch(/rational/);
    const value = ce.function('List', [...expr.evaluate().each()]);
    expect(value.type.matches(expr.type)).toBe(true);
  });

  // `Typed` checks a value, and a float passes under `rational`
  // (the reference page of `Typed`).
  test('a float still passes under `rational` in `Typed`', () => {
    const value = ce.box(['Typed', ['N', ['Rational', 1, 3]], "'rational'"]);
    expect(value.isValid).toBe(true);
    expect(value.evaluate().operator).not.toBe('Error');
  });

  // A parameter typed `rational` is checked when the function is called, and a
  // float is refused then, as it was when `N` was typed `rational`.
  test('a call with a float and a `rational` parameter stays an error', () => {
    const call = ce.box(['fr', ['N', ['Rational', 1, 3]]]);
    expect(call.isValid).toBe(true);
    expect(call.evaluate().toString()).toMatch(/incompatible-type/);
  });
});
