/**
 * `Apply` with a compound callee of UNKNOWN type (GitHub issue #426).
 *
 * The callee of `Apply` that is not a function value is read as a shorthand
 * function literal: its wildcards are its parameters, or else its unknowns
 * in order of appearance, or else none (a constant function). That rule
 * read `g(f)`, for an undeclared `g`, as the lambda `f ↦ g(f)`, so
 * `Apply(g(f), x)` was `g(x)`, and read `Filter(IsEven)` as a constant
 * function that dropped its argument.
 *
 * User decision 2026-10-09: a callee whose type is `unknown` is HELD. The
 * engine cannot tell whether such an expression is a function, so the
 * application stays `Apply(g(f), x)` and evaluates once `g` has a value,
 * by currying. The shorthand keeps every callee of a known non-function
 * type (`Apply(x + 1, 2)` is `3`) and every body with a wildcard.
 */
import { ComputeEngine } from '../../src/compute-engine';

describe('Apply with a callee of unknown type (issue #426)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('a call of an undeclared function is held, not read as a lambda', () => {
    expect(
      ce.box(['Apply', ['g', 'f'], ['List', 'a', 'b']]).evaluate().json
    ).toEqual(['Apply', ['g', 'f'], ['List', 'a', 'b']]);
  });

  test('a held callee takes any number of arguments without throwing', () => {
    expect(ce.box(['Apply', ['g', 'f'], 'a', 'b']).evaluate().json).toEqual([
      'Apply',
      ['g', 'f'],
      'a',
      'b',
    ]);
  });

  test('the nested-head spelling is the same application', () => {
    expect(ce.box([['g', 'f'], 'x']).evaluate().json).toEqual([
      'Apply',
      ['g', 'f'],
      'x',
    ]);
  });

  test('the parse routes agree with the box route', () => {
    expect(ce.parse('\\operatorname{Apply}(g(f), x)').evaluate().json).toEqual([
      'Apply',
      ['g', 'f'],
      'x',
    ]);
    expect(ce.parse('g(f) \\lhd x').evaluate().json).toEqual([
      'Apply',
      ['g', 'f'],
      'x',
    ]);
    // A pipe into a stage of unknown type stays a `Pipe`, as a pipe into an
    // undefined symbol does.
    expect(ce.parse('x \\rhd g(f)').evaluate().json).toEqual([
      'Pipe',
      'x',
      ['g', 'f'],
    ]);
  });

  test('the held application evaluates by currying once the callee has a value', () => {
    const e = ce.box(['Apply', ['g', 'f'], 'x']);
    expect(e.evaluate().json).toEqual(['Apply', ['g', 'f'], 'x']);
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    expect(e.evaluate().json).toEqual(['Add', 'f', 'x']);
  });

  test('a callee that is already a curried function value applies', () => {
    ce.assign('h', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
    expect(ce.box(['Apply', ['h', 1], 2]).evaluate().json).toEqual(3);
    expect(ce.box([['h', 1], 2]).evaluate().json).toEqual(3);
  });

  test('an element of unknown type is held, and applies once known', () => {
    expect(ce.box(['Apply', ['At', 'ys', 1], 3]).evaluate().json).toEqual([
      'Apply',
      ['At', 'ys', 1],
      3,
    ]);
    ce.assign('xs', ce.box(['List', 'Sin', 'Cos']));
    expect(ce.box(['Apply', ['At', 'xs', 1], 3]).evaluate().json).toEqual([
      'Sin',
      3,
    ]);
  });

  test('a callee of a known non-function type keeps the shorthand', () => {
    expect(ce.box(['Apply', ['Add', 'x', 1], 2]).evaluate().json).toEqual(3);
    expect(ce.box(['Apply', ['Sin', 'x'], 2]).evaluate().json).toEqual([
      'Sin',
      2,
    ]);
    expect(ce.box(['Apply', 3, 5]).evaluate().json).toEqual(3);
  });

  test('a wildcard body is a shorthand literal whatever its type', () => {
    expect(ce.box(['Apply', ['Add', '_', 1], 2]).evaluate().json).toEqual(3);
    expect(
      ce
        .box([
          'ListFrom',
          ['Apply', ['Filter', '_', 'IsEven'], ['List', 1, 2, 3, 4]],
        ])
        .evaluate().json
    ).toEqual(['List', 2, 4]);
    expect(
      ce.box(['ListFrom', ['Map', ['f', '_'], ['List', 1, 2]]]).evaluate().json
    ).toEqual(['List', ['f', 1], ['f', 2]]);
  });

  test('a declared function with a known result type keeps the shorthand', () => {
    ce.declare('f', '(number) -> number');
    expect(
      ce.box(['ListFrom', ['Map', ['f', 'x'], ['List', 1, 2]]]).evaluate().json
    ).toEqual(['List', ['f', 1], ['f', 2]]);
  });

  test('a callback of unknown type is held per element', () => {
    // `Map(f(x), xs)` for an undeclared `f` used to map `f ↦ f(x)`. The
    // callee is now held, and each element is applied to it symbolically,
    // as a symbol callee is (`Map(f, xs)` is `[f(1), f(2)]`).
    expect(
      ce.box(['ListFrom', ['Map', ['f', 'x'], ['List', 1, 2]]]).evaluate().json
    ).toEqual(['List', ['Apply', ['f', 'x'], 1], ['Apply', ['f', 'x'], 2]]);
  });

  test('a callback held before its callee was defined applies the value', () => {
    // `g(f)` is boxed while `g` is undefined, then `g` becomes a function of
    // two arguments: `g(f)` is a partial application, typed and applied as
    // the one-parameter function it evaluates to, on the callback route as
    // on the `Apply` route.
    const m = ce.box(['Map', ['g', 'f'], ['List', 1, 2]]);
    ce.assign('g', ce.box(['Function', ['Add', 'a', 'b'], 'a', 'b']));
    expect(ce.box(['g', 'f']).type.toString()).toBe('(unknown) -> number');
    expect(ce.box(['ListFrom', m]).evaluate().json).toEqual([
      'List',
      ['Add', 'f', 1],
      ['Add', 'f', 2],
    ]);
    expect(
      ce.box(['ListFrom', ['Map', ['g', 'f'], ['List', 1, 2]]]).evaluate().json
    ).toEqual(['List', ['Add', 'f', 1], ['Add', 'f', 2]]);
  });

  test('a held callee keeps its signature for the callback consumer', () => {
    // The callee is returned canonical, so `Map` types its result from the
    // callee's signature, not from the source collection.
    ce.assign('g', ce.box(['Function', ['String', 's'], 'a', 'b']));
    const m = ce.box(['Map', ['g', 0], ['List', 1, 2]]);
    expect(m.type.toString()).toBe('list<string^2>');
    expect(ce.box(['ListFrom', m]).evaluate().json).toEqual([
      'List',
      "'s'",
      "'s'",
    ]);
  });

  test('an explicit Block body is a literal body, never a callee', () => {
    expect(
      ce
        .box(['ListFrom', ['Map', ['Block', ['h', 'x']], ['List', 1, 2]]])
        .evaluate().json
    ).toEqual(['List', ['h', 1], ['h', 2]]);
  });

  test('a held transformer reads the type of its held operand', () => {
    // `Simplify` holds its operand, whose descriptor reads `unknown`; the
    // type comes from the operand's structure, so `Simplify(sin(x)/x)` keeps
    // the shorthand and `Simplify(h(x))` is held like `h(x)`.
    expect(
      ce
        .box(['Limit', ['Simplify', ['Divide', ['Sin', 'x'], 'x']], 0])
        .evaluate().json
    ).toEqual(1);
    expect(
      ce
        .box(['ListFrom', ['Map', ['Simplify', ['h', 'x']], ['List', 1, 2]]])
        .evaluate().json
    ).toEqual(['List', ['Apply', ['h', 'x'], 1], ['Apply', ['h', 'x'], 2]]);
  });

  test('a Hold callee is held: its type is opaque by design', () => {
    expect(
      ce.box(['Apply', ['Hold', ['Add', 'x', 1]], 2]).evaluate().json
    ).toEqual(['Apply', ['Hold', ['Add', 'x', 1]], 2]);
  });

  test('a function-valued callee that is not a literal still applies', () => {
    expect(
      ce.box(['Apply', ['InverseFunction', 'Sin'], 1]).evaluate().json
    ).toEqual(['Multiply', ['Rational', 1, 2], 'Pi']);
    expect(ce.box(['Apply', ['Derivative', 'Sin'], 0]).evaluate().json).toEqual(
      1
    );
  });
});

