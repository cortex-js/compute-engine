/**
 * `IntegerPartitions` follows Mathematica's: the partitions of `n` into
 * positive parts, each part list in non-increasing order, the lot in reverse
 * lexicographic order. It is a lazy indexed collection (like `Combinations`),
 * so its count, and an element at a position, are read with no walk.
 *
 * Not supported (the collection is then of unknown count, and an operand that
 * is not an integer list is an invalid argument): allowed parts that are not
 * positive integers, and the `{m}` and `{m1, m2}` forms of the fourth operand.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

const ce = new ComputeEngine();

const L = (...xs: any[]) => ['List', ...xs];
const parts = (e: unknown): string[] =>
  [
    ...ce
      .box(e as any)
      .evaluate()
      .each(),
  ].map((x) => x.toString());
const evaluate = (e: unknown) =>
  ce
    .box(e as any)
    .evaluate()
    .toString();

/** Independent oracle: partitions of `n` by recursion, largest part first. */
function oracle(
  n: number,
  kmin = 0,
  kmax = Infinity,
  step = 1,
  sizes?: number[]
): number[][] {
  const allowed = sizes ? [...new Set(sizes)].sort((a, b) => b - a) : null;
  const out: number[][] = [];
  const go = (r: number, max: number, acc: number[]) => {
    if (r === 0) {
      const k = acc.length;
      if (k >= kmin && k <= kmax && (k - kmin) % step === 0) out.push([...acc]);
      return;
    }
    for (let v = Math.min(r, max); v >= 1; v--) {
      if (allowed && !allowed.includes(v)) continue;
      acc.push(v);
      go(r - v, v, acc);
      acc.pop();
    }
  };
  if (n >= 0) go(n, n, []);
  return out;
}
const text = (ps: number[][]) => ps.map((p) => `[${p.join(',')}]`);

describe('IntegerPartitions: the forms', () => {
  test('n: every partition, in reverse lexicographic order', () => {
    expect(evaluate(['IntegerPartitions', 4])).toBe(
      '[[4],[3,1],[2,2],[2,1,1],[1,1,1,1]]'
    );
    expect(parts(['IntegerPartitions', 5])).toEqual(text(oracle(5)));
  });

  test('n, k: at most k parts', () => {
    expect(evaluate(['IntegerPartitions', 8, 3])).toBe(
      '[[8],[7,1],[6,2],[6,1,1],[5,3],[5,2,1],[4,4],[4,3,1],[4,2,2],[3,3,2]]'
    );
  });

  test('n, {k}: exactly k parts', () => {
    expect(evaluate(['IntegerPartitions', 8, L(3)])).toBe(
      '[[6,1,1],[5,2,1],[4,3,1],[4,2,2],[3,3,2]]'
    );
  });

  test('n, {kmin, kmax}, {kmin, Infinity}, {kmin, kmax, step}, All', () => {
    expect(parts(['IntegerPartitions', 7, L(2, 3)])).toEqual(
      text(oracle(7, 2, 3))
    );
    expect(parts(['IntegerPartitions', 6, L(5, 'Infinity')])).toEqual(
      text(oracle(6, 5))
    );
    expect(evaluate(['IntegerPartitions', 6, L(2, 'Infinity', 2)])).toBe(
      '[[5,1],[4,2],[3,3],[3,1,1,1],[2,2,1,1],[1,1,1,1,1,1]]'
    );
    expect(parts(['IntegerPartitions', 6, 'All'])).toEqual(
      parts(['IntegerPartitions', 6])
    );
  });

  test('n, kspec, {s1, s2, ...}: parts drawn from the list', () => {
    expect(evaluate(['IntegerPartitions', 8, 'All', L(1, 2, 5)])).toBe(
      '[[5,2,1],[5,1,1,1],[2,2,2,2],[2,2,2,1,1],[2,2,1,1,1,1],[2,1,1,1,1,1,1],[1,1,1,1,1,1,1,1]]'
    );
    expect(evaluate(['IntegerPartitions', 156, 10, L(1, 5, 10, 25)])).toBe(
      '[[25,25,25,25,25,25,5,1],[25,25,25,25,25,10,10,10,1],[25,25,25,25,25,10,10,5,5,1]]'
    );
    // The list is read as a set, in any order.
    expect(parts(['IntegerPartitions', 9, 'All', L(2, 5, 2, 1)])).toEqual(
      text(oracle(9, 0, Infinity, 1, [1, 2, 5]))
    );
  });

  test('the fourth operand keeps the first m', () => {
    expect(evaluate(['IntegerPartitions', 8, 'All', L(1, 2, 5), 2])).toBe(
      '[[5,2,1],[5,1,1,1]]'
    );
    const p = ce.box(['IntegerPartitions', 12, 3, L(1, 2, 3, 4, 5, 6), 4]);
    expect(p.count).toBe(4);
    expect(parts(p.json)).toHaveLength(4);
    expect(ce.box(['IntegerPartitions', 5, 'All', L(1), 0]).count).toBe(0);
    expect(ce.box(['IntegerPartitions', 50, 'All', L(1), 7]).count).toBe(1);
  });

  test('n < 0 is empty, n = 0 is the empty partition', () => {
    expect(evaluate(['IntegerPartitions', -3])).toBe('[]');
    expect(evaluate(['IntegerPartitions', 0])).toBe('[[]]');
    expect(evaluate(['IntegerPartitions', 0, 3])).toBe('[[]]');
    expect(evaluate(['IntegerPartitions', 0, L(2)])).toBe('[]');
    expect(evaluate(['IntegerPartitions', 3, 0])).toBe('[]');
  });

  test('Wolfram examples that hold', () => {
    expect(evaluate(['Count', ['IntegerPartitions', 6]])).toBe('11');
    expect(evaluate(['At', ['IntegerPartitions', 6], 1])).toBe('[6]');
    expect(evaluate(['Count', ['IntegerPartitions', 10]])).toBe('42');
    expect(
      evaluate([
        'Count',
        ['IntegerPartitions', 100, 'All', L(1, 5, 10, 25, 50)],
      ])
    ).toBe('292');
    // Euler: partitions into odd parts are as many as into distinct parts.
    expect(
      evaluate(['Count', ['IntegerPartitions', 10, 'All', L(1, 3, 5, 7, 9)]])
    ).toBe('10');
  });
});

