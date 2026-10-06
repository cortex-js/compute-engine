import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { isFunction } from '../../src/compute-engine/boxed-expression/type-guards';
import { zip } from '../../src/compute-engine/collection-utils';

/** The rows of `zip()`, as an iterable. */
function zipIterable(items: ReadonlyArray<Expression>): Iterable<Expression[]> {
  return { [Symbol.iterator]: () => zip(items) };
}

/**
 * A collection count is a `number` or a `bigint` (GitHub issue #416).
 *
 * The rule: a `bigint` is used only for a finite count that is not a safe
 * integer (larger than `Number.MAX_SAFE_INTEGER`). A count that is a safe
 * integer is always a `number`, and an infinite count is `Infinity`.
 *
 * Before this change a count that was not a safe integer could not be
 * reported, so `Count(QuotientRing(Integers, 2^61 - 1))` stayed unevaluated.
 * The readers that use a count in arithmetic, as an index or as a loop bound
 * read it through `smallCount()`, which reads a `bigint` as an unknown count:
 * for them a very large collection behaves as it did before, and no reader
 * mixes a `bigint` with a `number` (which throws a `TypeError`).
 *
 * The file is also checked by `npm run typecheck` (`scripts/typecheck.sh`):
 * the type-level pins below are real assertions there, because ts-jest does
 * not type-check.
 */

const ce = new ComputeEngine();

/** 2^61 - 1, a Mersenne prime above `Number.MAX_SAFE_INTEGER` (2^53 - 1). */
const BIG = '2305843009213693951';
const big = { num: BIG };
const bigRing = ['QuotientRing', 'Integers', big] as const;

function evaluate(json: unknown): Expression {
  return ce.box(json as any).evaluate();
}

describe('THE COUNT GETTER', () => {
  test('is a bigint for a finite count above 2^53', () => {
    const count = ce.box(bigRing as any).count;
    expect(typeof count).toBe('bigint');
    expect(count).toBe(2305843009213693951n);
  });

  test('is a number for a count that is a safe integer', () => {
    expect(ce.box(['QuotientRing', 'Integers', 7]).count).toBe(7);
    // 2^53 - 1 is the largest safe integer: still a number.
    const maxSafe = ce.box([
      'QuotientRing',
      'Integers',
      { num: String(Number.MAX_SAFE_INTEGER) },
    ]).count;
    expect(maxSafe).toBe(Number.MAX_SAFE_INTEGER);
    // 2^53 is not a safe integer: a bigint.
    const twoTo53 = ce.box([
      'QuotientRing',
      'Integers',
      { num: '9007199254740992' },
    ]).count;
    expect(twoTo53).toBe(9007199254740992n);
  });

  test('an infinite count stays Infinity', () => {
    expect(ce.box('Integers').count).toBe(Infinity);
    expect(ce.box(['Range', 1, 'PositiveInfinity']).count).toBe(Infinity);
  });

  test('an inexact modulus is accepted only as a safe integer', () => {
    expect(ce.box(['QuotientRing', 'Integers', 5.0]).count).toBe(5);
  });
});

describe('VALUES THAT REPORT A CARDINALITY', () => {
  test('Count of the big ring is the exact integer', () => {
    const result = evaluate(['Count', bigRing]);
    expect(result.json).toEqual({ num: BIG });
    expect(result.toString()).toBe(BIG);
  });

  test('Count of the big ring written as 2^61 - 1', () => {
    expect(
      evaluate([
        'Count',
        ['QuotientRing', 'Integers', ['Subtract', ['Power', 2, 61], 1]],
      ]).json
    ).toEqual({ num: BIG });
    expect(
      ce
        .parse('\\operatorname{Count}(\\mathbb{Z}/(2^{61}-1)\\mathbb{Z})')
        .evaluate().json
    ).toEqual({ num: BIG });
  });

  test('Length of the big ring', () => {
    expect(evaluate(['Length', bigRing]).json).toEqual({ num: BIG });
  });

  test('Abs (cardinality) of the big ring', () => {
    expect(evaluate(['Abs', bigRing]).json).toEqual({ num: BIG });
    expect(ce.parse('|\\mathbb{Z}_{2^{61}-1}|').evaluate().json).toEqual({
      num: BIG,
    });
  });

  test('a small ring keeps a number count', () => {
    const result = evaluate(['Count', ['QuotientRing', 'Integers', 7]]);
    expect(result.json).toBe(7);
    expect(result.re).toBe(7);
  });
});

