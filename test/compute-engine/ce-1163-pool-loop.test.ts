import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { analyzePoolLoop } from '../../src/compute-engine/compilation/pool-loop';
import type { Expression } from '../../src/compute-engine/global-types';

//
// CE-1163, the first half of step 2 of
// `docs/plans/2026-11-08-ce1163-run-async-parallel-for.md`: the compiler
// decides the conditions 2 to 8 of section 3 for each `parallel for` of a
// JavaScript compilation, and compiles each loop that passes them as "the
// loop as a function" (section 4), a function of a sub-range of pass
// indices. The result stores the loops in `parallelLoops`. `run()` does not
// change: every loop still runs in order.
//

type PoolRecord = {
  route: 'pool';
  fn: { run: (...args: unknown[]) => unknown; code: string };
  outer: ReadonlyArray<string>;
  accumulators: ReadonlyArray<{ name: string; kind: 'number' | 'list' }>;
};
type Compiled = {
  success: boolean;
  code: string;
  run: (vars?: Record<string, unknown>) => unknown;
  parallelLoops?: ReadonlyArray<
    PoolRecord | { route: 'in-order'; reason: string }
  >;
};

/** Compile an Epsil expression to JavaScript, with no fallback. */
function compileEpsil(
  ce: ComputeEngine,
  source: string,
  options: Record<string, unknown> = {}
): Compiled {
  const [ast] = parseEpsil(source);
  const resolved = resolveLibraryNames(ast as never, source, ce);
  return compile(ce.box(resolved as never), {
    fallback: false,
    ...options,
  } as never) as never;
}

/** The routes of the loops of a result, as `route` or `in-order:reason`. */
function routes(result: Compiled): string[] {
  return (result.parallelLoops ?? []).map((l) =>
    l.route === 'pool' ? 'pool' : `in-order:${l.reason}`
  );
}

/** The pool loops of a result. */
function poolLoops(result: Compiled): PoolRecord[] {
  return (result.parallelLoops ?? []).filter(
    (l): l is PoolRecord => l.route === 'pool'
  );
}

/**
 * Call the loop as a function `loop` for the pass indices `from` to `to` of
 * a range with the first value `first` and the step `step`, with the values
 * of its outer variables by name, and the length of each list accumulator
 * by name.
 */
function callLoop(
  loop: PoolRecord,
  first: number,
  step: number,
  from: number,
  to: number,
  outer: Record<string, unknown>,
  lengths: Record<string, number> = {}
): unknown[] {
  for (const name of loop.outer) expect(outer).toHaveProperty(name);
  return loop.fn.run(
    first,
    step,
    from,
    to,
    ...loop.outer.map((name) => outer[name]),
    ...loop.accumulators
      .filter((a) => a.kind === 'list')
      .map((a) => lengths[a.name])
  ) as unknown[];
}

/** The pass indices `0` to `count - 1` split into `parts` sub-ranges. */
function split(count: number, parts: number): [number, number][] {
  const result: [number, number][] = [];
  for (let p = 0; p < parts; p++) {
    const from = Math.floor((count * p) / parts);
    const to = Math.floor((count * (p + 1)) / parts) - 1;
    result.push([from, to]);
  }
  return result;
}

//
// The witness: the `step` function of Tycho's `buddhabrot` showcase, as in
// `test/epsil/parallel-for.test.ts` (a smaller grid, lower ceilings, few
// samples).
//
const BUDDHABROT = `const N = 901
const H_0 = [0 for k in 1..N]
function step(H: list<number>, n: integer) {
  let L = H
  const r = H[901]
  parallel for k in 1..n {
    const p = 3 * fract(0.7548776662 * (r + k)) - 2
    const q = 3 * fract(0.5698402910 * (r + k)) - 1.5
    const x = p - 0.25
    const t = x^2 + q^2
    if t * (t + x) > q^2 / 4 && (p + 1)^2 + q^2 > 1/16 {
      let a = 0.0
      let b = 0.0
      let e = 0
      let sa = 0.0
      let sb = 0.0
      let s = 2
      for m in 1..200 {
        (a, b) := (a^2 - b^2 + p, 2*a*b + q)
        if a^2 + b^2 > 4 { e = m; break }
        if abs(a - sa) < 1e-12 && abs(b - sb) < 1e-12 { break }
        if m == s { sa = a; sb = b; s = 2*s }
      }
      if e > 0 {
        a = 0.0
        b = 0.0
        for m in 1..e {
          (a, b) := (a^2 - b^2 + p, 2*a*b + q)
          if a^2 + b^2 > 4 { break }
          const i = floor((b + 1.125) / 2.25 * 15)
          const j = floor((1 - a) / 3 * 20)
          if i >= 0 && i < 15 && j >= 0 && j < 20 {
            const c = 1 + i + 15*j
            const d = 15 - i + 15*j
            L[c] += 1
            L[d] += 1
            if e <= 50 {
              L[c + 300] += 1
              L[d + 300] += 1
            }
            if e <= 10 {
              L[c + 600] += 1
              L[d + 600] += 1
            }
          }
        }
      }
    }
  }
  L = replaceAt(L, 901, r + n)
  L
}
`;

