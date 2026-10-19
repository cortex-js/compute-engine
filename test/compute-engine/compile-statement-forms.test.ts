/**
 * Two compiled forms that need a statement where the expression form has
 * none.
 *
 * 1. WGSL. The expression form of a selection (`If`, `When`, `Which`) is a
 *    `select(…)` call, whose operands are expressions, and an assignment is a
 *    statement in WGSL. A selection whose branch assigns a variable declined.
 *    Where the selection is a STATEMENT — a statement of a block that is not
 *    its value, any statement of a loop body, a branch of such a statement —
 *    its value is discarded, and it is now an `if (…) { … } else { … }`
 *    statement. GLSL keeps its ternary (an assignment is an expression
 *    there), except for an else-less `If`, which has no ternary form on
 *    either language. A selection in a value position (the value of a block,
 *    the right side of an assignment, the whole body) still declines on WGSL.
 *    WGSL also has no expression statement, so a discarded value is a phony
 *    assignment (`_ = x + 1.0;`).
 *
 * 2. Python. The lowering of `Sum`/`Product` is a generator expression, whose
 *    element is an expression. A body that is an assignment or a block of
 *    statements declined. Where the `Sum` is the value of a statement (the
 *    body of `compile()` or of `compileFunction()`, a statement of a block,
 *    the right side of an assignment there), it is now a `for` loop with an
 *    accumulator, written ahead of the statement, as the GLSL and WGSL
 *    targets write a loop-form `Sum`. In any other position the `Sum` still
 *    declines.
 *
 * There is no WGSL validator in this repository: the tests check the emitted
 * source, and run the scalar programs after a small translation to
 * JavaScript. The Python programs run with the repository Python
 * (`TEST_PYTHON`).
 */
import { execFileSync } from 'child_process';
import { ComputeEngine, compile } from '../../src/compute-engine';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { TEST_PYTHON } from './test-python';

const X_VALUES = [-2, 0.5, 3];

/** The interpreter's value of `src` with the given input values. */
function interpreted(src: any, inputs: Record<string, number>): number {
  const ce = new ComputeEngine();
  for (const [name, v] of Object.entries(inputs)) {
    ce.declare(name, 'real');
    ce.assign(name, v);
  }
  return ce.box(src).evaluate().N().re;
}

function shader(src: any, to: 'glsl' | 'wgsl', options: any = {}): any {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('u', 'real');
  return compile(ce.box(src), { to, fallback: false, ...options }) as any;
}

/**
 * The JavaScript form of the scalar shader body `code`: declarations become
 * `let`, the integer loop index and its conversion to a float are kept as
 * numbers, and a phony assignment is a `void` expression. Enough for the
 * programs of this file, not a general translator.
 */