describe('a lazy operator with a missing operand (issue #426)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('the missing operand is marked, and the call is canonical', () => {
    for (const expr of [
      ['Filter', ['List', 1, 2]],
      ['Filter', 'IsEven'],
      ['Reduce', ['List', 1, 2]],
      ['Map', 'Sin'],
    ] as const) {
      const e = ce.box(expr);
      expect(e.isCanonical).toBe(true);
      expect(e.isValid).toBe(false);
      expect(JSON.stringify(e.json)).toContain("'missing'");
    }
  });

  test('applying a call with a missing operand is that error, not a dropped argument', () => {
    const e = ce
      .box(['Apply', ['Filter', 'IsEven'], ['List', 1, 2, 3, 4]])
      .evaluate();
    expect(e.operator).toBe('Error');
    expect(JSON.stringify(e.json)).toContain("'missing'");
  });

  test('an optional operand is still optional', () => {
    expect(ce.box(['All', ['List', true, true]]).isValid).toBe(true);
    expect(ce.box(['All', ['List', true, true]]).evaluate().json).toEqual(
      'True'
    );
  });
});

describe('too many arguments to a function literal', () => {
  test('is an error value, not a thrown exception', () => {
    const ce = new ComputeEngine();
    ce.assign('h', ce.box(['Function', ['Add', 'x', 'y'], 'x', 'y']));
    // The frame names the call and the position of the surplus argument:
    // the third operand of `h(1, 2, 3)`, the fourth of `Apply(h, 1, 2, 3)`.
    expect(ce.box(['h', 1, 2, 3]).evaluate().json).toEqual([
      'Error',
      "'unexpected-argument'",
      "'3'",
      ['ErrorTrace', ['ErrorFrame', "'h'", 3]],
    ]);
    expect(
      ce
        .box(['Apply', ['Function', ['Add', 'x', 'y'], 'x', 'y'], 1, 2, 3])
        .evaluate().json
    ).toEqual([
      'Error',
      "'unexpected-argument'",
      "'3'",
      ['ErrorTrace', ['ErrorFrame', "'Apply'", 4]],
    ]);
  });
});
