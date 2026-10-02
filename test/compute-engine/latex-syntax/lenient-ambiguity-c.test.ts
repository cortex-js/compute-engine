import { ComputeEngine } from '../../../src/compute-engine';
import type { ParseDiagnostic } from '../../../src/compute-engine';

// The lenient grammar reports each reading that has a second common reading
// with a diagnostic whose code starts with `ambiguous-`. This file covers:
// the four renamed codes, the `onAmbiguity` parse option, the reading of a
// name in parentheses before a group, the lenient `+-` and `-+` signs, and
// the `ambiguous-sign` code.
// Design: docs/plans/2026-10-01-lenient-ambiguity-codes.md.

const ce = new ComputeEngine();

const lenient = { strict: false } as const;

function json(latex: string, options: Record<string, unknown> = {}): unknown {
  return ce.parse(latex, options).json;
}

function ambiguous(
  latex: string,
  options: Record<string, unknown> = lenient
): ParseDiagnostic[] {
  return (
    ce.parse(latex, { ...options, diagnostics: true }).parseDiagnostics ?? []
  ).filter((d) => d.code.startsWith('ambiguous-'));
}

function codes(latex: string, options: Record<string, unknown> = lenient) {
  return ambiguous(latex, options).map((d) => d.code);
}

const error = (code: string, latex: string) => [
  'Error',
  `'${code}'`,
  ['LatexString', `'${latex}'`],
];

describe('the renamed codes', () => {
  test.each([
    ['eps', 'ambiguous-letter-run'],
    ['1/2x', 'ambiguous-denominator'],
    ['2 3', 'ambiguous-digit-groups'],
    ['x.5', 'ambiguous-letter-decimal'],
  ])('%s reports %s', (latex, code) => {
    const ds = ce.parse(latex, {
      ...lenient,
      diagnostics: true,
    }).parseDiagnostics!;
    expect(ds.map((d) => d.code)).toContain(code);
    for (const old of [
      'letter-run-split',
      'implicit-product-in-denominator',
      'spaced-digit-groups',
      'letter-before-decimal',
    ])
      expect(ds.map((d) => d.code)).not.toContain(old);
  });
});

