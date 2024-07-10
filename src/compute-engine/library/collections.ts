import { checkArity, checkDomains } from '../boxed-expression/validate';
import { canonical } from '../symbolic/utils';
import {
  BoxedExpression,
  IComputeEngine,
  IdentifierDefinitions,
  SemiBoxedExpression,
} from '../public';
import { asFloat, asMachineInteger } from '../boxed-expression/numerics';
import {
  each,
  isFiniteCollection,
  isFiniteIndexableCollection,
} from '../collection-utils';
import { applicable } from '../function-utils';

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
    hold: 'all',
    signature: {
      domain: ['FunctionOf', ['VarArg', 'Anything'], 'Lists'],
      canonical: canonicalList,
    },
    size: (expr) => expr.nops!,
    iterator: (expr, start, count) => {
      let index = start ?? 1;
      count = Math.min(count ?? expr.nops!, expr.nops!);
      if (count <= 0) return { next: () => ({ value: undefined, done: true }) };
      return {
        next: () => {
          if (count! > 0) {
            count!--;
            return { value: expr.ops![index++ - 1], done: false };
          } else {
            return { value: undefined, done: true };
          }
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

    indexOf: (
      expr: BoxedExpression,
      target: BoxedExpression,
      from?: number
    ): number | string | undefined => {
      from ??= 1;
      if (from < 0) {
        if (from < -expr.nops!) return undefined;
        from = expr.nops! + from + 1;
        const start = from;
        for (let i = start; i >= 1; i--)
          if (expr.ops![i - 1]!.isEqual(target)) return i;
        return undefined;
      }
      const start = from;
      for (let i = start; i <= expr.nops!; i++)
        if (expr.ops![i - 1]!.isEqual(target)) return i;

      return undefined;
    },
  },

  // Extensional set. Elements do not repeat. The order of the elements is not significant.
  // For intensional set, use `Any` with a condition, e.g. `Any(x > 0, x in RealNumbers)` @todo
  Set: {
    complexity: 8200,
    hold: 'all',
    signature: {
      domain: ['FunctionOf', ['VarArg', 'Anything'], 'Sets'],
      canonical: canonicalSet,
    },
    size: (expr) => expr.nops!,
    iterator: (expr, start, count) => {
      let index = start ?? 1;
      count = Math.min(count ?? expr.nops!, expr.nops!);
      if (count <= 0) return { next: () => ({ value: undefined, done: true }) };
      return {
        next: () => {
          if (count! > 0) {
            count!--;
            return { value: expr.ops![index++ - 1], done: false };
          } else {
            return { value: undefined, done: true };
          }
        },
      };
    },
  },

  Range: {
    complexity: 8200,
    signature: {
      domain: [
        'FunctionOf',
        'Numbers',
        ['OptArg', 'Numbers', 'Numbers'],
        'Values',
      ],
    },
    size: (expr) => {
      const [lower, upper, step] = rangeArgs(expr);
      if (!isFinite(lower) || !isFinite(upper)) return Infinity;
      return 1 + Math.max(0, Math.floor((upper! - lower!) / step));
    },
    at: (
      expr: BoxedExpression,
      index: number | string
    ): undefined | BoxedExpression => {
      if (typeof index !== 'number') return undefined;
      const [lower, upper, step] = rangeArgs(expr);
      if (index < 1 || index > 1 + (upper - lower) / step) return undefined;
      return expr.engine.number(lower + step * (index - 1));
    },
    iterator: (expr, start, count) => {
      const [lower, upper, step] = rangeArgs(expr);

      let index = start ?? 1;
      count = Math.min(count ?? upper, upper);
      if (count <= 0) return { next: () => ({ value: undefined, done: true }) };
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
  },

  Linspace: {
    complexity: 8200,
    signature: {
      domain: [
        'FunctionOf',
        'Numbers',
        ['OptArg', 'Numbers', 'Numbers'],
        'Values',
      ],
    },
    size: (expr) => {
      const count = asFloat(expr.op3) ?? DEFAULT_LINSPACE_COUNT;
      return Math.max(0, Math.floor(count));
    },
    at: (
      expr: BoxedExpression,
      index: number | string
    ): undefined | BoxedExpression => {
      if (typeof index !== 'number') return undefined;
      const lower = asFloat(expr.op1);
      const upper = asFloat(expr.op2);
      const count = asFloat(expr.op3) ?? DEFAULT_LINSPACE_COUNT;
      if (lower === undefined || upper === undefined) return undefined;
      if (index < 1 || index > count) return undefined;
      return expr.engine.number(
        lower! + ((upper! - lower!) * (index - 1)) / count
      );
    },
    iterator: (expr, start, count) => {
      let lower = asFloat(expr.op1);
      let upper = asFloat(expr.op2);
      let totalCount: number;
      if (upper === undefined) {
        upper = lower;
        lower = 1;
        totalCount = DEFAULT_LINSPACE_COUNT;
      } else
        totalCount = Math.max(0, asFloat(expr.op3) ?? DEFAULT_LINSPACE_COUNT);

      let index = start ?? 1;
      count = Math.min(count ?? totalCount, totalCount);
      if (count <= 0) return { next: () => ({ value: undefined, done: true }) };
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
  },

  KeyValuePair: {
    description: 'A key/value pair',
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Strings', 'Anything', 'Tuples'],
      canonical: (ce, args) => {
        const [key, value] = checkDomains(ce, args, [ce.Strings, 'Values']);
        if (!key.isValid || !value.isValid)
          return ce._fn('KeyValuePair', [key, value]);
        return ce.tuple([key, value]);
      },
    },
    size: (_expr) => 1,
  },

  Single: {
    description: 'A tuple with a single element',
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Anything', 'Tuples'],
      canonical: (ce, ops) => ce.tuple(checkArity(ce, ops, 1)),
    },
    size: (expr) => expr.nops!,
    at: (expr, index) => {
      if (typeof index !== 'number' || index !== 1) return undefined;
      return expr.ops![0];
    },
  },

  Pair: {
    description: 'A tuple of two elements',
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Anything', 'Anything', 'Tuples'],
      canonical: (ce, ops) => ce.tuple(checkArity(ce, ops, 2)),
    },
    size: (expr) => expr.nops!,
    at: (expr, index) =>
      typeof index === 'number' ? expr.ops![index - 1] : undefined,
  },

  Triple: {
    description: 'A tuple of three elements',
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Anything', 'Anything', 'Anything', 'Tuples'],
      canonical: (ce, ops) => ce.tuple(checkArity(ce, ops, 3)),
    },
    size: (expr) => expr.nops!,
    at: (expr, index) =>
      typeof index === 'number' ? expr.ops![index - 1] : undefined,
  },

  Tuple: {
    description: 'A fixed number of heterogeneous elements',
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Anything', ['VarArg', 'Anything'], 'Tuples'],
      canonical: (ce, ops) => ce.tuple(canonical(ops)),
    },
    size: (expr) => expr.nops!,
    at: (expr, index) =>
      typeof index === 'number' ? expr.ops![index - 1] : undefined,
  },

  String: {
    threadable: true,
    signature: {
      domain: ['FunctionOf', ['OptArg', 'Anything'], 'Strings'],
      evaluate: (ce, ops) => {
        if (ops.length === 0) return ce.string('');
        return ce.string(ops.map((x) => x.string ?? x.toString()).join(''));
      },
    },
  },

  //
  // Functions
  //

  Length: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Numbers'],
      evaluate: (ce, ops) => {
        // @todo: could have fast path for List.
        const def = ops[0].functionDefinition;
        if (def?.size) return ce.number(def.size(ops[0]));
        const s = ops[0].string;
        if (s !== null) return ce.number(s.length);
        return ce.Zero;
      },
    },
  },

  IsEmpty: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Numbers'],
      evaluate: (ce, ops) => {
        // @todo: could have fast path for List.
        const def = ops[0].functionDefinition;
        let l: number | undefined = undefined;
        if (def?.size) l = def.size(ops[0]);
        else {
          const s = ops[0].string;
          if (s !== null) l = s.length;
        }
        if (l === undefined) return undefined;
        return l === 0 ? ce.True : ce.False;
      },
    },
  },

  // Note: Take is equivalent to "Extract" or "Part" in Mathematica
  // @todo: should handle having a ["List"] as an index argument
  Take: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['VarArg', 'Values'], 'Values'],
      evaluate: (ce, ops) => {
        if (ops.length < 2) return undefined;
        const s = ops[0].string;
        if (s !== null) {
          const indexes = ops.slice(1).map((op) => indexRangeArg(op, s.length));
          return ce.string(takeString(s, indexes));
        }

        const def = ops[0].functionDefinition;
        const l = def?.size?.(ops[0]);
        return take(
          ops[0],
          ops.slice(1).map((op) => indexRangeArg(op, l))
        );
      },
    },
  },

  // @todo: should handle having a ["List"] as an index argument
  Drop: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['VarArg', 'Values'], 'Values'],
      evaluate: (ce, ops) => {
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

        const def = ops[0].functionDefinition;
        const l = def?.size?.(ops[0]);
        if (!l || !def?.at) return ce.Nothing;
        const xs = indexes(ops.slice(1).map((op) => indexRangeArg(op, l)));
        const result: SemiBoxedExpression[] = [];
        for (let i = 1; i <= l; i++)
          if (!xs.includes(i)) {
            const val = def.at(ops[0], i);
            if (val) result.push(val);
          }
        return ce.box(['List', ...result]);
      },
    },
  },

  At: {
    complexity: 8200,
    signature: {
      params: ['Values'],
      restParam: 'Values',

      evaluate: (ce, ops) => {
        let expr = ops[0];
        let index = 1;
        while (ops[index]) {
          const def = expr.functionDefinition;
          if (!def?.at) return undefined;
          const s = ops[index].string;
          if (s !== null) expr = def.at(expr, s) ?? ce.Nothing;
          else {
            const i = asFloat(ops[index]);
            if (i === null || !Number.isInteger(i)) return undefined;
            expr = def.at(expr, i) ?? ce.Nothing;
          }
          index += 1;
        }
        return expr;
      },
    },
  },

  First: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (ce, ops) => {
        const expr = ops[0];
        const def = expr.functionDefinition;
        if (!def?.at) return ce.Nothing;
        return def.at(expr, 1) ?? ce.Nothing;
      },
    },
  },

  Second: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (ce, ops) => {
        const expr = ops[0];
        const def = expr.functionDefinition;
        if (!def?.at) return ce.Nothing;
        return def.at(expr, 2) ?? ce.Nothing;
      },
    },
  },

  Last: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (ce, ops) => {
        const expr = ops[0];
        const def = expr.functionDefinition;
        if (!def?.at) return ce.Nothing;
        return def.at(expr, -1) ?? ce.Nothing;
      },
    },
  },

  Rest: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (_ce, ops) => take(ops[0], [[2, -1, 1]]),
    },
  },

  Most: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (_ce, ops) => take(ops[0], [[1, -2, 1]]),
    },
  },

  Reverse: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (_ce, ops) => take(ops[0], [[-1, 2, 1]]),
    },
  },

  // Return the indexes of the elements so they are in sorted order.
  // Sort is equivalent to `["Take", ["Ordering", expr, f]]`
  // Equivalent to Grade Up `⍋` and Grade Down `⍒` return the indexes
  // equivalent to Ordering in Mathematica
  Ordering: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['OptArg', 'Functions'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  Sort: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['OptArg', 'Functions'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Randomize the order of the elements
  Shuffle: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // { f(x) for x in xs }
  // { 2x | x ∈ [ 1 , 10 ] }
  Map: {
    complexity: 8200,
    hold: 'last',
    signature: {
      domain: ['FunctionOf', 'Collections', 'Anything', 'Collections'],
      evaluate: (ce, ops) => {
        const [collection, fn] = collectionFunction(ops);
        if (!fn) return undefined;

        const result: BoxedExpression[] = [];
        for (const op of collection) result.push(fn([op]) ?? ce.Nothing);

        const h = ops[0].head;
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
          }[typeof h === 'string' ? h : 'List'] ?? 'List';

        return ce.function(newHead, result);
      },
    },
  },

  // [x for x in xs if p(x)]
  // [x | x in xs, p(x)]
  Filter: {
    complexity: 8200,
    hold: 'last',
    signature: {
      domain: ['FunctionOf', 'Values', 'Anything', 'Values'],
      evaluate: (ce, ops) => {
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

        const h = collection.head;
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
          }[typeof h === 'string' ? h : 'List'] ?? 'List';

        return ce.function(newHead, result);
      },
    },
  },

  // Equivalent to "foldl" in Haskell
  // For "foldr", apply Reverse() first
  Reduce: {
    complexity: 8200,
    hold: 'last',
    signature: {
      domain: [
        'FunctionOf',
        'Values',
        'Anything',
        ['OptArg', 'Values'],
        'Values',
      ],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  Tabulate: {
    complexity: 8200,
    hold: 'first',
    signature: {
      domain: [
        'FunctionOf',
        'Anything',
        'Integers',
        ['VarArg', 'Integers'],
        'Values',
      ],
      evaluate: (ce, ops) => {
        // treated as multidimensional indexes
        const fn = applicable(ops[0]);
        if (!fn) return undefined;
        if (ops.length === 1) return ce.function('List', []);
        const dims = ops.slice(1).map((op) => asMachineInteger(op));
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
  },

  /* Return a tuple of the unique elements, and their respective count
   * Ex: Tally([a, c, a, d, a, c]) = [[a, c, d], [3, 2, 1]]
   */
  Tally: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Tuples'],
      evaluate: (ce, ops) => {
        if (!isFiniteCollection(ops[0])) return undefined;
        const [values, counts] = tally(ops[0]!);
        return ce.tuple([
          ce.function('List', values),
          ce.function('List', counts),
        ]);
      },
    },
  },

  // Return the first element of Tally()
  // Equivalent to `Union` in Mathematica, `distinct` in Scala,
  // Unique or Nub ∪, ↑ in APL
  Unique: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Tuples'],
      evaluate: (ce, ops) => {
        if (!isFiniteCollection(ops[0])) return undefined;
        const [values, _counts] = tally(ops[0]!);
        return ce.function('List', values);
      },
    },
  },

  // Similar to Transpose, but acts on a sequence of collections
  // Equivalent to zip in Python
  // The length of the result is the length of the shortest argument
  // Ex: Zip([a, b, c], [1, 2]) = [[a, 1], [b, 2]]
  Zip: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['VarArg', 'Values'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  RotateLeft: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['OptArg', 'Integers'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  RotateRight: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['OptArg', 'Integers'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Return a list of the elements of each collection.
  // If all collections are Set, return a Set
  // ["Join", ["List", 1, 2, 3], ["List", 4, 5, 6]] -> ["List", 1, 2, 3, 4, 5, 6]
  Join: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', ['VarArg', 'Values'], 'Values'],
      evaluate: (ce, ops) => {
        // @todo
        const values: BoxedExpression[] = [];
        let isSet = true;

        for (const op of ops) {
          if (op.nops === 0) values.push(op);
          else {
            if (op.head !== 'Set') isSet = false;
            values.push(...op.ops!);
          }
        }
        return ce.function(isSet ? 'Set' : 'List', values);
      },
    },
  },

  // Iterate(fn, init) -> [fn(1, init), fn(2, fn(1, init)), ...]
  // Iterate(fn) -> [fn(1), fn(2), ...]
  // Infinite series. Can use First(Iterate(fn), n) to get a finite series
  Iterate: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', ['OptArg', 'Values'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Repeat(x) -> [x, x, ...]
  // This is an infinite series. Can use Tak(Repeat(x), n) to get a finite series
  // x is evaluated once. Although could use Hold()?
  // So that First(Repeat(Hold(Random(5))), 10) would return 10 random numbers...
  Repeat: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Cycle(list) -> [list[1], list[2], ...]
  // -> repeats infinitely
  Cycle: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Fill(f, [n, m])
  // Fill a nxm matrix with the result of f(i, j)
  // Fill( Random(5), [3, 3] )
  Fill: {
    complexity: 8200,
    signature: {
      domain: ['FunctionOf', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },
};

function rangeArgs(
  expr: BoxedExpression
): [lower: number, upper: number, step: number] {
  const lower = asFloat(expr.op1) ?? 1;
  const upper = asFloat(expr.op2);
  if (upper === undefined) return [1, lower, 1];
  const step = asFloat(expr.op3) ?? 1;
  return [lower, upper!, step];
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
  let n = asFloat(op);

  if (n !== null) {
    n = Math.round(n);
    if (n < 0) {
      if (l === undefined) return [0, 0, 0];
      n = l + n + 1;
    }
    return [n, n, 1];
  }

  // We may have a Tuple...
  const h = op.head;
  if (!h || typeof h !== 'string' || !/^(Single|Pair|Triple|Tuple|)$/.test(h))
    return [0, 0, 0];
  let [lower, upper, step] = rangeArgs(op);

  if ((lower < 0 || upper < 0) && l === undefined) return [0, 0, 0];

  if (lower < 0) lower = l! + lower + 1;
  if (upper < 0) upper = l! + upper + 1;

  step = Math.abs(Math.round(step));
  if (step === 0) return [0, 0, 0];
  if (lower > upper) step = -step;

  return [lower, upper, step];
}

function take(
  expr: BoxedExpression,
  indexes: [lower: number, upper: number, step: number][]
): BoxedExpression {
  const ce = expr.engine;
  const def = expr.functionDefinition;
  if (!def?.at) return ce.Nothing;

  const list: SemiBoxedExpression = [];

  for (const index of indexes) {
    const [lower, upper, step] = index;
    if (step === 0) continue;
    if (step < 0) {
      for (let index = lower; index >= upper; index += step) {
        const result = def.at(expr, index);
        if (result) list.push(result);
      }
    } else {
      for (let index = lower; index <= upper; index += step) {
        const result = def.at(expr, index);
        if (result) list.push(result);
      }
    }
  }
  return ce.box(['List', ...list]);
}

function takeString(
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
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  // Do we have a matrix with a custom delimiter, i.e.
  // \left\lbrack \begin{array}...\end{array} \right\rbrack

  const op1 = ops[0];
  if (ops.length === 1 && op1.head === 'Matrix') {
    // Adjust the matrix to have the correct delimiter
    const [body, delimiters, columns] = op1.ops!;

    if (!delimiters || delimiters.string === '..') {
      if (!columns) return ce._fn('Matrix', [body, delimiters]);
      return ce._fn('Matrix', [body, ce.string('[]'), columns]);
    }
  }

  ops = ops.map((op) => {
    if (op.head === 'Delimiter') {
      if (op.op1.head === 'Sequence')
        return ce.box(['List', ...canonical(op.op1.ops!)]);
      return ce.box(['List', op.op1?.canonical ?? ce.Nothing]);
    }
    return op.canonical;
  });
  return ce.box(['List', ...ops]);
}

function canonicalSet(
  ce: IComputeEngine,
  ops: BoxedExpression[]
): BoxedExpression {
  // Check that each element is only present once
  const set: BoxedExpression[] = [];
  const has = (x) => set.some((y) => y.isEqual(x));

  for (const op of ops) if (!has(op)) set.push(op);

  return ce.function('Set', set, { canonical: false });
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
      if (values[i].isEqual(expr)) return i;
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
