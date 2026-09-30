/**
 * A `Range`, a `Linspace`, a comprehension and a `Tabulate` are typed
 * `list<T>`, so a symbol declared `list` or `list<number>` accepts them.
 * They were typed `indexed_collection<T>`, which such a declaration refused
 * (row 337 of the Tycho ledger, `tycho/docs/COMPUTE_ENGINE.md`, 2026-09-29),
 * while every other lazy ordered producer
 * (`Map`, `Filter`, `Repeat`, `Cycle`, `Iterate`) already typed `list`.
 *
 * The `list` type says nothing about the length: an unbounded range is a
 * lazy `list<integer>`, as the lazy `Map` over it is. Whether a collection is
 * finite is a fact about the value (`isFiniteCollection`), not about the
 * type. An index span (the `range` type, `Range(1, 5)`) is a subtype of
 * `list<integer>`; a tuple and a string are not lists.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('n', 'integer');

function typeOf(json: any): string {
  return ce.box(json).type.toString();
}

describe('Range, Linspace, Comprehension and Tabulate are lists', () => {
  test('Range is list<integer>, list<real> or list<number> by its elements', () => {
    expect(typeOf(['Range', 0, 5])).toBe('list<integer>');
    expect(typeOf(['Range', 0, 'n'])).toBe('list<integer>');
    expect(typeOf(['Range', 5, 2])).toBe('list<integer>');
    expect(typeOf(['Range', 1, 10, 2])).toBe('list<integer>');
    expect(typeOf(['Range', 0.5, 2.5])).toBe('list<real>');
    expect(typeOf(['Range', 0, 1, 0.1])).toBe('list<real>');
  });

  test('an index span keeps the narrower range type, a subtype of list<integer>', () => {
    expect(typeOf(['Range', 1, 5])).toBe('range');
    expect(ce.type('range').matches('list<integer>')).toBe(true);
    expect(ce.type('range').matches('list')).toBe(true);
    expect(ce.type('range').matches('indexed_collection<integer>')).toBe(true);
    expect(ce.type('list<integer>').matches('range')).toBe(false);
  });

  test('an unbounded Range is a lazy list<integer>, as the Map over it is', () => {
    expect(typeOf(['Range', 1, 'PositiveInfinity'])).toBe('list<integer>');
    expect(typeOf(['Range', 'NegativeInfinity', -1])).toBe('list<integer>');
    expect(
      typeOf([
        'Map',
        ['Function', ['Square', 'x'], 'x'],
        ['Range', 1, 'PositiveInfinity'],
      ])
    ).toMatch(/^list</);
    expect(ce.box(['Range', 1, 'PositiveInfinity']).isFiniteCollection).toBe(
      false
    );
  });

  test('Linspace is list<real> for real endpoints and list<number> otherwise', () => {
    expect(typeOf(['Linspace', 0, 1, 5])).toBe('list<real>');
    expect(typeOf(['Linspace', 0, 1, 'n'])).toBe('list<real>');
    expect(typeOf(['Linspace', 0, 1])).toBe('list<real>');
    expect(typeOf(['Linspace', 10])).toBe('list<real>');
    ce.declare('z', 'complex');
    expect(typeOf(['Linspace', 0, 'z', 5])).toBe('list<number>');
  });

  test('a comprehension is a list of its body type', () => {
    const c = ce.parse(
      '\\left[k^{2}\\operatorname{for}k=\\left[1...5\\right]\\right]'
    );
    expect(c.type.toString()).toBe('list<integer<0..>>');
    expect(c.evaluate().toString()).toBe('[1,4,9,16,25]');
    expect(
      typeOf([
        'Comprehension',
        ['Tuple', 'k', ['Square', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ])
    ).toBe('list<tuple<integer, integer<0..>>>');
  });

  test('a tabulation is a list', () => {
    expect(typeOf(['Tabulate', ['Function', ['Square', 'i'], 'i'], 3])).toBe(
      'list<number>'
    );
    expect(
      typeOf(['Tabulate', ['Function', ['Multiply', 'i', 'j'], 'i', 'j'], 2, 3])
    ).toBe('list<list>');
  });
});

describe('a symbol declared list accepts every ordered producer (Tycho row 337)', () => {
  const sources: [string, any][] = [
    ['Range(0, 5)', ['Range', 0, 5]],
    ['Range(1, 5)', ['Range', 1, 5]],
    ['Range(0, n)', ['Range', 0, 'n']],
    ['Linspace(0, 1, 5)', ['Linspace', 0, 1, 5]],
    ['Linspace(0, 1, n)', ['Linspace', 0, 1, 'n']],
    ['comprehension', ['Comprehension', ['Square', 'k'], ['Element', 'k', ['Range', 1, 5]]]],
    ['Tabulate', ['Tabulate', ['Function', ['Square', 'i'], 'i'], 3]],
    ['2 * Range(0, n)', ['Multiply', 2, ['Range', 0, 'n']]],
    ['List literal', ['List', 1, 2, 3]],
  ];

  let counter = 0;
  function fresh(decl: string): string {
    const name = `L${counter++}`;
    ce.declare(name, decl);
    return name;
  }

  test.each(sources)('%s is accepted under list and list<number>', (_label, json) => {
    for (const decl of ['list', 'list<number>']) {
      const name = fresh(decl);
      const value = ce.box(json);
      expect(() => ce.assign(name, value)).not.toThrow();
      expect(() => ce.assign(fresh(decl), value.evaluate())).not.toThrow();
      expect(ce.box(name).type.matches('list')).toBe(true);
    }
  });

  test('a tuple and a string are refused', () => {
    for (const decl of ['list', 'list<number>']) {
      expect(() => ce.assign(fresh(decl), ce.box(['Tuple', 1, 2]))).toThrow();
      expect(() => ce.assign(fresh(decl), ce.string('abc'))).toThrow();
    }
  });

  test('an index span assigned to a list<integer> symbol reads back its elements', () => {
    const name = fresh('list<integer>');
    ce.assign(name, ce.box(['Range', 1, 4]));
    expect(ce.box(['Sum', name]).evaluate().toString()).toBe('10');
    expect(ce.box(['Length', name]).evaluate().toString()).toBe('4');
  });
});

describe('an aggregate reads finiteness off the structure, not off the list type', () => {
  const ce = new ComputeEngine();
  ce.declare('L', 'list<integer>');
  const typeOf = (json: any) => ce.box(json).type.toString();

  test('a bounded range or a declared list folds to its element tier', () => {
    expect(typeOf(['Sum', ['Range', 1, 10]])).toBe('integer');
    expect(typeOf(['Sum', ['Range', 0, 10]])).toBe('integer');
    expect(typeOf(['Max', ['Range', 1, 10]])).toBe('integer');
    expect(typeOf(['Sum', 'L'])).toBe('integer');
    expect(typeOf(['Mean', ['Range', 1, 10]])).toBe('rational');
  });

  test('a producer with no last element is left to the top type', () => {
    for (const source of [
      ['Range', 1, 'PositiveInfinity'],
      ['Range', 'NegativeInfinity', -1],
      ['Repeat', 1],
      ['Cycle', ['List', 1, 2]],
      ['Iterate', ['Function', ['Add', 'x', 1], 'x'], 1],
      ['Map', ['Function', ['Square', 'x'], 'x'], ['Range', 1, 'PositiveInfinity']],
      ['Filter', ['Range', 1, 'PositiveInfinity'], ['Function', ['Greater', 'x', 2], 'x']],
      ['Join', ['Range', 1, 'PositiveInfinity'], ['List', 0]],
      ['Rest', ['Range', 1, 'PositiveInfinity']],
      ['Reverse', ['Range', 'NegativeInfinity', -1]],
      ['Zip', ['Range', 1, 'PositiveInfinity'], ['Repeat', 1]],
    ]) {
      expect(typeOf(['Sum', source])).toBe('number');
      expect(typeOf(['Max', source])).toBe('number');
    }
  });

  test('a bound whose type admits an infinity is not proven finite', () => {
    ce.declare('m', 'number');
    ce.declare('k', 'integer');
    expect(typeOf(['Sum', ['Range', 1, 'm']])).toBe('number');
    expect(typeOf(['Max', ['Range', 1, 'm']])).toBe('number');
    expect(typeOf(['Sum', ['Range', 1, 'k']])).toBe('integer');
  });
});

describe('no overload may echo the range type for a value that is not a span', () => {
  const ce = new ComputeEngine();
  test('a type variable bound at a span binds to list<integer>', () => {
    expect(ce.box(['Reverse', ['Range', 1, 10]]).type.toString()).toBe('list<integer>');
    expect(ce.box(['RotateLeft', ['Range', 1, 10]]).type.toString()).toBe('list<integer>');
    expect(ce.box(['Sort', ['Range', 1, 5]]).type.toString()).toBe('list<integer>');
  });
});
