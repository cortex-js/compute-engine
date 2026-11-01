/**
 * A `Loop` whose value is used declines on every target.
 *
 * The value of a loop is the value of the `Break` that ends it, or `Nothing`
 * when it ends at the end of its indexing sets or with a `Break` with no
 * value. `Nothing` is the erasure marker, which has no compiled
 * representation, and the compiled loop does not carry the value of a
 * `Break`. Before this check, the JavaScript code of
 * `Loop(k + x, Element(k, 1..3))` gave `undefined` where the interpreter
 * gives `Nothing`, and the code of `Loop(If(k > x, Break(10k)),
 * Element(k, 1..5))` gave `undefined` where the interpreter gives `30` for
 * `x = 2`. A loop that is a statement (a statement of a `Block` that is not
 * its last one, or the body of a loop) still compiles. A loop with an
 * indexing set and a `Return` declines also when it is the last statement
 * of its function: when no `Return` runs, it gives `Nothing`. Only a loop
 * with no indexing set and no `Break` of its own compiles where its value is
 * used.
 *
 * The check is `unsettledShapeIn()` in `compile-admission.ts`, reason
 * `'loop-value'`, with the diagnostic code `'unsettled-shape'`.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const ce = new ComputeEngine();
ce.declare('x', 'real');
ce.declare('y', 'real');

const TARGETS = ['javascript', 'interval-js', 'python', 'glsl', 'wgsl'];
const NOTHING = /evaluates to `Nothing`, the erasure marker/;

const range = (a: number, b: number) => ['Range', a, b];

/** The result of the compilation, or the message of its decline: with no
 * interpreter fallback, a decline throws. */
function compileTo(json: unknown, to: string) {
  try {
    return compile(ce.box(json as any), { to: to as any, fallback: false });
  } catch (e) {
    return { success: false, error: (e as Error).message } as ReturnType<
      typeof compile
    >;
  }
}

describe('A Loop whose value is used declines', () => {
  // [label, program, targets where the decline of the loop is the reason]
  const cases: Array<[string, unknown, string[]]> = [
    [
      'a loop that is the whole expression',
      ['Loop', ['Add', 'k', 'x'], ['Element', 'k', range(1, 3)]],
      ['javascript', 'python', 'glsl', 'wgsl'],
    ],
    [
      'a loop whose body is a destructuring declaration',
      [
        'Loop',
        ['Declare', ['Tuple', 'a', 'b'], "'unknown'", ['Tuple', 'k', 2]],
        ['Element', 'k', range(1, 3)],
      ],
      ['javascript'],
    ],
    [
      'a loop that is the last statement of a block',
      [
        'Block',
        ['Assign', 's', 'x'],
        ['Loop', ['Assign', 's', ['Add', 's', 'k']], ['Element', 'k', range(1, 3)]],
      ],
      ['javascript', 'python'],
    ],
    [
      'a loop with a Break that carries a value',
      [
        'Loop',
        ['If', ['Greater', 'k', 'x'], ['Break', ['Multiply', 10, 'k']]],
        ['Element', 'k', range(1, 5)],
      ],
      ['javascript', 'python'],
    ],
    [
      'a loop with a Break with no value and no indexing set',
      [
        'Block',
        ['Assign', 's', 'x'],
        [
          'Loop',
          [
            'Block',
            ['If', ['Greater', 's', 5], ['Break']],
            ['Assign', 's', ['Add', 's', 1]],
          ],
        ],
      ],
      ['javascript', 'python'],
    ],
    [
      'a loop that is the body of a function literal',
      [
        'Block',
        [
          'Assign',
          'f',
          [
            'Function',
            ['Block', ['Loop', ['Add', 'y', 'k'], ['Element', 'k', range(1, 3)]]],
            'y',
          ],
        ],
        ['f', 'x'],
      ],
      ['javascript'],
    ],
  ];

  test.each(cases)('%s', (_label, json, reasonTargets) => {
    // The interpreter gives `Nothing` for each program at x = 7.
    expect(
      ce
        .box(json as any)
        .subs({ x: 7 })
        .evaluate().json
    ).toBe('Nothing');
    for (const to of TARGETS) {
      const r = compileTo(json, to);
      expect([to, r.success]).toEqual([to, false]);
      if (reasonTargets.includes(to)) expect(r.error).toMatch(NOTHING);
    }
  });

  test('the value of a Break is not carried by the compiled loop', () => {
    const json = [
      'Loop',
      ['If', ['Greater', 'k', 'x'], ['Break', ['Multiply', 10, 'k']]],
      ['Element', 'k', range(1, 5)],
    ];
    expect(ce.box(json).subs({ x: 2 }).evaluate().re).toBe(30);
    const r = compileTo(json, 'javascript');
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/does not carry the value of a `Break`/);
  });
});

