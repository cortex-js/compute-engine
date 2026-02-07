import {
  checkArity,
  checkType,
  checkTypes,
  spellCheckMessage,
} from '../boxed-expression/validate';
import { toInteger } from '../boxed-expression/numerics';

import {
  basicIndexedCollectionHandlers,
  isFiniteIndexedCollection,
} from '../collection-utils';
import { applicable, canonicalFunctionLiteral } from '../function-utils';
// Dynamic import for compile to avoid circular dependency
// (collections → compile-expression → base-compiler → library/utils → collections)
import { parseType } from '../../common/type/parse';
import { Type } from '../../common/type/types';
import {
  collectionElementType,
  functionResult,
  widen,
} from '../../common/type/utils';
import { interval } from '../numerics/interval';
import { Expression } from '../../math-json';
import { CancellationError } from '../../common/interruptible';
import type {
  BoxedExpression,
  OperatorDefinition,
  ComputeEngine,
  SymbolDefinitions,
} from '../global-types';
import { BoxedType } from '../types';
import { typeToString } from '../../common/type/serialize';
// BoxedDictionary dynamically imported to avoid circular dependency
import { canonical } from '../boxed-expression/canonical-utils';

// From NumPy:
export const DEFAULT_LINSPACE_COUNT = 50;

// @todo: future thoughts. Consider
// - operations from the Scala library, which is particularly well designed:
//    - https://scala-lang.org/api/3.3.1/scala/language$.html#
//    - https://superruzafa.github.io/visual-scala-reference//
// - Scala/Breeze universal functions:
//     https://github.com/scalanlp/breeze/wiki/Universal-Functions
// See also Julia:
//    - https://docs.julialang.org/en/v1/base/iterators/

// • Permutations()
// •	Append()
// •	Prepend()
// •	Partition()
// • Apply(expr, n) -> if head of expr has a at handler, use it to access an element

// • Keys: { domain: 'Functions' },
// • Entries: { domain: 'Functions' },
// • cons -> cons(first (element), rest (list)) = list
// • append -> append(list, list) -> list
// • in
// • such-that {x ∈ Z | x ≥ 0 ∧ x < 100 ∧ x 2 ∈ Z}

// TakeDiagonal(matrix) -> [matrix[1, 1], matrix[2, 2], ...]

// Diagonal(list) -> [[list[1, 1], 0, 0], [0, list[2, 2], 0], ...]

