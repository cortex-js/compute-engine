import { ComputeEngine, compile } from '../../src/compute-engine';
import { ScalarFragmentJavaScriptTarget } from '../../src/compute-engine/compilation/javascript-fragment-target';
import { lowerStructuredFragment } from '../../src/compute-engine/compilation/javascript-structured-lower';
import { analyzeExecution } from '../../src/compute-engine/compilation/structured-execution';
import type {
  IROperation,
  IRRegion,
} from '../../src/compute-engine/compilation/structured-ir';
import type { CompilationResult } from '../../src/compute-engine/compilation/types';
import type { Expression } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

// `Which`, `If(c, v)` used as a value, and `Sum` and `Product` over integer
// ranges on the structured route of the internal JavaScript fragment target
// (the `numeric-kernel` profile), which the engine's own compilations need:
// the integrands of piecewise functions and the limit probes of partial
// sums.
//
// Each program is compiled on the structured route and compared with the
// ordinary JavaScript compiler with `cse: false, constantFold: false` (the
// same doubles, `Object.is`) and with the interpreter (within 1e-12
// relative, or by the caveats of compiled code, docs/COMPILATION-MODEL.md,
// "Caveats of compiled code": `NaN` where the interpreter gives `Missing`),
// in the `strict` and `complex` modes.

const OPTIONS = { cse: false, constantFold: false } as const;
const MODES = ['strict', 'complex'] as const;
type Mode = (typeof MODES)[number];

const typed = (name: string, type: string): MathJsonExpression => [
  'Typed',
  name,
  `'${type}'`,
];

/** A `Function` literal of the body `body` and the typed parameters. */
const fn = (
  body: MathJsonExpression,
  ...parameters: [string, string][]
): MathJsonExpression =>
  [
    'Function',
    ['Block', body],
    ...parameters.map(([n, t]) => typed(n, t)),
  ] as MathJsonExpression;

/** An engine with the captured bindings of the programs and the test
 *  operation `Trace`, whose definition states an effect. */
function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('N', 'integer');
  ce.assign('N', 5);
  ce.declare('M', 'integer');
  ce.assign('M', 200);
  ce.declare('B', 'integer');
  ce.assign('B', 2 ** 60);
  ce.declare('Trace', {
    signature: '(real) -> real',
    effects: ['console'],
    evaluate: (ops: readonly Expression[]) => ops[0],
  } as never);
  return ce;
}

const TRACES: number[] = [];
const structured = () =>
  new ScalarFragmentJavaScriptTarget(
    'structured',
    new Map([['Trace', 'trace']]),
    {
      trace: (_id: string, operands: readonly string[]) =>
        `globalThis.__ceSumTrace(${operands.join(', ')})`,
    }
  );
(globalThis as { __ceSumTrace?: (x: number) => number }).__ceSumTrace = (
  x: number
) => {
  TRACES.push(x);
  return x;
};

function runArgs(
  result: CompilationResult<'javascript'>,
  args: readonly unknown[]
): unknown {
  return (result.run as unknown as (...a: unknown[]) => unknown)(...args);
}

/** `a` and `b` are the same value within 1e-12 relative; `NaN` equals only
 *  `NaN`, an infinity only the same infinity. */
function close(a: unknown, b: unknown): boolean {
  if (typeof a !== 'number' || typeof b !== 'number') return false;
  return (
    (Number.isNaN(a) && Number.isNaN(b)) ||
    a === b ||
    (Number.isFinite(a) &&
      Number.isFinite(b) &&
      Math.abs(a - b) <= 1e-12 * Math.max(1, Math.abs(a), Math.abs(b)))
  );
}

/** The value of the interpreter for the `Function` literal `json` applied
 *  to `args`: a number, `NaN` for `Missing`. */
function interpret(
  ce: ComputeEngine,
  json: MathJsonExpression,
  args: readonly number[]
): number {
  return ce
    .expr(['Apply', json, ...args] as MathJsonExpression)
    .evaluate()
    .N().re;
}

