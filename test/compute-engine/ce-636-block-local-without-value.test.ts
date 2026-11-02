/**
 * CE-636. A `Block` local that its `Declare` gives no value, and that is
 * assigned on some paths only, could be read with no value. At x = 1,
 * `Block(s ≔ 0; Loop(Block(Declare(n, integer); If(i > 3, n ≔ 1);
 * If(n ≠ 1, s ≔ s + i)), i ∈ 1..5); s)` gives 0 in the interpreter, but
 * JavaScript gave 6 (`undefined != 1` is `true`), WGSL read 0 and GLSL read
 * an undefined value.
 *
 * Each read of such a local is now put in one of three classes at compile
 * time (`classifyLocalReads` in `compile-locals.ts`):
 * 1. The local is assigned on every path before the read: the read
 *    compiles.
 * 2. The local is assigned on no path before the read: the compilation
 *    fails, on every target.
 * 3. The local is assigned on some paths only: the compilation fails, on
 *    every target. The interpreter has no value for the read on a path
 *    with no assignment, and compiled code would read an uninitialized
 *    variable.
 *
 * An input that the caller leaves out does not make a path: the caller
 * must supply each input with a value of its declared type.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { execFileSync } from 'child_process';
import { TEST_PYTHON } from './test-python';

const D = (n: string, t = "'integer'") => ['Declare', n, t];
const SOME_PATHS =
  /a statement can read the block local "\w+" when no assignment gave it a value/;
const NO_PATH = /no path to that read gives "\w+" a value/;

function box(json: unknown) {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return { ce, expr: ce.box(json as any) };
}

/** The value of the interpreter at `x`. */
function interpret(json: unknown, x: number): string {
  const { ce, expr } = box(json);
  ce.assign('x', x);
  return expr.evaluate().toString();
}

/** The value of the compiled JavaScript at `x`, or the message it throws. */
function runJs(json: unknown, x: number): { code: string; value: unknown } {
  const { expr } = box(json);
  const js = compile(expr, { to: 'javascript', fallback: false });
  try {
    return {
      code: js.code,
      value: (js.run as (v: Record<string, unknown>) => unknown)({ x }),
    };
  } catch (e) {
    return { code: js.code, value: `throws ${(e as Error).message}` };
  }
}

function pythonFunction(json: unknown): string {
  const { expr } = box(json);
  return new PythonTarget().compileFunction(expr, 'f', ['x']);
}

/** The value of the compiled Python at `x`, or the last line of its error. */
function runPython(fn: string, x: number | string): string {
  try {
    return execFileSync(
      TEST_PYTHON!,
      ['-c', `import numpy as np\n${fn}\nprint(repr(f(${x})))`],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )
      .toString()
      .trim();
  } catch (e) {
    const lines = String((e as { stderr?: Buffer }).stderr ?? '')
      .trim()
      .split('\n');
    return `raises ${lines[lines.length - 1]}`;
  }
}

const loopRange = (a: number, b: number) => ['Range', a, b];

/** Expect that the compilation of `json` fails on each target in `to`
 * with the refusal of a read of class 3. */
function expectDecline(
  json: unknown,
  to = ['javascript', 'interval-js', 'glsl', 'wgsl', 'python']
): void {
  const { expr } = box(json);
  for (const target of to) {
    // The interval target reports the failure in its result; the other
    // targets throw it.
    if (target === 'interval-js') {
      const r = compile(expr, { to: target, fallback: false });
      expect(r.success).toBe(false);
      expect(r.error).toMatch(SOME_PATHS);
    } else
      expect(() => compile(expr, { to: target, fallback: false })).toThrow(
        SOME_PATHS
      );
  }
}

