import { ComputeEngine } from '../../src/compute-engine';

/**
 * The data parameter of the statistics operators is a collection of numbers,
 * `collection<nothing | number>` (`collection<nothing | number | tuple>` for
 * the first operand of the bivariate statistics, which also take a
 * collection of `(x, y)` pairs). A matrix, whose elements are rows, is refused
 * when the expression is boxed, not when it is evaluated (user decision of
 * 2026-10-23, ROADMAP CE-13).
 *
 * The validation of a collection argument whose conformance cannot be
 * decided statically (`overlapsForDeferredValidation()`,
 * `common/type/utils.ts`) gives such a parameter rank 1, and compares the
 * immediate elements of the argument with the elements of the parameter.
 */
function valid(ce: ComputeEngine, json: unknown): boolean {
  return ce.box(json as never).isValid;
}

describe('a matrix is refused when the expression is boxed', () => {
  test.each(['Mean', 'Median', 'Variance', 'Mode', 'Quartiles'])(
    '%s of a matrix literal or of a symbol declared matrix',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('M', 'matrix');
      expect(valid(ce, [op, ['List', ['List', 1, 2], ['List', 3, 4]]])).toBe(
        false
      );
      expect(valid(ce, [op, 'M'])).toBe(false);
    }
  );

  test('Histogram and Covariance of a list of rows', () => {
    const ce = new ComputeEngine();
    ce.declare('R', 'list<list<number>>');
    expect(valid(ce, ['Histogram', 'R', 2])).toBe(false);
    expect(
      valid(ce, ['Covariance', ['List', ['List', 1, 2], ['List', 3, 4]]])
    ).toBe(false);
  });

  test('a collection of booleans or strings', () => {
    const ce = new ComputeEngine();
    ce.declare('SB', 'set<boolean>');
    expect(valid(ce, ['Mean', ['List', 'True', 'False']])).toBe(false);
    expect(valid(ce, ['Median', ['List', { str: 'a' }, { str: 'b' }]])).toBe(
      false
    );
    expect(valid(ce, ['Mean', 'SB'])).toBe(false);
  });
});

describe('data of every supported shape is accepted', () => {
  test('a vector, several numbers, a set, a range and a tuple', () => {
    const ce = new ComputeEngine();
    const mean = (json: unknown) =>
      ce
        .box(['Mean', json] as never)
        .evaluate()
        .toString();
    expect(mean(['List', 1, 2, 3])).toBe('2');
    expect(mean(['Set', 1, 2, 3])).toBe('2');
    expect(mean(['Range', 1, 10])).toBe('11/2');
    expect(mean(['Tuple', 1, 2, 3])).toBe('2');
    expect(ce.box(['Mean', 1, 2, 3]).evaluate().toString()).toBe('2');
  });

  test('data with absent cells reaches the handler', () => {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<integer | missing>');
    expect(valid(ce, ['Mean', 'L'])).toBe(true);
    expect(
      ce
        .box(['Mean', ['List', 1, 'Missing', 3]])
        .evaluate()
        .toString()
    ).toBe('NaN');
  });

  test('a collection of pairs at the bivariate statistics', () => {
    const ce = new ComputeEngine();
    const pairs = ['List', ['Tuple', 1, 2], ['Tuple', 2, 4], ['Tuple', 3, 6]];
    expect(ce.box(['Covariance', pairs]).evaluate().toString()).toBe('2');
  });

  test('a collection whose elements are not known yet is deferred', () => {
    const ce = new ComputeEngine();
    ce.declare('S', 'set<unknown>');
    ce.declare('U', 'list');
    expect(valid(ce, ['Histogram', 'S', 2])).toBe(true);
    expect(valid(ce, ['Covariance', 'S', 'S'])).toBe(true);
    expect(valid(ce, ['Mean', 'U'])).toBe(true);
  });

  test('a declared type that holds the empty list is checked at evaluation by Mean', () => {
    // `Mean` takes its data through a variadic parameter, where the overlap
    // admission (`overlapAdmission()`, `boxed-expression/validate.ts`)
    // admits a declared type that shares a value with the parameter and
    // leaves the check to evaluation. `list<list<number>>` and
    // `list<boolean>` share the empty list with the parameter, and `Mean([])`
    // is `NaN`. `Histogram`, whose data parameter is not variadic, refuses
    // the same declared type when it is boxed (ROADMAP CE-402).
    const ce = new ComputeEngine();
    ce.declare('R', 'list<list<number>>');
    ce.declare('B', 'list<boolean>');
    expect(valid(ce, ['Mean', 'R'])).toBe(true);
    expect(valid(ce, ['Mean', 'B'])).toBe(true);
  });
});
