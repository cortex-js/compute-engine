import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

// `Same` (`===`) and `IsSame` compare structure, and never read the value of
// a declared or assigned symbol. A name that a running call or binder binds
// (a function parameter, the index of `Sum`, a comprehension or a `Loop`)
// denotes its argument, as in the body of the literal applied to it
// (CE-1381, user decision 2026-11-17, option (a)).

function run(source: string): string | undefined {
  const ce = new ComputeEngine();
  const r = executeEpsil(ce, source);
  expect(r.diagnostics.map((d) => d.message)).toEqual([]);
  return r.value?.toString();
}

function evaluate(json: unknown): string {
  const ce = new ComputeEngine();
  return ce
    .box(json as any)
    .evaluate()
    .toString();
}

describe('A predicate written with === reads the parameter', () => {
  test.each([
    ['any([1, 2, 3], e => e === 2)', '"True"'],
    ['any([1, 2, 3], e => isSame(e, 2))', '"True"'],
    ['any([1, 2, 3], e => e === 5)', '"False"'],
    ['filter([1, 2, 3], e => e === 2)', '[2]'],
    ['find([1, 2, 3], e => e === 2)', '2'],
    ['map(e => e === 2, [1, 2, 3])', '["False","True","False"]'],
    ['let f = (e) => e === 2; f(2)', '"True"'],
    ['let g = (e, f) => e === f; g(2, 2)', '"True"'],
    ['let g = (e, f) => e === f; g(2, 3)', '"False"'],
    // A structure that holds the parameter compares with the argument in it
    ['let k = (e) => [1, e] === [1, 2]; k(2)', '"True"'],
    ['let m = 0; for x in [1, 2, 3] { if x === 2 { m = m + 1 } }; m', '1'],
    ['[k === 2 for k in 1..3]', '["False","True","False"]'],
    // A call of a parameter that holds a function is a call of the argument
    ['let g = (f) => f(t) === sin(t); g(sin)', '"True"'],
    ['let g = (f) => isSame(f(t), sin(t)); g(sin)', '"True"'],
    ['let g = (f) => f(t) === cos(t); g(sin)', '"False"'],
  ])('%s', (source, expected) => expect(run(source)).toBe(expected));
});

describe('=== still does not read a declared or assigned name', () => {
  test('let x = 5; x === 5', () =>
    expect(run('let x = 5\n(x == 5, x === 5)')).toBe('("True", "False")'));
  test('a parameter that receives a free symbol', () =>
    expect(run('let h = (e) => e === x; h(x)')).toBe('"True"'));
});

describe('MathJSON', () => {
  test.each([
    [
      ['Any', ['List', 1, 2, 3], ['Function', ['IsSame', 'e', 2], 'e']],
      '"True"',
    ],
    [
      ['Filter', ['List', 1, 2, 3], ['Function', ['IsSame', 'e', 2], 'e']],
      '[2]',
    ],
    [['Apply', ['Function', ['Same', 'e', 2], 'e'], 2], '"True"'],
    [['Apply', ['Function', ['Same', 'e', 'f'], 'e', 'f'], 2, 2], '"True"'],
    [['Sum', ['If', ['Same', 'k', 2], 1, 0], ['Limits', 'k', 1, 3]], '1'],
    [['Sum', ['If', ['IsSame', 'k', 2], 1, 0], ['Limits', 'k', 1, 3]], '1'],
    // Outside a call, a symbol is compared as written
    [['Same', 'e', 2], '"False"'],
    // An inner binder that binds the name again shadows the outer index
    [
      [
        'Sum',
        [
          'If',
          [
            'Same',
            ['Sum', 'k', ['Limits', 'k', 1, 2]],
            ['Sum', 2, ['Limits', 'k', 1, 2]],
          ],
          1,
          0,
        ],
        ['Limits', 'k', 1, 3],
      ],
      '0',
    ],
    // A raw `IsSame` operand that holds a scoped operator is compared as
    // written
    [
      [
        'Sum',
        [
          'If',
          [
            'IsSame',
            ['Sum', 'k', ['Limits', 'k', 1, 2]],
            ['Sum', 2, ['Limits', 'k', 1, 2]],
          ],
          1,
          0,
        ],
        ['Limits', 'k', 1, 3],
      ],
      '0',
    ],
    // ... and a parameter beside it is still replaced
    [
      [
        'Apply',
        [
          'Function',
          [
            'IsSame',
            ['List', 'x', ['Sum', 'k', ['Limits', 'k', 1, 2]]],
            ['List', 2, ['Sum', 'k', ['Limits', 'k', 1, 2]]],
          ],
          'x',
        ],
        2,
      ],
      '"True"',
    ],
  ])('%j', (json, expected) => expect(evaluate(json)).toBe(expected));
});

describe('LaTeX', () => {
  test.each([
    ['\\sum_{k=1}^{3} \\operatorname{If}(\\operatorname{Same}(k, 2), 1, 0)'],
    ['\\sum_{k=1}^{3} \\operatorname{If}(\\operatorname{IsSame}(k, 2), 1, 0)'],
  ])('%s', (latex) => {
    const ce = new ComputeEngine();
    expect(ce.parse(latex).evaluate().toString()).toBe('1');
  });
});
