import { ComputeEngine } from '../../src/compute-engine';

/**
 * An argument of a call made in a `Block` holds a symbol bound to a local of
 * the block. The call frame binds the parameter to that argument, and the
 * body reads it inside the frame, whose chain goes through the scope that
 * defined the function, not through the block.
 *
 * The argument reads the local of the block, not a name of the defining
 * scope: with a global `y := 5` and a global `g := x ↦ x + 0.5`,
 * `Block(Declare(y, 'real', 3), g(y))` is `3.5`, on both the synchronous and
 * the asynchronous route.
 */

const DECLARE_Y = ['Declare', 'y', "'real'", 3];

function engine(globalY: boolean): ComputeEngine {
  const ce = new ComputeEngine();
  if (globalY) ce.assign('y', 5);
  ce.assign('g', ce.box(['Function', ['Add', 'x', 0.5], 'x']));
  ce.assign('f', ce.box(['Function', ['NumericApproximation', 'x'], 'x']));
  ce.assign('g2', ce.box(['Function', ['g', 'x'], 'x']));
  return ce;
}

const CASES: [string, unknown, string][] = [
  ['g(y)', ['Block', DECLARE_Y, ['g', 'y']], '3.5'],
  ['f(y)', ['Block', DECLARE_Y, ['f', 'y']], '3'],
  ['Apply(f, y)', ['Block', DECLARE_Y, ['Apply', 'f', 'y']], '3'],
  ['Apply(g, y)', ['Block', DECLARE_Y, ['Apply', 'g', 'y']], '3.5'],
  // A nested call passes the argument on: the outer frame reads it in the
  // block, through the caller of the outer call.
  ['g2(y)', ['Block', DECLARE_Y, ['g2', 'y']], '3.5'],
  // The call is in a block nested in the block that declares `y`.
  ['nested block', ['Block', DECLARE_Y, ['Block', ['g', 'y']]], '3.5'],
  // An element of `Map` that is read in the block.
  [
    'At(Map(f, [y]), 1)',
    ['Block', DECLARE_Y, ['At', ['Map', 'f', ['List', 'y']], 1]],
    '3',
  ],
  [
    'At(Map(g, [y]), 1)',
    ['Block', DECLARE_Y, ['At', ['Map', 'g', ['List', 'y']], 1]],
    '3.5',
  ],
];

describe('A CALLER-LOCAL SYMBOL IN AN ARGUMENT READS THE LOCAL', () => {
  for (const [label, expr, expected] of CASES) {
    test(`${label} with a global y (evaluate)`, () => {
      const ce = engine(true);
      expect(ce.box(expr as any).evaluate().toString()).toBe(expected);
    });
    test(`${label} with a global y (evaluateAsync)`, async () => {
      const ce = engine(true);
      const result = await ce.box(expr as any).evaluateAsync();
      expect(result.toString()).toBe(expected);
    });
    test(`${label} with no global y (control)`, async () => {
      const ce = engine(false);
      expect(ce.box(expr as any).evaluate().toString()).toBe(expected);
      const result = await ce.box(expr as any).evaluateAsync();
      expect(result.toString()).toBe(expected);
    });
  }
});

