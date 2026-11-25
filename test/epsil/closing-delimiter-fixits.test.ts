import { parseEpsil } from '../../src/epsil/parse-epsil';

//
// The fixits of a missing closing delimiter (CE-1520). An unclosed string
// gets the insertion of its delimiter at the end of its text on the line; an
// unclosed bracket at the end of the input gets the insertion of the bracket
// after the last token, before trailing white space and comments.
//

/** The codes of the diagnostics of `source`, and the source after the fixit
 * of the diagnostic with the code `code`. */
function applyFixit(
  source: string,
  code: string
): { codes: string[]; fixed: string | undefined } {
  const [, diagnostics] = parseEpsil(source);
  const codes = diagnostics.map((d) =>
    typeof d.message === 'string' ? d.message : d.message[0]
  );
  const diagnostic = diagnostics.find(
    (d) => (typeof d.message === 'string' ? d.message : d.message[0]) === code
  );
  const fixit = diagnostic?.fixits?.[0];
  if (fixit === undefined) return { codes, fixed: undefined };
  const [start, end, text] = fixit;
  return { codes, fixed: source.slice(0, start) + text + source.slice(end) };
}

/** The diagnostic codes of `source`. */
function codesOf(source: string): string[] {
  return parseEpsil(source)[1].map((d) =>
    typeof d.message === 'string' ? d.message : d.message[0]
  );
}

const STRING = 'string-literal-closing-delimiter-expected';
const BRACKET = 'closing-bracket-expected';

describe('EPSIL FIXIT — unclosed string', () => {
  test.each([
    ['let s = "abc', 'let s = "abc"'],
    ['let s = "abc   ', 'let s = "abc"   '],
    // The string ran over the `}` that closes the block.
    ['if k % 5 == 0 { "Buzz }', 'if k % 5 == 0 { "Buzz" }'],
    ['f("a)', 'f("a")'],
    // No text after the opening quote: the delimiter goes at the end of the
    // line.
    ['let s = " }', 'let s = " }"'],
    ['let s = "abc\nlet t = 1', 'let s = "abc"\nlet t = 1'],
    ['let t = #"abc ', 'let t = #"abc"# '],
    ['let t = ##"abc', 'let t = ##"abc"##'],
    ['let m = """\n  abc\n', 'let m = """\n  abc\n"""\n'],
    // The trailing spaces of the last line are part of the value.
    ['let m = """\n  abc  \n  ', 'let m = """\n  abc  \n"""\n  '],
    // The `)` of a hole is not a bracket that the string ran over.
    ['let s = "value \\(x)', 'let s = "value \\(x)"'],
    ['f("a \\(x) )', 'f("a \\(x)" )'],
  ])('%j', (source, expected) => {
    const { fixed } = applyFixit(source, STRING);
    expect(fixed).toBe(expected);
    expect(codesOf(fixed!)).toEqual([]);
  });

  test('a LaTeX island gets its closing `$`', () => {
    expect(applyFixit('let x = $x^2 ', STRING).fixed).toBe('let x = $x^2$ ');
  });

  test.each([
    // The insertion of `"` or `)` would leave the hole open.
    'let s = "\\(x + 1"',
    'let s = "\\(f(x + 1"',
    // The insertion of `"` would be the escape `\"`.
    'let s = "C:\\',
    // In an island, `\\$` is an escaped `$` too.
    'let x = $a\\\\',
  ])('%j gets no fixit', (source) => {
    const [, diagnostics] = parseEpsil(source);
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) expect(d.fixits).toBeUndefined();
  });

  test.each(['let s = "C:\\', 'let s = "C:\\\nx', 'let s = "a\\u12'])(
    'the range of %j ends inside its line',
    (source) => {
      const end = source.split('\n')[0].length;
      const diagnostics = parseEpsil(source)[1].filter(
        (d) => d.message[0] !== 'unexpected-token'
      );
      expect(diagnostics.map((d) => d.message[0])).toContain(
        'string-literal-closing-delimiter-expected'
      );
      for (const d of diagnostics) expect(d.range).toEqual([8, end]);
    }
  );
});