describe('FACETS THAT DO NOT WALK THE BIG RING', () => {
  const R = ce.box(bigRing as any);

  test('it is a non-empty finite collection', () => {
    expect(R.isCollection).toBe(true);
    expect(R.isEmptyCollection).toBe(false);
    expect(R.isFiniteCollection).toBe(true);
    expect(evaluate(['IsEmpty', bigRing]).json).toBe('False');
  });

  test('membership is decided', () => {
    expect(evaluate(['Element', ['ResidueClass', 3, big], bigRing]).json).toBe(
      'True'
    );
    expect(evaluate(['Element', ['ResidueClass', 3, 7], bigRing]).json).toBe(
      'False'
    );
  });

  test('it is not enumerable, and its walk yields nothing', () => {
    // A walk of 2^61 elements cannot end, so the ring reports itself as not
    // enumerable, as `Linspace(a, 1, 3)` does with a symbolic `a`.
    expect(R.isEnumerableCollection).toBe(false);
    expect([...R.each()]).toEqual([]);
  });
});

describe('CONSUMERS THAT WALK OR INDEX BEHAVE AS BEFORE', () => {
  // Before the change the big ring was not a collection, and each of these
  // stayed unevaluated (or was the same type error as for a small ring).
  // The point of these tests is that none of them throws a `TypeError` (mixed
  // `bigint` and `number` arithmetic) and none of them starts a walk that does
  // not end.
  const unevaluated = (json: unknown) => {
    const input = ce.box(json as any);
    const result = input.evaluate();
    expect(result.operator).toBe(input.operator);
    return result;
  };

  test.each([
    ['Sum', ['Sum', bigRing]],
    ['Max', ['Max', bigRing]],
    ['Min', ['Min', bigRing]],
    ['Mean', ['Mean', bigRing]],
    ['Median', ['Median', bigRing]],
    ['Total', ['Total', bigRing]],
    ['Unique', ['Unique', bigRing]],
    ['Tally', ['Tally', bigRing]],
    ['Union', ['Union', bigRing, bigRing]],
    ['SetMinus', ['SetMinus', bigRing, ['Set', ['ResidueClass', 1, big]]]],
    ['Random', ['Random', bigRing]],
  ])('%s stays unevaluated', (_name, json) => {
    unevaluated(json);
  });

  test('Product stays unevaluated (as for a non-enumerable Linspace)', () => {
    // `Product` writes a collection it cannot walk as a `Reduce`, which is
    // what it does for `Linspace(a, 1, 3)` with a symbolic `a`.
    expect(evaluate(['Product', bigRing]).operator).toBe('Reduce');
    expect(evaluate(['Product', ['Linspace', 'a', 1, 3]]).operator).toBe(
      'Reduce'
    );
  });

  test('indexing and slicing give the same error as for a small ring', () => {
    // A ring is a set, not an indexed collection.
    for (const head of ['At', 'Take', 'Drop']) {
      for (const n of [3, -2]) {
        const small = evaluate([head, ['QuotientRing', 'Integers', 7], n]);
        const large = evaluate([head, bigRing, n]);
        expect(large.toString()).toBe(
          small.toString().replace(/"Integers", 7/g, `"Integers", ${BIG}`)
        );
      }
    }
  });

  test('Map over the big ring is not evaluated eagerly', () => {
    const small = evaluate([
      'Map',
      ['QuotientRing', 'Integers', 7],
      ['Function', 'x', 'x'],
    ]);
    const large = evaluate(['Map', bigRing, ['Function', 'x', 'x']]);
    expect(large.toString()).toBe(
      small.toString().replace(/"Integers", 7/g, `"Integers", ${BIG}`)
    );
  });

  test('a lazy Map of the big ring does not throw when its count is read', () => {
    const m = ce.function('Map', [
      ce.box(bigRing as any),
      ce.box(['Function', 'x', 'x']),
    ]);
    // A `Map` over a SET counts distinct results, which is not known.
    expect(() => m.count).not.toThrow();
    expect(m.count).toBeUndefined();
  });
});

