// The JavaScript lowerings of `Sort` with a sort key or a comparator, of
// `Iterate` under a consumer that bounds it, and of `Pipe`. Each compiled
// value is compared with the value of the interpreter for the same input.

import * as fs from 'fs';
import { execFileSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { TEST_PYTHON } from './test-python';
import { isLaneMismatchError } from '../../src/compute-engine/compilation/diagnostics';

type Json = any;

const ce = new ComputeEngine();
ce.declare('y', 'real');
ce.declare('L', 'list<real>');
ce.declare('n', 'real');
ce.declare('r', 'real');
ce.declare('z', 'complex');

/** The value of the compiled JavaScript of `expr` for the inputs `vars`. */
function compiled(expr: Json, vars: Record<string, unknown> = {}): unknown {
  const result: any = compile(
    ce.box(expr) as any,
    {
      to: 'javascript',
      fallback: false,
    } as any
  );
  expect(result.success).toBe(true);
  const value = result.run(vars);
  return Array.isArray(value) ? Array.from(value) : value;
}

/** The reason why the compilation of `expr` declines. */
function declined(expr: Json): string {
  try {
    const result: any = compile(
      ce.box(expr) as any,
      {
        to: 'javascript',
        fallback: false,
      } as any
    );
    return result.success ? '' : String(result.message);
  } catch (e) {
    return (e as Error).message;
  }
}

/** The interpreter's value of `expr` with `values` substituted, as numbers.
 * An absent element is `undefined` and a `NaN` element is `NaN`. */
function interpreted(
  expr: Json,
  values: Record<string, Json> = {}
): number | Array<number | undefined> {
  const value = ce.box(expr).subs(values).evaluate();
  const number = (e: any): number | undefined =>
    e.symbol === 'Missing' ? undefined : e.N().re;
  if (value.isCollection) return Array.from(value.each(), number);
  return number(value)!;
}

const key = (body: Json): Json => ['Function', body, 'x'];

/** The real and imaginary parts of a compiled value. */
function complexParts(value: any): [number, number] {
  return typeof value === 'number' ? [value, 0] : [value.re, value.im];
}

/** The lane-mismatch diagnostic of a strict compilation of `expr`, or
 * `undefined` when it compiles or declines for another reason. */
function laneMismatchOf(
  expr: Json
): { boundary?: string; binding?: string } | undefined {
  try {
    compile(
      ce.box(expr) as any,
      { to: 'javascript', fallback: false, mode: 'strict' } as any
    );
    return undefined;
  } catch (e) {
    return isLaneMismatchError(e) ? e.diagnostic : undefined;
  }
}

const comparator = (body: Json): Json => ['Function', body, 'a', 'b'];

describe('COMPILED SORT WITH A SORT KEY', () => {
  test('a key gives an ascending order of the keys', () => {
    const expr = ['Sort', ['List', 3, 'y', 2], key(['Negate', 'x'])];
    expect(interpreted(expr, { y: 5 })).toEqual([5, 3, 2]);
    expect(compiled(expr, { y: 5 })).toEqual([5, 3, 2]);
  });

  test('elements with equal keys keep their order', () => {
    const expr = ['Sort', 'L', key(['Mod', 'x', 2])];
    const L = [1, 2, 3, 4, 5, 6];
    expect(interpreted(expr, { L: ['List', ...L] })).toEqual([
      2, 4, 6, 1, 3, 5,
    ]);
    expect(compiled(expr, { L })).toEqual([2, 4, 6, 1, 3, 5]);
  });

  test('a library function as the key', () => {
    const expr = ['Sort', ['List', 3, 'y', -2], 'Abs'];
    expect(interpreted(expr, { y: -5 })).toEqual([-2, 3, -5]);
    expect(compiled(expr, { y: -5 })).toEqual([-2, 3, -5]);
  });

  test('the key is computed once for each element', () => {
    // A key that counts its calls would show a second call; the interpreter
    // decorates the elements with their keys first, and so does the
    // compiled code: the order of the keys is the order of the elements.
    const expr = ['Sort', 'L', key(['Square', 'x'])];
    const L = [-3, 1, 2, -1];
    expect(interpreted(expr, { L: ['List', ...L] })).toEqual([1, -1, 2, -3]);
    expect(compiled(expr, { L })).toEqual([1, -1, 2, -3]);
  });

  test('a NaN key sorts last, and an absent element after it', () => {
    const expr = [
      'Sort',
      ['List', 'y', 'Missing', 1, 4],
      key(['Multiply', 2, 'x']),
    ];
    expect(interpreted(expr, { y: 9 })).toEqual([1, 4, 9, undefined]);
    expect(compiled(expr, { y: 9 })).toEqual([1, 4, 9, undefined]);
    const nan = [
      'Sort',
      ['List', 'y', 'Missing', 'NaN', 1],
      key(['Negate', 'x']),
    ];
    expect(interpreted(nan, { y: 2 })).toEqual([2, 1, NaN, undefined]);
    expect(compiled(nan, { y: 2 })).toEqual([2, 1, NaN, undefined]);
  });

  test('an empty list', () => {
    // The interpreter leaves a sort of an empty list unevaluated
    // (`sortedIndicesWalk` in `library/collections.ts` answers no order for
    // zero elements), so only the compiled value is checked here.
    expect(compiled(['Sort', 'L', key(['Negate', 'x'])], { L: [] })).toEqual(
      []
    );
  });

  test('the key is typed over the elements of the source', () => {
    // The signature of `x ↦ At(x, 2)` does not know the type of `x`; called
    // with a pair of real numbers, it returns a real number.
    const expr = [
      'Sort',
      ['List', ['Tuple', 3, 'y'], ['Tuple', 1, 2], ['Tuple', 2, 0]],
      key(['At', 'x', 2]),
    ];
    expect(ce.box(expr).subs({ y: 5 }).evaluate().toString()).toBe(
      '[(2, 0),(1, 2),(3, 5)]'
    );
    expect(compiled(expr, { y: 5 })).toEqual([
      [2, 0],
      [1, 2],
      [3, 5],
    ]);
  });

  test('a key that does not return a real number declines', () => {
    expect(declined(['Sort', 'L', key(['List', 'x', 1])])).toMatch(
      /not provably a real number/
    );
    // `Sqrt` of a real number compiles to a complex value, which has no order.
    expect(declined(['Sort', 'L', 'Sqrt'])).toMatch(/complex/);
  });
});

describe('COMPILED SORT WITH A COMPARATOR', () => {
  // A declared input cannot hold an absent element (a declared type cannot
  // name `missing`, `docs/ERROR-MODEL.md`, "`Missing` is a result only"), so
  // the absent element is written in the list, and only the interpreter is
  // checked.
  test('the result type is read over the present elements', () => {
    // The comparator is never called with an absent element, so a
    // `Missing` element does not make its result `boolean | missing`.
    const expr = [
      'Sort',
      ['List', 3, 'Missing', 1, 2],
      comparator(['Greater', 'a', 'b']),
    ];
    expect(interpreted(expr, {})).toEqual([3, 2, 1, undefined]);
  });

  test('a number result: negative puts the first element first', () => {
    const expr = [
      'Sort',
      ['List', 3, 'y', 2],
      comparator(['Subtract', 'b', 'a']),
    ];
    expect(interpreted(expr, { y: 5 })).toEqual([5, 3, 2]);
    expect(compiled(expr, { y: 5 })).toEqual([5, 3, 2]);
  });

  test('a boolean result: True puts the first element first', () => {
    const expr = ['Sort', 'L', comparator(['Greater', 'a', 'b'])];
    const L = [1, 4, 2, 4, 3];
    expect(interpreted(expr, { L: ['List', ...L] })).toEqual([4, 4, 3, 2, 1]);
    expect(compiled(expr, { L })).toEqual([4, 4, 3, 2, 1]);
  });

  test('a tie keeps the order of the input', () => {
    // Compare by parity only: a zero result is a tie.
    const expr = [
      'Sort',
      'L',
      comparator(['Subtract', ['Mod', 'a', 2], ['Mod', 'b', 2]]),
    ];
    const L = [5, 2, 3, 4, 1, 6];
    expect(interpreted(expr, { L: ['List', ...L] })).toEqual([
      2, 4, 6, 5, 3, 1,
    ]);
    expect(compiled(expr, { L })).toEqual([2, 4, 6, 5, 3, 1]);
  });

  test('a NaN element and an absent element sort last, whatever the comparator', () => {
    const expr = [
      'Sort',
      ['List', 'NaN', 'y', 'Missing', 1],
      comparator(['Subtract', 'b', 'a']),
    ];
    expect(interpreted(expr, { y: 5 })).toEqual([5, 1, NaN, undefined]);
    expect(compiled(expr, { y: 5 })).toEqual([5, 1, NaN, undefined]);
  });

  test('a NaN result is a tie', () => {
    // `b - a` for two equal infinities is NaN.
    const expr = ['Sort', 'L', comparator(['Subtract', 'b', 'a'])];
    const L = [Infinity, 1, Infinity];
    expect(interpreted(expr, { L: ['List', ...L] })).toEqual([
      Infinity,
      Infinity,
      1,
    ]);
    expect(compiled(expr, { L })).toEqual([Infinity, Infinity, 1]);
  });

  test('an empty list', () => {
    expect(
      compiled(['Sort', 'L', comparator(['Subtract', 'a', 'b'])], { L: [] })
    ).toEqual([]);
  });

  test('a comparator whose result type is not settled declines', () => {
    expect(
      declined([
        'Sort',
        'L',
        comparator(['If', ['Greater', 'a', 'b'], 'True', 1]),
      ])
    ).toMatch(/not provably a\s+boolean or a number/);
  });
});

describe('COMPILED ITERATE', () => {
  const next = key(['Add', 'x', 1]);
  const doubled = key(['Multiply', 2, 'x']);

  test('`Take` of a unary function', () => {
    const expr = ['Take', ['Iterate', next, 'y'], 3];
    expect(interpreted(expr, { y: 5 })).toEqual([6, 7, 8]);
    expect(compiled(expr, { y: 5 })).toEqual([6, 7, 8]);
  });

  test('a binary function receives the 1-based index and the previous value', () => {
    const expr = [
      'Take',
      ['Iterate', ['Function', ['Add', 'n', 'x'], 'n', 'x'], 'y'],
      4,
    ];
    expect(interpreted(expr, { y: 0 })).toEqual([1, 3, 6, 10]);
    expect(compiled(expr, { y: 0 })).toEqual([1, 3, 6, 10]);
  });

  test('`TakeWhile`', () => {
    const expr = [
      'TakeWhile',
      ['Iterate', doubled, 'y'],
      key(['Less', 'x', 100]),
    ];
    expect(interpreted(expr, { y: 5 })).toEqual([10, 20, 40, 80]);
    expect(compiled(expr, { y: 5 })).toEqual([10, 20, 40, 80]);
  });

  test('the elements have the result type of the function', () => {
    // The initial value is real, but it is not an element: every element is
    // a result of the function, an integer, so a callback over the elements
    // can declare an integer parameter.
    const step = [
      'Function',
      ['Add', ['Floor', 'x'], 1],
      ['Typed', 'x', { str: 'real' }],
    ];
    const expr = [
      'TakeWhile',
      ['Iterate', step, 'y'],
      ['Function', ['Less', 'n', 5], ['Typed', 'n', { str: 'integer' }]],
    ];
    expect(interpreted(expr, { y: 1.5 })).toEqual([2, 3, 4]);
    expect(compiled(expr, { y: 1.5 })).toEqual([2, 3, 4]);
  });

  test('`First` and `At` with a constant index', () => {
    const first = ['First', ['Iterate', doubled, 'y']];
    expect(interpreted(first, { y: 3 })).toBe(6);
    expect(compiled(first, { y: 3 })).toBe(6);
    const at = ['At', ['Iterate', doubled, 'y'], 4];
    expect(interpreted(at, { y: 3 })).toBe(48);
    expect(compiled(at, { y: 3 })).toBe(48);
  });

  test('`Drop` and `Rest` stages', () => {
    const drop = ['Take', ['Drop', ['Iterate', next, 'y'], 2], 3];
    expect(interpreted(drop, { y: 0 })).toEqual([3, 4, 5]);
    expect(compiled(drop, { y: 0 })).toEqual([3, 4, 5]);
    const rest = ['First', ['Rest', ['Iterate', next, 'y']]];
    expect(interpreted(rest, { y: 0 })).toBe(2);
    expect(compiled(rest, { y: 0 })).toBe(2);
  });

  test('`First` and `At` over an infinite range', () => {
    const map = ['Map', key(['Multiply', 'x', 'y']), ['Range', 1, Infinity]];
    expect(interpreted(['First', map], { y: 5 })).toBe(5);
    expect(compiled(['First', map], { y: 5 })).toBe(5);
    expect(interpreted(['At', map, 3], { y: 5 })).toBe(15);
    expect(compiled(['At', map, 3], { y: 5 })).toBe(15);
  });

  test('an unbounded sequence declines', () => {
    expect(declined(['Iterate', next, 'y'])).toMatch(
      /compiles only under a consumer\s+that bounds it/
    );
    expect(declined(['At', ['Iterate', next, 'y'], -1])).toMatch(
      /constant positive\s+integer index only/
    );
  });

  test('a sequence with no initial value declines', () => {
    // The first call receives `Nothing`. A function that reads the input
    // `y` keeps the read from being folded at compile time.
    expect(declined(['At', ['Iterate', key(['Add', 'x', 'y'])], 2])).toMatch(
      /Nothing/
    );
  });

  test('a function that is not pure declines', () => {
    // The interpreter computes the elements before a position again for
    // each read: with a counter `c`, `Take(Iterate(x ↦ Block(c ≔ c + 1, c),
    // 0), 3)` is `[1, 3, 6]` there, and a stream gives `[1, 2, 3]`.
    const engine = new ComputeEngine();
    engine.declare('c', 'integer');
    const counter = [
      'Function',
      ['Block', ['Assign', 'c', ['Add', 'c', 1]], 'c'],
      'x',
    ];
    const result = (() => {
      try {
        compile(
          engine.box(['Take', ['Iterate', counter, 0], 3]) as any,
          {
            to: 'javascript',
            fallback: false,
          } as any
        );
        return '';
      } catch (e) {
        return (e as Error).message;
      }
    })();
    expect(result).toMatch(/not pure/);
    expect(
      declined(['Take', ['Iterate', key(['Add', 'x', ['Random']]), 0], 3])
    ).toMatch(/not pure/);
  });

  test('a function that is complex at a later step declines', () => {
    // `Arcsin(0.5) + 1` is real; `Arcsin` of that value is complex.
    expect(
      interpreted(['At', ['Iterate', key(['Add', ['Arcsin', 'x'], 1]), 0.5], 1])
    ).toBeCloseTo(Math.asin(0.5) + 1);
    expect(
      declined(['Take', ['Iterate', key(['Add', ['Arcsin', 'x'], 1]), 0.5], 3])
    ).toMatch(/complex value/);
    expect(
      declined(['At', ['Iterate', key(['Multiply', 2, ['Arccos', 'x']]), 1], 3])
    ).toMatch(/complex value/);
  });

  test('an annotation of the parameter is checked against the type of the accumulator', () => {
    const engine = new ComputeEngine();
    engine.declare('n', 'integer');
    const step = ['Function', ['Add', 'x', 1], ['Typed', 'x', "'integer'"]];
    const expr = engine.box(['Take', ['Iterate', step, 'n'], 3]);
    expect(
      Array.from(expr.subs({ n: 2 }).evaluate().each(), (e) => e.re)
    ).toEqual([3, 4, 5]);
    const result: any = compile(expr as any, { fallback: false } as any);
    expect(Array.from(result.run({ n: 2 }))).toEqual([3, 4, 5]);
  });

  test('`At` far into an infinite range does not step through it', () => {
    const at = ['At', ['Range', 'y', Infinity, 2], 1e9];
    expect(interpreted(at, { y: 5 })).toBe(2000000003);
    expect(compiled(at, { y: 5 })).toBe(2000000003);
    const map = [
      'At',
      ['Map', key(['Multiply', 'x', 'y']), ['Range', 1, Infinity]],
      1e9,
    ];
    expect(compiled(map, { y: 2 })).toBe(2e9);
  });

  test('a sequence of lists declines', () => {
    const swap = key(['List', ['At', 'x', 2], ['At', 'x', 1]]);
    expect(declined(['Take', ['Iterate', swap, ['List', 'y', 1]], 3])).toMatch(
      /only a sequence of real numbers compiles/
    );
  });
});

describe('COMPILED PIPE', () => {
  test('a stage that is a call missing one argument', () => {
    const map = ['Pipe', ['List', 1, 'y'], ['Map', key(['Multiply', 2, 'x'])]];
    expect(interpreted(map, { y: 5 })).toEqual([2, 10]);
    expect(compiled(map, { y: 5 })).toEqual([2, 10]);
    // The piped value takes the FIRST slot of `Take`, whose second slot is
    // the count.
    const take = ['Pipe', ['List', 1, 'y', 3], ['Take', 2]];
    expect(interpreted(take, { y: 5 })).toEqual([1, 5]);
    expect(compiled(take, { y: 5 })).toEqual([1, 5]);
  });

  test('a stage that is a function literal maps over a list', () => {
    const expr = ['Pipe', ['List', 1, 'y'], key(['Multiply', 2, 'x'])];
    expect(interpreted(expr, { y: 5 })).toEqual([2, 10]);
    expect(compiled(expr, { y: 5 })).toEqual([2, 10]);
  });

  test('a stage that is the name of an operator', () => {
    const sort = ['Pipe', ['List', 3, 'y', 2], 'Sort'];
    expect(interpreted(sort, { y: 5 })).toEqual([2, 3, 5]);
    expect(compiled(sort, { y: 5 })).toEqual([2, 3, 5]);
    const sqrt = ['Pipe', 'y', 'Sqrt'];
    expect(interpreted(sqrt, { y: 16 })).toBe(4);
    expect(compiled(sqrt, { y: 16 })).toBe(4);
  });

  test('a stage that is the name of a function of the user', () => {
    const engine = new ComputeEngine();
    engine.declare('y', 'real');
    engine.assign('g', engine.box(['Function', ['Multiply', 3, 'x'], 'x']));
    const expr = engine.box(['Pipe', 'y', 'g']);
    expect(expr.subs({ y: 5 }).evaluate().re).toBe(15);
    const result: any = compile(expr as any, { fallback: false } as any);
    expect(result.run({ y: 5 })).toBe(15);
  });

  test('a chain of stages', () => {
    const expr = [
      'Pipe',
      ['Pipe', ['List', 1, 'y', 3], ['Take', 2]],
      key(['Multiply', 2, 'x']),
    ];
    expect(interpreted(expr, { y: 5 })).toEqual([2, 10]);
    expect(compiled(expr, { y: 5 })).toEqual([2, 10]);
  });

  test('a pipe read from LaTeX', () => {
    for (const [latex, expected] of [
      [String.raw`[1, y] \rhd \mathrm{Map}(x \mapsto 2x)`, [2, 10]],
      [String.raw`[3, y, 2] \rhd \mathrm{Sort}`, [2, 3, 5]],
    ] as const) {
      const expr = ce.parse(latex);
      expect(
        Array.from(expr.subs({ y: 5 }).evaluate().each(), (e) => e.re)
      ).toEqual(expected);
      const result: any = compile(expr as any, { fallback: false } as any);
      expect(Array.from(result.run({ y: 5 }))).toEqual(expected);
    }
  });

  test('a call stage after a chained pipe whose static type settles the slot', () => {
    const map = [
      'Pipe',
      ['Pipe', ['List', 1, 'y', 3], ['Take', 2]],
      ['Map', key(['Multiply', 2, 'x'])],
    ];
    expect(interpreted(map, { y: 5 })).toEqual([2, 10]);
    expect(compiled(map, { y: 5 })).toEqual([2, 10]);
    // The count slot of `Take` admits no list, so the sorted list takes the
    // first slot whatever its value.
    const take = ['Pipe', ['Pipe', 'L', 'Sort'], ['Take', 2]];
    expect(interpreted(take, { L: ['List', 3, 1, 2] })).toEqual([1, 2]);
    expect(compiled(take, { L: [3, 1, 2] })).toEqual([1, 2]);
  });

  test('a call stage after a chained pipe whose static type does not settle the slot declines', () => {
    // The inner pipe is a real number, which the count slot of `Take`
    // admits when its value is an integer: the interpreter selects the slot
    // from that value.
    expect(declined(['Pipe', ['Pipe', 'y', 'Abs'], ['Take', 2]])).toMatch(
      /is not a call missing one/
    );
  });

  test('a stage with its own slot is lifted to a literal and applied', () => {
    // The interpreter lifts `Take(_, 2)` to `_1 ↦ Take(_1, 2)` and applies
    // it to the piped value. The slots of the stage are not inputs.
    const take = ['Pipe', 'L', ['Take', '_', 2]];
    expect(interpreted(take, { L: ['List', 3, 1, 2] })).toEqual([3, 1]);
    expect(compiled(take, { L: [3, 1, 2] })).toEqual([3, 1]);
    const add = ['Pipe', 'y', ['Add', '_1', 'n']];
    expect(interpreted(add, { y: 5, n: 2 })).toBe(7);
    expect(compiled(add, { y: 5, n: 2 })).toBe(7);
    // The one slot of the stage is its parameter, whatever its number.
    const second = ['Pipe', 'y', ['Add', '_2', 1]];
    expect(interpreted(second, { y: 5 })).toBe(6);
    expect(compiled(second, { y: 5 })).toBe(6);
  });

  test('a lifted or literal stage binds a list whole with its type', () => {
    // The parameter of the applied literal takes the type of the list, so
    // the `Max` of the body reduces the list, as in the interpreter.
    for (const stage of [['Max', '_'], key(['Max', 'x'])]) {
      const expr = ['Pipe', 'L', stage];
      expect(interpreted(expr, { L: ['List', 3, 1, 2] })).toBe(3);
      expect(compiled(expr, { L: [3, 1, 2] })).toBe(3);
    }
  });

  test('a stage with two slots declines', () => {
    // The stage lifts to a literal with two parameters, and the interpreter
    // gives a partial application, a function.
    const expr = ['Pipe', 'y', ['Add', '_1', '_2']];
    expect(ce.box(expr).subs({ y: 5 }).evaluate().operator).toBe('Function');
    expect(declined(expr)).toMatch(/is not a call missing one/);
  });

  test('a chained pipe is evaluated once, before the stage', () => {
    // The stage `x ↦ 0` never reads `x`, but the interpreter evaluates the
    // inner pipe before it applies the stage, so the assignment runs. Each
    // route has an engine of its own: the interpreter assigns `c`.
    const expr = [
      'Block',
      ['Assign', 'c', 0],
      [
        'Pipe',
        ['Pipe', ['Assign', 'c', ['Add', 'c', 1]], 'Abs'],
        ['Function', 0, 'x'],
      ],
      'c',
    ];
    const engine = (): ComputeEngine => {
      const e = new ComputeEngine();
      e.declare('c', 'integer');
      return e;
    };
    expect(engine().box(expr).evaluate().re).toBe(1);
    const result: any = compile(
      engine().box(expr) as any,
      { to: 'javascript', fallback: false } as any
    );
    expect(result.success).toBe(true);
    expect(result.run({})).toBe(1);
  });

  test('a call stage after a chained pipe that admits the value in one slot only', () => {
    // Every other slot of every signature of the operator is checked, not
    // only the later ones. `Map` takes the list in one slot and a function
    // in the other.
    const expr = [
      'Pipe',
      ['Pipe', 'L', 'Sort'],
      ['Map', key(['Multiply', 2, 'x'])],
    ];
    expect(interpreted(expr, { L: ['List', 3, 1, 2] })).toEqual([2, 4, 6]);
    expect(compiled(expr, { L: [3, 1, 2] })).toEqual([2, 4, 6]);
  });

  test('a literal stage after a chained pipe reads its scalar type', () => {
    // The inner pipe is lowered first, so the applied literal needs no
    // run-time test of an array.
    const expr = ['Pipe', ['Pipe', 'y', 'Abs'], ['Multiply', '_', 2]];
    expect(interpreted(expr, { y: -4 })).toBe(8);
    expect(compiled(expr, { y: -4 })).toBe(8);
    const result: any = compile(
      ce.box(expr) as any,
      { to: 'javascript', fallback: false } as any
    );
    expect(result.code).not.toMatch(/Array\.isArray/);
    // The inner lifted stage lowers to `Apply(_1 ↦ _1 + 1, y)`, an
    // application of a literal with a scalar body to a scalar, which is a
    // scalar: the outer application needs no run-time test either.
    const twice = [
      'Pipe',
      ['Pipe', 'y', ['Add', '_', 1]],
      ['Multiply', '_', 2],
    ];
    expect(interpreted(twice, { y: 4 })).toBe(10);
    expect(compiled(twice, { y: 4 })).toBe(10);
    const twiceResult: any = compile(
      ce.box(twice) as any,
      { to: 'javascript', fallback: false } as any
    );
    expect(twiceResult.code).not.toMatch(/Array\.isArray/);
  });

  test('an application of a literal whose body is a list is not a scalar', () => {
    // `x ↦ [x, x]` returns a list, so the application that receives it maps
    // over it, as in the interpreter.
    const expr = [
      'Apply',
      key(['Multiply', 'x', 2]),
      ['Apply', key(['List', 'x', 'x']), 'y'],
    ];
    expect(interpreted(expr, { y: 4 })).toEqual([8, 8]);
    expect(compiled(expr, { y: 4 })).toEqual([8, 8]);
    const sum = ['Add', 1, ['Apply', key(['List', 'x', 'x']), 'y']];
    expect(interpreted(sum, { y: 4 })).toEqual([5, 5]);
    expect(compiled(sum, { y: 4 })).toEqual([5, 5]);
  });

  test('a complex argument of an applied literal recompiles in complex mode', () => {
    // `√y` is complex for a negative `y`, and the literal compiles its
    // parameter in the real lane. The default mode ('auto') declines the
    // real-lane compilation with a lane mismatch and compiles the whole
    // expression again in 'complex' mode.
    for (const expr of [
      ['Apply', key(['Multiply', 'x', 2]), ['Sqrt', 'y']],
      ['Pipe', ['Sqrt', 'y'], ['Multiply', '_', 2]],
      ['Pipe', ['Sqrt', 'y'], key(['Multiply', 'x', 2])],
    ]) {
      expect(interpreted(expr, { y: 4 })).toBe(4);
      expect(ce.box(expr).subs({ y: -4 }).evaluate().im).toBe(4);
      for (const mode of [undefined, 'auto', 'complex']) {
        const result: any = compile(
          ce.box(expr) as any,
          { to: 'javascript', fallback: false, mode } as any
        );
        expect(result.success).toBe(true);
        expect(result.mode).toBe('complex');
        expect(complexParts(result.run({ y: 4 }))).toEqual([4, 0]);
        expect(complexParts(result.run({ y: -4 }))).toEqual([0, 4]);
      }
    }
  });

  test('in strict mode, a complex argument of an applied literal declines', () => {
    const expr = ['Apply', key(['Multiply', 'x', 2]), 'z'];
    const d = laneMismatchOf(expr);
    expect(d?.boundary).toBe('applied function-literal parameter');
    expect(d?.binding).toBe('the parameter `x` of the function literal');
    const result: any = compile(
      ce.box(expr) as any,
      { to: 'javascript', mode: 'strict' } as any
    );
    expect(result.success).toBe(false);
    expect(result.diagnostic?.code).toBe('lane-mismatch');
    // Strict mode keeps `√y` in the real lane, as for a call of a named
    // function: the argument is a real number (`NaN` for a negative `y`),
    // and the literal compiles.
    const sqrt: any = compile(
      ce.box(['Apply', key(['Multiply', 'x', 2]), ['Sqrt', 'y']]) as any,
      { to: 'javascript', fallback: false, mode: 'strict' } as any
    );
    expect(sqrt.success).toBe(true);
    expect(sqrt.run({ y: 4 })).toBe(4);
    expect(sqrt.run({ y: -4 })).toBeNaN();
  });

  test('a real-only body with a complex argument', () => {
    // `Mod` has no complex lane. In strict mode, the reason of the decline
    // is the lane mismatch at the parameter, which the generation of the
    // code finds before the check of the shapes of the assigned names.
    expect(laneMismatchOf(['Apply', key(['Mod', 'x', 3]), 'z'])?.boundary).toBe(
      'applied function-literal parameter'
    );
  });

  test('a parameter declared complex takes a real or a complex argument', () => {
    const expr = [
      'Add',
      1,
      [
        'Apply',
        [
          'Function',
          'w',
          ['Typed', 'x', { str: 'complex' }],
          ['Typed', 'w', { str: 'complex' }],
        ],
        'ImaginaryUnit',
        'r',
      ],
    ];
    expect(interpreted(expr, { r: 2 })).toBe(3);
    // No lane mismatch: both parameters are in the complex lane.
    expect(laneMismatchOf(expr)).toBeUndefined();
    const result: any = compile(
      ce.box(expr) as any,
      { to: 'javascript', fallback: false, mode: 'complex' } as any
    );
    expect(result.success).toBe(true);
    expect(complexParts(result.run({ r: 2 }))).toEqual([3, 0]);
  });

  test('a nested list of complex numbers at a real-lane parameter', () => {
    // The call maps over the nested lists and hands the body one complex
    // number at a time, so the argument is complex-shaped, for an applied
    // literal and for a user function alike.
    ce.declare('CM', 'list<list<complex>>');
    ce.declare('RR', 'list<list<real>>');
    ce.assign('dbl', ce.box(['Function', ['Multiply', 'x', 2], 'x']));
    const parts = (v: any): any =>
      Array.isArray(v) ? v.map(parts) : complexParts(v);
    const nested = (v: any): any =>
      v.isCollection ? Array.from(v.each(), nested) : [v.N().re, v.N().im];
    const value = {
      CM: [
        [
          { re: 1, im: 1 },
          { re: 0, im: 2 },
        ],
        [{ re: 3, im: 0 }],
      ],
      RR: [[1, 2], [3]],
    };
    const boxed = {
      CM: ce.box([
        'List',
        ['List', ['Complex', 1, 1], ['Complex', 0, 2]],
        ['List', 3],
      ]),
      RR: ce.box(['List', ['List', 1, 2], ['List', 3]]),
    };
    for (const callee of [key(['Multiply', 'x', 2]), 'dbl']) {
      const apply = (arg: string) =>
        callee === 'dbl' ? ['dbl', arg] : ['Apply', callee, arg];
      for (const arg of ['CM', 'RR']) {
        const expected = nested(ce.box(apply(arg)).subs(boxed).evaluate());
        const auto: any = compile(
          ce.box(apply(arg)) as any,
          { to: 'javascript', fallback: false } as any
        );
        expect(auto.success).toBe(true);
        expect(auto.mode).toBe(arg === 'CM' ? 'complex' : 'strict');
        expect(parts(auto.run(value))).toEqual(expected);
      }
      expect(laneMismatchOf(apply('CM'))?.boundary).toBe(
        callee === 'dbl'
          ? 'user-function parameter'
          : 'applied function-literal parameter'
      );
      // A nested list of real numbers compiles in strict mode as before.
      expect(laneMismatchOf(apply('RR'))).toBeUndefined();
      const strict: any = compile(
        ce.box(apply('RR')) as any,
        { to: 'javascript', fallback: false, mode: 'strict' } as any
      );
      expect(strict.run(value)).toEqual([[2, 4], [6]]);
    }
  });

  test('a real argument of an applied literal compiles in strict mode', () => {
    const expr = ['Apply', key(['Multiply', 'x', 2]), 'y'];
    const strict: any = compile(
      ce.box(expr) as any,
      { to: 'javascript', fallback: false, mode: 'strict' } as any
    );
    const auto: any = compile(
      ce.box(expr) as any,
      { to: 'javascript', fallback: false } as any
    );
    expect(strict.success).toBe(true);
    expect(auto.mode).not.toBe('complex');
    expect(auto.code).toBe(strict.code);
    expect(strict.run({ y: 3 })).toBe(6);
  });

  test('an argument whose call-site type is a scalar that can be complex', () => {
    // The call `gc(y)` has the type `any`, but the variant of `gc` for a
    // real argument gives a number, so the call is emitted as a direct call
    // and its complex value reaches the parameter. The check reads the type
    // at the call site, for an applied literal and for a user function.
    ce.declare('gc', '(real) -> any');
    ce.assign(
      'gc',
      ce.box([
        'Function',
        ['Block', ['Assign', 'w', ['Add', 'u', 'ImaginaryUnit']], 'w'],
        'u',
      ])
    );
    ce.assign('dbl2', ce.box(['Function', ['Multiply', 't', 2], 't']));
    for (const expr of [
      ['Apply', ['Function', ['Multiply', 2, 't'], 't'], ['gc', 'y']],
      ['dbl2', ['gc', 'y']],
    ]) {
      const value = ce.box(expr).subs({ y: 3 }).evaluate().N();
      expect([value.re, value.im]).toEqual([6, 2]);
      const auto: any = compile(
        ce.box(expr) as any,
        { to: 'javascript', fallback: false } as any
      );
      expect(auto.success).toBe(true);
      expect(auto.mode).toBe('complex');
      expect(complexParts(auto.run({ y: 3 }))).toEqual([6, 2]);
      expect(complexParts(auto.run({ y: -1 }))).toEqual([-2, 2]);
      const strict: any = compile(
        ce.box(expr) as any,
        { to: 'javascript', mode: 'strict' } as any
      );
      expect(strict.success).toBe(false);
      expect(strict.diagnostic?.code).toBe('lane-mismatch');
    }
  });

  test('a point with a complex coordinate at an applied literal declines', () => {
    // The point is passed whole, and the compiled literal would read it as
    // one number (`{re: NaN, im: NaN}`). The application declines, and the
    // fallback gives the interpreter's value.
    const tuple = ['Tuple', ['Add', 'y', 'ImaginaryUnit'], 1];
    const one = ['Apply', ['Function', ['Multiply', 2, 't'], 't'], tuple];
    const value = ce.box(one).subs({ y: 3 }).evaluate();
    expect(value.ops!.map((c) => [c.N().re, c.N().im])).toEqual([
      [6, 2],
      [2, 0],
    ]);
    const two = [
      'Apply',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      tuple,
      'y',
    ];
    for (const expr of [one, two]) {
      for (const mode of [undefined, 'auto', 'strict']) {
        const result: any = compile(
          ce.box(expr) as any,
          { to: 'javascript', mode } as any
        );
        expect(result.success).toBe(false);
      }
    }
    const fallback: any = compile(ce.box(one) as any, { to: 'javascript' } as any);
    const run = fallback.run({ y: 3 });
    expect(Array.from(run, (c: any) => complexParts(c))).toEqual([
      [6, 2],
      [2, 0],
    ]);
  });

  describe('a point with a complex coordinate at a declared point parameter', () => {
    // `P` has a complex first coordinate. The literal reads `p[1]` in the
    // lane of the declared type of `p` at that position: a position typed
    // `number` is read as a real number, so the complex coordinate is a
    // lane mismatch, as for a call of a named function. Without the check,
    // the compiled code added `1` to a `{ re, im }` object and gave the
    // string "[object Object]1".
    ce.declare('P', 'tuple<complex, real>');
    const P = ce.box(['Tuple', ['Complex', 1, 1], 2]);
    const jsP = [{ re: 1, im: 1 }, 2];
    const literal = (param: Json): Json => [
      'Apply',
      ['Function', ['Add', ['At', 'p', 1], 1], param],
      'P',
    ];
    const expected = (expr: Json): [number, number] => {
      const value = ce.box(expr).subs({ P }).evaluate().N();
      return [value.re, value.im];
    };

    test('a position typed `number`: auto compiles in complex mode, strict declines', () => {
      const expr = literal(['Typed', 'p', "'tuple<number, real>'"]);
      expect(expected(expr)).toEqual([2, 1]);
      const auto: any = compile(
        ce.box(expr) as any,
        { to: 'javascript', fallback: false } as any
      );
      expect(auto.success).toBe(true);
      expect(auto.mode).toBe('complex');
      expect(complexParts(auto.run({ P: jsP }))).toEqual([2, 1]);
      const d = laneMismatchOf(expr);
      expect(d?.boundary).toBe('applied function-literal parameter');
      expect(d?.binding).toBe('the parameter `p` of the function literal');
    });

    test('a position typed `complex` compiles in both modes', () => {
      const expr = literal(['Typed', 'p', "'tuple<complex, real>'"]);
      expect(expected(expr)).toEqual([2, 1]);
      for (const mode of [undefined, 'strict']) {
        const result: any = compile(
          ce.box(expr) as any,
          { to: 'javascript', fallback: false, mode } as any
        );
        expect(result.success).toBe(true);
        expect(result.mode).toBe('strict');
        expect(complexParts(result.run({ P: jsP }))).toEqual([2, 1]);
      }
    });

    test('a parameter with no type', () => {
      // The parameter has no declared type, so the point test does not
      // apply. The compiled literal reads the coordinate as it is, and
      // the value agrees with the interpreter in both modes.
      const expr = literal('p');
      expect(expected(expr)).toEqual([2, 1]);
      for (const mode of [undefined, 'strict']) {
        const result: any = compile(
          ce.box(expr) as any,
          { to: 'javascript', fallback: false, mode } as any
        );
        expect(result.success).toBe(true);
        expect(complexParts(result.run({ P: jsP }))).toEqual([2, 1]);
      }
    });
  });

  test('other targets: an applied literal with a complex argument', () => {
    // The lane-mismatch check is for the JavaScript target only.
    const expr = ['Apply', key(['Multiply', 'x', 2]), ['Sqrt', 'y']];
    for (const to of ['interval-javascript', 'glsl']) {
      for (const mode of ['strict', undefined]) {
        let message = '';
        try {
          const r: any = compile(
            ce.box(expr) as any,
            { to, fallback: false, mode } as any
          );
          message = r.success ? '' : String(r.message ?? r.error);
        } catch (e) {
          message = (e as Error).message;
        }
        expect(message).not.toMatch(/function-literal parameter/);
      }
    }
  });

  test('a free slot outside a stage is still an input with no type', () => {
    const expr = ['List', '_', ['Pipe', 'y', ['Add', '_', 1]]];
    expect(declined(expr)).toMatch(/the input `_` has no type/);
  });

  const python = TEST_PYTHON ?? '';
  const pythonTest = fs.existsSync(python) ? test : test.skip;

  pythonTest('Python: a call stage, an operator stage, a lifted stage', () => {
    const map = ['Pipe', ['List', 1, 2], ['Map', key(['Multiply', 2, 'x'])]];
    const sort = ['Pipe', ['List', 3, 1, 2], 'Sort'];
    const take = ['Pipe', ['List', 3, 1, 2], ['Take', '_', 2]];
    const lines = [map, sort, take].map((expr) => {
      const result: any = compile(
        ce.box(expr) as any,
        {
          to: 'python',
          fallback: false,
        } as any
      );
      expect(result.success).toBe(true);
      return result.code;
    });
    const file = path.join(
      os.tmpdir(),
      `ce-py-pipe-${process.pid}-${Math.random().toString(36).slice(2)}.py`
    );
    fs.writeFileSync(
      file,
      ['import json', `print(json.dumps([${lines.join(', ')}]))`].join('\n')
    );
    try {
      expect(
        JSON.parse(execFileSync(python, [file], { encoding: 'utf8' }))
      ).toEqual([
        [2, 4],
        [1, 2, 3],
        [3, 1],
      ]);
    } finally {
      fs.unlinkSync(file);
    }
  });
});
