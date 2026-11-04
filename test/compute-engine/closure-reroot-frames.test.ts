/**
 * A closure returned through two or more call frames keeps the frame of the
 * call that created it.
 *
 * When a call ends, `captureClosures` (`function-utils.ts`) rebuilds each
 * closure of the result on the frame of the call. It replaced the whole
 * chain of every closure, also of a closure that an inner call had already
 * captured on its own frame. The closure then read the frame of the outer
 * call, and the parameters and locals of the inner call were lost: with
 * `mk = n ↦ (() ↦ Block(n := n + 1, n))` and `wrap = m ↦ mk(m)`,
 * `wrap(5)()` gave `n + 1`, not `6`. Now a capture replaces only a chain
 * that reaches the body scope of the literal that is applied, or its frame,
 * before it reaches the frame of another call (`rerootKind`). When the
 * frame of another call chains to that body scope (a local function that
 * `DefineFunction` installs), the capture keeps that frame and replaces
 * only the end of the chain (`copyChainToLeaving`), with a snapshot of the
 * locals of a nested block that is in use. And the substitution of
 * the parameters in the result of a call leaves alone a closure that
 * another call captured, also one that a recursive call of the same literal
 * made (`bindingKeyedSubs`).
 * This is lexical scoping: a closure keeps the scope chain where it was
 * created (`docs/SCOPING-MODEL.md`).
 *
 * A second defect showed once the first was fixed: the application memo
 * kept the closure that `wrap(5)` returned, and a second evaluation of
 * `wrap(5)()` used the same closure, thus the same counter, and gave `7`.
 * A result that reads a frame made by the call is now not memoized
 * (`holdsFrameSince`).
 *
 * Each case is evaluated twice on the same engine: the second evaluation
 * must give the same value (no state of the first call leaks into it).
 */
import { ComputeEngine } from '../../src/compute-engine';

type Definitions = [name: string, value: unknown][];

function engine(definitions: Definitions): ComputeEngine {
  const ce = new ComputeEngine();
  for (const [name, value] of definitions)
    ce.assign(name, ce.box(value as any));
  return ce;
}

/** The value of `expr`, evaluated twice with `evaluate()`. */
function twice(definitions: Definitions, expr: unknown): unknown[] {
  const ce = engine(definitions);
  return [
    ce.box(expr as any).evaluate().json,
    ce.box(expr as any).evaluate().json,
  ];
}

/** The value of `expr`, evaluated twice with `evaluateAsync()`. */
async function twiceAsync(
  definitions: Definitions,
  expr: unknown
): Promise<unknown[]> {
  const ce = engine(definitions);
  return [
    (await ce.box(expr as any).evaluateAsync()).json,
    (await ce.box(expr as any).evaluateAsync()).json,
  ];
}

// mk = n ↦ (() ↦ Block(n := n + 1, n))
const counter = [
  'Function',
  ['Function', ['Block', ['Assign', 'n', ['Add', 'n', 1]], 'n']],
  'n',
];

// mk = n ↦ Block(k := 1, x ↦ x + k)
const withLocal = [
  'Function',
  ['Block', ['Assign', 'k', 1], ['Function', ['Add', 'x', 'k'], 'x']],
  'n',
];

// P2 = (y, w) ↦ (x ↦ Block(<body>))
const twoParameters = (body: unknown) => [
  'Function',
  ['Function', ['Block', body], 'x'],
  'y',
  'w',
];

// Block(s := y, y := 2, s + x)
const writesParameter = [
  'Block',
  ['Assign', 's', 'y'],
  ['Assign', 'y', 2],
  ['Add', 's', 'x'],
];

// Block(s := y, If(w = 1, Block(Declare(y), y := 2), 0), s + x): the `y` of
// the branch is a local of the branch.
const declaresInBranch = [
  'Block',
  ['Assign', 's', 'y'],
  [
    'If',
    ['Equal', 'w', 1],
    ['Block', ['Declare', 'y', "'integer'", 2]],
    0,
  ],
  ['Add', 's', 'x'],
];

// h = (g, k) ↦ If(k = 0, <last>, h(x ↦ x + k, k − 1))
const recursivePass = (last: unknown) => [
  'Function',
  [
    'If',
    ['Equal', 'k', 0],
    last,
    ['h', ['Function', ['Add', 'x', 'k'], 'x'], ['Subtract', 'k', 1]],
  ],
  'g',
  'k',
];

