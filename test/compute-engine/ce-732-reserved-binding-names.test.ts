/**
 * CE-732. A binding that the compiled JavaScript emits (a function
 * parameter, a block local, a loop index, an integration variable) must not
 * have a name that strict-mode JavaScript refuses for a binding, or the name
 * of a global that the emitted code reads.
 *
 * `(arguments) ↦ 2 · arguments` compiled to `(arguments) => 2 * arguments`:
 * `run(3)` gave 6, but `code` is a syntax error in strict-mode code
 * ("Unexpected eval or arguments in strict mode"), so a host that evaluated
 * `code` in a module (always strict) failed. A reserved word (`if`, `class`)
 * made the compilation fall back to the interpreter, and a binding named
 * `Math` hid the global that `Math.sin` reads ("Math.sin is not a function").
 *
 * These names are now in `CompileTarget.reservedEmittedNames`
 * (`JAVASCRIPT_RESERVED_IDENTIFIERS`), so such a binding is emitted under a
 * fresh name, as a binding named `_SYS` is: `_p` for a function parameter
 * (`lambdaParamBinding()`), a temporary (`_tv1`) for a block local, a local of
 * a loop body, a loop index or an integration variable. A write to the binding
 * uses the same name. A free symbol keeps its name: the code reads it as a
 * property of the vars object (`_.arguments`). The tests for `_SYS`, `_upper`
 * and `_CND` are in `compile-reserved-emitted-names.test.ts`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const R = "'real'";
const I = "'integer'";

/** Throws when `code` is not a valid expression in strict-mode code. */
function assertStrictModeValid(code: string): void {
  // eslint-disable-next-line no-new-func
  new Function(`"use strict"; return (${code});`);
}

/** The interpreter's value of `fn` applied to `args`. */
function interpreted(ce: ComputeEngine, fn: unknown, args: number[]): number {
  return ce.box(['Apply', fn, ...args] as never).N().re;
}

function check(fn: unknown, args: number[]): string {
  const ce = new ComputeEngine();
  const result = compile(ce.box(fn as never), { to: 'javascript' });
  expect(result.success).toBe(true);
  const code = result.code as string;
  expect(() => assertStrictModeValid(code)).not.toThrow();
  // The `code` string runs on its own too, with the runtime helpers.
  expect(result.run!(...(args as never[])) as number).toBeCloseTo(
    interpreted(ce, fn, args),
    10
  );
  return code;
}

const NAMES = [
  'arguments',
  'eval',
  'if',
  'class',
  'let',
  'yield',
  'static',
  'await',
  'Math',
  'undefined',
  '_SYS',
];

