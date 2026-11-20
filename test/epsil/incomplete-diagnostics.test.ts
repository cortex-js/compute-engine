import { parseEpsil } from '../../src/epsil/parse-epsil';

//
// The `incomplete` flag of a parse diagnostic (CE-1522): the parser reached
// the end of the input before the construct was complete, so more text at
// the end of the source can remove the error. An editor waits before it shows
// such a diagnostic on the line being typed.
//

/** Each diagnostic of `source` as `code` or `code (incomplete)`. */
function flagsOf(source: string): string[] {
  return parseEpsil(source)[1].map((d) => {
    const code = typeof d.message === 'string' ? d.message : d.message[0];
    return d.incomplete ? `${code} (incomplete)` : code;
  });
}

describe('EPSIL INCOMPLETE DIAGNOSTICS', () => {
  test.each([
    // An unclosed string, comment or LaTeX island.
    ['let s = "abc', ['string-literal-closing-delimiter-expected']],
    ['"abc" + "d', ['string-literal-closing-delimiter-expected']],
    ['let s = #"abc', ['string-literal-closing-delimiter-expected']],
    ['let m = """\n  abc', ['string-literal-closing-delimiter-expected']],
    ['let s = "', ['string-literal-opening-delimiter-expected']],
    ['/* note', ['end-of-comment-expected']],
    // An unclosed comment after code is an unexpected token.
    ['1 /* note', ['unexpected-symbol']],
    // An unclosed bracket, also before a comment.
    ['f(1', ['closing-bracket-expected']],
    ['f(1 // note', ['closing-bracket-expected']],
    ['[1, 2', ['closing-bracket-expected']],
    ['if x {', ['closing-bracket-expected']],
    // An operator without its right operand.
    ['let a = 1 +', ['unexpected-symbol']],
    ['let a = 3! +', ['unexpected-symbol']],
    ['let a = 1 ×', ['unexpected-symbol']],
    ['let a = 1 +\n', ['expression-expected']],
    ['xs |>', ['unexpected-symbol']],
    ['let a =', ['expression-expected']],
    ['for x in', ['expression-expected']],
    // A statement or a clause without its next part.
    ['if x', ['opening-bracket-expected']],
    ['do', ['opening-bracket-expected']],
    ['function f', ['opening-bracket-expected']],
    ['let', ['symbol-expected']],
    ['a.', ['symbol-expected']],
    ['x if c', ['conditional-else-expected']],
    ['if let x', ['if-let-equal-expected']],
    ['while let x', ['while-let-equal-expected']],
    ['protocol', ['protocol-name-expected']],
    ['match x { 1', ['match-case-arrow-expected', 'closing-bracket-expected']],
    // A type annotation that the input ended in.
    ['let x:', ['type-annotation-error']],
    ['let x: list<integer', ['type-annotation-error']],
    ['let x:  // note', ['type-annotation-error']],
    // An unclosed verbatim symbol.
    ['let s = `abc', ['unbalanced-verbatim-symbol']],
    // An unclosed hole at the end of the input.
    [
      'let s = "x \\(1 +',
      [
        'closing-bracket-expected',
        'string-literal-closing-delimiter-expected',
        'unexpected-symbol',
      ],
    ],
  ])('%j is incomplete', (source, codes) => {
    expect(flagsOf(source)).toEqual(codes.map((c) => `${c} (incomplete)`));
  });

  test.each([
    // The input continues after the construct.
    ['let a = 1 +\nlet b = 2', ['unexpected-symbol']],
    ['let s = "abc\nlet t = 1', ['string-literal-closing-delimiter-expected']],
    ['f(1]', ['closing-bracket-expected']],
    ['match x { 1 }', ['match-case-arrow-expected']],
    // More text at the end cannot remove the error.
    ['1 )', ['unexpected-symbol']],
    // A line break ended the string.
    ['let s = "abc\n', ['string-literal-closing-delimiter-expected']],
    // The pattern is closed.
    ['let ()', ['symbol-expected']],
    ['x @', ['unexpected-symbol']],
    // An infix operator where an operand starts.
    ['let a = *', ['expression-expected', 'unexpected-symbol']],
    ['let a = 1; *', ['unexpected-symbol']],
    ['return *', ['unexpected-symbol']],
    ['let a = not *', ['unexpected-symbol']],
    ['x |> |>', ['expression-expected', 'unexpected-symbol']],
    [
      'let s = `abc\nlet t = 1',
      ['unbalanced-verbatim-symbol', 'unexpected-symbol'],
    ],
    ['a = b = 5', ['chained-assignment']],
    ['x[0]', ['zero-index']],
    ['let x: Foo', ['type-annotation-error']],
  ])('%j is not incomplete', (source, codes) => {
    expect(flagsOf(source)).toEqual(codes);
  });

  test('a closed hole of an unclosed string is not incomplete', () => {
    expect(flagsOf('let s = "x \\(1 +) y')).toEqual([
      'string-literal-closing-delimiter-expected (incomplete)',
      'unexpected-symbol',
    ]);
  });

  test('a source without an error has no diagnostic', () => {
    expect(flagsOf('let s = "abc"\nf(1)')).toEqual([]);
  });
});
