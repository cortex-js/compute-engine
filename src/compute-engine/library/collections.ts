import type {
  BoxedExpression,
  CollectionHandlers,
  FunctionDefinition,
  IdentifierDefinitions,
} from '../public.ts';

import { checkArity, checkTypes } from '../boxed-expression/validate.ts';
import { asSmallInteger } from '../boxed-expression/numerics.ts';

import {
  each,
  isFiniteCollection,
  isFiniteIndexableCollection,
} from '../collection-utils.ts';
import { applicable } from '../function-utils.ts';
import { canonical } from '../boxed-expression/utils.ts';
import { parseType } from '../../common/type/parse.ts';
import { isSubtype } from '../../common/type/subtype.ts';
import { Type } from '../../common/type/types.ts';
import { collectionElementType, widen } from '../../common/type/utils.ts';
import { interval } from '../numerics/interval.ts';

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
// •	Join()
// •	Partition()
// • Apply(expr, n) -> if head of expr has a at handler, use it to access an element
// • IndexOf()
// • Contains() -> True if element is in list, IndexOf() > 0

// • Keys: { domain: 'Functions' },
// • Entries: { domain: 'Functions' },
// • Dictionary: { domain: 'Collections' },
// •Dictionary: {
//   domain: 'Functions',
//   range: 'Dictionary',
// },
// • cons -> cons(first (element), rest (list)) = list
// • append -> append(list, list) -> list
// • in
// • such-that {x ∈ Z | x ≥ 0 ∧ x < 100 ∧ x 2 ∈ Z}
// • contains / find

// TakeDiagonal(matrix) -> [matrix[1, 1], matrix[2, 2], ...]

// Diagonal(list) -> [[list[1, 1], 0, 0], [0, list[2, 2], 0], ...]

