/**
 * A PARTIAL APPLICATION of a function literal: in the interpreter, and in
 * compiled code.
 *
 * The interpreter curries a call of a function literal with fewer arguments
 * than parameters (`makeLambda`, step 3, `function-utils.ts`). The value is
 * the DEFERRED residual `(_1) ↦ Apply(f, 1, _1)`, which applies the
 * original literal when the last argument arrives, for every body. So a
 * curried value equals the full call, also for a chain of currying steps.
 *
 * Compiled code does not compile a partial application or a curried call
 * (`Apply(Apply(f, 1), u)`, `Apply(f, 1)`, a block local that holds one) on
 * any target. The compilation declines with a reason that says so, and with
 * `fallback: true` the expression runs in the interpreter. Compiled code
 * calls a function only with all its arguments. A call that supplies every
 * argument still compiles on every target.
 *
 * Before, a partial application whose arguments were machine numbers or
 * strings compiled to one call of the literal, or to a deferred residual
 * function. The interpreter keeps first-class functions and currying, so
 * only the compiled forms were removed.
 */
import { execFileSync } from 'node:child_process';
import { ComputeEngine } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

// `0·Random()` gives the body an effect (a random draw) and adds nothing to
// its value, which stays exact.
const NOISE: MathJsonExpression = ['Multiply', 0, ['Random']];
/** `(x, y) ↦ x + y + 0·Random()`, a body with an effect. */
const ADD: MathJsonExpression = [
  'Function',
  ['Add', 'x', 'y', NOISE],
  'x',
  'y',
];
/** `(x, y, z) ↦ x + 2y + 3z + 0·Random()`. */
const ADD3: MathJsonExpression = [
  'Function',
  ['Add', 'x', ['Multiply', 2, 'y'], ['Multiply', 3, 'z'], NOISE],
  'x',
  'y',
  'z',
];
/** `(x, y) ↦ x + y`, a pure body. */
const PURE_ADD: MathJsonExpression = ['Function', ['Add', 'x', 'y'], 'x', 'y'];
/** `(x, y) ↦ x·y`. */
const M: MathJsonExpression = ['Function', ['Multiply', 'x', 'y'], 'x', 'y'];
/** `(x, y) ↦ x·y/y`. */
const D: MathJsonExpression = [
  'Function',
  ['Divide', ['Multiply', 'x', 'y'], 'y'],
  'x',
  'y',
];
/**
 * `(x, y, z) ↦ Block(y := y·z, x + y)`: the body writes its own parameter
 * `y`, an effect at run time that the signature of the literal does not
 * show.
 */
const F: MathJsonExpression = [
  'Function',
  ['Block', ['Assign', 'y', ['Multiply', 'y', 'z']], ['Add', 'x', 'y']],
  'x',
  'y',
  'z',
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  return ce;
}

/** The interpreter's value of `expr` with `u` bound to `u`. */
function evaluated(json: MathJsonExpression, u: number): number {
  const ce = engine();
  return ce
    .box(json)
    .subs({ u: ce.number(u) })
    .evaluate()
    .N().re;
}

const TARGETS = ['javascript', 'interval-js', 'glsl', 'python'] as const;

/**
 * Expect every target to decline `json` with `message`. A target declines by
 * throwing, or with a result whose `success` is false and whose `error` is
 * the reason.
 */
function expectDeclines(json: MathJsonExpression, message: RegExp): void {
  for (const to of TARGETS) {
    let reason: string | undefined;
    try {
      const r =
        to === 'python'
          ? new PythonTarget().compile(engine().box(json))
          : compile(engine().box(json), { to, fallback: false });
      expect(r.success).toBe(false);
      reason = (r as { error?: string }).error;
    } catch (e) {
      reason = (e as Error).message;
    }
    // The GLSL fragment refuses the form before the emitter runs.
    expect(reason).toMatch(to === 'glsl' ? /GLSL fragment/ : message);
  }
}

describe('PARTIAL APPLICATION — the interpreter', () => {
  test('a body with an effect curries to the deferred residual', () => {
    const ce = engine();
    expect(ce.box(['Apply', ADD, 1]).evaluate().json).toEqual([
      'Function',
      [
        'Block',
        [
          'Apply',
          ['Function', ['Block', ['Add', 'x', 'y', NOISE]], 'x', 'y'],
          1,
          '_1',
        ],
      ],
      '_1',
    ]);
  });

  test('a pure body curries to the deferred residual', () => {
    const ce = engine();
    expect(ce.box(['Apply', PURE_ADD, 1]).evaluate().json).toEqual([
      'Function',
      [
        'Block',
        [
          'Apply',
          ['Function', ['Block', ['Add', 'x', 'y']], 'x', 'y'],
          1,
          '_1',
        ],
      ],
      '_1',
    ]);
  });

  test('a curried value equals the full call', () => {
    // Before, the pure body was evaluated with the supplied arguments, and
    // simplified before the remaining arguments were known: `M(0)(∞)` was
    // `0` and `D(2)(0)` was `2`.
    const ce = engine();
    const value = (json: MathJsonExpression) => ce.box(json).evaluate().json;
    expect(value(['Apply', ['Apply', M, 0], 'PositiveInfinity'])).toBe('NaN');
    expect(value(['Apply', M, 0, 'PositiveInfinity'])).toBe('NaN');
    expect(value(['Apply', ['Apply', D, 2], 0])).toBe('NaN');
    expect(value(['Apply', D, 2, 0])).toBe('NaN');
    // A chain of two currying steps: the second step curries the residual
    // of the first one the same way. Before, the residual was pure for the
    // interpreter and `F(1)(0)(∞)` was `1`.
    expect(
      value(['Apply', ['Apply', ['Apply', F, 1], 0], 'PositiveInfinity'])
    ).toBe('NaN');
    expect(value(['Apply', F, 1, 0, 'PositiveInfinity'])).toBe('NaN');
    expect(value(['Apply', ['Apply', ['Apply', F, 1], 2], 3])).toBe(7);
  });

  test('a block local that the body reads is read at the full call', () => {
    // Before, the pure body was evaluated when `g` was assigned, and `c`
    // was read as 3 (9 for u = 5).
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'c', 3],
      [
        'Assign',
        'g',
        ['Apply', ['Function', ['Add', 'x', 'y', 'c'], 'x', 'y'], 1],
      ],
      ['Assign', 'c', 10],
      ['g', 'u'],
    ];
    expect(evaluated(json, 5)).toBe(16);
  });

  test('a supplied argument is read at the partial application', () => {
    // The residual holds the value of the argument `c` when `g` is
    // assigned (3), and the full call `g(5)` adds 5: 8.
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'c', 3],
      ['Assign', 'g', ['Apply', PURE_ADD, 'c']],
      ['Assign', 'c', 10],
      ['g', 5],
    ];
    expect(engine().box(json).evaluate().json).toBe(8);
  });
});

