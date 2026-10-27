import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

/**
 * The type of a call of a function whose signature the engine inferred
 * must hold the value of the call.
 */

function signature(ce: ComputeEngine, name: string): string {
  const def = ce.lookupDefinition(name)!;
  return 'value' in def
    ? `${def.value.value!.type}`
    : `${def.operator.signature}`;
}

function expectSound(expr: Expression): Expression {
  const value = expr.evaluate();
  expect(value.type.matches(expr.type)).toBe(true);
  return value;
}

// ROADMAP CE-503. A numeric use of a parameter (`t·P`) infers a scalar
// numeric type, and a later index read (`P[1]`) requires a collection. The
// meet of the two types is `never`: the parameter must take the collection
// type instead, as it does when the index read comes first.
describe('CE-503: a numeric use and an index read of one parameter', () => {
  const body = [
    'Divide',
    ['Multiply', 't', 'P'],
    ['Subtract', ['At', 'P', 1], 1],
  ];

  test('the assigned function literal has a sound signature', () => {
    const ce = new ComputeEngine();
    ce.assign('c', ce.box(['Function', body, 'P', 't'] as any));
    expect(signature(ce, 'c')).toBe(
      '(P: indexed_collection<number>, t: unknown) -> list<number>'
    );
    const call = ce.box(['c', ['List', 3, 2], 2]);
    expect(call.type.toString()).toBe('list<infinity | nan | real^2>');
    expect(expectSound(call).toString()).toBe('[3,2]');
  });

  test('the function literal itself', () => {
    const ce = new ComputeEngine();
    const fn = ce.box(['Function', body, 'P', 't'] as any);
    expect(fn.type.toString()).toBe(
      '(P: indexed_collection<number>, t: unknown) -> list<number>'
    );
  });

  test('the parse route', () => {
    const ce = new ComputeEngine();
    ce.parse('d(P, t) := \\frac{t P}{P[1] - 1}').evaluate();
    expect(signature(ce, 'd')).not.toContain('never');
    const call = ce.parse('d([3, 2], 2)');
    expect(expectSound(call).toString()).toBe('[3,2]');
  });

  // A use that requires a scalar and does not map (the bound of `Range`,
  // the count of `Take`) and an index read have no common value: the
  // parameter is not given the collection type, and a call is an error.
  for (const [label, scalarUse] of [
    ['Range', ['Range', 'n']],
    ['Take', ['Take', ['List', 1, 2, 3], 'n']],
  ] as const) {
    test(`a scalar use of ${label} and an index read have no common value`, () => {
      const ce = new ComputeEngine();
      ce.assign(
        'f',
        ce.box(['Function', ['Add', scalarUse, ['At', 'n', 1]], 'n'] as any)
      );
      expect(signature(ce, 'f')).not.toContain('indexed_collection');
      const scalar = ce.box(['f', 5]);
      expect(scalar.type.toString()).toBe('error');
      expect(expectSound(scalar).operator).toBe('Error');
      // A list argument maps: each element is an error. The type says so;
      // the value, a list literal whose every cell failed, is typed
      // `list<unknown>`, which does not match it (a list literal leaves its
      // failed cells out of its element type).
      const mapped = ce.box(['f', ['List', 2, 3]]);
      expect(mapped.type.toString()).toBe('list<error^2>');
      const value = mapped.evaluate();
      expect(value.nops).toBe(2);
      expect(value.ops!.every((x) => x.operator === 'Error')).toBe(true);
    });
  }

  test('the other order of the uses is not changed', () => {
    const ce = new ComputeEngine();
    ce.parse('c_2(P, t) := t\\cdot (P/(P[1] - 1))').evaluate();
    expect(signature(ce, 'c_2')).toBe(
      '(P: tuple<number>, t: unknown) -> tuple<number>'
    );
    expect(expectSound(ce.parse('c_2([3, 2], 2)')).toString()).toBe('[3,2]');
  });
});