describe('the witness: the buddhabrot step', () => {
  const samples = 60;

  test('the loop runs on the pool, and three sub-ranges give the counts of run()', () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const result = compileEpsil(
      ce,
      `do {\n${BUDDHABROT}step(H, ${samples})\n}`
    );
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['pool']);
    const [loop] = poolLoops(result);
    expect(loop.accumulators).toEqual([{ name: 'L', kind: 'list' }]);
    expect(loop.outer).toEqual(['r']);

    // A first step gives a list with counts and `H[901] = 60`, so the
    // second step reads `r = 60` and its passes differ from the first.
    const H1 = result.run({ H: new Array(901).fill(0) }) as number[];
    expect(H1[900]).toBe(samples);
    const expected = result.run({ H: H1 }) as number[];
    expect(expected.slice(0, 900).some((c, i) => c > H1[i])).toBe(true);

    // The calling thread runs `let L = H` and `const r = H[901]`, the
    // workers the passes 1 to 60 of `1..n` (pass indices 0 to 59), and the
    // calling thread adds the lists, then runs `L = replaceAt(L, 901, r + n)`.
    const L = [...H1];
    const r = H1[900];
    for (const [from, to] of split(samples, 3)) {
      const [sums] = callLoop(loop, 1, 1, from, to, { r }, { L: L.length });
      (sums as number[]).forEach((x, i) => (L[i] += x));
    }
    L[900] = r + samples;
    expect(L).toEqual(expected);
  });
});

describe('the passes of a sub-range', () => {
  // Each pass writes `k * k` to its own element, so the list of `run()`
  // holds the term of each pass, and the loop as a function of the one-pass
  // sub-range `[i, i]` must give that term in the same element and 0
  // elsewhere.
  test.each([
    ['an integer range', 'Range(1, 7)', 1, 1, 7],
    ['a range with an implicit negative step', 'Range(7, 1)', 7, -1, 7],
    ['a negative step', 'Range(4, -3, -1.5)', 4, -1.5, 5],
    ['bounds that are not integers', 'Range(0.25, 2.5, 0.375)', 0.25, 0.375, 7],
    [
      'a step that is not exact in binary',
      'Range(0.1, 1.05, 0.1)',
      0.1,
      0.1,
      10,
    ],
  ])('%s', (_name, range, first, step, count) => {
    const ce = new ComputeEngine();
    const result = compileEpsil(
      ce,
      `do {
        let L = [0 for j in 1..${count}]
        parallel for k in ${range} {
          L[round((k - ${first}) / ${step}) + 1] += k * k
        }
        L
      }`
    );
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['pool']);
    const [loop] = poolLoops(result);
    const expected = result.run() as number[];
    expect(expected).toHaveLength(count);
    for (let i = 0; i < count; i++) {
      const [sums] = callLoop(loop, first, step, i, i, {}, { L: count });
      const want = new Array(count).fill(0);
      want[i] = expected[i];
      expect(sums).toEqual(want);
    }
    // An empty sub-range runs no pass.
    expect(callLoop(loop, first, step, 3, 2, {}, { L: count })).toEqual([
      new Array(count).fill(0),
    ]);
  });
});

