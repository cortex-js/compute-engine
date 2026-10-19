import { execFileSync } from 'child_process';
import * as fs from 'fs';
import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import type { MathJsonExpression } from '../../src/math-json/types';
import { TEST_PYTHON } from './test-python';

// The compiled code of a statement whose value is not a plain expression:
// an assignment whose value is a block or another assignment, a block whose
// last statement is a declaration or a nested block, and a block local that
// is read before it has a value. Each value is compared with the value of the
// interpreter at `x = 3`.

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

  test('JavaScript gives the value of the interpreter', () => {
    const r = compile(engine().box(json));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 3 })).toBe(7);
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

  test.each(['glsl', 'wgsl'] as const)(
    '%s stores the value of the inner block in a temporary',
    (to) => {
      const r = compile(engine().box(json), { to });
      expect(r.success).toBe(true);
      const code = gpuSource(r);
      expectValidShaderShape(code);
      expect(code).toMatch(/_tv1 = 2\.0 \* u;/);
      expect(code).toMatch(/\bt = _tv1;/);
      expect(code).toMatch(/return t \+ 1\.0;/);
    }
  );
});

describe('an assignment whose value is another assignment', () => {
  const json: MathJsonExpression = [
    'Block',
    ['Assign', 's', 'x'],
    ['Assign', 't', ['Assign', 'u', 's']],
    ['Add', 't', 1],
  ];

  test('the interpreter gives 4 at x = 3', () => {
    expect(interpreterAt3(json)).toBe('4');
  });

  test('JavaScript declares the inner target as a local of the block', () => {
    // The inner write went to the caller's `vars` object (`t = _.u = s`).
    const r = compile(engine().box(json));
    expect(r.success).toBe(true);
    expect(r.code).toContain('let u;');
    expect(r.code).not.toContain('_.u');
    const vars = { x: 3 };
    expect(r.run!(vars)).toBe(4);
    expect(vars).toEqual({ x: 3 });
  });

  test.each(['glsl', 'wgsl'] as const)(
    '%s declares the inner target and assigns it first',
    (to) => {
      // WGSL emitted `t = u = s;` (an assignment is a statement in WGSL), and
      // both languages left `u` undeclared.
      const r = compile(engine().box(json), { to });
      expect(r.success).toBe(true);
      const code = gpuSource(r);
      expectValidShaderShape(code);
      expect(code).toContain(to === 'wgsl' ? 'var u: f32;' : 'float u;');
      expect(code).toMatch(/\bu = s;\n(?:.*\n)*?t = u;/);
    }
  );

  test('WGSL compileFunction() declares the inner target too', () => {
    const code = new WGSLTarget().compileFunction(
      engine().box(json),
      'f',
      'f32',
      [['x', 'f32']]
    );
    expect(code).toContain('var u: f32;');
    expect(code).toContain('u = s;');
    expect(code).toContain('t = u;');
  });

  test.each(['bare', 'block'] as const)(
    'WGSL splits it in a loop body (%s)',
    (form) => {
      const stmt: MathJsonExpression = [
        'Assign',
        't',
        ['Assign', 'u', ['Add', 'u', 'i']],
      ];
      const loopJson: MathJsonExpression = [
        'Block',
        ['Assign', 't', 0],
        ['Assign', 'u', 0],
        [
          'Loop',
          form === 'bare' ? stmt : ['Block', stmt],
          ['Element', 'i', ['Range', 1, 3]],
        ],
        ['Add', 't', 'u'],
      ];
      expect(new ComputeEngine().box(loopJson).evaluate().toString()).toBe(
        '12'
      );
      expect(compile(new ComputeEngine().box(loopJson)).run!({})).toBe(12);
      const r = compile(new ComputeEngine().box(loopJson), { to: 'wgsl' });
      expect(r.success).toBe(true);
      expectValidShaderShape(r.code!);
      expect(r.code).toMatch(/u = f32\(i\) \+ u;\n\s*t = u;/);
    }
  );

  describe.each(['bare', 'block'] as const)(
    'in a loop body, with no enclosing declaration of the inner target (%s)',
    (form) => {
      // No enclosing scope binds `u`, so the interpreter declares it in the
      // scope of the loop. The lone statement (`bare`) used to compile to
      // `u = …; t = u;` on the shader targets with no declaration of `u`.
      const stmt: MathJsonExpression = [
        'Assign',
        't',
        ['Assign', 'u', ['Add', 't', 'i']],
      ];
      const loopJson: MathJsonExpression = [
        'Block',
        ['Assign', 't', 0],
        [
          'Loop',
          form === 'bare' ? stmt : ['Block', stmt],
          ['Element', 'i', ['Range', 1, 3]],
        ],
        't',
      ];

      test('the interpreter gives 6', () => {
        expect(new ComputeEngine().box(loopJson).evaluate().toString()).toBe(
          '6'
        );
      });

      test('JavaScript gives the value of the interpreter', () => {
        const r = compile(new ComputeEngine().box(loopJson));
        expect(r.success).toBe(true);
        expect(r.run!({})).toBe(6);
      });

      test.each(['glsl', 'wgsl'] as const)(
        '%s declares the inner target in the loop body',
        (to) => {
          const r = compile(new ComputeEngine().box(loopJson), { to });
          expect(r.success).toBe(true);
          const code = gpuSource(r);
          expectValidShaderShape(code);
          const iv = to === 'wgsl' ? 'f32(i)' : 'float(i)';
          const decl = to === 'wgsl' ? 'var u: f32;' : 'float u;';
          expect(code).toContain(`{\n  ${decl}\n  u = ${iv} + t;\n  t = u;\n}`);
        }
      );

      itPython('Python gives the value of the interpreter', () => {
        const source = new PythonTarget().compileFunction(
          new ComputeEngine().box(loopJson),
          'f',
          ['x']
        );
        expect(runPython(source, 3)).toBe(6);
      });
    }
  );

  itPython('Python gives the value of the interpreter', () => {
    const source = new PythonTarget().compileFunction(engine().box(json), 'f', [
      'x',
    ]);
    expect(runPython(source, 3)).toBe(4);
  });
});