// ROADMAP CE-490. A string or a boolean argument at a parameter whose type
// was inferred: the result of the signature assumed a number.
describe('CE-490: a string or boolean argument of an inferred signature', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.parse('f(x) := (-x, x)').evaluate();
    ce.parse('g(x) := -x').evaluate();
    ce.parse('h(x) := x + 1').evaluate();
    ce.parse('k(x) := [x, 2x]').evaluate();
    return ce;
  }

  test('a tuple result with a failed cell is typed error', () => {
    const ce = engine();
    expect(signature(ce, 'f')).toBe('(x: unknown) -> tuple<number, number>');
    const call = ce.parse('f("s")');
    expect(call.type.toString()).toBe('error');
    expect(expectSound(call).toString()).toBe(
      '(Error(ErrorCode("incompatible-type", "number", "string"), "s"), "s")'
    );
    const b = ce.parse('f(\\mathrm{True})');
    expect(b.type.toString()).toBe('error');
    expectSound(b);
  });

  test('a scalar result', () => {
    const ce = engine();
    for (const src of ['g("s")', 'h("s")', 'g(\\mathrm{True})']) {
      const call = ce.parse(src);
      expect(call.type.toString()).toBe('error');
      expectSound(call);
    }
  });

  test('a list result keeps the failed cell', () => {
    const ce = engine();
    const call = ce.parse('k("s")');
    expect(call.type.toString()).toBe('list<string^2>');
    expectSound(call);
  });

  test('a numeric argument keeps its derived type', () => {
    const ce = engine();
    expect(ce.parse('f(2)').type.toString()).toBe('tuple<integer, integer>');
    expect(ce.parse('g(2)').type.toString()).toBe('number');
  });

  test('a symbol that holds a function literal', () => {
    const ce = new ComputeEngine();
    const literal = ['Function', ['Tuple', ['Negate', 'x'], 'x'], 'x'];
    ce.assign('m', ce.box(literal as any));
    ce.declare('n', 'function');
    ce.assign('n', ce.box(literal as any));
    for (const head of ['m', 'n']) {
      const call = ce.box([head, "'s'"]);
      expect(call.type.toString()).toBe('error');
      expectSound(call);
    }
  });

  test('an error slot in a nested tuple', () => {
    const ce = new ComputeEngine();
    ce.parse('g(x) := ((-x, 1), x)').evaluate();
    const call = ce.parse('g("s")');
    expect(call.type.toString()).toBe('error');
    expectSound(call);
  });

  test('a recursive function', () => {
    const ce = new ComputeEngine();
    ce.parse('r(x) := \\operatorname{If}(x = 0, 0, r(x - 1) + 1)').evaluate();
    expect(signature(ce, 'r')).toBe('(x: unknown) -> number');
    for (const arg of ["'s'", 'True']) {
      const call = ce.box(['r', arg]);
      expect(call.type.toString()).not.toBe('number');
      expect(expectSound(call).operator).toBe('Error');
    }
    expect(ce.parse('r(3)').type.toString()).toBe('number');
    expect(expectSound(ce.parse('r(3)')).toString()).toBe('3');
  });

  test('a function literal applied in place', () => {
    const ce = new ComputeEngine();
    const call = ce.parse('(x \\mapsto (-x, x))("s")');
    expect(call.type.toString()).toBe('error');
    expectSound(call);
  });
});

// ROADMAP CE-491. A product of a list of points and a point has no value:
// the evaluation gives one error, as the canonical form and the type do.
describe('CE-491: a list of points bound whole to a point parameter', () => {
  test('a product of the list and one of its points is one error', () => {
    const ce = new ComputeEngine();
    ce.parse('p(x) := x\\cdot x[1]').evaluate();
    const call = ce.parse('p([(3, 2), (1, 4)])');
    expect(call.type.toString()).toBe('error');
    expect(expectSound(call).toString()).toBe(
      'Error(ErrorCode("no-product-between-points", "no-cross", "`Dot(a, b)` is the inner product"))'
    );
    // A point argument and a list of numbers are not changed.
    expect(expectSound(ce.parse('p((3, 2))')).toString()).toBe('(9, 6)');
    expect(expectSound(ce.parse('p([3, 2])')).toString()).toBe('[9,6]');
  });

  test('a product boxed before its operands have values', () => {
    const ce = new ComputeEngine();
    const L = ce.box(['List', ['Tuple', 3, 2], ['Tuple', 1, 4]]);
    const T = ce.box(['Tuple', 3, 2]);
    const product = ce._fn('Multiply', [L, T]);
    const expected =
      'Error(ErrorCode("no-product-between-points", "no-cross", "`Dot(a, b)` is the inner product"))';
    expect(product.evaluate().toString()).toBe(expected);
    expect(product.N().toString()).toBe(expected);
    // A list of numbers times a point is a list of scaled points.
    const scaled = ce._fn('Multiply', [ce.box(['List', 1, 2]), T]);
    expect(scaled.evaluate().toString()).toBe('[(3, 2),(6, 4)]');
  });
});
