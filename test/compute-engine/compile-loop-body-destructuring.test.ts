/**
 * A destructuring `let` inside a loop body compiles to JavaScript.
 *
 * The statement list of a loop body is lowered by its own routine, not by the
 * block lowering. That routine desugared a destructuring ASSIGNMENT into
 * per-leaf writes, but not a destructuring DECLARATION
 * (`let (a, x) = (2, 3)`). The declaration then reached the value-position
 * `Declare` lowering, which fails closed, and the whole program declined with
 * "Could not compile a destructuring declaration in value position". Every
 * statement of a loop body is in statement position (the body has no value),
 * so the declaration is now desugared into per-leaf declarations there, as the
 * block lowering does for a block's statements.
 *
 * Every program is checked for parity between `evaluate()` and the compiled
 * `run()`.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { TEST_PYTHON } from './test-python';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compile';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { parseEpsil } from '../../src/epsil/parse-epsil';

/** The interpreted and the compiled value of an Epsil program. */
function parity(source: string): { evaluated: number; compiled: number } {
  const ce = new ComputeEngine();
  const [program] = parseEpsil(source);
  const expr = ce.box(program);
  const result = compile(expr, { to: 'javascript' });
  if (!result.success)
    throw new Error(`did not compile: ${source}\n${JSON.stringify(result)}`);
  return {
    evaluated: expr.evaluate().N().re,
    compiled: result.run!({}) as number,
  };
}

function expectParity(source: string, expected: number): void {
  const { evaluated, compiled } = parity(source);
  expect(evaluated).toBe(expected);
  expect(compiled).toBe(expected);
}

describe('Destructuring let in a compiled loop body', () => {
  test('while loop, destructuring let as the first statement', () => {
    expectParity(
      `let n = 0
while n < 4 { let (a, x) = (2, 3); n = n + a }
n`,
      4
    );
  });

  test('while loop, destructuring let as the last statement', () => {
    expectParity(
      `let n = 0
while n < 4 { n = n + 1; let (a, x) = (2, 3) }
n`,
      4
    );
  });

  test('while loop, two destructuring lets and a nested pattern', () => {
    expectParity(
      `let s = 0
let i = 0
while i < 3 { i = i + 1; let (a, (b, c)) = (i, (2, 3)); let (d, e) = (a, 1); s = s + a + b + c + d + e }
s`,
      // Each turn adds 2i + 6 for i = 1, 2, 3.
      30
    );
  });

  test('for loop, destructuring let as a middle statement', () => {
    expectParity(
      `let s = 0
for k in [1, 2, 3] { let (a, b) = (k, 2 * k); s = s + a + b }
s`,
      18
    );
  });

  test('for loop, destructuring let as the last statement', () => {
    expectParity(
      `let s = 0
for k in [1, 2, 3] { s = s + k; let (a, b) = (k, 2 * k) }
s`,
      6
    );
  });

  test('for loop, destructuring let of a tuple-valued call', () => {
    expectParity(
      `function f(k) { (k, k + 1) }
let s = 0
for k in [1, 2, 3] { let (a, b) = f(k); s = s + a * b }
s`,
      20
    );
  });

  test('for loop, destructuring let inside an if branch', () => {
    expectParity(
      `let s = 0
for k in [1, 2, 3] { if k > 1 { let (a, b) = (k, 10); s = s + a * b } }
s`,
      50
    );
  });

  test('a leaf that shadows an outer local does not write it', () => {
    expectParity(
      `let a = 100
let s = 0
for k in [1, 2] { let (a, b) = (k, 1); s = s + a + b }
s + a`,
      105
    );
  });

  test('a bare destructuring declare as the whole loop body (MathJSON)', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 's', 'integer', 0],
      [
        'Loop',
        ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 1]],
        ['Element', 'k', ['List', 1, 2, 3]],
      ],
      's',
    ]);
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(true);
    expect(result.run!({})).toBe(0);
    expect(expr.evaluate().re).toBe(0);
  });
});

