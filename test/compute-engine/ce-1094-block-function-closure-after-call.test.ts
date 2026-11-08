import { ComputeEngine } from '../../src/compute-engine';

/**
 * A function that a block defines with `DefineFunction` in a function body,
 * and that a closure of the body calls after the call has ended, reads the
 * locals of the body in the frame of that call.
 *
 * The locals of the body are declared in the call frame. The function keeps
 * the body scope as its defining scope, and the parent of the body scope is
 * the frame only while the call runs. A closure that leaves the call (by an
 * assignment to an outer variable, or as the value of the call) holds the
 * frame in its chain, and a call of the function from that closure now finds
 * the frame there (`recordCallFrameRun()` in
 * `src/compute-engine/function-utils.ts`). Before, with
 * `n ↦ Block(Declare(c, 'real', 5), DefineFunction(h, k ↦ c + k),
 * Assign(g, x ↦ h(x)))` applied to `1`, the call `g(10)` gave `c + 10`, not
 * `15`, with `evaluate()` and with `evaluateAsync()`.
 */

const defineH = ['DefineFunction', 'h', ['Function', ['Add', 'c', 'k'], 'k']];
// `c` depends on the argument, so two calls of the body make two values.
const declareC = ['Declare', 'c', 'real', ['Multiply', 5, 'n']];
const assignG = ['Assign', 'g', ['Function', ['h', 'x'], 'x']];

const bodies: [string, unknown][] = [
  ['the closure is assigned in the block', ['Block', declareC, defineH, assignG]],
  [
    'the closure is assigned in a loop of the block',
    [
      'Block',
      declareC,
      defineH,
      ['Loop', assignG, ['Element', 'i', ['Range', 1, 2]]],
    ],
  ],
  [
    'the closure is assigned in a sum of the block',
    [
      'Block',
      declareC,
      defineH,
      ['Sum', ['Block', assignG, 0], ['Limits', 'i', 1, 2]],
    ],
  ],
  [
    'the function of the block reads a parameter of the body',
    [
      'Block',
      [
        'DefineFunction',
        'h',
        ['Function', ['Add', ['Multiply', 5, 'n'], 'k'], 'k'],
      ],
      assignG,
    ],
  ],
  [
    'the closure calls a function that calls the function of the block',
    [
      'Block',
      declareC,
      defineH,
      ['DefineFunction', 'h2', ['Function', ['h', 'k'], 'k']],
      ['Assign', 'g', ['Function', ['h2', 'x'], 'x']],
    ],
  ],
  [
    'the block is an If branch of the body',
    [
      'Block',
      ['If', ['Greater', 'n', 0], ['Block', declareC, defineH, assignG], 0],
    ],
  ],
  [
    'the body also calls the closure before it ends',
    ['Block', declareC, defineH, assignG, ['g', 100]],
  ],
];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', 'function');
  ce.assign('g', ce.box(['Function', 'x', 'x']));
  return ce;
}

async function run(
  ce: ComputeEngine,
  program: unknown,
  asynchronous: boolean
) {
  const expr = ce.box(program as any);
  return asynchronous ? await expr.evaluateAsync() : expr.evaluate();
}

describe('a closure calls a function of the block of a function body after the call', () => {
  describe.each([
    ['evaluate()', false],
    ['evaluateAsync()', true],
  ])('%s', (_route, asynchronous) => {
    test.each(bodies)('%s', async (_name, body) => {
      const ce = engine();
      const fn = ['Function', body, 'n'];
      await run(ce, [fn, 1], asynchronous);
      expect(ce.box(['g', 10]).evaluate().json).toBe(15);
      // Each call keeps its own frame: the closure of the first call still
      // reads `c = 5` after a second call made `c = 10`.
      const first = ce.box('g').evaluate();
      await run(ce, [fn, 2], asynchronous);
      expect(ce.box(['g', 10]).evaluate().json).toBe(20);
      ce.assign('g', first);
      expect(ce.box(['g', 10]).evaluate().json).toBe(15);
    });

    test('the closure is the value of the call', async () => {
      const ce = engine();
      const closure = await run(
        ce,
        [
          [
            'Function',
            ['Block', declareC, defineH, ['Function', ['h', 'k'], 'k']],
            'n',
          ],
          1,
        ],
        asynchronous
      );
      // The boxed value, not its MathJSON: the MathJSON does not keep the
      // scope that the closure captured.
      ce.assign('g', closure);
      expect(ce.box(['g', 10]).evaluate().json).toBe(15);
    });

    test('the closure of an inner recursive call is called while the outer call runs', async () => {
      // `f(1)` assigns the closure; `f(2)` calls it after `f(1)` ends, while
      // its own frame holds `c = 10`. The closure reads the frame of `f(1)`,
      // where `c = 5`. Before, it read the frame of `f(2)` and gave `10`.
      const ce = engine();
      ce.declare('f', '(integer) scope -> any');
      ce.assign(
        'f',
        ce.box([
          'Function',
          [
            'Block',
            declareC,
            defineH,
            [
              'If',
              ['Greater', 'n', 1],
              ['Block', ['f', ['Subtract', 'n', 1]], ['g', 0]],
              ['Block', assignG, 0],
            ],
          ],
          'n',
        ] as any)
      );
      expect((await run(ce, ['f', 2], asynchronous)).json).toBe(5);
    });

    test('a function with no parameter', async () => {
      const ce = engine();
      await run(
        ce,
        [['Function', ['Block', ['Declare', 'c', 'real', 5], defineH, assignG]]],
        asynchronous
      );
      expect(ce.box(['g', 10]).evaluate().json).toBe(15);
    });
  });
});
