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

describe('Permutations / Combinations are lazy collections', () => {
  const list = (n: number) =>
    ce.box(['List', ...Array.from({ length: n }, (_, i) => i + 1)]);

  test('Permutations: evaluate stays lazy, count is the closed form', () => {
    // 12! = 479001600 — materializing would be catastrophic; count must be O(k).
    const p = ce.box(['Permutations', list(12)]).evaluate();
    expect(p.operator).toBe('Permutations');
    expect(p.isCollection).toBe(true);
    expect(p.count).toBe(479001600);
    // First element is the identity ordering; indexing walks only that far.
    expect(p.at(1)?.toString()).toBe('[1,2,3,4,5,6,7,8,9,10,11,12]');
  });

  test('Permutations: full enumeration (small) and length-k form', () => {
    const p3 = ce.box(['Permutations', list(3)]).evaluate();
    expect([...p3.each()].map((x) => x.toString())).toEqual([
      '[1,2,3]',
      '[1,3,2]',
      '[2,1,3]',
      '[2,3,1]',
      '[3,1,2]',
      '[3,2,1]',
    ]);
    // P(3, 2) = 6
    const p32 = ce.box(['Permutations', list(3), 2]).evaluate();
    expect(p32.count).toBe(6);
    expect([...p32.each()].map((x) => x.toString())).toEqual([
      '[1,2]',
      '[1,3]',
      '[2,1]',
      '[2,3]',
      '[3,1]',
      '[3,2]',
    ]);
  });

  test('Combinations: count is C(n,k) without enumerating', () => {
    // C(30, 15) = 155117520 — far too many to materialize.
    const c = ce.box(['Combinations', list(30), 15]).evaluate();
    expect(c.operator).toBe('Combinations');
    expect(c.count).toBe(155117520);
    const c42 = ce.box(['Combinations', list(4), 2]).evaluate();
    expect([...c42.each()].map((x) => x.toString())).toEqual([
      '[1,2]',
      '[1,3]',
      '[1,4]',
      '[2,3]',
      '[2,4]',
      '[3,4]',
    ]);
  });

  test('k = 0 is the single empty arrangement (count 1, one empty list)', () => {
    for (const head of ['Permutations', 'Combinations']) {
      const e = ce.box([head, list(3), 0]).evaluate();
      expect(e.count).toBe(1); // P(n,0) = C(n,0) = 1
      expect([...e.each()].map((x) => x.toString())).toEqual(['[]']);
    }
  });

  test('infinite base: count/iterator/isFinite stay consistent', () => {
    const inf = ce.box(['Range', 1, 'Infinity']);
    // k validated BEFORE the infinite short-circuit.
    expect(ce.box(['Permutations', inf, -5]).count).toBeUndefined();
    expect(ce.box(['Combinations', inf, -1]).count).toBeUndefined();
    expect(ce.box(['Combinations', list(3), 5]).count).toBeUndefined(); // k > n
    // A valid k > 0 over an infinite base can't be enumerated: `count` and
    // `isFinite` are both undefined (not Infinity / false) so the collection
    // doesn't advertise elements the iterator can't produce.
    const p2 = ce.box(['Permutations', inf, 2]).evaluate();
    expect(p2.count).toBeUndefined();
    expect(p2.isFiniteCollection).toBeUndefined();
    expect([...p2.each()]).toEqual([]);
    // k = 0 over an infinite source is still the single empty arrangement.
    const p0 = ce.box(['Permutations', inf, 0]).evaluate();
    expect(p0.count).toBe(1);
    expect(p0.isFiniteCollection).toBe(true);
    expect([...p0.each()].map((x) => x.toString())).toEqual(['[]']);
  });

  test('a huge-but-finite permutation collection stays finite even when count overflows', () => {
    // 171! rounds to Infinity as a JS number, but the collection is finite — so
    // `isFiniteCollection` must come from the base collection, not the count.
    const p = ce.box(['Permutations', list(171)]).evaluate();
    expect(p.isFiniteCollection).toBe(true);
    // Small combination counts remain exact.
    expect(ce.box(['Combinations', list(50), 25]).count).toBe(126410606437752);
  });

  test('count on an astronomically large domain returns Infinity without hanging', () => {
    // Early-exit once the running product exceeds MAX_VALUE — must not grind
    // through ~1e9 bigint multiplications.
    const big = ce.box(['Range', 1, 1000000000]);
    expect(ce.box(['Permutations', big]).count).toBe(Infinity);
    expect(ce.box(['Combinations', big, 500000000]).count).toBe(Infinity);
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
