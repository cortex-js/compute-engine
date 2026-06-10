import { tokenize } from '../../../src/compute-engine/latex-syntax/tokenizer';

// REVIEW.md C11: the `\csname` handler's leading space-skip loop and
// `#`-parameter expansion were dead code (`lex.peek()`/`lex.get()` return a
// single grapheme, which can never equal a multi-character token such as
// `<space>` or `#1`). Removing them is behavior-preserving — `\csname` builds
// a command from the tokens up to `\endcsname` (the inter-token space after
// `\csname` is already skipped by the lexer).
describe('\\csname tokenization (REVIEW.md C11)', () => {
  test('builds a command up to \\endcsname', () => {
    expect(tokenize('\\csname foo\\endcsname', [])).toEqual(['\\foo']);
    expect(tokenize('\\csname alpha\\endcsname x', [])).toEqual(['\\alpha', 'x']);
  });

  test('empty \\csname...\\endcsname yields no command', () => {
    expect(tokenize('\\csname\\endcsname', [])).toEqual([]);
  });

  test('surrounding tokens are preserved', () => {
    expect(tokenize('a\\csname b\\endcsname c', [])).toEqual(['a', '\\b', 'c']);
  });
});
