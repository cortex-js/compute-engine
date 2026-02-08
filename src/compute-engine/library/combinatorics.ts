import { toBigint, toInteger } from '../boxed-expression/numerics';
import type { BoxedExpression, SymbolDefinitions } from '../global-types';
import { choose } from '../boxed-expression/expand';
import { isBoxedFunction } from '../boxed-expression/type-guards';

export const COMBINATORICS_LIBRARY: SymbolDefinitions[] = [
  {
    Choose: {
      complexity: 1200,
      signature: '(n:number, m:number) -> number',

      evaluate: (ops, { engine: ce }) => {
        const n = ops[0].re;
        const k = ops[1].re;
        if (!Number.isFinite(n) || !Number.isFinite(k)) return undefined;
        if (n < 0 || k < 0 || k > n) return ce.NaN;
        return ce.number(choose(n, k));
      },
    },
  },

  {
    Fibonacci: {
      description: 'Compute the nth Fibonacci number.',
      wikidata: 'Q47577',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toBigint(n);
        if (k === null) return undefined;
        if (k < 0n) return ce.function('Negate', ['Fibonacci', ce.number(-k)]);
        if (k === 0n) return ce.Zero;
        if (k === 1n) return ce.One;

        let a = 0n;
        let b = 1n;
        for (let i = 2n; i <= k; i++) {
          const next = a + b;
          a = b;
          b = next;
        }
        return ce.number(b);
      },
    },

    Binomial: {
      description:
        'Compute the binomial coefficient C(n, k) = n! / (k! (n-k)!).',
      wikidata: 'Q209875',
      signature: '(integer, integer) -> integer',
      evaluate: ([nExpr, kExpr], { engine: ce }) => {
        const n = toBigint(nExpr);
        const k = toBigint(kExpr);
        if (n === null || k === null) return undefined;
        if (k < 0n || k > n) return ce.number(0);
        if (k === 0n || k === n) return ce.number(1);

        let result = 1n;
        for (let i = 1n; i <= k; i++) {
          result *= n - (k - i);
          result /= i;
        }
        return ce.number(result);
      },
    },
    CartesianProduct: {
      description: 'Return the Cartesian product of input sets.',
      // Aka the product set, the set direct product or cross product
      // Notation: \times
      wikidata: 'Q173740',
      signature: '(set+) -> set',
      collection: {
        contains: (expr, x) => {
          if (!isBoxedFunction(expr)) return false;
          const factors = expr.ops;
          if (!x.isCollection || !isBoxedFunction(x) || x.ops.length !== factors.length) return false;
          const xOps = x.ops;
          return factors.every(
            (factor, i) => factor.contains(xOps[i]) ?? false
          );
        },
        count: (expr) => {
          if (!isBoxedFunction(expr)) return 0;
          const sizes = expr.ops.map((op) => op.count);
          if (sizes.includes(Infinity)) return Infinity;
          return sizes.reduce((a, b) => a! * b!, 1);
        },
        iterator: cartesianProductIterator,
      },
    },

    PowerSet: {
      description: 'Return the power set of a set (set of all subsets).',
      wikidata: 'Q205170',
      signature: '(set) -> set',
      collection: {
        contains: (expr, x) => {
          if (!isBoxedFunction(expr)) return false;
          const base = expr.ops[0];
          if (!x.isCollection || !isBoxedFunction(x)) return false;
          return x.ops.every((elem) => base.contains(elem) ?? false);
        },
        count: (expr) => {
          if (!isBoxedFunction(expr)) return 0;
          const xs = expr.ops[0];
          if (xs.isEmptyCollection) return 1; // Power set of empty set is {{}}
          if (xs.isFiniteCollection === false) return Infinity;
          return 2 ** xs.count!;
        },
        iterator: powerSetIterator,
      },
    },

    Permutations: {
      description:
        'Return all permutations of length k (default full length) of a collection.',
      signature: '(collection, integer?) -> list<list>',
      evaluate: ([xs, kExpr], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;

        const all = Array.from(xs.each()) as BoxedExpression[];
        const k = kExpr ? toInteger(kExpr) : all.length;
        if (k === null || k < 0 || k > all.length) return undefined;

        function* permute(
          prefix: BoxedExpression[],
          rest: BoxedExpression[]
        ): Generator<BoxedExpression[]> {
          if (prefix.length === k) {
            yield prefix;
            return;
          }
          for (let i = 0; i < rest.length; i++) {
            const next = rest.slice();
            const [item] = next.splice(i, 1);
            yield* permute([...prefix, item], next);
          }
        }

        return ce.function(
          'List',
          [...permute([], all)].map((perm) => ce.function('List', perm))
        );
      },
    },

    Combinations: {
      description: 'Return all k-element combinations of a collection.',
      wikidata: 'Q193606',
      signature: '(collection, integer) -> list<list>',
      evaluate: ([xs, kExpr], { engine: ce }) => {
        if (!xs.isFiniteCollection) return undefined;

        const all = Array.from(xs.each()) as BoxedExpression[];
        const k = toInteger(kExpr);
        if (k === null || k < 0 || k > all.length) return undefined;

        function* combine(
          start: number,
          combo: BoxedExpression[]
        ): Generator<BoxedExpression[]> {
          if (combo.length === k) {
            yield combo;
            return;
          }
          for (let i = start; i < all.length; i++) {
            yield* combine(i + 1, [...combo, all[i]]);
          }
        }

        return ce.function(
          'List',
          [...combine(0, [])].map((combo) => ce.function('List', combo))
        );
      },
    },

    Multinomial: {
      description: 'Compute the multinomial coefficient for multiple integers.',
      wikidata: 'Q20820114',
      signature: '(integer+) -> integer',
      evaluate: (ops, { engine: ce }) => {
        const ks = ops.map(toInteger);
        if (ks.some((k) => k === null || k < 0)) return undefined;
        const n = ks.reduce((a, b) => a! + (b ?? 0), 0)!;

        let result = 1;
        for (let i = 1; i <= n; i++) {
          result *= i;
        }
        for (const k of ks) {
          for (let i = 1; i <= k!; i++) {
            result /= i;
          }
        }
        return ce.number(result);
      },
    },

    Subfactorial: {
      description:
        'Compute the number of derangements (subfactorial) of n items.',
      wikidata: 'Q2361661',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toInteger(n);
        if (k === null || k < 0) return undefined;
        let result = 1;
        for (let i = 1; i <= k; i++) {
          result = Math.round(result * i * (1 - 1 / i));
        }
        return ce.number(result);
      },
    },

    BellNumber: {
      description:
        'Compute the Bell number B(n), the number of partitions of a set of n elements.',
      wikidata: 'Q816063',
      signature: '(integer) -> integer',
      evaluate: ([n], { engine: ce }) => {
        const k = toInteger(n);
        if (k === null || k < 0) return undefined;

        const bell: number[] = [1];
        for (let i = 1; i <= k; i++) {
          let b = 0;
          for (let j = 0; j < i; j++) {
            b += binomial(i - 1, j) * bell[j];
          }
          bell[i] = b;
        }
        return ce.number(bell[k]);
      },
    },
  },
];