describe('accumulators and positions', () => {
  test('a number accumulator and a list accumulator in one loop', () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const result = compileEpsil(
      ce,
      `do {
        function count(H: list<integer>, n: integer) -> list<real> {
          let L = H
          const r = H[4]
          let s = 0
          parallel for k in 1..n { L[(r + k) % 3 + 1] += 1; s += k * 0.5 }
          L[4] = r + n + s
          L
        }
        count(H, 9)
      }`
    );
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['pool']);
    const [loop] = poolLoops(result);
    expect(loop.accumulators).toEqual([
      { name: 'L', kind: 'list' },
      { name: 's', kind: 'number' },
    ]);
    expect(loop.outer).toEqual(['r']);
    expect(result.run({ H: [0, 0, 0, 1] })).toEqual([3, 3, 3, 32.5]);

    // The loop of `count([0, 0, 0, 1], 9)`, in two sub-ranges.
    const L = [0, 0, 0, 1];
    let s = 0;
    for (const [from, to] of split(9, 2)) {
      const [listSums, numberSum] = callLoop(
        loop,
        1,
        1,
        from,
        to,
        { r: 1 },
        { L: 4 }
      );
      (listSums as number[]).forEach((x, i) => (L[i] += x));
      s += numberSum as number;
    }
    expect([L[0], L[1], L[2], 1 + 9 + s]).toEqual([3, 3, 3, 32.5]);
  });

  test('a loop inside a user function of the engine that the program calls', () => {
    const ce = new ComputeEngine();
    ce.declare('H', 'list<number>');
    const definition =
      'function total(L: list<number>, n: integer) { let s = 0; parallel for k in 1..n { s += L[k] * k }; s }';
    expect(executeEpsil(ce, definition).diagnostics).toEqual([]);
    // The call is the value of a declaration: a position where the loop
    // can wait (`pool-async.ts`); as an operand (`total(H, 3) + 1`), the
    // loop runs in order (`ce-1163-run-async.test.ts`).
    const result = compileEpsil(ce, 'do { let t = total(H, 3); t + 1 }');
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['pool']);
    const [loop] = poolLoops(result);
    expect(loop.outer).toEqual(['L']);
    expect(loop.accumulators).toEqual([{ name: 's', kind: 'number' }]);
    const H = [5, 6, 7, 8];
    expect(result.run({ H })).toBe(5 + 12 + 21 + 1);
    expect(callLoop(loop, 1, 1, 0, 2, { L: H })).toEqual([5 + 12 + 21]);
    expect(callLoop(loop, 1, 1, 1, 1, { L: H })).toEqual([12]);
  });

  test('two loops in one program', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compileEpsil(
      ce,
      `do {
        let s = 0
        let L = [0, 0]
        parallel for k in 1..n { s += k }
        parallel for k in 1..n { L[k % 2 + 1] += s }
        [s, L[1], L[2]]
      }`
    );
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['pool', 'pool']);
    const [first, second] = poolLoops(result);
    expect(first.outer).toEqual([]);
    expect(second.outer).toEqual(['s']);
    expect(result.run({ n: 5 })).toEqual([15, 30, 45]);
    expect(callLoop(first, 1, 1, 0, 4, {})).toEqual([15]);
    expect(callLoop(second, 1, 1, 0, 4, { s: 15 }, { L: 2 })).toEqual([
      [30, 45],
    ]);
  });
});

