import {
  validateArgument,
  validateArgumentCount,
} from '../boxed-expression/validate';
import { asFloat } from '../numerics/numeric';
import { BoxedExpression, IdTable, SemiBoxedExpression } from '../public';
import { canonical } from '../symbolic/flatten';

export const COLLECTIONS_LIBRARY: IdTable = {
  //
  // Data Structures
  //
  Sequence: {
    signature: {
      domain: 'Function',
    },
  },
  List: {
    complexity: 8200,
    signature: {
      domain: ['Function', ['Maybe', ['Sequence', 'Anything']], 'List'],
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
        'Function',
        'Number',
        ['Maybe', 'Number'],
        ['Maybe', 'Number'],
        'Value',
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
        'Function',
        'Number',
        ['Maybe', 'Number'],
        ['Maybe', 'Number'],
        'Value',
      ],
    },
    size: (expr) => {
      const count = asFloat(expr.op3) ?? 50;
      return Math.max(0, Math.floor(count));
    },
    at: (
      expr: BoxedExpression,
      index: number | string
    ): undefined | BoxedExpression => {
      if (typeof index !== 'number') return undefined;
      const lower = asFloat(expr.op1);
      const upper = asFloat(expr.op2);
      const count = asFloat(expr.op3) ?? 50;
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
        totalCount = 50;
      } else totalCount = Math.max(0, asFloat(expr.op3) ?? 50);

      let index = start ?? 1;
      count = Math.min(count ?? expr.nops!, expr.nops!);
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
      domain: ['Function', 'String', 'Anything', 'Tuple'],
      canonical: (ce, args) => {
        const key = validateArgument(ce, args[0]?.canonical, 'String');
        const value = validateArgument(ce, args[1]?.canonical, 'Value');
        return ce.tuple([key, value]);
      },
    },
    size: (_expr) => 1,
  },
  Single: {
    description: 'A tuple with a single element',
    complexity: 8200,
    signature: {
      domain: ['Function', 'Anything', 'Tuple'],
      canonical: (ce, ops) =>
        ce.tuple(validateArgumentCount(ce, canonical(ops), 1)),
    },
    size: (expr) => expr.nops!,
  },
  Pair: {
    description: 'A tuple of two elements',
    complexity: 8200,
    signature: {
      domain: ['Function', 'Anything', 'Anything', 'Tuple'],
      canonical: (ce, ops) =>
        ce.tuple(validateArgumentCount(ce, canonical(ops), 2)),
    },
    size: (expr) => expr.nops!,
  },
  Triple: {
    description: 'A tuple of three elements',
    complexity: 8200,
    signature: {
      domain: ['Function', 'Anything', 'Anything', 'Anything', 'Tuple'],
      canonical: (ce, ops) =>
        ce.tuple(validateArgumentCount(ce, canonical(ops), 3)),
    },
    size: (expr) => expr.nops!,
  },
  Tuple: {
    description: 'A fixed number of heterogeneous elements',
    complexity: 8200,
    signature: {
      domain: ['Function', ['Sequence', 'Anything'], 'Tuple'],
      canonical: (ce, ops) => ce.tuple(canonical(ops)),
    },
    size: (expr) => expr.nops!,
  },

  //
  // Functions
  //

  Length: {
    complexity: 8200,
    signature: {
      domain: ['Function', 'Value', 'Number'],
      evaluate: (ce, ops) => {
        // @todo: could have fast path for List.
        const def = ce.lookupFunction(ops[0].head);
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
      domain: ['Function', 'Value', 'Number'],
      evaluate: (ce, ops) => {
        // @todo: could have fast path for List.
        const def = ce.lookupFunction(ops[0].head);
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

  Take: {
    complexity: 8200,
    signature: {
      domain: ['Function', 'Value', ['Sequence', 'Value'], 'Value'],
      evaluate: (ce, ops) => {
        if (ops.length < 2) return undefined;
        const s = ops[0].string;
        if (s !== null) {
          const indexes = ops.slice(1).map((op) => indexRangeArg(op, s.length));
          return ce.string(takeString(s, indexes));
        }

        const def = ce.lookupFunction(ops[0].head);
        const l = def?.size?.(ops[0]);
        return take(
          ops[0],
          ops.slice(1).map((op) => indexRangeArg(op, l))
        );
      },
    },
  },

  Drop: {
    complexity: 8200,
    signature: {
      domain: ['Function', 'Value', ['Sequence', 'Value'], 'Value'],
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

        const def = ce.lookupFunction(ops[0].head);
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
};

// •	First = Take(1)
// •	Second
// •	Last = Take(-1)
// •	Rest (eveything but First)
// •	Most (everything but Last)
// •	Take(n) 1...n = Take((1, n))
// •	Take((from, to, step))
// •	Take((at))
// •	Take(seq, seq, seq...)
// •	Drop(n) Take((n+1...-1))
// •	Drop(n<0): Take(1...-n)
// •	Drop((n)) : everything but element at (n)
// •	Drop((from, to)) : everything but element at from...to
// •	Drop((from, to, step)) : everything but element at from...to
// •	Range(n): create list 1...n
// •	Range(from, to, step)
// •	Length() = Dimensions[0]
// * Dimensions()
// •	Reverse()
// •	Append()
// •	Prepend()
// •	Join()
// •	Flatten()
// •	Partition()
// * Apply(expr, n) -> if head of expr has a at handler, use it to access an element
// - Tally(xs, test) -> Return a list of _tuple(element, count)_
// 	Ex: Tally([a, c, a, d, a, c]) = [(a, 3), (c, 2), (d, 1)]
// * IndexOf()
// * Contains() -> True if element is in list, IndexOf() > 0
// * Shuffle() -> randomized elements in list
// * Map(xs, f) -> [f(x) for x in xs]
// * Filter(xs, f) -> [x for x in xs if f(x)]

// * Sort()

// Keys: { domain: 'Function' },
// Entries: { domain: 'Function' },
// Dictionary: { domain: 'Collection' },
// Dictionary: {
//   domain: 'Function',
//   range: 'Dictionary',
// },
// List: { domain: 'Collection' },
// Tuple: { domain: 'Collection' },
// Sequence: { domain: 'Collection' },
// ForEach / Apply
// Map
// ReduceRight
// ReduceLeft
// cons -> cons(first (element), rest (list)) = list
// append -> append(list, list) -> list
// reverse
// rotate
// in
// map   ⁡ map(2x, x, list) ( 2 ⁢ x | x ∈ [ 0 , 10 ] )
// such-that {x ∈ Z | x ≥ 0 ∧ x < 100 ∧ x 2 ∈ Z}
// select : picks out all elements ei of list for which crit[ei] is True.
// sort
// contains / find

/*

* Thread(expr) -> ["List", 
https://reference.wolfram.com/language/ref/Thread.html


[x for x in 1...10 if x % 2 == 0]
[ _expression_ for _name_ in _iterable_ <if _condition_>? ]

Filter(1...10, (x) -> x % 2 == 0)

Python: my_set = {x for x in range(10) if x % 2 == 0}
Scala: val mySet = for (x <- 0 until 10 if x % 2 == 0) yield x
Swift: let mySet = Set(0..<10).filter { $0 % 2 == 0 }
C#: var mySet = Enumerable.Range(0, 10).Where(x => x % 2 == 0).ToHashSet();
Java: Set<Integer> mySet = IntStream.range(0, 10).filter(x -> x % 2 == 0).boxed().collect(Collectors.toSet());
JavaScript: const mySet = new Set([...Array(10).keys()].filter(x => x % 2 === 0));
Ruby: my_set = (0...9).select(&:even?).to_set
Rust: let my_set: HashSet<_> = (0..9).filter(|x| x % 2 == 0).collect();
Go: mySet := make(map[int]struct{})
for i := 0; i < 10; i++ {
    if i % 2 == 0 {
        mySet[i] = struct{}{}
    }
}
Kotlin: val mySet = (0..9).filter { it % 2 == 0 }.toSet()
PHP: $mySet = array_flip(array_filter(range(0, 9), fn($x) => $x % 2 === 0));
C++: std::set<int> mySet;
for (int i = 0; i < 10; ++i) {
    if (i % 2 == 0) {
        mySet.insert(i);
    }
}


*/

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
 * - an integer
 * - a tuple of the form [from, to]
 * - a tuple of the form [from, to, step]
 *
 * `from` and `to` can be negative to indicate position relative to the last element
 *
 * `step` must be a positive number. In invalid, or absent, 1 is assumed.
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
  if (
    !h ||
    typeof h !== 'string' ||
    !/^(List|Single|Pair|Triple|Tuple|)$/.test(h)
  )
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
  const def = ce.lookupFunction(expr.head);
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
