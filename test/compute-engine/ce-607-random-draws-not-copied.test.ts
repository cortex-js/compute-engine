import { ComputeEngine, expand } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json';

/**
 * A draw is one value. A rewrite that makes copies of a subexpression that
 * draws (`Random()`, or `r(t)` with `r` declared with the `random` effect)
 * turns one draw into several independent draws, and changes the
 * distribution of the result: `Expand((r(t) + 1)^2)` gave
 * `r(t)^2 + 2r(t) + 1`, three draws where the input has one.
 *
 * The expansion now asks `isMergeable()` (`boxed-expression/effects-of.ts`)
 * before it makes copies: a power of a sum with a term that draws is not
 * expanded, a factor that draws is not distributed over a sum, and a
 * denominator that draws is not distributed over the terms of the
 * numerator. The symbolic form of `Binomial(n, k)`, which has `k` copies of
 * `n`, is not made for an `n` that draws.
 *
 * The second group of tests is for the opposite defect: simplify rules that
 * read two occurrences of a draw as one value (the quotient of two
 * factorials, the `Binomial` form of `n!/(k!(n−k)!)`, and the logarithm
 * rules that compare the base of a logarithm with the base of a power).
 *
 * The assertions count the nodes of the draw head in the result, not the
 * values, which are random.
 *
 * Provenance: issue CE-607 (`issues/CE-607.md`, deleted by the fix); the
 * merge direction is tested in `ce-598-random-draws-not-merged.test.ts`.
 */

const ce = new ComputeEngine();
ce.declare('r', { signature: '(number) random -> number' });

/** The number of nodes with the operator `head` in a MathJSON expression. */
function countHead(json: unknown, head: string): number {
  if (!Array.isArray(json)) return 0;
  return (
    (json[0] === head ? 1 : 0) +
    json.slice(1).reduce((n: number, x: unknown) => n + countHead(x, head), 0)
  );
}

const rt: MathJsonExpression = ['r', 't'];
const R: MathJsonExpression = ['Random'];

describe('CE-607: an expansion does not copy a draw', () => {
  const cases: [string, MathJsonExpression, string][] = [
    ['(r(t) + 1)^2', ['Power', ['Add', rt, 1], 2], 'r'],
    ['(r(t) + x)^3', ['Power', ['Add', rt, 'x'], 3], 'r'],
    ['(r(t) + 1)^-2', ['Power', ['Add', rt, 1], -2], 'r'],
    ['(Random() + 1)^2', ['Power', ['Add', R, 1], 2], 'Random'],
    ['(2r(t) + 1)^2', ['Power', ['Add', ['Multiply', 2, rt], 1], 2], 'r'],
    ['r(t)·(x + 1)', ['Multiply', rt, ['Add', 'x', 1]], 'r'],
    [
      '(r(t) + 1)·(x + 1)',
      ['Multiply', ['Add', rt, 1], ['Add', 'x', 1]],
      'r',
    ],
    [
      '(x + 1)·(r(t) + 1)',
      ['Multiply', ['Add', 'x', 1], ['Add', rt, 1]],
      'r',
    ],
    [
      'r(t)·(x + 1)^2',
      ['Multiply', rt, ['Power', ['Add', 'x', 1], 2]],
      'r',
    ],
    ['(x + 1)/r(t)', ['Divide', ['Add', 'x', 1], rt], 'r'],
    ['(x + 1)/(r(t) + 1)', ['Divide', ['Add', 'x', 1], ['Add', rt, 1]], 'r'],
  ];

  test.each(cases)('Expand(%s) keeps one draw', (_, json, head) => {
    const result = ce.box(['Expand', json]).evaluate();
    expect(countHead(result.json, head)).toBe(1);
  });

  test.each(cases)('ExpandAll(%s) keeps one draw', (_, json, head) => {
    const result = ce.box(['ExpandAll', json]).evaluate();
    expect(countHead(result.json, head)).toBe(1);
  });

  test.each(cases)('expand(%s) keeps one draw', (_, json, head) => {
    expect(countHead(expand(ce.box(json)).json, head)).toBe(1);
  });

  test('the product of a draw and a sum by .mul() keeps one draw', () => {
    const result = ce.box(rt).mul(ce.parse('x+1'));
    expect(countHead(result.json, 'r')).toBe(1);
  });

  test('a sum with a draw is distributed over the terms that do not draw', () => {
    const result = ce
      .box(['Expand', ['Multiply', ['Add', rt, 1], ['Add', 'x', 1]]])
      .evaluate();
    expect(result.toString()).toBe('(x + 1) * r(t) + x + 1');
  });

  test.each([
    [
      'r(t)·(x + 1)·(y + 1)',
      ['Multiply', rt, ['Add', 'x', 1], ['Add', 'y', 1]],
      '(x * y + x + y + 1) * r(t)',
    ],
    [
      '(x + 1)·r(t)·(y + 1)',
      ['Multiply', ['Add', 'x', 1], rt, ['Add', 'y', 1]],
      '(x * y + x + y + 1) * r(t)',
    ],
    [
      '(r(t) + 1)·(x + 1)·(y + 1)',
      ['Multiply', ['Add', rt, 1], ['Add', 'x', 1], ['Add', 'y', 1]],
      '(x * y + x + y + 1) * r(t) + x * y + x + y + 1',
    ],
  ] as [string, MathJsonExpression, string][])(
    'the factors of %s that do not draw are expanded',
    (_, json, expected) => {
      const result = ce.box(['Expand', json]).evaluate();
      expect(result.toString()).toBe(expected);
      expect(countHead(result.json, 'r')).toBe(1);
    }
  );

  test('a product with matrices and a non-scalar factor that draws keeps one draw', () => {
    const me = new ComputeEngine();
    me.declare('A', 'matrix<2x2>');
    me.declare('B', 'matrix<2x2>');
    me.declare('C', 'matrix<2x2>');
    me.declare('D', 'matrix<2x2>');
    me.declare('r', { signature: '(number) random -> number' });
    const result = me
      .box([
        'Expand',
        [
          'Multiply',
          ['Add', 'A', 'B'],
          ['Add', 'C', ['Multiply', ['r', 't'], 'D']],
        ],
      ])
      .evaluate();
    expect(countHead(result.json, 'r')).toBe(1);
  });

  test('a scalar factor that draws in a product with matrices is not copied', () => {
    const me = new ComputeEngine();
    me.declare('A', 'matrix<2x2>');
    me.declare('B', 'matrix<2x2>');
    me.declare('C', 'matrix<2x2>');
    me.declare('r', { signature: '(number) random -> number' });
    const result = me
      .box(['Expand', ['Multiply', 'A', ['Add', 'B', 'C'], ['r', 't']]])
      .evaluate();
    expect(countHead(result.json, 'r')).toBe(1);
  });

  test('Binomial(r(t), 2) keeps one draw', () => {
    const result = ce.box(['Binomial', rt, 2]).evaluate();
    expect(countHead(result.json, 'r')).toBe(1);
  });
});