describe('the loops that run in order', () => {
  /** A program, the routes of its loops, the variables of its run, the
   * value of the run, and the options of its compilation. */
  const cases: [
    string,
    string,
    string[],
    Record<string, unknown>,
    unknown,
    Record<string, unknown>,
  ][] = [
    [
      'condition 2: a loop over a list',
      'do { let s = 0; parallel for x in [1, 2, 3] { s += x }; s }',
      ['in-order:domain'],
      {},
      6,
      {},
    ],
    [
      'condition 4: a read of an accumulator',
      'do { let L = [1, 2, 3]; parallel for k in 1..2 { L[k] += L[k + 1] }; L }',
      ['in-order:accumulator-read'],
      {},
      [3, 5, 3],
      {},
    ],
    [
      'condition 6: a body that reads a function value',
      'do { let h = (x) => x + 1; let s = 0; parallel for k in 1..3 { s += h(k) }; s }',
      ['in-order:function-value'],
      {},
      9,
      {},
    ],
    [
      'condition 7: a pass that draws',
      'do { let s = 0; parallel for k in 1..3 { s += random() * 0 + k }; s }',
      ['in-order:not-shippable'],
      {},
      6,
      {},
    ],
    [
      'condition 8: a program compiled with `iterationBudget`',
      'do { let s = 0; parallel for k in 1..3 { s += k }; s }',
      ['in-order:iteration-budget'],
      {},
      6,
      { iterationBudget: 1000 },
    ],
    [
      'condition 3: the complex mode',
      'do { let s = 0; parallel for k in 1..3 { s += k }; s }',
      ['in-order:mode'],
      {},
      6,
      { mode: 'complex' },
    ],
  ];
  test.each(cases)('%s', (_name, source, expected, vars, value, options) => {
    const ce = new ComputeEngine();
    const result = compileEpsil(ce, source, options);
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(expected);
    expect(result.run(vars)).toEqual(value);
  });

  // The bigint mode has no lowering for a block of statements, so a program
  // that holds a loop declines in that mode before the analysis.
  test('condition 3: the bigint mode declines the program', () => {
    const ce = new ComputeEngine();
    expect(() =>
      compileEpsil(
        ce,
        'do { let s = 0; parallel for k in 1..3 { s += k }; s }',
        {
          mode: 'bigint',
        }
      )
    ).toThrow(/bigint/);
  });

  // Compiled code writes only the locals that it declares, and a function
  // that writes a variable of an enclosing block declines, so a compiled
  // program cannot hold such a loop. The analysis is checked on the loop
  // itself.
  test('condition 3: an accumulator that is not a local of the function that holds the loop', () => {
    const ce = new ComputeEngine();
    const source = `do {
      let s = 0
      function g(n: integer) { parallel for k in 1..n { s += k }; n }
      g(4) + s
    }`;
    const [ast] = parseEpsil(source);
    const program = ce.box(
      resolveLibraryNames(ast as never, source, ce) as never
    );
    // The loop as written, with the nodes from the root to it.
    const find = (
      e: Expression,
      ancestors: Expression[]
    ): [Expression, Expression[]] | undefined => {
      if (e.operator === 'ParallelLoop') return [e, ancestors];
      for (const op of e.ops ?? []) {
        const found = find(op, [...ancestors, e]);
        if (found !== undefined) return found;
      }
      return undefined;
    };
    const [loop, ancestors] = find(program, [])!;
    expect(analyzePoolLoop(loop, ancestors)).toEqual({
      reason: 'accumulator-scope',
    });
    // The same loop with the accumulator declared in the function runs on
    // the pool.
    const local = compileEpsil(
      ce,
      'do { function g(n: integer) { let s = 0; parallel for k in 1..n { s += k }; s }; g(4) }'
    );
    expect(routes(local)).toEqual(['pool']);
    expect(local.run()).toBe(10);
  });

  test('condition 5: an assignment to an outer variable, built as MathJSON', () => {
    // The Epsil checker refuses `t = k` in a pass; a MathJSON program does
    // not pass through the checker.
    const ce = new ComputeEngine();
    const program = ce.box([
      'Block',
      ['Declare', 't', ['Dictionary', ['KeyValuePair', "'value'", 0]]],
      ['Declare', 's', ['Dictionary', ['KeyValuePair', "'value'", 0]]],
      [
        'ParallelLoop',
        ['Block', ['Assign', 't', 'k'], ['AddTo', 's', 'k']],
        ['Element', 'k', ['Range', 1, 4]],
      ],
      ['Add', ['Multiply', 't', 100], 's'],
    ] as never);
    const result = compile(program, {
      fallback: false,
    } as never) as never as Compiled;
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['in-order:outer-write']);
    expect(result.run()).toBe(410);
    // The interpreter gives the same value.
    expect(program.evaluate().re).toBe(410);
  });

  test('condition 5: a jump out of the loop, built as MathJSON', () => {
    const ce = new ComputeEngine();
    const program = ce.box([
      'Block',
      ['Declare', 's', ['Dictionary', ['KeyValuePair', "'value'", 0]]],
      [
        'ParallelLoop',
        ['Block', ['AddTo', 's', 'k'], ['If', ['Greater', 'k', 2], ['Break']]],
        ['Element', 'k', ['Range', 1, 5]],
      ],
      's',
    ] as never);
    const result = compile(program, {
      fallback: false,
    } as never) as never as Compiled;
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['in-order:jump']);
    expect(result.run()).toBe(6);
    expect(program.evaluate().re).toBe(6);
  });

  test('a read of an accumulator gives the value of the interpreter', () => {
    const source =
      'do { let L = [1, 2, 3]; parallel for k in 1..2 { L[k] += L[k + 1] }; L }';
    const { value, diagnostics } = executeEpsil(new ComputeEngine(), source);
    expect(diagnostics.map((d) => d.message)).toContainEqual(
      expect.arrayContaining(['parallel-accumulator-read'])
    );
    expect([...value.each()].map((x) => x.re)).toEqual([3, 5, 3]);
  });
});

/** The first `ParallelLoop` of `program`, with the nodes from the root to
 * it, outermost first. */