describe('IntegerPartitions: count, lazily', () => {
  test('Count agrees with NPartition, with no walk', () => {
    for (const n of [0, 1, 2, 7, 30, 100, 200]) {
      const p = ce.box(['IntegerPartitions', n]);
      expect(BigInt(p.count as any)).toBe(
        BigInt(ce.box(['NPartition', n]).evaluate().re)
      );
    }
    const start = Date.now();
    expect(evaluate(['Count', ['IntegerPartitions', 200]])).toBe(
      '3972999029388'
    );
    expect(Date.now() - start).toBeLessThan(1000);
  });

  test('evaluate() stays lazy and reports its count', () => {
    const p = ce.box(['IntegerPartitions', 200]).evaluate();
    expect(p.operator).toBe('IntegerPartitions');
    expect(p.isCollection).toBe(true);
    expect(p.isFiniteCollection).toBe(true);
    expect(p.count).toBe(3972999029388);
    // Not a safe integer: a bigint
    expect(typeof ce.box(['IntegerPartitions', 600]).count).toBe('bigint');
  });

  test('the count of every form agrees with the walk', () => {
    const specs: [number, number?, number?, number?, number[]?][] = [];
    for (const n of [0, 1, 2, 3, 6, 9, 12, 15])
      for (const [kmin, kmax, step] of [
        [0, Infinity, 1],
        [0, 3, 1],
        [3, 3, 1],
        [2, 4, 1],
        [2, Infinity, 1],
        [2, Infinity, 2],
        [1, 9, 3],
        [0, 0, 1],
      ])
        for (const sizes of [undefined, [1, 2, 5], [3], [2, 3, 7], []])
          specs.push([n, kmin, kmax, step, sizes]);
    for (const [n, kmin, kmax, step, sizes] of specs) {
      const k =
        kmin === 0 && step === 1
          ? kmax === Infinity
            ? 'All'
            : kmax
          : L(kmin, kmax === Infinity ? 'Infinity' : kmax, step);
      const e = ['IntegerPartitions', n, k, ...(sizes ? [L(...sizes)] : [])];
      const expected = text(oracle(n, kmin, kmax, step, sizes));
      const label = JSON.stringify(e);
      const p = ce.box(e as any);
      expect([label, p.count]).toEqual([label, expected.length]);
      expect([label, parts(e)]).toEqual([label, expected]);
    }
  });

  test('At and Last read from the position, and agree with the walk', () => {
    const cases: any[][] = [
      ['IntegerPartitions', 12],
      ['IntegerPartitions', 12, 4],
      ['IntegerPartitions', 12, L(3)],
      ['IntegerPartitions', 14, L(2, 5, 2)],
      ['IntegerPartitions', 20, 'All', L(2, 3, 7)],
      ['IntegerPartitions', 18, 6, L(1, 2, 3, 5)],
      ['IntegerPartitions', 12, 'All', L(1, 2, 3), 5],
    ];
    for (const e of cases) {
      const p = ce.box(e as any).evaluate();
      const all = [...p.each()].map((x) => x.toString());
      expect(all.length).toBe(p.count);
      all.forEach((s, i) => {
        expect(p.at(i + 1)?.toString()).toBe(s);
        expect(p.at(i - all.length)?.toString()).toBe(s);
      });
      expect(p.at(all.length + 1)).toBeUndefined();
      expect(p.at(0)).toBeUndefined();
    }
  });

  test('At on a partition number far past what a walk visits', () => {
    // p(200) is about 4·10¹²: only a read from the position is feasible.
    const p = ce.box(['IntegerPartitions', 200]).evaluate();
    const [first, ms] = (() => {
      const t = Date.now();
      return [p.at(1)?.toString(), Date.now() - t];
    })();
    expect(first).toBe(`[200]`);
    expect(ms).toBeLessThan(2000);
    expect(p.at(-1)?.json).toEqual(L(...Array(200).fill(1)));
    // A middle partition sums to 200 and is in non-increasing order.
    const mid = p.at(1_000_000_000_000)!;
    const ops = (mid.json as any[]).slice(1) as number[];
    expect(ops.reduce((a, b) => a + b, 0)).toBe(200);
    expect(ops.every((v, i) => i === 0 || ops[i - 1] >= v)).toBe(true);
  });

  test('First of a huge n is a walk of one step', () => {
    const p = ce.box(['IntegerPartitions', 1_000_000]);
    expect(p.at(1)?.toString()).toBe('[1000000]');
  });
});

