import { engine as ce } from '../utils';
import { ComputeEngine } from '../../src/compute-engine';

const evalN = (expr: any) => ce.expr(expr).evaluate().toString();

// In strict mode the `(integer)` signature rejects a non-integer argument, but
// the evaluate handlers must not silently round it in non-strict mode either.
describe('integer-only functions stay symbolic for non-integer args', () => {
  const loose = new ComputeEngine();
  loose.strict = false;
  const ev = (expr: any) => loose.box(expr).evaluate().toString();

  test('Factorial2/Subfactorial/BellNumber do not round non-integers', () => {
    expect(ev(['Factorial2', 5.5])).toEqual('Factorial2(5.5)');
    expect(ev(['Subfactorial', 5.5])).toEqual('Subfactorial(5.5)');
    expect(ev(['BellNumber', 5.5])).toEqual('BellNumber(5.5)');
  });

  test('integer arguments (incl. integer-valued floats) still evaluate', () => {
    expect(ev(['Factorial2', 5])).toEqual('15');
    expect(ev(['Factorial2', 6.0])).toEqual('48');
    expect(ev(['Subfactorial', 4])).toEqual('9');
    expect(ev(['BellNumber', 5])).toEqual('52');
  });
});

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
    expect(ce.expr(['Subfactorial', -1]).evaluate().operator).toEqual(
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

// REVIEW.md B22: Multinomial/BellNumber used machine floats (rounding error +
// overflow); both now use exact bigint arithmetic.
describe('Exact Multinomial and BellNumber (REVIEW.md B22)', () => {
  it('Multinomial is exact', () => {
    expect(evalN(['Multinomial', 20, 20])).toEqual('137846528820');
    expect(evalN(['Multinomial', 2, 3, 4])).toEqual('1260'); // 9!/(2!3!4!)
  });
  it('BellNumber is exact (was lossy past n≈25)', () => {
    expect(evalN(['BellNumber', 5])).toEqual('52');
    expect(evalN(['BellNumber', 25])).toEqual('4638590332229999353');
  });
});
