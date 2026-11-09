/**
 * CE-583. The GLSL output of the reads of a `Block` local: a list local is
 * indexed as it is, with no copy.
 *
 * The file also tests the defects found with this fix:
 *  - On a shader target, a `Block` local with the name of a parameter of
 *    the function gets a fresh name. GLSL emitted a redeclaration of the
 *    parameter (`float f(float U) { float[10] U;`).
 *  - A nested `Block` in statement position compiles as a statement: a
 *    compound statement (`{ … }`) on the shader targets, and statements in
 *    the enclosing list with fresh local names on Python. A block with one
 *    statement that is itself a block does the same. Before, the nested
 *    block was a value, and its last statement became a `return`.
 *  - A block that uses a local before its `Declare` is the static error
 *    `read-before-declaration`, in a block and in a loop body.
 *  - A local of a nested block in a loop body or a branch no longer writes
 *    an outer variable of the same name (JavaScript and Python).
 *  - On Python, a `Declare` with a value assigns the value, so a local of a
 *    loop body no longer keeps the value of the previous pass. A `Declare`
 *    or an `Assign` whose value compiles to several statements declines.
 *  - On Python, a `Loop` index with the name of another variable of the
 *    function (a parameter, a local, a free symbol, a name that a `vars`
 *    entry reads) gets a fresh name, and the body can still assign it.
 *  - Programs whose branch conditions read a block local compile as before.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { execFileSync } from 'child_process';
import { TEST_PYTHON } from './test-python';

const glsl = new GLSLTarget();
const NO_FOLD = { constantFold: false };

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('B', 'list<real^10>');
  ce.declare('C', 'list<real^10>');
  ce.declare('x', 'real');
  return ce;
}

const SUM_U = ['Sum', ['At', 'U', 'k'], ['Limits', 'k', 1, 10]];
const UNROLLED =
  '((U[1 - 1]) + (U[2 - 1]) + (U[3 - 1]) + (U[4 - 1]) + (U[5 - 1]) + ' +
  '(U[6 - 1]) + (U[7 - 1]) + (U[8 - 1]) + (U[9 - 1]) + (U[10 - 1]))';

function blockLocal(body: unknown): unknown {
  return [
    'Block',
    ['Declare', 'U', "'list<real^10>'", 'B'],
    body,
  ];
}

/** Define `f: (real) -> real` as `U ↦ body`. */
function defineF(ce: ComputeEngine, body: unknown): void {
  ce.declare('f', '(real) -> real');
  ce.assign('f', ce.box(['Function', body, 'U'] as any));
}

/** `Block(Declare(U, list<real^10>); U ≔ C; value)`. */
function innerU(value: unknown): unknown {
  return [
    'Block',
    ['Declare', 'U', "'list<real^10>'", 'C'],
    value,
  ];
}

/** The text of the shader function whose header starts with `head`. */
function fnText(preamble: string, head: string): string {
  const start = preamble.indexOf(head);
  expect(start).toBeGreaterThanOrEqual(0);
  const end = preamble.indexOf('\n}', start);
  return preamble.slice(start, end + 2);
}

/**
 * Run the emitted function `_fn_f` in JavaScript. The bodies these tests
 * emit use declarations, assignments, compound statements, array indexes,
 * `+` and `return`, so a text translation is enough: a declaration
 * (`float[10] a;`, `float a;`) becomes `let a;`.
 */
function runF(
  preamble: string,
  head: string,
  lists: { B: number[]; C: number[] },
  x: number
): number {
  const text = fnText(preamble, head);
  const body = text
    .slice(text.indexOf('{\n') + 2, -2)
    .replace(/^(\s*)float(?:\[\d+\])? (\w+);/gm, '$1let $2;');
  return new Function('B', 'C', 'U', body)(lists.B, lists.C, x) as number;
}

/** The shader function and the JavaScript target agree at x = 2.5. */
function expectSameValues(
  ce: ComputeEngine,
  glslPreamble: string,
  expected: number
): void {
  const C = Array.from({ length: 10 }, (_, k) => k + 1);
  const B = C.map((c) => 100 * c);
  const js = compile(ce.box(['f', 'x']), { to: 'javascript' });
  expect(js.success).toBe(true);
  const want = (js.run as (v: Record<string, unknown>) => number)({
    x: 2.5,
    B,
    C,
  });
  expect(want).toBe(expected);
  expect(runF(glslPreamble, 'float _fn_f(', { B, C }, 2.5)).toBe(want);
}

