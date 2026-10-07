import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A lazy collection (`filter`, `map`, `rest`, …) reads the names of its
// operands when its elements are read. When it is passed as an ARGUMENT to a
// call, its elements are read in the frame of the callee, which chains to the
// scope where the callee was defined, not to the caller. These programs check
// that the argument keeps the bindings it had in the caller: the parameters
// and the `let` locals that its operands and its predicate read.
//
// The first programs are the recursive shapes that gave an unevaluated
// `If(Length(Filter(…, (x) => x < p)) …)` with a free `p`, or a lazy view
// that read the callee's own parameter.
//

function run(source: string): {
  value: Expression;
  diagnostics: ReturnType<typeof executeEpsil>['diagnostics'];
} {
  const ce = new ComputeEngine();
  const parseLatex = (latex: string): MathJsonExpression =>
    ce.parse(latex).json;
  const { value, diagnostics } = executeEpsil(ce, source, { parseLatex });
  return { value, diagnostics };
}

/** The elements of a collection value, enumerated (a lazy collection prints
 * as a preview with `...` or as its recipe). */
function elements(value: Expression): string {
  return `[${[...value.each()].map((x) => x.toString()).join(', ')}]`;
}

describe('LAZY ARGUMENT CAPTURE — recursive calls', () => {
  test('a lazy filter passed to a recursive call reads the block local of its caller', () => {
    const { value, diagnostics } = run(`
smallest(xs: list<number>) =
  xs if length(xs) <= 1 else do {
    let p = first(xs)
    smallest(filter(rest(xs), x => x < p))
  }
smallest([3, 1, 2])`);
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[]');
  });

  test('the same program with more levels of recursion', () => {
    const { value, diagnostics } = run(`
smallest(xs) =
  xs if length(xs) <= 1 else do {
    let p = first(xs)
    smallest(filter(rest(xs), x => x > p))
  }
smallest([1, 3, 2, 5, 4])`);
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[]');
  });

  test('a quicksort over lazy partitions', () => {
    const { value, diagnostics } = run(`
quicksort(xs) =
  xs if length(xs) <= 1 else do {
    let pivot = first(xs)
    let others = rest(xs)
    [...quicksort(filter(others, x => x < pivot)), pivot, ...quicksort(filter(others, x => x >= pivot))]
  }
quicksort([3, 1, 4, 1, 5, 9, 2, 6, 5, 3, 5])`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[1, 1, 2, 3, 3, 4, 5, 5, 5, 6, 9]');
  });

  test('a predicate that reads a parameter of the caller', () => {
    // `first(xs)` in the predicate is the `xs` of the call that made the
    // filter, not the `xs` of the callee (which is the filter itself).
    const { value, diagnostics } = run(`
f(xs) = xs if length(xs) <= 1 else f(filter(rest(xs), x => x > first(xs)))
f([1, 3, 2, 5, 4])`);
    expect(diagnostics).toEqual([]);
    expect(value.toString()).toBe('[]');
  });

  test('a lazy argument that reads a body local of the caller', () => {
    // `map(x => x * 2, t)` reads the caller's `t`; the callee declares its
    // own `t` from the argument. Three levels double three times.
    const { value, diagnostics } = run(`
f(n, s) = do { let t = s; take(t, 2) if n == 0 else f(n - 1, map(x => x * 2, t)) }
f(3, 1..oo)`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[8, 16]');
  });
});

describe('LAZY ARGUMENT CAPTURE — function literal arguments', () => {
  test('a function literal passed to a recursive call reads the parameter of its creator', () => {
    // The literal made by the call with `n = 1` is the one applied at the
    // end, so it returns 1.
    const { value, diagnostics } = run(`
f(n, g) = g(0) if n == 0 else f(n - 1, x => n)
f(3, x => 99)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('the same through a local of the block', () => {
    const { value, diagnostics } = run(`
f(n, g) = do { let m = n; g(0) if n == 0 else f(n - 1, x => m) }
f(3, x => 99)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('mutual recursion', () => {
    // `even` makes a new literal at each of its calls; the last one is made
    // by the call with `xs = [3, 4]`.
    const { value, diagnostics } = run(`
even(xs, g) = g(0) if length(xs) == 0 else odd(rest(xs), x => length(xs))
odd(xs, g) = g(0) if length(xs) == 0 else even(rest(xs), g)
even([1, 2, 3, 4], x => 99)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(2);
  });

  test('a hold function that forwards its held argument to itself', () => {
    const { value, diagnostics } = run(`
hold f(e, n) = e if n == 0 else f(e + n, n - 1)
f(10, 2)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(13);
  });
});

describe('LAZY ARGUMENT CAPTURE — non-recursive calls', () => {
  test('a helper function receives a lazy filter whose predicate reads a block local', () => {
    const { value, diagnostics } = run(`
count(ys) = length(ys)
below(xs, k) = do { let p = k; count(filter(xs, x => x < p)) }
below([5, 1, 4, 2, 3], 3)`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(2);
  });

  test('the source of the lazy argument is a parameter of the caller', () => {
    const { value, diagnostics } = run(`
g(ys) = length(ys)
h(xs) = g(filter(xs, x => x < 2))
h([1, 2, 3])`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('the callee declares a local with the name that the argument reads', () => {
    const { value, diagnostics } = run(`
let t = 1..oo
g(s) = do { let t = s; take(t, 2) }
g(map(x => x * 2, t))`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[2, 4]');
  });

  test('a lazy filter returned from a block in a branch keeps the block local', () => {
    const { value, diagnostics } = run(`
h(xs) = xs if length(xs) > 5 else do { let p = 2; filter(xs, x => x < p) }
h([1, 2, 3])`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[1]');
  });
});

describe('LAZY ARGUMENT CAPTURE — names that the callee binds', () => {
  // In each program, the lazy argument reads the top-level `t`, and the
  // callee binds a name `t` of its own that is in scope where the argument
  // is read. The argument must read the top-level `t`, so `take(s, 2)` is
  // `[2, 4]`.

  test('a leaf of a destructuring local of the callee', () => {
    const { value, diagnostics } = run(`
let t = 1..oo
g(s) = do { let (t, u) = (5, 0); take(s, 2) }
g(map(x => x * 2, t))`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[2, 4]');
  });

  test('a function that the callee defines locally', () => {
    const { value, diagnostics } = run(`
let t = 1..oo
g(s) = do { t(k) = k + 100; take(s, 2) }
g(map(x => x * 2, t))`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[2, 4]');
  });

  test('the variable of a loop of the callee', () => {
    // Each of the two iterations adds `first(s)`, that is 2.
    const { value, diagnostics } = run(`
let t = [1, 2, 3]
g(s) = do { let r = 0; for t in [10, 20] { r = r + first(s) }; r }
g(map(x => x * 2, t))`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(4);
  });

  test('the index of a comprehension of the callee', () => {
    const { value, diagnostics } = run(`
let t = [1, 2, 3]
g(s) = [first(s) for t in [10, 20]]
g(map(x => x * 2, t))`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[2, 2]');
  });
});

describe('LAZY ARGUMENT CAPTURE — arguments with no lazy collection', () => {
  // A long list with no lazy collection and no function literal is passed
  // unchanged to each call, and is not walked again at each call. The time
  // bound is large: each call also infers the type of the list when it binds
  // the parameter, which is proportional to the length of the list. The bound
  // catches a walk that rebuilds the list at each call.
  const strings = Array.from({ length: 3000 }, (_, i) => `"s${i}"`).join(', ');

  test('a recursion of depth 200 that passes a list of 3000 strings', () => {
    const start = Date.now();
    const { value, diagnostics } = run(`
f(xs, n) = length(xs) if n == 0 else f(xs, n - 1)
f([${strings}], 200)`);
    const elapsed = Date.now() - start;
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(3000);
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(10000);
  });

  test('the same recursion, which also passes a new function literal', () => {
    const start = Date.now();
    const { value, diagnostics } = run(`
f(xs, g, n) = g(length(xs)) if n == 0 else f(xs, k => k + n, n - 1)
f([${strings}], k => k, 200)`);
    const elapsed = Date.now() - start;
    expect(diagnostics).toEqual([]);
    // The literal made by the call with `n = 1` is the one applied.
    expect(value.re).toBe(3001);
    if (process.env.CE_PERF === '1') expect(elapsed).toBeLessThan(10000);
  });
});

describe('LAZY ARGUMENT CAPTURE — dictionaries', () => {
  test('a lazy filter in a dictionary literal passed to a call', () => {
    const { value, diagnostics } = run(`
g(d) = length(d["a"])
h(xs) = xs if length(xs) > 5 else do { let p = 2; g({"a" -> filter(xs, x => x < p)}) }
h([1, 2, 3])`);
    expect(diagnostics).toEqual([]);
    expect(value.re).toBe(1);
  });

  test('a lazy filter stored in a dictionary, then passed to a call', () => {
    const { value, diagnostics } = run(`
g(d) = d["a"]
h(xs) = xs if length(xs) > 5 else do { let p = 2; let d = {"a" -> filter(xs, x => x < p)}; g(d) }
h([1, 2, 3])`);
    expect(diagnostics).toEqual([]);
    expect(elements(value)).toBe('[1]');
  });
});

describe('LAZY ARGUMENT CAPTURE — MathJSON route', () => {
  test('the recursive program, boxed', () => {
    const ce = new ComputeEngine();
    const program: MathJsonExpression = [
      'Block',
      [
        'DefineFunction',
        'smallest',
        [
          'Function',
          [
            'If',
            ['LessEqual', ['Length', 'xs'], 1],
            'xs',
            [
              'Block',
              ['Declare', 'p'],
              ['Assign', 'p', ['First', 'xs']],
              [
                'smallest',
                [
                  'Filter',
                  ['Rest', 'xs'],
                  ['Function', ['Less', 'x', 'p'], 'x'],
                ],
              ],
            ],
          ],
          'xs',
        ],
      ],
      ['smallest', ['List', 3, 1, 2]],
    ];
    expect(ce.box(program).evaluate().toString()).toBe('[]');
  });

  test('the non-recursive program, boxed', () => {
    const ce = new ComputeEngine();
    const program: MathJsonExpression = [
      'Block',
      ['DefineFunction', 'count', ['Function', ['Length', 'ys'], 'ys']],
      [
        'DefineFunction',
        'below',
        [
          'Function',
          [
            'Block',
            ['Declare', 'p'],
            ['Assign', 'p', 'k'],
            ['count', ['Filter', 'xs', ['Function', ['Less', 'x', 'p'], 'x']]],
          ],
          'xs',
          'k',
        ],
      ],
      ['below', ['List', 5, 1, 4, 2, 3], 3],
    ];
    expect(ce.box(program).evaluate().re).toBe(2);
  });
});
