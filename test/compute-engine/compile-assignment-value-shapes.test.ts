import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import type { MathJsonExpression } from '../../src/math-json/types';
import { TEST_PYTHON } from './test-python';

// The compiled code of a statement whose value is not a plain expression:
// an assignment whose value is a block or another assignment, a block whose
// last statement is a declaration or a nested block, and a block local that
// is read before it has a value. Most of these forms are static errors or
// compiler declines: a block with an assignment as an operand declines, an
// assignment as an operand is the static error `assignment-in-operand`, and
// a block that ends with an assignment or a declaration has the value
// `Nothing`, which has no compiled form.

const pythonHasNumpy = (() => {
  if (TEST_PYTHON === undefined || !fs.existsSync(TEST_PYTHON)) return false;
  try {
    execFileSync(TEST_PYTHON, ['-I', '-c', 'import numpy'], {
      stdio: 'ignore',
    });
    return true;
  } catch {
    return false;
  }
})();
const itPython = pythonHasNumpy ? it : it.skip;

/** Run the Python function `def f(x)` that `source` defines, at `x`. */
function runPython(source: string, x: number): number {
  const program = `import numpy as np\nimport math\n${source}\nprint(float(f(${x})))\n`;
  return Number(
    execFileSync(TEST_PYTHON!, ['-I', '-c', program], { encoding: 'utf8' })
  );
}

/** The interpreter's value of `json` with `x` assigned `3`. */
function interpreterAt3(json: MathJsonExpression): string {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('x', 3);
  return ce.box(json).evaluate().toString();
}

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  return ce;
}

const gpuSource = (r: { code?: string; preamble?: string }) =>
  (r.preamble ?? '') + (r.code ?? '');

/** Lines that only an invalid splice of a statement produces. */
function expectValidShaderShape(code: string) {
  expect(code).not.toMatch(/return\s+(?:float|var|let)\b/);
  expect(code).not.toMatch(/=\s*[A-Za-z_]\w*\s*=[^=]/);
  expect(code).not.toContain(';;');
}

describe('an assignment whose value is a block', () => {
  // `t ≔ Block(u ≔ s; 2u)`: the value of the inner block is `2u`.
  const json: MathJsonExpression = [
    'Block',
    ['Assign', 's', 'x'],
    ['Assign', 't', ['Block', ['Assign', 'u', 's'], ['Multiply', 2, 'u']]],
    ['Add', 't', 1],
  ];

  test('the interpreter gives 7 at x = 3', () => {
    expect(interpreterAt3(json)).toBe('7');
  });

  test('JavaScript declines', () => {
    // A block with an assignment as the value of an assignment declines.
    expect(() => compile(engine().box(json), { fallback: false })).toThrow(
      /a block with a statement other than a declaration with a value is an operand here/
    );
  });

  test('Python declines on compile() and compileFunction()', () => {
    // It emitted `t = u = s` and `return 2 * u`, which returned 6.
    const ce = engine();
    expect(compile(ce.box(json), { to: 'python' }).success).toBe(false);
    expect(() =>
      new PythonTarget().compile(ce.box(json), { fallback: false })
    ).toThrow(
      /Could not compile `Assign`: the value assigned to "t" lowers to a statement sequence on target 'python'/
    );
    expect(() =>
      new PythonTarget().compileFunction(ce.box(json), 'f', ['x'])
    ).toThrow(/the value assigned to "t" lowers to a statement sequence/);
  });

  test.each(['glsl'] as const)('%s declines', (to) => {
    expect(() => compile(engine().box(json), { to, fallback: false })).toThrow(
      /a block with a statement other than a declaration with a value is an operand here/
    );
  });
});

describe('an assignment whose value is another assignment', () => {
  // An `Assign` as the value of another `Assign` is the static error
  // `assignment-in-operand`, so every target declines. Write the chain as two
  // statements.
  const json: MathJsonExpression = [
    'Block',
    ['Assign', 's', 'x'],
    ['Assign', 't', ['Assign', 'u', 's']],
    ['Add', 't', 1],
  ];

  test('the expression is invalid', () => {
    const expr = engine().box(json);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain('assignment-in-operand');
  });

  test.each(['javascript', 'python', 'glsl'] as const)(
    '%s declines',
    (to) => {
      // The GLSL fragment refuses the `Error` head before any code is written.
      expect(() =>
        compile(engine().box(json), { to, fallback: false })
      ).toThrow(to === 'glsl' ? /outside the GLSL fragment/ : /invalid expression/);
    }
  );

});