describe('CE-583: a value of the same name is not a block local', () => {
  test('a Block local inside a user function whose parameter is U', () => {
    // The local of the inner `Block` hides the parameter `U` of `f`. It is
    // spelled with a fresh name (`_tv1`), so its declaration and its write
    // are not taken for the parameter, and the list local is indexed in
    // place.
    const ce = engine();
    // The inner block is a statement: a block with a declaration is not an
    // operand, so its value goes through the local `r`.
    defineF(ce, [
      'Block',
      ['Declare', 'r', "'real'", 0],
      ['Block', ['Declare', 'U', "'list<real^10>'", 'C'], ['Assign', 'r', SUM_U]],
      ['Add', 'r', 'U'],
    ]);
    const unrolled = UNROLLED.replace(/\bU\[/g, '_tv1[');
    const g = glsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(g.preamble!, 'float _fn_f(')).toBe(
      'float _fn_f(float U) {\n' +
        '  float r;\n' +
        '  r = 0.0;\n' +
        '  {\n' +
        '    float[10] _tv1;\n' +
        '    _tv1 = C;\n' +
        `    r = ${unrolled};\n` +
        '  }\n' +
        '  return U + r;\n' +
        '}'
    );
    expectSameValues(ce, g.preamble!, 55 + 2.5);
  });

  test('compileFunction(): a Block local with the name of a parameter', () => {
    // The local gets a fresh name, so it does not redeclare the parameter.
    const ce = engine();
    ce.declare('U', 'real');
    const body = ce.box([
      'Block',
      ['Declare', 'U', "'list<real^10>'", 'C'],
      SUM_U,
    ] as any);
    const unrolled = UNROLLED.replace(/\bU\[/g, '_tv1[');
    expect(
      glsl.compileFunction(body, 'g', 'float', [['U', 'float']], NO_FOLD)
    ).toBe(
      'float g(float U) {\n' +
        '  float[10] _tv1;\n' +
        '  _tv1 = C;\n' +
        `  return ${unrolled};\n` +
        '}'
    );
  });
});

describe('CE-583: a local that hides an outer local and a parameter', () => {
  // `f := U ↦ Block(U ≔ C; Block(U ≔ B; Σ U_k) + Σ U_k) + U`, with
  // `k = 1..3`. The local of the inner block hides the local of the outer
  // block, which hides the parameter. Both locals get a fresh name, so
  // neither redeclares the parameter.
  test('both locals get a fresh name', () => {
    const ce = engine();
    const sum3 = ['Sum', ['At', 'U', 'k'], ['Limits', 'k', 1, 3]];
    // A block with a declaration is not an operand, so the values go through
    // the locals `r` and `q`.
    defineF(ce, [
      'Block',
      ['Declare', 'r', "'real'", 0],
      [
        'Block',
        ['Declare', 'U', "'list<real^10>'", 'C'],
        ['Declare', 'q', "'real'", 0],
        ['Block', ['Declare', 'U', "'list<real^10>'", 'B'], ['Assign', 'q', sum3]],
        ['Assign', 'r', ['Add', 'q', sum3]],
      ],
      ['Add', 'r', 'U'],
    ]);
    const inner = '((_tv2[1 - 1]) + (_tv2[2 - 1]) + (_tv2[3 - 1]))';
    const outer = '((_tv1[1 - 1]) + (_tv1[2 - 1]) + (_tv1[3 - 1]))';
    const g = glsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(g.preamble!, 'float _fn_f(')).toBe(
      'float _fn_f(float U) {\n' +
        '  float r;\n' +
        '  r = 0.0;\n' +
        '  {\n' +
        '    float[10] _tv1;\n' +
        '    _tv1 = C;\n' +
        '    float q;\n' +
        '    q = 0.0;\n' +
        '    {\n' +
        '      float[10] _tv2;\n' +
        '      _tv2 = B;\n' +
        `      q = ${inner};\n` +
        '    }\n' +
        `    r = q + ${outer};\n` +
        '  }\n' +
        '  return U + r;\n' +
        '}'
    );
    // B = 100·C, so the sums are 600 and 6.
    expectSameValues(ce, g.preamble!, 600 + 6 + 2.5);
  });
});

