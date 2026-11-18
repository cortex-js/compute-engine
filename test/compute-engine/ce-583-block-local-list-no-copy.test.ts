/**
 * CE-583. The GLSL output of the reads of a `Block` local: a list local is
 * indexed as it is, with no copy.
 *
 * The file also tests the defects found with this fix:
 *  - On a shader target, a `Block` local with the name of a parameter of
 *    the function gets a fresh name. GLSL emitted a redeclaration of the
 *    parameter (`float f(float U) { float[10] U;`).
 *  - A nested `Block` in statement position compiles as a statement: a
 *    compound statement (`{ … }`) on the shader targets. A block with one
 *    statement that is itself a block does the same. Before, the nested
 *    block was a value, and its last statement became a `return`.
 *  - A block that uses a local before its `Declare` is the static error
 *    `read-before-declaration`, in a block and in a loop body.
 *  - A local of a nested block in a loop body or a branch no longer writes
 *    an outer variable of the same name (JavaScript).
 *  - Programs whose branch conditions read a block local compile as before.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { compileDiagnosticOf } from '../../src/compute-engine/compilation/diagnostics';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

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
    // The fragment refuses a list local.
    expect(() => glsl.compile(ce.box(['f', 'x']), NO_FOLD)).toThrow(
      /The local `U` is a list: a function body of the GLSL fragment has scalar, complex or point locals/
    );
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
    // The fragment refuses a list local.
    expect(() =>
      glsl.compileFunction(body, 'g', 'float', [['U', 'float']], NO_FOLD)
    ).toThrow(/The local `U` is a list: a function body of the GLSL fragment has scalar, complex or point locals/);
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
    // The fragment refuses a list local.
    expect(() => glsl.compile(ce.box(['f', 'x']), NO_FOLD)).toThrow(
      /The local `U` is a list: a function body of the GLSL fragment has scalar, complex or point locals/
    );
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
    // The fragment refuses a list local.
    expect(() => glsl.compile(ce.box(['f', 'x']), NO_FOLD)).toThrow(
      /The local `U` is a list: a function body of the GLSL fragment has scalar, complex or point locals/
    );
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
    // The fragment refuses a list local.
    expect(() =>
      glsl.compile(ce.box(blockLocal(SUM_U) as any), NO_FOLD)
    ).toThrow(/The local `U` is a list: a function body of the GLSL fragment has scalar, complex or point locals/);
  });

  test('a read with a dynamic index', () => {
    const ce = engine();
    // The fragment refuses a list local.
    expect(() =>
      glsl.compile(ce.box(blockLocal(['At', 'U', 'x']) as any), NO_FOLD)
    ).toThrow(/The local `U` is a list: a function body of the GLSL fragment has scalar, complex or point locals/);
  });
});

/** The code of the decline that interval-js throws for `expr`. */
function intervalDeclineCode(expr: Parameters<typeof compile>[0]): string {
  try {
    compile(expr, { to: 'interval-js', fallback: false });
  } catch (e) {
    return compileDiagnosticOf(e).code;
  }
  return 'compiled';
}

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
        ['Declare', 'y', "'unknown'", ['Add', 'U', 1]],
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
      for (const to of ['javascript'])
        expect(() => compile(expr, { to, fallback: false })).toThrow(decline);
      // The fragment refuses the invalid expression (an `Error` head).
      expect(() => compile(expr, { to: 'glsl', fallback: false })).toThrow(
        /The head `Error` is outside the GLSL fragment/
      );
      // The interval mode declines the static error.
      expect(() =>
        compile(expr, { to: 'interval-js', fallback: false })
      ).toThrow(decline);
      expect(intervalDeclineCode(expr)).toBe('static-type-error');
    });
  }

  test('a use in a nested scope that declares the name again compiles', () => {
    const ce = new ComputeEngine();
    // `y` is declared first: an assignment writes a name that is in scope,
    // and a block with a declaration is not an operand.
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
  // the enclosing code. A JavaScript loop body puts the nested block in braces.
  const D = (n: string) => ['Declare', n, "'real'"];
  const shapes: Array<[string, unknown, number]> = [
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
    ],
  ];
  for (const [label, json, value] of shapes) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box(json as any);
      // Compiled while `x` has no value, so the condition stays in the code.
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as (v: Record<string, unknown>) => number)({ x: 3 })).toBe(
        value
      );
      ce.assign('x', 3);
      expect(expr.evaluate().re).toBe(value);
    });
  }
});

describe('CE-583: the order checks also run on a loop body', () => {
  // `U` is a local of the loop body, and the first statement of the body
  // reads it before its `Declare`. The interpreter answers an error; the
  // compiled code read the input `U`.
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
    for (const to of ['javascript'])
      expect(() => compile(expr, { to, fallback: false })).toThrow(decline);
    expect(() =>
      compile(expr, { to: 'interval-js', fallback: false })
    ).toThrow(decline);
    expect(intervalDeclineCode(expr)).toBe('static-type-error');
    ce.assign('U', 1);
    expect(expr.evaluate().toString()).toMatch(/^Error\(/);
  });
});

describe('CE-583: a Declare in a nested block', () => {
  const D = (n: string, t = "'real'") => ['Declare', n, t];

  // `Declare(m, real, i)` gives the local `m` the value `i`.
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
  });
});

describe('CE-583: a branch on a block local that the compiled code reads', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t, 0];
  // Each of these programs reads a local in a branch condition, and has a
  // value on every run. They compile and give the value of the interpreter,
  // as before CE-583. The local starts at 0, because a declaration has a
  // value.
  const cases: Array<[string, unknown, number]> = [
    [
      'both arms of an If assign',
      [
        'Block',
        D('n'),
        ['If', ['Greater', 'x', 0], ['Assign', 'n', 1], ['Assign', 'n', 2]],
        ['If', ['Greater', 'n', 1], 10, 20],
      ],
      20,
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
    ],
  ];
  for (const [label, json, expected] of cases) {
    test(label, () => {
      const ce = new ComputeEngine();
      ce.declare('x', 'real');
      const expr = ce.box(json as any);
      expect(expr.subs({ x: 1 }).evaluate().re).toBe(expected);
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect((js.run as (v: object) => number)({ x: 1 })).toBe(expected);
    });
  }
});

describe('CE-583: a loop index does not overwrite another variable', () => {
  const D = (n: string, t = "'integer'") => ['Declare', n, t];
  const loop = (body: unknown, index: string, lo: number, hi: number) => [
    'Loop',
    body,
    ['Element', index, ['Range', lo, hi]],
  ];
  const add = (v: unknown) => ['Assign', 's', ['Add', 's', v]];

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
    });
  }
});

describe('CE-583: a nested block with one statement, in statement position', () => {
  // The lone statement of the middle block is a block. It was compiled as
  // a value, so its last statement became a `return`, and GLSL stored it in a
  // temporary that it then wrote as a statement (`_tv1;`).
  const json = [
    'Block',
    ['Block', ['Block', ['Declare', 't', "'real'", 'x'], 't']],
    ['Add', 'x', 1],
  ];

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
  });
});