describe('CONVERTED COUNT HANDLERS', () => {
  const set = (n: number): ['Set', ...number[]] => [
    'Set',
    ...Array.from({ length: n }, (_, i) => i + 1),
  ];

  test('CartesianProduct: exact product', () => {
    expect(ce.box(['CartesianProduct', bigRing, ['Set', 1, 2]]).count).toBe(
      4611686018427387902n
    );
    expect(
      evaluate(['Count', ['CartesianProduct', bigRing, ['Set', 1, 2]]]).json
    ).toEqual({ num: '4611686018427387902' });
    // A product that is a safe integer is a number.
    expect(
      ce.box(['CartesianProduct', ['Set', 1, 2], ['Set', 3, 4, 5]]).count
    ).toBe(6);
  });

  test('CartesianProduct: a factor with an unknown count gives an unknown count, not NaN', () => {
    expect(
      ce.box(['CartesianProduct', ['Set', 1, 2], 'UnknownSet']).count
    ).toBeUndefined();
    // `Range(1, NaN)` has a `NaN` count: the product is not known, and no
    // `RangeError` is thrown by the `bigint` product.
    expect(
      () =>
        ce.box(['CartesianProduct', ['Set', 1, 2], ['Range', 1, 'NaN']]).count
    ).not.toThrow();
  });

  test('PowerSet: 2^n is exact for 53 <= n <= 1023', () => {
    expect(ce.box(['PowerSet', set(52)]).count).toBe(2 ** 52);
    expect(ce.box(['PowerSet', set(53)]).count).toBe(2n ** 53n);
    expect(ce.box(['PowerSet', set(60)]).count).toBe(2n ** 60n);
  });

  test('Permutations: a count above 2^53 is exact', () => {
    // 20! = 2432902008176640000, above 2^53.
    expect(ce.box(['Permutations', ['Range', 1, 20]]).count).toBe(
      2432902008176640000n
    );
    expect(
      evaluate(['Count', ['Permutations', ['Range', 1, 20]]]).json
    ).toEqual({ num: '2432902008176640000' });
    // 18! = 6402373705728000, below 2^53: a number.
    expect(ce.box(['Permutations', ['Range', 1, 18]]).count).toBe(
      6402373705728000
    );
    // P(2^61 - 1, 2) over the big ring.
    expect(ce.box(['Permutations', bigRing, 2]).count).toBe(
      2305843009213693951n * 2305843009213693950n
    );
  });

  test('Combinations: a count above 2^53 is exact', () => {
    // C(70, 35) = 112186277816662845432.
    expect(ce.box(['Combinations', ['Range', 1, 70], 35]).count).toBe(
      112186277816662845432n
    );
    expect(ce.box(['Combinations', bigRing, 2]).count).toBe(
      (2305843009213693951n * 2305843009213693950n) / 2n
    );
  });

  test('Repeat: a repeat count that is not a safe integer', () => {
    const r = ['Repeat', 'x', { num: '100000000000000000001' }];
    expect(ce.box(r as any).count).toBe(100000000000000000001n);
    expect(evaluate(['Count', r]).json).toEqual({
      num: '100000000000000000001',
    });
    // The elements are not walked: the expression stays lazy, and so do
    // `Sum` and `Last` over it.
    expect(evaluate(r).operator).toBe('Repeat');
    expect(evaluate(['Sum', ['Repeat', 1, r[2]]]).operator).toBe('Sum');
    expect(evaluate(['Last', r]).operator).toBe('Last');
    // A negative repeat count is an empty list.
    expect(
      ce.box(['Repeat', 'x', { num: '-100000000000000000001' }]).count
    ).toBe(0);
  });
});