describe('A REMOVED LOCAL IN AN ARGUMENT, MORE FORMS', () => {
  test('a name left unbound in the block does not read a binding of the callee', async () => {
    // `g` closes over a private `y = 5`, and there is no global `y`.
    const ce = new ComputeEngine();
    ce.assign(
      'g',
      ce
        .box([
          'Block',
          DECLARE_Y,
          ['Assign', 'y', 5],
          ['Function', ['Add', 'x', 'y'], 'x'],
        ])
        .evaluate()
    );
    const expr = ['Block', ['g', 'y']];
    expect(ce.box(expr).evaluate().toString()).toBe('y + 5');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('y + 5');
  });

  test('a lazy view read in a nested block reads the local of its own block', async () => {
    const ce = engine(true);
    const expr = [
      'Block',
      DECLARE_Y,
      ['Declare', 'L', "'unknown'", ['Map', 'g', ['List', 'y']]],
      ['Block', DECLARE_Y, ['Assign', 'y', 7], ['At', 'L', 1]],
    ];
    expect(ce.box(expr).evaluate().toString()).toBe('3.5');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('3.5');
  });

  test('a block that is a function body', async () => {
    const ce = engine(true);
    ce.assign('F', ce.box(['Function', ['Block', DECLARE_Y, ['g', 'y']], 'n']));
    const expr = ['List', ['F', 1], ['F', 2]];
    expect(ce.box(expr).evaluate().toString()).toBe('[3.5,3.5]');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe(
      '[3.5,3.5]'
    );
  });

  test('a block that is the body of a function with no parameter', async () => {
    const ce = engine(true);
    ce.assign('H', ce.box(['Function', ['Block', DECLARE_Y, ['g', 'y']]]));
    expect(ce.box(['H']).evaluate().toString()).toBe('3.5');
    expect((await ce.box(['H']).evaluateAsync()).toString()).toBe('3.5');
  });

  test('a block that is the body of a recursive function', async () => {
    const ce = engine(true);
    ce.assign(
      'R',
      ce.box([
        'Function',
        [
          'Block',
          DECLARE_Y,
          [
            'If',
            ['Greater', 'n', 0],
            ['R', ['Subtract', 'n', 1]],
            ['g', 'y'],
          ],
        ],
        'n',
      ])
    );
    expect(ce.box(['R', 3]).evaluate().toString()).toBe('3.5');
    expect((await ce.box(['R', 3]).evaluateAsync()).toString()).toBe(
      '3.5'
    );
  });

  test('concurrent asynchronous applications of a function body', async () => {
    const ce = engine(true);
    ce.assign('F', ce.box(['Function', ['Block', DECLARE_Y, ['g', 'y']], 'n']));
    ce.assign(
      'G',
      ce.box([
        'Function',
        ['Block', DECLARE_Y, ['Assign', 'y', 'n'], ['g', 'y']],
        'n',
      ])
    );
    const results = await Promise.all([
      ce.box(['F', 1]).evaluateAsync(),
      ce.box(['F', 2]).evaluateAsync(),
      ce.box(['G', 1]).evaluateAsync(),
      ce.box(['G', 2]).evaluateAsync(),
    ]);
    expect(results.map((r) => r.toString())).toEqual([
      '3.5',
      '3.5',
      '1.5',
      '2.5',
    ]);
  });
});

describe('CONTROLS', () => {
  test('a local with a value reads that value', async () => {
    const ce = engine(true);
    const expr = ['Block', DECLARE_Y, ['Assign', 'y', 3], ['g', 'y']];
    expect(ce.box(expr).evaluate().toString()).toBe('3.5');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('3.5');
  });

  test('an inner local of the same name reads the inner local', async () => {
    const ce = engine(true);
    const expr = [
      'Block',
      DECLARE_Y,
      ['Block', DECLARE_Y, ['Assign', 'y', 7], ['g', 'y']],
    ];
    expect(ce.box(expr).evaluate().toString()).toBe('7.5');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('7.5');
  });

  test('a value shield in the block hides the value of the local', async () => {
    const ce = engine(false);
    const expr = [
      'Block',
      DECLARE_Y,
      ['Assign', 'y', 3],
      ['HoldValues', ['Add', 'y', 1], 'y'],
    ];
    expect(ce.box(expr).evaluate().toString()).toBe('y + 1');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('y + 1');
  });

  test('a value shield in the block hides the value of the local in a call', async () => {
    const ce = engine(true);
    const expr = [
      'Block',
      DECLARE_Y,
      ['Assign', 'y', 3],
      ['HoldValues', ['g', 'y'], 'y'],
    ];
    expect(ce.box(expr).evaluate().toString()).toBe('y + 0.5');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('y + 0.5');
  });

  test('a block with no local reads the global', async () => {
    const ce = engine(true);
    const expr = ['Block', ['g', 'y']];
    expect(ce.box(expr).evaluate().toString()).toBe('5.5');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('5.5');
  });

  test('a function defined in the block reads the local of its own scope, not of the scope of its caller', async () => {
    const ce = engine(true);
    const expr = [
      'Block',
      DECLARE_Y,
      ['Declare', 'h', "'unknown'", ['Function', ['Add', 'y', 0.5]]],
      ['Block', DECLARE_Y, ['Assign', 'y', 2], ['h']],
    ];
    expect(ce.box(expr).evaluate().toString()).toBe('3.5');
    expect((await ce.box(expr).evaluateAsync()).toString()).toBe('3.5');
  });
});