type Program = {
  readonly name: string;
  readonly json: MathJsonExpression;
  /** Compared with the existing compiler and the interpreter. */
  readonly args: readonly (readonly number[])[];
  /** Compared with the existing compiler only: a range over the budget,
   *  or a bound that is not a safe integer, where the existing compiler
   *  gives `NaN` and the interpreter computes the sum or refuses it. */
  readonly existingOnly?: readonly (readonly number[])[];
  readonly iterationBudget?: number;
  /** The mode in which the structured route declines the program, and the
   *  message. */
  readonly declinedIn?: { readonly mode: Mode; readonly message: RegExp };
};

const SUM_PROGRAMS: Program[] = [
  {
    name: 'Σ_{k=1}^{3} k x (unrolled)',
    json: fn(
      ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 3]],
      ['x', 'real']
    ),
    args: [[2], [0], [-0], [-1.5], [1e300]],
  },
  {
    name: 'one term: Σ_{k=2}^{2} k x',
    json: fn(
      ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 2, 2]],
      ['x', 'real']
    ),
    args: [[3], [-0]],
  },
  {
    name: 'lower above upper: Σ_{k=3}^{1} 1/k',
    json: fn(['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 3, 1]], ['x', 'real']),
    args: [[0]],
  },
  {
    name: 'terms of -0: Σ_{k=1}^{3} -(k x)',
    json: fn(
      ['Sum', ['Negate', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 3]],
      ['x', 'real']
    ),
    args: [[0], [1]],
  },
  {
    name: 'negative bounds: Σ_{k=-3}^{2} k^2 + x',
    json: fn(
      ['Sum', ['Add', ['Power', 'k', 2], 'x'], ['Limits', 'k', -3, 2]],
      ['x', 'real']
    ),
    args: [[0.5]],
  },
  {
    name: 'integer bounds from parameters: Σ_{k=a}^{b} k',
    json: fn(
      ['Sum', 'k', ['Limits', 'k', 'a', 'b']],
      ['a', 'integer'],
      ['b', 'integer']
    ),
    args: [
      [-3, 2],
      [2, -3],
      [5, 5],
      [-0, 0],
      [1, 1000],
    ],
    existingOnly: [
      [1, 2 ** 53],
      [-(2 ** 60), 3],
    ],
  },
  {
    name: 'a real bound from a parameter: Σ_{k=1}^{n} 1/k',
    json: fn(
      ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 'n']],
      ['n', 'real']
    ),
    args: [[2.5], [0], [-2], [3], [10], [1000]],
    existingOnly: [[1e20], [Infinity], [-Infinity], [NaN]],
  },
  {
    name: 'the iteration budget: Σ_{k=1}^{n} 1/k, budget 10',
    json: fn(
      ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 'n']],
      ['n', 'real']
    ),
    iterationBudget: 10,
    args: [[9], [10], [-5]],
    existingOnly: [[11], [1e6], [1e20], [Infinity], [-Infinity], [NaN]],
  },
  {
    name: 'a constant range over the budget: Σ_{k=1}^{300} 1/k, budget 10',
    json: fn(
      ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 300]],
      ['x', 'real']
    ),
    iterationBudget: 10,
    args: [],
    existingOnly: [[0]],
  },
  {
    name: 'a constant range in the budget: Σ_{k=1}^{3} 1/k, budget 10',
    json: fn(['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 3]], ['x', 'real']),
    iterationBudget: 10,
    args: [[0]],
  },
  {
    name: 'a lower bound from a parameter: Σ_{k=m}^{4} k x',
    json: fn(
      ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 'm', 4]],
      ['m', 'integer'],
      ['x', 'real']
    ),
    args: [
      [1, 2],
      [4, 2],
      [7, 2],
      [-2, 0.5],
    ],
  },
  {
    name: 'a bound from a capture: Σ_{k=1}^{N} k x (unrolled)',
    json: fn(
      ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'N']],
      ['x', 'real']
    ),
    args: [[2], [-0]],
  },
  {
    name: 'a bound from a capture: Σ_{k=1}^{M} x/k (a loop)',
    json: fn(
      ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 'M']],
      ['x', 'real']
    ),
    args: [[2], [-0]],
  },
  // A bound that reads only captured values is code on both routes (the
  // existing compiler folds it only to check its range): the floor of the
  // snapshots, the run-time guard and a loop, whose sum of `-0` terms is
  // `0`.
  ...(
    [
      ['N - 1', ['Add', 'N', -1]],
      ['2 N', ['Multiply', 2, 'N']],
      ['N / 2, not an integer', ['Divide', 'N', 2]],
      ['N - 5, an empty range', ['Add', 'N', -5]],
    ] as [string, MathJsonExpression][]
  ).map(([label, bound]): Program => ({
    name: `a bound of captures: Σ_{k=1}^{${label}} -(k x)`,
    json: fn(
      ['Sum', ['Negate', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, bound]],
      ['x', 'real']
    ),
    args: [[0], [2]],
  })),
  {
    name: 'a bound of captures over the budget: Σ_{k=1}^{2M} x/k, budget 10',
    json: fn(
      ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, ['Multiply', 2, 'M']]],
      ['x', 'real']
    ),
    iterationBudget: 10,
    args: [],
    existingOnly: [[2], [-0]],
  },
  {
    // Both compilers read a local as a bound with no value at compile time:
    // a loop, whose sum of `-0` terms is `0`.
    name: 'a bound from a local: Σ_{k=1}^{m} -(k x)',
    json: [
      'Function',
      [
        'Block',
        ['Declare', 'm', "'integer'", 4],
        ['Sum', ['Negate', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 'm']],
      ],
      typed('x', 'real'),
    ] as MathJsonExpression,
    args: [[0], [2]],
  },
  {
    // The constant `Pi` has a value at compile time: three terms with no
    // loop, whose sum of `-0` terms is `-0`.
    name: 'a bound from the constant Pi: Σ_{k=1}^{π} -(k x)',
    json: fn(
      ['Sum', ['Negate', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, 'Pi']],
      ['x', 'real']
    ),
    args: [[0], [2]],
  },
  {
    name: 'nested: Σ_{k=1}^{3} Σ_{j=1}^{k} j k x',
    json: fn(
      [
        'Sum',
        ['Sum', ['Multiply', 'j', 'k', 'x'], ['Limits', 'j', 1, 'k']],
        ['Limits', 'k', 1, 3],
      ],
      ['x', 'real']
    ),
    args: [[1.5], [0.1]],
  },
  {
    name: 'two clauses: Σ j k x over j = 1..2, k = 1..3',
    json: fn(
      [
        'Sum',
        ['Multiply', 'j', 'k', 'x'],
        ['Limits', 'j', 1, 2],
        ['Limits', 'k', 1, 3],
      ],
      ['x', 'real']
    ),
    args: [[0.1], [-0]],
  },
  {
    name: 'two clauses, the second bound reads the first index',
    json: fn(
      [
        'Sum',
        ['Divide', 'j', 'k'],
        ['Limits', 'j', 1, 'n'],
        ['Limits', 'k', 1, 'j'],
      ],
      ['n', 'integer']
    ),
    args: [[0], [1], [4], [30]],
  },
  {
    name: 'nested, 10 by 10, in an If',
    json: fn(
      [
        'If',
        ['Less', 0, 'x'],
        ['Add', 'x', 1],
        [
          'Sum',
          ['Sum', ['Multiply', 'j', 'k', 'x'], ['Limits', 'j', 1, 10]],
          ['Limits', 'k', 1, 10],
        ],
      ],
      ['x', 'real']
    ),
    args: [[2], [-0.3], [-0]],
  },
  {
    name: 'a sum of a parameter in a sum of a capture',
    json: fn(
      [
        'Multiply',
        ['Divide', 4, ['Power', 'n', 2]],
        [
          'Sum',
          ['Sqrt', ['Add', ['Negate', ['Power', 'k', 2]], ['Power', 'n', 2]]],
          ['Limits', 'k', 1, 'n'],
        ],
      ],
      ['n', 'real']
    ),
    iterationBudget: 1e6,
    args: [[10], [1000], [0.5]],
    // In the `complex` mode the square root of an operand of unknown sign
    // is complex, and a complex sum is not in the structured route.
    declinedIn: {
      mode: 'complex',
      message:
        /Sum whose body has the type `complex` is not in the structured route/,
    },
  },
  {
    name: 'Π_{k=1}^{2} (k + x)',
    json: fn(
      ['Product', ['Add', 'k', 'x'], ['Limits', 'k', 1, 2]],
      ['x', 'real']
    ),
    args: [[3], [-1], [-0]],
  },
  {
    name: 'Π_{k=a}^{b} (k + 1/2)',
    json: fn(
      ['Product', ['Add', 'k', 0.5], ['Limits', 'k', 'a', 'b']],
      ['a', 'integer'],
      ['b', 'integer']
    ),
    args: [
      [-3, 2],
      [2, -3],
      [5, 5],
      [1, 170],
    ],
  },
  {
    name: 'Π_{k=1}^{101} -x (a loop)',
    json: fn(
      ['Product', ['Negate', 'x'], ['Limits', 'k', 1, 101]],
      ['x', 'real']
    ),
    args: [[1], [-1.01], [0]],
  },
  {
    name: 'an integer sum: Σ_{j=1}^{50} j',
    json: fn(['Sum', 'j', ['Limits', 'j', 1, 50]], ['x', 'real']),
    args: [[1]],
  },
  {
    name: 'a sum in a Which',
    json: fn(
      [
        'Which',
        ['Less', 'x', 0],
        ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 'm']],
        'True',
        'x',
      ],
      ['x', 'real'],
      ['m', 'integer']
    ),
    args: [
      [-2, 3],
      [2, 3],
      [-1, 0],
    ],
  },
];

