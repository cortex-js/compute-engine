import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

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

  test('a literal list keeps the check of each element at evaluation, for a function with a body', () => {
    // The application maps over the elements of a list that it holds, and
    // reports an error for each element that does not fit.
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> integer');
    ce.assign('g', ce.box(['Function', 'n', 'n']));
    expect(ce.box(['g', ['List', { str: 'a' }]]).isValid).toBe(true);
  });
});

// CE-1839: a function that is declared with a signature and has no body is
// never applied, so no application reports the elements of a list that it
// holds. Such a list is refused when the call is boxed, when none of its
// elements can fit the parameter.
describe('a declared function with no body refuses a held list that cannot fit', () => {
  const ce = new ComputeEngine();
  ce.declare('g', '(integer) -> integer');
  ce.declare('k', '(real, string) -> real');
  ce.declare('h', '(tuple<real, real>, string) -> real');
  ce.declare('r', 'real');
  ce.assign('held', ['List', 1, 2]);

  const str = (s: string) => ({ str: s });

  test('a list of numbers at a `string` parameter is `incompatible-type`', () => {
    expect(ce.box(['k', 1, ['List', 1, 2]]).toString()).toBe(
      'k(1, Error(ErrorCode("incompatible-type", "string", "vector<integer^2>"), [1,2]))'
    );
    expect(ce.box(['k', 1, ['List', 1, 2]]).type.toString()).toBe('error');
    // A point parameter beside the scalar parameter (the witness of CE-1745
    // for a function).
    expect(ce.box(['h', ['Tuple', 1, 0], ['List', 1, 2]]).toString()).toBe(
      'h((1, 0), Error(ErrorCode("incompatible-type", "string", "vector<integer^2>"), [1,2]))'
    );
    expect(ce.box(['g', ['List', str('a')]]).isValid).toBe(false);
    expect(ce.box(['k', ['List', str('a')], str('b')]).isValid).toBe(false);
  });

  test('a nested list and a list of typed symbols are refused', () => {
    expect(ce.box(['k', 1, ['List', ['List', 1], ['List', 2]]]).isValid).toBe(
      false
    );
    expect(ce.box(['k', 1, ['List', 'r']]).isValid).toBe(false);
  });

  test('the elements that a symbol holds are not read', () => {
    // A later assignment can replace them.
    expect(ce.box(['k', 1, 'held']).isValid).toBe(true);
    expect(ce.box(['k', 1, ['List', 'held']]).isValid).toBe(true);
  });

  test('`NaN` and `Missing` elements fit a numeric parameter', () => {
    expect(ce.box(['k', 'NaN', str('a')]).isValid).toBe(true);
    expect(ce.box(['k', ['List', 'NaN'], str('a')]).isValid).toBe(true);
    expect(ce.box(['k', ['List', 'Missing'], str('a')]).isValid).toBe(true);
    expect(ce.box(['k', 1, ['List', 'NaN']]).isValid).toBe(false);
  });

  test('a list whose elements can fit is mapped', () => {
    expect(ce.box(['k', 1, ['List', str('a'), str('b')]]).type.toString()).toBe(
      'vector<real^2>'
    );
    expect(ce.box(['k', ['List', 1, 2], str('a')]).isValid).toBe(true);
  });

  test('a list with one element that can fit is not refused', () => {
    expect(ce.box(['k', 1, ['List', str('a'), 2]]).isValid).toBe(true);
    expect(ce.box(['k', 1, ['List', ['List', 1], ['List', str('a')]]]).isValid)
      .toBe(true);
  });

  test('an element with no declared type can still fit', () => {
    // The type of `[v]` is a list of numbers, and `v` can hold a string.
    expect(ce.box(['k', 1, ['List', 'v']]).isValid).toBe(true);
    expect(ce.box(['k', 1, ['List', ['List', 'w']]]).isValid).toBe(true);
  });

  test('the empty list and a lazy view are not refused', () => {
    expect(ce.box(['k', 1, ['List']]).isValid).toBe(true);
    expect(ce.box(['k', 1, ['Range', 1, 3]]).isValid).toBe(true);
  });

  test('the call is refused also after the function receives a body', () => {
    const ce = new ComputeEngine();
    ce.declare('k', '(real, string) -> real');
    const call = ce.box(['k', 1, ['List', 1, 2]]);
    ce.assign('k', ce.box(['Function', 'a', 'a', 's']));
    expect(call.isValid).toBe(false);
    // A call that is boxed after the assignment maps the list.
    expect(ce.box(['k', 1, ['List', 1, 2]]).isValid).toBe(true);
  });
});

describe('the same on the Epsil route', () => {
  const staticErrors = (source: string) => {
    const ce = new ComputeEngine();
    ce.declare('k', '(real, string) -> real');
    return executeEpsil(ce, source).diagnostics.filter(
      (d) => d.message[0] === 'static-type-error'
    );
  };

  test('a call of a function that the host declares with no body reports the list', () => {
    expect(staticErrors('k(1, [1, 2])')).toHaveLength(1);
    expect(staticErrors('k(1, ["a", "b"])')).toHaveLength(0);
  });

  test('a variable or a parameter that receives its function when the program runs still reports each element', () => {
    const perElement =
      '[Error(ErrorCode("incompatible-type", "string", "1"), 1, "while applying \'k\' element-wise over 2 elements (element 1)"),Error(ErrorCode("incompatible-type", "string", "2"), 2, "while applying \'k\' element-wise over 2 elements (element 2)")]';
    expect(
      executeEpsil(
        new ComputeEngine(),
        `let k: (real, string) -> real
if (1 > 0) { k = (a, s) => 7 }
k(1, [1, 2])`
      ).value!.toString()
    ).toBe(perElement);
    expect(
      executeEpsil(
        new ComputeEngine(),
        `function ap(k: (real, string) -> real) { k(1, [1, 2]) }
ap((a, s) => 7)`
      ).value!.toString()
    ).toBe(perElement);
  });

  test('a function with a body still reports each element', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      `function k(a: real, s: string) { s }
k(1, [1, 2])`
    );
    expect(r.value!.toString()).toBe(
      '[Error(ErrorCode("incompatible-type", "string", "1"), 1, "while applying \'k\' element-wise over 2 elements (element 1)"),Error(ErrorCode("incompatible-type", "string", "2"), 2, "while applying \'k\' element-wise over 2 elements (element 2)")]'
    );
  });
});
