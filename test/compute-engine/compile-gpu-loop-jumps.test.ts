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

/** `Block(a ≔ 0; n ≔ 0; Loop(Block(<first>; a ≔ a + p; n ≔ n + 1), k ∈ 1..8); n)` */
function counter(ce: ComputeEngine, first: unknown): Expression {
  return ce.box([
    'Block',
    ['Assign', 'a', 0],
    ['Assign', 'n', 0],
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

describe('a jump in a selection with one clause, in a Loop body', () => {
  test.each([
    ['If(c, Break())', ['If', ESCAPED, ['Break']], 'break'],
    ['If(c, Break(), Nothing)', ['If', ESCAPED, ['Break'], 'Nothing'], 'break'],
    ['Which(c, Break())', ['Which', ESCAPED, ['Break']], 'break'],
    ['If(c, Continue())', ['If', ESCAPED, ['Continue']], 'continue'],
  ])('%s is an if statement', (_name, first, jump) => {
    const ce = engine();
    for (const to of SHADERS) {
      const r = compile(counter(ce, first), { to, fallback: false });
      expect(r.success).toBe(true);
      expect(r.code).toContain(`if (4.0 < a) {\n    ${jump};\n  }\n`);
    }
  });

  test('a branch can assign before the jump', () => {
    const ce = engine();
    const first = ['If', ESCAPED, ['Block', ['Assign', 'n', 100], ['Break']]];
    for (const to of SHADERS)
      expect(compile(counter(ce, first), { to, fallback: false }).code).toContain(
        'if (4.0 < a) {\n    n = 100.0;\n    break;\n  }\n'
      );
  });

  test('the selection can be the whole body of the loop', () => {
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Assign', 'a', 0],
      [
        'Loop',
        ['If', ['Greater', 'k', 'x'], ['Break']],
        ['Element', 'k', ['Range', 1, 8]],
      ],
      'a',
    ] as any);
    expect(compile(expr, { to: 'glsl', fallback: false }).code).toContain(
      'if (x < float(k)) {\n    break;\n  }\n'
    );
  });

  test.each([
    ['Block(If(c, Break()))', ['Block', ['If', ESCAPED, ['Break']]]],
    ['Block(Which(c, Break()))', ['Block', ['Which', ESCAPED, ['Break']]]],
    [
      'Block(If(c, Break(), Nothing))',
      ['Block', ['If', ESCAPED, ['Break'], 'Nothing']],
    ],
    ['If(c, Block(Break()))', ['If', ESCAPED, ['Block', ['Break']]]],
  ])('%s: a Block of one statement is the same statement', (_name, first) => {
    const ce = engine();
    for (const to of SHADERS)
      expect(compile(counter(ce, first), { to, fallback: false }).code).toMatch(
        /if \(4\.0 < a\) \{\s+break;\s+\}/
      );
  });

  test('a selection in a Block of one statement in a branch', () => {
    const ce = engine();
    const first = [
      'If',
      ESCAPED,
      ['Block', ['If', ['Greater', 'p', 1], ['Break']]],
    ];
    for (const to of SHADERS)
      expect(
        compile(counter(ce, first), { to, fallback: false }).code
      ).toContain('break;');
  });

  test('a jump in a nested Loop belongs to that loop', () => {
    const ce = engine();
    const inner = [
      'Loop',
      ['Block', ['If', ['Greater', 'j', 'x'], ['Break']], ['Assign', 'a', 'j']],
      ['Element', 'j', ['Range', 1, 3]],
    ];
    const expr = ce.box([
      'Block',
      ['Assign', 'a', 0],
      ['Loop', inner, ['Element', 'k', ['Range', 1, 3]]],
      'a',
    ] as any);
    const r = compile(expr, { to: 'glsl', fallback: false });
    expect(r.code).toContain('if (x < float(j)) {\n      break;\n    }\n');
  });

  test('an If with a Nothing else branch that assigns has no else', () => {
    const ce = engine();
    const first = ['If', ESCAPED, ['Assign', 'n', 100], 'Nothing'];
    for (const to of SHADERS) {
      const { code } = compile(counter(ce, first), { to, fallback: false });
      expect(code).toContain('if (4.0 < a) {\n    n = 100.0;\n  }\n');
      expect(code).not.toContain('else');
    }
  });
});

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

  test.each([
    ['>', ['Greater', 'v', 4], 8, 'if (4.0 < v) {'],
    ['≠', ['NotEqual', 'v', 4], 0, 'if (v != 4.0) {'],
  ])(
    'on a NaN operand, a jump under %s acts as in the interpreter',
    (_name, condition, passes, code) => {
      // A relation with a NaN operand is false, and `≠` is true. A shader
      // comparison gives the same answer, so the `if` needs no extra test.
      const ce = engine();
      ce.declare('v', 'real | nan');
      const expr = counter(ce, ['If', condition, ['Break']]);
      const js = compile(expr, { to: 'javascript', fallback: false });
      expect(js.run!({ p: 1, v: NaN })).toBe(passes);
      expect(compile(expr, { to: 'glsl', fallback: false }).code).toContain(
        code
      );
      ce.assign('p', 1);
      ce.assign('v', NaN);
      expect(expr.N().re).toBe(passes);
    }
  );
});

describe('a jump declines everywhere else', () => {
  const gt = ['Greater', 'x', 1];
  const inLoop = (body: unknown) => [
    'Block',
    ['Assign', 's', 0],
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
    [
      'a Break beside an else branch',
      inLoop(['If', gt, ['Break'], ['Assign', 's', 1]]),
    ],
    [
      'a Break beside a second clause',
      inLoop(['Which', gt, ['Break'], ['Greater', 'x', 0], ['Assign', 's', 1]]),
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
      ['Assign', 's', 0],
      [
        'Loop',
        ['Assign', 's', ['Add', 's', ['f', 'k']]],
        ['Element', 'k', ['Range', 1, 3]],
      ],
      's',
    ] as any);
    for (const to of SHADERS)
      expect(() => compile(expr, { to, fallback: false })).toThrow(
        /Could not compile/
      );
  });
});