describe('CE-583: a nested Block in statement position', () => {
  // `f := U ↦ Block(Block(Declare(U, list<real^10>); U ≔ C; U), U + 1)`.
  // The inner block is a statement: nothing reads its value. It compiled as
  // a value before: its statements were put in the scope of the parameter
  // (`float[10] U;`, a redeclaration) with a `return` of its value, so the
  // function returned the list instead of `U + 1`.
  test('it is a compound statement, with no return', () => {
    const ce = engine();
    defineF(ce, ['Block', innerU('U'), ['Add', 'U', 1]]);
    const g = glsl.compile(ce.box(['f', 'x']), NO_FOLD);
    expect(fnText(g.preamble!, 'float _fn_f(')).toBe(
      'float _fn_f(float U) {\n' +
        '  {\n' +
        '    float[10] _tv1;\n' +
        '    _tv1 = C;\n' +
        '    _tv1;\n' +
        '  }\n' +
        '  return U + 1.0;\n' +
        '}'
    );
    expectSameValues(ce, g.preamble!, 2.5 + 1);
  });

  test('a scalar block statement is not stored in a temporary', () => {
    // Before, the value was stored in `_tv1`, and `_tv1;` was then written
    // as a statement.
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Block', ['Declare', 'V', "'real'", 'x'], 'V'],
      ['Add', 'x', 1],
    ] as any);
    expect(glsl.compile(expr, NO_FOLD).code).toBe(
      '{\n  float V;\n  V = x;\n  V;\n}\nreturn x + 1.0;'
    );
  });
});

describe('CE-583: the GLSL output does not change', () => {
  test('a Sum over a Block local', () => {
    const ce = engine();
    const r = glsl.compile(ce.box(blockLocal(SUM_U) as any), NO_FOLD);
    expect(r.code).toBe(`float[10] U;\nU = B;\nreturn ${UNROLLED};`);
  });

  test('a read with a dynamic index', () => {
    const ce = engine();
    const r = glsl.compile(
      ce.box(blockLocal(['At', 'U', 'x']) as any),
      NO_FOLD
    );
    expect(r.code).toBe('float[10] U;\nU = B;\nreturn _gpu_at10(U, x);');
  });
});

describe('CE-583: a nested Block in statement position on Python', () => {
  // Python has no block scope and no compound statement: the statements of
  // the nested block are put in the enclosing list, with no `return`, and
  // each of its locals gets a fresh name.
  const python = new PythonTarget();
  const shapes: Array<[string, unknown, string, string, number]> = [
    [
      'a block that assigns an outer local',
      [
        'Block',
        ['Declare', 'W', "'real'", 0],
        ['Block', ['Assign', 'W', ['Multiply', 2, 'x']]],
        ['Add', 'W', 1],
      ],
      'W = 0\nW = 2 * x\nreturn W + 1',
      'def f(x):\n    W = 0\n    W = 2 * x\n    return W + 1\n',
      6,
    ],
    [
      'a block with a value that nothing reads',
      [
        'Block',
        ['Block', ['Declare', 'V', "'real'", 'x'], 'V'],
        ['Add', 'x', 1],
      ],
      '_tv1 = x\n_tv1\nreturn x + 1',
      'def f(x):\n    _tv1 = x\n    _tv1\n    return x + 1\n',
      3.5,
    ],
    [
      'a block local that hides an outer local',
      [
        'Block',
        ['Declare', 'V', "'real'", 3],
        [
          'Block',
          ['Declare', 'V', "'real'", 'x'],
          ['Assign', 'V', ['Add', 'V', 1]],
        ],
        ['Add', 'V', 'x'],
      ],
      'V = 3\n_tv1 = x\n_tv1 = _tv1 + 1\nreturn V + x',
      'def f(x):\n    V = 3\n    _tv1 = x\n    _tv1 = _tv1 + 1\n    return V + x\n',
      5.5,
    ],
  ];
  for (const [label, json, code, def, value] of shapes) {
    test(label, () => {
      const ce = engine();
      const expr = ce.box(json as any);
      expect(python.compile(expr, NO_FOLD).code).toBe(code);
      const fn = python.compileFunction(expr, 'f', ['x']);
      expect(fn.trimEnd()).toBe(def.trimEnd());
      // The interpreter gives the same value.
      ce.assign('x', 2.5);
      expect(expr.evaluate().re).toBe(value);
      if (TEST_PYTHON === undefined) return;
      const out = execFileSync(TEST_PYTHON, [
        '-c',
        `${fn}\nprint(repr(float(f(2.5))))`,
      ]).toString();
      expect(Number(out.trim())).toBe(value);
    });
  }
});

