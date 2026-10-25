import { ComputeEngine } from '../../src/compute-engine';

/**
 * CE-117.1, CE-117.2, CE-117.3. Linear-algebra operators over a symbolic
 * operand stay unevaluated when the answer depends on a value that is not
 * known:
 * - `IdentityMatrix(n)`, `ZeroMatrix(2, n)` and `OnesMatrix(n)` with a
 *   valueless `n` gave the error `expected-positive-integer`;
 * - `Kernel(k)` for a valueless `k: integer` gave `[]`, which assumes
 *   `k ≠ 0`;
 * - `Shape(m)` for a valueless `m: matrix<integer>` gave `(-1, -1)`, where
 *   `-1` marks an axis of unknown extent; `Shape(q)` for a free `q` gave
 *   `()`, the shape of a scalar, although `q` may hold a collection.
 */

const ce = new ComputeEngine();
ce.declare('k', 'integer');
ce.declare('m', 'matrix<integer>');
ce.declare('p', 'integer');
ce.assume(ce.parse('p > 0'));

function evaluated(json: unknown): string {
  return ce.box(json as any).evaluate().toString();
}

describe('CE-117.1: constant matrix constructors with a symbolic size', () => {
  test.each([
    [['IdentityMatrix', 'n'], 'IdentityMatrix(n)'],
    [['IdentityMatrix', 'k'], 'IdentityMatrix(k)'],
    [['ZeroMatrix', 2, 'n'], 'ZeroMatrix(2, n)'],
    [['ZeroMatrix', 'n'], 'ZeroMatrix(n)'],
    [['OnesMatrix', 'n', 3], 'OnesMatrix(n, 3)'],
  ])('%j stays unevaluated', (json, expected) => {
    expect(evaluated(json)).toBe(expected);
  });

  test('a literal size that is not positive is still an error', () => {
    expect(evaluated(['IdentityMatrix', -1])).toBe(
      'Error("expected-positive-integer", "-1")'
    );
    expect(evaluated(['ZeroMatrix', 2, 0])).toBe(
      'Error("expected-positive-integer", "0")'
    );
  });

  test('a literal size gives the matrix', () => {
    expect(evaluated(['IdentityMatrix', 2])).toBe('[[1,0],[0,1]]');
    expect(evaluated(['ZeroMatrix', 1, 2])).toBe('[[0,0]]');
  });

  test('the parse route', () => {
    expect(
      ce.parse('\\operatorname{IdentityMatrix}(n)').evaluate().toString()
    ).toBe('IdentityMatrix(n)');
  });
});

describe('CE-117.2: the kernel of a symbolic scalar', () => {
  test('a valueless integer stays unevaluated', () => {
    expect(evaluated(['Kernel', 'k'])).toBe('Kernel(k)');
  });

  test('a scalar whose sign is known has a kernel', () => {
    expect(evaluated(['Kernel', 'p'])).toBe('[]');
    expect(evaluated(['Kernel', 'Pi'])).toBe('[]');
  });

  test('a number literal has a kernel', () => {
    expect(evaluated(['Kernel', 0])).toBe('[[1]]');
    expect(evaluated(['Kernel', 3])).toBe('[]');
  });
});

describe('CE-117.3: the shape of a valueless matrix', () => {
  test('Shape stays unevaluated, Rank is known', () => {
    expect(evaluated(['Shape', 'm'])).toBe('Shape(m)');
    expect(evaluated(['Rank', 'm'])).toBe('2');
  });

  test('a free symbol may hold a collection: Shape stays unevaluated', () => {
    expect(evaluated(['Shape', 'q'])).toBe('Shape(q)');
    expect(evaluated(['Rank', 'q'])).toBe('Rank(q)');
    // A scalar has the shape `()`.
    expect(evaluated(['Shape', 5])).toBe('()');
    expect(evaluated(['Shape', 'p'])).toBe('()');
  });

  test('a matrix value has a shape', () => {
    expect(evaluated(['Shape', ['List', ['List', 1, 2, 3]]])).toBe('(1, 3)');
  });
});
