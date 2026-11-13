/**
 * Two compiled forms that need a statement where the expression form has
 * none.
 *
 * 1. GLSL. A selection (`If`, `Which`) whose branch assigns a variable keeps
 *    its ternary, because an assignment is an expression in GLSL. An else-less
 *    `If` has no ternary form: where it is a STATEMENT (its value is
 *    discarded), it is an `if (…) { … }` statement.
 *
 * 2. Python. The lowering of `Sum`/`Product` is a generator expression, whose
 *    element is an expression. A body that is an assignment or a block of
 *    statements declined. Where the `Sum` is the value of a statement (the
 *    body of `compile()` or of `compileFunction()`, a statement of a block,
 *    the right side of an assignment there), it is now a `for` loop with an
 *    accumulator, written ahead of the statement, as the GLSL
 *    target writes a loop-form `Sum`. In any other position the `Sum` still
 *    declines.
 *
 * There is no shader validator in this repository: the tests check the emitted
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

function shader(src: any, to: 'glsl', options: any = {}): any {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('n', 'real | signed_infinity | nan');
  ce.declare('u', 'real');
  return compile(ce.box(src), { to, fallback: false, ...options }) as any;
}

/**
 * The JavaScript form of the scalar shader body `code`: declarations become
 * `let`, and the integer loop index and its conversion to a float are kept
 * as numbers. Enough for the programs of this file, not a general
 * translator.
 */
function shaderToJS(code: string): string {
  return code
    .replace(/^(\s*)(?:float|int) (\w+)(;| =)/gm, '$1let $2$3')
    .replace(/for \(int (\w+) =/g, 'for (let $1 =')
    .replace(/\bfloat\(/g, '(');
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
      ['Declare', 't', "'unknown'", 0],
      ['If', ['Greater', 'x', 0], ['Assign', 't', 1], ['Assign', 't', 2]],
      't',
    ],
  ],
  [
    'If in a loop body',
    [
      'Block',
      ['Declare', 't', "'unknown'", 0],
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
      ['Declare', 't', "'unknown'", 0],
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
      ['Declare', 't', "'unknown'", 7],
      ['Which', ['Greater', 'x', 1], ['Assign', 't', 1]],
      't',
    ],
  ],
  [
    'restriction',
    [
      'Block',
      ['Declare', 't', "'unknown'", 0],
      ['If', ['Greater', 'x', 0], ['Assign', 't', ['Multiply', 2, 'x']]],
      't',
    ],
  ],
  [
    'an else-less If',
    [
      'Block',
      ['Declare', 't', "'unknown'", 4],
      ['If', ['Greater', 'x', 0], ['Assign', 't', ['Add', 't', 'x']]],
      't',
    ],
  ],
  [
    'a nested If in a block branch',
    [
      'Block',
      ['Declare', 't', "'unknown'", 0],
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
    'a branch whose value is discarded',
    [
      'Block',
      ['Declare', 't', "'unknown'", 0],
      ['If', ['Greater', 'x', 0], ['Assign', 't', 1], ['Add', 'x', 1]],
      't',
    ],
  ],
];

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

  test('a discarded value is an expression statement', () => {
    expect(
      shader(['Block', ['Add', 'x', 1], ['Multiply', 'x', 2]], 'glsl').code
    ).toBe('x + 1.0;\nreturn 2.0 * x;');
  });
});

const limits = ['Limits', 'k', 1, 3];