const wrap2 = ['Function', ['P2', 'a', 'b'], 'a', 'b'];

const cases: [
  label: string,
  definitions: Definitions,
  expr: unknown,
  expected: unknown,
][] = [
  [
    'counter, called directly: mk(5)()',
    [['mk', counter]],
    ['Apply', ['mk', 5]],
    6,
  ],
  [
    'counter, through a wrapper: wrap(5)()',
    [
      ['mk', counter],
      ['wrap', ['Function', ['mk', 'm'], 'm']],
    ],
    ['Apply', ['wrap', 5]],
    6,
  ],
  [
    'local of the inner call, called directly: mk(5)(2)',
    [['mk', withLocal]],
    ['Apply', ['mk', 5], 2],
    3,
  ],
  [
    'local of the inner call, through a nullary wrapper: w()(2)',
    [
      ['mk', withLocal],
      ['w', ['Function', ['mk', 5]]],
    ],
    ['Apply', ['w'], 2],
    3,
  ],
  [
    'local of the inner call, through a wrapper literal',
    [['mk', withLocal]],
    ['Apply', ['Apply', ['Function', ['Apply', 'mk', 'm'], 'm'], 5], 2],
    3,
  ],
  [
    'written parameter, called directly: P2(q, 1)(5)',
    [['P2', twoParameters(writesParameter)]],
    ['Apply', ['P2', 'q', 1], 5],
    ['Add', 'q', 5],
  ],
  [
    'written parameter, through a wrapper: wrap(q, 1)(5)',
    [
      ['P2', twoParameters(writesParameter)],
      ['wrap', wrap2],
    ],
    ['Apply', ['wrap', 'q', 1], 5],
    ['Add', 'q', 5],
  ],
  [
    'declaration in a branch, called directly',
    [['P2', twoParameters(declaresInBranch)]],
    ['Apply', ['P2', 'q', 1], 5],
    ['Add', 'q', 5],
  ],
  [
    'declaration in a branch, through a wrapper',
    [
      ['P2', twoParameters(declaresInBranch)],
      ['wrap', wrap2],
    ],
    ['Apply', ['wrap', 'q', 1], 5],
    ['Add', 'q', 5],
  ],
  [
    'a closure in a dictionary, through a wrapper',
    [
      [
        'P2',
        [
          'Function',
          [
            'Dictionary',
            [
              'KeyValuePair',
              "'f'",
              ['Function', ['Block', writesParameter], 'x'],
            ],
          ],
          'y',
          'w',
        ],
      ],
      ['wrap', wrap2],
    ],
    ['Apply', ['At', ['wrap', 'q', 1], "'f'"], 5],
    ['Add', 'q', 5],
  ],
  [
    // id = f ↦ f returns a literal of the outer body. The literal reads
    // the parameter `t` of the outer call: (t ↦ id(x ↦ x + t)(1))(10).
    'a literal of the outer body returned by id',
    [['id', ['Function', 'f', 'f']]],
    [
      'Apply',
      [
        'Function',
        ['Apply', ['id', ['Function', ['Add', 'x', 't'], 'x']], 1],
        't',
      ],
      10,
    ],
    11,
  ],
  [
    // The outer call returns what id returned, and the caller applies it.
    'a literal of the outer body returned by id, then by the outer call',
    [
      ['id', ['Function', 'f', 'f']],
      ['out', ['Function', ['id', ['Function', ['Add', 'x', 't'], 'x']], 't']],
    ],
    ['Apply', ['out', 10], 1],
    11,
  ],
  [
    // A closure made in `top` is passed down through `down1` and `down2`
    // (each adds its own closure around it) and returned up again.
    'a closure passed down and returned up through three frames',
    [
      // down2 = (g, c) ↦ (x ↦ g(x) + c)
      [
        'down2',
        [
          'Function',
          ['Function', ['Add', ['Apply', 'g', 'x'], 'c'], 'x'],
          'g',
          'c',
        ],
      ],
      // down1 = (g, b) ↦ down2(x ↦ g(x) + b, 10·b)
      [
        'down1',
        [
          'Function',
          [
            'down2',
            ['Function', ['Add', ['Apply', 'g', 'x'], 'b'], 'x'],
            ['Multiply', 10, 'b'],
          ],
          'g',
          'b',
        ],
      ],
      // top = a ↦ down1(x ↦ x + a, a + 1)
      [
        'top',
        [
          'Function',
          ['down1', ['Function', ['Add', 'x', 'a'], 'x'], ['Add', 'a', 1]],
          'a',
        ],
      ],
    ],
    // top(1)(100) = ((100 + 1) + 2) + 20
    ['Apply', ['top', 1], 100],
    123,
  ],
  [
    // f = n ↦ Block(k := n, DefineFunction(g, b ↦ (x ↦ k + x)), g(0)): the
    // frame of the call of the local function `g` chains to the body of
    // `f`, and the returned closure keeps both frames.
    'a closure returned by a local function that DefineFunction installs',
    [
      [
        'f',
        [
          'Function',
          [
            'Block',
            ['Assign', 'k', 'n'],
            [
              'DefineFunction',
              'g',
              ['Function', ['Function', ['Add', 'k', 'x'], 'x'], 'b'],
            ],
            ['g', 0],
          ],
          'n',
        ],
      ],
    ],
    ['Apply', ['f', 5], 1],
    6,
  ],
  [
    // h = (g, k) ↦ If(k = 0, g, h(x ↦ x + k, k − 1)): the closure that the
    // call with k = 1 made is returned by the call with k = 0, which must
    // not put its own k in it.
    'a closure made by a recursive call and returned by a deeper one',
    [['h', recursivePass('g')]],
    ['Apply', ['h', ['Function', 'x', 'x'], 3], 100],
    101,
  ],
  [
    'control: the deepest recursive call applies the closure itself',
    [['h', recursivePass(['Apply', 'g', 100])]],
    ['h', ['Function', 'x', 'x'], 3],
    101,
  ],
  [
    // f = (L, k) ↦ If(k = 0, L[1], f([x ↦ x + k], k − 1))
    'a closure in a list, made by a recursive call and returned by a deeper one',
    [
      [
        'f',
        [
          'Function',
          [
            'If',
            ['Equal', 'k', 0],
            ['At', 'L', 1],
            [
              'f',
              ['List', ['Function', ['Add', 'x', 'k'], 'x']],
              ['Subtract', 'k', 1],
            ],
          ],
          'L',
          'k',
        ],
      ],
    ],
    ['Apply', ['f', ['List', ['Function', 'x', 'x']], 3], 100],
    101,
  ],
];