describe('A Loop that is a statement compiles', () => {
  const json = [
    'Block',
    ['Assign', 's', 0],
    ['Loop', ['Assign', 's', ['Add', 's', 'k']], ['Element', 'k', range(1, 3)]],
    ['Add', 's', 'x'],
  ];

  test.each(TARGETS)('%s', (to) => {
    const r = compileTo(json, to);
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/for /);
    if (to === 'javascript') expect(r.run!({ x: 2 })).toBe(8);
    if (to === 'interval-js')
      expect(r.run!({ x: 2 })).toEqual({
        kind: 'interval',
        value: { lo: 8, hi: 8 },
      });
    if (to === 'python') expect(r.code).toMatch(/^return s \+ x$/m);
  });

  test('a loop in the body of a loop', () => {
    const nested = [
      'Block',
      ['Assign', 's', 0],
      [
        'Loop',
        ['Loop', ['Assign', 's', ['Add', 's', 'k']], ['Element', 'k', range(1, 3)]],
        ['Element', 'j', range(1, 2)],
      ],
      ['Add', 's', 'x'],
    ];
    for (const to of TARGETS)
      expect([to, compileTo(nested, to).success]).toEqual([to, true]);
    expect(compileTo(nested, 'javascript').run!({ x: 1 })).toBe(13);
  });
});

describe('A Loop with a Return and a Break', () => {
  // A loop with no indexing set and a `Return` compiles only when it has
  // no `Break` of its own: a `Break` ends the loop with its value, or with
  // `Nothing`. A loop with an indexing set declines in all cases.
  const tailLoop = (brk: unknown) => [
    'Apply',
    [
      'Function',
      [
        'Loop',
        [
          'Block',
          ['If', ['Greater', 'k', 'x'], ['Return', 1]],
          ['If', ['Greater', 'k', 'y'], brk],
        ],
        ['Element', 'k', range(1, 5)],
      ],
      'p',
    ],
    0,
  ];
  const cases: Array<[string, unknown, { x: number; y?: number }, string]> = [
    [
      'a loop with no indexing set',
      ['Loop', ['If', ['Greater', 'x', 0], ['Return', 1], ['Break', 2]]],
      { x: -1 },
      '2',
    ],
    ['a tail loop with a Break(v)', tailLoop(['Break', 5]), { x: 3, y: 1 }, '5'],
    [
      'a tail loop with a Break()',
      tailLoop(['Break']),
      { x: 3, y: 1 },
      'Nothing',
    ],
  ];
  test.each(cases)('%s declines', (_label, json, at, value) => {
    expect(
      JSON.stringify(
        ce
          .box(json as any)
          .subs(at)
          .evaluate().json
      )
    ).toBe(JSON.stringify(value === 'Nothing' ? value : Number(value)));
    for (const to of ['javascript', 'interval-js']) {
      const r = compileTo(json, to);
      expect([to, r.success]).toEqual([to, false]);
      expect(r.error).toMatch(NOTHING);
    }
  });
});