/** [name, MathJSON]. The input `u` is 5 for the interpreter and for Python. */
const SUMS: [string, any][] = [
  [
    'a block with a local',
    [
      'Sum',
      [
        'Block',
        ['Declare', 't', "'unknown'", ['Add', 'k', 1]],
        ['Multiply', 't', 't'],
      ],
      limits,
    ],
  ],
  [
    'a Product whose block has a local',
    [
      'Product',
      ['Block', ['Declare', 't', "'unknown'", ['Add', 'k', 1]], 't'],
      limits,
    ],
  ],
  [
    'a Sum assigned in a block',
    [
      'Block',
      [
        'Declare',
        's',
        "'unknown'",
        [
          'Sum',
          [
            'Block',
            ['Declare', 't', "'unknown'", ['Add', 'k', 'x']],
            ['Multiply', 't', 't'],
          ],
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
      ['Declare', 'a', "'unknown'", 2],
      [
        'Sum',
        [
          'Block',
          ['Declare', 't', "'unknown'", ['Add', 'k', 'a']],
          ['Multiply', 't', 't'],
        ],
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
          'Declare',
          't',
          "'unknown'",
          [
            'Sum',
            [
              'Block',
              ['Declare', 'w', "'unknown'", ['Multiply', 'j', 'k']],
              'w',
            ],
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
      ['Block', ['Declare', 't', "'unknown'", ['Multiply', 'k', 'j']], 't'],
      limits,
      ['Limits', 'j', 1, 2],
    ],
  ],
  [
    'an index name that the enclosing block uses',
    [
      'Block',
      ['Declare', 'k', "'unknown'", 10],
      [
        'Declare',
        's',
        "'unknown'",
        [
          'Sum',
          [
            'Block',
            ['Declare', 't', "'unknown'", ['Add', 'k', 1]],
            ['Multiply', 't', 't'],
          ],
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
        ['Declare', 'v', "'unknown'", 0],
        [
          'If',
          ['Greater', 'k', 1],
          ['Assign', 'v', ['Add', 'v', 'k']],
          ['Assign', 'v', 0],
        ],
        'v',
      ],
      limits,
    ],
  ],
  [
    'an empty range',
    [
      'Sum',
      ['Block', ['Declare', 'v', "'unknown'", ['Add', 'x', 'k']], 'v'],
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
        '_tv1 = 0',
        'for _tv2 in range(1, 4):',
        '    _tv3 = _tv2 + 1',
        '    _tv1 += _tv3 * _tv3',
        'return _tv1',
      ].join('\n')
    );
  });

  test('a body that writes an input, or that ends with an assignment, declines', () => {
    // A write to a symbol declared in the engine declines.
    expect(() =>
      py.compile(
        pythonEngine().box([
          'Sum',
          ['Block', ['Assign', 'u', ['Add', 'u', 'k']], 'u'],
          limits,
        ])
      )
    ).toThrow(/"u" is not a local of the compiled expression/);
    // An assignment as the body is the static error `assignment-in-operand`.
    expect(() =>
      py.compile(
        pythonEngine().box(['Sum', ['Assign', 'u', ['Add', 'u', 'k']], limits])
      )
    ).toThrow(/invalid expression/);
    // A block that ends with an assignment has the value `Nothing`.
    expect(() =>
      py.compile(
        pythonEngine().box([
          'Product',
          [
            'Block',
            ['Declare', 't', "'unknown'", 0],
            ['Assign', 't', ['Add', 'k', 1]],
          ],
          limits,
        ])
      )
    ).toThrow(/a body of type 'nothing' has no compiled form/);
  });

  test('compileFunction() writes the loop in the function', () => {
    expect(py.compileFunction(pythonEngine().box(SUMS[0][1]), 'f', [])).toBe(
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
    expect(r.code).toContain('for _tv2 in range(1, 4):');
  });

  test('a Sum in another position still declines', () => {
    const body = [
      'Block',
      ['Declare', 't', "'unknown'", ['Add', 'k', 1]],
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
        ['Declare', 't', "'unknown'", 0],
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
      ['Block', ['Declare', 't', "'unknown'", 'k'], ['Return', 't']],
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
  // An assignment that is an operand (`(t ≔ 1) + 2`) or a function argument
  // is the static error `assignment-in-operand`, so every target declines.
  const operand: any = [
    'Block',
    ['Declare', 't', "'unknown'", 0],
    ['Declare', 'w', "'unknown'", ['Add', ['Assign', 't', 1], 2]],
    ['Add', 't', 'w'],
  ];
  const argument: any = [
    'Block',
    ['Declare', 't', "'unknown'", 0],
    ['Declare', 'w', "'unknown'", ['Sin', ['Assign', 't', 1]]],
    ['Add', 't', 'w'],
  ];

  test('every target declines', () => {
    for (const to of ['javascript', 'glsl', 'python'] as const)
      for (const src of [operand, argument]) {
        const ce = new ComputeEngine();
        expect(ce.box(src).isValid).toBe(false);
        expect(() => compile(ce.box(src), { to, fallback: false })).toThrow(
          to === 'glsl' ? /outside the GLSL fragment/ : /invalid expression/
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

function engineWithNT(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('n', 'real');
  ce.declare('t', 'real');
  return ce;
}

function engineWithS(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('s', 'real');
  return ce;
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
    const code = py.compileFunction(engineWithNT().box(shadow), 'f', [
      't',
      'n',
    ]);
    expect(code).not.toMatch(/^\s+t = /m);
    expect(code).toMatch(/return t$/m);
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the parameter, a global and a local of the enclosing block keep their values',
    () => {
      const f = py.compileFunction(engineWithNT().box(shadow), 'f', [
        't',
        'n',
      ]);
      // `t` is a global of the host, read by `compile()`.
      const e2 = new ComputeEngine();
      e2.declare('t', 'real');
      e2.declare('n', 'integer');
      const g = py.compile(e2.box(shadow)).code;
      // A local `w` of the enclosing block and a local `w` of a nested block
      // of the body.
      const nested: any = [
        'Block',
        ['Declare', 'w', "'unknown'", 100],
        [
          'Assign',
          's',
          [
            'Sum',
            [
              'Block',
              ['Declare', 'q', "'unknown'", ['Add', 'k', 1]],
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
    [
      'Block',
      ['Declare', 'q', "'unknown'", ['Add', 'k', 1]],
      ['Multiply', 'q', 'q'],
    ],
    limits,
  ];

  test('a root assignment declines', () => {
    // The root is not a local of the compiled code: a write to a symbol
    // declared in the engine declines.
    expect(() =>
      py.compile(engineWithS().box(['Assign', 's', sum]))
    ).toThrow(/"s" is not a local of the compiled expression/);
  });

  (TEST_PYTHON === undefined ? it.skip : it)(
    'the code runs, and a block that reads the assigned name returns it',
    () => {
      const block = py.compile(
        new ComputeEngine().box([
          'Block',
          ['Declare', 's', "'unknown'", sum],
          's',
        ])
      ).code;
      const out = runPython(
        `import json\ndef h():\n${indentPython(block)}\n` +
          `print(json.dumps([h()]))`
      );
      expect(out).toEqual([new ComputeEngine().box(sum).evaluate().re]);
    }
  );
});

describe('AN ASSIGNMENT IN A CONDITION', () => {
  test('GLSL declines a write to a boolean input', () => {
    // A write to a symbol declared in the engine declines.
    const ce = new ComputeEngine();
    ce.declare('x', 'real | signed_infinity | nan');
    ce.declare('flag', 'boolean');
    expect(() =>
      compile(
        ce.box([
          'Block',
          ['Declare', 't', "'unknown'", 0],
          [
            'If',
            ['Greater', 'x', 0],
            ['Assign', 'flag', ['Greater', 'x', 1]],
            ['Assign', 't', 2],
          ],
          't',
        ]),
        { to: 'glsl', fallback: false }
      )
    ).toThrow(/`Assign` writes `flag`, which is not a local of the function/);
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
    ['Block', ['Declare', 'q', "'unknown'", ['Multiply', 'k', 10]], 'q'],
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