/**
 * The Python and GLSL targets lower a loop body with their own
 * statement routines (`compilePythonStatements`, `compileStatementList`).
 * The Python routine desugared a destructuring declaration in no position,
 * and the shader routine desugared it only inside a `Block` body. A bare
 * destructuring declaration as the whole loop body, and on Python one in a
 * `Block` body too, reached the value-position `Declare` lowering and the
 * program declined with "Could not compile a destructuring declaration in
 * value position".
 */
describe('Destructuring let in a loop body on Python and GLSL', () => {
  const loop = (body: unknown): unknown => [
    'Loop',
    body,
    ['Element', 'k', ['Range', 1, 3]],
  ];
  const CASES: Array<{ name: string; json: unknown; expected: number }> = [
    {
      name: 'a bare two-position declare',
      json: [
        'Block',
        loop(['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 2]]),
        0,
      ],
      expected: 0,
    },
    {
      name: 'a bare three-position declare',
      json: [
        'Block',
        loop([
          'Declare',
          ['Tuple', 'a', 'b', 'c'],
          'unknown',
          ['Tuple', 'k', 2, 3],
        ]),
        0,
      ],
      expected: 0,
    },
    {
      name: 'a bare nested pattern',
      json: [
        'Block',
        loop([
          'Declare',
          ['Tuple', 'a', ['Tuple', 'b', 'c']],
          'unknown',
          ['Tuple', 'k', ['Tuple', 2, 3]],
        ]),
        0,
      ],
      expected: 0,
    },
    {
      name: 'a bare declare whose leaf shadows an outer local',
      json: [
        'Block',
        ['Declare', 'a', 'integer', 100],
        loop(['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 1]]),
        'a',
      ],
      expected: 100,
    },
    {
      name: 'the last statement of a block body',
      json: [
        'Block',
        ['Declare', 's', 'integer', 0],
        loop([
          'Block',
          ['Assign', 's', ['Add', 's', 'k']],
          ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 2]],
        ]),
        's',
      ],
      expected: 6,
    },
    {
      name: 'a three-position declare read by the next statement',
      json: [
        'Block',
        ['Declare', 's', 'integer', 0],
        loop([
          'Block',
          [
            'Declare',
            ['Tuple', 'a', 'b', 'c'],
            'unknown',
            ['Tuple', 'k', 2, 3],
          ],
          ['Assign', 's', ['Add', 's', 'a', 'b', 'c']],
        ]),
        's',
      ],
      // Each turn adds k + 5 for k = 1, 2, 3.
      expected: 21,
    },
  ];

  test.each(CASES)('$name: the interpreter value', ({ json, expected }) => {
    const ce = new ComputeEngine();
    expect(ce.box(json as any).evaluate().re).toBe(expected);
  });

  for (const to of ['python', 'glsl'] as const)
    test.each(CASES)(`$name: compiles on ${to}`, ({ json }) => {
      const ce = new ComputeEngine();
      const result = compile(ce.box(json as any), { to, fallback: false });
      expect(result.success).toBe(true);
    });

  test('GLSL declares each leaf in the loop body', () => {
    const ce = new ComputeEngine();
    const code = compile(ce.box(CASES[1].json as any), {
      to: 'glsl',
      fallback: false,
    }).code.replace(/\s+/g, ' ');
    expect(code).toContain(
      '{ float a; a = float(k); float b; b = 2.0; float c; c = 3.0; }'
    );
  });

  // The emitted Python runs only with `CE_TEST_PYTHON=1` (`test-python.ts`).
  const describePython = TEST_PYTHON === undefined ? describe.skip : describe;
  describePython('Python execution', () => {
    test('the emitted Python gives the interpreter value', () => {
      const ce = new ComputeEngine();
      const python = new PythonTarget();
      const programs: Array<{ name: string; expr: any; expected: number }> = [
        ...CASES.map((c) => ({
          name: c.name,
          expr: ce.box(c.json as any),
          expected: c.expected,
        })),
        ...EPSIL_PROGRAMS.map(([source, expected]) => ({
          name: source,
          expr: ce.box(parseEpsil(source)[0]),
          expected,
        })),
      ];
      let program = 'import cmath, math, json\n\n';
      programs.forEach((p, i) => {
        program += `${python.compileFunction(p.expr, `fn_${i}`, [])}\n`;
      });
      program += `print(json.dumps([${programs.map((_, i) => `fn_${i}()`).join(', ')}]))\n`;
      const file = path.join(os.tmpdir(), `ce-py-loop-body-${process.pid}.py`);
      fs.writeFileSync(file, program);
      let out = '';
      try {
        out = execFileSync(TEST_PYTHON!, [file], { encoding: 'utf8' });
      } finally {
        fs.unlinkSync(file);
      }
      const actual = JSON.parse(out) as number[];
      programs.forEach((p, i) => {
        expect([p.name, actual[i]]).toEqual([p.name, p.expected]);
        expect([p.name, p.expr.evaluate().N().re]).toEqual([
          p.name,
          p.expected,
        ]);
      });
    });
  });
});

/**
 * Epsil programs with a destructuring `let` in a loop body, and their
 * value, for the Python execution test. A tuple-valued call (`f(k)`) is
 * left out: on Python it declines for a different reason (the lowering
 * through one temporary is admitted on JavaScript only,
 * `destructureViaTemp()`).
 */
const EPSIL_PROGRAMS: Array<[string, number]> = [
  ['let n = 0\nwhile n < 4 { let (a, x) = (2, 3); n = n + a }\nn', 4],
  ['let n = 0\nwhile n < 4 { n = n + 1; let (a, x) = (2, 3) }\nn', 4],
  [
    'let s = 0\nlet i = 0\nwhile i < 3 { i = i + 1; let (a, (b, c)) = (i, (2, 3)); let (d, e) = (a, 1); s = s + a + b + c + d + e }\ns',
    30,
  ],
  ['let s = 0\nfor k in [1, 2, 3] { let (a, b) = (k, 2 * k); s = s + a + b }\ns', 18],
  ['let s = 0\nfor k in [1, 2, 3] { s = s + k; let (a, b) = (k, 2 * k) }\ns', 6],
  [
    'let s = 0\nfor k in [1, 2, 3] { if k > 1 { let (a, b) = (k, 10); s = s + a * b } }\ns',
    50,
  ],
  [
    'let a = 100\nlet s = 0\nfor k in [1, 2] { let (a, b) = (k, 1); s = s + a + b }\ns + a',
    105,
  ],
  ['let s = 0\nfor k in 1..3 { let (a, b, c) = (k, 2, 3); s = s + a + b + c }\ns', 21],
  ['let s = 0\nfor k in 1..3 { s = s + k; let (a, b, c) = (k, 2, 3) }\ns', 6],
];

/**
 * The interpreter evaluates the whole value of a destructuring `let` before
 * it binds any name of the pattern, so an element that reads a name of the
 * pattern reads the binding from before the statement. The compiled
 * declaration of that name hides the earlier binding in the same scope: the
 * per-leaf form read the value just bound (300 became 6 below). Such a
 * statement is not compiled on any target, and the interpreter evaluates it.
 */
describe('A destructuring let whose value reads a name of the pattern', () => {
  const loop = (body: unknown, hi = 3): unknown => [
    'Loop',
    body,
    ['Element', 'k', ['Range', 1, hi]],
  ];
  const CASES: Array<{ name: string; json: unknown; expected: number }> = [
    {
      name: 'an element reads the outer value of a leaf',
      json: [
        'Block',
        ['Declare', 'a', 'integer', 100],
        ['Declare', 's', 'number', 0],
        loop([
          'Block',
          ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'k', 'a']],
          ['Assign', 's', ['Add', 's', 'b']],
        ]),
        's',
      ],
      expected: 300,
    },
    {
      name: 'a swap of two outer values',
      json: [
        'Block',
        ['Declare', 'a', 'integer', 1],
        ['Declare', 'b', 'integer', 2],
        ['Declare', 's', 'number', 0],
        loop([
          'Block',
          ['Declare', ['Tuple', 'a', 'b'], 'unknown', ['Tuple', 'b', 'a']],
          ['Assign', 's', ['Add', ['Multiply', 10, 's'], 'a']],
        ]),
        's',
      ],
      // Each turn reads a = 2 (the outer b): 2, 22, 222.
      expected: 222,
    },
  ];

  // An assignment in an element of the value (`let (a, _) = (k, s := a)`) is
  // the static error `assignment-in-operand`, so every target declines.
  test('an assignment in a `_` element is a static error', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'a', 'integer', 100],
      ['Declare', 's', 'integer', 0],
      loop(
        ['Declare', ['Tuple', 'a', '_'], 'unknown', ['Tuple', 'k', ['Assign', 's', 'a']]],
        1
      ),
      's',
    ] as any);
    expect(expr.isValid).toBe(false);
    for (const to of ['javascript', 'python', 'glsl'] as const)
      expect(() => compile(expr, { to, fallback: false })).toThrow(
        /invalid expression/
      );
  });

  test.each(CASES)('$name: the interpreter value', ({ json, expected }) => {
    const ce = new ComputeEngine();
    expect(ce.box(json as any).evaluate().re).toBe(expected);
  });

  for (const to of ['javascript', 'python', 'glsl'] as const)
    test.each(CASES)(`$name: declines on ${to}`, ({ json }) => {
      const ce = new ComputeEngine();
      expect(() =>
        compile(ce.box(json as any), { to, fallback: false })
      ).toThrow(/whose value reads 'a', a name that the pattern declares/);
    });

  test.each(CASES)(
    '$name: the JavaScript fallback gives the interpreter value',
    ({ json, expected }) => {
      const ce = new ComputeEngine();
      const result = compile(ce.box(json as any), { to: 'javascript' });
      expect(result.success).toBe(false);
      expect(result.run!({})).toBe(expected);
    }
  );
});