export const COLLECTIONS_LIBRARY: IdentifierDefinitions = {
  //
  // Data Structures
  //
  List: {
    complexity: 8200,

    signature: '(...any) -> list',
    type: (ops) => parseType(`list<${widen(...ops.map((op) => op.type))}>`),
    canonical: canonicalList,
    eq: defaultCollectionEq,
    collection: defaultCollectionHandlers(),
  } as FunctionDefinition,

  // Extensional set. Elements do not repeat. The order of the elements is not significant.
  // For intensional set, use `Filter` with a condition, e.g. `Filter(RealNumbers, _ > 0)` @todo
  Set: {
    complexity: 8200,

    signature: '(...any) -> set',
    type: (ops) => parseType(`set<${widen(...ops.map((op) => op.type))}>`),

    canonical: canonicalSet,
    eq: (a: BoxedExpression, b: BoxedExpression) => {
      if (a.operator !== b.operator) return false;
      if (a.nops !== b.nops) return false;
      // The elements are not ordered
      const has: (x) => boolean = (x) => b.ops!.some((y) => x.isSame(y));
      return a.ops!.every(has);
    },
    collection: {
      ...defaultCollectionHandlers(),
      // A set is not indexable
      at: (_expr, _index) => undefined,
      indexOf: (_expr, _target) => undefined,
    },
  } as FunctionDefinition,

  Dictionary: {
    complexity: 8200,

    signature: '(...any) -> map',
    type: (ops) =>
      parseType(
        `tuple<${Object.entries(keyValues(ops))
          .map(([k, v]) =>
            k ? `${k}: ${v.type.toString()}` : v.type.toString()
          )
          .join(', ')}>`
      ),

    canonical: (ops, { engine }) => {
      const entries = keyValues(ops);
      return engine._fn(
        'Dictionary',
        Object.entries(entries).map(([k, v]) =>
          engine._fn('Tuple', [engine.string(k), v])
        )
      );
    },
    eq: (a: BoxedExpression, b: BoxedExpression) => {
      if (a.operator !== b.operator) return false;

      if (a.nops !== b.nops) return false;

      const akv = keyValues(a.ops!);
      const bkv = keyValues(b.ops!);

      // All the keys of a must be in b, and the values
      // must be equal.
      return Object.entries(akv).every(([k, v]) => {
        const bv = bkv[k];
        return bv && v.isSame(bv);
      });
    },

    collection: {
      ...defaultCollectionHandlers(),

      // A map is not indexable
      at: (_expr, _index) => undefined,
      indexOf: (_expr, _target) => undefined,

      elttype: (expr) => parseType('tuple<string, any>'),
    },
  } as FunctionDefinition,

  Range: {
    complexity: 8200,
    signature: '(number, number?, step: number?) -> collection<integer>',

    eq: (a: BoxedExpression, b: BoxedExpression) => {
      if (a.operator !== b.operator) return false;
      const [al, au, as] = range(a);
      const [bl, bu, bs] = range(b);
      return al === bl && au === bu && as === bs;
    },

    collection: {
      size: (expr) => {
        const [lower, upper, step] = range(expr);
        if (step === 0) return 0;
        if (!isFinite(lower) || !isFinite(upper)) return Infinity;
        return 1 + Math.max(0, Math.floor((upper! - lower!) / step));
      },

      contains: (expr, target) => {
        if (target.type !== 'integer') return false;
        const t = target.re;
        const [lower, upper, step] = range(expr);
        if (step === 0) return false;
        if (step > 0) return t >= lower && t <= upper;
        return t <= lower && t >= upper;
      },

      iterator: (expr, start, count) => {
        const [lower, upper, step] = range(expr);

        let index = start ?? 1;

        // number of elements in the range:
        const maxCount =
          step === 0 ? 0 : Math.floor((upper - lower) / step) + 1;

        count = Math.min(count ?? maxCount, maxCount);
        if (count <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        return {
          next: () => {
            if (count! > 0) {
              count!--;
              return {
                value: expr.engine.number(lower! + step! * (index++ - 1)),
                done: false,
              };
            } else {
              return { value: undefined, done: true };
            }
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

      indexOf: undefined,

      subsetOf: (expr, target) => {
        // Note: Linspace is not considered a subset of Range
        if (target.operator === 'Range') {
          const [al, au, as] = range(expr);
          const [bl, bu, bs] = range(target);
          return al >= bl && au <= bu && as % bs === 0;
        }

        if (!isFiniteCollection(target)) return false;
        const def = target.baseDefinition;
        if (!def?.collection?.iterator || !def?.collection?.at) return false;
        let i = 1;
        for (const x of each(target)) {
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
  } as FunctionDefinition,

  Interval: {
    description:
      'A set of real numbers between two endpoints. The endpoints may or may not be included.',
    complexity: 8200,
    hold: true,
    signature: '(expression, expression) -> set<real>',
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
      size: (_expr) => Infinity,
      contains: (expr, target) => {
        const int = interval(expr);
        if (!int) return false;

        if (int.openStart && target.isLessEqual(int.start)) return false;
        if (int.openEnd && target.isGreaterEqual(int.end)) return false;
        return target.isGreaterEqual(int.start) && target.isLessEqual(int.end);
      },

      eltsgn: (expr) => {
        const i = interval(expr);
        if (!i) return 'unsgined';
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
  } as FunctionDefinition,

  Linspace: {
    complexity: 8200,
    signature: '(start: number, end: number?, count: number?) -> collection',
    // @todo: the canonical form should consider if this can be simplified to a range (if the elements are integers)

    // @todo: need eq handler
    collection: {
      size: (expr) => {
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
      iterator: (expr, start, count) => {
        let lower = expr.op1.re;
        let upper = expr.op2.re;
        let totalCount: number;
        if (!isFinite(upper)) {
          upper = lower;
          lower = 1;
          totalCount = DEFAULT_LINSPACE_COUNT;
        } else
          totalCount = Math.max(
            0,
            !isFinite(expr.op3.re) ? DEFAULT_LINSPACE_COUNT : expr.op3.re
          );

        let index = start ?? 1;
        count = Math.min(count ?? totalCount, totalCount);
        if (count <= 0)
          return { next: () => ({ value: undefined, done: true }) };
        return {
          next: () => {
            if (count! > 0) {
              count!--;
              return {
                value: expr.engine.number(
                  lower! + ((upper! - lower!) * (index++ - 1)) / totalCount!
                ),
                done: false,
              };
            } else {
              return { value: undefined, done: true };
            }
          },
        };
      },
      contains: (expr, target) => {
        if (!isSubtype(target.type, 'finite_real')) return false;
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

  Tuple: {
    description: 'A fixed number of heterogeneous elements',
    complexity: 8200,
    signature: '(...any) -> tuple',
    type: (ops) => parseType(`tuple<${ops.map((op) => op.type).join(', ')}>`),
    canonical: (ops, { engine }) => engine.tuple(...ops),
    eq: defaultCollectionEq,
    collection: {
      size: (expr) => expr.nops!,
      contains: (expr, target) => expr.ops!.some((x) => x.isSame(target)),
      keys: (expr) => {
        return ['first', 'second', 'last'];
      },
      at: (expr, index) => {
        if (typeof index !== 'number') return undefined;
        return expr.ops![index - 1];
      },
    },
  } as FunctionDefinition,

  KeyValuePair: {
    description: 'A key/value pair',
    complexity: 8200,
    signature: '(key: string, value: any) -> tuple<string, any>',
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

  // This is a string interpolation function, not a string literal
  String: {
    threadable: true,
    signature: '(...any) -> string',
    evaluate: (ops, { engine }) => {
      if (ops.length === 0) return engine.string('');
      return engine.string(ops.map((x) => x.string ?? x.toString()).join(''));
    },
  },

  //
  // Functions
  //

  Length: {
    complexity: 8200,
    signature: 'any -> integer',
    evaluate: ([x], { engine }) => engine.number(length(x)),
    sgn: ([xs]) => (length(xs) === 0 ? 'zero' : 'positive'),
  },

  IsEmpty: {
    complexity: 8200,
    signature: 'any -> boolean',
    evaluate: ([x], { engine: ce }) => (length(x) === 0 ? ce.True : ce.False),
  },

  At: {
    description: [
      'Access an element of a collection or a character of a string.',
      'If the index is negative, it is counted from the end.',
      'If the collection has a rank greater than 1, the index is a tuple of indexes.',
      'If the index is a list, each element of the list is used as an index and the result if a list of the elements.',
    ],
    complexity: 8200,
    signature: '(value: list|tuple|string, index: number | string) -> any',

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

  // Note: Take is similar to `take` in Haskell
  // @todo: do a lazy version of this (implemented as a collection handler)
  Take: {
    description: [
      'Take a range of elements from a collection or a string.',
      'If the index is negative, it is counted from the end.',
    ],
    complexity: 8200,
    signature: '(value: collection|string, count: number) -> list|string',
    type: (ops) => {
      if (ops[0].type === 'string') return 'string';
      return parseType(`list<${collectionElementType(ops[0].type)}>`);
    },
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 2) return undefined;
      const s = ops[0].string;
      if (s !== null) {
        const indexes = ops.slice(1).map((op) => indexRangeArg(op, s.length));
        return ce.string(sliceString(s, indexes));
      }

      const l = length(ops[0]);
      return slice(
        ops[0],
        ops.slice(1).map((op) => indexRangeArg(op, l))
      );
    },
  },

  // Similar to `drop` in Haskell
  // @todo: do a lazy version of this (implemented as a collection handler)
  Drop: {
    complexity: 8200,
    signature:
      '(value: collection|string, indexes: ...(number | string)) -> list',
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 2) return undefined;
      const s = ops[0].string;
      if (s !== null) {
        const xs = indexes(
          ops.slice(1).map((op) => indexRangeArg(op, s.length))
        );
        return ce.string(
          s
            .split('')
            .filter((_c, i) => !xs.includes(i + 1))
            .join('')
        );
      }

      const def = ops[0].baseDefinition;
      const l = length(ops[0]);
      if (l === 0) return ce.Nothing; // Or empty list?
      const at = def?.collection?.at;
      if (!at) return undefined;
      const xs = indexes(ops.slice(1).map((op) => indexRangeArg(op, l)));
      const result: BoxedExpression[] = [];
      for (let i = 1; i <= l; i++)
        if (!xs.includes(i)) {
          const val = at(ops[0], i);
          if (val) result.push(val);
        }
      return ce.function('List', result);
    },
  },

  First: {
    complexity: 8200,
    signature: '(value: collection|string) -> any',
    // @todo: resultType
    evaluate: ([xs], { engine: ce }) => at(xs, 1) ?? ce.Nothing,
  },

  Second: {
    complexity: 8200,
    signature: '(value: collection|string) -> any',
    // @todo: resultType
    evaluate: ([xs], { engine: ce }) => at(xs, 2) ?? ce.Nothing,
  },

  Last: {
    complexity: 8200,
    signature: '(value: collection|string) -> any',
    // @todo: resultType
    evaluate: ([xs], { engine: ce }) => at(xs, -1) ?? ce.Nothing,
  },

  Rest: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(value: collection|string) -> list',
    // @todo: resultType
    evaluate: (ops) => slice(ops[0], [[2, -1, 1]]),
  },

  Slice: {
    description: [
      'Return a range of elements from a collection or a string.',
      'If the index is negative, it is counted from the end.',
    ],
    complexity: 8200,
    signature:
      '(value: collection|string, start: number, end: number) -> list|string',
    type: (ops) => {
      if (ops[0].type === 'string') return 'string';
      return parseType(`list<${collectionElementType(ops[0].type)}>`);
    },
    evaluate: (ops, { engine: ce }) => {
      if (ops.length < 3) return undefined;
      const s = ops[0].string;
      if (s !== null) {
        const [start, end] = ops
          .slice(1)
          .map((op) => indexRangeArg(op, s.length));
        return ce.string(sliceString(s, [start, end]));
      }

      const l = length(ops[0]);
      const [start, end] = ops.slice(1).map((op) => indexRangeArg(op, l));
      return slice(ops[0], [start, end]);
    },
  },

  Most: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(value: collection|string) -> list',
    // @todo: resultType
    evaluate: (ops) => slice(ops[0], [[1, -2, 1]]),
  },

  Reverse: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(value: collection|string) -> collection',
    type: (ops) => ops[0].type,
    evaluate: ([xs]) => slice(xs, [[-1, 2, 1]]),
  },

  // Return the indexes of the elements so they are in sorted order.
  // Sort is equivalent to `["Take", ["Ordering", expr, f]]`.
  // Equivalent to Grade Up `⍋` and Grade Down `⍒` return the indexes.
  // Equivalent to Ordering in Mathematica.
  Ordering: {
    complexity: 8200,

    hold: true,
    signature: '(value: collection, f: function?) -> list<integer>',
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  Sort: {
    complexity: 8200,

    hold: true,
    signature: '(value: collection, f: function?) -> collection',
    type: (ops) => ops[0].type,
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  // Randomize the order of the elements
  Shuffle: {
    complexity: 8200,
    signature: '(value: collection) -> collection',
    type: (ops) => ops[0].type,
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  // { f(x) for x in xs }
  // { 2x | x ∈ [ 1 , 10 ] }
  Map: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,

    hold: true,
    signature: '(collection, function) -> collection',
    // @todo: resultType

    evaluate: (ops, { engine: ce }) => {
      const [collection, fn] = collectionFunction(ops);
      if (!fn) return undefined;

      const result: BoxedExpression[] = [];
      for (const op of collection) result.push(fn([op]) ?? ce.Nothing);

      const h = ops[0].operator;
      const newHead =
        {
          List: 'List',
          Set: 'Set',
          Range: 'List',
          Linspace: 'List',
          Single: 'List',
          Pair: 'List',
          Triple: 'List',
          Tuple: 'List',
          String: 'String',
        }[h] ?? 'List';

      return ce.function(newHead, result);
    },
  },

  // [x for x in xs if p(x)]
  // [x | x in xs, p(x)]
  Filter: {
    // @todo: do a lazy version of this (implemented as a collection handler)

    complexity: 8200,

    hold: true,
    signature: '(collection, function) -> collection',
    type: (ops) => ops[0].type,
    evaluate: (ops, { engine: ce }) => {
      const fn = applicable(ops[1]);
      if (!fn) return undefined;
      const collection = ops[0];
      if (collection.string) {
        return ce.string(
          collection.string
            .split('')
            .map((c) => (fn([ce.string(c)])?.symbol === 'True' ? c : ''))
            .join('')
        );
      }
      if (!isFiniteIndexableCollection(ops[0]) || !ops[1]) return undefined;
      const result: BoxedExpression[] = [];
      for (const op of each(collection))
        if (fn([op])?.symbol === 'True') result.push(op);
      const h = collection.operator;
      const newHead =
        {
          List: 'List',
          Set: 'Set',
          Range: 'List',
          Linspace: 'List',
          Single: 'List',
          Pair: 'List',
          Triple: 'List',
          Tuple: 'List',
        }[h] ?? 'List';
      return ce.function(newHead, result);
    },
  },

  // Equivalent to "foldl" in Haskell
  // For "foldr", apply Reverse() first
  Reduce: {
    complexity: 8200,
    // @todo: do a lazy version of this (implemented as a collection handler)

    hold: true,
    signature: '(collection, function, initial:value) -> collection',
    // @todo: resultType
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  Tabulate: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,

    hold: true,
    signature: '(function, integer, integer?) -> collection',
    evaluate: (ops, { engine: ce }) => {
      // treated as multidimensional indexes
      const fn = applicable(ops[0]);
      if (!fn) return undefined;
      if (ops.length === 1) return ce.function('List', []);
      const dims = ops.slice(1).map((op) => asSmallInteger(op));
      if (dims.some((d) => d === null || d <= 0)) return undefined;
      if (dims.length === 1) {
        // @fastpath
        return ce.function(
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
    complexity: 8200,
    signature: '(collection) -> tuple<list, list<integer>>',
    type: (ops) =>
      parseType(
        `tuple<list<${collectionElementType(ops[0].type)}>, list<integer>>`
      ),
    evaluate: (ops, { engine: ce }) => {
      if (!isFiniteCollection(ops[0])) return undefined;
      const [values, counts] = tally(ops[0]!);
      return ce.tuple(ce.function('List', values), ce.function('List', counts));
    },
  },

  // Return the first element of Tally()
  // Equivalent to `Union` in Mathematica, `distinct` in Scala,
  // Unique or Nub ∪, ↑ in APL
  Unique: {
    complexity: 8200,
    signature: '(collection) -> list',
    type: (ops) => parseType(`list<${collectionElementType(ops[0].type)}>`),
    evaluate: (ops, { engine: ce }) => {
      if (!isFiniteCollection(ops[0])) return undefined;
      const [values, _counts] = tally(ops[0]!);
      return ce.function('List', values);
    },
  },

  // Similar to Transpose, but acts on a sequence of collections
  // Equivalent to zip in Python
  // The length of the result is the length of the shortest argument
  // Ex: Zip([a, b, c], [1, 2]) = [[a, 1], [b, 2]]
  Zip: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(collection, ...collection) -> list',
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  RotateLeft: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(collection, integer?) -> collection',
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  RotateRight: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(collection, integer?) -> collection',
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  // Return a list of the elements of each collection.
  // If all collections are Set, return a Set
  // ["Join", ["List", 1, 2, 3], ["List", 4, 5, 6]] -> ["List", 1, 2, 3, 4, 5, 6]
  Join: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    description: [
      'Join the elements of a sequence of collections or scalar values.',
      'If all collections are `Set`, return a `Set`.',
      'If all collections are `Map`, return a `Map`.',
    ],
    complexity: 8200,
    signature: '(...any) -> collection',
    type: joinResultType,
    evaluate: (ops, { engine: ce }) => {
      const type = joinResultType(ops);

      if (isSubtype(type, 'map')) {
        // Merge the maps, but make sure there are no duplicate keys
        let values: Record<string, BoxedExpression> | undefined = {};
        for (const op of ops) {
          values = joinMap(values, op);
          if (!values) return undefined;
        }
        return ce.function(
          'Dictionary',
          Object.entries(values).map(([key, value]) =>
            ce.function('KeyValuePair', [ce.string(key), value])
          )
        );
      }

      if (isSubtype(type, 'set')) {
        let values: BoxedExpression[] | undefined = [];
        for (const op of ops) {
          values = joinSet(values, op);
          if (!values) return undefined;
        }
        return ce.function('Set', values);
      }

      if (isSubtype(type, 'list')) {
        let values: BoxedExpression[] | undefined = [];

        for (const op of ops) {
          values = joinList(values, op);
          if (!values) return undefined;
        }
        return ce.function('List', values);
      }
      return undefined;
    },
  },

  // Iterate(fn, init) -> [fn(1, init), fn(2, fn(1, init)), ...]
  // Iterate(fn) -> [fn(1), fn(2), ...]
  // Infinite series. Can use First(Iterate(fn), n) to get a finite series
  Iterate: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(function, initial: any?) -> list',
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  // Repeat(x) -> [x, x, ...]
  // This is an infinite series. Can use Take(Repeat(x), n) to get a finite series
  // x is evaluated once. Although could use Hold()?
  // So that First(Repeat(Hold(Random(5))), 10) would return 10 random numbers...
  Repeat: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(value: any) -> list',
    type: (ops) => parseType(`collection<${ops[0].type}>`),
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  // Cycle(list) -> [list[1], list[2], ...]
  // -> repeats infinitely
  Cycle: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(list) -> list',
    type: (ops) => parseType(`list<${ops[0].type}>`),
    evaluate: (_ops) => {
      // @todo
      return undefined;
    },
  },

  // Fill(f, [n, m])
  // Fill a nxm matrix with the result of f(i, j)
  // Fill( Random(5), [3, 3] )
  Fill: {
    // @todo: do a lazy version of this (implemented as a collection handler)
    complexity: 8200,
    signature: '(function, tuple) -> list',
    // @todo: resultType
    evaluate: (_ops) => {
      // @todo
      return undefined;
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

  let op1 = Math.round(expr.op1.re);
  if (!isFinite(op1)) op1 = 1;
  if (expr.nops === 1) return [1, op1, 1];

  let op2 = Math.round(expr.op2.re);
  if (!isFinite(op2)) op2 = 1;
  if (expr.nops === 2) return [op1, op2, op2 > op1 ? 1 : -1];

  let op3 = Math.abs(Math.round(expr.op3.re));
  if (!isFinite(op3)) op3 = 1;

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
  l: number | undefined
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

function slice(
  expr: BoxedExpression,
  indexes: [lower: number, upper: number, step: number][]
): BoxedExpression {
  const ce = expr.engine;
  const def = expr.baseDefinition;
  const at = def?.collection?.at;
  if (!at) return ce.Nothing;

  const list: BoxedExpression[] = [];

  for (const index of indexes) {
    const [lower, upper, step] = index;
    if (step === 0) continue;
    if (step < 0) {
      for (let index = lower; index >= upper; index += step) {
        const result = at(expr, index);
        if (result) list.push(result);
      }
    } else {
      for (let index = lower; index <= upper; index += step) {
        const result = at(expr, index);
        if (result) list.push(result);
      }
    }
  }
  return ce.function('List', list);
}

function sliceString(
  s: string,
  indexes: [lower: number, upper: number, step: number][]
): string {
  let s2 = '';
  for (const index of indexes) {
    const [lower, upper, step] = index;
    if (step === 1) s2 += s!.slice(lower - 1, upper);
    else if (step < 0)
      for (let i = lower; i >= upper; i += step) s2 += s[i - 1];
    else for (let i = lower; i <= upper; i += step) s2 += s[i - 1];
  }
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

  if (!isFiniteIndexableCollection(ops[0]) || !ops[1]) return [[], undefined];
  return [each(ops[0]), fn];
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

  for (const op of each(collection)) {
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
export function reduceCollection<T>(
  collection: BoxedExpression,
  fn: (acc: T, next: BoxedExpression) => T | null,
  initial: T
): T | undefined {
  let acc = initial;
  for (const x of each(collection)) {
    const result = fn(acc, x);
    if (result === null) return undefined;
    acc = result;
  }
  return acc;
}

function joinResultType(ops: ReadonlyArray<BoxedExpression>): Type {
  if (ops.some((op) => op.type === 'map')) return 'map';
  if (ops.some((op) => op.type === 'set')) return 'set';
  return 'list';
}

function joinMap(
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

  if (
    value.operator === 'List' ||
    value.operator === 'Set' ||
    value.operator === 'Dictionary'
  ) {
    for (const val of value.ops!) {
      const result = joinMap(values, val);
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

function joinList(
  values: BoxedExpression[] | undefined,
  value: BoxedExpression
): BoxedExpression[] | undefined {
  if (value.operator === 'List' || value.operator === 'Set') {
    for (const val of value.ops!) {
      values = joinList(values, val);
      if (!values) return undefined;
    }
  }

  values!.push(value);
  return values;
}

function collectionSubset(
  a: BoxedExpression,
  b: BoxedExpression,
  strict: boolean
): boolean {
  if (a.string && b.string) {
    if (strict && a.string === b.string) return false;
    return a.string?.includes(b.string ?? '') ?? false;
  }

  if (!a.isCollection || !b.isCollection) return false;

  // All elements of a must be in b
  for (const x of each(a)) if (!b.contains(x)) return false;

  // A strict subset must have at least one element that is not in b
  if (strict) {
    // a must not be equal to b, therefore their size must be different
    const aSize = a.size;
    const bSize = b.size;
    if (aSize === bSize) return false;
    if (aSize === undefined || bSize === undefined) return false;
  }
  return true;
}

/** For a collection implementing its elements as operands (such as List, Tuple), return a set of default handlers */
function defaultCollectionHandlers(): CollectionHandlers {
  return {
    size: (expr) => expr.nops!,

    contains: (expr, target) => expr.ops!.some((x) => x.isSame(target)),

    iterator: (expr, start, count) => {
      let index = (start ?? 1) - 1;
      count = Math.min(count ?? expr.nops!, expr.nops!);
      return {
        next: () => {
          if (count! <= 0) return { value: undefined, done: true };
          count!--;
          return { value: expr.ops![index++], done: false };
        },
      };
    },

    at: (
      expr: BoxedExpression,
      index: number | string
    ): undefined | BoxedExpression => {
      if (typeof index !== 'number') return undefined;
      if (index < 1 || index > expr.nops!) return undefined;
      return expr.ops![index - 1];
    },

    keys: (_expr) => [],

    indexOf: (
      expr: BoxedExpression,
      target: BoxedExpression,
      from?: number
    ): number | undefined => {
      from ??= 1;
      if (from < 0) {
        // If from is negative, we search backwards
        if (from < -expr.nops!) return undefined;
        from = expr.nops + from + 1;
        for (let i = from; i >= 1; i--)
          if (expr.ops![i - 1]!.isSame(target)) return i;
        return undefined;
      }

      // Forward search
      for (let i = from; i <= expr.nops; i++)
        if (expr.ops![i - 1]!.isSame(target)) return i;

      return undefined;
    },

    subsetOf: collectionSubset,

    eltsgn: (_expr) => undefined,

    elttype: (expr) => {
      if (expr.nops === 0) return 'unknown';
      if (expr.nops === 1) return expr.ops![0].type;
      return widen(...expr.ops!.map((op) => op.type));
    },
  };
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

function keys(expr: BoxedExpression): string[] {
  return Object.keys(keyValues(expr.ops!));
}

function length(x: BoxedExpression): number {
  // @fastpath for List, Set
  if (x.operator === 'List' || x.operator === 'Set') return x.nops;

  const def = x.baseDefinition;
  if (def?.collection?.size) return def.collection.size(x);

  const s = x.string;
  if (s !== null) return s.length;

  return 0;
}

function at(x: BoxedExpression, i: number): BoxedExpression | undefined {
  const def = x.baseDefinition;
  if (def?.collection?.at) return def.collection.at(x, i);
  return undefined;
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