describe('a block whose last statement is a declaration with no initial value', () => {
  // The value of such a block is `Nothing`, which has no compiled form.
  const shapes: MathJsonExpression[] = [
    ['Block', ['Assign', 's', 'x'], ['Declare', 't', "'real'"]],
    ['Block', ['Assign', 's', 'x'], ['Declare', 't']],
    ['Block', ['Assign', 's', 'x'], ['Block', ['Declare', 't']]],
  ];

  test.each(shapes.map((s) => [s]))(
    'the interpreter gives Nothing: %j',
    (json) => {
      expect(engine().box(json).evaluate().symbol).toBe('Nothing');
    }
  );

  test.each(shapes.map((s) => [s]))('every target declines: %j', (json) => {
    for (const to of [
      'javascript',
      'python',
      'glsl',
      'wgsl',
      'interval-js',
    ] as const) {
      const r = compile(engine().box(json), { to });
      expect(r.success).toBe(false);
    }
    // Python returned the value of the statement before it (`return s`), the
    // GPU targets emitted `return var t: f32;`, JavaScript a syntax error.
    expect(() =>
      new PythonTarget().compile(engine().box(json), { fallback: false })
    ).toThrow(
      /a declaration with no initial value, so the value of the block is `Nothing`/
    );
    expect(() => new WGSLTarget().compile(engine().box(json))).toThrow(
      /a declaration with no initial value/
    );
  });

  test('a declaration with an initial value still gives that value', () => {
    const json: MathJsonExpression = [
      'Block',
      ['Assign', 's', 'x'],
      ['Declare', 't', "'real'", ['Add', 's', 1]],
    ];
    expect(interpreterAt3(json)).toBe('4');
    const r = compile(engine().box(json));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 3 })).toBe(4);
  });
});

