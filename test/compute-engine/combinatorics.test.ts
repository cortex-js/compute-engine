import { engine as ce } from '../utils';

const evalN = (expr: any) => ce.box(expr).evaluate().toString();

describe('Subfactorial (derangements) — REVIEW.md B9', () => {
  // !n = n·!(n−1) + (−1)^n, with !0 = 1 (OEIS A000166). The previous
  // implementation reduced to result·(i−1), which is 0 at i = 1 and pinned
  // every !n≥1 to 0.
  const expected: [number, string][] = [
    [0, '1'],
    [1, '0'],
    [2, '1'],
    [3, '2'],
    [4, '9'],
    [5, '44'],
    [6, '265'],
    [7, '1854'],
  ];
  for (const [n, want] of expected) {
    test(`Subfactorial(${n}) = ${want}`, () =>
      expect(evalN(['Subfactorial', n])).toEqual(want));
  }

  test('large n is exact (no float overflow)', () =>
    // !25 from OEIS A000166.
    expect(evalN(['Subfactorial', 25])).toEqual(
      '5706255282633466762357224'
    ));

  test('negative n is left undefined/unevaluated', () =>
    expect(ce.box(['Subfactorial', -1]).evaluate().operator).toEqual(
      'Subfactorial'
    ));
});

describe('Fibonacci with negative index — REVIEW.md B10', () => {
  // Reflection formula: F(−n) = (−1)^{n+1} F(n). The previous code built a
  // malformed Negate(Fibonacci, n) (two operands) → an Error expression.
  const expected: [number, string][] = [
    [-1, '1'],
    [-2, '-1'],
    [-3, '2'],
    [-4, '-3'],
    [-5, '5'],
    [-6, '-8'],
    [-7, '13'],
  ];
  for (const [n, want] of expected) {
    test(`Fibonacci(${n}) = ${want}`, () =>
      expect(evalN(['Fibonacci', n])).toEqual(want));
  }

  test('non-negative index is unchanged', () => {
    expect(evalN(['Fibonacci', 0])).toEqual('0');
    expect(evalN(['Fibonacci', 1])).toEqual('1');
    expect(evalN(['Fibonacci', 10])).toEqual('55');
  });
});
