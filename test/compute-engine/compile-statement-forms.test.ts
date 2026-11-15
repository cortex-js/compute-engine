/**
 * A compiled form that needs a statement where the expression form has none.
 *
 * GLSL. A selection (`If`, `Which`) whose branch assigns a variable keeps
 * its ternary, because an assignment is an expression in GLSL. An else-less
 * `If` has no ternary form: where it is a STATEMENT (its value is
 * discarded), it is an `if (…) { … }` statement.
 *
 * There is no shader validator in this repository: the tests check the emitted
 * source, and run the scalar programs after a small translation to
 * JavaScript.
 */
import { ComputeEngine, compile } from '../../src/compute-engine';

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
    for (const to of ['javascript', 'glsl'] as const)
      for (const src of [operand, argument]) {
        const ce = new ComputeEngine();
        expect(ce.box(src).isValid).toBe(false);
        expect(() => compile(ce.box(src), { to, fallback: false })).toThrow(
          to === 'glsl' ? /outside the GLSL fragment/ : /invalid expression/
        );
      }
  });
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