describe('a nested block whose last statement is an assignment', () => {
  const json: MathJsonExpression = [
    'Block',
    ['Assign', 's', 'x'],
    ['Block', ['Assign', 't', ['Add', 's', 1]]],
  ];

  test('the interpreter gives 4 at x = 3', () => {
    expect(interpreterAt3(json)).toBe('4');
  });

  test('JavaScript gives the value of the interpreter', () => {
    expect(compile(engine().box(json)).run!({ x: 3 })).toBe(4);
  });

  test.each(['glsl', 'wgsl'] as const)(
    '%s compile() stores the assigned name in a temporary',
    (to) => {
      // Emitted `return float t;` / `return var t: f32;`.
      const r = compile(engine().box(json), { to });
      expect(r.success).toBe(true);
      const code = gpuSource(r);
      expectValidShaderShape(code);
      expect(code).toMatch(/\bt = s \+ 1\.0;\n\s*_tv1 = t;/);
      expect(code).toMatch(/return _tv1;$/);
    }
  );

  test('GLSL compileFunction() stores the assigned name in a temporary', () => {
    const code = new GLSLTarget().compileFunction(
      engine().box(json),
      'f',
      'float',
      [['x', 'float']]
    );
    expectValidShaderShape(code);
    expect(code).toContain('_tv1 = t;');
    expect(code).toContain('return _tv1;');
  });

  test('Python compile() returns the assigned name once', () => {
    // A second `return t` followed the first one.
    const r = compile(engine().box(json), { to: 'python' });
    expect(r.success).toBe(true);
    expect(r.code).toBe('s = x\nt = s + 1\nreturn t');
  });

  itPython('the Python code gives the value of the interpreter', () => {
    const r = compile(engine().box(json), { to: 'python' });
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
  // `x` has no declaration, so the assignment makes it a local of the
  // block, and `x + 1` reads that local before it has a value. The
  // interpreter leaves the read symbolic. JavaScript gave `NaN`, WGSL read
  // the zero a `var` starts with, Python read the input `x`.
  const boxRoute: MathJsonExpression = [
    'Block',
    ['Assign', 'x', ['Add', 'x', 1]],
    ['Multiply', 2, 'x'],
  ];

  test('the interpreter leaves the read symbolic', () => {
    const ce = new ComputeEngine();
    expect(ce.box(boxRoute).evaluate().toString()).toBe('2(x + 1)');
    expect(ce.parse('x \\coloneq x+1; 2x').evaluate().toString()).toBe(
      '2(x + 1)'
    );
  });

  test.each(['javascript', 'python', 'glsl', 'wgsl', 'interval-js'] as const)(
    '%s declines on the box route and on the parse route',
    (to) => {
      const ce = new ComputeEngine();
      for (const expr of [ce.box(boxRoute), ce.parse('x \\coloneq x+1; 2x')]) {
        const r = compile(expr, { to });
        expect(r.success).toBe(false);
        expect(r.error ?? '').toMatch(
          /reads the block local "x" before any statement gives it a value/
        );
      }
    }
  );

  test('a declaration with no value followed by a read declines', () => {
    const ce = new ComputeEngine();
    const r = compile(
      ce.box(['Block', ['Declare', 't'], ['Multiply', 2, 't']]),
      { to: 'wgsl' }
    );
    expect(r.success).toBe(false);
  });

  test('a local assigned before it is read compiles', () => {
    const ce = new ComputeEngine();
    const json: MathJsonExpression = [
      'Block',
      ['Declare', 'y'],
      ['If', ['Greater', 'x', 0], ['Assign', 'y', 1], ['Assign', 'y', 2]],
      ['Assign', 'y', ['Add', 'y', 'x']],
      'y',
    ];
    const r = compile(ce.box(json));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 3 })).toBe(4);
    expect(compile(ce.box(json), { to: 'glsl' }).success).toBe(true);
    // WGSL has no expression form for the `If` whose branches assign: it
    // was `select(y = 2.0, y = 1.0, 0.0 < x);`, which no WGSL compiler
    // accepts, behind `success: true`. It now declines.
    expect(compile(ce.box(json), { to: 'wgsl' }).success).toBe(false);
  });

  test('an outer variable is still the input', () => {
    // With `x` declared outside the block, the assignment writes the outer
    // `x`, as the interpreter does.
    const json: MathJsonExpression = boxRoute;
    expect(interpreterAt3(json)).toBe('8');
    const r = compile(engine().box(json));
    expect(r.success).toBe(true);
    expect(r.run!({ x: 3 })).toBe(8);
  });

  test.each([
    [new GLSLTarget(), 'GLSL'],
    [new WGSLTarget(), 'WGSL'],
  ] as const)(
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
              variable: lang === 'WGSL' ? 'output.o' : 'o',
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
          ['Block', ['Assign', 's', 'x'], ['Add', 's', 1]],
          0,
        ],
        [
          'If',
          ['Greater', 'x', 0],
          ['Block', ['Assign', 's', 'x'], ['Assign', 't', ['Add', 's', 1]]],
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

describe('interval-js: a written absence in a list', () => {
  test('`[1, Missing]` compiles as `[1, Undefined]` does', () => {
    const ce = new ComputeEngine();
    const missing = compile(ce.box(['List', 1, 'Missing']), {
      to: 'interval-js',
    });
    const undef = compile(ce.box(['List', 1, 'Undefined']), {
      to: 'interval-js',
    });
    expect(undef.success).toBe(true);
    expect(missing.success).toBe(true);
    expect(missing.code).toBe(undef.code);
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