describe('a block whose last statement is a declaration', () => {
  // The value of such a block is `Nothing`, which has no compiled form.
  const shapes: MathJsonExpression[] = [
    ['Block', ['Assign', 's', 'x'], ['Declare', 't', "'real'", ['Add', 's', 1]]],
    [
      'Block',
      ['Assign', 's', 'x'],
      ['Declare', 't', "'unknown'", ['Add', 's', 1]],
    ],
    ['Block', ['Assign', 's', 'x'], ['Block', ['Declare', 't', "'real'", 1]]],
  ];

  test.each(shapes.map((s) => [s]))(
    'the interpreter gives Nothing: %j',
    (json) => {
      expect(engine().box(json).evaluate().symbol).toBe('Nothing');
    }
  );

  test.each(shapes.map((s) => [s]))('every target declines: %j', (json) => {
    for (const to of ['javascript', 'python', 'glsl', 'interval-js'] as const) {
      const r = compile(engine().box(json), { to });
      expect(r.success).toBe(false);
    }
    expect(() =>
      new PythonTarget().compile(engine().box(json), { fallback: false })
    ).toThrow(/an assignment or a declaration is a statement, and its value/);
  });

  test('a declaration with no value is a static error', () => {
    // `Declare(t)` and `Declare(t, 'real')` have no value: the static error
    // `declaration-without-value`.
    for (const json of [
      ['Block', ['Assign', 's', 'x'], ['Declare', 't', "'real'"]],
      ['Block', ['Assign', 's', 'x'], ['Declare', 't']],
    ] as MathJsonExpression[]) {
      const expr = engine().box(json);
      expect(expr.isValid).toBe(false);
      expect(() => compile(expr, { fallback: false })).toThrow(
        /invalid expression/
      );
    }
  });
});

describe('a nested block whose last statement is an assignment', () => {
  // The value of the nested block, and of the whole block, is `Nothing`,
  // which has no compiled form.
  const json: MathJsonExpression = [
    'Block',
    ['Assign', 's', 'x'],
    ['Block', ['Assign', 't', ['Add', 's', 1]]],
  ];

  test('the interpreter gives Nothing', () => {
    expect(engine().box(json).evaluate().symbol).toBe('Nothing');
  });

  test.each(['javascript', 'python', 'glsl'] as const)(
    '%s compile() declines',
    (to) => {
      expect(() =>
        compile(engine().box(json), { to, fallback: false })
      ).toThrow(
        to === 'glsl'
          ? /The block ends with an assignment, so it has no value/
          : /an assignment or a declaration is a statement, and its value/
      );
    }
  );

  test('GLSL compileFunction() declines', () => {
    expect(() =>
      new GLSLTarget().compileFunction(engine().box(json), 'f', 'float', [
        ['x', 'float'],
      ])
    ).toThrow(/The block ends with an assignment, so it has no value/);
  });

  test('a nested block that ends with the name compiles', () => {
    const named: MathJsonExpression = [
      'Block',
      ['Assign', 's', 'x'],
      ['Block', ['Assign', 't', ['Add', 's', 1]], 't'],
    ];
    expect(interpreterAt3(named)).toBe('4');
    expect(compile(engine().box(named)).run!({ x: 3 })).toBe(4);
    for (const to of ['glsl'] as const) {
      const r = compile(engine().box(named), { to });
      expect(r.success).toBe(true);
      expectValidShaderShape(gpuSource(r));
    }
  });

  itPython('the Python code gives the value of the interpreter', () => {
    const named: MathJsonExpression = [
      'Block',
      ['Assign', 's', 'x'],
      ['Block', ['Assign', 't', ['Add', 's', 1]], 't'],
    ];
    const r = compile(engine().box(named), { to: 'python' });
    expect(r.success).toBe(true);
    const source =
      'def f(x):\n' +
      r
        .code!.split('\n')
        .map((l) => `    ${l}`)
        .join('\n');
    expect(runPython(source, 3)).toBe(4);
  });
});