describe('IntegerPartitions: declines', () => {
  test('a count too large to compute is unknown, not wrong', () => {
    const big = ce.box(['IntegerPartitions', 1_000_000]);
    expect(big.count).toBeUndefined();
    expect(big.isFiniteCollection).toBe(true);
    expect(evaluate(['Count', ['IntegerPartitions', 1_000_000]])).toBe(
      'Count(IntegerPartitions(1000000))'
    );
    expect(
      ce.box(['IntegerPartitions', 1_000_000_000, L(3)]).count
    ).toBeUndefined();
    expect(
      ce.box([
        'IntegerPartitions',
        20000,
        L(7, 9),
        L(...Array.from({ length: 60 }, (_, i) => i + 1)),
      ]).count
    ).toBeUndefined();
  });

  test('operands that are not supported leave the count unknown', () => {
    const symbolic = ce.box(['IntegerPartitions', 'n']);
    expect(symbolic.count).toBeUndefined();
    expect(ce.box(['IntegerPartitions', 5, -1]).count).toBeUndefined();
    expect(
      ce.box(['IntegerPartitions', 5, L(1, 2, 3, 4)]).count
    ).toBeUndefined();
    expect(
      ce.box(['IntegerPartitions', 5, 'All', L(1, 0)]).count
    ).toBeUndefined();
    // A part that is not an integer is not supported.
    expect(
      ce.box(['IntegerPartitions', 3, 10, L(1, ['Rational', 1, 3])]).count
    ).toBeUndefined();
  });

  test('a stuck walk is bounded by the deadline, not the count', () => {
    // Parts that cannot make the sum: no partition, and the walk ends.
    expect(evaluate(['IntegerPartitions', 1001, 'All', L(2, 4)])).toBe('[]');
  });
});

describe('IntegerPartitions: the routes agree', () => {
  const e = ['IntegerPartitions', 9, L(2, 4), L(1, 2, 3, 4)];
  test('evaluate(), the lazy collection and the materialized list', () => {
    const lazy = ce.box(e as any);
    const evaluated = lazy.evaluate();
    const expected = text(oracle(9, 2, 4, 1, [1, 2, 3, 4]));
    expect([...lazy.each()].map(String)).toEqual(expected);
    expect([...evaluated.each()].map(String)).toEqual(expected);
    expect(lazy.count).toBe(expected.length);
    expect(evaluated.count).toBe(expected.length);
    const materialized: Expression = lazy.evaluate({ materialization: true });
    expect(materialized.toString()).toBe(`[${expected.join(',')}]`);
    expect(
      ce
        .box(['Length', e] as any)
        .evaluate()
        .toString()
    ).toBe(String(expected.length));
  });
});