describe('EPSIL FIXIT — unclosed bracket', () => {
  test.each([
    ['f(1, 2', 'f(1, 2)'],
    ['let L = [1, 2', 'let L = [1, 2]'],
    ['if x > 0 { 1', 'if x > 0 { 1}'],
    ['f(1, 2  \n\n', 'f(1, 2)  \n\n'],
    // Before a trailing comment, which the insertion would otherwise change.
    ['f(1 // note', 'f(1) // note'],
    ['f(1 /* note */  ', 'f(1) /* note */  '],
    // A `//` in a string is not a comment.
    ['g("a // b"', 'g("a // b")'],
  ])('%j', (source, expected) => {
    const { fixed } = applyFixit(source, BRACKET);
    expect(fixed).toBe(expected);
    expect(codesOf(fixed!)).toEqual([]);
  });

  test('the insertion goes before an unclosed comment', () => {
    const { fixed } = applyFixit('f(1, 2 /* note', BRACKET);
    expect(fixed).toBe('f(1, 2) /* note');
    expect(codesOf(fixed!)).toEqual(['end-of-comment-expected']);
  });

  test('each of two unclosed brackets gets the insertion at the end', () => {
    const [, diagnostics] = parseEpsil('h(g(1');
    expect(diagnostics.map((d) => d.fixits)).toEqual([
      [[5, 5, ')']],
      [[5, 5, ')']],
    ]);
  });

  test('the insertion is within the source after an escape at the end', () => {
    const source = 'f("C:\\';
    const fixits = parseEpsil(source)[1].flatMap((d) => d.fixits ?? []);
    expect(fixits).toEqual([[source.length, source.length, ')']]);
  });

  test('an unclosed bracket of a script run gets no fixit', () => {
    // The source of the run is its ASCII translation: an inserted `)` would
    // not close the `⁽`.
    const [, diagnostics] = parseEpsil('x⁽ⁿ⁺¹');
    expect(diagnostics.length).toBeGreaterThan(0);
    for (const d of diagnostics) expect(d.fixits).toBeUndefined();
  });

  test('a bracket missing before another token gets no fixit', () => {
    const [, diagnostics] = parseEpsil('f(1]');
    expect(diagnostics.map((d) => d.message[0])).toEqual([BRACKET]);
    expect(diagnostics[0].fixits).toBeUndefined();
  });
});

describe('EPSIL FIXIT — unclosed string, at the caret', () => {
  /** The source after the string fixit, applied as an editor with the caret
   * at `|` applies it. */
  function applyAtCaret(marked: string): string {
    const caret = marked.indexOf('|');
    const source = marked.slice(0, caret) + marked.slice(caret + 1);
    const d = parseEpsil(source)[1].find(
      (d) => (typeof d.message === 'string' ? d.message : d.message[0]) === STRING
    );
    const [start, end, text, range] = d!.fixits![0];
    if (range !== undefined && caret >= range[0] && caret <= range[1])
      return source.slice(0, caret) + text + source.slice(caret);
    return source.slice(0, start) + text + source.slice(end);
  }

  test.each([
    // The caret in the string: the delimiter goes there.
    ['if k { "Buzz| }', 'if k { "Buzz" }'],
    ['let s = "ab|c', 'let s = "ab"c'],
    ['let s = "|abc', 'let s = ""abc'],
    ['let t = ##"ab| c', 'let t = ##"ab"## c'],
    ['let x = $x^2| + 1', 'let x = $x^2$ + 1'],
    // The caret at the end of the line is in the string: the user typed the
    // `}` in it.
    ['if k { "Buzz }|', 'if k { "Buzz }"'],
    // The caret before the opening delimiter or in a hole: the fixit range.
    ['let s = |"abc }', 'let s = "abc" }'],
    ['let s = "a \\(x|) b }', 'let s = "a \\(x) b" }'],
    // The caret on another line.
    ['let s = "abc }\nlet |t = 1', 'let s = "abc" }\nlet t = 1'],
  ])('%j', (marked, expected) => {
    expect(applyAtCaret(marked)).toBe(expected);
  });

  test('the caret range is after the last hole', () => {
    const source = 'f("a \\(x) b';
    const d = parseEpsil(source)[1].find((d) => d.message[0] === STRING);
    expect(d!.fixits![0][3]).toEqual([source.indexOf(')') + 1, source.length]);
  });

  test('a multiline string has no caret range', () => {
    const d = parseEpsil('let m = """\n  abc\n')[1].find(
      (d) => d.message[0] === STRING
    );
    expect(d!.fixits![0][3]).toBeUndefined();
  });
});
