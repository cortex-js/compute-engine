import { ComputeEngine } from '../../src/compute-engine';

/**
 * A function literal that reads a local of a `Block` leaves the block: as
 * the value of the block, or in a lazy collection (`Map`, `Filter`) whose
 * elements are computed after the block ends.
 *
 * On the asynchronous route, the block runs in an activation of its scope
 * (a copy that holds the values of this run), while the function literal
 * chains to the scope that the activation copies, which does not hold them.
 * The literal read the local as a free symbol after the block ended:
 * `Block(Declare(c, 'real', 5), Map(k ↦ c + k, [1, 2]))` gave `[c + 1, c + 2]`
 * with `evaluateAsync()` and `[6, 7]` with `evaluate()`. The value that
 * `Assign` stores in the literal (`s := Hold(c + k)`) had the same defect,
 * with or without the `constant` attribute on the local. A function that
 * the block defines (`DefineFunction`, or `h := k ↦ c + k`) and a block
 * nested in a function body (an `If` branch) had the same defect.
 */

const CONSTANT = ['Dictionary', ['KeyValuePair', 'constant', 'True']];

function declareC(value: unknown, attributes: unknown[] = []): unknown {
  return ['Declare', 'c', { str: 'real' }, value, ...attributes];
}

const heldSum = [
  'Function',
  ['Block', ['Assign', 's', ['Hold', ['Add', 'c', 'k']]], 's'],
  'k',
];

// The elements of a collection, computed and printed, or the value printed.
// The string of a lazy collection whose element type is not known is the
// collection itself (`Map(…)`), not its elements.
function elements(x: any): string {
  return x.isCollection
    ? `[${[...x.each()].map((e: any) => e.toString()).join(',')}]`
    : x.toString();
}