describe('CE-607: a pure expression is expanded as before', () => {
  test.each([
    ['(x + 1)^2', ['Power', ['Add', 'x', 1], 2], 'x^2 + 2x + 1'],
    ['g(t)·(x + 1)', ['Multiply', ['g', 't'], ['Add', 'x', 1]], 'x * g(t) + g(t)'],
    ['(x + 1)/y', ['Divide', ['Add', 'x', 1], 'y'], 'x / y + 1 / y'],
  ] as [string, MathJsonExpression, string][])(
    'Expand(%s)',
    (_, json, expected) => {
      expect(ce.box(['Expand', json]).evaluate().toString()).toBe(expected);
    }
  );

  test('Binomial(n, 2) gives the falling-factorial form', () => {
    expect(ce.box(['Binomial', 'n', 2]).evaluate().toString()).toBe(
      '(n * (n - 1)) / 2'
    );
  });
});

describe('CE-607: simplify() does not read two draws as one value', () => {
  const cases: [string, MathJsonExpression, number][] = [
    [
      'r(t)!/(r(t) − 1)!',
      ['Divide', ['Factorial', rt], ['Factorial', ['Subtract', rt, 1]]],
      2,
    ],
    [
      'r(t)!/(k!·(r(t) − k)!)',
      [
        'Divide',
        ['Factorial', rt],
        ['Multiply', ['Factorial', 'k'], ['Factorial', ['Subtract', rt, 'k']]],
      ],
      2,
    ],
    ['log_r(t)(r(t)^x·y)', ['Log', ['Multiply', ['Power', rt, 'x'], 'y'], rt], 2],
    ['log_r(t)(r(t)^x/y)', ['Log', ['Divide', ['Power', rt, 'x'], 'y'], rt], 2],
    ['log_r(t)(y/r(t)^x)', ['Log', ['Divide', 'y', ['Power', rt, 'x']], rt], 2],
    ['r(t)^log_r(t)(x)', ['Power', rt, ['Log', 'x', rt]], 2],
    [
      'r(t)^(log_r(t)(x) + y)',
      ['Power', rt, ['Add', ['Log', 'x', rt], 'y']],
      2,
    ],
    [
      'r(t)^(log_r(t)(x)·y)',
      ['Power', rt, ['Multiply', ['Log', 'x', rt], 'y']],
      2,
    ],
    [
      'r(t)^(log_r(t)(x)/y)',
      ['Power', rt, ['Divide', ['Log', 'x', rt], 'y']],
      2,
    ],
  ];

  test.each(cases)('%s keeps its draws', (_, json, draws) => {
    expect(countHead(ce.box(json).simplify().json, 'r')).toBe(draws);
  });

  test.each([
    [
      'n!/(n − 1)!',
      ['Divide', ['Factorial', 'n'], ['Factorial', ['Subtract', 'n', 1]]],
      'n',
    ],
    ['c^log_c(x)', ['Power', 'c', ['Log', 'x', 'c']], 'x'],
    ['log_c(c^x·y)', ['Log', ['Multiply', ['Power', 'c', 'x'], 'y'], 'c'], 'x + log(y, c)'],
  ] as [string, MathJsonExpression, string][])(
    'the pure form %s still simplifies',
    (_, json, expected) => {
      expect(ce.box(json).simplify().toString()).toBe(expected);
    }
  );
});