// The programs of class 1. Each one is assigned on every path before each
// read: they compile on JavaScript and Python, and give the value of the
// interpreter.
const CERTAIN: Array<[string, unknown, number, number, boolean]> = [
  // [label, program, x, value, compiles on the shader targets]
  [
    'a conditional update that keeps the old value',
    [
      'Block',
      D('n'),
      ['Assign', 'n', 0],
      ['Assign', 'n', ['If', ['Greater', 'x', 5], 1, 'n']],
      ['Add', 'n', 1],
    ],
    7,
    2,
    true,
  ],
  [
    // The condition reads a local, not the input `x`: on JavaScript an
    // input that the caller leaves out makes `x > 5` undecided, and then
    // neither arm runs (see the test of `x > 5` below).
    'an assignment in both arms of an If',
    [
      'Block',
      D('n'),
      ['Assign', 's', ['Multiply', 2, 'x']],
      ['If', ['Greater', 's', 5], ['Assign', 'n', 1], ['Assign', 'n', 2]],
      ['Add', 'n', 1],
    ],
    1,
    3,
    true,
  ],
  [
    'an assignment in a nested block',
    [
      'Block',
      D('n'),
      ['Block', ['Assign', 'n', ['Multiply', 2, 'x']]],
      ['Add', 'n', 1],
    ],
    3,
    7,
    true,
  ],
  [
    'an assignment in a loop over a constant non-empty range',
    [
      'Block',
      D('n'),
      [
        'Loop',
        ['Assign', 'n', ['Multiply', 'i', 'x']],
        ['Element', 'i', loopRange(1, 4)],
      ],
      ['Add', 'n', 1],
    ],
    2,
    9,
    true,
  ],
  [
    'an assignment in a loop over a list literal',
    [
      'Block',
      D('n'),
      [
        'Loop',
        ['Assign', 'n', ['Multiply', 'i', 'x']],
        ['Element', 'i', ['List', 2, 3]],
      ],
      ['Add', 'n', 1],
    ],
    2,
    7,
    // The shader targets have no loop over a list (`Loop: expected
    // Range(lo, hi)`), as before.
    false,
  ],
  [
    'a first assignment in a loop body before the read',
    [
      'Block',
      D('n'),
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 'n', ['Multiply', 'i', 'x']],
          ['If', ['Greater', 'n', 2], ['Assign', 's', ['Add', 's', 'n']]],
        ],
        ['Element', 'i', loopRange(1, 4)],
      ],
      's',
    ],
    2,
    18,
    true,
  ],
];

describe('CE-636: a read after an assignment on every path compiles', () => {
  for (const [label, json, x, value, shaders] of CERTAIN) {
    test(label, () => {
      expect(interpret(json, x)).toBe(String(value));
      const js = runJs(json, x);
      expect(js.value).toBe(value);
      const fn = pythonFunction(json);
      if (shaders) {
        const { expr } = box(json);
        for (const to of ['glsl', 'wgsl'])
          expect(compile(expr, { to, fallback: false }).success).toBe(true);
      }
      if (TEST_PYTHON === undefined) return;
      expect(Number(runPython(fn, x))).toBe(value);
    });
  }
});

// The programs of class 3. `NOT_EQUAL` and `COPY` take the else branch of
// their `If`.
const MAIN = [
  'Block',
  ['Assign', 's', 0],
  [
    'Loop',
    [
      'Block',
      D('n'),
      ['If', ['Greater', 'i', 3], ['Assign', 'n', 1]],
      ['If', ['NotEqual', 'n', 1], ['Assign', 's', ['Add', 's', 'i']]],
    ],
    ['Element', 'i', loopRange(1, 5)],
  ],
  's',
];
const assignIfX = (elseBranch: unknown[]) => [
  'If',
  ['Greater', 'x', 3],
  ['Assign', 'n', 1],
  ...elseBranch,
];
const NOT_EQUAL = (e: unknown[]) => [
  'Block',
  D('n'),
  assignIfX(e),
  ['NotEqual', 'n', 1],
];
const COPY = (e: unknown[]) => [
  'Block',
  D('n'),
  D('m'),
  assignIfX(e),
  ['Assign', 'm', 'n'],
  ['If', ['NotEqual', 'm', 1], 5, 6],
];
const FUNCTION_LATE = [
  'Block',
  D('n'),
  D('f', "'any'"),
  ['Assign', 'f', ['Function', ['If', ['Greater', 'n', 1], 10, 20]]],
  ['Assign', 'n', 2],
  ['Apply', 'f'],
];
const FUNCTION_EARLY = [
  'Block',
  D('n'),
  D('f', "'any'"),
  ['Assign', 'f', ['Function', ['If', ['Greater', 'n', 1], 10, 20]]],
  ['Assign', 'g', ['Apply', 'f']],
  ['Assign', 'n', 2],
  'g',
];
const ACCUMULATOR = [
  'Block',
  D('m', "'real'"),
  [
    'Loop',
    [
      'If',
      ['Equal', 'i', 1],
      ['Assign', 'm', 'i'],
      [
        'If',
        ['Greater', ['Multiply', 'i', 'x'], 'm'],
        ['Assign', 'm', ['Multiply', 'i', 'x']],
      ],
    ],
    ['Element', 'i', loopRange(1, 5)],
  ],
  'm',
];

