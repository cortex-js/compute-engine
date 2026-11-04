/**
 * A closure returned from an applied function literal keeps the bindings of
 * the block in the body of that literal.
 *
 * Two defects, with two causes:
 *
 * - A function literal kept in a local of the call (`f := z ↦ z + k`) read
 *   the other locals of the call (`k`) through the body scope of the
 *   function, whose parent is the call frame only while the call runs. The
 *   returned closure called `f` after the call, and `f` read a free `k`. Now
 *   the evaluation of a function literal in the body of a function that is
 *   being applied re-roots the literal on the call frame
 *   (`captureAtCreation`, `function-utils.ts`).
 * - A returned literal whose body assigns a local function (`g := z ↦ 3`)
 *   and calls it is rebuilt on a new body scope when the call ends
 *   (`captureClosures`). The call `g(0)` finds its callee by the scope that
 *   holds its binding, and the frame of a later application stood for the
 *   new scope only, not for the scope the call was bound in. Now the new
 *   scope stands for the old one (`markCallableFrame`).
 *
 * A closure keeps the binding of a local, not its value when the closure is
 * created (`docs/SCOPING-MODEL.md`, "Callable resolution": "Capturing a
 * binding does not freeze its value").
 */
import { ComputeEngine } from '../../src/compute-engine';

const json = (expr: unknown) =>
  new ComputeEngine().box(expr as any).evaluate().json;
const jsonAsync = async (expr: unknown) =>
  (await new ComputeEngine().box(expr as any).evaluateAsync()).json;

// y ↦ Block(k := 1, f := z ↦ z + k, x ↦ y·x + f(x))
const withLocalFunction = [
  'Function',
  [
    'Block',
    ['Assign', 'k', 1],
    ['Assign', 'f', ['Function', ['Add', 'z', 'k'], 'z']],
    ['Function', ['Add', ['Multiply', 'y', 'x'], ['f', 'x']], 'x'],
  ],
  'y',
];

// y ↦ Block(k := 1, x ↦ y·x + k)
const withoutLocalFunction = [
  'Function',
  [
    'Block',
    ['Assign', 'k', 1],
    ['Function', ['Add', ['Multiply', 'y', 'x'], 'k'], 'x'],
  ],
  'y',
];

// w ↦ (x ↦ Block(g := z ↦ 3, x + g(0)))
const innerLocalFunction = [
  'Function',
  [
    'Function',
    ['Block', ['Assign', 'g', ['Function', 3, 'z']], ['Add', 'x', ['g', 0]]],
    'x',
  ],
  'w',
];

describe('a closure that calls a local function of the call that made it', () => {
  test('the local function reads the other locals of the call', () => {
    // 3·2 + (2 + 1)
    expect(json(['Apply', ['Apply', withLocalFunction, 3], 2])).toBe(9);
  });

  test('control: the closure reads the local directly', () => {
    // 3·2 + 1
    expect(json(['Apply', ['Apply', withoutLocalFunction, 3], 2])).toBe(7);
  });

  test('the closure applied twice gives the value of each call', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'h', ['Apply', withLocalFunction, 3]]).evaluate();
    expect(ce.box(['h', 2]).evaluate().json).toBe(9);
    // 3·5 + (5 + 1)
    expect(ce.box(['h', 5]).evaluate().json).toBe(21);
    expect(ce.box(['h', 2]).evaluate().json).toBe(9);
  });

  test('a local reassigned after the local function is defined', () => {
    // The local function keeps the binding of `k`, and reads its last value:
    // 3·2 + (2 + 10).
    expect(
      json([
        'Apply',
        [
          'Apply',
          [
            'Function',
            [
              'Block',
              ['Assign', 'k', 1],
              ['Assign', 'f', ['Function', ['Add', 'z', 'k'], 'z']],
              ['Assign', 'k', 10],
              ['Function', ['Add', ['Multiply', 'y', 'x'], ['f', 'x']], 'x'],
            ],
            'y',
          ],
          3,
        ],
        2,
      ])
    ).toBe(18);
  });

  test('the local function is called from a closure two levels down', () => {
    // y ↦ Block(k := 1, f := z ↦ z + k, x ↦ (u ↦ y·x + f(x) + u)):
    // 3·2 + (2 + 1) + 100
    expect(
      json([
        'Apply',
        [
          'Apply',
          [
            'Apply',
            [
              'Function',
              [
                'Block',
                ['Assign', 'k', 1],
                ['Assign', 'f', ['Function', ['Add', 'z', 'k'], 'z']],
                [
                  'Function',
                  [
                    'Function',
                    ['Add', ['Multiply', 'y', 'x'], ['f', 'x'], 'u'],
                    'u',
                  ],
                  'x',
                ],
              ],
              'y',
            ],
            3,
          ],
          2,
        ],
        100,
      ])
    ).toBe(109);
  });

  test('the local function is defined in the body of the closure', () => {
    // y ↦ Block(k := 1, x ↦ Block(f := z ↦ z + k, y·x + f(x))):
    // 3·2 + (2 + 1)
    expect(
      json([
        'Apply',
        [
          'Apply',
          [
            'Function',
            [
              'Block',
              ['Assign', 'k', 1],
              [
                'Function',
                [
                  'Block',
                  ['Assign', 'f', ['Function', ['Add', 'z', 'k'], 'z']],
                  ['Add', ['Multiply', 'y', 'x'], ['f', 'x']],
                ],
                'x',
              ],
            ],
            'y',
          ],
          3,
        ],
        2,
      ])
    ).toBe(9);
  });

  test('evaluateAsync() gives the same value', async () => {
    expect(await jsonAsync(['Apply', ['Apply', withLocalFunction, 3], 2])).toBe(
      9
    );
  });
});