export const COLLECTIONS_LIBRARY: SymbolDefinitions = {
  //
  // Data Structures
  //
  List: {
    complexity: 8200,

    signature: '(any*) -> list',
    type: (ops, { engine: ce }) =>
      parseType(`list<${BoxedType.widen(...ops.map((op) => op.type))}>`),
    canonical: canonicalList,
    lazy: true,
    evaluate: (ops, { engine, materialization: eager }) => {
      if (!eager) return undefined;
      return engine._fn(
        'List',
        enlist(ops).map((op) => op.evaluate({ materialization: eager }))
      );
    },
    eq: defaultCollectionEq,
    collection: basicIndexedCollectionHandlers(),
  } as OperatorDefinition,

  // Extensional set. Elements do not repeat. The order of the elements is not significant.
  // For intensional set, use `Filter` with a condition, e.g. `Filter(RealNumbers, _ > 0)`
  Set: {
    complexity: 8200,

    signature: '(any*) -> set',
    type: (ops, { engine: ce }) =>
      parseType(`set<${BoxedType.widen(...ops.map((op) => op.type))}>`),

    canonical: canonicalSet,
    eq: (a: BoxedExpression, b: BoxedExpression) => {
      if (a.operator !== b.operator) return false;
      if (a.nops !== b.nops) return false;
      // The elements are not indexed
      const has: (x) => boolean = (x) => b.ops!.some((y) => x.isSame(y));
      return a.ops!.every(has);
    },
    collection: {
      ...basicIndexedCollectionHandlers(),
      // A set is not indexable
      at: undefined,
      indexWhere: undefined,
    },
  } as OperatorDefinition,

  Tuple: {
    description: 'A fixed number of heterogeneous elements',
    complexity: 8200,
    signature: '(any*) -> tuple',
    type: (ops) => parseType(`tuple<${ops.map((op) => op.type).join(', ')}>`),
    canonical: (ops, { engine }) => engine.tuple(...ops),
    eq: defaultCollectionEq,
    collection: {
      ...basicIndexedCollectionHandlers(),
      keys: (expr) => {
        return ['first', 'second', 'last'];
      },
    },
  } as OperatorDefinition,

  KeyValuePair: {
    description: 'A key/value pair',
    complexity: 8200,
    signature: '(key: string, value: any) -> tuple<string, unknown>',
    type: ([key, value]) => parseType(`tuple<string, ${value.type}>`),

    canonical: (args, { engine }) => {
      const [key, value] = checkTypes(engine, args, ['string', 'any']);
      if (!key.isValid || !value.isValid)
        return engine._fn('KeyValuePair', [key, value]);
      return engine.tuple(key, value);
    },
  },

  Single: {
    description: 'A tuple with a single element',
    complexity: 8200,
    signature: '(value: any) -> tuple<any>',
    type: ([value]) => parseType(`tuple<${value.type}>`),
    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 1)),
  },

  Pair: {
    description: 'A tuple of two elements',
    complexity: 8200,
    signature: '(first: any, second: any) -> tuple<any, any>',
    type: ([first, second]) =>
      parseType(`tuple<${first.type}, ${second.type}>`),
    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 2)),
  },

  Triple: {
    description: 'A tuple of three elements',
    complexity: 8200,
    signature: '(first: any, second: any, third: any) -> tuple<any, any, any>',
    type: ([first, second, third]) =>
      parseType(`tuple<${first.type}, ${second.type}, ${third.type}>`),

    canonical: (ops, { engine }) => engine.tuple(...checkArity(engine, ops, 3)),
  },

  //
  // Numeric Collections
  //

  Range: {
    complexity: 8200,
    signature:
      '(number, number?, step: number?) -> indexed_collection<integer>',

    canonical: (ops, { engine: ce }) => {
      if (ops.length === 0) return null;
      if (ops.length === 1) return ce._fn('Range', [ce.One, ops[0].canonical]);
      if (ops.length === 2)
        return ce._fn('Range', [ops[0].canonical, ops[1].canonical]);

      // We have a range with a step. The step may be an expression, which
      // we will evaluate... (when coming from the LaTeX parser, it is a Subtract expression)
      return ce._fn('Range', [
        ops[0].canonical,
        ops[1].canonical,
        ops[2].canonical.evaluate(),
      ]);
    },

    eq: (a: BoxedExpression, b: BoxedExpression) => {
      if (a.operator !== b.operator) return false;
      const [al, au, as] = range(a);
      const [bl, bu, bs] = range(b);
      return al === bl && au === bu && as === bs;
    },

    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        const [lower, upper, step] = range(expr);
        if (step === 0) return 0;
        if (!isFinite(lower) || !isFinite(upper)) return Infinity;
        return 1 + Math.max(0, Math.floor((upper! - lower!) / step));
      },

      contains: (expr, target) => {
        if (!target.type.matches('integer')) return false;
        const t = target.re;
        const [lower, upper, step] = range(expr);
        if (step === 0) return false;
        if (step > 0) return t >= lower && t <= upper;
        return t <= lower && t >= upper;
      },

      iterator: (expr) => {
        const [lower, upper, step] = range(expr);

        // Number of elements in the range:
        const maxCount =
          step === 0 ? 0 : Math.floor((upper - lower) / step) + 1;

        let index = 1;

        return {
          next: () => {
            if (index === maxCount + 1) return { value: undefined, done: true };
            index += 1;
            return {
              value: expr.engine.number(lower + step * (index - 1 - 1)),
              done: false,
            };
          },
        };
      },

      // Return the nth step of the range.
      // Questionable if this is useful.
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        const [lower, upper, step] = range(expr);
        if (index < 1 || index > 1 + (upper - lower) / step) return undefined;
        return expr.engine.number(lower + step * (index - 1));
      },

      indexWhere: undefined,

      subsetOf: (expr, target) => {
        // Note: Linspace is not considered a subset of Range
        if (target.operator === 'Range') {
          const [al, au, as] = range(expr);
          const [bl, bu, bs] = range(target);
          return al >= bl && au <= bu && as % bs === 0;
        }

        if (!target.isCollection) return false;

        let i = 1;
        for (const x of target.each()) {
          if (!expr.contains(x)) return false;
          if (!expr.at(i)?.isSame(x)) return false;
          i++;
        }
        return true;
      },

      eltsgn: (expr) => {
        const [lower, upper, step] = range(expr);
        if (step === 0) return 'zero';
        if (step > 0) return lower <= upper ? 'positive' : 'negative';
        return lower >= upper ? 'positive' : 'negative';
      },

      elttype: (_expr) => 'finite_integer',
    },
  } as OperatorDefinition,

  Interval: {
    description:
      'A set of real numbers between two endpoints. The endpoints may or may not be included.',
    complexity: 8200,
    lazy: true,
    signature: '(number, number) -> set<real>',
    canonical: ([lo, hi], { engine }) => {
      if (!lo || !hi) return null;
      const [lower, upper] = checkTypes(
        engine,
        [lo.canonical, hi.canonical],
        ['number', 'number']
      );
      if (!lower.isValid || !upper.isValid) return null;
      return engine._fn('Interval', [lower, upper]);
    },
    eq: (a: BoxedExpression, b: BoxedExpression) => {
      const intervalA = interval(a);
      const intervalB = interval(b);
      if (!intervalA || !intervalB) return false;
      return (
        intervalA.start === intervalB.start &&
        intervalA.end === intervalB.end &&
        intervalA.openStart === intervalB.openStart &&
        intervalA.openEnd === intervalB.openEnd
      );
    },
    collection: {
      count: (_expr) => Infinity,
      iterator: (expr) => {
        const int = interval(expr);
        if (!int) return { next: () => ({ value: undefined, done: true }) };

        // Handle empty interval
        if (int.start >= int.end) {
          return { next: () => ({ value: undefined, done: true }) };
        }

        const ce = expr.engine;
        let level = 0; // Current level in binary tree
        let index = 0; // Index within current level

        return {
          next: () => {
            // Calculate total points at this level: 2^level
            const pointsAtLevel = Math.pow(2, level);

            if (index >= pointsAtLevel) {
              // Move to next level (double the resolution)
              level++;
              index = 0;
            }

            // For level n, we have 2^n points
            // Point i at level n is at position: (2*i + 1) / 2^(n+1)
            // This creates a binary tree pattern:
            // Level 0: 1 point at 0.5 (middle)
            // Level 1: 2 points at 0.25, 0.75 (quarters)
            // Level 2: 4 points at 0.125, 0.375, 0.625, 0.875 (eighths)
            // etc.
            const t = (2 * index + 1) / Math.pow(2, level + 1);
            const value = int.start + t * (int.end - int.start);

            index++;
            return { value: ce.number(value), done: false };
          },
        };
      },
      isEmpty: (_expr) => {
        // An interval is empty if the start is greater or equal to the end
        const int = interval(_expr);
        if (!int) return false;
        // Should account for open intervals???
        if (int.openStart && int.start === int.end) return true;
        if (int.openEnd && int.start === int.end) return true;
        if (int.openStart && int.openEnd) return false;
        return int.start >= int.end;
      },
      isFinite: (_expr) => false,
      contains: (expr, target) => {
        const int = interval(expr);
        if (!int) return false;

        if (int.openStart && target.isLessEqual(int.start)) return false;
        if (int.openEnd && target.isGreaterEqual(int.end)) return false;
        return target.isGreaterEqual(int.start) && target.isLessEqual(int.end);
      },

      eltsgn: (expr) => {
        const i = interval(expr);
        if (!i) return 'unsigned';
        // If the interval is empty, it is unsigned
        if (i.start === i.end) return 'unsigned';

        // If the start includes 0, the interval is non-negative
        if (i.start >= 0 && !i.openStart) return 'non-negative';
        // If the end includes 0, the interval is non-positive
        if (i.end <= 0 && !i.openEnd) return 'non-positive';

        // If the start and end are both positive the interval is positive
        if (i.start > 0 && i.end > 0) return 'positive';
        // If the start and end are both negative the interval is negative
        if (i.start < 0 && i.end < 0) return 'negative';

        return undefined;
      },

      elttype: (expr) => {
        const i = interval(expr);
        if (!i) return 'never';
        if (isFinite(i.start) && isFinite(i.end)) return 'finite_real';
        return 'real';
      },
    },
  } as OperatorDefinition,

  Linspace: {
    complexity: 8200,
    signature:
      '(start: number, end: number?, count: number?) -> indexed_collection',
    // @todo: the canonical form should consider if this can be simplified to a range (if the elements are integers)

    // @todo: need eq handler
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        let count = expr.op3.re;
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        return Math.max(0, Math.floor(count));
      },
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        const lower = expr.op1.re;
        const upper = expr.op2.re;
        let count = expr.op3.re;
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        if (!isFinite(lower) || !isFinite(upper)) return undefined;
        if (index < 1 || index > count) return undefined;
        return expr.engine.number(
          lower! + ((upper! - lower!) * (index - 1)) / count
        );
      },
      iterator: (expr) => {
        let lower = expr.op1.re;
        let upper = expr.op2.re;
        let totalCount: number;
        if (!isFinite(upper)) {
          upper = lower;
          lower = 1;
          totalCount = DEFAULT_LINSPACE_COUNT;
        } else {
          totalCount = Math.max(
            0,
            !isFinite(expr.op3.re) ? DEFAULT_LINSPACE_COUNT : expr.op3.re
          );
        }

        let index = 1;

        return {
          next: () => {
            if (index === totalCount + 1)
              return { value: undefined, done: true };
            index += 1;
            return {
              value: expr.engine.number(
                lower + ((upper - lower) * (index - 1 - 1)) / totalCount!
              ),
              done: false,
            };
          },
        };
      },
      contains: (expr, target) => {
        if (!target.type.matches('finite_real')) return false;
        const t = target.re;
        const lower = expr.op1.re;
        const upper = expr.op2.re;
        if (t < lower || t > upper) return false;
        let count = expr.op3.re;
        if (!isFinite(count)) count = DEFAULT_LINSPACE_COUNT;
        if (count === 0) return false;
        const step = (upper - lower) / count;
        return (t - lower) % step === 0;
      },
    },
  },

  //
  // Operations on collections (indexed or not)
  //

  Contains: {
    description:
      'Return True if the collection contains the given element, False otherwise.',
    complexity: 8200,
    signature: '(collection, element: any) -> boolean',
    evaluate: ([xs, value], { engine: ce }) => {
      return xs.contains(value) ? ce.True : ce.False;
    },
  },

  Count: {
    description: ['Return the number of elements in the collection.'],
    complexity: 8200,
    signature: '(collection) -> integer',
    evaluate: ([xs], { engine }) =>
      xs.isEmptyCollection ? engine.Zero : engine.number(xs.count),
    sgn: ([xs]) => (xs.isEmptyCollection ? 'zero' : 'positive'),
  },

  IsEmpty: {
    description: ['Return True if the collection is empty, False otherwise.'],
    complexity: 8200,
    signature: '(collection) -> boolean',
    evaluate: ([xs], { engine: ce }) =>
      xs.isEmptyCollection ? ce.True : ce.False,
  },

  // Exists: {
  //   description:
  //     'Return True if any element of the collection satisfies the predicate, False otherwise.',
  //   complexity: 8200,
  //   signature: '(collection, function) -> boolean',
  //   type: () => 'boolean',
  //   evaluate: ([xs, fn], { engine: ce }) => {
  //     const f = applicable(fn);
  //     if (!f) return ce.False;
  //     for (const item of xs.each()) {
  //       if (f([item])?.symbol === 'True') return ce.True;
  //     }
  //     return ce.False;
  //   },
  // },

  // ForAll: {
  //   description:
  //     'Return True if all elements of the collection satisfy the predicate, False otherwise.',
  //   complexity: 8200,
  //   signature: '(collection, function) -> boolean',
  //   type: () => 'boolean',
  //   evaluate: ([xs, fn], { engine: ce }) => {
  //     const f = applicable(fn);
  //     if (!f) return ce.False;
  //     for (const item of xs.each()) {
  //       if (f([item])?.symbol !== 'True') return ce.False;
  //     }
  //     return ce.True;
  //   },
  // },

  // { f(x) for x in xs }
  // { 2x | x ∈ [ 1 , 10 ] }
  Map: {
    description: [
      'Return the collection where each element has been transformed by the mapping function.',
      'Equivalent to `[f(x) for x in xs]`.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection, function) -> collection',
    // If the input collection is indexed, the output collection is indexed.
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;

      return engine._fn('Map', [collection, fn]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => expr.op1.count,
      isEmpty: (expr) => expr.op1.isEmptyCollection,
      isFinite: (expr) => expr.op1.isFiniteCollection,
      iterator: (expr) => {
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };

        const source = expr.op1.each();

        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              if (done) return { value: undefined, done: true };
              const v = f([value]) ?? expr.engine.Nothing;
              return { value: v, done: false };
            }
          },
        };
      },
      at: (expr: BoxedExpression, index: number | string) => {
        if (!expr.isIndexedCollection) return undefined;
        if (typeof index !== 'number') return undefined;
        if (!Number.isFinite(index) || index === 0) return undefined;
        const item = expr.op1.at(index);
        if (!item) return undefined;
        return applicable(expr.op2)?.([item]);
      },
    },
  },

  Filter: {
    description: [
      'Return the elements of the collection for which the predicate function returns True.',
      'Equivalent to `[x for x in xs if p(x)]`.',
    ],
    complexity: 8200,
    lazy: true,
    signature: '(collection, predicate: function) -> collection',
    // If the input collection is indexed, the output collection is indexed.
    type: (ops) => ops[0].type,
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0]?.canonical, 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;

      return engine._fn('Filter', [collection, fn]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: (_expr) => Infinity,
      contains: (expr, target) => {
        // True if target is in the collection and the predicate returns True
        // for that target.
        if (!expr.contains(target)) return false;
        const f = applicable(expr.op2);
        return f([target])?.symbol === 'True';
      },
      iterator: (expr) => {
        const f = applicable(expr.op2);
        if (!f) return { next: () => ({ value: undefined, done: true }) };

        const source = expr.op1.each();
        let count = 0;
        const limit = expr.engine.iterationLimit;
        return {
          next: () => {
            while (true) {
              const { value, done } = source.next();
              count += 1;
              if (count > limit) {
                throw new CancellationError({
                  cause: 'iteration-limit-exceeded',
                  message: `Iteration limit of ${limit} exceeded while evaluating Filter()`,
                });
              }
              if (done) return { value: undefined, done: true };
              const pred = f([value]);
              if (!pred) {
                throw new Error(
                  `Invalid filter predicate. ${spellCheckMessage(expr.op2)}`
                );
              }
              if (pred.symbol === 'True') return { value, done: false };
              if (pred.symbol !== 'False') {
                throw new Error(
                  `Filter predicate must return "True" or "False". ${spellCheckMessage(expr.op2)}`
                );
              }
            }
          },
        };
      },
      /**
       * Return the element at the given 1‑based `index` **after** applying the
       * filter predicate.
       *
       * * If `index` is positive, iterate through the source collection until
       *   the `index`‑th element that satisfies the predicate is found.
       * * If `index` is negative, first materialise the filtered result (only
       *   possible for finite source collections) and count from the end
       *   (‑1 → last, ‑2 → penultimate, …).
       * * For non‑numeric indexes or out‑of‑range requests, return
       *   `undefined`.
       *
       * The function never mutates the source collection and stops iterating
       * as soon as the requested element is found.
       */
      at: (
        expr: BoxedExpression,
        index: number | string
      ): BoxedExpression | undefined => {
        // Only numeric indexes are supported
        if (typeof index !== 'number' || !Number.isFinite(index) || index === 0)
          return undefined;

        // Resolve the predicate
        const predicate = applicable(expr.op2);
        if (!predicate) return undefined;

        // Handle negative indexes by materialising the filtered sequence
        if (index < 0) {
          // Need a definite end to count from the back
          if (!expr.op1.isFiniteCollection) return undefined;

          const data = Array.from(expr.each()); // already filtered
          const i = data.length + index + 1; // convert ‑N to 1‑based
          if (i < 1 || i > data.length) return undefined;
          return data[i - 1];
        }

        // Positive index: stream through until we reach the desired element
        let count = 0;
        for (const item of expr.op1.each()) {
          const pred = predicate([item])?.symbol;
          if (pred === 'True') {
            count += 1;
            if (count === index) return item;
          } else if (pred !== 'False') {
            throw new Error(
              `Filter predicate must return "True" or "False". ${spellCheckMessage(expr.op2)}`
            );
          }
        }
        return undefined; // Not enough matching elements
      },
    },
  },

  // Haskell: "foldl"
  // For "foldr", apply Reverse() first
  Reduce: {
    complexity: 8200,
    lazy: true,
    signature: '(collection, function, initial:value?) -> value',
    canonical: (ops, { engine }) => {
      const collection = checkType(engine, ops[0], 'collection');
      const fn = canonicalFunctionLiteral(ops[1]);
      if (!collection.isValid || !fn) return null;

      const initial = ops[2]?.canonical;
      if (initial?.isValid)
        return engine._fn('Reduce', [collection, fn, initial]);
      return engine._fn('Reduce', [collection, fn]);
    },

    type: (ops) => parseType(functionResult(ops[1].type.type) ?? 'unknown'),

    evaluate: ([collection, fn, initial], { engine: ce }) => {
      if (!collection.isFiniteCollection) return undefined;
      initial ??= ce.Nothing;

      if (
        initial.type.matches('real') &&
        collection.type.matches(ce.type('collection<real>'))
      ) {
        // If we're dealing with real numbers, we can compile.
        const { compile } = require('../compilation/compile-expression');
        const jsf = compile(fn);
        if (!jsf) return undefined;

        let accumulator = initial.re;
        let first = true;
        for (const item of collection.each()) {
          if (first) accumulator = item.re;
          else accumulator = jsf(accumulator, item.re);
          first = false;
        }

        return ce.box(accumulator);
      }
      // We don't have a compiled function, so we need to use the
      // interpreted version.
      const f = applicable(fn);
      let accumulator = initial;
      let first = true;
      for (const item of collection.each()) {
        if (first) accumulator = item;
        else accumulator = f([accumulator, item]) ?? ce.Nothing;
        first = false;
      }
      return accumulator;
    },
  },

  Join: {
    description: [
      'Join the elements of some collections into a flat collection.',
    ],
    complexity: 8200,
    signature: '(collection*) -> collection',
    type: joinResultType,
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        let total = 0;
        for (const op of expr.ops!) {
          const count = op.count;
          if (count === undefined) return undefined;
          if (!Number.isFinite(count)) return Infinity;
          total += count;
        }
        return total;
      },
      contains: (expr, target) => expr.ops!.some((op) => op.contains(target)),
      iterator: (expr) => {
        const iters = expr.ops!.map((op) => op.each());
        let index = 0;
        return {
          next: () => {
            while (true) {
              const { value, done } = iters[index].next();
              if (!done) return { value, done: false };
              index += 1;
              // No more sources?
              if (index >= iters.length)
                return { value: undefined, done: true };
            }
          },
        };
      },
    },
  },

  //
  // Operations on indexed collections
  //

  At: {
    description: [
      'Access an element of an indexed collection.',
      'If the index is negative, it is counted from the end.',
      'Multiple indices can be provided to access nested collections (e.g., matrices).',
    ],
    complexity: 8200,
    signature:
      '(value: indexed_collection, index: (number|string)+) -> unknown',
    type: ([xs]) =>
      xs.operatorDefinition?.collection?.elttype?.(xs) ??
      collectionElementType(xs.type.type) ??
      'any',

    evaluate: (ops, { engine: ce }) => {
      // @todo: the implementation does not match the description. Need to think this through...
      let expr = ops[0];
      let index = 1;
      while (ops[index]) {
        const def = expr.baseDefinition;
        const at = def?.collection?.at;
        if (!at) return undefined;
        const s = ops[index].string;
        if (s !== null) expr = at(expr, s) ?? ce.Nothing;
        else {
          const i = ops[index].re;
          if (!Number.isInteger(i)) return undefined;
          expr = at(expr, i) ?? ce.Nothing;
        }
        index += 1;
      }
      return expr;
    },
  },

  // Miranda: `take` (also Haskell)
  Take: {
    description: ['Return `n` elements from a collection.'],
    complexity: 8200,
    signature: '(xs: indexed_collection, count: number) -> indexed_collection',
    type: ([xs]) => `list<${collectionElementType(xs.type.type)}>`,
    evaluate: (ops, { engine, materialization: eager }) => {
      if (!eager) return undefined;
      // Force materialization by converting iterator to List
      const takeExpr = engine._fn('Take', ops);
      const elements = Array.from(takeExpr.each());
      return engine._fn('List', elements);
    },
    collection: {
      isLazy: (_expr) => true,
      count: takeCount,
      isEmpty: (expr) => {
        const [xs, op2] = expr.ops!;
        if (xs.isEmptyCollection) return true;
        if (xs.isFiniteCollection === false) return false;
        const n = Math.max(0, toInteger(op2) ?? 0);
        const count = xs.count;
        if (count === undefined) return undefined;
        if (!Number.isFinite(n)) return false;
        return Math.min(count, n) === 0;
      },
      isFinite: (expr) => expr.op1.isFiniteCollection,
      iterator: takeIterator,
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number' || index === 0) return undefined;
        const n = Math.max(0, toInteger(expr.op2) ?? 0);
        if (n === 0) return undefined;

        if (index > 0) {
          if (index > n) return undefined;
          return expr.op1.at(index);
        }

        const count = takeCount(expr);
        if (count === undefined || count === 0) return undefined;
        if (index < -count) return undefined;
        return expr.op1.at(count + index);
      },
    },
  },

  // Miranda: `drop` (also Haskell)
  Drop: {
    description: ['Return the collection without the first n elements.'],
    complexity: 8200,
    signature: '(xs: indexed_collection, count: number) -> indexed_collection',
    type: ([xs]) => `list<${collectionElementType(xs.type.type)}>`,
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        const [xs, n] = expr.ops!;
        const count = xs.count;
        if (count === undefined) return undefined;
        if (!Number.isFinite(count)) return Infinity;
        if (xs.isEmptyCollection) return 0;
        const nValue = toInteger(n) ?? 0;
        if (nValue >= count) return 0;
        return Math.max(0, count - nValue);
      },
      isFinite: (expr) => expr.op1.isFiniteCollection,
      iterator: (expr) => {
        const [xs, nExpr] = expr.ops!;

        const n = toInteger(nExpr) ?? 0;
        if (n <= 0) return xs.each();

        let index = n + 1;

        return {
          next: () => {
            const value = expr.op1.at(index++);
            if (value === undefined) return { value: undefined, done: true };
            return { value, done: false };
          },
        };
      },
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        const [xs, nExpr] = expr.ops!;

        const n = toInteger(nExpr) ?? 0;
        if (n <= 0) return undefined;

        return xs.at(index + n);
      },
    },
  },

  First: {
    complexity: 8200,
    signature: '(collection) -> any',
    type: ([xs]) => xs.operatorDefinition?.collection?.elttype?.(xs) ?? 'any',
    evaluate: ([xs], { engine: ce }) => xs.at(1) ?? ce.Nothing,
  },

  Second: {
    complexity: 8200,
    signature: '(collection) -> any',
    type: ([xs]) => xs.operatorDefinition?.collection?.elttype?.(xs) ?? 'any',
    evaluate: ([xs], { engine: ce }) => xs.at(2) ?? ce.Nothing,
  },

  Last: {
    complexity: 8200,
    signature: '(collection) -> any',
    type: ([xs]) => xs.operatorDefinition?.collection?.elttype?.(xs) ?? 'any',
    evaluate: ([xs], { engine: ce }) => xs.at(-1) ?? ce.Nothing,
  },

  Rest: {
    description: [
      'Return the collection without the first element.',
      'If the collection has only one element, return an empty collection.',
    ],
    complexity: 8200,
    signature: '(indexed_collection) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return Math.max(0, count - 1);
      },
      isEmpty: (expr) => {
        if (expr.op1.isEmptyCollection) return true;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return count <= 1;
      },
      isFinite: (expr) => expr.op1.isFiniteCollection,
      iterator: (expr) => {
        return {
          next: () => {
            let index = 1;
            const value = expr.op1.at(index > 0 ? index + 1 : index);
            if (!value) return { value: undefined, done: true };
            index += 1;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;

        return expr.op1.at(index > 0 ? index + 1 : index);
      },
    },
  },

  Most: {
    complexity: 8200,
    description: [
      'Return the collection without the last element.',
      'If the collection has only one element, return an empty collection.',
    ],
    signature: '(indexed_collection) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return Math.max(0, count - 1);
      },
      isFinite: (expr) => expr.op1.isFiniteCollection,
      isEmpty: (expr) => {
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        return count <= 1;
      },
      iterator: (expr) => {
        const l = expr.op1.count;
        if (l === undefined || l <= 1)
          return { next: () => ({ value: undefined, done: true }) };

        let index = 1;
        const last = l - 1;
        return {
          next: () => {
            if (index > last) return { value: undefined, done: true };
            const value = expr.op1.at(index++)!;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        const l = expr.op1.count;
        if (l === undefined) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l - 1) return undefined;
        return expr.op1.at(index);
      },
    },
  },

  Slice: {
    description: [
      'Return a range of elements from an indexed collection.',
      'If the index is negative, it is counted from the end.',
    ],
    complexity: 8200,
    signature:
      '(value: indexed_collection, start: number, end: number) -> list',
    type: ([xs]) => parseType(`list<${collectionElementType(xs.type.type)}>`),
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        const start = toInteger(expr.op2) ?? 1;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        const end = toInteger(expr.op3) ?? count;
        if (start < 1) return Math.max(0, end + start - 1);
        return Math.max(0, Math.min(end, count) - start + 1);
      },
      isFinite: (_expr) => true,
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        const count = expr.op1.count;
        if (count === undefined) return undefined;
        let start = toInteger(expr.op2) ?? 1;
        if (start < 1) start = count + 1 + start; // Convert negative index to positive
        if (start < 1) start = 1; // Ensure start is at least 1
        if (start > count) return undefined; // Start is beyond the end of the collection
        let end = toInteger(expr.op3) ?? count;
        if (end < 1) end = count + 1 + end; // Convert negative index to positive
        if (end < 1) end = 1; // Ensure end is at least 1
        if (end > count) end = count; // Ensure end is within bounds
      },
      iterator: (expr) => {
        let start = toInteger(expr.op2) ?? 1;
        const count = expr.op1.count;
        if (count === undefined)
          return { next: () => ({ value: undefined, done: true }) };
        if (start < 1) start = count + 1 + start; // Convert negative index to positive
        if (start < 1) start = 1; // Ensure start is at least 1
        if (start > count)
          return { next: () => ({ value: undefined, done: true }) };
        let end = toInteger(expr.op3) ?? count;
        if (end < 1) end = count + 1 + end; // Convert negative index to positive
        if (end < 1) end = 1; // Ensure end is at least 1
        if (end > count) end = count;

        let index = start;
        const last = end;

        return {
          next: () => {
            if (index > last) return { value: undefined, done: true };
            const value = expr.op1.at(index)!;
            index += 1;
            return { value, done: false };
          },
        };
      },
    },
  },

  // APL: rotate ⌽
  Reverse: {
    complexity: 8200,
    signature: '(indexed_collection) -> indexed_collection',
    type: ([xs]) => xs.type,
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => expr.op1.count,
      isEmpty: (expr) => expr.op1.isEmptyCollection,
      isFinite: (expr) => expr.op1.isFiniteCollection,
      contains: (expr, target) => expr.op1.contains(target) ?? false,
      iterator: (expr) => {
        let index = -1;
        return {
          next: () => {
            if (index === 0) return { value: undefined, done: true };
            const value = expr.op1.at(index)!;
            index -= 1;
            return { value, done: false };
          },
        };
      },
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        return expr.op1.at(-index);
      },
    },
  },

  RotateLeft: {
    description:
      'Rotate the elements of the collection to the left by n positions.',
    complexity: 8200,
    signature: '(indexed_collection, integer?) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => expr.op1.count,
      isEmpty: (expr) => expr.op1.isEmptyCollection,
      isFinite: (expr) => expr.op1.isFiniteCollection,
      contains: (expr, target) => expr.op1.contains(target) ?? false,
      iterator: (expr) => {
        const l = expr.op1.count;
        if (l === undefined || l <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        let index = 1;
        const last = l;

        return {
          next: () => {
            if (index === last + 1) return { value: undefined, done: true };
            index += 1;
            const v = expr.op1.at(((index - 1 - 1 + n) % l) + 1);
            if (v === undefined) return { value: undefined, done: true };
            return { value: v, done: false };
          },
        };
      },
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        const l = expr.op1.count;
        if (l === undefined || l <= 0) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l) return undefined;
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        return expr.op1.at(((index - 1 + n) % l) + 1);
      },
    },
  },

  RotateRight: {
    description:
      'Rotate the elements of the collection to the right by n positions.',
    complexity: 8200,
    signature: '(indexed_collection, integer?) -> indexed_collection',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => expr.op1.count,
      contains: (expr, target) => expr.op1.contains(target) ?? false,
      iterator: (expr) => {
        const l = expr.op1.count;
        if (l === undefined || l <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift

        let index = 1;

        return {
          next: () => {
            if (index === l + 1) return { value: undefined, done: true };
            index += 1;
            const i = ((index - 1 - 1 + (l - n)) % l) + 1;
            const v = expr.op1.at(i);
            if (v === undefined) return { value: undefined, done: true };
            return { value: v, done: false };
          },
        };
      },
      at: (
        expr: BoxedExpression,
        index: number | string
      ): undefined | BoxedExpression => {
        if (typeof index !== 'number') return undefined;
        const l = expr.op1.count;
        if (l === undefined || l <= 0) return undefined;
        if (index < 1) index = l + 1 + index;
        if (index < 1 || index > l) return undefined;
        let n = toInteger(expr.op2) ?? 1;
        n = ((n % l) + l) % l; // Normalize shift
        const i = ((index - 1 + (l - n)) % l) + 1;
        return expr.op1.at(i);
      },
    },
  },
  // Return a list of the elements of each collection.
  // If all collections are Set, return a Set
  // ["Join", ["List", 1, 2, 3], ["List", 4, 5, 6]] -> ["List", 1, 2, 3, 4, 5, 6]

  IndexOf: {
    description:
      'Return the 1-based index of the first occurrence of value in collection, or 0 if not found.',
    complexity: 8200,
    signature: '(collection, any) -> integer',
    evaluate: ([xs, value], { engine: ce }) => {
      const index = xs.indexWhere((x) => x.isSame(value)) ?? undefined;
      return ce.number(index ?? 0);
    },
  },

  IndexWhere: {
    description:
      'Return the 1-based index of the first element satisfying the predicate, or 0 if not found.',
    complexity: 8200,
    signature: '(collection, function) -> integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Zero;
      const index =
        xs.indexWhere((x) => {
          const pred = f([x])?.symbol;
          if (pred === 'True') return true;
          if (pred === 'False') return false;
          throw new Error(
            `Filter predicate must return "True" or "False". ${spellCheckMessage(fn)}`
          );
        }) ?? undefined;
      return ce.number(index ?? 0);
    },
  },

  Find: {
    description:
      'Return the first element of the collection satisfying the predicate, or Nothing if none found.',
    complexity: 8200,
    signature: '(collection, function) -> any',
    type: (ops) => ops[0].type,
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Nothing;
      for (const item of xs.each()) {
        const pred = f([item])?.symbol;
        if (pred === 'False') continue;
        if (pred === 'True') return item;
        throw new Error(
          `Filter predicate must return "True" or "False". ${spellCheckMessage(fn)}`
        );
      }
      return ce.Nothing;
    },
  },

  CountIf: {
    description:
      'Return the number of elements in the collection satisfying the predicate.',
    complexity: 8200,
    signature: '(collection, function) -> integer',
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.Zero;
      let count = 0;
      for (const item of xs.each()) {
        const pred = f([item])?.symbol;
        if (pred === 'False') continue;
        if (pred === 'True') count++;
        else
          throw new Error(
            `Filter predicate must return "True" or "False". ${spellCheckMessage(fn)}`
          );
      }
      return ce.number(count);
    },
  },

  Position: {
    description:
      'Return a list of indexes of elements in the collection satisfying the predicate.',
    complexity: 8200,
    signature: '(collection, function) -> list<integer>',
    type: () => 'list<integer>',
    evaluate: ([xs, fn], { engine: ce }) => {
      const f = applicable(fn);
      if (!f) return ce.function('List', []);
      const indices: BoxedExpression[] = [];
      let index = 1;
      for (const item of xs.each()) {
        const pred = f([item])?.symbol;
        if (pred === 'True') indices.push(ce.number(index));
        if (pred !== 'False')
          throw new Error(
            `Filter predicate must return "True" or "False". ${spellCheckMessage(fn)}`
          );
        index++;
      }
      return ce.function('List', indices);
    },
  },

  // Return the indexes of the elements so they are in sorted order.
  // `Sort` is equivalent to `["Take", xs, ["Ordering", xs]]`.
  // APL: Grade Up `⍋` and Grade Down `⍒`
  // Mathematica: `Ordering`
  Ordering: {
    description: 'Return the indexes that would sort the collection.',
    complexity: 8200,
    signature: '(indexed_collection, function?) -> list<integer>',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return ce.function('List', []);
      const indices = sortedIndices(xs, fn);
      if (!indices) return ce.function('List', []);
      return ce.function('List', indices);
    },
  },

  Sort: {
    description:
      'Return the elements of the collection sorted according to the given comparison function.',
    complexity: 8200,
    signature: '(indexed_collection, function?) -> indexed_collection',
    type: (ops) => ops[0].type,
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return ce.function(xs.operator, []);
      const indices = sortedIndices(xs, fn);
      if (!indices) return undefined;
      return ce.function(
        xs.operator,
        indices.map((i) => xs.at(i)!)
      );
    },
  },

  // Randomize the order of the elements in the collection.
  Shuffle: {
    description: 'Randomize the order of the elements in the collection.',
    complexity: 8200,
    signature: '(indexed_collection) -> indexed_collection',
    type: (ops) => ops[0].type,
    evaluate: ([xs], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;

      const data = Array.from(xs.each());
      // Fisher-Yates shuffle
      for (let i = data.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [data[i], data[j]] = [data[j], data[i]];
      }

      return ce.function(xs.operator, data);
    },
  },

  Tabulate: {
    description:
      'Create a collection by applying a function to each index in the specified dimensions.',
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,

    lazy: true,
    signature: '(function, integer, integer?) -> collection',
    canonical: (ops, { engine }) => {
      const fn = canonicalFunctionLiteral(ops[0]);
      if (!fn) return null;

      if (!ops[2])
        return engine._fn('Tabulate', [
          fn,
          checkType(engine, ops[1]?.canonical, 'integer'),
        ]);

      return engine._fn('Tabulate', [
        fn,
        checkType(engine, ops[1]?.canonical, 'integer'),
        checkType(engine, ops[2]?.canonical, 'integer'),
      ]);
    },
    evaluate: (ops, { engine: ce }) => {
      // treated as multidimensional indexes
      const fn = applicable(ops[0]);
      if (!fn) return undefined;
      if (ops.length === 1) return ce._fn('List', []);
      const dims = ops.slice(1).map((op) => toInteger(op));
      if (dims.some((d) => d === null || d <= 0)) return undefined;
      if (dims.length === 1) {
        // @fastpath
        return ce._fn(
          'List',
          Array.from(
            { length: dims[0] ?? 0 },
            (_, i) => fn([ce.number(i + 1)]) ?? ce.Nothing
          )
        );
      }

      const fillArray = (dims: number[], index: number[], level = 0): any => {
        // Apply the function `fn` to the current index array
        if (level === dims.length) {
          const idx = index.map((i) => ce.number(i));
          return fn(idx);
        }

        const arr: any[] = ['List'];
        for (let i = 1; i <= dims[level]; i++) {
          index[level] = i;
          arr.push(fillArray(dims, index, level + 1));
        }
        return arr;
      };

      return ce.box(fillArray(dims as number[], Array(dims.length).fill(0)));
    },
  },

  /* Return a tuple of the unique elements, and their respective count
   * Ex: Tally([a, c, a, d, a, c]) = [[a, c, d], [3, 2, 1]]
   */
  Tally: {
    description:
      'Return a tuple with the unique elements of the collection and their respective counts.',
    complexity: 8200,
    signature: '(collection) -> tuple<list, list<integer>>',
    type: ([xs], { engine: ce }) => {
      const t = xs.type.type;
      if (t === 'string')
        return parseType(`tuple<list<string>, list<integer>>`);
      return parseType(
        `tuple<list<${collectionElementType(t)}>, list<integer>>`
      );
    },
    evaluate: (ops, { engine: ce }) => {
      if (!ops[0].isFiniteCollection) return undefined;
      const [values, counts] = tally(ops[0]!);
      return ce.tuple(ce.function('List', values), ce.function('List', counts));
    },
  },

  // Return the first element of Tally()
  // Equivalent to `Union` in Mathematica, `distinct` in Scala,
  // Unique or Nub ∪, ↑ in APL
  Unique: {
    description: 'Return a list of the unique elements of the collection.',
    complexity: 8200,
    signature: '(collection) -> list',
    type: ([xs]) => `list<${collectionElementType(xs.type.type)}>`,
    evaluate: (ops, { engine: ce }) => {
      if (!ops[0].isFiniteCollection) return undefined;
      const [values, _counts] = tally(ops[0]!);
      return ce.function('List', values);
    },
  },

  // Partition a collection into k nearly equal parts or by a predicate function
  Partition: {
    wikidata: 'Q381060',
    complexity: 8200,
    signature: '(collection, integer | function) -> list',
    type: ([xs]) => `list<${collectionElementType(xs.type.type)}>`,
    evaluate: ([xs, arg], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;

      // Partition(collection, integer)
      const k = toInteger(arg);
      if (k !== null && k > 0) {
        const all = Array.from(xs.each());
        const result: BoxedExpression[] = [];
        const chunkSize = Math.ceil(all.length / k);

        for (let i = 0; i < k; i++) {
          const chunk = all.slice(i * chunkSize, (i + 1) * chunkSize);
          result.push(ce.function('List', chunk));
        }

        return ce.function('List', result);
      }

      // Partition(collection, predicate)
      const fn = applicable(arg);
      if (!fn) return undefined;

      const trueGroup: BoxedExpression[] = [];
      const falseGroup: BoxedExpression[] = [];
      for (const item of xs.each()) {
        const pred = fn([item])?.symbol;
        if (pred === 'True') trueGroup.push(item);
        else if (pred === 'False') falseGroup.push(item);
        else
          throw new Error(
            `Partition predicate must return "True" or "False". ${spellCheckMessage(arg)}`
          );
      }

      return ce.function('List', [
        ce.function('List', trueGroup),
        ce.function('List', falseGroup),
      ]);
    },
  },

  Chunk: {
    description: 'Split the collection into `k` nearly equal-sized chunks.',
    complexity: 8200,
    signature: '(collection, integer) -> list<list>',
    evaluate: ([xs, n], { engine: ce }) => {
      const k = toInteger(n);
      if (!xs.isFiniteCollection || k === null || k <= 0) return undefined;

      const all = Array.from(xs.each());
      const result: BoxedExpression[] = [];
      const chunkSize = Math.ceil(all.length / k);

      for (let i = 0; i < k; i++) {
        const chunk = all.slice(i * chunkSize, (i + 1) * chunkSize);
        result.push(ce.function('List', chunk));
      }

      return ce.function('List', result);
    },
  },

  GroupBy: {
    description: [
      'Partition the collection into a dictionary of lists based on the key returned by the function.',
    ],
    complexity: 8200,
    signature: '(collection, function) -> dictionary<list>',
    evaluate: ([xs, fn], { engine: ce }) => {
      if (!xs.isFiniteCollection) return undefined;
      const f = applicable(fn);
      if (!f) return undefined;

      const groups: Record<string, BoxedExpression[]> = {};

      for (const item of xs.each()) {
        const keyExpr = f([item]) ?? ce.Nothing;
        const key = keyExpr.symbol ?? keyExpr.string ?? keyExpr.toString();

        if (!(key in groups)) groups[key] = [];
        groups[key].push(item);
      }

      return ce.function(
        'Dictionary',
        Object.entries(groups).map(([k, vals]) =>
          ce._fn('Tuple', [ce.string(k), ce.function('List', vals)])
        )
      );
    },
  },

  // Similar to Transpose, but acts on a sequence of collections
  // Equivalent to zip in Python
  // The length of the result is the length of the shortest argument
  // Ex: Zip([a, b, c], [1, 2]) = [[a, 1], [b, 2]]
  Zip: {
    description:
      'Combine multiple collections element-wise into a list of tuples. The result has the length of the shortest input.',
    complexity: 8200,
    signature: '(indexed_collection+) -> list',
    collection: {
      isLazy: (_expr) => true,
      count: zipCount,
      isFinite: (expr) => expr.ops!.every((x) => x.isFiniteCollection),
      isEmpty: (expr) => {
        return expr.nops === 0 || expr.ops!.every((x) => x.isEmptyCollection);
      },
      iterator: (expr) => {
        const minCount = zipCount(expr);
        if (minCount === undefined || minCount <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        let index = 1;
        return {
          next: () => {
            if (index === minCount + 1) return { value: undefined, done: true };
            index += 1;
            const items = expr.ops!.map((op) => op.at(index - 1));
            if (items.some((x) => x === undefined))
              return { value: undefined, done: true };
            return {
              value: expr.engine.tuple(...(items as BoxedExpression[])),
              done: false,
            };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        const minCount = zipCount(expr);
        if (minCount === undefined || index < 1 || index > minCount)
          return undefined;
        const items = expr.ops!.map((op) => op.at(index));
        if (items.some((x) => x === undefined)) return undefined;
        return expr.engine.tuple(...(items as BoxedExpression[]));
      },
    },
  },

  // Iterate(fn, init) -> [fn(1, init), fn(2, fn(1, init)), ...]
  // Iterate(fn) -> [fn(1), fn(2), ...]
  // Infinite series. Can use Take(Iterate(fn), n) to get a finite series
  Iterate: {
    description:
      'Produce an infinite sequence by repeatedly applying a function to the previous value, starting with an initial value.',
    complexity: 8200,
    signature: '((index: integer, acc:any) -> any, initial: any?) -> list',
    canonical: ([f, initialExpr], { engine }) => {
      const fn = canonicalFunctionLiteral(f);
      if (!fn) return null;
      const initial = initialExpr?.canonical;
      if (!initial) return engine._fn('Iterate', [fn]);
      return engine._fn('Iterate', [fn, initial]);
    },
    collection: {
      isLazy: (_expr) => true,
      count: () => Infinity,
      iterator: (expr) => {
        const f = applicable(expr.op1);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        let acc = expr.op2 ?? expr.engine.Nothing;
        let n = 0;
        return {
          next: () => {
            n += 1;
            acc = f([expr.engine.number(n), acc]) ?? expr.engine.Nothing;
            return { value: acc, done: false };
          },
        };
      },
      at: (expr, index) => {
        // @todo: use cache
        if (typeof index !== 'number' || index < 1) return undefined;
        const f = applicable(expr.op1);
        if (!f) return undefined;
        let acc = expr.op2 ?? expr.engine.Nothing;
        for (let i = 1; i < index; i++) {
          acc = f([expr.engine.number(i), acc]) ?? expr.engine.Nothing;
        }
        return acc;
      },
    },
  },

  // Repeat(x) -> [x, x, ...]
  // This is an infinite series. Can use Take(Repeat(x), n) to get a finite series
  // x is evaluated once. Although could use Hold()?
  // So that First(Repeat(Hold(Random(5))), 10) would return 10 random numbers...
  Repeat: {
    description: 'Produce an infinite sequence by repeating a single value.',
    complexity: 8200,
    signature: '(value: any) -> list',
    collection: {
      isLazy: (_expr) => true,
      count: () => Infinity,
      isEmpty: (expr) => false, // Never empty
      isFinite: () => false, // Infinite collection
      contains: (expr, target) => expr.op1.isSame(target),
      iterator: (expr) => ({ next: () => ({ value: expr.op1, done: false }) }),
      at: (expr, index) => expr.op1,
    },
  },

  // Cycle(list) -> [list[1], list[2], ...]
  // -> repeats infinitely
  Cycle: {
    description:
      'Produce an infinite sequence by cycling through the elements of a finite collection.',
    complexity: 8200,
    signature: '(list) -> list',
    collection: {
      isLazy: (_expr) => true,
      count: () => Infinity,
      isEmpty: (expr) => expr.isEmptyCollection,
      isFinite: (expr) => !expr.isEmptyCollection,
      contains: (expr, target) => expr.op1.contains(target) ?? false,
      iterator: (expr) => {
        let index = 1;
        const l = expr.op1.count;
        if (l === undefined || l === 0)
          return { next: () => ({ value: undefined, done: true }) };
        return {
          next: () => {
            const i = ((index - 1 - 1) % l) + 1;
            const value = expr.op1.at(i);
            if (value === undefined) return { value: undefined, done: true };
            index += 1;
            return { value, done: false };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        const l = expr.op1.count;
        if (l === undefined || l === 0) return undefined;
        const i = ((index - 1) % l) + 1; // 1-based index
        return expr.op1.at(i);
      },
    },
  },

  // Fill(f, [n, m])
  // Fill a nxm matrix with the result of f(i, j)
  // Fill( Random(5), [3, 3] )
  Fill: {
    description:
      'Produce a 2D list (matrix) by applying a function to each pair of row and column indexes.',
    complexity: 8200,
    signature: '(function, tuple) -> list',
    collection: {
      isLazy: (_expr) => true,
      count: (expr) => {
        const dims = expr.op2.ops!.map((op) => toInteger(op) ?? 0);
        return dims[0] ?? 0;
      },
      iterator: (expr) => {
        const f = applicable(expr.op1);
        if (!f) return { next: () => ({ value: undefined, done: true }) };
        const dims = expr.op2.ops!.map((op) => toInteger(op) ?? 0);
        const rows = dims[0] ?? 0;
        const cols = dims[1] ?? 0;
        const last = rows;
        let index = 1;
        return {
          next: () => {
            if (index === last + 1) return { value: undefined, done: true };
            index += 1;
            const row: BoxedExpression[] = [];
            for (let j = 1; j <= cols; j++) {
              row.push(
                f([expr.engine.number(index - 1), expr.engine.number(j)]) ??
                  expr.engine.Nothing
              );
            }
            return {
              value: expr.engine.function('List', row),
              done: false,
            };
          },
        };
      },
      at: (expr, index) => {
        if (typeof index !== 'number' || index < 1) return undefined;
        const f = applicable(expr.op1);
        if (!f) return undefined;
        const dims = expr.op2.ops!.map((op) => toInteger(op) ?? 0);
        const rows = dims[0] ?? 0;
        const cols = dims[1] ?? 0;
        if (index > rows * cols) return undefined;
        const row = Math.ceil(index / cols);
        const col = ((index - 1) % cols) + 1; // 1-based column index
        return (
          f([expr.engine.number(row), expr.engine.number(col)]) ??
          expr.engine.Nothing
        );
      },
    },
  },

  //
  // Create eager collections from other collections.
  //
  ListFrom: {
    description: 'Create a list from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> list',
    type: (ops) => {
      if (ops.length === 0) return 'list';
      let type: Type = 'unknown';
      for (const xs of ops) {
        if (xs.isCollection && !xs.isFiniteCollection) return 'list';
        type = widen(type, collectionElementType(xs.type.type) ?? type);
      }
      return parseType(`list<${typeToString(type)}>`);
    },
    evaluate: (ops, { engine: ce }) => {
      const elements: BoxedExpression[] = [];
      for (const xs of ops) {
        if (!xs.isCollection) elements.push(xs);
        else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as BoxedExpression[]));
        }
      }
      return ce.function('List', elements);
    },
  },

  SetFrom: {
    description: 'Create a set from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> set',
    type: (ops) => {
      if (ops.length === 0) return 'set';
      let type: Type = 'unknown';
      for (const xs of ops) {
        if (xs.isCollection && !xs.isFiniteCollection) return 'set';
        type = widen(type, collectionElementType(xs.type.type) ?? type);
      }
      return parseType(`set<${typeToString(type)}>`);
    },
    evaluate: (ops, { engine: ce }) => {
      const elements: BoxedExpression[] = [];
      for (const xs of ops) {
        if (xs.isCollection) elements.push(xs);
        else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as BoxedExpression[]));
        }
      }
      return ce.function('Set', elements);
    },
  },

  TupleFrom: {
    description: 'Create a tuple from the elements of a collection.',
    complexity: 8200,
    signature: '(value*) -> tuple',
    evaluate: (ops, { engine: ce }) => {
      const elements: BoxedExpression[] = [];
      for (const xs of ops) {
        if (xs.isCollection) elements.push(xs);
        else {
          if (!xs.isFiniteCollection) return undefined;
          elements.push(...(Array.from(xs.each()) as BoxedExpression[]));
        }
      }
      return ce.tuple(...elements);
    },
  },

  DictionaryFrom: {
    description:
      'Create a dictionary from the elements of a collection of (key, value) pairs.',
    complexity: 8200,
    signature: '(collection) -> dictionary',
    evaluate: ([xs], { engine: ce }) => {
      if (!xs.isCollection) return undefined;

      // If the collection is a Record, use its ops directly
      if (xs.operator === 'Record') return ce.function('Dictionary', xs.ops!);

      const entries: BoxedExpression[] = [];
      for (const keyValue of xs.each()) {
        if (keyValue.nops !== 2) {
          throw new Error(
            `Expected a collection of pairs, got ${keyValue.type}`
          );
        }
        const key = keyValue.op1;
        const value = keyValue.op2;
        if (!key.string) {
          throw new Error(`Expected a string key, got ${key.type}`);
        }
        entries.push(ce.tuple(key, value));
      }
      return ce.function('Dictionary', entries);
    },
  },

  RecordFrom: {
    description:
      'Create a record from the elements of a collection of (key, value) pairs.',
    complexity: 8200,
    signature: '(collection) -> record',
    evaluate: ([xs], { engine: ce }) => {
      if (!xs.isCollection) return undefined;

      // If the collection is a Dictionary, use its ops directly
      if (xs.operator === 'Dictionary') return ce.function('Record', xs.ops!);

      const entries: BoxedExpression[] = [];
      for (const keyValue of xs.each()) {
        if (keyValue.nops !== 2) {
          throw new Error(
            `Expected a collection of pairs, got ${keyValue.type}`
          );
        }
        const key = keyValue.op1;
        const value = keyValue.op2;
        if (!key.string) {
          throw new Error(`Expected a string key, got ${key.type}`);
        }
        entries.push(ce.tuple(key, value));
      }
      return ce.function('Record', entries);
    },
  },
};