describe('CE-583: a use of a block local before its Declare declines', () => {
  // The local exists from the start of the block, so a statement before
  // the `Declare` uses the local. The canonical form holds the static error
  // `read-before-declaration`, and every target refuses the invalid
  // expression.
  const shapes: Array<[string, unknown]> = [
    [
      'an assignment',
      [
        'Block',
        ['Assign', 'U', 2],
        ['Declare', 'U', "'real'", 3],
        ['Add', 'U', 1],
      ],
    ],
    [
      'a read',
      [
        'Block',
        ['Assign', 'y', ['Add', 'U', 1]],
        ['Declare', 'U', "'real'", 3],
        ['Add', 'U', 'y'],
      ],
    ],
  ];
  for (const [label, json] of shapes) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('U', 'real');
      ce.assign('U', 10);
      const expr = ce.box(json as any);
      expect(expr.isValid).toBe(false);
      expect(expr.toString()).toContain(
        'Error(ErrorCode("read-before-declaration", "U"))'
      );
      const decline = /read-before-declaration/;
      for (const to of ['javascript', 'glsl', 'python'])
        expect(() => compile(expr, { to, fallback: false })).toThrow(decline);
      // The interval target gives its decline in the result.
      const interval = compile(expr, { to: 'interval-js', fallback: false });
      expect(interval.success).toBe(false);
      expect(interval.error).toMatch(decline);
    });
  }

  test('a use in a nested scope that declares the name again compiles', () => {
    const ce = new ComputeEngine();
    // `y` is declared first: an assignment is a first assignment only at the
    // own level of a block, and a block with a declaration is not an operand.
    const expr = ce.box([
      'Block',
      ['Declare', 'y', "'real'", 0],
      [
        'Block',
        ['Declare', 'U', "'real'", 5],
        ['Assign', 'y', 'U'],
      ],
      ['Declare', 'U', "'real'", 3],
      ['Add', 'U', 'y'],
    ] as any);
    expect(expr.evaluate().re).toBe(8);
    const js = compile(expr, { to: 'javascript', fallback: false });
    expect((js.run as () => number)()).toBe(8);
  });
});

describe('CE-583: a block local in a loop body or a branch', () => {
  // A local of a nested block must not write a variable of the same name of
  // the enclosing code. Python has no block scope, so the local gets a fresh
  // name. A JavaScript loop body puts the nested block in braces.
  const python = new PythonTarget();
  const D = (n: string) => ['Declare', n, "'real'"];
  const shapes: Array<[string, unknown, number, string | undefined]> = [
    [
      'a block in a loop body',
      [
        'Block',
        ['Declare', 'V', "'real'", 1],
        [
          'Loop',
          [
            'Block',
            ['Block', ['Declare', 'V', "'real'", 100]],
            ['Assign', 'V', ['Multiply', 2, 'V']],
          ],
          ['Element', 'k', ['Range', 1, 3]],
        ],
        'V',
      ],
      8,
      'def f(x):\n    V = 1\n    for k in range(1, 4):\n        _tv1 = 100\n' +
        '        V = 2 * V\n    return V',
    ],
    [
      'a block in a branch',
      [
        'Block',
        ['Declare', 'V', "'real'", 1],
        [
          'If',
          ['Greater', 'x', 0],
          ['Block', ['Declare', 'V', "'real'", 7]],
          ['Assign', 'V', 5],
        ],
        'V',
      ],
      1,
      'def f(x):\n    V = 1\n    if 0 < x:\n        _tv1 = 7\n    else:\n' +
        '        V = 5\n    return V',
    ],
    [
      'a block nested in a block of a branch',
      [
        'Block',
        ['Declare', 'V', "'real'", 1],
        [
          'If',
          ['Greater', 'x', 0],
          [
            'Block',
            ['Assign', 'V', 2],
            ['Block', ['Declare', 'V', "'real'", 7]],
            ['Assign', 'V', ['Add', 'V', 1]],
          ],
          ['Assign', 'V', 5],
        ],
        'V',
      ],
      3,
      undefined,
    ],
  ];
  for (const [label, json, value, def] of shapes) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box(json as any);
      // Compiled while `x` has no value, so the condition stays in the code.
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as (v: Record<string, unknown>) => number)({ x: 3 })).toBe(
        value
      );
      const fn = python.compileFunction(expr, 'f', ['x']);
      if (def !== undefined) expect(fn.trimEnd()).toBe(def);
      ce.assign('x', 3);
      expect(expr.evaluate().re).toBe(value);
      if (TEST_PYTHON === undefined) return;
      const out = execFileSync(TEST_PYTHON, [
        '-c',
        `${fn}\nprint(repr(float(f(3))))`,
      ]).toString();
      expect(Number(out.trim())).toBe(value);
    });
  }
});

