/**
 * The shader targets write a local copy of an input that the body assigns.
 *
 * When an engine scope binds `u` (`ce.declare('u', 'real')`), the body
 * `u ≔ u + 1` writes `u` as an input of the compiled code. On GLSL and WGSL
 * the input is a uniform, which is read-only, and the code was
 * `u = u + 1.0;`, which no driver accepts. A chained assignment that wrote
 * `u` was refused. Now the code declares a local copy of `u` with the value of
 * the uniform (`float _tv1 = u;`, `var _tv1: f32 = u;`), and every read and
 * write of `u` in the body uses the copy, as the JavaScript target writes a
 * copy of the vars object.
 *
 * There is no GLSL or WGSL validator in this repository, so the tests check
 * the emitted source, and they run the scalar programs after a small
 * translation to JavaScript in which the input is a `const`: a write to the
 * input throws.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const range = ['Element', 'i', ['Range', 1, 3]];
const chained = ['Assign', 't', ['Assign', 'u', ['Add', 't', 'i']]];

/** [name, MathJSON]. Each one assigns `u`. */
const PROGRAMS: [string, any][] = [
  [
    'a chained assignment in a loop body',
    ['Block', ['Assign', 't', 0], ['Loop', chained, range], 't'],
  ],
  [
    'a chained assignment in a loop block, read after the loop',
    [
      'Block',
      ['Assign', 't', 0],
      ['Loop', ['Block', chained], range],
      ['Add', 't', 'u'],
    ],
  ],
  ['u ≔ u + 1', ['Assign', 'u', ['Add', 'u', 1]]],
  [
    'u ≔ u + 1, then a read',
    ['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 'u', 2]],
  ],
  [
    'a write before any read',
    ['Block', ['Assign', 'u', 3], ['Multiply', 'u', 2]],
  ],
  [
    'an accumulation in a loop',
    ['Block', ['Loop', ['Assign', 'u', ['Add', 'u', 'i']], range], 'u'],
  ],
  [
    'a chained assignment, then a read',
    ['Block', ['Assign', 't', ['Assign', 'u', 3]], ['Add', 't', 'u']],
  ],
];

/** The interpreter's value with `u = 5`. */
function interpreted(src: any): number {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.assign('u', 5);
  return ce.box(src).evaluate().re;
}

function compiled(src: any, to: 'glsl' | 'wgsl', options: any = {}): any {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  return compile(ce.box(src), { to, fallback: false, ...options }) as any;
}

/**
 * The JavaScript form of the scalar shader body `code`: declarations become
 * `let`, the integer loop index and its conversion to a float are kept as
 * numbers. Enough for the programs of this file, not a general translator.
 */
function shaderToJS(code: string): string {
  return code
    .replace(/^(\s*)(?:float|int|vec2) (\w+)(;| =)/gm, '$1let $2$3')
    .replace(/^(\s*)var (\w+): \w+(;| =)/gm, '$1let $2$3')
    .replace(/for \((?:int|var) (\w+)(?:: i32)? =/g, 'for (let $1 =')
    .replace(/\b(?:float|f32)\(/g, '(');
}

/** Run the body `code` with the input `u` as a `const`. */
function runShader(code: string, u: number): number {
  // eslint-disable-next-line no-new-func
  return new Function('input', `const u = input;\n${shaderToJS(code)}`)(u);
}

/** Whether the code assigns the input `u` (not `==`, not a declaration). */
function writesInput(code: string): boolean {
  return /(^|[^\w.])u\s*=[^=]/m.test(code);
}

for (const to of ['glsl', 'wgsl'] as const) {
  describe(`${to.toUpperCase()}: AN INPUT THAT THE BODY ASSIGNS`, () => {
    for (const [name, src] of PROGRAMS)
      test(name, () => {
        const c = compiled(src, to);
        expect(c.success).toBe(true);
        expect(writesInput(c.code)).toBe(false);
        expect(c.code.split('\n')[0]).toMatch(
          to === 'glsl' ? /^float _tv1( = u)?;$/ : /^var _tv1: f32( = u)?;$/
        );
        expect(c.freeSymbols).toContain('u');
        expect(runShader(c.code, 5)).toBe(interpreted(src));
      });

    test('the root assignment u ≔ u + 1', () => {
      // Before: `u = u + 1.0`, a write to the uniform.
      expect(compiled(['Assign', 'u', ['Add', 'u', 1]], to).code).toBe(
        to === 'glsl'
          ? 'float _tv1 = u;\n_tv1 = _tv1 + 1.0;\nreturn _tv1;'
          : 'var _tv1: f32 = u;\n_tv1 = _tv1 + 1.0;\nreturn _tv1;'
      );
    });

    test('u ≔ u + 1, then a read', () => {
      // Before: `u = u + 1.0;\nreturn 2.0 * u;`.
      expect(
        compiled(
          ['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 2, 'u']],
          to
        ).code
      ).toBe(
        to === 'glsl'
          ? 'float _tv1 = u;\n_tv1 = _tv1 + 1.0;\nreturn 2.0 * _tv1;'
          : 'var _tv1: f32 = u;\n_tv1 = _tv1 + 1.0;\nreturn 2.0 * _tv1;'
      );
    });

    test('a local that is written before any read has no initial value', () => {
      // The body does not read the input, so the host need not give it.
      expect(
        compiled(['Block', ['Assign', 'u', 3], ['Multiply', 'u', 2]], to).code
      ).toBe(
        to === 'glsl'
          ? 'float _tv1;\n_tv1 = 3.0;\nreturn 2.0 * _tv1;'
          : 'var _tv1: f32;\n_tv1 = 3.0;\nreturn 2.0 * _tv1;'
      );
      // A write in a loop does not always run.
      expect(
        compiled(
          ['Block', ['Loop', ['Assign', 'u', 'i'], range], 'u'],
          to
        ).code.split('\n')[0]
      ).toBe(to === 'glsl' ? 'float _tv1 = u;' : 'var _tv1: f32 = u;');
    });

    test('two written inputs', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      ce.declare('w', 'real');
      const c = compile(
        ce.box([
          'Block',
          ['Assign', 'u', ['Add', 'u', 'w']],
          ['Assign', 'w', ['Add', 'w', 1]],
          ['Multiply', 'u', 'w'],
        ]),
        { to, fallback: false }
      ) as any;
      expect(c.code).toBe(
        to === 'glsl'
          ? 'float _tv1 = u;\nfloat _tv2 = w;\n_tv1 = _tv1 + _tv2;\n_tv2 = _tv2 + 1.0;\nreturn _tv1 * _tv2;'
          : 'var _tv1: f32 = u;\nvar _tv2: f32 = w;\n_tv1 = _tv1 + _tv2;\n_tv2 = _tv2 + 1.0;\nreturn _tv1 * _tv2;'
      );
    });

    test('the local has the shader type of the input', () => {
      // The type of the input is read from a read of it, not from the
      // target of the assignment, which has no type of its own: the
      // reported type was `unknown` (lowered as a float) for a complex `u`.
      const ce = new ComputeEngine();
      ce.declare('u', 'complex');
      const c = compile(
        ce.box([
          'Block',
          ['Assign', 'u', ['Add', 'u', 1]],
          ['Multiply', 2, 'u'],
        ]),
        { to, fallback: false }
      ) as any;
      const vec2 = to === 'glsl' ? 'vec2' : 'vec2f';
      expect(c.code.split('\n')[0]).toBe(
        to === 'glsl' ? 'vec2 _tv1 = u;' : 'var _tv1: vec2f = u;'
      );
      expect(c.freeSymbolTypes.u).toEqual({
        type: 'complex',
        lowered: vec2,
        provenance: 'declared',
      });
    });

    test('the local copy has a name that no symbol uses', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const c = compile(
        ce.box(['Block', ['Assign', 'u', ['Add', 'u', '_tv1']], 'u']),
        { to, fallback: false }
      ) as any;
      expect(c.code.split('\n')[0]).toBe(
        to === 'glsl' ? 'float _tv2 = u;' : 'var _tv2: f32 = u;'
      );
      expect(runShader(c.code.replace(/\b_tv1\b/g, '1'), 5)).toBe(6);
    });

    test('an input that `vars` maps starts with the mapped source', () => {
      for (const source of ['u', 'params.u']) {
        const c = compiled(
          ['Block', ['Assign', 'u', ['Add', 'u', 1]], 'u'],
          to,
          { vars: { u: source } }
        );
        expect(c.code).toBe(
          (to === 'glsl'
            ? `float _tv1 = ${source};`
            : `var _tv1: f32 = ${source};`) +
            '\n_tv1 = _tv1 + 1.0;\nreturn _tv1;'
        );
      }
    });

    test('a user function that reads the written input fails closed', () => {
      // The function is declared outside the body, so it cannot read the
      // local copy, and it would read the value of the uniform where the
      // interpreter reads the written value.
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      ce.parse('g(x) := x + u').evaluate();
      const src = ce.box(['Block', ['Assign', 'u', ['Add', 'u', 1]], ['g', 2]]);
      expect(() => compile(src, { to, fallback: false })).toThrow(
        /a user-defined function that the body calls reads "u"/
      );
    });

    test('a user function that does not read the input still compiles', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      ce.parse('g(x) := 2x').evaluate();
      const c = compile(
        ce.box(['Block', ['Assign', 'u', ['Add', 'u', 1]], ['g', 'u']]),
        { to, fallback: false }
      ) as any;
      expect(c.code).toContain('_fn_g(_tv1)');
      expect(writesInput(c.code)).toBe(false);
    });

    test('compileFunction() writes a local copy too', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const body = ce.box([
        'Block',
        ['Assign', 'u', ['Add', 'u', 'x']],
        ['Multiply', 2, 'u'],
      ]);
      const code =
        to === 'glsl'
          ? new GLSLTarget().compileFunction(body, 'f', 'float', [
              ['x', 'float'],
            ])
          : new WGSLTarget().compileFunction(body, 'f', 'f32', [['x', 'f32']]);
      // Before: `u = u + x;` in the function body.
      expect(code).toBe(
        to === 'glsl'
          ? 'float f(float x) {\n  float _tv1 = u;\n  _tv1 = _tv1 + x;\n  return 2.0 * _tv1;\n}'
          : 'fn f(x: f32) -> f32 {\n  var _tv1: f32 = u;\n  _tv1 = _tv1 + x;\n  return 2.0 * _tv1;\n}'
      );
    });

    test('a body that writes no input is unchanged', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      expect(
        (
          compile(ce.box(['Add', 'u', 1]), {
            to,
            fallback: false,
          }) as any
        ).code
      ).toBe('u + 1.0');
      // A block local is not an input.
      const c = compile(
        ce.box([
          'Block',
          ['Assign', 'v', ['Add', 'x', 1]],
          ['Multiply', 2, 'v'],
        ]),
        { to, fallback: false }
      ) as any;
      expect(c.code).not.toContain('_tv1');
    });
  });
}

