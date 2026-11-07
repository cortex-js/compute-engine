/**
 * CE-836: a conditional whose branch calls a function that is not defined
 * yet got a type that did not hold its later value.
 *
 * With `q: real`, `If(q < 2, g(1), 0)` was typed `integer`. After
 * `g := x ↦ x / 2` and `q = 1`, its value is `1/2`. The branch `g(1)` is
 * typed `unknown`, and the join of the branch types left that branch out:
 * every call of a function that is not a library operator was read as a
 * recursive call, whose `unknown` type only means that the result type of
 * its function is being computed. Such a call is now read as a recursive
 * call only when the result type of its function is being computed now (an
 * assignment or a declaration of the name in flight, a signature
 * derivation of its definition, or a computation of the type of its
 * function literal). Every other such call has a value of any type, so the
 * conditional is `unknown`. A recursive function is still typed by its base
 * case.
 *
 * The tests that expect `unknown` pin the exact string: `unknown` is the
 * only type that holds the value of a call of a function that can still be
 * given any definition.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { expectTypeBetween } from '../utils';

const HALF = ['Function', ['Divide', 'x', 2], 'x'];

describe('A BRANCH THAT CALLS A FUNCTION THAT IS NOT DEFINED YET (CE-836)', () => {
  test('an If is unknown, and holds the value after the definition', () => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    const expr = ce.box(['If', ['Less', 'q', 2], ['g', 1], 0]);
    const before = expr.type;
    expect(before.toString()).toBe('unknown');
    ce.assign('g', ce.box(HALF));
    ce.assign('q', 1);
    const value = expr.evaluate();
    expect(value.toString()).toBe('1/2');
    expect(value.type.matches(before)).toBe(true);
  });

  test.each([
    ['declared `function`', 'function'],
    ['declared with a signature only', { signature: '(real) -> unknown' }],
  ])('a function %s is read the same way', (_label, declaration) => {
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    ce.declare('g', declaration as any);
    expect(
      ce.box(['If', ['Less', 'q', 2], ['g', 1], 0]).type.toString()
    ).toBe('unknown');
  });

  test('an element-wise Which has unknown cells', () => {
    const ce = new ComputeEngine();
    ce.assign('L', ce.box(['List', 1, 3, 5]));
    const expr = ce.box(['Which', ['Less', 'L', 2], ['g', 1], 'True', 0]);
    const before = expr.type;
    expect(before.toString()).toBe('list<unknown^3>');
    ce.assign('g', ce.box(HALF));
    const value = expr.evaluate();
    expect(value.toString()).toBe('[1/2,0,0]');
    expect(value.type.matches(before)).toBe(true);
  });

  test('the type of a call of a function that calls it holds the later value', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'f',
      ce.box(['Function', ['If', ['Less', 'x', 2], ['g', 1], 0], 'x'])
    );
    ce.assign('g', ce.box(HALF));
    const call = ce.box(['f', 1]);
    const value = call.evaluate();
    expect(value.toString()).toBe('1/2');
    expect(value.type.matches(call.type)).toBe(true);
  });

  test('a defined function whose result is unknown is read the same way', () => {
    // `g` has a body, but its result type is settled as `unknown`: `k` is
    // not defined. The call `g(1)` is not a recursive call.
    const ce = new ComputeEngine();
    ce.declare('q', 'real');
    ce.assign('g', ce.box(['Function', ['k', 'x'], 'x']));
    const expr = ce.box(['If', ['Less', 'q', 2], ['g', 1], 0]);
    const before = expr.type;
    expect(before.toString()).toBe('unknown');
    ce.assign('k', ce.box(HALF));
    ce.assign('q', 1);
    const value = expr.evaluate();
    expect(value.toString()).toBe('1/2');
    expect(value.type.matches(before)).toBe(true);
  });

  // When `f` is assigned, `g` is not defined, so the result type of `f` is
  // `unknown`. When `g` is assigned, the call `f(n − 1)` of its body is not
  // a recursive call of a function whose result type is being computed, so
  // it is not left out of the join. The type of a call `g(1)` is derived
  // from the body of `g` (`callResultType()`), and that derivation must not
  // leave out the branch `f(0)` either.
  test.each([
    ['numbers', ['Rational', 1, 2], 2, '1/2'],
    ['lists', ['List', ['Rational', 1, 2]], ['List', 2], '[1/2]'],
  ])(
    'two functions that call each other, the second defined after the first (%s)',
    (_label, fBase, gBase, g1) => {
      const ce = new ComputeEngine();
      ce.assign(
        'f',
        ce.box([
          'Function',
          ['If', ['Equal', 'n', 0], fBase, ['g', ['Subtract', 'n', 1]]],
          'n',
        ])
      );
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['If', ['Equal', 'n', 0], gBase, ['f', ['Subtract', 'n', 1]]],
          'n',
        ])
      );
      for (const [name, arg] of [
        ['g', 1],
        ['g', 2],
        ['f', 1],
        ['f', 2],
      ] as const) {
        const call = ce.box([name, arg]);
        const value = call.evaluate();
        expect(value.type.matches(call.type)).toBe(true);
      }
      expect(ce.box(['g', 1]).evaluate().toString()).toBe(g1);
    }
  );
});

describe('A FUNCTION THAT CALLS A FUNCTION DEFINED AFTER IT (CE-836)', () => {
  // `h` calls `g` before `g` is defined, and `g` calls `h`. The assignment
  // of `g` types the body of `h` (to type `h(n − 1)`, and to rebuild `h`,
  // whose call of `g` was a forward reference). In the body of `h`, the call
  // `g(x)` must not be left out of the join after the computation that
  // typed `g` ends: `h` was typed `-> integer` for the value `h(0) = 1/2`.
  test.each([
    ['a rational base, undeclared', ['Rational', 1, 2], false],
    ['a string base, undeclared', "'s'", false],
    ['a rational base, declared', ['Rational', 1, 2], true],
    ['a string base, declared', "'s'", true],
  ])('%s', (_label, base, declared) => {
    const ce = new ComputeEngine();
    if (declared) {
      ce.declare('h', '(unknown) -> unknown');
      ce.declare('g', '(unknown) -> unknown');
    }
    ce.assign(
      'h',
      ce.box(['Function', ['If', ['Less', 'x', 2], ['g', 'x'], 0], 'x'])
    );
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], base, ['h', ['Subtract', 'n', 1]]],
        'n',
      ] as any)
    );
    ce.declare('m', 'integer');
    const general = ce.box(['h', 'm']).type;
    const call = ce.box(['h', 0]);
    const value = call.evaluate();
    expect(value.type.matches(call.type)).toBe(true);
    expect(value.type.matches(general)).toBe(true);
  });
});

describe('A RECURSIVE FUNCTION IS STILL TYPED BY ITS BASE CASE (CE-836)', () => {
  const BODY = ['If', ['Equal', 'n', 0], 1, ['r', ['Subtract', 'n', 1]]];

  // The bound is the type of the base case on each route: a recursive call
  // that is read as a value of any type makes the type `unknown`.
  test.each([
    [
      'assign',
      (ce: ComputeEngine) => ce.assign('r', ce.box(['Function', BODY, 'n'])),
      'integer',
    ],
    [
      'declare with an evaluate handler',
      (ce: ComputeEngine) =>
        ce.declare('r', { evaluate: ce.box(['Function', BODY, 'n']) }),
      'integer',
    ],
    [
      'declare with a value',
      (ce: ComputeEngine) =>
        ce.declare('r', { value: ce.box(['Function', BODY, 'n']) }),
      'number',
    ],
    [
      'LaTeX definition',
      (ce: ComputeEngine) =>
        ce.parse('r(n) := \\operatorname{If}(n = 0, 1, r(n - 1))').evaluate(),
      'integer',
    ],
  ])('%s', (_route, define, atMost) => {
    const ce = new ComputeEngine();
    define(ce);
    expectTypeBetween(ce.box(['r', 'm']), { atMost });
    expect(ce.box(['r', 3]).evaluate().toString()).toBe('1');
  });

  test('a function declared `function`, then assigned', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('F', 'function');
    ce.assign(
      'F',
      ce.box([
        'Function',
        ['If', ['Equal', 'n', 0], ['Greater', 'x', 0], ['F', ['Subtract', 'n', 1]]],
        'n',
      ])
    );
    expectTypeBetween(ce.box(['F', 'm']), { atMost: 'boolean' });
  });
});