describe('CE-583: the order checks also run on a loop body', () => {
  // `U` is a local of the loop body, and the first statement of the body
  // reads it before its `Declare`. The interpreter answers an error; the
  // compiled code read the input `U` (Python gave 100).
  test('a read before the Declare in a loop body declines', () => {
    const ce = new ComputeEngine();
    ce.declare('U', 'real');
    const D = (n: string) => ['Declare', n, "'real'"];
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        [
          'Block',
          [
            'If',
            ['Greater', 'k', 1],
            ['Assign', 's', ['Add', 's', 'U']],
            'Nothing',
          ],
          ['Declare', 'U', "'real'", 100],
        ],
        ['Element', 'k', ['Range', 1, 2]],
      ],
      's',
    ] as any);
    const decline = /read-before-declaration/;
    for (const to of ['javascript', 'python'])
      expect(() => compile(expr, { to, fallback: false })).toThrow(decline);
    expect(() => new PythonTarget().compileFunction(expr, 'f', ['U'])).toThrow(
      decline
    );
    const interval = compile(expr, { to: 'interval-js', fallback: false });
    expect(interval.success).toBe(false);
    expect(interval.error).toMatch(decline);
    ce.assign('U', 1);
    expect(expr.evaluate().toString()).toMatch(/^Error\(/);
  });
});

describe('CE-583: a Python block local has no value from a previous pass', () => {
  // `t` is a local of the loop body: each pass has a new `t`, which starts
  // at 0 and becomes 5 only in the pass where `k = 1`. Python kept the value
  // 5 of the first pass and gave 5 in the pass where `k = 2`; the value is 0.
  test('a local declared in a loop body', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        [
          'Block',
          ['Declare', 't', "'real'", 0],
          ['If', ['Equal', 'k', 1], ['Assign', 't', 5], 'Nothing'],
          ['Assign', 's', ['Add', 's', ['If', ['Equal', 'k', 2], 't', 0]]],
        ],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(0);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).toContain('    for k in range(1, 4):\n        _tv1 = 0\n');
    if (TEST_PYTHON === undefined) return;
    const out = execFileSync(TEST_PYTHON, ['-c', `${fn}\nprint(f())`])
      .toString()
      .trim();
    expect(Number(out)).toBe(0);
  });

  test('a name assigned in a nested block does not reach the outer read', () => {
    // `W` is a local of the nested block (a bare assignment of a name that
    // nothing outside binds), so the read after the block is not that
    // local: it is the free symbol `W`. Python wrote `W` in the scope of the
    // function and gave 9.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'number'", 0],
      ['Block', ['Assign', 'W', ['Add', 'x', 1]]],
      ['Assign', 's', ['Add', 's', 'W']],
      's',
    ] as any);
    expect(expr.evaluate().toString()).toBe('W');
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x', 'W']);
    expect(fn).toContain('    _tv1 = x + 1\n');
    expect(fn).not.toMatch(/^\s*W = /m);
  });
});

describe('CE-583: a Python Declare in a nested block', () => {
  const D = (n: string, t = "'real'") => ['Declare', n, t];

  // `Declare(m, real, i)` gives the local `m` the value `i`. The `declare`
  // hook of the Python target emits nothing, and the value was lost: the
  // code read `_tv1`, which nothing assigned, and raised `NameError`.
  test('a Declare with a value assigns the value', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        [
          'Block',
          ['Declare', 'm', "'real'", 'i'],
          ['Assign', 's', ['Add', 's', 'm']],
        ],
        ['Element', 'i', ['Range', 1, 5]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(15);
    const js = compile(expr, { to: 'javascript', fallback: false });
    expect((js.run as () => number)()).toBe(15);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).toContain('        _tv1 = i\n        s = _tv1 + s');
    if (TEST_PYTHON === undefined) return;
    const out = execFileSync(TEST_PYTHON, ['-c', `${fn}\nprint(f())`])
      .toString()
      .trim();
    expect(Number(out)).toBe(15);
  });
});