function* cartesianProductIterator(
  expr: BoxedExpression
): Generator<BoxedExpression, undefined, any> {
  if (!isBoxedFunction(expr)) return;
  const factors = expr.ops;
  const iterators = factors.map((f) => [...f.each()] as BoxedExpression[]);
  const lengths = iterators.map((it) => it.length);
  if (lengths.some((len) => len === 0)) return;

  const indices = Array(factors.length).fill(0);
  while (true) {
    const tuple = indices.map((i, j) => iterators[j][i]);
    yield expr.engine._fn('Tuple', tuple);

    // Increment indices
    let j = indices.length - 1;
    while (j >= 0) {
      indices[j]++;
      if (indices[j] < lengths[j]) break;
      indices[j] = 0;
      j--;
    }
    if (j < 0) break;
  }
}

function* powerSetIterator(
  expr: BoxedExpression
): Generator<BoxedExpression, undefined, any> {
  if (!isBoxedFunction(expr)) return;
  const elements = [...expr.ops[0].each()] as BoxedExpression[];
  const n = elements.length;
  const ce = expr.engine;

  const total = 1 << n; // 2ⁿ subsets
  for (let mask = 0; mask < total; mask++) {
    const subset: BoxedExpression[] = [];
    for (let i = 0; i < n; i++) {
      if ((mask & (1 << i)) !== 0) {
        subset.push(elements[i]);
      }
    }
    yield subset.length === 0 ? ce.symbol('EmptySet') : ce._fn('Set', subset);
  }
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  if (k === 0 || k === n) return 1;
  let result = 1;
  for (let i = 1; i <= k; i++) {
    result *= n - (k - i);
    result /= i;
  }
  return result;
}