describe('onAmbiguity', () => {
  const asError = { ...lenient, onAmbiguity: 'error' } as const;

  test.each([
    ['eps', error('ambiguous-letter-run', 'eps')],
    [
      'y = eps + 1',
      ['Equal', 'y', ['Add', error('ambiguous-letter-run', 'eps'), 1]],
    ],
    ['1/2x', ['Divide', 1, error('ambiguous-denominator', '2x')]],
    ['y = 2 3', ['Equal', 'y', error('ambiguous-digit-groups', '2 3')]],
    [
      'y = x.5 + 1',
      ['Equal', 'y', ['Add', error('ambiguous-letter-decimal', '.5'), 1]],
    ],
  ])(
    "'error' replaces the smallest expression that holds the span: %s",
    (latex, expected) => {
      expect(ce.parse(latex, { ...asError, form: 'raw' }).json).toEqual(
        expected
      );
    }
  );

  test("'error' works without `diagnostics: true`, and with it", () => {
    const without = ce.parse('y = 2 3', asError);
    expect(without.parseDiagnostics).toBeUndefined();
    expect(without.json).toEqual([
      'Equal',
      'y',
      error('ambiguous-digit-groups', '2 3'),
    ]);

    const withDiagnostics = ce.parse('y = 2 3', {
      ...asError,
      diagnostics: true,
    });
    expect(withDiagnostics.json).toEqual(without.json);
    expect(withDiagnostics.parseDiagnostics!.map((d) => d.code)).toContain(
      'ambiguous-digit-groups'
    );
  });

  test("'error' does not report the other diagnostic codes", () => {
    // `undeclared-symbol` is not an `ambiguous-*` code: it does not make an
    // error, and without `diagnostics: true` nothing is reported.
    expect(json('x + 1', asError)).toEqual(['Add', 'x', 1]);
    expect(ce.parse('x + 1', asError).parseDiagnostics).toBeUndefined();
  });

  test("'error' matches every code that starts with `ambiguous-`", () => {
    // `ambiguous-sign` is not one of the four renamed codes.
    expect(json('y = --x', asError)).toEqual([
      'Equal',
      'y',
      error('ambiguous-sign', '--'),
    ]);
  });

  test('each diagnostic replaces its own expression', () => {
    expect(json('sinx + 1/2x', { ...asError, form: 'raw' })).toEqual([
      'Add',
      error('ambiguous-letter-run', 'sinx'),
      ['Divide', 1, error('ambiguous-denominator', '2x')],
    ]);
  });

  test('when a number is not the only operand with its value, the parent is replaced', () => {
    // The two operands `23` cannot be told apart, so the sum is replaced.
    expect(json('y = 2 3 + 23', asError)).toEqual([
      'Equal',
      'y',
      error('ambiguous-digit-groups', '2 3'),
    ]);
  });

  test('a number that also occurs in another operand is not mistaken for it', () => {
    // The diagnostic is on the `2 3` inside `g(…)`. The first operand of the
    // sum has the same value, 23, but it is not replaced.
    expect(json('y = 23 + g(2 3)', { ...asError, form: 'raw' })).toEqual([
      'Equal',
      'y',
      [
        'Add',
        23,
        [
          'InvisibleOperator',
          'g',
          ['Delimiter', error('ambiguous-digit-groups', '2 3')],
        ],
      ],
    ]);
    // `ο` (a Greek omicron) is the index and the body of the sum. Each
    // occurrence is reported, and neither can be told apart from the other,
    // so the whole sum is replaced.
    expect(json('\\sum_{ο=1}^n ο', { ...asError, form: 'raw' })).toEqual(
      error('ambiguous-lookalike-letter', 'ο')
    );
  });

  // The codes that a check of the whole line finds, one input for each.
  test.each([
    ['5!=120', error('ambiguous-factorial', '!=')],
    ['x <- 2', error('ambiguous-arrow', '<-')],
    ['x = x = x', error('ambiguous-equal-chain', '= x =')],
    ['y = x in [0,1]', error('ambiguous-element', 'in')],
    ['1..10..2', error('ambiguous-range', '..10..')],
    [
      'y = x^2 (2)',
      [
        'Equal',
        'y',
        [
          'InvisibleOperator',
          ['Power', 'x', 2],
          error('ambiguous-equation-number', '(2)'),
        ],
      ],
    ],
    ['1,5', error('ambiguous-comma', ',')],
    ['(1)', error('ambiguous-list-label', '(1)')],
    ['1_000', error('ambiguous-number-notation', '1_000')],
    ['2026-10-15', error('ambiguous-date', '2026-10-15')],
    ['y = 50%', ['Equal', 'y', error('ambiguous-percent', '50')]],
  ])("'error' applies to the line code of %s", (latex, expected) => {
    expect(json(latex, { ...asError, form: 'raw' })).toEqual(expected);
    // The same with `diagnostics: true`
    expect(
      ce.parse(latex, { ...asError, form: 'raw', diagnostics: true }).json
    ).toEqual(expected);
  });

  test("the default, 'report', keeps the reading", () => {
    for (const latex of ['eps', '1/2x', 'y = 2 3', 'x.5', '--x']) {
      const expected = json(latex, lenient);
      expect(json(latex, { ...lenient, onAmbiguity: 'report' })).toEqual(
        expected
      );
      expect(JSON.stringify(expected)).not.toContain('ambiguous-');
    }
  });

  test('the option has no effect in strict mode', () => {
    for (const latex of ['1/2x', 'y = 2 3', 'x - -y', 'x = \\pm 1'])
      expect(json(latex, { strict: true, onAmbiguity: 'error' })).toEqual(
        json(latex, { strict: true })
      );
  });
});

describe('a name in parentheses is a factor, not a function head', () => {
  test.each([true, false])('strict: %s', (strict) => {
    const local = new ComputeEngine();
    const parse = (latex: string) => local.parse(latex, { strict }).json;
    expect(parse('(k)(x-1)')).toEqual(['Multiply', 'k', ['Add', 'x', -1]]);
    expect(parse('(a)(b)')).toEqual(['Multiply', 'a', 'b']);
    expect(parse('y=(m)(x)+b')).toEqual([
      'Equal',
      'y',
      ['Add', ['Multiply', 'm', 'x'], 'b'],
    ]);
    expect(parse('2(p)(q)')).toEqual(['Multiply', 2, 'p', 'q']);
  });

  test('a name without parentheses keeps the application rules', () => {
    const local = new ComputeEngine();
    expect(local.parse('k(x-1)').json).toEqual(['k', ['Add', 'x', -1]]);
  });

  test('a function inferred from an earlier use is still a factor', () => {
    const local = new ComputeEngine();
    local.parse('h(x)');
    expect(local.parse('(h)(x)').json).toEqual(['Multiply', 'h', 'x']);
  });

  test('a declared function in parentheses is still applied', () => {
    const local = new ComputeEngine();
    local.declare('f', '(number) -> number');
    expect(local.parse('(f)(x)').json).toEqual(['f', 'x']);
    expect(local.parse('(\\sin)(x)').json).toEqual(['Sin', 'x']);
  });
});