/**
 * Normalize the arguments of range:
 * - [from, to] -> [from, to, 1] if to > from, or [from, to, -1] if to < from
 * - [x] -> [1, x]
 * - arguments rounded to integers
 *
 */
export function range(
  expr: BoxedExpression
): [lower: number, upper: number, step: number] {
  if (expr.nops === 0) return [1, 0, 0];

  let op1 = expr.op1.re;
  if (!isFinite(op1)) op1 = 1;
  else op1 = Math.round(op1);
  if (expr.nops === 1) return [1, op1, 1];

  let op2 = expr.op2.re;
  // Keep infinity values, only default non-finite values that aren't infinity
  if (!isFinite(op2) && !op2) op2 = 1;
  else if (isFinite(op2)) op2 = Math.round(op2);
  if (expr.nops === 2) return [op1, op2, op2 > op1 ? 1 : -1];

  let op3 = expr.op3.re;
  if (!isFinite(op3)) op3 = 1;
  else op3 = Math.abs(Math.round(op3));

  return [op1, op2, op1 < op2 ? op3 : -op3];
}

/** Return the last value in the range
 * - could be less that lower if step is negative
 * - could be less than upper if step is positive, for
 * example `rangeLast([1, 6, 2])` = 5
 */
export function rangeLast(
  r: [lower: number, upper: number, step: number]
): number {
  const [lower, upper, step] = r;
  if (!Number.isFinite(upper)) return step > 0 ? Infinity : -Infinity;

  if (step > 0) return upper - ((upper - lower) % step);
  return upper + ((lower - upper) % step);
}