describe('VIEWS OVER A SOURCE WITH A BIGINT COUNT', () => {
  // 20! = 2432902008176640000 is above 2^53: the count is a `bigint`.
  const P = ['Permutations', ['Range', 1, 20]] as any;
  const P20 = 2432902008176640000n;
  const yes = ['Function', 'True', 'p'];
  const no = ['Function', 'False', 'p'];
  const op = (json: unknown) => evaluate(json).operator;
  const str = (json: unknown) => evaluate(json).toString();

  test('a broadcast length check compares a bigint count', () => {
    expect(str(['Add', ['List', 1, 2, 3], P])).toMatch(
      /incompatible-dimensions.*3 vs 2432902008176640000/
    );
    expect(
      str(['Less', ['Map', ['Function', 1, 'p'], P], ['List', 0, 0]])
    ).toMatch(/incompatible-dimensions/);
  });

  test('Most and Cycle walk the source', () => {
    for (const view of [
      ['Most', P],
      ['Cycle', P],
    ]) {
      expect(str(['Any', view, yes])).toBe('"True"');
      expect(str(['All', view, no])).toBe('"False"');
      const e = ce.box(view as any);
      expect(e.isEnumerableCollection).toBe(true);
      expect(e.at(1)?.toString()).toBe(
        ce
          .box(P as any)
          .at(1)
          ?.toString()
      );
      expect(e.each().next().done).toBe(false);
    }
    expect(ce.box(['Most', P]).count).toBe(P20 - 1n);
  });

  test('a view that cannot walk is not enumerable', () => {
    // These views read the source from the end or at a position computed
    // from the count: with a bigint count their walk yields nothing.
    for (const view of [
      ['RotateLeft', P],
      ['RotateRight', P],
      ['Reverse', P],
      ['DeleteAt', P, -1],
      ['ReplaceAt', P, -1, 0],
      ['Insert', P, -1, 0],
      ['Slice', P, -3, -1],
    ]) {
      const e = ce.box(view as any);
      expect(e.isEnumerableCollection).toBe(false);
      expect(op(['Any', view, yes])).toBe('Any');
      expect(op(['All', view, no])).toBe('All');
    }
  });

  test('a view with a position that is a safe integer walks', () => {
    const first = ce
      .box(P as any)
      .at(1)!
      .toString();
    const second = ce
      .box(P as any)
      .at(2)!
      .toString();
    const cases: [unknown, bigint | number, string][] = [
      [['DeleteAt', P, 1], P20 - 1n, second],
      [['ReplaceAt', P, 1, 0], P20, '0'],
      [['Insert', P, 1, 0], P20 + 1n, '0'],
      [['Slice', P, 1, 3], 3, first],
    ];
    for (const [view, count, at1] of cases) {
      const e = ce.box(view as any);
      expect(e.count).toBe(count);
      expect(e.isEnumerableCollection).toBe(true);
      expect(e.isFiniteCollection).toBe(true);
      expect(e.isEmptyCollection).toBe(false);
      expect(e.at(1)?.toString()).toBe(at1);
      expect(e.each().next().value?.toString()).toBe(at1);
      expect(str(['Any', view, yes])).toBe('"True"');
    }
  });

  test('zip() reads a bigint count as a long length', () => {
    const rows = [...zipIterable([ce.box(P as any), ce.box(['List', 10, 20])])];
    expect(rows.length).toBe(2);
    expect(rows[1][1].toString()).toBe('20');
  });

  test('the counts of Take, Drop, Rest, Most, Zip, Map and When', () => {
    expect(ce.box(['Take', P, 2]).count).toBe(2);
    expect(ce.box(['Take', P, 0]).isEmptyCollection).toBe(true);
    expect(ce.box(['Drop', P, 3]).count).toBe(P20 - 3n);
    expect(ce.box(['Rest', P]).count).toBe(P20 - 1n);
    expect(ce.box(['Zip', ['List', 1, 2], P]).count).toBe(2);
    expect(ce.box(['Zip', P, P]).count).toBe(P20);
    expect(
      ce.box(['Map', ['Function', 1, 'p', 'q'], P, ['List', 1, 2, 3]]).count
    ).toBe(3);
    expect(ce.box(['When', P, 'True']).count).toBe(P20);
    expect(evaluate(['Length', ['Rest', P]]).json).toEqual({
      num: '2432902008176639999',
    });
    expect(evaluate(['Length', ['Drop', P, 3]]).json).toEqual({
      num: '2432902008176639997',
    });
  });
});