/** The integer `-0` terms of a sum written with no loop, and of a loop:
 *  the existing emitter writes at most 100 terms of a clause with no loop
 *  (`UNROLL_LIMIT`), whose sum of `-0` is `-0`; its loop starts from `0`. */
const BOUNDARY_PROGRAMS: Program[] = [100, 101].map((n) => ({
  name: `Σ_{k=1}^{${n}} -(k x)`,
  json: fn(
    ['Sum', ['Negate', ['Multiply', 'k', 'x']], ['Limits', 'k', 1, n]],
    ['x', 'real']
  ),
  args: [[0], [0.25]],
}));

const WHICH_PROGRAMS: Program[] = [
  {
    name: 'Which(y < 1/2, 2y, True, 0)',
    json: fn(
      ['Which', ['Less', 'y', 0.5], ['Multiply', 2, 'y'], 'True', 0],
      ['y', 'real']
    ),
    args: [[0.2], [0.5], [0.7], [NaN]],
    // Not a value of the type `real`: the interpreter gives `NaN`.
    existingOnly: [[-Infinity]],
  },
  {
    name: 'Which(y < 1/2, y) with no default',
    json: fn(['Which', ['Less', 'y', 0.5], 'y'], ['y', 'real']),
    args: [[0.2], [0.7], [NaN]],
  },
  {
    name: 'If(y <= 1, y) used as a value',
    json: fn(['If', ['LessEqual', 'y', 1], 'y'], ['y', 'real']),
    args: [[0.5], [1], [3], [NaN]],
  },
  {
    name: 'If(5 < t, 1) used as a value (an integer)',
    json: fn(['If', ['Less', 5, 't'], 1], ['t', 'real']),
    args: [[6], [4]],
  },
  {
    name: 'each clause, and no clause',
    json: fn(
      [
        'Which',
        ['Less', 't', -1],
        ['Multiply', 2, 't'],
        ['Less', 't', 0],
        1,
        ['Less', 't', 3],
        ['Multiply', 0.5, 't'],
      ],
      ['t', 'real']
    ),
    args: [[-2], [-0.5], [-0], [2], [3], [NaN]],
  },
  {
    name: 'integer and real values: Which(k < 0, k, True, 1.5)',
    json: fn(['Which', ['Less', 'k', 0], 'k', 'True', 1.5], ['k', 'integer']),
    args: [[-3], [0], [4]],
  },
  {
    name: 'integer values: Which(k < 0, -k, k < 10, 2k)',
    json: fn(
      [
        'Which',
        ['Less', 'k', 0],
        ['Negate', 'k'],
        ['Less', 'k', 10],
        ['Multiply', 2, 'k'],
      ],
      ['k', 'integer']
    ),
    args: [[-3], [0], [4], [12]],
  },
  {
    name: 'nested Which',
    json: fn(
      [
        'Which',
        ['Less', 'y', ['Rational', 1, 2]],
        'y',
        'True',
        [
          'Which',
          ['Less', 'y', ['Rational', 3, 4]],
          ['Multiply', 3, 'y'],
          'True',
          ['Multiply', 5, 'y'],
        ],
      ],
      ['y', 'real']
    ),
    args: [[0.1], [0.6], [0.9], [NaN]],
  },
  {
    name: 'a Which in a sum: Add(Which(x < 1/2, x, True, 0), 1)',
    json: fn(
      ['Add', ['Which', ['Less', 'x', 0.5], 'x', 'True', 0], 1],
      ['x', 'real']
    ),
    args: [[0.25], [0.75]],
  },
  {
    name: 'a Which of the index of a sum',
    json: fn(
      [
        'Sum',
        ['Which', ['Less', 'k', 'x'], 'k', 'True', ['Negate', 'x']],
        ['Limits', 'k', 1, 10],
      ],
      ['x', 'real']
    ),
    args: [[4.5], [0], [20]],
  },
];