describe('CE-583: a branch on a block local that the compiled code reads', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t, 0];
  // Each of these programs reads a local in a branch condition, and has a
  // value on every run. They compile and give the value of the interpreter,
  // as before CE-583. The local starts at 0, because a declaration has a
  // value.
  const cases: Array<[string, unknown, number, boolean]> = [
    [
      'both arms of an If assign',
      [
        'Block',
        D('n'),
        ['If', ['Greater', 'x', 0], ['Assign', 'n', 1], ['Assign', 'n', 2]],
        ['If', ['Greater', 'n', 1], 10, 20],
      ],
      20,
      true,
    ],
    [
      'an assignment whose value reads the local',
      [
        'Block',
        D('n'),
        ['If', ['Greater', 'x', 3], ['Assign', 'n', 1]],
        ['Assign', 'n', ['If', ['Greater', 'x', 5], 1, 'n']],
        ['If', ['NotEqual', 'n', 1], 10, 20],
      ],
      10,
      false,
    ],
    [
      'a first value in the first pass of a loop',
      [
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
          ['Element', 'i', ['Range', 1, 5]],
        ],
        'm',
      ],
      5,
      true,
    ],
    [
      'a function literal called after the write',
      [
        'Block',
        D('n'),
        ['Declare', 'f', "'any'", ['Function', ['If', ['Greater', 'n', 1], 10, 20]]],
        ['Assign', 'n', 2],
        ['Apply', 'f'],
      ],
      10,
      true,
    ],
    [
      'a loop over a list literal',
      [
        'Block',
        D('n'),
        ['Loop', ['Assign', 'n', 'i'], ['Element', 'i', ['List', 1, 2]]],
        ['If', ['NotEqual', 'n', 1], 10, 20],
      ],
      10,
      true,
    ],
  ];
  for (const [label, json, expected, python] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box(json as any);
      expect(expr.subs({ x: 1 }).evaluate().re).toBe(expected);
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as (v: object) => number)({ x: 1 })).toBe(expected);
      if (!python) return;
      const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
      if (TEST_PYTHON === undefined) return;
      expect(runPython(fn, 'f(1)')).toBe(expected);
    });
  }
});

/**
 * Run the Python function `fn` with the argument list `call` (`f()`, `g(1)`)
 * and give the printed value as a number. `preamble` is Python code that
 * runs first (a module global).
 */
function runPython(fn: string, call: string, preamble = ''): number {
  const out = execFileSync(TEST_PYTHON!, [
    '-c',
    `import numpy as np\nimport math\n${preamble}${fn}\nprint(${call})`,
  ])
    .toString()
    .trim();
  return Number(out);
}

