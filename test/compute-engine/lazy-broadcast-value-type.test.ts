import { ComputeEngine } from '../../src/compute-engine';

/**
 * Tycho ask 315: the value of an expression must match the static type of
 * the expression.
 *
 * A broadcast over a collection operand is statically typed `list<E>`. Over
 * a hundred elements or fewer its value is a `List`. Over more elements the
 * value is a lazy `Map` of the same elements, and that `Map` was typed
 * `indexed_collection<E>`, which is not a subtype of `list<E>`. So the value
 * of `k + 1` for `k := [1...101]` did not match the type of `k + 1`, and
 * assigning the value to a symbol declared with that type threw a
 * `TypeCompatibilityError`. A `Map` over an indexed source is now a `list`.
 *
 * Each case is checked at 100 elements (eager `List`) and at 101 elements
 * (lazy `Map`), for a `Range` source and for a `List` of exact rationals
 * (which is not computed on machine numbers, so it stays lazy too).
 */

const CASES: [string, string][] = [
  [
    'point list sum',
    '\\operatorname{PointList}(0, k)+\\operatorname{PointList}(\\cos(k), \\sin(k))',
  ],
  ['k + 1', 'k+1'],
  ['cos(k)', '\\cos(k)'],
  ['2k', '2k'],
  ['k + k', 'k+k'],
  ['explicit Map', '\\operatorname{Map}(x \\mapsto x^2, k)'],
  ['tuple of broadcasts', '(\\cos(k), \\sin(k))'],
];

function engineWith(source: 'range' | 'rationals', n: number): ComputeEngine {
  const ce = new ComputeEngine();
  if (source === 'range')
    ce.assign('k', ce.parse(`\\left[1...${n}\\right]`).evaluate());
  else
    ce.assign(
      'k',
      ce.function(
        'List',
        Array.from({ length: n }, (_, i) => ce.number([i + 1, 3]))
      )
    );
  return ce;
}

describe('the value of a broadcast matches its static type (Tycho ask 315)', () => {
  for (const source of ['range', 'rationals'] as const) {
    for (const n of [100, 101]) {
      for (const [name, latex] of CASES) {
        test(`${name}, ${source} source, ${n} elements`, () => {
          const ce = engineWith(source, n);
          const expr = ce.parse(latex);
          const value = expr.evaluate();
          expect(value.type.matches(expr.type)).toBe(true);
          // The value can be assigned to a symbol declared with the static
          // type of the expression, and indexed there.
          ce.declare('J', expr.type.toString());
          expect(() => ce.assign('J', value)).not.toThrow();
          const first = ce.parse('J_1').evaluate();
          expect(first.isSame(value.at(1)!.evaluate())).toBe(true);
        });
      }
    }
  }

  test('the filed repro: the lazy value is a list with the static type', () => {
    const ce = engineWith('range', 101);
    const expr = ce.parse(
      '\\operatorname{PointList}(0, k)+\\operatorname{PointList}(\\cos(k), \\sin(k))'
    );
    const value = expr.evaluate();
    // Still lazy: the elements are not computed.
    expect(value.operator).toBe('Map');
    expect(expr.type.toString()).toBe('list<tuple<number, number>>');
    expect(value.type.toString()).toBe('list<tuple<real, real>>');
    ce.declare('J', expr.type.toString());
    ce.assign('J', value);
    expect(ce.parse('J_1').evaluate().toString()).toBe('(cos(1), 1 + sin(1))');
    expect(ce.parse('J_{101}').evaluate().toString()).toBe(
      '(cos(101), 101 + sin(101))'
    );
  });
});

describe('the type of Map', () => {
  const ce = new ComputeEngine();
  ce.assign(
    'L',
    ce.function(
      'List',
      Array.from({ length: 101 }, (_, i) => ce.number([i + 1, 3]))
    )
  );

  test('a Map over a range is a list', () => {
    const m = ce.box([
      'Map',
      ['Function', ['Square', 'x'], 'x'],
      ['Range', 1, 500],
    ]);
    expect(m.type.toString()).toBe('list<integer<0..>>');
    expect(m.evaluate().type.toString()).toBe('list<integer<0..>>');
  });

  test('a Map over an infinite range is a list, as the broadcast over it is', () => {
    const ce = new ComputeEngine();
    ce.assign('r', ce.box(['Range', 1, { num: '+Infinity' }]));
    const expr = ce.parse('r+1');
    expect(expr.type.toString()).toBe('list<integer>');
    expect(expr.evaluate().type.toString()).toBe('list<integer>');
  });

  test('a zip Map over lists of the same shape keeps the shape', () => {
    const m = ce.box([
      'Map',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      'L',
      'L',
    ]);
    expect(m.type.toString()).toBe('vector<rational^101>');
  });

  test('a zip Map over lists of different lengths is a list', () => {
    const m = ce.box([
      'Map',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      'L',
      ['Range', 1, 5],
    ]);
    expect(m.type.toString()).toBe('list<rational>');
  });

  test('a zip Map with a set source is an indexed collection', () => {
    const m = ce.box([
      'Map',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      'L',
      ['Set', 1, 2],
    ]);
    expect(m.type.toString()).toBe('indexed_collection<rational>');
  });
});

describe('the type of a product of rationals', () => {
  test('is rational, not real', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'rational');
    ce.declare('y', 'integer');
    expect(ce.parse('2x').type.toString()).toBe('rational');
    expect(ce.parse('xy').type.toString()).toBe('rational');
    expect(ce.parse('x\\sqrt{2}').type.toString()).toBe('real');
  });
});
