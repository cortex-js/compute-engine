/**
 * The static type of a product, and of a call of a function literal, holds
 * the evaluated value.
 *
 * - A scalar factor whose number type is inferred, or whose type is
 *   `unknown`, can hold any number at run time, so the cells of the product
 *   are `number` (ROADMAP CE-481).
 * - A call of a function literal over a symbol of type `unknown` that the
 *   body reads from outside the literal may get a list of any depth or a
 *   tuple later, so its type admits each of them (ROADMAP CE-478).
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

/** The type of the value of `expr` is within the static type of `expr`. */
function expectValueWithinType(expr: Expression): Expression {
  const value = expr.evaluate();
  expect(value.type.matches(expr.type)).toBe(true);
  return value;
}

describe('a scalar factor of an inferred or unknown type (CE-481)', () => {
  test('an inferred `number` factor widens the cells of a declared list', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer>');
    // A use as a number infers `u` as `number`.
    ce.parse('u+1').evaluate();
    expect(ce.symbol('u').type.toString()).toBe('number');
    const product = ce.box(['Multiply', 'L', 'u']);
    expect(product.type.toString()).toBe('list<number>');
    ce.assign('L', ce.box(['List', 1, 2]));
    ce.assign('u', 0.5);
    const p = ce.box(['Multiply', 'L', 'u']);
    expect(expectValueWithinType(p).toString()).toBe('[0.5,1]');
  });

  test('an `unknown` parameter widens the cells of a captured list', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['List', 1, 2, 3]));
    const f = ce.box(['Function', ['Multiply', 'a', 'x'], 'x']);
    expect(f.type.toString()).toBe('(x: unknown) -> vector<3>');
    ce.assign('h', f);
    const call = ce.box(['h', 0.5]);
    expect(call.type.toString()).toBe('vector<real^3>');
    expect(expectValueWithinType(call).toString()).toBe('[0.5,1,1.5]');
    // `Add` types the same operands with `number` cells too.
    expect(
      ce.box(['Function', ['Add', 'a', 'x'], 'x']).type.toString()
    ).toBe('(x: unknown) -> vector<3>');
  });

  test('a matrix, a list of points and two lists scaled by an inferred factor', () => {
    const ce = new ComputeEngine();
    ce.declare('M', 'matrix<integer^(2x2)>');
    ce.declare('P', 'list<tuple<integer, integer>>');
    ce.declare('L', 'list<integer>');
    ce.parse('u+1').evaluate();
    expect(ce.box(['Multiply', 'M', 'u']).type.toString()).toBe('matrix<2x2>');
    expect(ce.box(['Multiply', 'P', 'u']).type.toString()).toBe(
      'list<tuple<number, number>>'
    );
    expect(ce.box(['Multiply', 'L', 'L', 'u']).type.toString()).toBe(
      'list<number>'
    );
    expect(ce.box(['Multiply', 'P', 'M', 'u']).type.toString()).toBe(
      'matrix<tuple<number, number>^(2x2)>'
    );
  });

  test('a declared factor keeps its own tier', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer>');
    ce.declare('k', 'integer');
    expect(ce.box(['Multiply', 'L', 'k']).type.toString()).toBe(
      'list<integer>'
    );
  });
});