describe('The diagnostic of the decline', () => {
  test('has the code unsettled-shape and lists the loop', () => {
    const loop = ce.box([
      'Loop',
      ['Add', 'k', 'x'],
      ['Element', 'k', range(1, 3)],
    ]);
    const r = compile(loop);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('unsettled-shape');
    expect(r.diagnostic?.kind).toBe('capability');
    expect(r.error).toMatch(/^Could not compile "Loop\(/);
    expect(r.unsupported).toContain(loop.toString());
  });
});

describe('A Loop in a case of a Match', () => {
  test('declines when the value of the Match is used', () => {
    const json = [
      'Match',
      'x',
      ['MatchCase', 1, ['Loop', 'k', ['Element', 'k', range(1, 3)]]],
      ['MatchCase', '_', 0],
    ];
    expect(ce.box(json as any).subs({ x: 1 }).evaluate().json).toBe(
      'Nothing'
    );
    for (const to of ['javascript', 'glsl']) {
      const r = compileTo(json, to);
      expect([to, r.success]).toEqual([to, false]);
      expect(r.error).toMatch(NOTHING);
    }
  });
});

describe('A used Loop with a Return that is not in tail position', () => {
  const loop = [
    'Loop',
    ['If', ['Greater', 'k', 'x'], ['Return', 1]],
    ['Element', 'k', range(1, 5)],
  ];
  // The check of a `Return` in a loop with code after it
  // (`returnInLoopIn()`) does not run on Python: the check of the value of
  // the loop declines there.
  test.each([
    ['the value of an Assign', ['Block', ['Assign', 'z', loop], ['Add', 'z', 1]]],
    ['the value of a Declare', ['Block', ['Declare', 'z', "'real'", loop], 'z']],
    ['an operand', ['Add', loop, 1]],
  ])('%s declines on Python and JavaScript', (_label, json) => {
    for (const to of ['python', 'javascript'])
      expect([to, compileTo(json, to).success]).toEqual([to, false]);
  });

  test('a loop in a statement branch compiles on Python', () => {
    const json = [
      'Block',
      ['Assign', 'z', 0],
      ['If', ['Greater', 'x', 0], loop, ['Assign', 'z', 1]],
      'z',
    ];
    const r = compileTo(json, 'python');
    expect(r.success).toBe(true);
    expect(r.code).toMatch(/return 1/);
  });
});

describe('A tail loop with an indexing set and a Return declines', () => {
  // The loop is the last statement of its function, and a `Return` in it
  // gives the value of the function. When no `Return` runs, the loop ends
  // at the end of its indexing set and the interpreter gives `Nothing`,
  // which has no compiled representation: the compiled function gave
  // `undefined` (JavaScript) or `None` (Python). The loop declines on every
  // target, and the fallback gives the value of the interpreter.
  const tailLoop = (body: unknown, n: number, param: string) => [
    'Function',
    ['Loop', body, ['Element', 'k', range(1, n)]],
    param,
  ];
  const search = [
    'Apply',
    tailLoop(['If', ['Greater', 'k', 'p'], ['Return', 'k']], 5, 'p'),
    'x',
  ];

  test('a search loop that finds no value gives Nothing', () => {
    expect(ce.box(search as any).subs({ x: 9 }).evaluate().json).toBe(
      'Nothing'
    );
    expect(ce.box(search as any).subs({ x: 2 }).evaluate().re).toBe(3);
    for (const to of TARGETS)
      expect([to, compileTo(search, to).success]).toEqual([to, false]);
    expect(compileTo(search, 'javascript').error).toMatch(NOTHING);
    const r = compile(ce.box(search as any));
    expect(r.success).toBe(false);
    expect(r.run!({ x: 2 })).toBe(3);
  });

  test('a search loop in a statement position compiles', () => {
    // The form that `docs/COMPILATION-MODEL.md` gives to the host: the loop
    // stores the value it finds in a local, and the block ends with the
    // local. When no value is found, the block gives the initial value of
    // the local, as the interpreter does.
    const json = [
      'Block',
      ['Assign', 'r', 0],
      [
        'Loop',
        ['If', ['Greater', 'k', 'x'], ['Block', ['Assign', 'r', 'k'], ['Break']]],
        ['Element', 'k', range(1, 5)],
      ],
      'r',
    ];
    for (const [x, value] of [
      [2, 3],
      [9, 0],
    ])
      expect(ce.box(json as any).subs({ x }).evaluate().re).toBe(value);
    for (const to of ['javascript', 'interval-js', 'python'])
      expect([to, compileTo(json, to).success]).toEqual([to, true]);
    const r = compileTo(json, 'javascript');
    expect(r.run!({ x: 2 })).toBe(3);
    expect(r.run!({ x: 9 })).toBe(0);
  });

  // [label, program, value at x = 4]
  const cases: Array<[string, unknown, number]> = [
    [
      'the body of a function literal in a Block',
      [
        'Apply',
        [
          'Function',
          [
            'Block',
            [
              'Loop',
              ['If', ['Greater', 'k', 'p'], ['Return', ['Multiply', 10, 'k']]],
              ['Element', 'k', range(1, 5)],
            ],
          ],
          'p',
        ],
        'x',
      ],
      50,
    ],
    [
      'in a function literal applied in a case of a Match',
      [
        'Match',
        'x',
        [
          'MatchCase',
          '_',
          [
            'Apply',
            tailLoop(['If', ['Greater', 'k', 2], ['Return', 'k']], 5, 'y'),
            'x',
          ],
        ],
      ],
      3,
    ],
    [
      'with a parameter, in a case of a Match',
      [
        'Match',
        'x',
        [
          'MatchCase',
          '_',
          ['Apply', tailLoop(['Return', ['Add', 'p', 1]], 3, 'p'), 'x'],
        ],
      ],
      5,
    ],
  ];
  test.each(cases)('%s', (_label, json, value) => {
    expect(ce.box(json as any).subs({ x: 4 }).evaluate().re).toBe(value);
    for (const to of TARGETS)
      expect([to, compileTo(json, to).success]).toEqual([to, false]);
    expect(compileTo(json, 'javascript').error).toMatch(NOTHING);
    const r = compile(ce.box(json as any));
    expect(r.success).toBe(false);
    expect(r.run!({ x: 4 })).toBe(value);
  });

  test('a function literal that is the value of a case of a Match', () => {
    const json = [
      'Match',
      'x',
      [
        'MatchCase',
        '_',
        tailLoop(['If', ['Greater', 'k', 2], ['Return', 'k']], 5, 'y'),
      ],
    ];
    for (const to of TARGETS)
      expect([to, compileTo(json, to).success]).toEqual([to, false]);
    expect(compileTo(json, 'javascript').error).toMatch(NOTHING);
  });
});

describe('A tail loop with no indexing set and a Return compiles', () => {
  // A loop with no indexing set ends only through a `Return` (or never
  // ends), so its value is the value of the `Return`.
  // [label, program, value at x = 4]
  const cases: Array<[string, unknown, number]> = [
    [
      'the body of a function literal',
      ['Apply', ['Function', ['Loop', ['Return', ['Add', 'p', 1]]], 'p'], 'x'],
      5,
    ],
    [
      'in a function literal applied in a case of a Match',
      [
        'Match',
        'x',
        [
          'MatchCase',
          '_',
          [
            'Apply',
            ['Function', ['Loop', ['Return', ['Add', 'p', 1]]], 'p'],
            'x',
          ],
        ],
      ],
      5,
    ],
    [
      'with a Break in a branch that the code drops',
      [
        'Apply',
        [
          'Function',
          [
            'Loop',
            [
              'Block',
              ['If', 'False', ['Break', 2], 0],
              ['Return', ['Add', 'p', 1]],
            ],
          ],
          'p',
        ],
        'x',
      ],
      5,
    ],
  ];
  test.each(cases)('%s', (_label, json, value) => {
    expect(ce.box(json as any).subs({ x: 4 }).evaluate().re).toBe(value);
    const r = compileTo(json, 'javascript');
    expect(r.success).toBe(true);
    expect(r.run!({ x: 4 })).toBe(value);
  });
});