/**
 * An index range is of the form:
 * - an index, as an integer
 * - a tuple of the form [from, to]
 * - a tuple of the form [from, to, step]. `step` must be a positive number.
 *   If invalid, or absent, 1 is assumed.
 * - a ["List"] of indexes
 *
 * Negative indexes indicate position relative to the last element: -1 is
 * the last element, -2 the one before that, etc...
 *
 */
function indexRangeArg(
  op: BoxedExpression | undefined,
  l: number
): [lower: number, upper: number, step: number] {
  if (!op) return [0, 0, 0];
  let n = op.re;

  if (isFinite(n)) {
    n = Math.round(n);
    if (n < 0) {
      if (l === undefined) return [0, 0, 0];
      n = l + n + 1;
    }
    return [n, n, 1];
  }

  // We may have a Tuple...
  const h = op.operator;
  if (!h || typeof h !== 'string' || !/^(Single|Pair|Triple|Tuple|)$/.test(h))
    return [0, 0, 0];
  let [lower, upper, step] = range(op);

  if ((lower < 0 || upper < 0) && l === undefined) return [0, 0, 0];

  if (lower < 0) lower = l! + lower + 1;
  if (upper < 0) upper = l! + upper + 1;

  step = Math.abs(Math.round(step));
  if (step === 0) return [0, 0, 0];
  if (lower > upper) step = -step;

  return [lower, upper, step];
}