function checkProgram(program: Program, mode: Mode): void {
  const ce = engine();
  const expr = ce.expr(program.json);
  const options = {
    ...OPTIONS,
    mode,
    ...(program.iterationBudget === undefined
      ? {}
      : { iterationBudget: program.iterationBudget }),
  };
  if (program.declinedIn?.mode === mode) {
    expect(() => structured().compile(expr, options)).toThrow(
      program.declinedIn.message
    );
    return;
  }
  const result = structured().compile(expr, options);
  const existing = compile(expr, { ...options, fallback: false });
  for (const args of program.args) {
    const value = runArgs(result, args);
    const expected = interpret(ce, program.json, args);
    expect([args, value, expected, close(value, expected)]).toEqual([
      args,
      value,
      expected,
      true,
    ]);
  }
  for (const args of [...program.args, ...(program.existingOnly ?? [])]) {
    const value = runArgs(result, args);
    const other = runArgs(existing, args);
    expect([args, value, other, Object.is(value, other)]).toEqual([
      args,
      value,
      other,
      true,
    ]);
  }
}

describe('Sum and Product, differential', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of [...SUM_PROGRAMS, ...BOUNDARY_PROGRAMS])
        test(program.name, () => checkProgram(program, mode));
    });
});

describe('Which and If(c, v), differential', () => {
  for (const mode of MODES)
    describe(`${mode} mode`, () => {
      for (const program of WHICH_PROGRAMS)
        test(program.name, () => checkProgram(program, mode));
    });
});