describe('AN INDEX THAT IS NOT A SAFE INTEGER OVER A BIGINT SOURCE', () => {
  const rep = ['Repeat', 7, { num: '100000000000000000000' }];

  test('Cycle does not answer for an index that it cannot wrap exactly', () => {
    const e = ce.box(['Cycle', rep] as any);
    expect(e.at(5)?.toString()).toBe('7');
    // An index that is not a safe integer is not wrapped: a `number`
    // cannot hold every position of the source exactly. Before, 2e20 was
    // not wrapped and read past the end of the source, and 5e19 was read
    // from the source without a check.
    expect(e.at(2e20)).toBeUndefined();
    expect(e.at(5e19)).toBeUndefined();
  });

  test('Most does not answer for an index that can be the omitted element', () => {
    const e = ce.box(['Most', rep] as any);
    expect(e.at(5)?.toString()).toBe('7');
    // 1e20 is the omitted last element of the source.
    expect(e.at(1e20)).toBeUndefined();
  });
});

describe('REPEAT WITH A COUNT THAT IS NOT A SAFE INTEGER', () => {
  const neg = ['Repeat', 7, { num: '-100000000000000000001' }];
  const pos = ['Repeat', 7, { num: '100000000000000000001' }];

  test('a negative count is the empty list in every facet', () => {
    const e = ce.box(neg as any);
    expect(e.count).toBe(0);
    expect(e.isEmptyCollection).toBe(true);
    expect(e.isEnumerableCollection).toBe(true);
    expect(e.at(1)).toBeUndefined();
    expect(evaluate(['Element', 7, neg]).json).toBe('False');
    expect(evaluate(neg).toString()).toBe('[]');
  });

  test('a positive count gives its elements by index but is not walked', () => {
    const e = ce.box(pos as any);
    expect(e.count).toBe(100000000000000000001n);
    expect(e.isEmptyCollection).toBe(false);
    expect(e.isEnumerableCollection).toBe(false);
    expect(e.at(1)?.toString()).toBe('7');
    expect(e.at(1000)?.toString()).toBe('7');
    expect(evaluate(['Element', 7, pos]).json).toBe('True');
    expect(evaluate(['Element', 8, pos]).json).toBe('False');
    expect(evaluate(pos).operator).toBe('Repeat');
  });
});