// function xslice(
//   expr: BoxedExpression,
//   s: [first: number, last: number, step: number]
// ): BoxedExpression {
//   const ce = expr.engine;

//   const str = expr.string;

//   if (str !== null) return ce.string(sliceString(str, slice(s, str.length)));

//   const [first, last, step] = slice(s, length(expr));

//   return ce.function('List', arrayFrom(expr, first, last, step));
// }

function sliceString(
  s: string,
  slice: [first: number, last: number, step: number]
): string {
  let s2 = '';
  const [first, last, step] = slice;
  if (step === 1) return s!.slice(first - 1, last);

  if (step < 0) for (let i = first; i >= last; i += step) s2 += s[i - 1];
  else for (let i = first; i <= last; i += step) s2 += s[i - 1];
  return s2;
}

/** Return an array of the indexes described by an array of ranges */
function indexes(
  ranges: [lower: number, upper: number, step: number][]
): number[] {
  const result: number[] = [];
  for (const range of ranges) {
    const [lower, upper, step] = range;
    if (step === 0) continue;
    if (step < 0) {
      for (let index = lower; index >= upper; index += step) result.push(index);
    } else {
      for (let index = lower; index <= upper; index += step) {
        result.push(index);
      }
    }
  }

  return result;
}

function canonicalList(
  ops: BoxedExpression[],
  { engine: ce }
): BoxedExpression {
  // Do we have a matrix with a custom delimiter, i.e.
  // \left\lbrack \begin{array}...\end{array} \right\rbrack

  const op1 = ops[0];
  if (ops.length === 1 && op1.operator === 'Matrix') {
    // Adjust the matrix to have the correct delimiter
    const [body, delimiters, columns] = op1.ops!;

    if (!delimiters || delimiters.string === '..') {
      if (!columns) return ce._fn('Matrix', [body, delimiters]);
      return ce._fn('Matrix', [body, ce.string('[]'), columns]);
    }
  }

  ops = ops.map((op) => {
    if (op.operator === 'Delimiter') {
      if (op.op1.operator === 'Sequence')
        return ce._fn('List', canonical(ce, op.op1.ops!));
      return ce._fn('List', [op.op1?.canonical ?? ce.Nothing]);
    }
    return op.canonical;
  });
  return ce._fn('List', ops);
}