function shaderToJS(code: string): string {
  return code
    .replace(/^(\s*)(?:float|int) (\w+)(;| =)/gm, '$1let $2$3')
    .replace(/^(\s*)var (\w+): \w+(;| =)/gm, '$1let $2$3')
    .replace(/for \((?:int|var) (\w+)(?:: i32)? =/g, 'for (let $1 =')
    .replace(/\b(?:float|f32)\(/g, '(')
    .replace(/^(\s*)_ = /gm, '$1void ');
}

function runShader(code: string, x: number, u = 5): number {
  // eslint-disable-next-line no-new-func
  return new Function('x', 'u', shaderToJS(code))(x, u);
}

const ASSIGNING: [string, any][] = [
  [
    'If in a block',
    [
      'Block',
      ['Assign', 't', 0],
      ['If', ['Greater', 'x', 0], ['Assign', 't', 1], ['Assign', 't', 2]],
      't',
    ],
  ],
  [
    'If in a loop body',
    [
      'Block',
      ['Assign', 't', 0],
      [
        'Loop',
        [
          'If',
          ['Greater', 'i', 1],
          ['Assign', 't', ['Add', 't', 'i']],
          ['Assign', 't', ['Multiply', 't', 'x']],
        ],
        ['Element', 'i', ['Range', 1, 3]],
      ],
      't',
    ],
  ],
  [
    'Which with three clauses',
    [
      'Block',
      ['Assign', 't', 0],
      [
        'Which',
        ['Greater', 'x', 1],
        ['Assign', 't', 1],
        ['Greater', 'x', 0],
        ['Assign', 't', 2],
        'True',
        ['Assign', 't', 3],
      ],
      't',
    ],
  ],
  [
    'Which with no default clause',
    [
      'Block',
      ['Assign', 't', 7],
      ['Which', ['Greater', 'x', 1], ['Assign', 't', 1]],
      't',
    ],
  ],
  [
    'When',
    [
      'Block',
      ['Assign', 't', 0],
      ['When', ['Assign', 't', ['Multiply', 2, 'x']], ['Greater', 'x', 0]],
      't',
    ],
  ],
  [
    'an else-less If',
    [
      'Block',
      ['Assign', 't', 4],
      ['If', ['Greater', 'x', 0], ['Assign', 't', ['Add', 't', 'x']]],
      't',
    ],
  ],
  [
    'a nested If in a block branch',
    [
      'Block',
      ['Assign', 't', 0],
      [
        'If',
        ['Greater', 'x', 0],
        [
          'Block',
          ['Assign', 't', 1],
          ['If', ['Greater', 'x', 2], ['Assign', 't', ['Add', 't', 10]]],
        ],
        ['Assign', 't', 2],
      ],
      't',
    ],
  ],
  [
    'a branch that writes an input',
    [
      'Block',
      [
        'Which',
        ['Greater', 'x', 0],
        ['Assign', 'u', 1],
        'True',
        ['Assign', 'u', 2],
      ],
      ['Add', 'u', 'x'],
    ],
  ],
  [
    'a branch whose value is discarded',
    [
      'Block',
      ['Assign', 't', 0],
      ['If', ['Greater', 'x', 0], ['Assign', 't', 1], ['Add', 'x', 1]],
      't',
    ],
  ],
];

describe('WGSL: A SELECTION WHOSE BRANCHES ASSIGN, IN STATEMENT POSITION', () => {
  for (const [name, src] of ASSIGNING)
    test(name, () => {
      const c = shader(src, 'wgsl');
      expect(c.success).toBe(true);
      expect(c.code).not.toContain('select(');
      expect(c.code).toMatch(/^\s*if \(.*\) \{$/m);
      for (const x of X_VALUES)
        expect([x, runShader(c.code, x)]).toEqual([
          x,
          interpreted(src, { x, u: 5 }),
        ]);
    });

  test('the code of an If in a block', () => {
    expect(shader(ASSIGNING[0][1], 'wgsl').code).toBe(
      [
        'var t: f32;',
        't = 0.0;',
        'if (0.0 < x) {',
        '  t = 1.0;',
        '} else {',
        '  t = 2.0;',
        '}',
        'return t;',
      ].join('\n')
    );
  });

  test('a later condition hoists its statements into the else branch', () => {
    // The loop of the `Sum` in the second condition runs only when the first
    // condition is false.
    const src = [
      'Block',
      ['Assign', 't', 0],
      [
        'Which',
        ['Greater', 'x', 1],
        ['Assign', 't', 1],
        [
          'Greater',
          ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']],
          0,
        ],
        ['Assign', 't', 2],
      ],
      't',
    ];
    const code = shader(src, 'wgsl').code;
    expect(code).toMatch(
      /\} else \{\n {2}var _tv1: f32 = 0\.0;\n {2}for \(var k: i32 = 1;[^\n]*\n {4}_tv1 \+= [^\n]*\n {2}\}\n {2}if \(0\.0 < _tv1\) \{/
    );
  });

  test('a loop-form Sum in a branch runs in that branch', () => {
    const src = [
      'Block',
      ['Assign', 't', 0],
      [
        'If',
        ['Greater', 'x', 0],
        [
          'Assign',
          't',
          ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 'n']],
        ],
        ['Assign', 't', 2],
      ],
      't',
    ];
    expect(shader(src, 'wgsl').code).toMatch(
      /if \(0\.0 < x\) \{\n {2}var _tv1: f32 = 0\.0;\n {2}for \(/
    );
  });

  test('a selection in a value position still declines', () => {
    const value: [string, any][] = [
      [
        'the value of a block',
        [
          'Block',
          ['Assign', 't', 0],
          ['If', ['Greater', 'x', 0], ['Assign', 't', 1], ['Assign', 't', 2]],
        ],
      ],
      [
        'the right side of an assignment',
        [
          'Block',
          [
            'Assign',
            'q',
            ['If', ['Greater', 'x', 0], ['Assign', 't', 1], ['Assign', 't', 2]],
          ],
          'q',
        ],
      ],
      [
        'the whole body',
        ['If', ['Greater', 'x', 0], ['Assign', 't', 1], ['Assign', 't', 2]],
      ],
    ];
    for (const [, src] of value)
      expect(() => shader(src, 'wgsl')).toThrow(
        /a branch assigns a variable, and the WGSL selection/
      );
  });

  test('a selection of values keeps select(…)', () => {
    expect(shader(['If', ['Greater', 'x', 0], 1, 2], 'wgsl').code).toBe(
      'select(2.0, 1.0, 0.0 < x)'
    );
  });

  test('a discarded value is a phony assignment', () => {
    // WGSL has no expression statement: `x + 1.0;` is a syntax error.
    expect(
      shader(['Block', ['Add', 'x', 1], ['Multiply', 'x', 2]], 'wgsl').code
    ).toBe('_ = x + 1.0;\nreturn 2.0 * x;');
    expect(
      shader(['Block', ['Add', 'x', 1], ['Multiply', 'x', 2]], 'glsl').code
    ).toBe('x + 1.0;\nreturn 2.0 * x;');
  });
});

describe('GLSL: A SELECTION WHOSE BRANCHES ASSIGN', () => {
  test('an else-ful selection keeps the ternary', () => {
    expect(shader(ASSIGNING[0][1], 'glsl').code).toMatch(
      /\(\(0\.0 < x\) \? \(t = 1\.0\) : \(t = 2\.0\)\);/
    );
  });

  test('an else-less If is an if statement', () => {
    const src = ASSIGNING[5][1];
    const c = shader(src, 'glsl');
    expect(c.success).toBe(true);
    expect(c.code).toContain('if (0.0 < x) {\n  t = t + x;\n}');
    for (const x of X_VALUES)
      expect(runShader(c.code, x)).toBe(interpreted(src, { x }));
  });
});

const limits = ['Limits', 'k', 1, 3];

/** [name, MathJSON]. The input `u` is 5 for the interpreter and for Python. */
const SUMS: [string, any][] = [
  [
    'a block that writes an input',
    ['Sum', ['Block', ['Assign', 'u', ['Add', 'u', 'k']], 'u'], limits],
  ],
  ['an assignment', ['Sum', ['Assign', 'u', ['Add', 'u', 'k']], limits]],
  [
    'a block with a local',
    [
      'Sum',
      ['Block', ['Assign', 't', ['Add', 'k', 1]], ['Multiply', 't', 't']],
      limits,
    ],
  ],
  [
    'a Product whose block ends with an assignment',
    ['Product', ['Block', ['Assign', 't', ['Add', 'k', 1]]], limits],
  ],
  [
    'a Sum assigned in a block',
    [
      'Block',
      [
        'Assign',
        's',
        [
          'Sum',
          ['Block', ['Assign', 't', ['Add', 'k', 'x']], ['Multiply', 't', 't']],
          limits,
        ],
      ],
      ['Add', 's', 1],
    ],
  ],
  [
    'a Sum that is the value of a block',
    [
      'Block',
      ['Assign', 'a', 2],
      [
        'Sum',
        ['Block', ['Assign', 't', ['Add', 'k', 'a']], ['Multiply', 't', 't']],
        limits,
      ],
    ],
  ],
  [
    'a Sum in the body of a Sum',
    [
      'Sum',
      [
        'Block',
        [
          'Assign',
          't',
          [
            'Sum',
            ['Block', ['Assign', 'w', ['Multiply', 'j', 'k']], 'w'],
            ['Limits', 'j', 1, 'k'],
          ],
        ],
        ['Add', 't', 1],
      ],
      limits,
    ],
  ],
  [
    'two indices',
    [
      'Sum',
      ['Block', ['Assign', 't', ['Multiply', 'k', 'j']], 't'],
      limits,
      ['Limits', 'j', 1, 2],
    ],
  ],
  [
    'an index name that the enclosing block uses',
    [
      'Block',
      ['Assign', 'k', 10],
      [
        'Assign',
        's',
        [
          'Sum',
          ['Block', ['Assign', 't', ['Add', 'k', 1]], ['Multiply', 't', 't']],
          limits,
        ],
      ],
      ['Add', 's', 'k'],
    ],
  ],
  [
    'an If statement in the body',
    [
      'Sum',
      [
        'Block',
        [
          'If',
          ['Greater', 'k', 1],
          ['Assign', 'u', ['Add', 'u', 'k']],
          ['Assign', 'u', 0],
        ],
        'u',
      ],
      limits,
    ],
  ],
  [
    'an empty range',
    [
      'Sum',
      ['Block', ['Assign', 'u', ['Add', 'u', 'k']], 'u'],
      ['Limits', 'k', 3, 1],
    ],
  ],
];

function pythonEngine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.declare('x', 'real');
  return ce;
}

describe('PYTHON: A SUM WHOSE BODY IS A STATEMENT', () => {
  const py = new PythonTarget();

  for (const [name, src] of SUMS)
    test(`compiles: ${name}`, () => {
      const code = py.compile(pythonEngine().box(src)).code;
      expect(code).toMatch(/^_tv\d+ = [01]$/m);
      expect(code).toMatch(/^for _tv\d+ in range\(/m);
      expect(code).toMatch(/^return /m);
    });

  test('the code of the probe', () => {
    expect(py.compile(pythonEngine().box(SUMS[0][1])).code).toBe(
      [
        '_tv1 = u',
        '_tv2 = 0',
        'for _tv3 in range(1, 4):',
        '    _tv1 = _tv3 + _tv1',
        '    _tv2 += _tv1',
        'return _tv2',
      ].join('\n')
    );
  });

  test('compileFunction() writes the loop in the function', () => {
    expect(py.compileFunction(pythonEngine().box(SUMS[2][1]), 'f', [])).toBe(
      [
        'def f():',
        '    _tv1 = 0',
        '    for _tv2 in range(1, 4):',
        // The local `t` of the body has a fresh name: the statements run in
        // the scope of the function.
        '        _tv3 = _tv2 + 1',
        '        _tv1 += _tv3 * _tv3',
        '    return _tv1',
        '',
      ].join('\n')
    );
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the code gives the interpreter value, in a function and with u as a global or a parameter',
    () => {
      const indent = (code: string) =>
        code
          .split('\n')
          .map((l) => `    ${l}`)
          .join('\n');
      let program = 'import json, math\nu = 5.0\nx = 0.5\nout = []\n';
      SUMS.forEach(([, src], k) => {
        const code = py.compile(pythonEngine().box(src)).code;
        program += `def g${k}():\n${indent(code)}\n`;
        program += `def p${k}(u, x):\n${indent(code)}\n`;
        program += `out.append([g${k}(), p${k}(5.0, 0.5), u])\n`;
      });
      SUMS.forEach(([, src], k) => {
        program += `${py.compileFunction(pythonEngine().box(src), `f${k}`, ['x'])}\n`;
        program += `out.append([f${k}(0.5)])\n`;
      });
      program += 'print(json.dumps(out))\n';
      const out = JSON.parse(
        execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
      ) as number[][];
      SUMS.forEach(([name, src], k) => {
        const v = interpreted(src, { u: 5, x: 0.5 });
        expect([name, ...out[k]]).toEqual([name, v, v, 5]);
        expect([name, ...out[SUMS.length + k]]).toEqual([name, v]);
      });
    }
  );

  test('the compile() free function gives the same code', () => {
    const ce = pythonEngine();
    const r = compile(ce.box(SUMS[0][1]), { to: 'python', fallback: false });
    expect(r.success).toBe(true);
    expect(r.code).toContain('for _tv3 in range(1, 4):');
  });

  test('a Sum in another position still declines', () => {
    const body = [
      'Block',
      ['Assign', 't', ['Add', 'k', 1]],
      ['Multiply', 't', 't'],
    ];
    const sum = ['Sum', body, limits];
    const others: [string, any][] = [
      ['an operand', ['Add', 1, sum]],
      ['a conditional arm', ['If', ['Greater', 'x', 0], sum, 0]],
      ['a function argument', ['Sin', sum]],
    ];
    for (const [, src] of others)
      expect(() => py.compile(pythonEngine().box(src))).toThrow(
        /the Python lowering of `Sum` is a generator expression/
      );
    // The expression-only routes have no statement position.
    expect(() => py.compileToSource(pythonEngine().box(sum))).toThrow();
    expect(() => py.compileLambda(pythonEngine().box(sum), ['x'])).toThrow();
  });

  test('a body that ends with a loop, or that returns, still declines', () => {
    const ce = pythonEngine();
    const loop = [
      'Sum',
      [
        'Block',
        ['Assign', 't', 0],
        [
          'Loop',
          ['Assign', 't', ['Add', 't', 'i']],
          ['Element', 'i', ['Range', 1, 2]],
        ],
      ],
      limits,
    ];
    // The body has no number value: the `Sum` declines before its lowering.
    expect(() => py.compile(ce.box(loop))).toThrow();
    const ret = [
      'Sum',
      ['Block', ['Assign', 't', 'k'], ['Return', 't']],
      limits,
    ];
    expect(() => py.compile(ce.box(ret))).toThrow();
  });

  test('a body that is an expression keeps the generator expression', () => {
    expect(
      py.compile(pythonEngine().box(['Sum', ['Multiply', 'k', 'x'], limits]))
        .code
    ).toBe('sum(k * x for k in range(1, 4))');
  });
});

describe('AN ASSIGNMENT THAT IS AN OPERAND', () => {
  // `(t ≔ 1) + 2` has the value 3 and assigns 1 to `t`. The assignment was
  // emitted without parentheses, `t = 1 + 2`, which assigns 3, on every
  // target. JavaScript and GLSL now parenthesize it; Python and WGSL, where
  // an assignment is a statement, decline.
  const operand: any = [
    'Block',
    ['Assign', 't', 0],
    ['Assign', 'w', ['Add', ['Assign', 't', 1], 2]],
    ['Add', 't', 'w'],
  ];
  const argument: any = [
    'Block',
    ['Assign', 't', 0],
    ['Assign', 'w', ['Sin', ['Assign', 't', 1]]],
    ['Add', 't', 'w'],
  ];

  test('JavaScript and GLSL parenthesize the assignment', () => {
    const ce = new ComputeEngine();
    const js = compile(ce.box(operand), { fallback: false });
    expect(js.code).toContain('w = (t = 1) + 2;');
    expect(js.run!()).toBe(4);
    expect(ce.box(operand).evaluate().re).toBe(4);
    const glsl = shader(operand, 'glsl');
    expect(glsl.code).toContain('w = (t = 1.0) + 2.0;');
    expect(runShader(glsl.code, 0)).toBe(4);
  });

  test('Python and WGSL decline', () => {
    for (const to of ['python', 'wgsl'] as const)
      for (const src of [operand, argument]) {
        const ce = new ComputeEngine();
        expect(() => compile(ce.box(src), { to, fallback: false })).toThrow(
          /the assignment to "t" is an operand of an expression/
        );
      }
  });
});

/** Run the Python `program` and parse the JSON that it prints. */
function runPython(program: string): unknown {
  return JSON.parse(
    execFileSync(TEST_PYTHON!, ['-c', program], { encoding: 'utf8' })
  );
}

/** `code` as the body of a Python function, indented under its `def`. */
function indentPython(code: string): string {
  return code
    .split('\n')
    .map((l) => `    ${l}`)
    .join('\n');
}

describe('PYTHON: THE LOOP FORM KEEPS THE SCOPE OF THE BODY', () => {
  const py = new PythonTarget();
  // The local `t` of the body is not the parameter `t`: the interpreter
  // gives the value of the parameter, and the loop wrote `t = k` into it.
  const shadow: any = [
    'Block',
    [
      'Sum',
      ['Block', ['Declare', 't', 'integer', 'k'], 't'],
      ['Limits', 'k', 1, 'n'],
    ],
    't',
  ];

  test('a local of the body has a fresh name', () => {
    const code = py.compileFunction(new ComputeEngine().box(shadow), 'f', [
      't',
      'n',
    ]);
    expect(code).not.toMatch(/^\s+t = /m);
    expect(code).toMatch(/return t$/m);
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the parameter, a global and a local of the enclosing block keep their values',
    () => {
      const ce = new ComputeEngine();
      const f = py.compileFunction(ce.box(shadow), 'f', ['t', 'n']);
      // `t` is a global of the host, read by `compile()`.
      const e2 = new ComputeEngine();
      e2.declare('t', 'real');
      e2.declare('n', 'integer');
      const g = py.compile(e2.box(shadow)).code;
      // A local `w` of the enclosing block and a local `w` of a nested block
      // of the body.
      const nested: any = [
        'Block',
        ['Assign', 'w', 100],
        [
          'Assign',
          's',
          [
            'Sum',
            [
              'Block',
              ['Assign', 'q', ['Add', 'k', 1]],
              ['Block', ['Declare', 'w', 'real', ['Multiply', 'q', 2]], 'w'],
            ],
            limits,
          ],
        ],
        ['Add', 's', 'w'],
      ];
      const h = py.compile(new ComputeEngine().box(nested)).code;
      const out = runPython(
        `import json\nt = 5\nn = 3\n${f}\ndef g():\n${indentPython(g)}\n` +
          `def h():\n${indentPython(h)}\n` +
          `print(json.dumps([f(5, 3), g(), h(), t]))`
      );
      const at = (src: any) => {
        const ie = new ComputeEngine();
        ie.declare('t', 'real');
        ie.assign('t', 5);
        ie.declare('n', 'integer');
        ie.assign('n', 3);
        return ie.box(src).evaluate().re;
      };
      expect(at(shadow)).toBe(5);
      expect(out).toEqual([5, 5, at(nested), 5]);
    }
  );
});

describe('PYTHON: A ROOT ASSIGNMENT OF A SUM WITH A STATEMENT BODY', () => {
  const py = new PythonTarget();
  const sum = [
    'Sum',
    ['Block', ['Assign', 'q', ['Add', 'k', 1]], ['Multiply', 'q', 'q']],
    limits,
  ];

  test('the assignment is a statement, not a return', () => {
    const code = py.compile(new ComputeEngine().box(['Assign', 's', sum])).code;
    expect(code).not.toMatch(/return/);
    expect(code.split('\n').pop()).toMatch(/^\w+ = _tv\d+$/);
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the code runs, and a block that reads the assigned name returns it',
    () => {
      const root = py.compile(
        new ComputeEngine().box(['Assign', 's', sum])
      ).code;
      const block = py.compile(
        new ComputeEngine().box(['Block', ['Assign', 's', sum], 's'])
      ).code;
      const out = runPython(
        `import json\ndef g():\n${indentPython(root)}\n` +
          `def h():\n${indentPython(block)}\n` +
          `print(json.dumps([g(), h()]))`
      );
      // A root assignment is a statement: the function gives `None`.
      expect(out).toEqual([null, new ComputeEngine().box(sum).evaluate().re]);
    }
  );
});

describe('WGSL: AN ASSIGNMENT IN A CONDITION', () => {
  test('a condition that assigns declines', () => {
    for (const cond of [
      ['Assign', 'flag', ['Greater', 'x', 0]],
      ['Not', ['Assign', 'flag', ['Greater', 'x', 0]]],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('flag', 'boolean');
      expect(() =>
        compile(
          ce.box([
            'Block',
            ['Assign', 't', 0],
            ['If', cond, ['Assign', 't', 1], ['Assign', 't', 2]],
            't',
          ] as any),
          { to: 'wgsl', fallback: false }
        )
      ).toThrow(/the assignment to "flag" is an operand of an expression/);
    }
  });

  test('GLSL declares the local copy of a written boolean input as a bool', () => {
    // The only occurrence of `flag` is the target of the assignment, which
    // has no definition: the type report read it as `unknown`, and the copy
    // was `float _tv1 = flag;`.
    const ce = new ComputeEngine();
    ce.declare('flag', 'boolean');
    const r = compile(
      ce.box([
        'Block',
        ['Assign', 't', 0],
        [
          'If',
          ['Greater', 'x', 0],
          ['Assign', 'flag', ['Greater', 'x', 1]],
          ['Assign', 't', 2],
        ],
        't',
      ]),
      { to: 'glsl', fallback: false }
    );
    expect(r.code.split('\n')[0]).toBe('bool _tv1 = flag;');
    expect(r.freeSymbolTypes?.flag).toEqual({
      type: 'boolean',
      lowered: 'bool',
      provenance: 'declared',
    });
  });
});

describe('WGSL: A DISCARDED VALUE WHOSE NAME STARTS WITH A KEYWORD', () => {
  test('letter, format and variant are values, not statements', () => {
    for (const name of ['letter', 'format', 'variant', 'iffy', 'returned']) {
      const ce = new ComputeEngine();
      ce.declare(name, 'real');
      const code = compile(ce.box(['Block', name, ['Multiply', 'x', 2]]), {
        to: 'wgsl',
        fallback: false,
      }).code;
      expect(code).toBe(`_ = ${name};\nreturn 2.0 * x;`);
    }
  });
});

describe('PYTHON: A SUM WITH A BOUND THAT IS NOT AN INTEGER', () => {
  const py = new PythonTarget();
  const engine = () => {
    const ce = new ComputeEngine();
    ce.declare('x', 'real');
    ce.declare('y', 'real');
    ce.declare('n', 'integer');
    return ce;
  };
  const generator: any = [
    'Sum',
    ['Multiply', 'k', 10],
    ['Limits', 'k', 'y', 'x'],
  ];
  const loop: any = [
    'Sum',
    ['Block', ['Assign', 'q', ['Multiply', 'k', 10]], 'q'],
    ['Limits', 'k', 'y', 'x'],
  ];

  test('a real bound is floored, an integer bound is kept', () => {
    expect(py.compile(engine().box(generator)).code).toBe(
      'sum(10 * k for k in range(int((y) // 1), int((x) // 1) + 1))'
    );
    expect(
      py.compile(
        engine().box(['Sum', ['Multiply', 'k', 10], ['Limits', 'k', 1, 'n']])
      ).code
    ).toBe('sum(10 * k for k in range(1, n + 1))');
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the generator and the loop form give the interpreter value',
    () => {
      const points: [number, number][] = [
        [1, 0.7],
        [1, 3.5],
        [0.5, 3],
        [-1.5, 2.2],
        [1.5, 1.5],
      ];
      const g = py.compile(engine().box(generator)).code;
      const l = py.compile(engine().box(loop)).code;
      let program = `import json\ndef g(y, x):\n    return ${g}\n`;
      program += `def l(y, x):\n${indentPython(l)}\nout = []\n`;
      for (const [y, x] of points)
        program += `out.append([g(${y}, ${x}), l(${y}, ${x})])\n`;
      program += 'print(json.dumps(out))\n';
      const out = runPython(program) as number[][];
      points.forEach(([y, x], i) => {
        const ce = engine();
        ce.assign('x', x);
        ce.assign('y', y);
        const v = ce.box(generator).evaluate().N().re;
        expect([y, x, ...out[i]]).toEqual([y, x, v, v]);
      });
    }
  );
});
