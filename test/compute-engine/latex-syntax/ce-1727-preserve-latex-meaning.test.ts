import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ComputeEngine } from '../../../src/compute-engine';
import type { MathJsonExpression } from '../../../src/math-json/types';

// CE-1727: `preserveLatex` adds the LaTeX of each node after the parse, so
// that a parselet sees the same nodes with and without the option, and the
// option does not change the meaning of the result.

const ce = new ComputeEngine();

/** `expr` without its `latex` keys, with each object that holds only a
 * number, a symbol, a string or a function written in its short form. */
function withoutLatex(expr: unknown): unknown {
  if (Array.isArray(expr)) return expr.map(withoutLatex);
  if (typeof expr !== 'object' || expr === null) return expr;
  const rest: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(expr))
    if (key !== 'latex') rest[key] = withoutLatex(value);
  const keys = Object.keys(rest);
  if (keys.length === 1) {
    if (keys[0] === 'fn' || keys[0] === 'sym') return rest[keys[0]];
    if (keys[0] === 'str') return `'${rest.str}'`;
    if (keys[0] === 'num') return Number(rest.num);
  }
  return rest;
}

function parse(
  latex: string,
  preserveLatex: boolean,
  options: Record<string, unknown> = {}
): unknown {
  return ce.latexSyntax!.parse(latex, { ...options, preserveLatex });
}

describe('CE-1727: preserveLatex does not change the meaning', () => {
  test.each([
    [String.raw`\log_{2} 3`, ['Lb', 3]],
    [String.raw`\mathbb{R}^{+}`, 'PositiveNumbers'],
    [
      String.raw`\{a_n\}_{n=1}^{\infty}`,
      ['IndexedSequence', ['a_', 'n'], 'n', 1, 'PositiveInfinity'],
    ],
  ])('%s', (latex, expected) => {
    expect(withoutLatex(parse(latex, true))).toEqual(expected);
    expect(parse(latex, false)).toEqual(expected);
  });

  test('the fragments of the MathNet parser corpus', () => {
    const corpus = JSON.parse(
      readFileSync(
        join(__dirname, '../../../docs/mathnet/parser-test-cases.json'),
        'utf8'
      )
    ) as { fragments: { latex: string }[] };
    const different = corpus.fragments
      .map(({ latex }) => latex)
      .filter(
        (latex) =>
          JSON.stringify(withoutLatex(parse(latex, true))) !==
          JSON.stringify(withoutLatex(parse(latex, false)))
      );
    expect(different).toEqual([]);
  });

  // The LaTeX is added before the passes that find a node by identity: an
  // application candidate, a continuation range, an ambiguity error, the
  // retry without trailing punctuation.
  test.each([
    ['{}', {}],
    ['resolveApplication', { resolveApplication: () => 'apply' }],
    ['onAmbiguity', { strict: false, onAmbiguity: 'error' }],
  ])('with the options %s', (_name, options) => {
    for (const latex of [
      'f(x)+g(x)^2',
      'a(b+c)',
      'n+1..n+10',
      '[0, 15...210]',
      '2 3',
      '-x^2',
      'x = y + z.',
      String.raw`\sum_{n=1}^{100} a_n^2?`,
    ])
      expect([latex, withoutLatex(parse(latex, true, options))]).toEqual([
        latex,
        withoutLatex(parse(latex, false, options)),
      ]);
  });
});

describe('CE-1727: the LaTeX of each node', () => {
  test('a function, its operands, and the verbatim input at the root', () => {
    expect(parse(String.raw`\log_{2} 3`, true)).toEqual({
      latex: String.raw`\log_{2} 3`,
      fn: ['Lb', { latex: '3', num: '3' }],
    });
    expect(parse(String.raw`\mathbb{R}^{+}`, true)).toEqual({
      latex: String.raw`\mathbb{R}^{+}`,
      sym: 'PositiveNumbers',
    });
  });

  test('two occurrences of a symbol', () => {
    expect(parse('x+x^2', true)).toEqual({
      latex: 'x+x^2',
      fn: [
        'Add',
        { latex: 'x', sym: 'x' },
        {
          latex: 'x^2',
          fn: ['Power', { latex: 'x', sym: 'x' }, 2],
        },
      ],
    });
  });

  test('a symbol that a parselet uses twice', () => {
    expect(parse('|N| = n > 2', true)).toMatchObject({
      fn: [
        'And',
        ['Equal', { latex: '|N|' }, { latex: 'n', sym: 'n' }],
        ['Greater', { latex: 'n', sym: 'n' }, { latex: '2', num: '2' }],
      ],
    });
  });

  test('two spellings of a symbol are not paired', () => {
    // The body of the sum comes before its index in the tree, not in the
    // source.
    const json = parse(String.raw`\sum_{\alpha=1}^3 α`, true) as {
      fn: MathJsonExpression[];
    };
    expect(json.fn[1]).toBe('alpha');
  });

  test('a node that a parselet rebuilt keeps its LaTeX', () => {
    // The term of the sequence is rebuilt to bind the index.
    const json = parse(String.raw`\{c_i = a_i + b_{i+s}\}_{i=1}^m`, true) as {
      fn: MathJsonExpression[];
    };
    expect(json.fn[0]).toBe('IndexedSequence');
    expect(json.fn[1]).toMatchObject({ latex: 'c_i = a_i + b_{i+s}' });
    const lifted = parse(String.raw`\{a_n\}_{n=1}^{\infty}`, true) as {
      fn: MathJsonExpression[];
    };
    expect(lifted.fn[1]).toEqual({ latex: 'a_n', fn: ['a_', 'n'] });
  });
});