describe('lenient `+-` and `-+`', () => {
  test('`+-` is `±`', () => {
    const expected = ['Equal', 'x', ['Measurement', 2, 0.1]];
    expect(json('x = 2 +- 0.1', lenient)).toEqual(expected);
    expect(json('x = 2 ± 0.1', lenient)).toEqual(expected);
    expect(json('x = 2\\pm 0.1')).toEqual(expected);
    // `+-` binds as `±` does.
    expect(json('a + b +- c', { ...lenient, form: 'raw' })).toEqual(
      json('a + b \\pm c', { form: 'raw' })
    );
  });

  test('`-+` is `∓`', () => {
    expect(json('a -+ b', lenient)).toEqual(['MinusPlus', 'a', 'b']);
    expect(json('a\\mp b')).toEqual(['MinusPlus', 'a', 'b']);
    expect(json('a -+ b + c', { ...lenient, form: 'raw' })).toEqual(
      json('a \\mp b + c', { form: 'raw' })
    );
  });

  test('a prefix `+-` is a prefix `±`', () => {
    expect(json('y = +-sqrt(x)', { ...lenient, form: 'raw' })).toEqual([
      'Equal',
      'y',
      ['Measurement', 0, ['Sqrt', 'x']],
    ]);
  });

  test('a prefix `-+` is a prefix `∓`', () => {
    expect(json('x = -+1', { ...lenient, form: 'raw' })).toEqual([
      'Equal',
      'x',
      ['MinusPlus', 0, 1],
    ]);
    expect(json('-+x', { ...lenient, form: 'raw' })).toEqual(
      json('∓x', { ...lenient, form: 'raw' })
    );
  });

  test('a prefix `∓` is `MinusPlus(0, …)` in both grammars', () => {
    for (const strict of [true, false]) {
      expect(json('x = ∓1', { strict, form: 'raw' })).toEqual([
        'Equal',
        'x',
        ['MinusPlus', 0, 1],
      ]);
      expect(json('x = \\mp 1', { strict, form: 'raw' })).toEqual([
        'Equal',
        'x',
        ['MinusPlus', 0, 1],
      ]);
    }
    // The infix `∓` does not change
    expect(json('a \\mp b', { form: 'raw' })).toEqual(['MinusPlus', 'a', 'b']);
  });

  test('strict mode reads `+` then `-`', () => {
    expect(json('x = 2 +- 0.1', { strict: true })).toEqual([
      'Equal',
      'x',
      ['Add', 2, -0.1],
    ]);
    expect(json('a -+ b', { strict: true, form: 'raw' })).toEqual([
      'Subtract',
      'a',
      'b',
    ]);
  });
});

describe('ambiguous-sign', () => {
  test.each([
    ['x = ±1', 4, 5, '±'],
    ['x = \\pm 1', 4, 7, '\\pm'],
    ['y = +-sqrt(x)', 4, 6, '+-'],
    ['--x', 0, 2, '--'],
    ['x - -y', 2, 5, '--'],
    ['a<--b', 2, 4, '--'],
    ['a + -b', 2, 5, '+-'],
    ['a - +b', 2, 5, '-+'],
    ['-+x', 0, 2, '-+'],
    ['a -+ b', 2, 4, '-+'],
    ['x = ∓1', 4, 5, '∓'],
    ['x = \\mp 1', 4, 7, '\\mp'],
    ['x = -+1', 4, 6, '-+'],
  ])('%s is reported', (latex, start, end, signs) => {
    // `a<--b` also reports `ambiguous-arrow` for its `<-`; only the sign
    // code is checked here.
    expect(ambiguous(latex).filter((d) => d.code === 'ambiguous-sign')).toEqual(
      [{ code: 'ambiguous-sign', start, end, detail: { signs } }]
    );
  });

  test.each([
    'a+-b',
    'x = 2 +- 0.1',
    'y = +x',
    'x - (-y)',
    '2*-3',
    'x^-2',
    'a-b',
  ])('%s is not reported', (latex) => {
    expect(codes(latex)).not.toContain('ambiguous-sign');
  });

  test('the strict grammar reports nothing', () => {
    for (const latex of [
      'x = \\pm 1',
      'x = \\mp 1',
      'x = ∓1',
      '--x',
      'x - -y',
      'a + -b',
    ])
      expect(codes(latex, { strict: true })).toEqual([]);
  });

  test('the code does not change the reading', () => {
    for (const latex of ['x = ±1', '--x', 'x - -y', 'a<--b', 'a + -b', '-+x'])
      expect(
        ce.parse(latex, { ...lenient, diagnostics: true, form: 'raw' }).json
      ).toEqual(json(latex, { ...lenient, form: 'raw' }));
    expect(json('--x', { ...lenient, form: 'raw' })).toEqual([
      'Negate',
      ['Negate', 'x'],
    ]);
    expect(json('a + -b', { ...lenient, form: 'raw' })).toEqual([
      'Add',
      'a',
      ['Negate', 'b'],
    ]);
  });
});