describe('CE-636: a read after an assignment on some paths declines', () => {
  test('the loop example: the interpreter gives 0, and every target declines', () => {
    // At x = 1, the interpreter answers 0: `n ≠ 1` is undecided in the
    // first three passes, and the `If` runs no branch. Without the refusal,
    // JavaScript gave 6 (`undefined != 1` is `true`).
    expect(interpret(MAIN, 1)).toBe('0');
    expectDecline(MAIN);
  });

  test('a function literal called after the assignment', () => {
    // The literal reads `n` when it is called, and the analysis does not
    // follow the calls, so the read is of class 3.
    expect(interpret(FUNCTION_LATE, 1)).toBe('10');
    expectDecline(FUNCTION_LATE);
  });

  test('a first-pass accumulator', () => {
    // The first pass assigns `m`, and the later passes read it in the
    // other branch. The analysis does not follow the value of `i`, so the
    // read is of class 3.
    expect(interpret(ACCUMULATOR, 2)).toBe('10');
    expect(interpret(ACCUMULATOR, -1)).toBe('1');
    expectDecline(ACCUMULATOR);
  });

  test.each([
    ['a read of the value of the block', NOT_EQUAL([])],
    ['a read of the value of the block, with a Nothing else branch', NOT_EQUAL(['Nothing'])],
    ['a copy of the local', COPY([])],
    ['a copy of the local, with a Nothing else branch', COPY(['Nothing'])],
    ['a function literal called before the assignment', FUNCTION_EARLY],
  ])('%s', (_label, json) => {
    expectDecline(json);
  });
});

describe('CE-636: a read with no assignment on any path before it declines', () => {
  const cases: Array<[string, unknown]> = [
    [
      'a read with no write',
      [
        'Block',
        D('n'),
        ['If', ['Greater', 'x', 3], ['Assign', 's', 1]],
        ['Add', 'n', 1],
      ],
    ],
    [
      'a read in a loop body where nothing writes the local',
      [
        'Block',
        ['Assign', 's', 0],
        D('n'),
        [
          'Loop',
          ['Assign', 's', ['Add', 's', 'n']],
          ['Element', 'i', loopRange(1, 3)],
        ],
        's',
      ],
    ],
    [
      'a read in the branch that does not assign the local',
      [
        'Block',
        D('n'),
        D('m'),
        ['If', ['Greater', 'x', 3], ['Assign', 'n', 1], ['Assign', 'm', 'n']],
        2,
      ],
    ],
  ];
  for (const [label, json] of cases) {
    test(label, () => {
      const { expr } = box(json);
      const refusal = /reads the block local "n"/;
      for (const to of ['javascript', 'glsl', 'wgsl', 'python'])
        expect(() => compile(expr, { to, fallback: false })).toThrow(refusal);
      const interval = compile(expr, { to: 'interval-js', fallback: false });
      expect(interval.success).toBe(false);
      expect(interval.error).toMatch(refusal);
    });
  }

  test('the new refusal names the local', () => {
    const { expr } = box([
      'Block',
      D('n'),
      D('m'),
      ['If', ['Greater', 'x', 3], ['Assign', 'n', 1], ['Assign', 'm', 'n']],
      2,
    ]);
    expect(() => compile(expr, { to: 'javascript', fallback: false })).toThrow(
      NO_PATH
    );
  });
});

describe('CE-636: the analysis takes linear time', () => {
  // Each `If` is a join of two paths. A walk that followed each path
  // separately would take 2^30 steps.
  const statements = (body: (k: number) => unknown) =>
    Array.from({ length: 30 }, (_, k) => body(k + 1));

  test('30 statements that assign on every path', () => {
    const json = [
      'Block',
      D('n'),
      ['Assign', 's', ['Multiply', 2, 'x']],
      ['If', ['Greater', 's', 0], ['Assign', 'n', 1], ['Assign', 'n', 2]],
      ...statements((k) => [
        'If',
        ['Greater', 'n', k],
        ['Assign', 'n', ['Add', 'n', 1]],
        ['Assign', 'n', ['Subtract', 'n', 1]],
      ]),
      'n',
    ];
    const start = Date.now();
    const js = runJs(json, 1);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(String(js.value)).toBe(interpret(json, 1));
  });

  test('30 statements that assign on some paths', () => {
    const json = [
      'Block',
      D('n'),
      ...statements((k) => ['If', ['Greater', 'x', k], ['Assign', 'n', k]]),
      ['Add', 'n', 1],
    ];
    const start = Date.now();
    expectDecline(json, ['javascript']);
    expect(Date.now() - start).toBeLessThan(5000);
  });
});