test('the size limit of the form with no loop: 100 terms, not 101', () => {
  const ce = engine();
  const [unrolled, looped] = BOUNDARY_PROGRAMS.map((p) =>
    runArgs(structured().compile(ce.expr(p.json), OPTIONS), [0])
  );
  expect(Object.is(unrolled, -0)).toBe(true);
  expect(Object.is(looped, 0)).toBe(true);
});

test('an expression with free symbols: Σ_{k=1}^{n} k x', () => {
  const ce = engine();
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  const expr = ce.expr([
    'Sum',
    ['Multiply', 'k', 'x'],
    ['Limits', 'k', 1, 'n'],
  ]);
  const result = structured().compile(expr, OPTIONS);
  const existing = compile(expr, { ...OPTIONS, fallback: false });
  for (const inputs of [
    { x: 2, n: 4 },
    { x: -0, n: 3 },
    { x: 1, n: 0 },
  ]) {
    const value = result.run!(inputs as never);
    expect(Object.is(value, existing.run!(inputs as never))).toBe(true);
    expect(
      close(
        value,
        ce
          .expr([
            'Sum',
            ['Multiply', 'k', inputs.x],
            ['Limits', 'k', 1, inputs.n],
          ])
          .N().re
      )
    ).toBe(true);
  }
});

