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

  // With `numericApproximation`, the evaluation of a lazy `Map` wraps its
  // callback in the numeric marker (`lazyMapNumericApproximation`). On the
  // asynchronous route, this can run after an `await`, and the new callback
  // read the locals of the block as free symbols when it was made in the
  // global scope: `Block(Declare(c, 'real', 5), Map(k ↦ c + k, [1, 2]))`
  // gave `[c + 1, c + 2]`. An application of a callback with the marker
  // evaluates the body without a call frame (`applyMarkerBody`), and a
  // function that the block defines did not find the locals of the run when
  // the callback called it: `Map(k ↦ h(k) + 1, [1, 2])` gave
  // `[c + 2, c + 3]`.
  test.each(cases)('%s, with numericApproximation', async (_name, program) => {
    const options = { numericApproximation: true };
    const sync = new ComputeEngine().box(program as any).evaluate(options);
    const async = await new ComputeEngine()
      .box(program as any)
      .evaluateAsync(options);
    expect(elements(async)).toBe(elements(sync));
    expect(elements(async)).not.toMatch(/\b[bcd]\b/);
  });

  test('the values with numericApproximation', async () => {
    const options = { numericApproximation: true };
    const defineH = [
      'DefineFunction',
      'h',
      ['Function', ['Add', 'c', 'k'], 'k'],
    ];
    const results: string[] = [];
    for (const program of [
      [
        'Block',
        declareC(5),
        ['Map', ['Function', ['Add', 'c', 'k'], 'k'], ['List', 1, 2]],
      ],
      [
        'Block',
        declareC(5),
        defineH,
        ['Map', ['Function', ['Add', ['h', 'k'], 1], 'k'], ['List', 1, 2]],
      ],
      ['Block', declareC(5), defineH, ['Map', 'h', ['List', 1, 2]]],
    ]) {
      const ce = new ComputeEngine();
      results.push(
        elements(ce.box(program as any).evaluate(options)),
        elements(await ce.box(program as any).evaluateAsync()),
        elements(await ce.box(program as any).evaluateAsync(options))
      );
    }
    expect(results).toEqual([
      '[6,7]',
      '[6,7]',
      '[6,7]',
      '[7,8]',
      '[7,8]',
      '[7,8]',
      '[6,7]',
      '[6,7]',
      '[6,7]',
    ]);
  });

  // A literal whose body is the numeric marker evaluates its body in the
  // scope where it was defined. When that scope binds a name that an
  // argument reads to another definition (the global `y` for the valueless
  // `y` of the block), the application takes the ordinary route, with a
  // call frame, on every route. The body was evaluated in the scope of the
  // reader of the lazy `Map` instead, and `h` read `c` as a free symbol:
  // `evaluateAsync({ numericApproximation: true })` gave `[c + 6, 8]`.
  test('an argument that the scope of the literal binds to another definition', async () => {
    const options = { numericApproximation: true };
    const program = [
      'Block',
      declareC(5),
      ['Declare', 'y', { str: 'real' }],
      ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
      ['Map', ['Function', ['Add', ['h', 'k'], 1], 'k'], ['List', 'y', 2]],
    ];
    const ce = new ComputeEngine();
    ce.assign('y', 5);
    const results = [
      elements(ce.box(program as any).evaluate(options)),
      elements(
        ce
          .box(program as any)
          .evaluate()
          .N()
      ),
      elements(await ce.box(program as any).evaluateAsync()),
      elements(await ce.box(program as any).evaluateAsync(options)),
    ];
    expect(results).toEqual(Array(4).fill(results[0]));
    expect(results[3]).not.toMatch(/\bc\b/);
  });

  // The function of a call in an argument (`h` of `h(1)`) is a name that
  // the argument reads, as a symbol is: here the global `h` and the `h` of
  // the block are two definitions.
  test('a call in an argument of a literal with the numeric marker', async () => {
    const options = { numericApproximation: true };
    const defineH = [
      'DefineFunction',
      'h',
      ['Function', ['Add', 'c', 'k'], 'k'],
    ];
    const results: string[] = [];
    for (const program of [
      ['Block', declareC(5), defineH, ['G', ['h', 1]]],
      ['Block', declareC(5), defineH, ['Map', 'G', ['List', ['h', 1]]]],
      [
        'Apply',
        ['Block', declareC(5), defineH, ['Function', ['G', ['h', 'n']], 'n']],
        1,
      ],
    ]) {
      const ce = new ComputeEngine();
      ce.declare('h', 'function');
      ce.assign('h', ce.box(['Function', ['Multiply', 100, 'x'], 'x'] as any));
      ce.assign(
        'G',
        ce.box(['Function', ['NumericApproximation', 'x'], 'x'] as any)
      );
      results.push(
        elements(ce.box(program as any).evaluate(options)),
        elements(await ce.box(program as any).evaluateAsync(options))
      );
    }
    expect(results).toEqual(['6', '6', '[6]', '[6]', '6', '6']);
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

  // A local that holds a function value (not a function definition) and is
  // called from the callback of a lazy `Map` or `Filter`. The application in
  // the callback was evaluated in the ambient scope, where the local is not
  // visible, and stayed unevaluated (`[h(1), h(2)]`) on both routes.
  test.each([
    [
      'a local assigned a function literal',
      [
        'Block',
        declareC(5),
        ['Assign', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        ['Map', ['Function', ['h', 'k'], 'k'], ['List', 1, 2]],
      ],
      '[6,7]',
    ],
    [
      'a local declared with a function literal as its value',
      [
        'Block',
        declareC(5),
        [
          'Declare',
          'g',
          { str: 'unknown' },
          ['Function', ['Add', 'c', 'x'], 'x'],
        ],
        ['Map', ['Function', ['g', 'k'], 'k'], ['List', 1, 2]],
      ],
      '[6,7]',
    ],
    [
      'a local that does not read another local',
      [
        'Block',
        ['Assign', 'h', ['Function', ['Add', 1, 'k'], 'k']],
        ['Map', ['Function', ['h', 'k'], 'k'], ['List', 1, 2]],
      ],
      '[2,3]',
    ],
    [
      'a call of the local in an operand of the callback',
      [
        'Block',
        declareC(5),
        ['Assign', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        ['Map', ['Function', ['Add', ['h', 'k'], 1], 'k'], ['List', 1, 2]],
      ],
      '[7,8]',
    ],
    [
      'a nested block',
      [
        'Block',
        declareC(5),
        ['Assign', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
        [
          'Block',
          ['Declare', 'd', { str: 'real' }, 10],
          ['Map', ['Function', ['Add', 'd', ['h', 'k']], 'k'], ['List', 1, 2]],
        ],
      ],
      '[16,17]',
    ],
    [
      'a Filter predicate',
      [
        'Block',
        declareC(5),
        ['Assign', 'p', ['Function', ['Greater', 'k', 'c'], 'k']],
        [
          'Filter',
          ['List', 4, 5, 6, 7],
          ['Function', ['p', 'k'], 'k'],
        ],
      ],
      '[6,7]',
    ],
  ])(
    'a lazy collection calls a block local that holds a function value: %s',
    async (_name, program, expected) => {
      const sync = new ComputeEngine().box(program as any).evaluate();
      const async = await new ComputeEngine()
        .box(program as any)
        .evaluateAsync();
      expect([elements(sync), elements(async)]).toEqual([expected, expected]);
    }
  );

  // `.N()` boxes the callback again from MathJSON
  // (`lazyMapNumericApproximation`), and the head of the application in the
  // callback must still be found as the block local.
  test('a lazy collection calls a block local that holds a function value, with N()', async () => {
    const program = [
      'Block',
      declareC(5),
      ['Assign', 'h', ['Function', ['Add', 'c', 'k'], 'k']],
      ['Map', ['Function', ['h', 'k'], 'k'], ['List', 1, 2]],
    ];
    const sync = new ComputeEngine().box(program as any).N();
    const async = (
      await new ComputeEngine().box(program as any).evaluateAsync()
    ).N();
    expect([elements(sync), elements(async)]).toEqual(['[6,7]', '[6,7]']);
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

/**
 * A function literal that a block evaluates in a function body, and that is
 * applied in that body. When the literal is evaluated, it captures the
 * nested blocks in use (`captureNestedLocals`). On the asynchronous route,
 * the capture copied the bindings of the block scope, not those of the run
 * of the block (its activation), so the literal read the local as a free
 * symbol: `Apply(Function(Apply(Block(Declare(c, 'real', 5), k ↦ c + k), n),
 * n), 1)` gave `c + 1` with `evaluateAsync()` and `6` with `evaluate()`.
 */
describe('a function literal evaluated in a block of a function body reads the locals of the run on both routes', () => {
  const literal = ['Function', ['Add', 'c', 'k'], 'k'];
  const block = ['Block', declareC(5), literal];
  const bodyCases: [string, unknown, string][] = [
    [
      'applied in the function body',
      ['Apply', ['Function', ['Apply', block, 'n'], 'n'], 1],
      '6',
    ],
    [
      'the block at the top level (control)',
      ['Apply', block, 1],
      '6',
    ],
    [
      'the literal applied outside the function body (control)',
      ['Apply', ['Apply', ['Function', block, 'n'], 1], 1],
      '6',
    ],
    [
      'two nested blocks',
      [
        'Apply',
        [
          'Function',
          [
            'Apply',
            [
              'Block',
              ['Declare', 'd', { str: 'real' }, 10],
              [
                'Block',
                declareC(5),
                ['Function', ['Add', 'c', 'd', 'k'], 'k'],
              ],
            ],
            'n',
          ],
          'n',
        ],
        1,
      ],
      '16',
    ],
    [
      'the literal reads a parameter of the function',
      [
        'Apply',
        [
          'Function',
          [
            'Apply',
            ['Block', declareC(5), ['Function', ['Add', 'c', 'n', 'k'], 'k']],
            1,
          ],
          'n',
        ],
        100,
      ],
      '106',
    ],
    [
      'two runs of the block in one call',
      [
        'Apply',
        ['Function', ['Add', ['Apply', block, 'n'], ['Apply', block, 'n']], 'n'],
        1,
      ],
      '12',
    ],
    [
      'a write to the local after the literal is created',
      [
        'Apply',
        [
          'Function',
          [
            'Block',
            [
              'Block',
              declareC(5),
              ['Assign', 'g', literal],
              ['Assign', 'c', 7],
              ['Apply', 'g', 'n'],
            ],
          ],
          'n',
        ],
        1,
      ],
      '8',
    ],
    [
      'in the body of a Sum',
      [
        'Apply',
        [
          'Function',
          [
            'Sum',
            [
              'Apply',
              [
                'Block',
                declareC(5),
                ['Function', ['Add', 'c', 'k', 'i'], 'k'],
              ],
              'n',
            ],
            ['Element', 'i', ['Range', 1, 3]],
          ],
          'n',
        ],
        1,
      ],
      '24',
    ],
    [
      'the literal calls a function that the block defines',
      [
        'Apply',
        [
          'Function',
          [
            'Apply',
            [
              'Block',
              declareC(5),
              ['DefineFunction', 'h', literal],
              ['Function', ['h', 'k'], 'k'],
            ],
            'n',
          ],
          'n',
        ],
        1,
      ],
      '6',
    ],
  ];

  test('two asynchronous evaluations at the same time read their own run', async () => {
    const program = (x: number) => [
      'Apply',
      [
        'Function',
        [
          'Apply',
          [
            'Block',
            ['Declare', 'c', { str: 'real' }, 'n'],
            ['Function', ['Add', 'c', 'k'], 'k'],
          ],
          'n',
        ],
        'n',
      ],
      x,
    ];
    const ce = new ComputeEngine();
    const [a, b] = await Promise.all([
      ce.box(program(1) as any).evaluateAsync(),
      ce.box(program(10) as any).evaluateAsync(),
    ]);
    const expected = [1, 10].map((x) =>
      ce.box(program(x) as any).evaluate().toString()
    );
    expect(expected).toEqual(['2', '20']);
    expect([a.toString(), b.toString()]).toEqual(expected);
  });

  test.each(bodyCases)('%s', async (_name, program, expected) => {
    const sync = new ComputeEngine().box(program as any).evaluate();
    const async = await new ComputeEngine()
      .box(program as any)
      .evaluateAsync();
    expect(sync.toString()).toBe(expected);
    expect(async.toString()).toBe(expected);
  });
});