const cases: [string, unknown][] = [
  [
    'Map of a literal that stores a held sum, constant local',
    ['Block', declareC(5, [CONSTANT]), ['Map', heldSum, ['List', 1, 2]]],
  ],
  [
    'Map of a literal that stores a held sum, variable local',
    ['Block', declareC(5), ['Map', heldSum, ['List', 1, 2]]],
  ],
  [
    'Map of a literal that reads the local',
    [
      'Block',
      declareC(5),
      ['Map', ['Function', ['Add', 'c', 'k'], 'k'], ['List', 1, 2]],
    ],
  ],
  [
    'Filter with a predicate that reads the local',
    [
      'Block',
      declareC(1),
      [
        'Filter',
        ['List', 1, 2, 3],
        ['Function', ['Greater', 'k', 'c'], 'k'],
      ],
    ],
  ],
  [
    'Map in a nested block that reads the locals of both blocks',
    [
      'Block',
      declareC(5),
      [
        'Block',
        ['Declare', 'd', { str: 'real' }, 10],
        ['Map', ['Function', ['Add', 'c', 'd', 'k'], 'k'], ['List', 1, 2]],
      ],
    ],
  ],
  [
    'Map of a literal whose body has a Sum that reads the local',
    [
      'Block',
      declareC(5),
      [
        'Map',
        [
          'Function',
          ['Sum', ['Multiply', 'c', 'j'], ['Limits', 'j', 1, 'k']],
          'k',
        ],
        ['List', 1, 2],
      ],
    ],
  ],
  [
    'Map of a literal that writes the local',
    [
      'Block',
      declareC(5),
      [
        'Map',
        ['Function', ['Block', ['Assign', 'c', ['Add', 'c', 'k']], 'c'], 'k'],
        ['List', 1, 2],
      ],
    ],
  ],
  [
    'Map in a nested block that reads the local of the outer block',
    [
      'Block',
      declareC(5),
      [
        'Block',
        ['Declare', 'd', { str: 'real' }, 10],
        ['Map', ['Function', ['Add', 'c', 'k'], 'k'], ['List', 1, 2]],
      ],
    ],
  ],
  [
    'Map of a function that the block defines with DefineFunction',
    [
      'Block',
      declareC(5),
      ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
      ['Map', 'h', ['List', 1, 2]],
    ],
  ],
  [
    'Map of a function that the block assigns to a local',
    [
      'Block',
      declareC(5),
      ['Assign', 'h', ['Function', ['Block', ['Add', 'c', 'k']], 'k']],
      ['Map', 'h', ['List', 1, 2]],
    ],
  ],
  [
    'a function that the block defines, as the value of the block',
    [
      'Apply',
      [
        'Block',
        declareC(5),
        ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        'h',
      ],
      1,
    ],
  ],
  [
    'a function literal that calls a function that the block defines, as the value of the block',
    [
      'Apply',
      [
        'Block',
        declareC(5),
        ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        ['Function', ['h', 'k'], 'k'],
      ],
      1,
    ],
  ],
  [
    'a function literal of a nested block that calls a function of the outer block',
    [
      'Apply',
      [
        'Block',
        declareC(5),
        ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        [
          'Block',
          ['Declare', 'd', { str: 'real' }, 10],
          ['Function', ['Add', 'd', ['h', 'k']], 'k'],
        ],
      ],
      1,
    ],
  ],
  [
    'a function literal that calls a function that calls a function that the block defines',
    [
      'Apply',
      [
        'Block',
        declareC(5),
        ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        ['DefineFunction', 'h2', ['Function', ['h', 'k'], 'k']],
        ['Function', ['h2', 'k'], 'k'],
      ],
      1,
    ],
  ],
  [
    'Map of a literal that calls a function that the block defines',
    [
      'Block',
      declareC(5),
      ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
      ['Map', ['Function', ['h', 'k'], 'k'], ['List', 1, 2]],
    ],
  ],
  [
    'Map of a literal that adds 1 to a call of a function that the block defines',
    [
      'Block',
      declareC(5),
      ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
      ['Map', ['Function', ['Add', ['h', 'k'], 1], 'k'], ['List', 1, 2]],
    ],
  ],
  [
    'Map of a literal that adds a call of a function that the block defines, with a constant argument',
    [
      'Block',
      declareC(5),
      ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
      ['Map', ['Function', ['Add', 'k', ['h', 1]], 'k'], ['List', 1, 2]],
    ],
  ],
  [
    'Map of a literal that calls a recursive function that the block defines',
    [
      'Block',
      declareC(5),
      [
        'DefineFunction',
        'h',
        [
          'Function',
          [
            'If',
            ['Greater', 'k', 0],
            ['Add', 1, ['h', ['Subtract', 'k', 1]]],
            'c',
          ],
          'k',
        ],
      ],
      ['Map', ['Function', ['h', ['h', 'k']], 'k'], ['List', 1, 2]],
    ],
  ],
  [
    'a function literal as the value of the block',
    ['Apply', ['Block', declareC(5), ['Function', ['Add', 'c', 'k'], 'k']], 1],
  ],
  [
    'Map in a block of an If branch of a function body',
    [
      'Apply',
      [
        'Function',
        [
          'If',
          ['Greater', 'n', 0],
          [
            'Block',
            declareC(5),
            ['Map', ['Function', ['Add', 'c', 'k'], 'k'], ['List', 1, 2]],
          ],
          0,
        ],
        'n',
      ],
      1,
    ],
  ],
  [
    'Map in a nested block of a function body',
    [
      'Apply',
      [
        'Function',
        [
          'Block',
          [
            'Block',
            declareC(5),
            ['Map', ['Function', ['Add', 'c', 'k'], 'k'], ['List', 1, 2]],
          ],
        ],
        'n',
      ],
      1,
    ],
  ],
  [
    'Map in two nested blocks of a function body that reads both locals',
    [
      'Apply',
      [
        'Function',
        [
          'Block',
          declareC(5),
          [
            'Block',
            ['Declare', 'd', { str: 'real' }, 10],
            [
              'Map',
              ['Function', ['Add', 'c', 'd', 'k'], 'k'],
              ['List', 1, 2],
            ],
          ],
        ],
        'n',
      ],
      1,
    ],
  ],
  [
    'Map in three nested blocks of a function body that reads every local',
    [
      'Apply',
      [
        'Function',
        [
          'Block',
          ['Declare', 'b', { str: 'real' }, 100],
          [
            'Block',
            declareC(5),
            [
              'Block',
              ['Declare', 'd', { str: 'real' }, 10],
              [
                'Map',
                ['Function', ['Add', 'b', 'c', 'd', 'k'], 'k'],
                ['List', 1, 2],
              ],
            ],
          ],
        ],
        'n',
      ],
      1,
    ],
  ],
  [
    'a block without Map (control)',
    [
      'Block',
      declareC(5),
      [
        'Block',
        ['Declare', 'k', { str: 'real' }, 1],
        ['Assign', 's', ['Hold', ['Add', 'c', 'k']]],
        's',
      ],
    ],
  ],
];

