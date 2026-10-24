import { ComputeEngine } from '../../src/compute-engine';

/**
 * A `Return` in the body of `Sum`, `Product`, `Integrate` or `D` is the
 * `return-in-expression-body` error: the body is an expression, not a
 * statement block, so the `Return` has no function to end. Before, it stayed
 * in the value (`Sum(1 + Return("q"), (k, 1, 2))` was `2 + 2Return("q")`).
 * User decision of 2026-10-23, ROADMAP CE-96.
 */
const ce = new ComputeEngine();

function errorOf(json: unknown): string {
  return ce
    .box(json as never)
    .evaluate()
    .toString();
}

describe('a Return in the body of an operator that takes an expression', () => {
  test('Sum and Product refuse it', () => {
    const sum = ce.box([
      'Sum',
      ['Add', 1, ['Return', { str: 'q' }]],
      ['Limits', 'k', 1, 2],
    ]);
    expect(sum.isValid).toBe(false);
    expect(sum.evaluate().toString()).toBe(
      'Error(ErrorCode("return-in-expression-body", "Sum"))'
    );
    expect(errorOf(['Product', ['Return', 'k'], ['Limits', 'k', 1, 3]])).toBe(
      'Error(ErrorCode("return-in-expression-body", "Product"))'
    );
  });

  test('Integrate and D refuse it', () => {
    expect(errorOf(['Integrate', ['Return', 'x'], ['Limits', 'x', 0, 1]])).toBe(
      'Error(ErrorCode("return-in-expression-body", "Integrate"))'
    );
    expect(errorOf(['Integrate', ['Return', 'x'], 'x'])).toBe(
      'Error(ErrorCode("return-in-expression-body", "Integrate"))'
    );
    expect(errorOf(['D', ['Return', ['Power', 'x', 2]], 'x'])).toBe(
      'Error(ErrorCode("return-in-expression-body", "D"))'
    );
  });

  test('ND, NIntegrate, Limit and NLimit refuse it', () => {
    for (const [json, op] of [
      [['ND', ['Return', 'k'], 'x'], 'ND'],
      [['NIntegrate', ['Return', 'x'], 0, 1], 'NIntegrate'],
      [['Limit', ['Return', 'k'], 'k', 0], 'Limit'],
      [['NLimit', ['Return', 'x'], 0], 'NLimit'],
    ] as const)
      expect(errorOf(json)).toBe(
        `Error(ErrorCode("return-in-expression-body", "${op}"))`
      );
  });

  test('a Return in a bound or a variable is refused too', () => {
    expect(
      ce.box(['Sum', 'k', ['Limits', 'k', 1, ['Return', 3]]]).isValid
    ).toBe(false);
    expect(ce.box(['D', ['Power', 'x', 2], ['Return', 'x']]).isValid).toBe(
      false
    );
  });

  test('the body is read before a canonical fold removes the Return', () => {
    // `0·2·Return(k)` folds to 0 when it is canonicalized.
    expect(
      ce.box([
        'Sum',
        ['Multiply', 0, 2, ['Return', 'k']],
        ['Limits', 'k', 1, 3],
      ]).isValid
    ).toBe(false);
  });

  test('a Return in a branch, a block or a nested Sum is refused', () => {
    for (const body of [
      ['If', ['Greater', 'k', 1], ['Return', 'k'], 'k'],
      ['Block', ['Return', 'k']],
      ['Sum', ['Return', 'j'], ['Limits', 'j', 1, 2]],
    ])
      expect(ce.box(['Sum', body, ['Limits', 'k', 1, 3]]).isValid).toBe(false);
  });

  test('the ce.function route gives the same error', () => {
    const raw = (json: unknown) => ce.box(json as never, { form: 'raw' });
    expect(
      ce.function('Sum', [raw(['Return', 'k']), raw(['Limits', 'k', 1, 3])])
        .isValid
    ).toBe(false);
    expect(
      ce.function('Integrate', [
        raw(['Return', 'x']),
        raw(['Limits', 'x', 0, 1]),
      ]).isValid
    ).toBe(false);
  });

  test('a held Return is data, not a statement', () => {
    expect(
      errorOf([
        'Sum',
        ['Block', ['Hold', ['Return', 'k']], 1],
        ['Limits', 'k', 1, 3],
      ])
    ).toBe('3');
  });

  test('a call of a function value named Return is allowed', () => {
    const engine = new ComputeEngine();
    engine.declare('Return', '() -> real');
    expect(engine.box(['Sum', ['Return'], ['Limits', 'k', 1, 3]]).isValid).toBe(
      true
    );
  });

  test('the parse route gives the same error', () => {
    expect(ce.parse('\\sum_{k=1}^{3} \\operatorname{Return}(k)').isValid).toBe(
      false
    );
  });

  test('a function that holds such a Sum is invalid', () => {
    const f = ce.box([
      'Function',
      [
        'Block',
        [
          'Add',
          1,
          [
            'Sum',
            ['Multiply', 2, ['Return', { str: 'q' }]],
            ['Limits', 'k', 1, 2],
          ],
        ],
      ],
      'x',
    ]);
    expect(f.isValid).toBe(false);
  });

  test('a Return inside a function literal of the body ends that function', () => {
    const sum = ce.box([
      'Sum',
      [
        'Apply',
        ['Function', ['Block', ['Return', ['Multiply', 2, 'x']]], 'x'],
        'k',
      ],
      ['Limits', 'k', 1, 3],
    ]);
    expect(sum.isValid).toBe(true);
    expect(sum.evaluate().toString()).toBe('12');
  });

  test('a body without Return is unchanged', () => {
    expect(errorOf(['Sum', 'k', ['Limits', 'k', 1, 3]])).toBe('6');
    expect(errorOf(['Integrate', 'x', ['Limits', 'x', 0, 1]])).toBe('1/2');
    expect(errorOf(['D', ['Power', 'x', 2], 'x'])).toBe('2x');
  });
});

describe('Limit of a function literal whose body is a Return (CE-400)', () => {
  test('the Return ends the literal with its value', () => {
    expect(errorOf(['Limit', ['Function', ['Return', 'x'], 'x'], 0])).toBe('0');
    expect(
      errorOf([
        'Limit',
        ['Function', ['Block', ['Return', ['Add', 'x', 1]]], 'x'],
        0,
      ])
    ).toBe('1');
  });

  test('the LaTeX route gives the same value', () => {
    expect(
      ce.parse('\\lim_{x\\to 0}\\operatorname{Return}(x)').evaluate().toString()
    ).toBe('0');
  });

  test('a Return in a branch is not read: the limit stays', () => {
    const r = ce
      .box([
        'Limit',
        [
          'Function',
          ['If', ['Greater', 'x', 0], ['Return', 1], ['Return', 2]],
          'x',
        ],
        3,
      ])
      .evaluate();
    expect(r.operator).toBe('Limit');
  });
});
