import { ComputeEngine } from '../../src/compute-engine';

// A declared function admits a collection symbol with no value only when the
// type of the symbol shares a value with the parameter: the whole operand
// (the call applies to it) or its elements (the call maps over them, for a
// scalar parameter). A symbol whose type shares no value with the parameter
// is refused when the call is boxed, as a string symbol is.

describe('a declared function refuses a valueless collection symbol that cannot fit', () => {
  const ce = new ComputeEngine();
  ce.declare('h', '(list<integer>) -> integer');
  ce.declare('f', '(matrix<2x2>) -> integer');
  ce.declare('g', '(integer) -> integer');
  ce.declare('S', 'list<string>');
  ce.declare('B', 'list<boolean>');
  ce.declare('N', 'list<integer>');
  ce.declare('M', 'matrix<integer^(2x2)>');
  ce.declare('X', 'list');

  const valid = (fn: string, arg: string) => ce.box([fn, arg]).isValid;

  test('a scalar parameter refuses a list whose elements cannot fit', () => {
    expect(valid('g', 'S')).toBe(false);
    expect(valid('g', 'B')).toBe(false);
  });

  test('a scalar parameter admits a list whose elements can fit', () => {
    expect(valid('g', 'N')).toBe(true);
    expect(valid('g', 'M')).toBe(true);
    expect(valid('g', 'X')).toBe(true);
  });

  test('a matrix parameter refuses a list that cannot be a 2×2 matrix', () => {
    expect(valid('f', 'S')).toBe(false);
    expect(valid('f', 'N')).toBe(false);
    expect(valid('f', 'M')).toBe(true);
    expect(valid('f', 'X')).toBe(true);
  });

  test('a list parameter admits a list that shares the empty list with it', () => {
    // The empty list is a value of both `list<string>` and `list<integer>`.
    expect(valid('h', 'S')).toBe(true);
    expect(valid('h', 'N')).toBe(true);
  });

  test('a literal list keeps the check of each element at evaluation', () => {
    // The application maps over the elements of a list that it holds, and
    // reports an error for each element that does not fit.
    expect(ce.box(['g', ['List', { str: 'a' }]]).isValid).toBe(true);
  });
});
