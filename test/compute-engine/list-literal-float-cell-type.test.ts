/**
 * The type of an element-wise sum or product whose cells are floats in the
 * `rational` tier.
 *
 * A float with an integer value inside a list or tuple literal (`1.0` in
 * `[1.0, 2]`) is typed `integer` in the type of the literal, so the type of
 * the result cells could not see it: `[1.0, 2] / 3` canonicalizes to
 * `1/3 · [1, 2]`, which was typed `vector<rational^2>` while it evaluates to
 * `[0.333…, 2/3]`, typed `vector<real^2>`. The `Add` and `Multiply` type
 * handlers now read each element of a list literal and apply the downgrade
 * of a scalar (a float operand makes a float result, and a float that is not
 * an integer is `real`).
 *
 * The same handlers also kept the scalar factors out of a product of two
 * collections: `[1, 2]·[3, 4]·(1/3)` was typed `vector<integer^2>` and
 * evaluates to `[1, 8/3]`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();
ce.declare('L', 'list<rational>');
ce.declare('M', 'matrix<rational^(2x2)>');

const typeOf = (latex: string): string => ce.parse(latex).type.toString();
const evaluatedTypeOf = (latex: string): string =>
  ce.parse(latex).evaluate().type.toString();

describe('A FLOAT CELL IN THE RATIONAL TIER IS TYPED REAL', () => {
  test.each([
    ['[1.0, 2] / 3', 'vector<real^2>'],
    ['\\frac{[1.0, 2]}{3}', 'vector<real^2>'],
    ['[1.0, 2] \\times \\frac13', 'vector<real^2>'],
    ['\\frac12 [1.0, 2]', 'vector<real^2>'],
    ['2.0 [\\frac13, 1]', 'vector<real^2>'],
    ['[1.0, 2] \\times [\\frac13, 1]', 'vector<real^2>'],
    ['[[1.0, 2], [3, 4]] / 3', 'matrix<real^(2x2)>'],
    ['[1.0, 2] + \\frac13', 'vector<real^2>'],
    ['[1.0, 2] - \\frac13', 'vector<real^2>'],
    ['[\\frac13, 1] - 1.0', 'vector<real^2>'],
    ['[1.0, 2] + [\\frac13, 1]', 'vector<real^2>'],
    ['[[1.0, 2], [3, 4]] + \\frac13', 'matrix<real^(2x2)>'],
  ])('%s', (latex, expected) => {
    expect(typeOf(latex)).toBe(expected);
    expect(evaluatedTypeOf(latex)).toBe(expected);
  });

  test('a list of points with a float coordinate', () => {
    expect(typeOf('[(1.0, 2), (3, 4)] / 3')).toBe('list<tuple<real, real>^2>');
    expect(typeOf('\\frac13 [(1.0, 2), (3, 4)]')).toBe(
      'list<tuple<real, real>^2>'
    );
    expect(typeOf('[(1.0, 2), (3, 4)] + (\\frac13, 0)')).toBe(
      'list<tuple<real, integer>>'
    );
  });

  test('a point with a float coordinate', () => {
    expect(typeOf('\\frac13 (1.0, 2)')).toBe('tuple<real, real>');
  });

  test('a float scalar beside a declared collection of rationals', () => {
    expect(typeOf('2.0 L')).toBe('list<real>');
    expect(typeOf('L + 1.0')).toBe('list<real>');
    expect(typeOf('2.0 M')).toBe('matrix<real^(2x2)>');
  });
});

describe('THE OTHER CELLS KEEP THEIR TIER', () => {
  test('an integer-valued float beside integers is an integer', () => {
    // `[1.0, 2]·3` is `[3.0, 6]`: the float `3.0` is typed `integer`.
    expect(typeOf('[1.0, 2] \\times 3')).toBe('vector<integer^2>');
    expect(typeOf('[1.0, 2] + 1')).toBe('vector<integer^2>');
    expect(typeOf('[1.0, 2] \\times [3, 4]')).toBe('vector<integer^2>');
  });

  test('an exact rational cell beside a float that gives an integer', () => {
    // `[1.0, 1/2]·2` is `[2.0, 1]`: no cell is a float in the rational tier.
    expect(typeOf('[1.0, \\frac12] \\times 2')).toBe('vector<rational^2>');
  });

  test('exact data stays rational', () => {
    expect(typeOf('[1, 2] / 3')).toBe('vector<rational^2>');
    expect(typeOf('[1, 2] + \\frac13')).toBe('vector<rational^2>');
  });
});

describe('THE SCALAR FACTORS OF A PRODUCT OF COLLECTIONS', () => {
  test.each([
    ['[1, 2] \\times [3, 4] \\times \\frac13', 'vector<rational^2>'],
    [
      '[[1, 2], [3, 4]] \\times [[1, 2], [3, 4]] \\times \\frac13',
      'matrix<rational^(2x2)>',
    ],
    [
      '[(1, 2), (3, 4)] \\times [1, 2] \\times \\frac13',
      'list<tuple<rational, rational>^2>',
    ],
  ])('%s', (latex, expected) => {
    expect(typeOf(latex)).toBe(expected);
    expect(evaluatedTypeOf(latex)).toBe(expected);
  });
});

describe('THE CANONICAL TYPE ADMITS THE VALUE', () => {
  test.each([
    '[1.0, 2] / 3',
    '[1.0, 2] + \\frac13',
    '2.0 [\\frac13, 1]',
    '[1.0, 2] \\times [\\frac13, 1]',
    '[1.0, 2] \\times [3, 4] \\times \\frac13',
    '[(1.0, 2), (3, 4)] / 3',
    '\\frac13 (1.0, 2)',
  ])('%s', (latex) => {
    const expr = ce.parse(latex);
    expect(expr.evaluate().type.matches(expr.type)).toBe(true);
  });
});