/**
 * The check above is syntactic: a value that uses a name of the pattern
 * only as a bound variable of an inner scope (a `Sum` index, a parameter of
 * a function literal) also declines, although the compiled per-leaf form
 * gives the interpreter value there. A check that knows the scopes is a
 * separate task. With the default fallback, the interpreter value comes
 * back.
 */
describe('A pattern name used only as a bound variable of the value', () => {
  const CASES: Array<{ name: string; json: () => unknown; expected: number }> =
    [
      {
        name: 'a Sum index (Epsil)',
        json: () => parseEpsil('let (i, s) = (3, Sum(i^2, (i, 1, 10)))\ns')[0],
        expected: 385,
      },
      {
        name: 'a parameter of a function literal (Epsil)',
        json: () => parseEpsil('let (x, g) = (1, (x) => x + 1)\nx')[0],
        expected: 1,
      },
      {
        name: 'a Sum index (MathJSON)',
        json: () => [
          'Block',
          [
            'Declare',
            ['Tuple', 'a', 'b'],
            'unknown',
            ['Tuple', ['Sum', 'a', ['Limits', 'a', 1, 4]], 0],
          ],
          'a',
        ],
        expected: 10,
      },
    ];

  test.each(CASES)('$name: declines on javascript', ({ json, expected }) => {
    const ce = new ComputeEngine();
    const expr = ce.box(json() as any);
    expect(expr.evaluate().re).toBe(expected);
    expect(() => compile(expr, { to: 'javascript', fallback: false })).toThrow(
      /whose value reads '[a-z]', a name that the pattern declares/
    );
    const result = compile(expr, { to: 'javascript' });
    expect(result.success).toBe(false);
    expect(result.run!({})).toBe(expected);
  });
});