describe('CE-732: a binding with a reserved name, javascript target', () => {
  test('the reported case: a parameter named `arguments`', () => {
    const code = check(
      ['Function', ['Multiply', 2, 'arguments'], ['Typed', 'arguments', R]],
      [3]
    );
    expect(code).toBe('(_p) => 2 * _p');
  });

  test.each(NAMES)('a parameter named `%s`', (n) => {
    const code = check(
      ['Function', ['Add', ['Sin', n], 'Pi'], ['Typed', n, R]],
      [3]
    );
    expect(code).not.toMatch(new RegExp(`\\(${n}\\)`));
  });

  test('two parameters, one of them already named `_p`', () => {
    check(
      [
        'Function',
        ['Add', 'arguments', ['Multiply', 10, '_p']],
        ['Typed', 'arguments', R],
        ['Typed', '_p', R],
      ],
      [1, 2]
    );
  });

  test('a parameter with a default value', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      ['Multiply', 'x', 'let'],
      'x',
      ['Optional', 'let', 2],
    ];
    const result = compile(ce.box(fn as never), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(() => assertStrictModeValid(result.code as string)).not.toThrow();
    expect(result.run!(3 as never)).toBe(6);
    expect(result.run!(3 as never, 4 as never)).toBe(12);
  });

  test('a parameter of a nested function literal', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      ['Map', ['Function', ['Multiply', 'y', 'eval'], 'eval'], ['List', 1, 2]],
      ['Typed', 'y', R],
    ];
    const result = compile(ce.box(fn as never), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(() => assertStrictModeValid(result.code as string)).not.toThrow();
    expect(result.run!(3 as never)).toEqual([3, 6]);
  });

  test.each(NAMES)('a block local named `%s`', (n) => {
    const code = check(
      [
        'Function',
        [
          'Block',
          ['Declare', n, R, ['Multiply', 2, 'y']],
          ['Add', ['Sin', n], 'Pi'],
        ],
        ['Typed', 'y', R],
      ],
      [2]
    );
    expect(code).not.toContain(`let ${n};`);
  });

  test('locals of nested blocks, written in the inner block', () => {
    check(
      [
        'Function',
        [
          'Block',
          ['Assign', 'let', 1],
          [
            'Block',
            ['Assign', 'eval', ['Add', 'let', 'y']],
            ['Assign', 'let', ['Multiply', 'eval', 2]],
          ],
          'let',
        ],
        ['Typed', 'y', R],
      ],
      [3]
    );
  });

  test('a block-local function named `eval`', () => {
    check(
      [
        'Function',
        [
          'Block',
          ['Assign', 'eval', ['Function', ['Multiply', 2, 'let'], 'let']],
          ['eval', 'y'],
        ],
        ['Typed', 'y', R],
      ],
      [3]
    );
  });

  test.each(NAMES)('a `Sum` index named `%s`', (n) => {
    const code = check(
      [
        'Function',
        ['Sum', ['Multiply', 'y', n], ['Limits', n, 1, 'm']],
        ['Typed', 'y', R],
        ['Typed', 'm', I],
      ],
      [2, 50]
    );
    expect(code).not.toContain(`let ${n} = 1;`);
  });

  test('a `Product` index and a second `Sum` index', () => {
    check(
      [
        'Function',
        ['Product', ['Add', 'y', 'arguments'], ['Limits', 'arguments', 1, 'm']],
        ['Typed', 'y', R],
        ['Typed', 'm', I],
      ],
      [2, 10]
    );
    check(
      [
        'Function',
        [
          'Sum',
          ['Multiply', 'y', 'eval', 'Math'],
          ['Limits', 'eval', 1, 'm'],
          ['Limits', 'Math', 1, 'm'],
        ],
        ['Typed', 'y', R],
        ['Typed', 'm', I],
      ],
      [2, 4]
    );
  });

  const loop = (n: string, ...clause: unknown[]) => [
    'Function',
    [
      'Block',
      ['Declare', 's', R, 0],
      ['Loop', ['Assign', 's', ['Add', 's', ['Multiply', 'y', n]]], ...clause],
      's',
    ],
    ['Typed', 'y', R],
    ['Typed', 'm', I],
  ];

  test.each([
    ['a counted range', ['Element', 'arguments', ['Range', 1, 5]]],
    [
      'a range with an input bound',
      ['Element', 'arguments', ['Range', 1, 'm']],
    ],
    ['a list', ['Element', 'arguments', ['List', 1, 2, 3]]],
    [
      'a guarded list',
      ['Element', 'arguments', ['List', 1, 2, 3], ['Greater', 'arguments', 1]],
    ],
  ])('a `Loop` index over %s', (_, clause) => {
    const code = check(loop('arguments', clause), [2, 5]);
    expect(code).not.toMatch(/\barguments\b/);
  });

  test('a destructured `Loop` index', () => {
    check(
      loop('let', [
        'Element',
        ['Tuple', 'let', 'q'],
        ['List', ['Tuple', 1, 2], ['Tuple', 3, 4]],
      ]),
      [2, 0]
    );
  });

  test('a `Comprehension` index', () => {
    const ce = new ComputeEngine();
    const fn = [
      'Function',
      [
        'Comprehension',
        ['Multiply', 'y', 'let'],
        ['Element', 'let', ['List', 1, 2, 3]],
      ],
      ['Typed', 'y', R],
    ];
    const result = compile(ce.box(fn as never), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(() => assertStrictModeValid(result.code as string)).not.toThrow();
    expect(result.run!(2 as never)).toEqual([2, 4, 6]);
  });

  test('an integration variable', () => {
    const code = check(
      [
        'Function',
        [
          'Integrate',
          ['Sin', ['Multiply', 'y', 'arguments', 'arguments']],
          ['Limits', 'arguments', 0, 1],
        ],
        ['Typed', 'y', R],
      ],
      [2]
    );
    expect(code).not.toContain('(arguments) =>');
  });

  test('an integration variable named `Math`, with the log-space form', () => {
    const code = check(
      [
        'Function',
        [
          'Integrate',
          ['Multiply', ['Power', 'Math', 100], ['Exp', ['Negate', 'Math']]],
          ['Limits', 'Math', 0, 'y'],
        ],
        ['Typed', 'y', R],
      ],
      [1500]
    );
    expect(code).toContain('_SYS.finiteOr(');
    expect(code).not.toContain('(Math) =>');
  });

  test('a free symbol keeps its name, read from the vars object', () => {
    const ce = new ComputeEngine();
    const result = compile(ce.box(['Multiply', 2, 'arguments'] as never), {
      to: 'javascript',
    });
    expect(result.code).toBe('2 * _.arguments');
    expect(result.run!({ arguments: 3 } as never)).toBe(6);
  });

  test.each(['arguments', 'Math', 'console'])(
    'a function body that writes its parameter named `%s`',
    (n) => {
      const code = check(
        [
          'Function',
          ['Block', ['Assign', n, ['Add', n, 1]], n],
          ['Typed', n, R],
        ],
        [3]
      );
      expect(code).toContain('_p = _p + 1');
    }
  );

  test.each(['arguments', 'Math'])(
    'a nested function literal that writes its parameter named `%s`',
    (n) => {
      const ce = new ComputeEngine();
      const fn = [
        'Function',
        [
          'Map',
          [
            'Function',
            ['Block', ['Assign', n, ['Multiply', n, 'y']], n],
            ['Typed', n, R],
          ],
          ['List', 1, 2],
        ],
        ['Typed', 'y', R],
      ];
      const result = compile(ce.box(fn as never), { to: 'javascript' });
      expect(result.success).toBe(true);
      expect(() => assertStrictModeValid(result.code as string)).not.toThrow();
      expect(result.run!(3 as never)).toEqual([3, 6]);
    }
  );

  test('an engine-defined function that writes its parameter named `Math`', () => {
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce.box([
        'Function',
        [
          'Block',
          ['Assign', 'Math', ['Multiply', 'Math', 2]],
          ['Add', 'Math', 1],
        ],
        ['Typed', 'Math', R],
      ] as never)
    );
    const fn = ['Function', ['g', 'y'], ['Typed', 'y', R]];
    const result = compile(ce.box(fn as never), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(() => assertStrictModeValid(result.code as string)).not.toThrow();
    expect(result.run!(3 as never)).toBe(7);
  });

  // The fresh name of a renamed parameter is not a name of the body. The
  // body of an engine-defined function is not part of the compiled
  // expression, so its names join the collision inventory before the
  // parameters are renamed; otherwise the local `_p` hid the parameter `Math`
  // emitted as `_p`, and `g(3)` gave 2.
  test.each(['_p', '_p1'])(
    'an engine-defined function with a parameter named `Math` and a local named `%s`',
    (local) => {
      const ce = new ComputeEngine();
      ce.assign(
        'g',
        ce.box([
          'Function',
          ['Block', ['Assign', local, 1], ['Add', 'Math', local]],
          ['Typed', 'Math', R],
        ] as never)
      );
      const fn = ['Function', ['g', 'y'], ['Typed', 'y', R]];
      const result = compile(ce.box(fn as never), { to: 'javascript' });
      expect(result.success).toBe(true);
      expect(() => assertStrictModeValid(result.code as string)).not.toThrow();
      expect(result.run!(3 as never)).toBe(4);
    }
  );

  test('a nested function literal with a parameter named `Math` and a local named `_p`', () => {
    const fn = [
      'Function',
      [
        'Map',
        [
          'Function',
          ['Block', ['Assign', '_p', 1], ['Add', 'Math', '_p', 'y']],
          'Math',
        ],
        ['List', 1, 2],
      ],
      ['Typed', 'y', R],
    ];
    const ce = new ComputeEngine();
    const result = compile(ce.box(fn as never), { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(() => assertStrictModeValid(result.code as string)).not.toThrow();
    expect(result.run!(3 as never)).toEqual([5, 6]);
  });

  // A write to a `Match` capture declines, whether the capture has a
  // reserved name or not. A write accepted for the reserved name threw
  // "Assignment to constant variable" at run time. The body of a `MatchCase`
  // is a statement, so the `Assign` is valid; the compilation declines
  // because a read of the capture is not a reference that can be assigned.
  test.each(['Math', 'm'])(
    'a write to a `Match` capture named `%s` declines',
    (n) => {
      const ce = new ComputeEngine();
      const fn = [
        'Function',
        [
          'Block',
          ['Declare', 'i', I, 0],
          [
            'Loop',
            [
              'Match',
              'i',
              ['MatchCase', `_${n}`, ['Assign', n, ['Add', n, 1]]],
            ],
            ['Element', 'i', ['Range', 1, 3]],
          ],
          'y',
        ],
        ['Typed', 'y', R],
      ];
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
      try {
        const result = compile(ce.box(fn as never), { to: 'javascript' });
        expect(result.success).toBe(false);
        expect(String(warn.mock.calls[0]?.[0])).toMatch(
          new RegExp(
            `compiles reads of "${n}" as .*not an assignable reference`,
            's'
          )
        );
      } finally {
        warn.mockRestore();
      }
    }
  );

  // A `Sum` or `Product` body that writes its index declines, whether the
  // index has a reserved name or not. The interpreter gives the value.
  test.each([
    ['Sum', 'j', 10],
    ['Sum', 'Math', 10],
    ['Product', 'j', 24],
    ['Product', 'Math', 24],
  ] as const)(
    'a `%s` body that assigns its index `%s` to itself declines',
    (op, k, v) => {
      const ce = new ComputeEngine();
      const fn = [
        'Function',
        [op, ['Block', ['Assign', k, k], k], ['Limits', k, 1, 'n']],
        ['Typed', 'n', I],
      ];
      expect(() =>
        compile(ce.box(fn as never), {
          to: 'javascript',
          constantFold: false,
          fallback: false,
        } as never)
      ).toThrow(`the body writes the index \`${k}\``);
      expect(interpreted(ce, fn, [4])).toBe(v);
    }
  );

  // Some emitted collection tests read `ArrayBuffer.isView`, so the name is
  // reserved like the other globals that the emitted code reads.
  test('a parameter named `ArrayBuffer`', () => {
    const code = check(
      ['Function', ['Add', 'ArrayBuffer', 1], ['Typed', 'ArrayBuffer', R]],
      [3]
    );
    expect(code).not.toContain('(ArrayBuffer)');
  });
});

describe('CE-732: a local of a loop body with a reserved name', () => {
  /** Compile `json` with the input `n`, run it at `n`, and compare with the
   * interpreter. */
  function checkLoop(json: unknown, n: number): string {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const result = compile(ce.box(json as never), { to: 'javascript' });
    expect(result.success).toBe(true);
    const code = result.code as string;
    expect(() => assertStrictModeValid(code)).not.toThrow();
    ce.assign('n', n);
    const expected = ce.box(json as never).evaluate().re;
    expect(result.run!({ n } as never)).toBe(expected);
    return code;
  }

  test.each(['arguments', 'Math'])(
    'a local of a block loop body: `%s`',
    (v) => {
      const code = checkLoop(
        [
          'Block',
          ['Assign', 's', 0],
          [
            'Loop',
            ['Block', ['Declare', v, I, 'i'], ['Assign', 's', ['Add', 's', v]]],
            ['Element', 'i', ['Range', 1, 'n']],
          ],
          's',
        ],
        4
      );
      expect(code).not.toContain(`let ${v};`);
    }
  );

  test.each(['arguments', 'Math'])(
    'a leaf of a destructuring assignment in a loop body: `%s`',
    (v) => {
      const code = checkLoop(
        [
          'Block',
          ['Assign', 's', 0],
          [
            'Loop',
            [
              'Block',
              ['Declare', v, I, 0],
              ['Declare', 'q', I, 0],
              ['Assign', ['Tuple', v, 'q'], 'p'],
              ['Assign', 's', ['Add', 's', v, 'q']],
            ],
            ['Element', 'p', ['List', ['Tuple', 1, 2], ['Tuple', 3, 'n']]],
          ],
          's',
        ],
        4
      );
      expect(code).not.toContain(`let ${v};`);
    }
  );

  test.each(['arguments', 'Math'])(
    'a local whose value is assigned to another local in a loop body: `%s`',
    (v) => {
      // A chained assignment is a static error, so the loop body has two
      // statements.
      const code = checkLoop(
        [
          'Block',
          ['Assign', 's', 0],
          [
            'Loop',
            [
              'Block',
              ['Declare', v, I, ['Add', 's', 'i']],
              ['Assign', 's', v],
            ],
            ['Element', 'i', ['Range', 1, 'n']],
          ],
          's',
        ],
        4
      );
      expect(code).not.toContain(`${v} = `);
    }
  );
});

describe('CE-732: a local of a loop body inside a function literal', () => {
  // The declaration of the local and each read and write in the loop body
  // use the fresh name, and naming the local records no free symbol, so the
  // function literal is not declined for an unbound input.
  test.each(['arguments', 'Math'])(
    'a local of a block loop body: `%s`',
    (v) => {
      const code = check(
        [
          'Function',
          [
            'Block',
            ['Assign', 's', 0],
            [
              'Loop',
              [
                'Block',
                ['Declare', v, R, ['Multiply', 'i', 'y']],
                ['Assign', 's', ['Add', 's', ['Sin', v]]],
              ],
              ['Element', 'i', ['Range', 1, 'm']],
            ],
            's',
          ],
          ['Typed', 'y', R],
          ['Typed', 'm', I],
        ],
        [2, 4]
      );
      expect(code).not.toMatch(new RegExp(`\\b${v}\\b(?!\\.)`));
    }
  );
});

describe('CE-732: a binding with a reserved name, interval-js target', () => {
  const point = (v: number) => ({ kind: 'interval', value: { lo: v, hi: v } });

  function run(json: unknown, vars: Record<string, number>) {
    const ce = new ComputeEngine();
    for (const k of Object.keys(vars)) ce.declare(k, 'integer');
    const result = compile(ce.box(json as never), { to: 'interval-js' });
    expect(result.success).toBe(true);
    return { code: result.code as string, value: result.run!(vars as never) };
  }

  // A `Sum` body that writes its index declines, whether the index has a
  // reserved name or not.
  test.each(['j', 'Math'])(
    'a `Sum` body that assigns its index `%s` declines',
    (k) => {
      const ce = new ComputeEngine();
      ce.declare('n', 'integer');
      const expr = [
        'Sum',
        ['Block', ['Assign', k, ['Add', k, 1]], k],
        ['Limits', k, 1, 'n'],
      ];
      const result = compile(ce.box(expr as never), {
        to: 'interval-js',
        constantFold: false,
        fallback: false,
      } as never);
      expect(result.success).toBe(false);
      expect(result.error).toContain(`the body writes the index \`${k}\``);
    }
  );

  test('a block local', () => {
    const { code, value } = run(
      [
        'Block',
        ['Assign', 'arguments', ['Multiply', 2, 'n']],
        ['Add', 'arguments', 1],
      ],
      { n: 3 }
    );
    expect(code).not.toContain('let arguments');
    expect(value).toEqual(point(7));
  });

  test('a `Sum` index with an input bound', () => {
    const { code, value } = run(
      ['Sum', ['Multiply', 2, 'eval'], ['Limits', 'eval', 1, 'n']],
      { n: 4 }
    );
    expect(code).not.toContain('let eval');
    expect(value).toEqual(point(20));
  });

  test('a `Loop` index', () => {
    const { code, value } = run(
      [
        'Block',
        ['Assign', 'c', 0],
        [
          'Loop',
          ['Assign', 'c', ['Add', 'c', 'let']],
          ['Element', 'let', ['Range', 1, 'n']],
        ],
        'c',
      ],
      { n: 3 }
    );
    expect(code).not.toContain('const let of');
    expect(value).toEqual(point(6));
  });

  test('an integration variable', () => {
    const ce = new ComputeEngine();
    const result = compile(
      ce.box([
        'Integrate',
        ['Sin', ['Multiply', 'arguments', 'arguments']],
        ['Limits', 'arguments', 0, 1],
      ] as never),
      { to: 'interval-js' }
    );
    expect(result.success).toBe(true);
    expect(result.code).not.toContain('(arguments) =>');
    const v = result.run!({} as never) as { value: { lo: number; hi: number } };
    // ∫₀¹ sin(t²) dt = 0.3102683017233811...
    expect(v.value.lo).toBeCloseTo(0.3102683017233811, 8);
    expect(v.value.hi).toBeCloseTo(0.3102683017233811, 8);
  });
});