describe('CE-583: a Python loop index does not overwrite another variable', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t];
  const loop = (body: unknown, index: string, lo: number, hi: number) => [
    'Loop',
    body,
    ['Element', index, ['Range', lo, hi]],
  ];
  const add = (v: unknown) => ['Assign', 's', ['Add', 's', v]];

  // Python has no block scope: a `for` statement assigns its index in the
  // scope of the whole function. Before the fix, an inner loop over `i`
  // changed the `i` of the outer loop: `Range(1, 0)` is 1, 0, so the inner
  // loop left `i = 0` and the outer body added 0 (Python gave 0 where the
  // interpreter gives 15).
  const cases: Array<[string, unknown, number]> = [
    [
      'an inner loop over the index of the outer loop',
      [
        'Block',
        ['Declare', 's', "'integer'", 0],
        loop(['Block', loop(add(0), 'i', 1, 0), add('i')], 'i', 1, 5),
        's',
      ],
      15,
    ],
    [
      'an inner loop that is a statement of the outer body',
      [
        'Block',
        ['Declare', 's', "'integer'", 0],
        loop(
          ['Block', loop(add(['Multiply', 10, 'i']), 'i', 1, 2), add('i')],
          'i',
          1,
          5
        ),
        's',
      ],
      165,
    ],
    [
      'a loop over the name of a block local',
      [
        'Block',
        ['Declare', 's', "'integer'", 0],
        ['Declare', 'k', "'integer'", 100],
        loop(add('k'), 'k', 1, 3),
        ['Add', 's', 'k'],
      ],
      106,
    ],
  ];

  for (const [label, json, expected] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      const expr = ce.box(json as any);
      expect(expr.evaluate().re).toBe(expected);
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as () => number)()).toBe(expected);
      const fn = new PythonTarget().compileFunction(expr, 'f', []);
      if (TEST_PYTHON === undefined) return;
      expect(runPython(fn, 'f()')).toBe(expected);
    });
  }

  test('a loop over the name of a parameter', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'integer'", 0],
      loop(add('x'), 'x', 1, 3),
      ['Add', 's', 'x'],
    ] as any);
    expect(expr.subs({ x: 1 }).evaluate().re).toBe(7);
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
    expect(fn).not.toMatch(/for x in/);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f(1)')).toBe(7);
  });

  // A loop index with the name of a free symbol made the name a local of
  // the function: a read of the module global before the loop raised
  // `UnboundLocalError`, and a read after the loop gave the last index.
  test('a loop over the name of a free symbol', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const after = ce.box([
      'Block',
      ['Declare', 's', "'integer'", 0],
      loop(add('y'), 'y', 1, 3),
      ['Add', 's', 'y'],
    ] as any);
    const before = ce.box([
      'Block',
      ['Declare', 's', "'integer'", 'y'],
      loop(add('y'), 'y', 1, 3),
      's',
    ] as any);
    for (const expr of [after, before]) {
      expect(expr.subs({ y: 10 }).evaluate().re).toBe(16);
      const fn = new PythonTarget().compileFunction(expr, 'f', []);
      expect(fn).not.toMatch(/for y in/);
      if (TEST_PYTHON === undefined) continue;
      expect(runPython(fn, 'f()', 'y = 10\n')).toBe(16);
    }
  });

  // An index with no other variable of that name keeps its name, and a
  // comprehension has its own scope in Python 3, so its variable keeps its
  // name too. `s` is a `number`: `Length` has the type `real | signed_infinity`,
  // and a reassignment must keep the type of the local.
  test('other indices keep their names', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'number'", 0],
      loop(
        add([
          'Add',
          ['Length', ['Comprehension', 'i', ['Element', 'i', ['Range', 1, 2]]]],
          'i',
        ]),
        'i',
        1,
        3
      ),
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(12);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).toContain('for i in range(1, 4):');
    expect(fn).toContain('for i in range(1, 3)]');
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f()')).toBe(12);
  });
});

describe('CE-583: a Python loop index with a fresh name can be assigned', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t];
  // The index `x` has the name of the parameter, so Python spells it with
  // a fresh name (`pythonLoopIndexCollides`). Before the fix the fresh
  // name was not a target that an `Assign` accepts, and the compiler
  // refused the program.
  test('a body that doubles its index', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'integer'", 0],
      [
        'Loop',
        [
          'Block',
          ['Assign', 'x', ['Multiply', 2, 'x']],
          ['Assign', 's', ['Add', 's', 'x']],
        ],
        ['Element', 'x', ['Range', 1, 3]],
      ],
      ['Add', 's', 'x'],
    ] as any);
    // 2 + 4 + 6, then the parameter x = 1.
    expect(expr.subs({ x: 1 }).evaluate().re).toBe(13);
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
    expect(fn).not.toMatch(/for x in/);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f(1)')).toBe(13);
  });
});

describe('CE-583: a Python Declare whose value is a block', () => {
  // A top-level block of `compileFunction` compiles through
  // `BaseCompiler.compileBlock`, which has its own `Declare` lowering.
  // Python returned 2 for x = 1, the value of the inner block.
  test('a block that is the body of the function', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box([
      'Block',
      [
        'Declare',
        'n',
        "'real'",
        [
          'Block',
          ['Declare', 'a', "'real'", 'x'],
          ['Multiply', 'a', 2],
        ],
      ],
      ['Add', 'n', 1],
    ] as any);
    expect(expr.subs({ x: 1 }).evaluate().re).toBe(3);
    expect(() => new PythonTarget().compileFunction(expr, 'f', ['x'])).toThrow(
      /Could not compile `Declare`: the value of "n" lowers to a statement sequence/
    );
  });

  // The value of `t` compiles to several statements. Put after `t = `, the
  // `return` of the inner block left the function at the first pass of the
  // loop. The compilation now declines, as for an `Assign` of such a value.
  test('the compilation declines', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        [
          'Block',
          [
            'Declare',
            't',
            "'real'",
            ['Block', ['Declare', 'u', "'real'", 'i'], ['Add', 'u', 1]],
          ],
          ['Assign', 's', ['Add', 's', 't']],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(9);
    expect(() => new PythonTarget().compileFunction(expr, 'f', [])).toThrow(
      /Could not compile `Declare`: the value of "t" lowers to a statement sequence/
    );
  });
});