describe('a function literal that leaves a block reads its locals on both routes', () => {
  test.each(cases)('%s', async (_name, program) => {
    const sync = new ComputeEngine().box(program as any).evaluate();
    const async = await new ComputeEngine()
      .box(program as any)
      .evaluateAsync();
    expect(elements(async)).toBe(elements(sync));
    // A local read as a free symbol shows as `b`, `c` or `d` in the
    // elements.
    expect(elements(async)).not.toMatch(/\b[bcd]\b/);
  });

  test('the values', async () => {
    const ce = new ComputeEngine();
    const r = await ce
      .box([
        'Block',
        declareC(5, [CONSTANT]),
        ['Map', heldSum, ['List', 1, 2]],
      ] as any)
      .evaluateAsync();
    expect(r.toString()).toBe('[Hold(5 + 1),Hold(5 + 2)]');
    const n = await ce
      .box([
        'Block',
        declareC(5),
        [
          'Block',
          ['Declare', 'd', { str: 'real' }, 10],
          ['Map', ['Function', ['Add', 'c', 'd', 'k'], 'k'], ['List', 1, 2]],
        ],
      ] as any)
      .evaluateAsync();
    expect(n.toString()).toBe('[16,17]');
    const defineH = [
      'DefineFunction',
      'h',
      ['Function', ['Add', 'c', 'k'], 'k'],
    ];
    const applied = await ce
      .box([
        'Apply',
        ['Block', declareC(5), defineH, ['Function', ['h', 'k'], 'k']],
        1,
      ] as any)
      .evaluateAsync();
    expect(applied.toString()).toBe('6');
    const mapped = await ce
      .box([
        'Block',
        declareC(5),
        defineH,
        ['Map', ['Function', ['h', 'k'], 'k'], ['List', 1, 2]],
      ] as any)
      .evaluateAsync();
    expect(elements(mapped)).toBe('[6,7]');
  });

  test('a synchronous evaluation gives the same value before and after an asynchronous one', async () => {
    const ce = new ComputeEngine();
    const defineH = [
      'DefineFunction',
      'h',
      ['Function', ['Add', 'c', 'k'], 'k'],
    ];
    for (const program of [
      ['Apply', ['Block', declareC(5), defineH, ['Function', ['h', 'k'], 'k']], 1],
      [
        'Block',
        declareC(5),
        defineH,
        ['Map', ['Function', ['Add', 'k', ['h', 1]], 'k'], ['List', 1, 2]],
      ],
    ]) {
      const expr = ce.box(program as any);
      const before = elements(expr.evaluate());
      const async = elements(await expr.evaluateAsync());
      const after = elements(expr.evaluate());
      expect([before, async, after]).toEqual([before, before, before]);
      expect(before).not.toMatch(/\bc\b/);
    }
  });

  test('two asynchronous evaluations of one block keep separate locals after both end', async () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Block',
      ['Declare', 'c', { str: 'real' }, ['Random']],
      ['Map', ['Function', ['Add', 'c', 'k'], 'k'], ['List', 0, 1]],
    ] as any);
    const results = await Promise.all([
      expr.evaluateAsync(),
      expr.evaluateAsync(),
    ]);
    for (const r of results) {
      const [a, b] = [...r.each()].map((x) => x.re);
      expect(Number.isFinite(a)).toBe(true);
      expect(b - a).toBeCloseTo(1, 12);
    }
    const first = results.map((r) => [...r.each()][0].re);
    expect(first[0]).not.toBe(first[1]);
  });
});