function canonicalSet(
  ops: ReadonlyArray<BoxedExpression>,
  { engine }
): BoxedExpression {
  // Check that each element is only present once
  const set: BoxedExpression[] = [];
  const has = (x) => set.some((y) => y.isSame(x));

  for (const op of ops) if (!has(op)) set.push(op);

  return engine._fn('Set', set);
}

function collectionFunction(
  ops: ReadonlyArray<BoxedExpression>
): [
  Iterable<BoxedExpression>,
  undefined | ((args: BoxedExpression[]) => BoxedExpression | undefined),
] {
  if (ops.length !== 2) return [[], undefined];

  const fn = applicable(ops[1]);
  if (!fn) return [[], undefined];

  if (ops[0].string) {
    return [
      [ops[0]],
      (args) => {
        const s = args[0].string;
        if (s === null) return undefined;
        const ce = args[0].engine;
        return ce.string(
          s
            .split('')
            .map((c) => fn([ce.string(c)])?.string ?? '')
            .join('')
        );
      },
    ];
  }

  if (!isFiniteIndexedCollection(ops[0]) || !ops[1]) return [[], undefined];
  return [ops[0].each(), fn];
}

function tally(
  collection: BoxedExpression
): [ReadonlyArray<BoxedExpression>, number[]] {
  const values: BoxedExpression[] = [];
  const counts: number[] = [];

  const indexOf = (expr: BoxedExpression) => {
    for (let i = 0; i < values.length; i++)
      if (values[i].isSame(expr)) return i;
    return -1;
  };

  for (const op of collection.each()) {
    const index = indexOf(op);
    if (index >= 0) counts[index]++;
    else {
      values.push(op);
      counts.push(1);
    }
  }

  return [values, counts];
}