test('a sum in the body of a helper, and a helper call in a sum', () => {
  const ce = engine();
  ce.assign(
    'hs',
    ce.box([
      'Function',
      ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 10]],
      'x',
    ])
  );
  ce.declare('ht', '(real, integer) -> real');
  ce.assign(
    'ht',
    ce.box([
      'Function',
      ['Block', ['Multiply', 'x', 'j']],
      typed('x', 'real'),
      typed('j', 'integer'),
    ])
  );
  for (const body of [
    ['Add', ['hs', 'x'], 1],
    ['Sum', ['ht', 'x', 'k'], ['Limits', 'k', 1, 10]],
  ] as MathJsonExpression[]) {
    const json = fn(body, ['x', 'real']);
    const expr = ce.expr(json);
    const result = structured().compile(expr, OPTIONS);
    const existing = compile(expr, { ...OPTIONS, fallback: false });
    for (const x of [0.5, -3, -0]) {
      const value = runArgs(result, [x]);
      expect(Object.is(value, runArgs(existing, [x]))).toBe(true);
      expect(close(value, interpret(ce, json, [x]))).toBe(true);
    }
  }
});

test('a sum in the body of a Loop', () => {
  const ce = engine();
  const json = [
    'Function',
    [
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        [
          'Assign',
          's',
          ['Add', 's', ['Sum', ['Divide', 'i', 'k'], ['Limits', 'k', 1, 'i']]],
        ],
        ['Element', 'i', ['Range', 1, 'n']],
      ],
      's',
    ],
    typed('n', 'integer'),
  ] as MathJsonExpression;
  const expr = ce.expr(json);
  const result = structured().compile(expr, OPTIONS);
  const existing = compile(expr, { ...OPTIONS, fallback: false });
  for (const n of [1, 3, 20]) {
    const value = runArgs(result, [n]);
    expect(Object.is(value, runArgs(existing, [n]))).toBe(true);
    expect(close(value, interpret(ce, json, [n]))).toBe(true);
  }
});

test('the terms are evaluated in order, each once, and a sum counts no pass of the budget', () => {
  const ce = engine();
  for (const [n, budget] of [
    [3, undefined],
    [150, undefined],
    [150, 200],
  ] as const) {
    const expr = ce.expr(
      fn(['Sum', ['Trace', 'k'], ['Limits', 'k', 1, n]], ['x', 'real'])
    );
    const result = structured().compile(expr, {
      ...OPTIONS,
      ...(budget === undefined ? {} : { iterationBudget: budget }),
    });
    TRACES.length = 0;
    expect(runArgs(result, [0])).toBe((n * (n + 1)) / 2);
    expect(TRACES).toEqual(Array.from({ length: n }, (_, i) => i + 1));
  }
});

//
// The representation
//

/** The operations of `region` and of the regions nested in it. */
function allOperations(region: IRRegion): IROperation[] {
  return region.operations.flatMap((op) => [
    op,
    ...(op.kind === 'if'
      ? [...allOperations(op.then), ...allOperations(op.else)]
      : op.kind === 'loop' || op.kind === 'build'
        ? allOperations(op.body)
        : op.kind === 'and' || op.kind === 'or'
          ? op.rest.flatMap(allOperations)
          : []),
  ]);
}

