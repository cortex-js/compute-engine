/**
 * A shader body that assigns an input declines.
 *
 * When an engine scope binds `u` (`ce.declare('u', 'real')`), the body
 * `u ≔ u + 1` writes a symbol of the engine. On GLSL the input is a
 * uniform, which is read-only. Compiled code writes only the locals that it
 * declares, so the compilation declines: the host can return the value and
 * assign it, or the body can declare a local with a value and read the local.
 *
 * There is no GLSL validator in this repository, so the tests check the
 * emitted source.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';
import { GLSLTarget } from '../../src/compute-engine/compilation/glsl-target';

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

const DECLINE = /`Assign` writes `u`, which is not a local of the function/;

function compiled(src: any, to: 'glsl', options: any = {}): any {
  const ce = new ComputeEngine();
  ce.declare('x', 'real | signed_infinity | nan');
  ce.declare('u', 'real');
  return compile(ce.box(src), { to, fallback: false, ...options }) as any;
}

for (const to of ['glsl'] as const) {
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
        new GLSLTarget().compileFunction(body, 'f', 'float', [['x', 'float']])
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
  // GLSL lowers `If`/`Which` to a ternary, and an assignment is an
  // expression in GLSL, so a selection whose branches assign a block local
  // keeps its ternary. A branch that writes an input declines.
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
      test(`GLSL keeps the ternary: ${name}`, () => {
        expect(compiled(src, 'glsl').code).toMatch(/\? \(\w+ = 1\.0\) :/);
      });
    else
      test(`GLSL declines: ${name}`, () => {
        // A write to a symbol declared in the engine declines.
        expect(() => compiled(src, 'glsl')).toThrow(DECLINE);
      });
  }
});