/**
 * This function is used to reduce a collection of expressions to a single value. It
 * iterates over the collection, applying the given function to each element and the
 * accumulator. If the function returns `null`, the iteration is stopped and `undefined`
 * is returned. Otherwise, the result of the function is used as the new accumulator.
 * If the iteration completes, the final accumulator is returned.
 */
export function* reduceCollection<T>(
  collection: BoxedExpression,
  fn: (acc: T, next: BoxedExpression) => T | null,
  initial: T
): Generator<T | undefined> {
  let acc = initial;
  let counter = 0;
  for (const x of collection.each()) {
    const result = fn(acc, x);
    if (result === null) return undefined;
    counter += 1;
    if (counter % 1000 === 0) yield acc;
    acc = result;
  }
  return acc;
}

function joinResultType(ops: ReadonlyArray<BoxedExpression>): Type {
  if (ops.some((op) => op.type.matches('record'))) return 'record';
  if (ops.some((op) => op.type.matches('dictionary'))) return 'dictionary';
  if (ops.some((op) => op.type.matches('set'))) return 'set';
  return 'list';
}

/** Add a value to a record */
function joinRecord(
  values: Record<string, BoxedExpression>,
  value: BoxedExpression
): Record<string, BoxedExpression> | undefined {
  if (value.operator === 'KeyValuePair') {
    const key = value.op1.string;
    if (!key) return undefined;
    values[key] = value.op2;
    return values;
  }

  if (value.operator === 'Tuple') {
    const [key, val] = value.ops!;
    if (!key.string) return undefined;
    values[key.string] = val;
    return values;
  }

  if (value.operator === 'List' || value.operator === 'Set') {
    for (const val of value.ops!) {
      const result = joinRecord(values, val);
      if (!result) return undefined;
      values = result;
    }
    return values;
  }

  return undefined;
}