describe('POWERSET, PERMUTATIONS AND COMBINATIONS: EXACT, NEVER INFINITY', () => {
  const set = (n: number): ['Set', ...number[]] => [
    'Set',
    ...Array.from({ length: n }, (_, i) => i + 1),
  ];
  const factorial = (n: number): bigint => {
    let r = 1n;
    for (let i = 2n; i <= BigInt(n); i++) r *= i;
    return r;
  };

  test('the power set of a finite set is finite, with an exact count', () => {
    const p = ce.box(['PowerSet', set(1100)]);
    expect(p.isFiniteCollection).toBe(true);
    expect(p.count).toBe(1n << 1100n);
    expect(evaluate(['Length', ['PowerSet', set(1100)]]).json).toEqual({
      num: (1n << 1100n).toString(),
    });
  });

  test('a power set too large to count is finite with an unknown count', () => {
    // The base has a bigint count: 2^(2^61 - 1) cannot be built.
    const p = ce.box(['PowerSet', bigRing as any]);
    expect(p.count).toBeUndefined();
    expect(p.isFiniteCollection).toBe(true);
    // The power set of an infinite set is infinite.
    expect(ce.box(['PowerSet', 'Integers']).isFiniteCollection).toBe(false);
  });

  test('200! and C(2000, 1000) are exact', () => {
    expect(ce.box(['Permutations', ['Range', 1, 200]]).count).toBe(
      factorial(200)
    );
    const count = evaluate(['Count', ['Permutations', ['Range', 1, 200]]]);
    expect(count.isSame(ce.number(factorial(200)))).toBe(true);
    expect(ce.box(['Combinations', ['Range', 1, 2000], 1000]).count).toBe(
      factorial(2000) / (factorial(1000) * factorial(1000))
    );
  });

  test('a count with too many factors is unknown, and the collection is finite', () => {
    const p = ce.box(['Permutations', ['Range', 1, 20000]]);
    expect(p.count).toBeUndefined();
    expect(p.isFiniteCollection).toBe(true);
  });

  test('a count with too many bits is unknown, and the collection is finite', () => {
    // 10000! has about 118,000 bits: it is in the size limit.
    const perms = ['Permutations', ['Range', 1, 10000]];
    expect(ce.box(perms as any).count).toBe(factorial(10000));
    // 10,000 factors of about 118,000 bits each: about 356 million digits.
    // There are not too many factors, but the result is too large to build.
    const p = ce.box(['Permutations', perms, 10000] as any);
    expect(p.count).toBeUndefined();
    expect(p.isFiniteCollection).toBe(true);
    expect(evaluate(['Count', ['Permutations', perms, 10000]]).operator).toBe(
      'Count'
    );
    // C(10000!, 2) has about 236,000 bits, more than the limit.
    expect(ce.box(['Combinations', perms, 2] as any).count).toBeUndefined();
    expect(ce.box(['Combinations', perms, 1] as any).count).toBe(
      factorial(10000)
    );
    // 2^n has n + 1 bits. The base is a set of n elements.
    const ring = (n: number) => ['QuotientRing', 'Integers', n];
    expect(typeof ce.box(['PowerSet', ring(199999)] as any).count).toBe(
      'bigint'
    );
    expect(ce.box(['PowerSet', ring(200000)] as any).count).toBeUndefined();
  });
});