describe('a closure returned through several call frames', () => {
  test.each(cases)('%s', (_label, definitions, expr, expected) => {
    expect(twice(definitions, expr)).toEqual([expected, expected]);
  });

  test.each(cases)(
    '%s (evaluateAsync)',
    async (_label, definitions, expr, expected) => {
      expect(await twiceAsync(definitions, expr)).toEqual([expected, expected]);
    }
  );
});

describe('a counter returned through a wrapper', () => {
  test('one closure counts on, two closures count separately', () => {
    const ce = engine([
      ['mk', counter],
      ['wrap', ['Function', ['mk', 'm'], 'm']],
    ]);
    const c1 = ce.box(['wrap', 5]).evaluate();
    const c2 = ce.box(['wrap', 5]).evaluate();
    expect(ce.function('Apply', [c1]).evaluate().json).toBe(6);
    expect(ce.function('Apply', [c1]).evaluate().json).toBe(7);
    expect(ce.function('Apply', [c2]).evaluate().json).toBe(6);
  });
});

// f = n ↦ If(n > 0, Block(Declare(<name>), <name> := <value>,
//   DefineFunction(g, b ↦ (x ↦ <name> + x)), g(0)), 0)
const localOfBranch = (name: string, value: unknown) => [
  'Function',
  [
    'If',
    ['Greater', 'n', 0],
    [
      'Block',
      ['Declare', name, "'integer'", value],
      [
        'DefineFunction',
        'g',
        ['Function', ['Function', ['Add', name, 'x'], 'x'], 'b'],
      ],
      ['g', 0],
    ],
    0,
  ],
  'n',
];