describe('CE-636: a branch statement that can run no branch', () => {
  // A condition that the compiled code cannot decide when it runs selects
  // no branch, as in the interpreter, so an assignment in both branches is
  // not certain. Only such a condition counts (`conditionDecidability`).

  test('both branches assign, and the condition reads an input', () => {
    // The caller must supply `x`, so `x > 5` is decided and one branch
    // runs. The result of a call that leaves `x` out is not specified.
    const json = [
      'Block',
      D('n'),
      ['If', ['Greater', 'x', 5], ['Assign', 'n', 1], ['Assign', 'n', 2]],
      ['Add', 'n', 1],
    ];
    const { expr } = box(json);
    const js = compile(expr, { to: 'javascript', fallback: false });
    const run = js.run as (v: Record<string, unknown>) => unknown;
    expect(run({ x: 1 })).toBe(3);
    expect(run({ x: 6 })).toBe(2);
    expect(interpret(json, 1)).toBe('3');
    for (const to of ['interval-js', 'glsl', 'wgsl', 'python'])
      expect(compile(expr, { to, fallback: false }).success).toBe(true);
  });

  test('a loop pass where the condition is undecided after a pass that assigned', () => {
    // `b` is a `boolean | missing` input. The condition `Or(i = 1, b)` is
    // read by its value, which the analysis takes as one that can be
    // undecided, so the read of `n` is of class 3 on the targets that can
    // run no branch. GLSL and WGSL always run one branch. (A `boolean` input
    // holds `true` or `false`, so the condition is decided and the block
    // compiles.)
    const json = [
      'Block',
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          D('n'),
          [
            'If',
            ['Or', ['Equal', 'i', 1], 'b'],
            ['Assign', 'n', 1],
            ['Assign', 'n', 2],
          ],
          ['Assign', 's', ['Add', 's', 'n']],
        ],
        ['Element', 'i', loopRange(1, 3)],
      ],
      's',
    ];
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('b', 'boolean | missing');
    const expr = ce.box(json as any);
    for (const to of ['javascript', 'python'])
      expect(() => compile(expr, { to, fallback: false })).toThrow(SOME_PATHS);
    expect(() =>
      new PythonTarget().compileFunction(expr, 'f', ['x', 'b'])
    ).toThrow(SOME_PATHS);
    ce.assign('b', false);
    expect(expr.evaluate().re).toBe(5);
  });

  test('a Which whose last condition is True has no path with no branch', () => {
    // The condition reads a local, so it is decided on every target.
    const json = [
      'Block',
      D('n'),
      ['Assign', 's', ['Multiply', 2, 'x']],
      [
        'Which',
        ['Greater', 's', 1],
        ['Assign', 'n', 1],
        'True',
        ['Assign', 'n', 2],
      ],
      ['Add', 'n', 1],
    ];
    expect(interpret(json, 0.25)).toBe('3');
    const js = runJs(json, 0.25);
    expect(js.value).toBe(3);
    const { expr } = box(json);
    const interval = compile(expr, { to: 'interval-js', fallback: false });
    expect(interval.success).toBe(true);
    for (const to of ['glsl', 'wgsl'])
      expect(compile(expr, { to, fallback: false }).success).toBe(true);
    // Python has no expression form for an assignment in a `Which`, as
    // before.
  });
});

describe('CE-636: a Return in a block in value position', () => {
  // The value block compiles to an immediately applied function on
  // JavaScript: its `Return` gives the value of that block only, and the
  // statements after it still run. It does not end the paths of the
  // enclosing block, so the read of `n` after it is of class 3.
  test('the read after the block declines', () => {
    const json = [
      'Block',
      D('n'),
      ['If', ['Greater', 'x', 0], ['Assign', 'n', 1]],
      ['Assign', 'tmp', ['Block', 42, ['Return', 0]]],
      'n',
    ];
    expectDecline(json);
  });
});