describe('a returned closure that defines and calls a local function', () => {
  test('the call of the local function is evaluated', () => {
    // 5 + 3
    expect(json(['Apply', ['Apply', innerLocalFunction, 1], 5])).toBe(8);
  });

  test('control: the inner literal applied directly', () => {
    expect(
      json([
        'Apply',
        [
          'Function',
          [
            'Block',
            ['Assign', 'g', ['Function', 3, 'z']],
            ['Add', 'x', ['g', 0]],
          ],
          'x',
        ],
        5,
      ])
    ).toBe(8);
  });

  test('the closure applied twice gives the value of each call', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'h', ['Apply', innerLocalFunction, 1]]).evaluate();
    expect(ce.box(['h', 5]).evaluate().json).toBe(8);
    expect(ce.box(['h', 7]).evaluate().json).toBe(10);
    expect(ce.box(['h', 5]).evaluate().json).toBe(8);
  });

  test('the local function reads the parameter of the outer call', () => {
    // w ↦ (x ↦ Block(g := z ↦ w·z, x + g(2))) applied to 10, then 5:
    // 5 + 10·2
    expect(
      json([
        'Apply',
        [
          'Apply',
          [
            'Function',
            [
              'Function',
              [
                'Block',
                ['Assign', 'g', ['Function', ['Multiply', 'w', 'z'], 'z']],
                ['Add', 'x', ['g', 2]],
              ],
              'x',
            ],
            'w',
          ],
          10,
        ],
        5,
      ])
    ).toBe(25);
  });

  test('the local function is defined in a nested block of the closure', () => {
    // w ↦ (x ↦ Block(g := z ↦ 0, If(x > 0, Block(g := z ↦ 3, x + g(0)), 0)))
    // `g` is assigned first at the block level, because a first assignment
    // in a branch is a static error.
    expect(
      json([
        'Apply',
        [
          'Apply',
          [
            'Function',
            [
              'Function',
              [
                'Block',
                ['Assign', 'g', ['Function', 0, 'z']],
                [
                  'If',
                  ['Greater', 'x', 0],
                  [
                    'Block',
                    ['Assign', 'g', ['Function', 3, 'z']],
                    ['Add', 'x', ['g', 0]],
                  ],
                  0,
                ],
              ],
              'x',
            ],
            'w',
          ],
          1,
        ],
        5,
      ])
    ).toBe(8);
  });

  test('evaluateAsync() gives the same value', async () => {
    expect(
      await jsonAsync(['Apply', ['Apply', innerLocalFunction, 1], 5])
    ).toBe(8);
  });
});