describe('a block local that is read before it has a value', () => {
  // `x` has no declaration, so the first assignment declares it as a local
  // of the block. Its value `x + 1` reads `x` as the value of a `Declare`
  // does: the parse route makes the statement `Declare(x, 'unknown', x +
  // 1)`, and the two routes give the same result. The interpreter leaves
  // the read symbolic, and every target declines.
  const boxRoute: MathJsonExpression = [
    'Block',
    ['Assign', 'x', ['Add', 'x', 1]],
    ['Multiply', 2, 'x'],
  ];

  test('the box route and the parse route stay symbolic', () => {
    expect(new ComputeEngine().box(boxRoute).evaluate().toString()).toBe(
      '2(x + 1)'
    );
    expect(
      new ComputeEngine().parse('x \\coloneq x+1; 2x').evaluate().toString()
    ).toBe('2(x + 1)');
  });

  test.each(['javascript', 'python', 'glsl', 'interval-js'] as const)(
    '%s declines on the box route and on the parse route',
    (to) => {
      const boxed = compile(new ComputeEngine().box(boxRoute), { to });
      expect(boxed.success).toBe(false);
      // The GLSL fragment refuses a read of a local before its declaration.
      expect(boxed.error ?? '').toMatch(
        to === 'glsl'
          ? /The local `x` is read before its declaration/
          : /reads the block local "x" before any statement gives it a value/
      );
      const parsed = compile(
        new ComputeEngine().parse('x \\coloneq x+1; 2x'),
        { to }
      );
      expect(parsed.success).toBe(false);
      expect(parsed.error ?? '').toMatch(
        to === 'glsl'
          ? /The local `x` is read before its declaration/
          : /reads the block local "x" before any statement gives it a value/
      );
    }
  );

  test('a local assigned before it is read compiles', () => {
    const ce = new ComputeEngine();
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 'y', 0],
      ['If', ['Greater', 'x', 0], ['Assign', 'y', 1], ['Assign', 'y', 2]],
      ['Assign', 'y', ['Add', 'y', 'x']],
      'y',
    ];
    const r = compile(ce.box(json));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 3 })).toBe(4);
    expect(compile(ce.box(json), { to: 'glsl' }).success).toBe(true);
  });

  test('a write to an outer variable declines', () => {
    // With `x` declared outside the block, the interpreter writes the outer
    // `x`. A write to a symbol declared in the engine declines.
    const json: MathJsonExpression = boxRoute;
    expect(interpreterAt3(json)).toBe('8');
    expect(() => compile(engine().box(json), { fallback: false })).toThrow(
      /"x" is not a local of the compiled expression/
    );
  });

  test.each([[new GLSLTarget(), 'GLSL']] as const)(
    '%s compileShader() declines an assignment to a uniform',
    (target, lang) => {
      // Emitted `x = x + 1.0;` on a `uniform`, which is read-only.
      expect(() =>
        target.compileShader({
          type: 'fragment',
          uniforms: [{ name: 'x', type: 'float' }],
          outputs: [{ name: 'o', type: 'float' }],
          body: [
            {
              variable: 'o',
              expression: engine().box(boxRoute),
            },
          ],
        } as never)
      ).toThrow(
        new RegExp(
          `it assigns "x", a declared input or uniform of the shader, which is read-only in ${lang}`
        )
      );
    }
  );
});

describe('Python compile() of a selection whose arm is a block with a value', () => {
  // The `if:`/`else:` block it emitted had no `return`, so the code ran to
  // `None` where the interpreter gives 4 at x = 3.
  test.each(
    (
      [
        [
          'If',
          ['Greater', 'x', 0],
          ['Block', ['Declare', 's', "'unknown'", 'x'], ['Add', 's', 1]],
          0,
        ],
      ] as MathJsonExpression[]
    ).map((s) => [s])
  )('declines: %j', (json) => {
    expect(interpreterAt3(json)).toBe('4');
    expect(() =>
      new PythonTarget().compile(engine().box(json), { fallback: false })
    ).toThrow(
      /the body's value statement is a selection whose branches are statements/
    );
    expect(compile(engine().box(json)).run!({ x: 3 })).toBe(4);
  });
});

// `Undefined` is not an absent value since 2026-11-02 (`docs/ERROR-MODEL.md`,
// "`Missing` is a result only"), so `[1, Missing]` is no longer compared
// with `[1, Undefined]`.
describe('interval-js: a written absence in a list', () => {
  test('`[1, Missing]` compiles to an empty interval cell', () => {
    const ce = new ComputeEngine();
    const missing = compile(ce.box(['List', 1, 'Missing']), {
      to: 'interval-js',
    });
    expect(missing.success).toBe(true);
    expect(missing.run!({})).toEqual([
      { kind: 'interval', value: { lo: 1, hi: 1 } },
      { kind: 'empty' },
    ]);
  });
});

describe('Python: the name of a free symbol must be a Python identifier', () => {
  test('a name that is not an identifier declines', () => {
    const ce = new ComputeEngine();
    ce.declare('😀', 'real');
    const expr = ce.box(['Add', { sym: '😀' }, 1] as MathJsonExpression);
    expect(() => new PythonTarget().compile(expr, { fallback: false })).toThrow(
      /"😀" is not a Python identifier and cannot be used as a variable name/
    );
  });

  test('a non-ASCII identifier compiles', () => {
    const ce = new ComputeEngine();
    ce.declare('café', 'real');
    const r = compile(
      ce.box(['Add', { sym: 'café' }, 1] as MathJsonExpression),
      {
        to: 'python',
      }
    );
    expect(r.success).toBe(true);
    expect(r.code).toBe('café + 1');
  });
});