function program(json: MathJsonExpression, options: object = {}) {
  const ce = engine();
  return lowerStructuredFragment(
    structured().prepareStructured(ce.expr(json), { ...OPTIONS, ...options })
  );
}

describe('the representation', () => {
  test('a sum is a loop with one carried value and no iteration budget', () => {
    const p = program(
      fn(['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 'n']], ['n', 'real']),
      { iterationBudget: 1000 }
    );
    const loops = allOperations(p.root).filter((op) => op.kind === 'loop');
    expect(loops).toHaveLength(1);
    const [loop] = loops;
    expect(loop.kind === 'loop' && loop.iterationBudget).toBeUndefined();
    expect(loop.kind === 'loop' && loop.results).toHaveLength(1);
    expect(p.root.canAbort).toBeUndefined();
    // No new kind of operation.
    const kinds = new Set(allOperations(p.root).map((op) => op.kind));
    for (const kind of kinds)
      expect([
        'literal',
        'input',
        'floor',
        'unary',
        'less',
        'less-equal',
        'and',
        'or',
        'not',
        'negate',
        'add',
        'divide',
        'if',
        'loop',
        'yield',
      ]).toContain(kind);
  });

  test('a Which is nested ifs', () => {
    const p = program(
      fn(
        ['Which', ['Less', 't', 0], 1, ['Less', 't', 1], 2, 'True', 3],
        ['t', 'real']
      )
    );
    const ifs = allOperations(p.root).filter((op) => op.kind === 'if');
    expect(ifs).toHaveLength(2);
  });

  test('the execution analysis: pure, portable, and a sum is not a candidate for parallel iterations', () => {
    const analysis = analyzeExecution(
      program(
        fn(
          ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 'n']],
          ['x', 'real'],
          ['n', 'integer']
        ),
        { iterationBudget: 1000 }
      )
    );
    expect(analysis.independentCalls.holds).toBe(true);
    // The loop of a sum has no budget of its own: no caveat.
    expect(analysis.independentCalls.caveats).toEqual([]);
    expect(analysis.workerPortable.holds).toBe(true);
    expect(analysis.parallelLoops).toHaveLength(1);
    const [loop] = analysis.parallelLoops;
    expect(loop.candidate).toBe(false);
    if (!loop.candidate) expect(loop.reason.reason).toMatch(/^carried scalar/);
  });

  test('the profile reports a sum pure and shippable', () => {
    const ce = engine();
    const result = compile(
      ce.expr(
        fn(
          ['Sum', ['Divide', 'x', 'k'], ['Limits', 'k', 1, 'n']],
          ['x', 'real'],
          ['n', 'integer']
        )
      ),
      { profile: 'numeric-kernel', fallback: false } as never
    ) as CompilationResult<'javascript'>;
    expect(result.profile).toBe('numeric-kernel');
    expect(result.pure).toBe(true);
    expect(result.shippable).toBe(true);
  });
});

//
// The forms that stay declined
//

