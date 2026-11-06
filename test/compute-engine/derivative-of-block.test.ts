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
      ['Declare', 'k', "'unknown'", 2],
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
          ['Declare', 'a', "'unknown'", ['Sin', 'x']],
          ['Declare', 'b', "'unknown'", ['Multiply', 'a', 'a']],
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
          ['Declare', 'a', "'unknown'", 'x'],
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
        ['Block', ['Declare', 'k', "'unknown'", 2], ['Multiply', 'k', 'x']],
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
            ['Declare', 'c', "'unknown'", 5],
            ['Multiply', 'c', 'x'],
          ],
          'x',
        ],
      ],
    });
    expect(d(ce, ['D', ['Q', 't'], 't'])).toBe('5t');
  });

  test('an assignment to a name that only the block binds', () => {
    const ce = new ComputeEngine();
    const block = ['Block', ['Assign', 'q', 2], ['Multiply', 'q', 'x']];
    expect(d(ce, ['D', block, 'x'])).toBe('2');
    expect(ce.box('q').evaluate().toString()).toBe('q');
  });

  test('a free symbol of the value is in the scope of the caller', () => {
    const ce = new ComputeEngine();
    const block = ['Block', ['Assign', 'q', 2], ['Multiply', 'q', 'x', 'y']];
    const result = ce.box(['D', block, 'x'] as any).evaluate();
    const written = ce.box(['D', ['Multiply', 2, 'x', 'y'], 'x'] as any);
    expect(result.isSame(written.evaluate())).toBe(true);
    expect(result.add(ce.box('y')).simplify().toString()).toBe('3y');
  });

  test('stays unevaluated for an assignment to an outer symbol', () => {
    const ce = new ComputeEngine();
    ce.assign('q', 5);
    const block = ['Block', ['Assign', 'q', 2], ['Multiply', 'q', 'x']];
    const result = ce.box(['D', block, 'x'] as any).evaluate();
    expect(result.operator).toBe('D');
    expect(ce.box('q').evaluate().toString()).toBe('5');
  });

  test.each([
    [
      'a Sum index with the name of a local',
      [
        'Block',
        ['Declare', 'k', "'unknown'", 2],
        ['Sum', ['Multiply', 'k', 'x'], ['Limits', 'k', 1, 3]],
      ],
    ],
    [
      'a local function called by name',
      [
        'Block',
        ['Declare', 'f', "'unknown'", ['Function', ['Power', 't', 2], 't']],
        ['f', 'x'],
      ],
    ],
    [
      'a declaration with a type',
      [
        'Block',
        ['Declare', 'a', "'integer'", ['Sin', 'x']],
        ['Multiply', 'a', 'x'],
      ],
    ],
    [
      'a value that is not pure',
      [
        'Block',
        ['Declare', 'a', "'unknown'", ['Random']],
        ['Multiply', 'a', 'a', 'x'],
      ],
    ],
  ])('stays unevaluated for %s', (_, block) => {
    const ce = new ComputeEngine();
    const result = ce.box(['D', block, 'x'] as any).evaluate();
    expect(result.operator).toBe('D');
    // The outer symbol is not assigned by the attempt.
    expect(ce.box('q').evaluate().toString()).toBe('q');
  });
});