function findLoop(
  program: Expression,
  ancestors: Expression[] = []
): [Expression, Expression[]] | undefined {
  if (program.operator === 'ParallelLoop') return [program, ancestors];
  for (const op of program.ops ?? []) {
    const found = findLoop(op, [...ancestors, program]);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** `Declare(name, 'value' -> 0)`, the form of `let name = 0`. */
const declareZero = (name: string) => [
  'Declare',
  name,
  ['Dictionary', ['KeyValuePair', "'value'", 0]],
];

describe('the functions that the body calls', () => {
  // The loop as a function is boxed again at the level of the engine, where
  // the name `helper` gives the function of the engine. A function of a
  // block with the same name is another function.
  test('a function of a block with the name of a function of the engine runs in order', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(ce, 'function helper(x: real) { x + 1 }').diagnostics
    ).toEqual([]);
    const engine = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..3 { s += helper(k) }; s }'
    );
    expect(routes(engine)).toEqual(['pool']);
    expect(engine.run()).toBe(9);
    expect(callLoop(poolLoops(engine)[0], 1, 1, 0, 2, {})).toEqual([9]);

    const shadowed = compileEpsil(
      ce,
      'do { function helper(x: real) { 2 * x }; let s = 0; parallel for k in 1..3 { s += helper(k) }; s }'
    );
    expect(shadowed.success).toBe(true);
    expect(routes(shadowed)).toEqual(['in-order:function-value']);
    expect(shadowed.run()).toBe(12);
  });

  // A function held as a value is not a definition of an operator: a call
  // of it from a user function that the body calls is refused as the same
  // call written in the body is (condition 6).
  test('a user function that calls a function of the engine held as a value runs in order', () => {
    const ce = new ComputeEngine();
    for (const source of [
      'let h = (x) => x + 1',
      'function g(x: real) { 2 * h(x) }',
    ])
      expect(executeEpsil(ce, source).diagnostics).toEqual([]);
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..3 { s += g(k) }; s }'
    );
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['in-order:function-value']);
    expect(result.run()).toBe(18);
  });

  test('a function of a block with the name of a library operator runs in order, built as MathJSON', () => {
    const ce = new ComputeEngine();
    const program = ce.box([
      'Block',
      ['DefineFunction', 'Sin', ['Function', ['Multiply', 2, 'x'], 'x']],
      declareZero('s'),
      [
        'ParallelLoop',
        ['AddTo', 's', ['Sin', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ] as never);
    const result = compile(program, {
      fallback: false,
    } as never) as never as Compiled;
    expect(result.success).toBe(true);
    expect(routes(result)).toEqual(['in-order:function-value']);
    expect(result.run()).toBe(12);
    expect(program.evaluate().re).toBe(12);
  });

  // The compilation of a `Function` literal with the `functions` option
  // names the function of the option and does not define it, so the loop as
  // a function could not run it on a worker.
  test('a head that the `functions` option replaces runs in order', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(ce, 'function helper(x: real) { x + 1 }').diagnostics
    ).toEqual([]);
    const result = compileEpsil(
      ce,
      'do { let s = 0; parallel for k in 1..3 { s += helper(k) }; s }',
      { functions: { helper: (x: number) => 2 * x } }
    );
    expect(routes(result)).toEqual(['in-order:not-shippable']);
    expect(result.run()).toBe(12);
  });

  // A user function that writes a variable of the engine (with the `scope`
  // effect) is not compiled as a definition, so a compiled program does not
  // reach this analysis with it. The analysis is checked on the loop
  // itself.
  test('condition 5: a user function named as an operand by a function that the body calls is checked', () => {
    const ce = new ComputeEngine();
    for (const source of [
      'let c = 0',
      'function h(x: real) scope { c = x; x }',
      'function g(xs: list<real>) scope { map(h, xs) }',
    ])
      expect(executeEpsil(ce, source).diagnostics).toEqual([]);
    ce.declare('L', 'list<real>');
    const source =
      'do { let s = 0; parallel for k in 1..3 { s += g(L)[1] * k }; s }';
    const [ast] = parseEpsil(source);
    const program = ce.box(
      resolveLibraryNames(ast as never, source, ce) as never
    );
    const [loop, ancestors] = findLoop(program)!;
    expect(analyzePoolLoop(loop, ancestors)).toEqual({
      reason: 'outer-write',
    });
  });
});

describe('the value of a `+=`', () => {
  // The value of an `AddTo` is the running sum, which a worker does not
  // have. The compiler refuses a program that uses the value of an
  // assignment before the analysis of its loops, so no loop of a compiled
  // program has an `AddTo` whose value is used.
  test('a program that uses the value of a `+=` on an accumulator does not compile, built as MathJSON', () => {
    const ce = new ComputeEngine();
    const program = ce.box([
      'Block',
      declareZero('s'),
      declareZero('u'),
      [
        'ParallelLoop',
        ['AddTo', 'u', ['If', ['Greater', 'k', 2], ['AddTo', 's', 1], 0]],
        ['Element', 'k', ['Range', 1, 4]],
      ],
      ['Add', ['Multiply', 's', 100], 'u'],
    ] as never);
    expect(() => compile(program, { fallback: false } as never)).toThrow(
      /its value is used/
    );
  });
});