describe('JAVASCRIPT: THE TYPE OF A WRITTEN INPUT', () => {
  test('is read from a read of the input', () => {
    const ce = new ComputeEngine();
    ce.declare('u', 'complex');
    const c = compile(
      ce.box(['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 2, 'u']]),
      { fallback: false }
    ) as any;
    expect(c.freeSymbolTypes.u.type).toBe('complex');
  });
});

describe('a declared parameter is not taken by a local copy', () => {
  // A parameter that the body does not read was not in the names of the
  // expression, so the local copy of `u` took its name `_tv1`.
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  const body = ce.box(['Block', ['Assign', 'u', ['Add', 'u', 'x']], 'u']);

  test('GLSL', () => {
    const code = new GLSLTarget().compileFunction(body, 'f', 'float', [
      ['x', 'float'],
      ['_tv1', 'float'],
    ]);
    expect(code).toContain('float f(float x, float _tv1)');
    expect(code).not.toMatch(/float _tv1 = u;/);
    expect(code).toMatch(/float (_tv\d+) = u;/);
  });

  test('WGSL', () => {
    const code = new WGSLTarget().compileFunction(body, 'f', 'f32', [
      ['x', 'f32'],
      ['_tv1', 'f32'],
    ]);
    expect(code).not.toMatch(/var _tv1: f32 = u;/);
    expect(code).toMatch(/var (_tv\d+): f32 = u;/);
  });
});

describe('A SELECTION WHOSE BRANCHES ASSIGN', () => {
  // WGSL lowers `If`/`Which` to `select(…)`, a function call, and a WGSL
  // assignment is a statement: `If(x > 0, t ≔ 1, t ≔ 2)` gave
  // `select(t = 2.0, t = 1.0, 0.0 < x);`, which no WGSL compiler accepts.
  // WGSL now fails closed; GLSL keeps its ternary, which is valid there.
  const programs: [string, any][] = [
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
          ['If', ['Greater', 'i', 1], ['Assign', 't', 1], ['Assign', 't', 2]],
          ['Element', 'i', ['Range', 1, 3]],
        ],
        't',
      ],
    ],
    [
      'Which with a written input',
      [
        'Which',
        ['Greater', 'x', 0],
        ['Assign', 'u', 1],
        'True',
        ['Assign', 'u', 2],
      ],
    ],
  ];
  for (const [name, src] of programs) {
    test(`WGSL fails closed: ${name}`, () => {
      expect(() => compiled(src, 'wgsl')).toThrow(
        /a branch assigns a variable, and the WGSL selection/
      );
      // The fallback runs the interpreter.
      expect(compiled(src, 'wgsl', { fallback: true }).success).toBe(false);
    });
    test(`GLSL keeps the ternary: ${name}`, () => {
      expect(compiled(src, 'glsl').code).toMatch(/\? \(\w+ = 1\.0\) :/);
    });
  }

  test('a selection of values is unchanged', () => {
    expect(compiled(['If', ['Greater', 'x', 0], 1, 2], 'wgsl').code).toBe(
      'select(2.0, 1.0, 0.0 < x)'
    );
  });
});