describe('CE-636: an index with the name of the local', () => {
  // The bounds of `Sum(n, Limits(n, 1, n))` are evaluated in the enclosing
  // scope: the upper bound reads the local `n`, and the body reads the
  // index.
  test('a bound that reads the local in a loop pass with no assignment', () => {
    const json = [
      'Block',
      ['Assign', 's', 0],
      [
        'Loop',
        [
          'Block',
          D('n'),
          ['If', ['Less', 'i', 3], ['Assign', 'n', 2], 'Nothing'],
          ['Assign', 's', ['Add', 's', ['Sum', 'n', ['Limits', 'n', 1, 'n']]]],
        ],
        ['Element', 'i', loopRange(1, 4)],
      ],
      's',
    ];
    expectDecline(json);
  });

  test('a bound that reads the local with no assignment declines', () => {
    const { expr } = box([
      'Block',
      D('n'),
      ['Sum', 'n', ['Limits', 'n', 1, 'n']],
    ]);
    for (const to of ['javascript', 'glsl', 'wgsl', 'python'])
      expect(() => compile(expr, { to, fallback: false })).toThrow(NO_PATH);
  });
});

describe('CE-636: an input condition next to another binding of its name', () => {
  // `x` in the condition is the input, which the caller supplies, so one
  // branch runs and the read of the local is of class 1. Another construct
  // of the block that binds its own `x` (a `Sum` index, a local of a
  // nested block) does not change that.
  const both = (cond: unknown) => [
    'If',
    cond,
    ['Assign', 't', 1],
    ['Assign', 't', 2],
  ];
  const cases: Array<[string, unknown, number]> = [
    [
      'a Sum whose index is x',
      [
        'Block',
        D('t'),
        both(['Greater', 'x', 0]),
        ['Add', 't', ['Sum', 'x', ['Limits', 'x', 1, 3]]],
      ],
      7,
    ],
    [
      'a nested block that declares x',
      [
        'Block',
        D('t'),
        both(['Greater', 'x', 0]),
        ['Block', D('x'), ['Assign', 'x', 4], 'x'],
        't',
      ],
      1,
    ],
    [
      'a nested block that declares x with a value',
      [
        'Block',
        D('n'),
        ['If', ['Greater', 'x', 5], ['Assign', 'n', 1], ['Assign', 'n', 2]],
        ['Block', ['Declare', 'x', "'real'", 0], 0],
        ['Add', 'n', 1],
      ],
      3,
    ],
  ];
  for (const [label, json, value] of cases) {
    test(label, () => {
      const { expr } = box(json);
      const js = compile(expr, { to: 'javascript', fallback: false });
      const run = js.run as (v: Record<string, unknown>) => unknown;
      expect(run({ x: 1 })).toBe(value);
      expect(interpret(json, 1)).toBe(String(value));
    });
  }
});

describe('CE-636: an assignment in an operand that is always evaluated', () => {
  // `Add` evaluates each operand once, so an assignment in a block operand
  // is certain after the `Add`. GLSL and WGSL compiled these programs
  // before CE-636.
  const cases: Array<[string, unknown, number, number]> = [
    [
      'a block operand of a statement',
      ['Block', D('t'), ['Add', ['Block', ['Assign', 't', 1], 1], 2], 't'],
      1,
      1,
    ],
    [
      'a block operand of an assigned value',
      [
        'Block',
        D('t', "'real'"),
        ['Assign', 'u', ['Add', ['Block', ['Assign', 't', 'x'], 't'], 1]],
        ['Add', 'u', 't'],
      ],
      1,
      3,
    ],
  ];
  for (const [label, json, x, value] of cases) {
    test(label, () => {
      const js = runJs(json, x);
      expect(js.value).toBe(value);
      expect(interpret(json, x)).toBe(String(value));
      const { expr } = box(json);
      for (const to of ['glsl', 'wgsl'])
        expect(compile(expr, { to, fallback: false }).success).toBe(true);
    });
  }
});

