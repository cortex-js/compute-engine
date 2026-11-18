/**
 * `Break` and `Continue` on the shader targets.
 *
 * A jump is a statement in GLSL, so it compiles only where it is a
 * statement of a `Loop` body, alone or as the branch of a selection with one
 * clause. Everywhere else it declines: a ternary cannot hold it,
 * and a `break` outside a loop is an error that only the driver reports, after
 * the compilation has reported success. `CompileTarget.shaderLoopJumps` holds
 * the nodes that are admitted.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const SHADERS = ['glsl'] as const;

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('p', 'real');
  ce.declare('q', 'real');
  return ce;
}

/** `Block(let a ≔ 0; let n ≔ 0; Loop(Block(<first>; a ≔ a + p; n ≔ n + 1), k ∈ 1..8); n)` */
function counter(ce: ComputeEngine, first: unknown): Expression {
  return ce.box([
    'Block',
    ['Declare', 'a', "'unknown'", 0],
    ['Declare', 'n', "'unknown'", 0],
    [
      'Loop',
      [
        'Block',
        first,
        ['Assign', 'a', ['Add', 'a', 'p']],
        ['Assign', 'n', ['Add', 'n', 1]],
      ],
      ['Element', 'k', ['Range', 1, 8]],
    ],
    'n',
  ] as any);
}

const ESCAPED = ['Greater', 'a', 4];

describe('the values of a loop that stops early', () => {
  // A shader cannot run in this test, so the JavaScript target and the
  // interpreter give the value of the program, and the shader text above shows
  // that the shader has the same control flow.
  test.each([
    [1, 5],
    [0.5, 8],
    [3, 2],
  ])('at p = %d the loop runs %d passes', (p, passes) => {
    const ce = engine();
    const expr = counter(ce, ['If', ESCAPED, ['Break']]);
    const js = compile(expr, { to: 'javascript', fallback: false });
    expect(js.run!({ p })).toBe(passes);
    ce.assign('p', p);
    expect(expr.N().re).toBe(passes);
  });

});

describe('a jump declines everywhere else', () => {
  const gt = ['Greater', 'x', 1];
  const inLoop = (body: unknown) => [
    'Block',
    ['Declare', 's', "'unknown'", 0],
    ['Loop', body, ['Element', 'k', ['Range', 1, 3]]],
    's',
  ];

  test.each([
    ['a bare Break with no loop', ['Block', ['Break'], 1]],
    ['a bare Continue with no loop', ['Block', ['Continue'], 1]],
    ['If(c, Break()) with no loop', ['Block', ['If', gt, ['Break']], 1]],
    [
      'If(c, Break(), Nothing) with no loop',
      ['Block', ['If', gt, ['Break'], 'Nothing'], 1],
    ],
    [
      'a Break as a value',
      inLoop(['Assign', 's', ['If', gt, ['Break'], 1]]),
    ],
    [
      'a Break in a Block that is a value',
      inLoop([
        'Assign',
        's',
        ['Add', 's', ['Block', ['If', gt, ['Break']], 'k']],
      ]),
    ],
    [
      'a Break in a Sum body',
      inLoop([
        'Assign',
        's',
        ['Sum', ['If', ['Greater', 'j', 1], ['Break'], 'j'], ['Limits', 'j', 1, 3]],
      ]),
    ],
    ['a Return in a branch', inLoop(['If', gt, ['Return', 1]])],
    // The value reads an input: with no input, the block folds to a number.
    ['a Break with a value', inLoop(['Break', 'x'])],
    ['a Break with a value in a branch', inLoop(['If', gt, ['Break', 5]])],
    [
      'a Break in a Match case',
      inLoop([
        'Match',
        'k',
        ['MatchCase', 2, ['Break']],
        ['MatchCase', '_', ['Assign', 's', 'k']],
      ]),
    ],
  ])('%s', (_name, json) => {
    const ce = engine();
    for (const to of SHADERS)
      expect(() =>
        compile(ce.box(json as any), { to, fallback: false })
      ).toThrow(/Could not compile/);
  });

  test('a Break in the body of a user function called in a Loop', () => {
    const ce = engine();
    ce.assign(
      'f',
      ce.box([
        'Function',
        ['Block', ['If', ['Greater', 'u', 1], ['Break']], 'u'],
        'u',
      ] as any)
    );
    const expr = ce.box([
      'Block',
      ['Declare', 's', "'unknown'", 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', ['f', 'k']]],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    for (const to of SHADERS)
      expect(() => compile(expr, { to, fallback: false })).toThrow(
        /a Break that is not a statement of a Loop body/
      );
  });
});
