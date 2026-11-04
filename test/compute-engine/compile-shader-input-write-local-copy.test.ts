/**
 * A shader body that assigns an input declines.
 *
 * When an engine scope binds `u` (`ce.declare('u', 'real')`), the body
 * `u ≔ u + 1` writes a symbol of the engine. On GLSL and WGSL the input is a
 * uniform, which is read-only. Compiled code writes only the locals that it
 * declares, so the compilation declines: the host can return the value and
 * assign it, or the body can declare a local with a value and read the local.
 *
 * There is no GLSL or WGSL validator in this repository, so the tests check
 * the emitted source, and they run the scalar programs after a small
 * translation to JavaScript.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';
import { WGSLTarget } from '../../src/compute-engine/compilation/wgsl-target';

const range = ['Element', 'i', ['Range', 1, 3]];

/** [name, MathJSON]. Each one assigns `u`. */
const PROGRAMS: [string, any][] = [
  [
    'u ≔ u + 1, then a read',
    ['Block', ['Assign', 'u', ['Add', 'u', 1]], ['Multiply', 'u', 2]],
  ],
  [
    'an accumulation in a loop',
    ['Block', ['Loop', ['Assign', 'u', ['Add', 'u', 'i']], range], 'u'],
  ],
];

const DECLINE = /"u" is not a local of the compiled expression/;

function compiled(src: any, to: 'glsl' | 'wgsl', options: any = {}): any {
  const ce = new ComputeEngine();
  ce.declare('x', 'real | signed_infinity | nan');
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

/** The interpreter's value of `src` with `x` given. */
function interpretedAt(src: any, x: number): number {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.assign('x', x);
  return ce.box(src).evaluate().re;
}

for (const to of ['glsl', 'wgsl'] as const) {
  describe(`${to.toUpperCase()}: AN INPUT THAT THE BODY ASSIGNS`, () => {
    // A write to a symbol declared in the engine declines.
    for (const [name, src] of PROGRAMS)
      test(name, () => {
        expect(() => compiled(src, to)).toThrow(DECLINE);
      });

    test('compileFunction() declines too', () => {
      const ce = new ComputeEngine();
      ce.declare('u', 'real');
      const body = ce.box([
        'Block',
        ['Assign', 'u', ['Add', 'u', 'x']],
        ['Multiply', 2, 'u'],
      ]);
      expect(() =>
        to === 'glsl'
          ? new GLSLTarget().compileFunction(body, 'f', 'float', [
              ['x', 'float'],
            ])
          : new WGSLTarget().compileFunction(body, 'f', 'f32', [['x', 'f32']])
      ).toThrow(DECLINE);
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

describe('A SELECTION WHOSE BRANCHES ASSIGN', () => {
  // WGSL lowers `If`/`Which` to `select(…)`, a function call, and a WGSL
  // assignment is a statement: `If(x > 0, t ≔ 1, t ≔ 2)` gave
  // `select(t = 2.0, t = 1.0, 0.0 < x);`, which no WGSL compiler accepts.
  // In statement position (a statement of a block, a loop body) the
  // selection is now an `if` statement on WGSL. In a value position (here,
  // the whole body) WGSL fails closed. GLSL keeps its ternary, which is valid
  // there.
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
    if (src[0] === 'Block')
      test(`WGSL writes an if statement: ${name}`, () => {
        const c = compiled(src, 'wgsl');
        expect(c.success).toBe(true);
        expect(c.code).not.toContain('select(');
        expect(c.code).toMatch(/^\s*if \(.*\) \{$/m);
        // The free `x` of the first program is a host input: the JavaScript
        // translation reads it as a parameter.
        for (const x of [-1, 1])
          // eslint-disable-next-line no-new-func
          expect(new Function('x', shaderToJS(c.code))(x)).toBe(
            interpretedAt(src, x)
          );
      });
    else
      test(`WGSL fails closed: ${name}`, () => {
        expect(() => compiled(src, 'wgsl')).toThrow(
          /a branch assigns a variable, and the WGSL selection/
        );
        // The fallback runs the interpreter.
        expect(compiled(src, 'wgsl', { fallback: true }).success).toBe(false);
      });
    if (src[0] === 'Block')
      test(`GLSL keeps the ternary: ${name}`, () => {
        expect(compiled(src, 'glsl').code).toMatch(/\? \(\w+ = 1\.0\) :/);
      });
    else
      test(`GLSL declines: ${name}`, () => {
        // A write to a symbol declared in the engine declines.
        expect(() => compiled(src, 'glsl')).toThrow(DECLINE);
      });
  }

  test('a selection of values is unchanged', () => {
    expect(compiled(['If', ['Greater', 'x', 0], 1, 2], 'wgsl').code).toBe(
      'select(2.0, 1.0, 0.0 < x)'
    );
  });
});
