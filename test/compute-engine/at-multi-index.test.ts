import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

/**
 * Tycho item 129: `At` with more indices than the collection has dimensions
 * used to evaluate to ITSELF — silently. A mis-parse (e.g. a range infix
 * swallowing a `+`) then flowed on as a plausible-looking inert expression.
 *
 * `At` now reports `incompatible-dimensions` at evaluate time when an
 * intermediate value is PROVABLY not indexable and indices remain. A value
 * that could still resolve to a collection at runtime (an unbound symbol)
 * keeps `At` unevaluated, as before.
 */

const ce = new ComputeEngine();

const LIST: Expression = ['List', 10, 20, 30];
const MATRIX: Expression = ['List', ['List', 1, 2], ['List', 3, 4]];
const TUPLES: Expression = ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]];

const boxEval = (expr: Expression) => ce.box(expr).evaluate().toString();
const parseEval = (latex: string) => ce.parse(latex).evaluate().toString();

const DIM_ERROR_2 =
  'Error("incompatible-dimensions", "2 indices vs 1-dimensional collection")';

describe('At: extra indices on a non-indexable value', () => {
  test('1-D list with two indices errors (box route)', () =>
    expect(boxEval(['At', LIST, 1, 2])).toBe(DIM_ERROR_2));

  test('1-D list with three indices errors', () =>
    expect(boxEval(['At', LIST, 1, 2, 3])).toBe(
      'Error("incompatible-dimensions", "3 indices vs 1-dimensional collection")'
    ));

  test('2-D matrix with three indices errors', () =>
    expect(boxEval(['At', MATRIX, 1, 2, 3])).toBe(
      'Error("incompatible-dimensions", "3 indices vs 2-dimensional collection")'
    ));

  test('a string element IS indexable — a string is a collection of characters', () =>
    // Before strings became `indexed_collection<character>` a second index on
    // a string element was an `incompatible-dimensions` error; now it selects
    // that string's second character.
    expect(boxEval(['At', ['List', "'ab'", "'cd'"], 1, 2])).toBe('"b"'));

  test('a scalar dictionary value with a trailing index errors', () =>
    expect(
      boxEval(['At', ['Dictionary', ['Tuple', "'a'", 1]], "'a'", 2])
    ).toBe(DIM_ERROR_2));
});

describe('At: legitimate multi-index is unchanged', () => {
  test('matrix row/column', () => expect(boxEval(['At', MATRIX, 1, 2])).toBe('2'));

  test('matrix row/column, second row', () =>
    expect(boxEval(['At', MATRIX, 2, 1])).toBe('3'));

  test('list of tuples', () => expect(boxEval(['At', TUPLES, 1, 2])).toBe('2'));

  test('dictionary value that IS a collection', () =>
    expect(
      boxEval(['At', ['Dictionary', ['Tuple', "'a'", ['List', 7, 8]]], "'a'", 2])
    ).toBe('8'));

  test('gather index then a scalar index', () =>
    expect(boxEval(['At', MATRIX, ['List', 1, 2], 1])).toBe('[1,2]'));
});

describe('At: single-index and edge conventions preserved', () => {
  test('positive index', () => expect(boxEval(['At', LIST, 1])).toBe('10'));

  test('negative index counts from the end', () =>
    expect(boxEval(['At', LIST, -1])).toBe('30'));

  test('out-of-range scalar index yields the absence marker', () =>
    expect(boxEval(['At', LIST, 10])).toBe('NaN'));

  test('an out-of-range intermediate still absorbs into the final domain', () =>
    // The absence marker short-circuits BEFORE the indexability check, so this
    // keeps reporting absence rather than a dimension error.
    expect(boxEval(['At', LIST, 10, 2])).toBe('"Missing"'));

  test('a string base is indexed 1-based, like any indexed collection', () =>
    // Formerly an `incompatible-type` error against
    // `dictionary | indexed_collection`; a string now satisfies that parameter.
    expect(boxEval(['At', "'hello'", 2])).toBe('"e"'));
});

describe('At: a value that could still be a collection stays inert', () => {
  test('unbound symbol base', () =>
    expect(boxEval(['At', 'w', 1, 2])).toBe('At(w, 1, 2)'));

  test('unbound symbol element', () =>
    expect(boxEval(['At', ['List', 'u', 'v'], 1, 2])).toBe('At([u,v], 1, 2)'));
});

describe('At: box and parse routes agree', () => {
  const engine = new ComputeEngine();
  engine.assign('L', engine.box(LIST));
  engine.assign('M', engine.box(MATRIX));

  test('parse route: 1-D list with two indices errors', () =>
    expect(engine.parse('L_{1,2}').evaluate().toString()).toBe(DIM_ERROR_2));

  test('parse route: matrix with two indices still works', () =>
    expect(engine.parse('M_{1,2}').evaluate().toString()).toBe('2'));

  test('parse route: single index still works', () =>
    expect(engine.parse('L_1').evaluate().toString()).toBe('10'));

  test('box and parse agree on the literal list form', () =>
    expect(parseEval('\\lbrack 10,20,30\\rbrack_{1,2}')).toBe(
      boxEval(['At', LIST, 1, 2])
    ));
});