describe('a closure of a local function that reads a local of a branch', () => {
  const q = localOfBranch('q', ['Multiply', 10, 'n']);

  test('applied at once', () => {
    const ce = engine([['f', q]]);
    expect(ce.box(['Apply', ['f', 5], 1]).evaluate().json).toBe(51);
    expect(ce.box(['Apply', ['f', 7], 1]).evaluate().json).toBe(71);
  });

  test('applied at once (evaluateAsync)', async () => {
    const ce = engine([['f', q]]);
    expect((await ce.box(['Apply', ['f', 5], 1]).evaluateAsync()).json).toBe(
      51
    );
    expect((await ce.box(['Apply', ['f', 7], 1]).evaluateAsync()).json).toBe(
      71
    );
  });

  test('applied after a second call made its own closure', () => {
    const ce = engine([['f', q]]);
    const r5 = ce.box(['f', 5]).evaluate();
    const r7 = ce.box(['f', 7]).evaluate();
    expect(ce.function('Apply', [r5, ce.number(1)]).evaluate().json).toBe(51);
    expect(ce.function('Apply', [r7, ce.number(1)]).evaluate().json).toBe(71);
  });

  test('applied after a second call made its own closure (evaluateAsync)', async () => {
    const ce = engine([['f', q]]);
    const r5 = await ce.box(['f', 5]).evaluateAsync();
    const r7 = await ce.box(['f', 7]).evaluateAsync();
    expect(
      (await ce.function('Apply', [r5, ce.number(1)]).evaluateAsync()).json
    ).toBe(51);
    expect(
      (await ce.function('Apply', [r7, ce.number(1)]).evaluateAsync()).json
    ).toBe(71);
  });

  test('a local with a constant value', async () => {
    const definitions: Definitions = [['f', localOfBranch('k', 7)]];
    expect(twice(definitions, ['Apply', ['f', 1], 1])).toEqual([8, 8]);
    expect(await twiceAsync(definitions, ['Apply', ['f', 1], 1])).toEqual([
      8, 8,
    ]);
  });
});

describe('a closure of a local function that reads a parameter of the call', () => {
  // f = n ↦ Block(h := (m ↦ (y ↦ y + m + n)), [h(1), n]): the closure that
  // h(1) returns reads the `n` of the call of f, and the result shows its
  // value, not a free `n`.
  const f = [
    'Function',
    [
      'Block',
      [
        'Assign',
        'h',
        ['Function', ['Function', ['Add', 'y', 'm', 'n'], 'y'], 'm'],
      ],
      ['List', ['h', 1], 'n'],
    ],
    'n',
  ];

  test('the result holds the value of the parameter', () => {
    const ce = engine([['f', f]]);
    expect(ce.box(['f', 5]).evaluate().json).toEqual([
      'List',
      ['Function', ['Block', ['Add', 'y', 6]], 'y'],
      5,
    ]);
    expect(ce.box(['Apply', ['At', ['f', 5], 1], 100]).evaluate().json).toBe(
      106
    );
  });
});

describe('a closure of a recursive call inside a closure of a deeper call', () => {
  // f = (n, g) ↦ Block(h := (m ↦ (y ↦ n + m(y))), If(n = 0, h(g),
  // f(n − 1, h(g)))): the closure that the deepest call returns holds the
  // closure that the call with n + 1 made, which keeps its own n.
  // f(n, y ↦ 0)(0) = n + (n − 1) + … + 0.
  const f = [
    'Function',
    [
      'Block',
      [
        'Assign',
        'h',
        ['Function', ['Function', ['Add', 'n', ['m', 'y']], 'y'], 'm'],
      ],
      [
        'If',
        ['Equal', 'n', 0],
        ['h', 'g'],
        ['f', ['Subtract', 'n', 1], ['h', 'g']],
      ],
    ],
    'n',
    'g',
  ];
  const at = (n: number) => ['Apply', ['f', n, ['Function', 0, 'y']], 0];

  test.each([
    [1, 1],
    [2, 3],
    [3, 6],
  ])('f(%i, y ↦ 0)(0) = %i', async (n, expected) => {
    expect(twice([['f', f]], at(n))).toEqual([expected, expected]);
    expect(await twiceAsync([['f', f]], at(n))).toEqual([expected, expected]);
  });
});