describe('RANGE: AN EXACT COUNT PAST THE SAFE INTEGERS', () => {
  const R = (upper: unknown, ...rest: unknown[]) => ['Range', ...rest, upper];

  test('the count is an exact bigint', () => {
    const r = ['Range', 1, ['Add', ['Power', 10, 20], 1]];
    expect(ce.box(r as any).count).toBe(100000000000000000001n);
    expect(evaluate(['Count', r]).json).toEqual({
      num: '100000000000000000001',
    });
    expect(ce.box(['Range', 0, ['Power', 10, 20], 3]).count).toBe(
      33333333333333333334n
    );
    expect(ce.box(['Range', ['Power', 10, 20], 1]).count).toBe(10n ** 20n);
    expect(ce.box(R(['Power', 10, 20]) as any).count).toBe(10n ** 20n);
  });

  test('a float bound keeps the machine count', () => {
    expect(ce.box(['Range', 1, 1e20]).count).toBe(1e20);
  });

  test('a rational step: the count is exact', () => {
    // The machine count was 2e20, one too many.
    const r = ['Range', 1, ['Power', 10, 20], ['Rational', 1, 2]];
    expect(ce.box(r as any).count).toBe(199999999999999999999n);
    expect(evaluate(['Length', r]).json).toEqual({
      num: '199999999999999999999',
    });
  });

  test('an upper bound past the largest machine number is finite', () => {
    // The machine upper bound is Infinity, and the machine count was too.
    const r = ['Range', 1, ['Power', 10, 400]];
    const e = ce.box(r as any);
    expect(e.count).toBe(10n ** 400n);
    expect(e.isFiniteCollection).toBe(true);
    expect(e.isEmptyCollection).toBe(false);
    expect(e.at(3)?.toString()).toBe('3');
    expect(evaluate(['Length', r]).isSame(ce.number(10n ** 400n))).toBe(true);
    expect(
      evaluate(['Sum', r]).isSame(
        ce.number((10n ** 400n * (10n ** 400n + 1n)) / 2n)
      )
    ).toBe(true);
  });

  test('a count that is a safe integer is a number', () => {
    expect(ce.box(['Range', 1, ['Power', 2, 52]]).count).toBe(2 ** 52);
  });

  test('readers that do not need the count as an index keep their answer', () => {
    const r = ['Range', 1, ['Power', 10, 20]];
    expect(evaluate(['Count', ['Take', r, 3]]).json).toBe(3);
    expect(evaluate(['Take', r, 3]).toString()).toBe('[1,2,3]');
    expect(evaluate(['At', r, 5]).json).toBe(5);
    expect(evaluate(['Count', ['Rest', r]]).json).toEqual({
      num: '99999999999999999999',
    });
  });
});

describe('A USER COLLECTION HANDLER THAT RETURNS A BIGINT', () => {
  // `Huge(k)` has 10^k elements, reported as a `bigint` whatever the size.
  const engine = new ComputeEngine();
  engine.declare('Huge', {
    signature: '(integer) -> set<integer>',
    collection: {
      iterator: () => undefined,
      count: (expr) => {
        if (!isFunction(expr)) return undefined;
        const k = expr.op1.re;
        return k < 0 ? 0n : 10n ** BigInt(k);
      },
    },
  });

  test('a small bigint count is converted to a number', () => {
    const h = engine.box(['Huge', 3]);
    expect(h.count).toBe(1000);
    expect(h.isFiniteCollection).toBe(true);
    expect(h.isEmptyCollection).toBe(false);
  });

  test('a zero bigint count is an empty collection', () => {
    const h = engine.box(['Huge', -1]);
    expect(h.count).toBe(0);
    expect(h.isEmptyCollection).toBe(true);
  });

  test('a large bigint count stays a bigint and is finite', () => {
    const h = engine.box(['Huge', 30]);
    expect(h.count).toBe(10n ** 30n);
    expect(h.isFiniteCollection).toBe(true);
    expect(h.isEmptyCollection).toBe(false);
    const n = engine.box(['Count', ['Huge', 30]]).evaluate();
    expect(n.isSame(engine.number(10n ** 30n))).toBe(true);
    expect(n.isInteger).toBe(true);
  });
});

describe('TYPE-LEVEL PINS (checked by npm run typecheck)', () => {
  test('the count getter admits a bigint', () => {
    const x = ce.box(bigRing as any);
    const count: number | bigint | undefined = x.count;
    // @ts-expect-error -- `count` can be a `bigint`, so it is not assignable
    // to `number | undefined`.
    const narrow: number | undefined = x.count;
    expect(count).toBe(narrow);
  });

  test('a count handler can return a bigint', () => {
    const engine = new ComputeEngine();
    engine.declare('TypedHuge', {
      signature: '() -> set<integer>',
      collection: {
        iterator: () => undefined,
        count: (): number | bigint | undefined => 2n ** 64n,
      },
    });
    expect(engine.box(['TypedHuge']).count).toBe(2n ** 64n);
  });
});
