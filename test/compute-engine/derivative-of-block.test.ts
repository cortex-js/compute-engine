import { ComputeEngine } from '../../src/compute-engine';

// The derivative of a block of several statements is the derivative of its
// value: the last statement, with each local variable replaced by the value
// the statements before it assign. It stayed unevaluated before.

function d(ce: ComputeEngine, json: unknown): string {
  return ce
    .box(json as any)
    .evaluate()
    .toString();
}

describe('the derivative of a block with local variables', () => {
  test('a local assigned a constant', () => {
    const ce = new ComputeEngine();
    // Written `\frac{\mathrm{d}(k\coloneq2; kx)}{\mathrm{d}x}`; also the
    // canonical form of `D(x ↦ (k := 2; kx), x)`.
    const block = [
      'Block',
      ['Declare', 'k'],
      ['Assign', 'k', 2],
      ['Multiply', 'k', 'x'],
    ];
    expect(d(ce, ['D', block, 'x'])).toBe('2');
    expect(d(ce, ['D', ['Function', block, 'x'], 'x'])).toBe('2');
  });

  test('the parse route', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .parse(
          '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(k\\coloneq2; kx^2\\right)'
        )
        .evaluate()
        .toString()
    ).toBe('4x');
  });

  test('locals that depend on the variable and on each other', () => {
    const ce = new ComputeEngine();
    expect(
      d(ce, [
        'D',
        [
          'Block',
          ['Declare', 'a'],
          ['Declare', 'b'],
          ['Assign', 'a', ['Sin', 'x']],
          ['Assign', 'b', ['Multiply', 'a', 'a']],
          ['Add', 'b', 'x'],
        ],
        'x',
      ])
    ).toBe('2sin(x) * cos(x) + 1');
  });

  test('a local assigned twice has its last value', () => {
    const ce = new ComputeEngine();
    // a = 3x, so a² = 9x² and its derivative is 18x.
    expect(
      d(ce, [
        'D',
        [
          'Block',
          ['Declare', 'a'],
          ['Assign', 'a', 'x'],
          ['Assign', 'a', ['Multiply', 3, 'a']],
          ['Power', 'a', 2],
        ],
        'x',
      ])
    ).toBe('18x');
  });

  test('a local with the name of an assigned outer symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('k', 7);
    expect(
      d(ce, [
        'D',
        ['Block', ['Declare', 'k'], ['Assign', 'k', 2], ['Multiply', 'k', 'x']],
        'x',
      ])
    ).toBe('2');
    expect(ce.box('k').evaluate().toString()).toBe('7');
  });

  test('a user function whose body is a block', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto (m\\coloneq3; m x^2)'));
    expect(d(ce, ['D', ['g', 'x'], 'x'])).toBe('6x');
  });

  test('a local function does not take the value of an outer function', () => {
    const ce = new ComputeEngine();
    ce.assign('f', ce.parse('t \\mapsto t^3'));
    // The block's value is x², but its derivative must not be read as the
    // derivative of the outer f(x) = x³, which is 3x².
    const result = ce
      .parse(
        '\\frac{\\mathrm{d}}{\\mathrm{d}x}\\left(f\\coloneq t\\mapsto t^2; f(x)\\right)'
      )
      .evaluate();
    expect(result.toString()).not.toBe('3x^2');
  });

  test('a partial derivative given as a function literal with a block body', () => {
    const ce = new ComputeEngine();
    ce.declare('Q', {
      signature: '(number) -> number',
      derivative: [
        [
          'Function',
          [
            'Block',
            ['Declare', 'c'],
            ['Assign', 'c', 5],
            ['Multiply', 'c', 'x'],
          ],
          'x',
        ],
      ],
    });
    expect(d(ce, ['D', ['Q', 't'], 't'])).toBe('5t');
  });

  test.each([
    [
      'an assignment to a symbol the block does not declare',
      ['Block', ['Assign', 'q', 2], ['Multiply', 'q', 'x']],
    ],
    [
      'a local read before it is assigned',
      ['Block', ['Declare', 'a'], ['Multiply', 'a', 'x']],
    ],
    [
      'a Sum index with the name of a local',
      [
        'Block',
        ['Declare', 'k'],
        ['Assign', 'k', 2],
        ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 3]],
      ],
    ],
    [
      'a local function called by name',
      [
        'Block',
        ['Declare', 'f'],
        ['Assign', 'f', ['Function', ['Power', 't', 2], 't']],
        ['f', 'x'],
      ],
    ],
    [
      'a name read before it is declared',
      [
        'Block',
        ['Declare', 'b'],
        ['Assign', 'b', 'a'],
        ['Declare', 'a'],
        ['Assign', 'a', 2],
        ['Multiply', 'b', 'x'],
      ],
    ],
    [
      'a declaration with a type',
      [
        'Block',
        ['Declare', 'a', "'integer'"],
        ['Assign', 'a', ['Sin', 'x']],
        ['Multiply', 'a', 'x'],
      ],
    ],
    [
      'a value that is not pure',
      [
        'Block',
        ['Declare', 'a'],
        ['Assign', 'a', ['Random']],
        ['Multiply', 'a', 'a', 'x'],
      ],
    ],
    [
      'a local named like an object property, read before it is assigned',
      ['Block', ['Declare', 'toString'], ['Multiply', 'toString', 'x']],
    ],
  ])('stays unevaluated for %s', (_, block) => {
    const ce = new ComputeEngine();
    const result = ce.box(['D', block, 'x'] as any).evaluate();
    expect(result.operator).toBe('D');
    // The outer symbol is not assigned by the attempt.
    expect(ce.box('q').evaluate().toString()).toBe('q');
  });
});
