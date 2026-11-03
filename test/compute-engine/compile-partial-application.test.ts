/**
 * The compilation of a PARTIAL APPLICATION of a function literal.
 *
 * The interpreter curries a call of a function literal with fewer arguments
 * than parameters (`makeLambda`, step 3, `function-utils.ts`). The value is
 * the DEFERRED residual `(_1) ↦ Apply(f, 1, _1)`, which applies the
 * original literal when the last argument arrives, for every body. So a
 * curried value equals the full call, also for a chain of currying steps.
 *
 * The compiled code is that call of the literal (`partial-application.ts`):
 *
 * - A partial application with each supplied argument a machine number or a
 *   string literal, applied to the remaining arguments, is one call of the
 *   literal (javascript, interval-js, glsl, wgsl, python).
 * - Such a partial application whose value is a function compiles to the
 *   deferred residual on javascript, interval-js and python. At the root,
 *   the result has the `calling: 'lambda'` contract of a compiled
 *   `Function`. The shader targets have no function values, and decline it
 *   with a message that says so.
 * - Any other partial application declines with the reason: a supplied
 *   argument that is not such a literal (an exact rational, `Pi`, a
 *   variable, a list), a generic literal, a rest parameter.
 *
 * Before, every target declined with "the function takes 2 parameter(s) but
 * 1 argument(s) are supplied", and the Python target emitted
 * `((lambda x, y: x + y))(1)`, which raises a `TypeError` at run time.
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
const ADD: MathJsonExpression = ['Function', ['Add', 'x', 'y', NOISE], 'x', 'y'];
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

function js(json: MathJsonExpression) {
  return compile(engine().box(json), { to: 'javascript', fallback: false });
}

const TARGETS = ['javascript', 'interval-js', 'glsl', 'wgsl', 'python'] as const;

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
    expect(reason).toMatch(message);
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
    expect(value(['Apply', ['Apply', M, 0], 'PositiveInfinity'])).toBe(
      'NaN'
    );
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

describe('PARTIAL APPLICATION — javascript', () => {
  test.each<[string, MathJsonExpression]>([
    ['applied to the remaining argument', ['Apply', ['Apply', ADD, 1], 'u']],
    ['applied to all, in one step', ['Apply', ['Apply', ADD3, 1], 'u', 4]],
    ['a float argument', ['Apply', ['Apply', ADD, 0.5], 'u']],
    ['a pure body', ['Apply', ['Apply', PURE_ADD, 1], 'u']],
    ['a pure product with a zero argument', ['Apply', ['Apply', M, 0], 'u']],
    [
      'a chain of two currying steps',
      ['Apply', ['Apply', ['Apply', ADD3, 1], 2], 'u'],
    ],
    [
      'a chain over a body that writes a parameter',
      ['Apply', ['Apply', ['Apply', F, 1], 0], 'u'],
    ],
    [
      'with annotated parameters',
      [
        'Apply',
        [
          'Apply',
          [
            'Function',
            ['Add', 'x', 'y', NOISE],
            ['Typed', 'x', 'real'],
            ['Typed', 'y', 'real'],
          ],
          1,
        ],
        'u',
      ],
    ],
    [
      'held by a block local',
      ['Block', ['Assign', 'g', ['Apply', ADD, 1]], ['g', 'u']],
    ],
    [
      'in the body of a literal',
      [
        'Apply',
        [
          'Function',
          [
            'Apply',
            [
              'Apply',
              ['Function', ['Add', ['Multiply', 'a', 'b'], NOISE], 'a', 'b'],
              2,
            ],
            'x',
          ],
          ['Typed', 'x', 'real'],
        ],
        'u',
      ],
    ],
  ])('%s', (_, json) => {
    const r = js(json);
    expect(r.success).toBe(true);
    for (const u of [0, 2.5, -3])
      expect(r.run!({ u })).toBeCloseTo(evaluated(json, u), 12);
  });

  test.each<[string, MathJsonExpression, number[]]>([
    ['one argument supplied', ['Apply', ADD, 1], [2]],
    ['no argument supplied', ['Apply', ADD], [2, 3]],
    ['two of three arguments supplied', ['Apply', ADD3, 1, 2], [5]],
    ['a float argument', ['Apply', ADD, 0.5], [2]],
    ['a pure body', ['Apply', PURE_ADD, 1], [2]],
    ['a chain of two currying steps', ['Apply', ['Apply', F, 1], 0], [3]],
  ])('%s: the value is a compiled function', (_, json, rest) => {
    const r = js(json);
    expect(r.success).toBe(true);
    expect(r.calling).toBe('lambda');
    const ce = engine();
    const expected = ce
      .box(['Apply', json, ...rest])
      .evaluate()
      .N().re;
    expect((r.run as any)(...rest)).toBeCloseTo(expected, 12);
  });

  test.each<[string, MathJsonExpression, RegExp]>([
    [
      'an argument that is not a literal',
      ['Apply', ADD3, 'u'],
      /the partial application supplies the argument `u`, which is not a machine number or a string literal/,
    ],
    [
      'an argument with an effect',
      ['Apply', ADD, ['Random']],
      /the partial application supplies the argument `Random\(\)`, which is not a machine number/,
    ],
    [
      'a symbol constant',
      ['Apply', ADD, 'Pi'],
      /the partial application supplies the argument `pi`, which is not a machine number/i,
    ],
    [
      'a literal with a rest parameter',
      [
        'Apply',
        [
          'Function',
          ['Add', 'x', ['Length', 'r'], NOISE],
          'x',
          'y',
          ['Spread', 'r'],
        ],
        1,
      ],
      /a partial application of a function with a rest parameter/,
    ],
    [
      'too many arguments',
      ['Apply', PURE_ADD, 1, 2, 3],
      /the function takes 2 parameter\(s\) but 3 argument\(s\)/,
    ],
  ])('declines %s', (_, json, message) => {
    expect(() => js(json)).toThrow(message);
  });
});

describe('PARTIAL APPLICATION — declines where the interpreter differs from the full call', () => {
  test('a collection argument: the interpreter gives a list of residuals', () => {
    // `Apply(f, [1, 2])` is a list of two functions, and applying that list
    // to `5` leaves the list of functions. The compiled code gave `[6, 7]`.
    for (const f of [ADD, PURE_ADD]) {
      const ce = engine();
      const value = ce.box(['Apply', f, ['List', 1, 2]]).evaluate();
      expect(value.operator).toBe('List');
      expect(value.nops).toBe(2);
      const applied = ce
        .box(['Apply', ['Apply', f, ['List', 1, 2]], 5])
        .evaluate();
      expect(applied.operator).toBe('List');
      expect(applied.ops!.every((op) => op.operator === 'Function')).toBe(
        true
      );
    }
    expectDeclines(
      ['Apply', ['Apply', ADD, ['List', 1, 2]], 'u'],
      /the argument `\[1,2\]`, which is not a machine number/
    );
    expectDeclines(
      ['Apply', ADD, ['List', 1, 2]],
      /the argument `\[1,2\]`, which is not a machine number/
    );
  });

  test('an exact argument: the interpreter curries with its approximation', () => {
    // Under `.N()`, the residual holds the approximation of q, which is 25
    // in machine precision, so the value is `25 + u`; the compiled call
    // reads the exact q, whose floor is 24.
    const q: MathJsonExpression = [
      'Divide',
      ['Subtract', ['Factorial', 25], 1],
      ['Factorial', 24],
    ];
    const f: MathJsonExpression = [
      'Function',
      ['Add', ['Floor', 'x'], 'y', NOISE],
      'x',
      'y',
    ];
    const ce = engine();
    // The floor of q is 24; the value is 25 + u, here with u = 0.
    expect(ce.box(['Floor', q]).evaluate().json).toBe(24);
    expect(
      ce
        .box(['Apply', ['Apply', f, q], 'u'])
        .subs({ u: 0 })
        .N().re
    ).toBe(25);
    expectDeclines(
      ['Apply', ['Apply', f, q], 'u'],
      /which is not a machine number or a string literal/
    );
  });

  test('a boolean argument declines: `True` can name a local', () => {
    // A parameter or a block local can be named `True`, and the compiled
    // residual would read it when it is called, after a reassignment.
    const F: MathJsonExpression = [
      'Function',
      ['Add', ['If', 'x', 10, 20], 'y', NOISE],
      'x',
      'y',
    ];
    expectDeclines(
      ['Apply', ['Apply', F, 'True'], 'u'],
      /the argument `"?True"?`, which is not a machine number/
    );
  });

  test('a decimal with more digits than a double declines', () => {
    // At a precision of 40, the floor of 24.999999999999999999 is 24; its
    // nearest double is 25.
    const q: MathJsonExpression = { num: '24.999999999999999999' };
    const f: MathJsonExpression = [
      'Function',
      ['Add', ['Floor', 'x'], 'y', NOISE],
      'x',
      'y',
    ];
    const ce = engine();
    ce.precision = 40;
    expect(
      ce
        .box(['Apply', ['Apply', f, q], 'u'])
        .subs({ u: 0 })
        .evaluate()
        .N().re
    ).toBe(24);
    const ce2 = engine();
    ce2.precision = 40;
    expect(() =>
      compile(ce2.box(['Apply', ['Apply', f, q], 'u']), {
        to: 'javascript',
        fallback: false,
        constantFold: false,
      })
    ).toThrow(/which is not a machine number or a string literal/);
  });

  test('a function value in a conditional callee declines', () => {
    // Each branch of the `If` is a residual of two parameters, and the
    // outer call supplies one argument: the interpreter curries again, and
    // the compiled call gave NaN.
    const F: MathJsonExpression = [
      'Function',
      ['Block', ['Assign', 'y', ['Multiply', 'y', 'z']], ['Add', 'x', 'y']],
      'x',
      'y',
      'z',
    ];
    const ce = engine();
    ce.declare('c', 'boolean');
    const json: MathJsonExpression = [
      'Apply',
      ['Apply', ['If', 'c', ['Apply', F, 1], ['Apply', F, 2]], 0],
      'u',
    ];
    expect(() =>
      compile(ce.box(json), { to: 'javascript', fallback: false })
    ).toThrow(
      /compiles only at the root of the compilation or as the value of an assignment to a block local/
    );
    // A list element declines the same way.
    expect(() =>
      js(['List', ['Apply', ADD, 1], ['Apply', ADD, 2]])
    ).toThrow(/compiles only at the root of the compilation/);
  });

  test('a block local that holds a residual is called with all its arguments', () => {
    // `g` has two parameters; the call `g(2)` supplies one, and the call of
    // a block-local function with too few arguments declines.
    expect(() =>
      js(['Block', ['Assign', 'g', ['Apply', ADD3, 1]], ['g', 2]])
    ).toThrow(/the block-local function is declared with 2 parameters but called with 1/);
    const r = js(['Block', ['Assign', 'g', ['Apply', ADD3, 1]], ['g', 2, 'u']]);
    expect(r.success).toBe(true);
    expect(r.run!({ u: 3 })).toBe(evaluated(['Apply', ADD3, 1, 2, 'u'], 3));
  });
});

describe('PARTIAL APPLICATION — javascript, the cases that declined before', () => {
  test('a pure body that reads a block local compiles', () => {
    // The interpreter reads `c` at the full call `g(u)`, after `c := 10`
    // (16 for u = 5), and so does the compiled residual.
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
    const r = js(json);
    expect(r.success).toBe(true);
    for (const u of [5, -2]) expect(r.run!({ u })).toBe(evaluated(json, u));
    expect(evaluated(json, 5)).toBe(16);
    const other: MathJsonExpression = [
      'Block',
      ['Assign', 't', 1],
      [
        'Assign',
        'g',
        ['Apply', ['Function', ['Add', 'x', 'y', 't'], 'x', 'y'], 1],
      ],
      ['Assign', 't', 2],
      ['g', 3],
    ];
    expect(evaluated(other, 0)).toBe(6);
    expect(js(other).run!({})).toBe(6);
  });

  test('a pure body that is not simplified before the full call compiles', () => {
    // `M(0)(u)` and `D(2)(u)` are the full calls `M(0, u)` and `D(2, u)`,
    // whose value for u = ∞ (M) or u = 0 (D) is not a number.
    for (const json of [
      ['Apply', ['Apply', M, 0], 'u'],
      ['Apply', ['Apply', D, 2], 'u'],
    ] as MathJsonExpression[]) {
      const r = js(json);
      expect(r.success).toBe(true);
      for (const u of [1.5, -3])
        expect(r.run!({ u })).toBeCloseTo(evaluated(json, u), 12);
    }
    expect(js(['Apply', ['Apply', M, 0], 'u']).run!({ u: Infinity })).toBeNaN();
    expect(js(['Apply', ['Apply', D, 2], 'u']).run!({ u: 0 })).toBeNaN();
  });

  // The inner literal is returned by the outer one, and the admission
  // check cannot tell whether its caller passes it to a callback operator
  // (`Filter`), where its write of `y` would not agree with the
  // interpreter. So a returned literal that writes a name of an enclosing
  // scope declines (CE-712.1, ROADMAP CE-720), although the interpreter and
  // the compiled code both give 7 here. The interpreter fallback gives 7.
  test('a partial application whose result writes a parameter declines', () => {
    // (y, w) ↦ (x ↦ Block(Block(y := 2, y + x))): before, the curried call
    // `W(0)` stayed unevaluated (the substitution refused to replace the
    // target of an assignment, ROADMAP CE-698). Now `W(0)` is the deferred
    // residual, and `W(0)(1)(5)` is the full call `W(0, 1)(5)`, 7.
    const W: MathJsonExpression = [
      'Function',
      [
        'Function',
        ['Block', ['Block', ['Assign', 'y', 2], ['Add', 'y', 'x']]],
        'x',
      ],
      'y',
      'w',
    ];
    const ce = engine();
    expect(ce.box(['Apply', W, 0]).evaluate().operator).toBe('Function');
    const json: MathJsonExpression = [
      'Apply',
      ['Apply', ['Apply', W, 0], 1],
      'u',
    ];
    expect(evaluated(json, 5)).toBe(7);
    const r = compile(engine().box(json), {
      to: 'javascript',
      constantFold: false,
    });
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.run!({ u: 5 })).toBe(7);
  });

  test('a body that calls a user function compiles', () => {
    // The interpreter curries every body the same way, whatever the
    // effects of the functions that it calls.
    const ce = engine();
    ce.declare('h', '(real) -> real');
    ce.assign('h', ce.box(['Function', ['Add', 'z', NOISE], 'z']));
    const json: MathJsonExpression = [
      'Apply',
      ['Apply', ['Function', ['Add', ['h', 'x'], 'y'], 'x', 'y'], 1],
      'u',
    ];
    const r = compile(ce.box(json), { to: 'javascript', fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ u: 5 })).toBe(
      ce
        .box(json)
        .subs({ u: ce.number(5) })
        .evaluate()
        .N().re
    );
  });
});

describe('PARTIAL APPLICATION — interval-js', () => {
  const run = (json: MathJsonExpression, u: number) => {
    const r = compile(engine().box(json), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    return (r.run as any)({ u: { lo: u, hi: u } });
  };

  test.each<[string, MathJsonExpression]>([
    ['applied to the remaining argument', ['Apply', ['Apply', ADD, 1], 'u']],
    ['applied to all, in one step', ['Apply', ['Apply', ADD3, 1], 'u', 4]],
    [
      'held by a block local',
      ['Block', ['Assign', 'g', ['Apply', ADD, 1]], ['g', 'u']],
    ],
  ])('%s', (_, json) => {
    for (const u of [0, 2.5, -3]) {
      const result = run(json, u);
      const expected = evaluated(json, u);
      expect(result.value.lo).toBeLessThanOrEqual(expected);
      expect(result.value.hi).toBeGreaterThanOrEqual(expected);
    }
  });

  test('a partial application on its own compiles to a function', () => {
    const r = compile(engine().box(['Apply', ADD, 1]), {
      to: 'interval-js',
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '((_1) => (((x, y) => _IA.add(_IA.add(x, y), _k1)))(_k2, _1))'
    );
  });
});

describe.each(['glsl', 'wgsl'] as const)('PARTIAL APPLICATION — %s', (to) => {
  const gpu = (json: MathJsonExpression) =>
    compile(engine().box(json), { to, fallback: false });

  // An unframed `Random()` has no WGSL form, so only GLSL compiles the call.
  test('applied to the remaining argument, one call of the literal', () => {
    if (to === 'wgsl') return;
    expect(gpu(['Apply', ['Apply', ADD, 1], 'u']).code).toMatch(
      /^\(u \+ 1\.0 \+ 0\.0 \* _gpu_rnd_draw\(/
    );
    expect(gpu(['Apply', ['Apply', ADD3, 1], 'u', 4]).code).toMatch(
      /^\(2\.0 \* u \+ 13\.0 \+ 0\.0 \* _gpu_rnd_draw\(/
    );
  });

  test('a pure body applied to the remaining argument', () => {
    expect(gpu(['Apply', ['Apply', PURE_ADD, 1], 'u']).code).toBe('(u + 1.0)');
    const pure3: MathJsonExpression = [
      'Function',
      ['Add', 'x', ['Multiply', 2, 'y'], ['Multiply', 3, 'z']],
      'x',
      'y',
      'z',
    ];
    expect(gpu(['Apply', ['Apply', ['Apply', pure3, 1], 2], 'u']).code).toBe(
      '(3.0 * u + 5.0)'
    );
  });

  test('a function value declines: a shader has no function values', () => {
    for (const json of [
      ['Apply', ADD, 1],
      ['Block', ['Assign', 'g', ['Apply', ADD, 1]], ['g', 'u']],
    ] as MathJsonExpression[])
      expect(() => gpu(json)).toThrow(
        new RegExp(
          `the value is a function of the remaining parameters \\(a partial ` +
            `application\\), and target '${to}' has no function values`
        )
      );
  });
});

describe('PARTIAL APPLICATION — python', () => {
  const py = new PythonTarget();

  test('a partial application of a pure body is a lambda', () => {
    // Before: `((lambda x, y: x + y))(1)`, a `TypeError` at run time.
    expect(py.compile(engine().box(['Apply', PURE_ADD, 1])).code).toBe(
      '(lambda _1: ((lambda x, y: x + y))(1, _1))'
    );
    expect(
      py.compile(engine().box(['Apply', ['Apply', PURE_ADD, 1], 'u'])).code
    ).toBe('((lambda x, y: x + y))(1, u)');
  });

  test('a partial application of a pure body runs', () => {
    if (TEST_PYTHON === undefined) return;
    const body = py.compile(
      engine().box(['Apply', ['Apply', PURE_ADD, 1], 'u'])
    ).code;
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
  ])('declines %s', (_, json, message) => {
    expect(() => py.compile(engine().box(json))).toThrow(message);
  });

  test('a body with an effect declines here: `Random` has no Python lowering', () => {
    expect(() => py.compile(engine().box(['Apply', ADD, 1]))).toThrow(
      /`Random`/
    );
  });

  test('a saturated call still runs', () => {
    if (TEST_PYTHON === undefined) return;
    const body = py.compile(engine().box(['Apply', PURE_ADD, 1, 'u'])).code;
    const out = execFileSync(
      TEST_PYTHON,
      ['-c', `import numpy as np\nimport math\nu = 1.5\nprint(float(${body}))`],
      { encoding: 'utf8' }
    );
    expect(Number(out.trim())).toBe(2.5);
  });
});