describe('CE-636: an undeclared input in a condition', () => {
  // The engine declares an undeclared symbol in the scope of the block
  // that holds it. It is still an input, and it has no type, so the
  // compilation is refused: the compiled code must know the shape of each
  // input from its type. The interpreter evaluates the block.
  const IF = (c: unknown) => ['If', c, ['Assign', 'y', 1], ['Assign', 'y', 2]];
  const cases: Array<[string, unknown]> = [
    ['in the block', ['Block', D('y'), IF(['Less', 'z', 0]), 'y']],
    [
      'in a nested block',
      [
        'Block',
        ['Assign', 'q', 1],
        ['Block', D('y'), IF(['Less', 'z', 0]), 'y'],
      ],
    ],
    [
      'used first in a Sum bound',
      [
        'Block',
        D('y'),
        ['Assign', 't', ['Sum', 'k', ['Limits', 'k', 1, 'z']]],
        IF(['Less', 'z', 0]),
        'y',
      ],
    ],
  ];
  for (const [label, json] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      const refused = compile(ce.box(json as any), { to: 'javascript' });
      expect(refused.success).toBe(false);
      expect(refused.diagnostic?.code).toBe('untyped-input');
      expect(refused.unsupported).toContain('z');
      expect(refused.run!({ z: -1 })).toBe(1);
    });
  }
});

describe('CE-636: an operand that a lowering can skip', () => {
  test('the base of a power with the exponent 0', () => {
    // JavaScript and the shader targets compile `Power(b, 0)` to `1` and
    // do not evaluate `b`, so its assignment is not certain.
    const json = [
      'Block',
      D('y'),
      ['Assign', 's', ['Power', ['Block', ['Assign', 'y', 1], 'x'], 0]],
      'y',
    ];
    expectDecline(json);
  });
});

describe('CE-636: a Return does not end a path', () => {
  test('a Return in a nested block before the assignment', () => {
    const json = [
      'Block',
      D('n'),
      ['Block', 42, ['Return', 0]],
      ['If', ['Greater', 'x', 0], ['Assign', 'n', 1]],
      'n',
    ];
    expectDecline(json);
  });
});

describe('CE-636: a Return in a nested block', () => {
  // JavaScript compiles the nested block to a function of its own: its
  // `Return` leaves that function only, and the assignment after it is
  // not made. The read after the block is of class 3.
  test('a nested block of the block', () => {
    const json = [
      'Block',
      D('y'),
      ['Block', ['If', ['Greater', 'x', 0], ['Return', 0]], ['Assign', 'y', 1]],
      'y',
    ];
    expectDecline(json);
  });

  test('a nested block of a function body', () => {
    const json = [
      'Apply',
      [
        'Function',
        [
          'Block',
          D('y'),
          [
            'Block',
            ['If', ['Greater', 'p', 0], ['Return', 0]],
            ['Assign', 'y', 1],
          ],
          'y',
        ],
        'p',
      ],
      'x',
    ];
    expect(interpret(json, 1)).toBe('0');
    // Python, GLSL and WGSL refuse a function body with more than one
    // statement first.
    expectDecline(json, ['javascript', 'interval-js']);
  });
});

describe('CE-636: an arm that never runs', () => {
  test('the else arm of If(True, …) is not walked', () => {
    // The else arm reads `n` with no assignment before it, but it never
    // runs.
    const json = [
      'Block',
      D('n'),
      ['If', 'True', ['Assign', 'n', 1], 'n'],
      'n',
    ];
    expect(interpret(json, 1)).toBe('1');
    const js = runJs(json, 1);
    expect(js.value).toBe(1);
    const { expr } = box(json);
    for (const to of ['glsl', 'wgsl'])
      expect(compile(expr, { to, fallback: false }).success).toBe(true);
  });
});

describe('CE-636: the compilation does not declare a block local', () => {
  // The analysis asks the target how it reads a condition operand. For a
  // block local it must not ask: the JavaScript targets declared the name
  // in the engine when they were asked.
  const json = [
    'Block',
    ['Declare', 'u', "'real'"],
    D('v'),
    ['If', ['Greater', 'x', 0], ['Assign', 'v', 1], ['Assign', 'v', 2]],
    ['Assign', 'u', ['Multiply', 2, 'x']],
    ['If', ['LessEqual', 'u', 1], ['Assign', 'v', 3], ['Assign', 'v', 4]],
    'v',
  ];
  for (const to of ['javascript', 'interval-js', 'glsl', 'wgsl', 'python'])
    test(to, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      compile(ce.box(json as any), { to, fallback: true });
      expect(ce.lookupDefinition('u')).toBe(undefined);
      expect(ce.lookupDefinition('v')).toBe(undefined);
    });
});