describe('CE-583: a nested block with one statement, in statement position', () => {
  // The lone statement of the middle block is a block. It was compiled as
  // a value, so its last statement became a `return`: Python returned `t`
  // (2 for x = 2) before `return x + 1`, and GLSL stored it in a temporary
  // that it then wrote as a statement (`_tv1;`).
  const json = [
    'Block',
    ['Block', ['Block', ['Declare', 't', "'real'", 'x'], 't']],
    ['Add', 'x', 1],
  ];

  test('Python', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(json as any);
    expect(expr.subs({ x: 2 }).evaluate().re).toBe(3);
    const fn = new PythonTarget().compileFunction(expr, 'f', ['x']);
    expect(fn).not.toMatch(/return _tv1|return t\b/);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f(2)')).toBe(3);
  });

  test('GLSL', () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    const expr = ce.box(json as any);
    const code = glsl.compileFunction(expr, 'g', 'float', [['x', 'float']]);
    expect(code).not.toContain('_tv1');
    expect(code).toContain('      float t;\n      t = x;');
    expect(code).toContain('return x + 1.0;');
  });

  test('a loop body', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        [
          'Block',
          [
            'Block',
            [
              'Block',
              ['Declare', 't', "'real'", 'i'],
              ['Assign', 's', ['Add', 's', 't']],
            ],
          ],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    expect(expr.evaluate().re).toBe(6);
    const code = glsl.compileFunction(expr, 'g', 'float', []);
    expect(code).not.toContain('_tv1');
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    // One `return`: the one of the function.
    expect(fn.match(/\breturn\b/g)).toHaveLength(1);
    if (TEST_PYTHON === undefined) return;
    expect(runPython(fn, 'f()')).toBe(6);
  });
});

describe('CE-583: a Python loop index and the code of a vars entry', () => {
  // `vars: { y: 'k' }` compiles a read of `y` to the Python variable `k`.
  // A loop over `k` overwrote it, and the read after the loop gave the last
  // index (3) instead of 10.
  test('a loop over the name that a vars entry reads', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      ['Add', 's', 'y'],
    ] as any);
    expect(expr.subs({ y: 10 }).evaluate().re).toBe(16);
    const result = compile(expr, {
      to: 'python',
      fallback: false,
      vars: { y: 'k' },
    });
    expect(result.success).toBe(true);
    expect(result.code).not.toMatch(/for k in/);
    if (TEST_PYTHON === undefined) return;
    const fn =
      'def f():\n    k = 10\n' +
      result.code
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
    expect(runPython(fn, 'f()')).toBe(16);
  });
});

describe('CE-583: a Python loop index and a name read through a value', () => {
  // `a` holds `k + 1`, so the compiled code reads the Python variable `k`
  // where it reads `a`. The loop over `k` overwrote it.
  test('a symbol whose value reads the name of the index', () => {
    const ce = new ComputeEngine();
    ce.assign('a', ce.box(['Add', 'k', 1]));
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', 'k']],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      ['Add', 's', 'a'],
    ] as any);
    const fn = new PythonTarget().compileFunction(expr, 'f', []);
    expect(fn).not.toMatch(/for k in/);
    if (TEST_PYTHON === undefined) return;
    // 1 + 2 + 3, then a = k + 1 with the module global k = 10.
    expect(runPython(fn, 'f()', 'k = 10\n')).toBe(17);
  });

  // The scan of the code of a `vars` entry follows the Unicode rule of
  // Python identifiers.
  test('a vars entry with a name that is not ASCII', () => {
    const ce = new ComputeEngine();
    ce.declare('y', 'real');
    const alpha = { sym: 'α' };
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'real'", 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', alpha]],
        ['Element', alpha, ['Range', 1, 3]],
      ],
      ['Add', 's', 'y'],
    ] as any);
    const result = new PythonTarget().compile(expr, { vars: { y: 'α' } });
    expect(result.success).toBe(true);
    expect(result.code).not.toMatch(/for α in/);
    if (TEST_PYTHON === undefined) return;
    const fn =
      'def f():\n' +
      result.code
        .split('\n')
        .map((line) => `    ${line}`)
        .join('\n');
    expect(runPython(fn, 'f()', 'α = 10\n')).toBe(16);
  });
});
