/**
 * CE-1407: a quantifier over an `Interval` tried only the integers of the
 * interval, so `Exists(Element(x, Interval(1, 2)), x == 1.5)` was `False`.
 *
 * An `Interval` is a set of real numbers, which a quantifier cannot
 * enumerate: the quantifier stays unevaluated. A `Range` is the set of the
 * integers between two bounds, and a quantifier over it is still enumerated.
 * The index of a `Sum` over an `Interval` still takes the integers between
 * the bounds (a documented behavior of `Sum` and `Product`).
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
const evaluate = (json: any) => ce.box(json).evaluate().json;

describe('CE-1407: a quantifier over an Interval is not enumerated', () => {
  test.each([
    ['Exists', ['Equal', 'x', 1.5]],
    ['Exists', ['Equal', 'x', 1]],
    ['ForAll', ['Less', 'x', 0]],
    ['ForAll', ['Equal', ['Floor', 'x'], 'x']],
    ['ExistsUnique', ['Equal', 'x', 1]],
  ])('%s over Interval(1, 2), body %j, stays unevaluated', (q, body) => {
    const json = [q, ['Element', 'x', ['Interval', 1, 2]], body];
    expect(evaluate(json)).toEqual(ce.box(json).json);
  });

  test('an open interval stays unevaluated', () => {
    const json = [
      'Exists',
      ['Element', 'x', ['Interval', ['Open', 0], ['Open', 3]]],
      ['Equal', 'x', 1],
    ];
    expect(evaluate(json)).toEqual(ce.box(json).json);
  });

  test('a nested quantifier over an Interval stays unevaluated', () => {
    const json = [
      'ForAll',
      ['Element', 'x', ['Set', 1, 2]],
      [
        'Exists',
        ['Element', 'y', ['Interval', 0, 3]],
        ['Equal', 'y', ['Add', 'x', 0.5]],
      ],
    ];
    expect(evaluate(json)).toEqual(ce.box(json).json);
  });

  test('the Epsil witness stays unevaluated', () => {
    const expr = ce.parse('\\exists x\\in\\lbrack1, 2\\rbrack, x=1.5');
    expect(expr.operator).toBe('Exists');
    expect(expr.evaluate().operator).toBe('Exists');
  });

  test('a body that does not read the variable is still decided', () => {
    expect(
      evaluate(['Exists', ['Element', 'x', ['Interval', 1, 2]], 'True'])
    ).toBe('True');
  });
});

describe('CE-1407: a quantifier over a Range is enumerated', () => {
  test('Exists and ForAll over Range(1, 5)', () => {
    expect(
      evaluate(['Exists', ['Element', 'n', ['Range', 1, 5]], ['Equal', 'n', 3]])
    ).toBe('True');
    expect(
      evaluate(['ForAll', ['Element', 'n', ['Range', 1, 5]], ['Less', 'n', 5]])
    ).toBe('False');
    expect(
      evaluate([
        'ExistsUnique',
        ['Element', 'n', ['Range', 1, 5]],
        ['Equal', 'n', 3],
      ])
    ).toBe('True');
  });
});

describe('CE-1407: a Sum over an Interval still takes its integers', () => {
  test('Sum(k, Element(k, Interval(1, 5))) is 15', () => {
    expect(evaluate(['Sum', 'k', ['Element', 'k', ['Interval', 1, 5]]])).toBe(
      15
    );
  });
});