function joinSet(
  set: BoxedExpression[] | undefined,
  value: BoxedExpression
): BoxedExpression[] | undefined {
  if (value.operator === 'Set' || value.operator === 'List') {
    for (const val of value.ops!) {
      set = joinSet(set, val);
      if (!set) return undefined;
    }
  }

  const has = (x) => set!.some((y) => y.isSame(x));

  if (!has(value)) set!.push(value);
  return set!;
}

function keyValues(
  ops: ReadonlyArray<BoxedExpression>
): Record<string, BoxedExpression> {
  const values: Record<string, BoxedExpression> = {};
  let i = 1;
  // The `Dictionary` function has a hold attribute, so we can assume that the
  for (const pair of ops) {
    if (
      pair.operator === 'KeyValuePair' ||
      pair.operator === 'Tuple' ||
      pair.operator === 'Pair'
    ) {
      const [key, val] = pair.ops!;

      // The 'Nothing' symbol is skipped
      if (key.symbol === 'Nothing') continue;

      // A key is either a string or a symbol. If it's another expression,
      // (i.e. "1" or "x+1") turn it into a string. If there is no key, use the index.
      values[key?.string ?? key?.toString() ?? i.toString()] =
        val ?? pair.engine.Nothing;
    } else {
      // We didn't get a tuple, so make a key from the index
      values[i.toString()] = pair;
    }
    i += 1;
  }
  return values;
}

function defaultCollectionEq(a: BoxedExpression, b: BoxedExpression) {
  // Compare two collections
  if (a.operator !== b.operator) return false;
  if (a.nops !== b.nops) return false;

  // The elements are assumed to be in the same order
  return a.ops!.every((x, i) => x.isSame(b.ops![i]));
}

export function fromRange(start: number, end: number): number[] {
  return Array.from({ length: end - start + 1 }, (_, index) => start + index);
}

/**
 * A slice represents a range of elements in a collection.
 * It is defined by three parameters: first, last, and step.
 *
 * This function normalizes the parameters to ensure that they are
 * within the bounds of the collection length and that they are
 * in the correct order.
 *
 * `step` will be positive if the range is increasing (first <= last),
 * negative if it is decreasing (first > last),
 * and 0 if the range is empty.
 */
function slice(
  [first, last, step]: [first: number, last?: number, step?: number],
  length: number
): [first: number, last: number, step: number] {
  if (last === undefined) {
    // Single number -> [n, n, 1]
    if (first < 0) first = length + first + 1;
    if (first < 1) return [0, 0, 0];
    return [first, first, 1];
  }

  if (first === 0 || last === 0 || step === 0) return [0, 0, 0];

  if (first < 0) first = length + first + 1;
  if (first > length) return [0, 0, 0];
  if (last < 0) last = length + last + 1;
  if (last > length) last = length;

  if (last === first) return [first, first, 1];

  if (step === undefined) step = 1;

  if (last < first) step = -Math.abs(step);
  else step = Math.abs(step);

  return [first, last, step];
}

function evaluateSlice(
  expr: BoxedExpression
): [first: number, last: number, step: number] {
  if (expr.symbol === 'Nothing') return [0, 0, 0];

  // Single number -> element first n elements if n > 0, or last n elements
  // if n < 0
  if (expr.isNumberLiteral) {
    const n = Math.round(expr.re);
    if (isNaN(n)) return [0, 0, 0];
    return n < 0 ? [n, -1, 1] : [1, n, 1];
  }

  if (expr.operator === 'Tuple') {
    const [first, last, step] = expr.ops!.map((op) => {
      if (op.isNumberLiteral) {
        const value = Math.round(op.re);
        if (isNaN(value)) return undefined;
        return value;
      }
      return undefined;
    });
    return [first ?? 1, last ?? first ?? 1, step ?? 1];
  }

  return [0, 0, 0];
}

/**
 * A slice expression can be:
 * - a number, n: elements 1 to n or n to last if n < 0 [1, n]
 * - a tuple of the form [from, to] or [from, to, step]
 * - a tuple of the form [n]: elements n (equivalent to [n, n])
 * - 'All': [1, -1]
 * - 'None': [0, 0]
 * - 'Nothing': [0, 0]
 * - Range(from, to, step): [from, to, step]
 *
 * The canonical form is:
 * - Nothing
 * - a number n, indicating first or last n elements
 * - a tuple of the form [from, to] or [from, to, step]
 *
 * Pass the result to evaluateSlice() to get the actual slice when
 * evaluating.
 */
function canonicalSlice(expr: BoxedExpression): BoxedExpression {
  const ce = expr.engine;

  expr = expr.canonical;

  // All = [1, -1]
  if (expr.symbol === 'All') return ce.tuple(ce.One, ce.NegativeOne);

  // None = Nothing
  if (expr.symbol === 'Nothing' || expr.symbol === 'None') return ce.Nothing;

  if (
    expr.operator === 'Tuple' ||
    expr.operator === 'Single' ||
    expr.operator === 'Pair' ||
    expr.operator === 'Triple' ||
    expr.operator === 'Range'
  ) {
    // Empty tuple = Nothing
    if (expr.nops === 0) return ce.Nothing;

    // [n] equiv [n, n]
    if (expr.nops === 1) return ce.tuple(checkType(ce, expr.ops![0], 'number'));

    // [from, to]
    if (expr.nops === 2)
      return ce.tuple(...checkTypes(ce, expr.ops!, ['number', 'number']));

    // [from, to, step]
    if (expr.nops === 3)
      return ce.tuple(
        ...checkTypes(ce, expr.ops!, ['number', 'number', 'number'])
      );

    // We have too many elements in the tuple...
    return ce.tuple(...checkArity(ce, expr.ops!, 3));
  }

  // n could be [1, n] or [n, -1] if n < 0
  // Since we don't have its value yet, we just return the expression
  // (could be a variable). We'll resolve it in evaluateSlice().
  if (expr.type.matches('number')) return expr;

  return expr;
}

export function sortedIndices(
  expr: BoxedExpression,
  fn: BoxedExpression | undefined = undefined
): number[] | undefined {
  const f = fn ? applicable(fn) : undefined;
  const cmpFn = f
    ? (a: BoxedExpression, b: BoxedExpression) => {
        const r = f([a, b]);
        return r?.isNegative ? -1 : r?.is(0) ? 0 : 1;
      }
    : (a: BoxedExpression, b: BoxedExpression) => {
        if (a.isLess(b)) return -1;
        if (a.isEqual(b)) return 0;
        return 1;
      };

  const l = expr.count;
  if (l === undefined || !Number.isFinite(l) || l < 1) return undefined;

  const indices = Array.from({ length: l }, (_, i) => i + 1);

  indices.sort((i, j) => {
    const va = expr.at(i)!;
    const vb = expr.at(j)!;
    return cmpFn(va, vb);
  });

  return indices;
}

/**
 *
 * Flatten an array of BoxedExpressions (possibly lazy collections),
 * handling Sequence and Nothing
 *
 */

function enlist(xs: ReadonlyArray<BoxedExpression>): BoxedExpression[] {
  if (xs.length === 0) return [];

  const result: BoxedExpression[] = [];
  // let s: string | undefined = undefined;
  for (const x of xs) {
    if (x.symbol === 'Nothing') continue;

    // if (x.string) {
    //   if (s === undefined) s = '';
    //   s += x.string;
    //   continue;
    // }

    // if (s !== undefined) {
    //   result.push(ce.string(s));
    //   s = undefined;
    // }

    if (x.operator === 'Sequence') {
      result.push(...enlist(x.ops!));
    } else if (x.string) {
      // A string is a collection (of strings), but we don't want to iterate it recursively
      // if (s === undefined) s = '';
      // s += x.string;
      result.push(x);
    } else if (x.isCollection) {
      result.push(...enlist([...x.each()]));
    } else {
      result.push(x);
    }
  }

  // if (s !== undefined) result.push(ce.string(s));

  return result;
}

function takeIterator(expr: BoxedExpression): Iterator<BoxedExpression> {
  // Number of elements to take
  const count = Math.max(0, toInteger(expr.op2) ?? 0);

  if (count === 0) return { next: () => ({ value: undefined, done: true }) };

  let index = 1;
  let n = 0;

  return {
    next: () => {
      if (n >= Math.abs(count)) return { value: undefined, done: true };
      const value = expr.op1.at(index);
      if (!value) return { value: undefined, done: true };
      index += 1;
      n += 1;
      return { value, done: false };
    },
  };
}

function takeCount(expr: BoxedExpression): number | undefined {
  const [xs, op2] = expr.ops!;
  const count = xs.count;
  if (count === undefined) return undefined;
  const n = Math.max(0, toInteger(op2) ?? 0);
  if (!Number.isFinite(n)) return Infinity;
  return Math.min(count, n);
}

function dropCount(expr: BoxedExpression): number | undefined {
  const [xs, op2] = expr.ops!;
  const count = xs.count;
  if (count === undefined) return undefined;
  const n = Math.max(0, toInteger(op2) ?? 0);
  if (!Number.isFinite(n)) return Infinity;
  return Math.max(count - n, 0);
}

function zipCount(expr: BoxedExpression): number | undefined {
  const counts = expr.ops!.map((x) => x.count);
  if (counts.some((c) => c === undefined)) return undefined;
  if (counts.some((c) => !Number.isFinite(c))) return Infinity;
  if (counts.length === 0) return 0;
  return Math.min(...(counts as number[]));
}
