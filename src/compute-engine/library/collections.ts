import {
  validateArgument,
  validateArgumentCount,
} from '../boxed-expression/validate';
import { asFloat } from '../numerics/numeric';
import {
  BoxedExpression,
  IdentifierDefinitions,
  SemiBoxedExpression,
} from '../public';
import { canonical } from '../symbolic/flatten';

// From NumPy:
const DEFAULT_LINSPACE_COUNT = 50;

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
  Sequence: {
    signature: {
      domain: 'Functions',
    },
  },
  List: {
    complexity: 8200,
    signature: {
      domain: ['Functions', ['Maybe', ['Sequence', 'Anything']], 'Lists'],
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

  Range: {
    complexity: 8200,
    signature: {
      domain: [
        'Functions',
        'Numbers',
        ['Maybe', 'Numbers'],
        ['Maybe', 'Numbers'],
        'Values',
      ],
    },
    size: (expr) => {
      const [lower, upper, step] = rangeArgs(expr);
      return Math.max(0, Math.floor((upper! - lower!) / step));
    },
    at: (
      expr: BoxedExpression,
      index: number | string
    ): undefined | BoxedExpression => {
      if (typeof index !== 'number') return undefined;
      const [lower, upper, step] = rangeArgs(expr);
      if (index < 1 || index > (upper - lower) / step) return undefined;
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
        'Functions',
        'Numbers',
        ['Maybe', 'Numbers'],
        ['Maybe', 'Numbers'],
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
      domain: ['Functions', 'Strings', 'Anything', 'Tuples'],
      canonical: (ce, args) => {
        const key = validateArgument(ce, args[0]?.canonical, 'Strings');
        const value = validateArgument(ce, args[1]?.canonical, 'Values');
        return ce.tuple([key, value]);
      },
    },
    size: (_expr) => 1,
  },

  Single: {
    description: 'A tuple with a single element',
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Anything', 'Tuples'],
      canonical: (ce, ops) =>
        ce.tuple(validateArgumentCount(ce, canonical(ops), 1)),
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
      domain: ['Functions', 'Anything', 'Anything', 'Tuples'],
      canonical: (ce, ops) =>
        ce.tuple(validateArgumentCount(ce, canonical(ops), 2)),
    },
    size: (expr) => expr.nops!,
    at: (expr, index) =>
      typeof index === 'number' ? expr.ops![index - 1] : undefined,
  },

  Triple: {
    description: 'A tuple of three elements',
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Anything', 'Anything', 'Anything', 'Tuples'],
      canonical: (ce, ops) =>
        ce.tuple(validateArgumentCount(ce, canonical(ops), 3)),
    },
    size: (expr) => expr.nops!,
    at: (expr, index) =>
      typeof index === 'number' ? expr.ops![index - 1] : undefined,
  },

  Tuple: {
    description: 'A fixed number of heterogeneous elements',
    complexity: 8200,
    signature: {
      domain: ['Functions', ['Sequence', 'Anything'], 'Tuples'],
      canonical: (ce, ops) => ce.tuple(canonical(ops)),
    },
    size: (expr) => expr.nops!,
    at: (expr, index) =>
      typeof index === 'number' ? expr.ops![index - 1] : undefined,
  },

  String: {
    threadable: true,
    signature: {
      domain: ['Functions', ['Maybe', 'Anything'], 'Strings'],
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
      domain: ['Functions', 'Values', 'Numbers'],
      evaluate: (ce, ops) => {
        // @todo: could have fast path for List.
        const def = ops[0].functionDefinition;
        if (def?.size) return ce.number(def.size(ops[0]));
        const s = ops[0].string;
        if (s !== null) return ce.number(s.length);
        return ce.number(0);
      },
    },
  },

  IsEmpty: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Numbers'],
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
        return l === 0 ? ce.symbol('True') : ce.symbol('False');
      },
    },
  },

  // Note: Take is equivalent to "Extract" or "Part" in Mathematica
  // @todo: should handle having a ["List"] as an index argument
  Take: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', ['Sequence', 'Values'], 'Values'],
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
      domain: ['Functions', 'Values', ['Sequence', 'Values'], 'Values'],
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
        if (!l || !def?.at) return ce.symbol('Nothing');
        const xs = indexes(ops.slice(1).map((op) => indexRangeArg(op, l)));
        const result: SemiBoxedExpression[] = [];
        for (let i = 1; i <= l; i++)
          if (!xs.includes(i)) {
            const val = def.at(ops[0], i);
            if (val) result.push(val);
          }
        return ce.fn('List', result);
      },
    },
  },

  At: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values', 'Values'],
      evaluate: (ce, ops) => {
        const expr = ops[0];
        const def = expr.functionDefinition;
        if (!def?.at) return undefined;
        const s = ops[1].string;
        if (s !== null) return def.at(expr, 1) ?? ce.symbol('Nothing');
        const i = asFloat(ops[1]);
        if (i === null || !Number.isInteger(i)) return undefined;
        return def.at(expr, i) ?? ce.symbol('Nothing');
      },
    },
  },

  First: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (ce, ops) => {
        const expr = ops[0];
        const def = expr.functionDefinition;
        if (!def?.at) return ce.symbol('Nothing');
        return def.at(expr, 1) ?? ce.symbol('Nothing');
      },
    },
  },

  Second: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (ce, ops) => {
        const expr = ops[0];
        const def = expr.functionDefinition;
        if (!def?.at) return ce.symbol('Nothing');
        return def.at(expr, 2) ?? ce.symbol('Nothing');
      },
    },
  },

  Last: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (ce, ops) => {
        const expr = ops[0];
        const def = expr.functionDefinition;
        if (!def?.at) return ce.symbol('Nothing');
        return def.at(expr, -1) ?? ce.symbol('Nothing');
      },
    },
  },

  Rest: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (_ce, ops) => take(ops[0], [[2, -1, 1]]),
    },
  },

  Most: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (_ce, ops) => take(ops[0], [[1, -2, 1]]),
    },
  },

  Reverse: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
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
      domain: ['Functions', 'Values', ['Maybe', 'Functions'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  Sort: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', ['Maybe', 'Functions'], 'Values'],
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
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Corresponds to monadic Shape `⍴` in APL
  Dimensions: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Lists'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  Rank: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Numbers'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Corresponds to ArrayReshape in Mathematica
  // and dyadic Shape `⍴` in APL
  Reshape: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Corresponds to Ravel `,` in APL
  // Also Enlist `∊``⍋` in APL
  Flatten: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
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
    signature: {
      domain: ['Functions', 'Collections', 'Functions', 'Collections'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // [x for x in xs if p(x)]
  // [x | x in xs, p(x)]
  Filter: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Functions', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Equivalent to "foldl" in Haskell
  // For "foldr", apply Reverse() first
  Reduce: {
    complexity: 8200,
    signature: {
      domain: [
        'Functions',
        'Values',
        'Functions',
        ['Maybe', 'Values'],
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
    signature: {
      domain: ['Functions', 'Functions', ['Sequence', 'Integers'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  /* Return a tuple of the unique elements, and their respective count
   * Ex: Tally([a, c, a, d, a, c]) = [[a, c, d], [3, 2, 1]]
   */
  Tally: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Tuples'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Return the first element of Tally()
  // Equivalent to `Union` in Mathematica, `distinct` in Scala,
  // Unique or Nub ∪, ↑ in APL
  Unique: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Tuples'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Similar to Zip, but has a single argument, a matrix
  // Ex: Transpose([[a, b, c], [1, 2, 3]]) = [[a, 1], [b, 2], [c, 3]]
  Transpose: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
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
      domain: ['Functions', 'Values', ['Sequence', 'Values'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  RotateLeft: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  RotateRight: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // If all the arguments have the same head, return a new expression
  // made of all the arguments, with the head of the first argument
  // ["Join", ["List", 1, 2, 3], ["List", 4, 5, 6]] -> ["List", 1, 2, 3, 4, 5, 6]
  Join: {
    complexity: 8200,
    signature: {
      domain: ['Functions', ['Sequence', 'Values'], 'Values'],
      evaluate: (_ce, _ops) => {
        // @todo
        return undefined;
      },
    },
  },

  // Iterate(fn, init) -> [fn(1, init), fn(2, fn(1, init)), ...]
  // Iterate(fn) -> [fn(1), fn(2), ...]
  // Infinite series. Can use First(Iterate(fn), n) to get a finite series
  Iterate: {
    complexity: 8200,
    signature: {
      domain: ['Functions', 'Values', ['Maybe', 'Values'], 'Values'],
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
      domain: ['Functions', 'Values', 'Values'],
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
      domain: ['Functions', 'Values', 'Values'],
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
      domain: ['Functions', 'Values', 'Values'],
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
  if (!def?.at) return ce.symbol('Nothing');

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
  return ce.fn('List', list);
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