describe('declined', () => {
  const DECLINES: [string, MathJsonExpression, RegExp, Mode][] = [
    [
      'a sum of one number',
      fn(['Multiply', 't', ['Sum', 'x']], ['t', 'real'], ['x', 'real']),
      /Sum of one operand of the type `real` is not in the structured route/,
      'strict',
    ],
    [
      'an infinite bound',
      fn(
        [
          'Sum',
          ['Multiply', 'n', ['Power', 'x', 'n']],
          ['Limits', 'n', 0, 'PositiveInfinity'],
        ],
        ['x', 'real']
      ),
      /The bound `\+oo` of `Sum` is not a finite number/,
      'strict',
    ],
    [
      'a bound that is not a safe integer',
      fn(['Sum', 'k', ['Limits', 'k', 1, 1e17]], ['x', 'real']),
      /of `Sum` is not a safe integer/,
      'strict',
    ],
    [
      // The existing compiler declines it too (`assertSafeBigOpBounds()`).
      'a bound of captures that is not a safe integer',
      fn(
        ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, ['Add', 'B', -1]]],
        ['x', 'real']
      ),
      /of `Sum` is not a safe integer/,
      'strict',
    ],
    [
      'a bound with an effect',
      fn(['Sum', 'k', ['Limits', 'k', 1, ['Trace', 'x']]], ['x', 'real']),
      /has a call that is not pure/,
      'strict',
    ],
    [
      'an index named as a parameter',
      fn(['Sum', ['Power', 'k', 2], ['Limits', 'k', 1, 3]], ['k', 'real']),
      /the Sum index k has the name of a parameter/,
      'strict',
    ],
    [
      'a complex body',
      fn(
        ['Sum', ['Multiply', 'k', 'z'], ['Limits', 'k', 1, 3]],
        ['z', 'complex']
      ),
      /a product with a complex operand|Sum whose body has the type `complex`/,
      'strict',
    ],
    [
      'a complex body (a name with no declared type, complex mode)',
      [
        'Function',
        ['Block', ['Sum', ['Negate', 'x'], ['Limits', 'k', 1, 3]]],
        'x',
      ],
      /Sum whose body has the type `complex` is not in the structured route/,
      'complex',
    ],
    [
      'a complex bound',
      [
        'Function',
        ['Block', ['Sum', ['Divide', 1, 'k'], ['Limits', 'k', 1, 'n']]],
        'n',
      ],
      /An index or a bound must be an integer or a real/,
      'complex',
    ],
    [
      'Which with the value Nothing',
      fn(['Which', ['Less', 'x', 0.5], 'x', 'True', 'Nothing'], ['x', 'real']),
      /Which with the value Nothing is not in the structured route/,
      'strict',
    ],
    [
      'Which with True before its last clause',
      fn(
        ['Which', ['Less', 'x', 0.5], 'x', 'True', 1, ['Less', 'x', 2], 2],
        ['x', 'real']
      ),
      /Which with the condition True before its last clause/,
      'strict',
    ],
    [
      'Which with the condition False',
      fn(['Which', 'False', 'x', ['Less', 'x', 2], 2], ['x', 'real']),
      /Which with the condition False/,
      'strict',
    ],
    [
      'Which with a boolean value',
      fn(
        ['Which', ['Less', 'x', 0.5], ['Less', 'x', 0], 'True', 'False'],
        ['x', 'real']
      ),
      /Which with a value of the type `boolean`/,
      'strict',
    ],
    [
      'Which with a complex value',
      fn(
        ['Which', ['Less', 'x', 0.5], 'z', 'True', 0],
        ['x', 'real'],
        ['z', 'complex']
      ),
      /Which with a value of the type `complex`/,
      'strict',
    ],
    [
      'Which with a condition of three operands',
      fn(['Which', ['LessEqual', 0, 'y', 5], 'y', 'True', 0], ['y', 'real']),
      /LessEqual with 3 operands/,
      'strict',
    ],
    [
      'If(c, v) with a complex condition (complex mode)',
      ['Function', ['Block', ['If', ['LessEqual', 'y', 1], 'y']], 'y'],
      /LessEqual with a complex operand/,
      'complex',
    ],
  ];
  test.each(DECLINES)('%s', (_name, json, message, mode) => {
    const ce = engine();
    expect(() =>
      structured().compile(ce.expr(json), { ...OPTIONS, mode })
    ).toThrow(message);
  });

  test('under the profile, a decline names no internal compiler', () => {
    const ce = engine();
    let diagnostic: { code: string; message: string } | undefined;
    try {
      compile(
        ce.expr(
          fn(['Sum', 'k', ['Limits', 'k', 1, ['Add', 'B', -1]]], ['x', 'real'])
        ),
        {
          profile: 'numeric-kernel',
          fallback: false,
        } as never
      );
    } catch (e) {
      diagnostic = (e as { diagnostic?: { code: string; message: string } })
        .diagnostic;
    }
    expect(diagnostic?.code).toBe('outside-profile');
    expect(diagnostic?.message).not.toMatch(
      /structured|existing|fragment|JS scalar/
    );
  });
});
