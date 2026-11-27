import { parseEpsil } from '../../src/epsil/parse-epsil';
import { epsilDiagnosticMessage } from '../../src/epsil/diagnostic-message';

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
    ['1 /* note', ['end-of-comment-expected']],
    // An unclosed bracket, also before a comment.
    ['f(1', ['closing-bracket-expected']],
    ['f(1 // note', ['closing-bracket-expected']],
    ['[1, 2', ['closing-bracket-expected']],
    ['if x {', ['closing-bracket-expected']],
    ['let d = { ', ['dictionary-entry-expected', 'closing-bracket-expected']],
    [
      'let d = {a -> 1, ',
      ['dictionary-entry-expected', 'closing-bracket-expected'],
    ],
    [
      'plot(sin(x), { ',
      [
        'dictionary-entry-expected',
        'closing-bracket-expected',
        'closing-bracket-expected',
      ],
    ],
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

  test('a dictionary value still expects an expression', () => {
    expect(flagsOf('let d = {a -> ')).toContain('expression-expected (incomplete)');
    expect(flagsOf('let d = {a -> ')).not.toContain(
      'dictionary-entry-expected (incomplete)'
    );
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

  // A call or a list that ends after its opening bracket or after a comma
  // misses an expression, and a `for` that ends after its variable misses
  // its `in` (CE-1630). The end of the input is not an unexpected symbol.
  test.each([
    ['[1,', ['expression-expected', 'closing-bracket-expected']],
    ['[', ['expression-expected', 'closing-bracket-expected']],
    ['f(', ['expression-expected', 'closing-bracket-expected']],
    ['f(1,', ['expression-expected', 'closing-bracket-expected']],
    ['f(\n', ['expression-expected', 'closing-bracket-expected']],
    ['let f = (', ['expression-expected', 'closing-bracket-expected']],
    ['for x', ['literal-expected']],
  ])('%j misses an expression or a keyword', (source, codes) => {
    expect(flagsOf(source)).toEqual(codes.map((c) => `${c} (incomplete)`));
    for (const d of parseEpsil(source)[1])
      expect(epsilDiagnosticMessage(d)).not.toMatch(/Unexpected symbol/);
  });

  test('the message of a missing expression or keyword', () => {
    expect(parseEpsil('[1,')[1].map(epsilDiagnosticMessage)).toEqual([
      'Expected an expression',
      'Expected closing bracket "]"',
    ]);
    expect(parseEpsil('for x')[1].map(epsilDiagnosticMessage)).toEqual([
      'Expected "in"',
    ]);
    expect(parseEpsil('for x y')[1].map(epsilDiagnosticMessage)).toEqual([
      'Unexpected symbol "y"',
    ]);
  });

  test('a source without an error has no diagnostic', () => {
    expect(flagsOf('let s = "abc"\nf(1)')).toEqual([]);
  });
});

//
// A block comment that the source does not close (CE-1580). A comment is
// valid after any token, so the parser reads the source as it reads the same
// source with the comment closed, and adds one `end-of-comment-expected`.
//

/** `value` without the `sourceOffsets` of its nodes. */
function withoutOffsets(value: unknown): unknown {
  return JSON.parse(
    JSON.stringify(value, (key, x) => (key === 'sourceOffsets' ? undefined : x))
  );
}

describe('EPSIL UNCLOSED BLOCK COMMENT', () => {
  test('after a statement, the only diagnostic is the one of the comment', () => {
    const [value, diagnostics] = parseEpsil('let a = 1 /* note');
    expect(diagnostics.map((d) => [d.message, d.range, d.incomplete])).toEqual([
      ['end-of-comment-expected', [10, 17], true],
    ]);
    expect(value).toEqual(parseEpsil('let a = 1')[0]);
  });

  test('in an unclosed bracket, the bracket goes before the comment', () => {
    const [, diagnostics] = parseEpsil('f(1 /* x');
    expect(
      diagnostics.map((d) => [d.message, d.range, d.incomplete, d.fixits])
    ).toEqual([
      [['closing-bracket-expected', ')'], [1, 2], true, [[3, 3, ')']]],
      ['end-of-comment-expected', [4, 8], true, undefined],
    ]);
  });

  test.each([
    // After a complete statement.
    'x.y /* a',
    'f(x) /* a',
    'let x: integer /* a',
    'for x in xs { 1 } /* a',
    'let a = 1 /** doc',
    'let a = 1 /* a /* b */',
    'let a = 1 /* a\nlet b = 2',
    'let a = 1\n/* a',
    // In an unclosed bracket.
    '[1 /* a',
    '(1 /* a',
    'a[1 /* a',
    'f(1, /* a',
    'if c { a /* a',
    'if c { a /* a }',
    'match v { 1 => 2 /* a',
    '[x for x in xs /* a',
    // Where the next part of a statement is expected.
    '1 + /* a',
    '1 +\n/* a',
    'let /* a',
    'let x: /* a',
    'if a /* a',
    'for x /* a',
    'function f(x) /* a',
    'f(x) = /* a',
    'a. /* a',
    // After another error.
    'f(1 2 /* a',
    '1 ) /* a',
    'let a = 1 2 /* a',
    '- /* a',
  ])('%j gets the diagnostics of the closed comment and one more', (source) => {
    const closed = source + ' */';
    expect(flagsOf(source)).toEqual([
      ...flagsOf(closed),
      'end-of-comment-expected (incomplete)',
    ]);
    expect(withoutOffsets(parseEpsil(source)[0])).toEqual(
      withoutOffsets(parseEpsil(closed)[0])
    );
  });

  test('in a closed hole of a string, the comment is not incomplete', () => {
    expect(flagsOf('"a \\(1 /* x) b"')).toEqual(['end-of-comment-expected']);
  });

  test('an unclosed string after code stays an unexpected token', () => {
    expect(flagsOf('let a = 1 "abc')).toEqual([
      'unexpected-symbol (incomplete)',
    ]);
  });
});
