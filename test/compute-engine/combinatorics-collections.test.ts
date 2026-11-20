/**
 * Two extensions of the combinatorics heads that other packages reuse
 * (cortex-js/compute-engine#531): `Permutations(n)` is the permutations of
 * `Range(1, n)`, and `IntegerPartitions` finds the position of a partition
 * from its count table.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { toBigint } from '../../src/compute-engine/boxed-expression/numerics';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

const box = (e: unknown) => ce.box(e as any);
const each = (e: Expression): string[] =>
  [...e.evaluate().each()].map((x) => x.toString());
const run = (e: unknown) => box(e).evaluate().toString();
// `Contains` answers a symbol, which prints quoted
// An integer too large to print in full, as a bigint
const big = (e: unknown): bigint => {
  const v = toBigint(box(e).evaluate());
  if (v === null) throw new Error('not an integer');
  return v;
};
const holds = (e: unknown) => box(e).evaluate().json;

function factorial(n: number): bigint {
  let r = 1n;
  for (let i = 2n; i <= BigInt(n); i++) r *= i;
  return r;
}

describe('Permutations(n)', () => {
  test('is the permutations of Range(1, n), in the same order', () => {
    for (let n = 0; n <= 5; n++) {
      const a = each(box(['Permutations', n]));
      const b = each(box(['Permutations', ['Range', 1, n]]));
      if (n === 0) expect(a).toEqual(['[]']);
      else expect(a).toEqual(b);
      expect(a.length).toBe(Number(factorial(n)));
    }
    expect(each(box(['Permutations', 3]))).toEqual([
      '[1,2,3]',
      '[1,3,2]',
      '[2,1,3]',
      '[2,3,1]',
      '[3,1,2]',
      '[3,2,1]',
    ]);
  });

  test('Permutations(n, k) is the k-arrangements', () => {
    expect(each(box(['Permutations', 3, 2]))).toEqual([
      '[1,2]',
      '[1,3]',
      '[2,1]',
      '[2,3]',
      '[3,1]',
      '[3,2]',
    ]);
    expect(each(box(['Permutations', 4, 0]))).toEqual(['[]']);
    expect(run(['Count', ['Permutations', 6, 3]])).toBe('120');
  });

  test('Permutations(0) is [[]]', () => {
    expect(run(['Count', ['Permutations', 0]])).toBe('1');
    expect(run(['At', ['Permutations', 0], 1])).toBe('[]');
    expect(run(['IndexOf', ['Permutations', 0], ['List']])).toBe('1');
  });

  test('count, at, indexOf, contains, countOf round-trip', () => {
    for (let n = 1; n <= 5; n++) {
      const p = box(['Permutations', n]);
      const all = each(p);
      expect(run(['Count', ['Permutations', n]])).toBe(String(factorial(n)));
      all.forEach((s, i) => {
        const el = box(['List', ...JSON.parse(s)]);
        expect(run(['At', ['Permutations', n], i + 1])).toBe(s);
        expect(run(['IndexOf', ['Permutations', n], el])).toBe(String(i + 1));
        expect(holds(['Contains', ['Permutations', n], el])).toBe('True');
      });
      expect(run(['At', ['Permutations', n], -1])).toBe(
        `[${Array.from({ length: n }, (_, i) => n - i).join(',')}]`
      );
    }
    const q = ['Permutations', 3];
    expect(run(['IndexOf', q, ['List', 1, 1, 2]])).toBe('0');
    expect(run(['IndexOf', q, ['List', 1, 2]])).toBe('0');
    expect(holds(['Contains', q, ['List', 3, 2, 1]])).toBe('True');
    expect(holds(['Contains', q, ['List', 3, 2, 4]])).toBe('False');
    expect(run(['Count', q, ['List', 3, 2, 1]])).toBe('1');
    expect(run(['Count', q, ['List', 3, 2, 4]])).toBe('0');
  });

  test('a bigint position in Permutations(25)', () => {
    const f25 = factorial(25);
    expect(big(['Count', ['Permutations', 25]])).toBe(f25);
    const last = run(['At', ['Permutations', 25], { num: String(f25) }]);
    expect(last).toBe(
      `[${Array.from({ length: 25 }, (_, i) => 25 - i).join(',')}]`
    );
    const mid = f25 / 2n + 12345n;
    const el = box([
      'At',
      ['Permutations', 25],
      { num: String(mid) },
    ]).evaluate();
    expect(el.operator).toBe('List');
    expect(big(['IndexOf', ['Permutations', 25], el])).toBe(mid);
    expect(box(['Permutations', 25]).isFiniteCollection).toBe(true);
  });

  test('every route: evaluate and N', () => {
    const e = ce.expr(['Count', ['Permutations', 5]]);
    expect(e.evaluate().toString()).toBe('120');
    expect(e.N().toString()).toBe('120');
    expect(
      ce
        .expr(['IndexOf', ['Permutations', 5], ['List', 2, 1, 3, 4, 5]])
        .evaluate()
        .toString()
    ).toBe('25');
    expect(
      ce
        .expr(['At', ['Permutations', 5], 25])
        .evaluate()
        .toString()
    ).toBe('[2,1,3,4,5]');
  });

  test('a negative or non-integer n is still a type error', () => {
    for (const n of [-1, 2.5, ['Rational', 5, 2]]) {
      const e = box(['Permutations', n]);
      expect(e.isValid).toBe(false);
      expect(e.evaluate().isValid).toBe(false);
    }
  });

  test('an integer symbol reads its value, unevaluated', () => {
    const ce = new ComputeEngine();
    ce.declare('m', 'integer');
    ce.assign('m', 3);
    const p = ce.box(['Permutations', 'm']);
    expect([...p.each()].map((x) => x.toString())).toEqual([
      '[1,2,3]',
      '[1,3,2]',
      '[2,1,3]',
      '[2,3,1]',
      '[3,1,2]',
      '[3,2,1]',
    ]);
    expect(ce.box(['At', p, 2]).evaluate().toString()).toBe('[1,3,2]');
  });

  test('Permutations of a string is still a string', () => {
    expect(each(box(['Permutations', "'abc'"]))).toEqual(
      ['abc', 'acb', 'bac', 'bca', 'cab', 'cba'].map((s) => `"${s}"`)
    );
    expect(each(box(['Permutations', ['List', 7, 8]]))).toEqual([
      '[7,8]',
      '[8,7]',
    ]);
  });
});

describe('IntegerPartitions rank', () => {
  const ip = (...ops: unknown[]) => ['IntegerPartitions', ...ops];
  const list = (xs: number[]) => ['List', ...xs];
  const parse = (s: string): number[] =>
    JSON.parse(s.replace(/^\[/, '[').replace(/\s/g, ''));

  /** Every partition at position i is found at i, and the count agrees. */
  function roundTrip(...ops: unknown[]) {
    const spec = ip(...ops);
    const count = Number(run(['Count', spec]));
    for (let i = 1; i <= count; i++) {
      const at = run(['At', spec, i]);
      const el = parse(at);
      expect(run(['IndexOf', spec, list(el)])).toBe(String(i));
      expect(holds(['Contains', spec, list(el)])).toBe('True');
      expect(run(['Count', spec, list(el)])).toBe('1');
    }
    return count;
  }

  test('unrestricted, small n', () => {
    for (let n = 0; n <= 12; n++) {
      const c = roundTrip(n);
      expect(c).toBe([1, 1, 2, 3, 5, 7, 11, 15, 22, 30, 42, 56, 77][n]);
    }
  });

  test('at most k parts', () => {
    for (let n = 1; n <= 10; n++) for (const k of [1, 2, 3]) roundTrip(n, k);
  });

  test('exactly k parts and a range of numbers of parts', () => {
    for (let n = 1; n <= 10; n++) {
      roundTrip(n, ['List', 3]);
      roundTrip(n, ['List', 2, 4]);
      roundTrip(n, ['List', 1, 6, 2]);
    }
    expect(roundTrip(8, ['List', 3])).toBe(5);
  });

  test('allowed parts', () => {
    for (let n = 1; n <= 12; n++) {
      roundTrip(n, 'All', ['List', 2, 3, 5]);
      roundTrip(n, ['List', 2, 3], ['List', 1, 4]);
    }
    expect(roundTrip(30, 'All', ['List', 1, 5, 10, 25])).toBe(18);
  });

  test('the fourth operand limits the partitions', () => {
    const spec = ip(10, 'All', ['List', 1, 2, 3], 4);
    expect(run(['Count', spec])).toBe('4');
    expect(run(['IndexOf', spec, list([3, 3, 3, 1])])).toBe('1');
    expect(run(['IndexOf', spec, list([3, 3, 2, 2])])).toBe('2');
    // [1 x 10] is a partition of 10 but past the first four
    expect(run(['IndexOf', spec, list(new Array(10).fill(1))])).toBe('0');
    expect(holds(['Contains', spec, list(new Array(10).fill(1))])).toBe(
      'False'
    );
    roundTrip(10, 'All', ['List', 1, 2, 3], 4);
  });

  test('a bigint-sized position, from the table', () => {
    const spec = ip(400);
    const total = big(['Count', spec]);
    expect(total > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    const pos = total / 3n;
    const el = box(['At', spec, { num: String(pos) }]).evaluate();
    expect(el.operator).toBe('List');
    expect(big(['IndexOf', spec, el])).toBe(pos);
  });

  test('not a partition of the collection is not contained', () => {
    const spec = ip(8, ['List', 3]);
    for (const bad of [
      [5, 3], // two parts
      [3, 3, 1, 1], // four parts
      [2, 3, 3], // not non-increasing
      [4, 4, 0], // zero part
      [6, 1, 2], // not non-increasing
      [3, 3, 3], // wrong sum
      [4, 3, 1, 0],
    ]) {
      expect(run(['IndexOf', spec, list(bad)])).toBe('0');
      expect(holds(['Contains', spec, list(bad)])).toBe('False');
      expect(run(['Count', spec, list(bad)])).toBe('0');
    }
    expect(run(['IndexOf', ip(8, 'All', ['List', 3, 5]), list([4, 4])])).toBe(
      '0'
    );
    expect(run(['IndexOf', ip(5), box(['Set', 5])])).toBe('0');
    expect(run(['IndexOf', ip(5), 5])).toBe('0');
    expect(run(['IndexOf', ip(-3), list([])])).toBe('0');
    expect(run(['IndexOf', ip(0), list([])])).toBe('1');
    expect(run(['IndexOf', ip(0, ['List', 2]), list([])])).toBe('0');
  });

  test('a float or non-integer part is not contained', () => {
    expect(run(['IndexOf', ip(4), list([2.5, 1.5])])).toBe('0');
    expect(run(['IndexOf', ip(4), ['List', 4.5]])).toBe('0');
    expect(holds(['Contains', ip(4), ['List', 4.5]])).toBe('False');
    expect(
      run(['IndexOf', ip(4), ['List', ['Rational', 7, 2], ['Rational', 1, 2]]])
    ).toBe('0');
    expect(run(['IndexOf', ip(4), ['List', 'x']])).toBe('0');
  });

  test('every route agrees', () => {
    const spec = ip(7, 3);
    const el = list([4, 2, 1]);
    const i = run(['IndexOf', spec, el]);
    expect(box(['IndexOf', spec, el]).N().toString()).toBe(i);
    expect(run(['At', spec, Number(i)])).toBe('[4,2,1]');
  });
});