describe('a call over a captured symbol of type `unknown` (CE-478)', () => {
  /** `g := s ↦ 2s` and `f := t ↦ <body>`, then `y := <value>`: the call
   * `f(1)` holds its value. */
  function captureCall(
    body: unknown,
    value: unknown,
    declareFirst = false
  ): string {
    const ce = new ComputeEngine();
    // Box `y` first: it then has a valueless definition of type `unknown`
    // in the global scope before the literal is made.
    if (declareFirst) expect(ce.box('y').type.toString()).toBe('unknown');
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    ce.assign('f', ce.box(['Function', body, 't'] as any));
    expect(ce.symbol('f').type.toString()).toBe('(t: unknown) -> any');
    ce.assign('y', ce.box(value as any));
    return expectValueWithinType(ce.box(['f', 1])).toString();
  }

  test.each([
    ['a list', ['List', 1, 2, 3], '[2,4,6]'],
    ['a tuple', ['Tuple', 1, 2], '(2, 4)'],
    ['a ragged list', ['List', ['List', 1], ['List', 2, 3]], '[[2],[4,6]]'],
    ['a number', 5, '10'],
  ])('the call holds %s', (_label, value, expected) => {
    expect(captureCall(['g', 'y'], value)).toBe(expected);
  });

  test('a symbol boxed before the literal is captured too', () => {
    expect(captureCall(['g', 'y'], ['List', 1, 2, 3], true)).toBe('[2,4,6]');
    expect(captureCall(['g', 'y'], ['Tuple', 1, 2], true)).toBe('(2, 4)');
  });

  test('a symbol first read in a nested block is captured too', () => {
    const body = ['If', ['Greater', 't', 0], ['Block', ['g', 'y']], 0];
    expect(captureCall(body, ['List', 1, 2, 3])).toBe('[2,4,6]');
    expect(captureCall(body, ['Tuple', 1, 2])).toBe('(2, 4)');
  });

  test('a binder variable of the body is not captured', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    const f = ce.box([
      'Function',
      ['Sum', ['g', 'k'], ['Element', 'k', ['Range', 1, 3]]],
      't',
    ]);
    expect(f.type.toString()).toBe('(t: unknown) -> number');
  });

  test('a captured symbol makes the signature admit the broadcast', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    ce.assign('f', ce.box(['Function', ['g', 'y'], 't']));
    expect(ce.symbol('f').type.toString()).toBe('(t: unknown) -> any');
    expect(ce.symbol('y').type.toString()).toBe('unknown');
    ce.assign('y', ce.box(['List', 1, 2, 3]));
    const call = ce.box(['f', 1]);
    expect(expectValueWithinType(call).toString()).toBe('[2,4,6]');
  });

  test('the parse route gives the same signature', () => {
    const ce = new ComputeEngine();
    ce.parse('g(s) \\coloneq 2s').evaluate();
    ce.parse('f(t) \\coloneq g(y)').evaluate();
    expect(ce.symbol('f').type.toString()).toBe('(t: unknown) -> any');
    ce.assign('y', ce.box(['List', 1, 2, 3]));
    const call = ce.parse('f(1)');
    expect(expectValueWithinType(call).toString()).toBe('[2,4,6]');
  });

  test('a call outside a function literal is typed again when the symbol gets a value', () => {
    // Only a symbol that the body of a literal reads is read as a possible
    // list: the type of a call outside every literal is read again after
    // the assignment.
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    const call = ce.box(['g', 'y']);
    expect(call.type.toString()).toBe('number');
    ce.assign('y', ce.box(['List', 1, 2, 3]));
    expect(call.type.toString()).toBe('vector<3>');
    expect(expectValueWithinType(call).toString()).toBe('[2,4,6]');
  });

  test('a parameter of the enclosing literal keeps the scalar signature', () => {
    // A call of the enclosing literal types its body again, with the
    // parameter typed by the argument of the call.
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    ce.assign('f', ce.box(['Function', ['g', 't'], 't']));
    expect(ce.symbol('f').type.toString()).toBe('(t: unknown) -> number');
    const call = ce.box(['f', ['List', 1, 2]]);
    expect(expectValueWithinType(call).toString()).toBe('[2,4]');
  });

  test('a symbol that a use typed as a number keeps the scalar result', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['Multiply', 2, 's'], 's']));
    ce.declare('y', 'number');
    ce.assign('f', ce.box(['Function', ['g', 'y'], 't']));
    expect(ce.symbol('f').type.toString()).toBe('(t: unknown) -> number');
  });
});