const REFUSAL = /a partial application or a curried call/;

describe('PARTIAL APPLICATION — compiled code declines', () => {
  const ADD3_PURE: MathJsonExpression = [
    'Function',
    ['Add', 'x', 'y', 'z'],
    'x',
    'y',
    'z',
  ];

  // Every case is a partial application, a call of one, or a block local that
  // holds one.
  test.each<[string, MathJsonExpression]>([
    ['a curried call', ['Apply', ['Apply', PURE_ADD, 1], 'u']],
    [
      'a curried call of a body with an effect',
      ['Apply', ['Apply', ADD, 1], 'u'],
    ],
    [
      'a curried call that supplies every argument',
      ['Apply', ['Apply', ADD3, 1], 'u', 4],
    ],
    [
      'a chain of two currying steps',
      ['Apply', ['Apply', ['Apply', ADD3_PURE, 1], 2], 'u'],
    ],
    [
      'a chain over a body that writes a parameter',
      ['Apply', ['Apply', ['Apply', F, 1], 0], 'u'],
    ],
    ['a partial application at the root', ['Apply', PURE_ADD, 1]],
    ['a partial application with no argument', ['Apply', PURE_ADD]],
    [
      'a partial application with a variable argument',
      ['Apply', PURE_ADD, 'u'],
    ],
    [
      'a partial application held by a block local',
      ['Block', ['Assign', 'g', ['Apply', PURE_ADD, 1]], ['g', 'u']],
    ],
  ])('%s declines on every target', (_, json) => {
    expectDeclines(json, REFUSAL);
  });

  test('with `fallback: true` the result is the interpreter, with the reason', () => {
    const ce = engine();
    const result = compile(ce.box(['Apply', ['Apply', PURE_ADD, 1], 'u']), {
      to: 'interval-js',
      fallback: true,
    });
    expect(result.success).toBe(false);
    expect((result as { error?: string }).error).toMatch(REFUSAL);
  });

  test('the interpreter still curries the declined forms', () => {
    const value = (json: MathJsonExpression) =>
      engine().box(json).subs({ u: 1.5 }).evaluate().N().re;
    expect(value(['Apply', ['Apply', PURE_ADD, 1], 'u'])).toBe(2.5);
    expect(value(['Apply', ['Apply', ['Apply', ADD3_PURE, 1], 2], 'u'])).toBe(
      4.5
    );
  });
});

describe('PARTIAL APPLICATION — a call with every argument compiles', () => {
  const u = 1.5;

  test('javascript', () => {
    const r = compile(engine().box(['Apply', PURE_ADD, 1, 'u']), {
      to: 'javascript',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect((r.run as any)({ u })).toBe(2.5);
  });

  test('interval-js', () => {
    const r = compile(engine().box(['Apply', PURE_ADD, 1, 'u']), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    const value = (r.run as any)({ u: { lo: u, hi: u } }).value;
    expect(value.lo).toBeLessThanOrEqual(2.5);
    expect(value.hi).toBeGreaterThanOrEqual(2.5);
  });

  test.each(['glsl'] as const)('%s', (to) => {
    // The GLSL fragment refuses `Apply` of a function literal.
    expect(() =>
      compile(engine().box(['Apply', PURE_ADD, 1, 'u']), {
        to,
        fallback: false,
      })
    ).toThrow(/`Apply` is in the GLSL fragment only as the application/);
  });

  test('python', () => {
    const py = new PythonTarget();
    const body = py.compile(engine().box(['Apply', PURE_ADD, 1, 'u'])).code;
    expect(body).toBe('((lambda x, y: x + y))(1, u)');
    if (TEST_PYTHON === undefined) return;
    const out = execFileSync(
      TEST_PYTHON,
      ['-c', `import numpy as np\nimport math\nu = 1.5\nprint(float(${body}))`],
      { encoding: 'utf8' }
    );
    expect(Number(out.trim())).toBe(2.5);
  });

  test.each<[string, MathJsonExpression, RegExp]>([
    [
      'too many arguments',
      ['Apply', PURE_ADD, 1, 2, 3],
      /the function takes 2 parameter\(s\) but 3 argument\(s\) are supplied\. The interpreter gives an `unexpected-argument` error/,
    ],
    [
      'arguments to a function with no parameter',
      ['Apply', ['Function', ['Sin', 'u']], 5],
      /The interpreter ignores the arguments of a function with no parameter/,
    ],
  ])('python declines %s', (_, json, message) => {
    expect(() => new PythonTarget().compile(engine().box(json))).toThrow(
      message
    );
  });
});
