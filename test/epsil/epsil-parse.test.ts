import { stringValue } from '../../src/math-json/utils';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { validEpsil, invalidEpsil } from '../utils';

describe('EPSIL PARSING SHEBANG', () => {
  test('Valid shebang', () => {
    expect(validEpsil('#! /bin/epsil\n3.14 ')).toBe(3.14);
  });
  test('Invalid shebang', () => {
    // @fixme: should output shebang specific error message
    expect(invalidEpsil('\n#! boo\n ')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            #,
          ],
        ],
      ]
    `);
  });
});

describe('EPSIL PARSING DIRECTIVES', () => {
  test('Navigator directive (host pragmas enabled)', () => {
    // `#navigator` reads host state, so it is gated behind `allowHostPragmas`
    // (default off — see the gating tests in `execute.test.ts`).
    // `navigator` is not available when running in a node environment
    // node v22 added support for the navigator object
    const [ua, diags] = parseEpsil('#navigator("userAgent")', undefined, {
      allowHostPragmas: true,
    });
    expect(diags).toHaveLength(0);
    const validUa = ua === 'Undefined' || stringValue(ua)?.startsWith('Node');
    expect(validUa).toBe(true);
  });
  test('Environment variable directive (host pragmas enabled)', () => {
    const [value, diags] = parseEpsil('#env("HOME")', undefined, {
      allowHostPragmas: true,
    });
    expect(diags).toHaveLength(0);
    expect(stringValue(value)).toBe(process.env['HOME']);
  });
  test('Warning directive', () => {
    // `#warning` no longer writes to the console; it evaluates to its
    // interpolated message as a string value.
    expect(validEpsil('#warning("hello")')).toStrictEqual({ str: 'hello' });
  });
  test('Date directive', () => {
    // Assert the format shape (`YYYY-MM-DD`), never the actual date value.
    expect(validEpsil('#date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('EPSIL PARSING SPACES', () => {
  test('Whitespace', () => {
    expect(validEpsil(' ')).toBe('Nothing');
    expect(validEpsil(' \t ')).toBe('Nothing');
    expect(validEpsil(' \t\n ')).toBe('Nothing');
    expect(validEpsil(' \u2000 ')).toBe('Nothing');
    expect(validEpsil(' \u2009 ')).toBe('Nothing');
    // Two expressions on one line with no separator (a tab is not a linebreak)
    // is a diagnostic — no silent `Block`-juxtaposition (language-review §2.5).
    expect(validEpsil('1\t2')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '2']],
    ]);
    // A tab is whitespace on both sides of `+`, so it parses as an infix Add.
    expect(validEpsil('1\t+\t2')).toStrictEqual(['Add', 1, 2]);
    expect(validEpsil(' 2 \t 1')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '1']],
    ]);
  });
});

describe('EPSIL PARSING COMMENTS', () => {
  test('Single-line comments', () => {
    expect(validEpsil('// Comment')).toBe('Nothing');
    expect(validEpsil('/// Documentation **comment**')).toBe('Nothing');
    expect(validEpsil('3.14 // Trailing comment')).toBe(3.14);
    expect(validEpsil('   // inline // comment')).toBe('Nothing');
    expect(validEpsil('  12 // inline // comment')).toBe(12);
    expect(validEpsil('  12 // inline 👩🏻‍🎤 // comment')).toBe(12);
    expect(validEpsil('  12 /// inline 👩🏻‍🎤 // documentation')).toBe(12);
    expect(validEpsil('  12 /// inline\n 👩🏻‍🎤 // documentation')).toStrictEqual([
      'Block',
      12,
      '👩🏻‍🎤',
    ]);
  });
  test('Multi-line comments;', () => {
    expect(
      validEpsil(`3.14
/*
 * Multi-line comment
 */`)
    ).toBe(3.14);

    // A `+` with whitespace on both sides (a space, then a linebreak) is an
    // infix operator that continues onto the next line.
    expect(
      validEpsil(`3.14 +
3.14 /*
 * Multi-line comment
 */`)
    ).toStrictEqual(['Add', 3.14, 3.14]);
    expect(
      validEpsil(`3.14 +
5.67 /*
 * Nested /* Comment */
 */`)
    ).toStrictEqual(['Add', 3.14, 5.67]);
  });
  test('Invalid multiline comment', () => {
    expect(invalidEpsil(`   /* over nested /* comment */ */ */`))
      .toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            */,
          ],
        ],
      ]
    `);

    expect(invalidEpsil(`   /* under nested /* comment */`))
      .toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          end-of-comment-expected,
        ],
      ]
    `);
  });
});

describe('EPSIL PARSING NUMBERS', () => {
  test('Constants', () => {
    expect(validEpsil('NaN')).toStrictEqual('NaN');
    expect(validEpsil('-Infinity')).toStrictEqual('NegativeInfinity');
    expect(validEpsil('Infinity')).toStrictEqual('PositiveInfinity');
    expect(validEpsil('+Infinity')).toStrictEqual('PositiveInfinity');
  });
  test('Integers', () => {
    expect(validEpsil('0')).toBe(0);
    expect(validEpsil('1234')).toBe(1234);
    expect(validEpsil('62737547')).toBe(62737547);
    expect(validEpsil('62_73_7__547')).toBe(62737547);
  });
  test('Signed Integers', () => {
    expect(validEpsil('+0')).toBe(0);
    expect(validEpsil('-0')).toBe(0);
    expect(validEpsil('+62737547')).toBe(62737547);
    expect(validEpsil('-62_73_7__547')).toBe(-62737547);
  });
  test('Floating-point number', () => {
    expect(validEpsil('0.1e-4')).toBe(0.00001);
    expect(validEpsil('1.2')).toBe(1.2);
    expect(validEpsil('1.2000')).toBe(1.2);
    expect(validEpsil('0001.2000')).toBe(1.2);
    expect(validEpsil('62_73_7547.38383e-2')).toBe(627375.4738383);
    expect(validEpsil('62_73_7547.38383')).toBe(62737547.38383);
  });
  test('Signed Floating-point number', () => {
    expect(validEpsil('+1.2')).toBe(1.2);
    expect(validEpsil('-62_73_7547.38383e-13')).toBe(-0.000006273754738383);
    expect(validEpsil('+62_73_7547.38383')).toBe(62737547.38383);
    expect(validEpsil('-62_73_7547.38383')).toBe(-62737547.38383);
  });

  test('Binary numbers', () => {
    expect(validEpsil('0b0101001011')).toBe(331);
    expect(validEpsil('0b0101001011.1')).toBe(331.5);
    expect(validEpsil('0b0101001011.110101')).toBe(331.828125);
    expect(validEpsil('0b10e2')).toBe(200);
    expect(validEpsil('0b10p4')).toBe(32);
    expect(validEpsil('0b0101001011.110101e-4')).toBe(0.0331828125);
    expect(validEpsil('0b0101001011E-4')).toBe(0.0331);
    expect(validEpsil('0b0101001011.001')).toBe(331.125);
    expect(validEpsil('0b0101001011.001p-2')).toBe(82.78125);
    expect(validEpsil('-0b0')).toBe(0);
    expect(validEpsil('-0b10')).toBe(-2);
  });
  test('Invalid Floating-point number', () => {
    expect(invalidEpsil('1.2.3')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            .,
          ],
        ],
      ]
    `);
    // `2et`: the number `2` immediately abuts the symbol `et`, so it is
    // invisible multiplication (Stage B).
    expect(invalidEpsil('2et')).toStrictEqual([
      'UnexpectedSuccess',
      ['Multiply', 2, 'et'],
    ]);
    // `k-13`: the number abuts `k` (invisible multiplication); the `-` has no
    // whitespace on either side, so it is an infix Subtract.
    expect(invalidEpsil('62_73_7547.k-13')).toStrictEqual([
      'UnexpectedSuccess',
      ['Subtract', ['Multiply', 62737547, 'k'], 13],
    ]);
    expect(invalidEpsil('62_73_7547k-13')).toStrictEqual([
      'UnexpectedSuccess',
      ['Subtract', ['Multiply', 62737547, 'k'], 13],
    ]);
    expect(invalidEpsil('.1e-13')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            .,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('62_73_7547.e-13')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        0.0000062737547,
      ]
    `);
    expect(invalidEpsil('-62_73_7547.e-13')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        -0.0000062737547,
      ]
    `);
  });
  test('Invalid Binary numbers', () => {
    // expect(invalidEpsil('0b0b0')).toMatchInlineSnapshot();
    // expect(invalidEpsil('0b01b01')).toMatchInlineSnapshot();
    // expect(invalidEpsil('0b01c')).toMatchInlineSnapshot();
  });
  test('Hex numbers', () => {
    expect(validEpsil('0xdeadbeef')).toBe(3735928559);
    expect(validEpsil('-0xdeadbeef')).toBe(-3735928559);
    expect(validEpsil('0xdead.beef')).toBe(57005.745834350586);
    expect(validEpsil('0x3.0cp2')).toBe(12.1875);
    expect(validEpsil('0xc.3p0')).toBe(12.1875);
    expect(validEpsil('0x3.23d70a3d70a3ep0')).toBe(3.14);
    expect(validEpsil('0x1.91eb851eb851fp+1')).toBe(3.14);
    expect(validEpsil('0x400')).toBe(1024);
    expect(validEpsil('0x1.0p-4')).toBe(0.0625);
    expect(validEpsil('0x1.0p-8')).toBe(0.00390625);
    expect(validEpsil('0x1.0p-10')).toBe(0.0009765625);
  });
});

describe('EPSIL PARSING SYMBOLS', () => {
  test('Symbols', () => {
    expect(validEpsil('a')).toBe('a');
    expect(validEpsil('abcdef')).toBe('abcdef');
    expect(validEpsil('ABcde')).toBe('ABcde');
    expect(validEpsil('été')).toBe('été');
    expect(validEpsil('Thé')).toBe('Thé');
    expect(validEpsil('garçon')).toBe('garçon');
    expect(validEpsil('a01234')).toBe('a01234');
    expect(validEpsil('_abc')).toBe('_abc');
    expect(validEpsil('_01234')).toBe('_01234');
    expect(validEpsil('👩🏻‍🎤🤯')).toBe('👩🏻‍🎤🤯');
  });
  test('Verbatim symbols', () => {
    expect(validEpsil('`a`')).toBe('a');
    // Reserved words are the reason the verbatim form exists
    expect(validEpsil('`new`')).toBe('new');
    expect(validEpsil('`while`')).toBe('while');
    expect(validEpsil('`👩🏻‍🎤🤯`')).toBe('👩🏻‍🎤🤯');
  });
  test('Invalid Symbols', () => {
    expect(invalidEpsil('`abc')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unbalanced-verbatim-symbol,
            abc,
          ],
        ],
      ]
    `);
    // Symbol must fit on a line
    expect(invalidEpsil('`abc\nd`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unbalanced-verbatim-symbol,
            abc
      ,
          ],
          [
            unexpected-symbol,
            d,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('``')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          empty-verbatim-symbol,
        ],
      ]
    `);
    // Start with a hash sign
    expect(invalidEpsil('`#abcd`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            #abcd,
          ],
        ],
      ]
    `);
    // The content of a verbatim symbol is literal: no escape processing,
    // and `\` is not a valid symbol character
    expect(invalidEpsil('`\\sin`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            \\sin,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('`\\u{2135}0`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            \\u{2135}0,
          ],
        ],
      ]
    `);
    // Not a valid MathJSON symbol (Pattern_Syntax character)
    expect(invalidEpsil('`a+b`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            a+b,
          ],
        ],
      ]
    `);
    // Not a valid MathJSON symbol (whitespace)
    expect(invalidEpsil('`Hello World`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            Hello World,
          ],
        ],
      ]
    `);
    // Starts with a dollar sign:
    expect(invalidEpsil('`$abcd`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            $abcd,
          ],
        ],
      ]
    `);
    // Starts with a quotation mark:
    expect(invalidEpsil('`"abcd`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            "abcd,
          ],
        ],
      ]
    `);
    // Includes a space:
    expect(invalidEpsil('`ab cd`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            ab cd,
          ],
        ],
      ]
    `);
    // Includes a space:
    expect(validEpsil('`Mind 🤯`')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-symbol-name,
            Mind 🤯,
          ],
        ],
      ]
    `);
    // expect(invalidEpsil('#abcd')).toMatchInlineSnapshot();
    // expect(invalidEpsil('$abcd')).toMatchInlineSnapshot();
    // expect(invalidEpsil('$ab_cd$')).toMatchInlineSnapshot();
  });
});

// Unsupported: these Unicode operator aliases currently parse as unexpected
// symbols rather than their ASCII/operator equivalents.
describe('EPSIL PARSING FANCY SYMBOLS', () => {
  test('Fancy symbols', () => {
    // ∧ → &&, ¬ → !, ⋁ → ||
    expect(validEpsil('a ∧ ¬b ⋁ !c')).toStrictEqual([
      'Or',
      ['And', 'a', ['Not', 'b']],
      ['Not', 'c'],
    ]);
    // \u2212 2 \u00d7 x
    expect(validEpsil('−2 × x >= 5')).toStrictEqual([
      'GreaterEqual',
      ['Multiply', -2, 'x'],
      5,
    ]);
    // `3πⅈ` is invisible multiplication — Stage B.
    // ∈ → in (Element); fancy constant symbols canonicalize to their ASCII
    // symbol at the lexer (ℝ → RealNumbers), so the membership test is
    // against the engine's actual set constant.
    expect(validEpsil('3.1 ∈ ℝ')).toStrictEqual([
      'Element',
      3.1,
      'RealNumbers',
    ]);
  });
});

describe('EPSIL PARSING SINGLE-LINE STRINGS', () => {
  test('Valid string', () => {
    expect(validEpsil('""')).toStrictEqual({ str: '' });
    expect(validEpsil('"x"')).toStrictEqual({ str: 'x' });
    expect(validEpsil('"hello world"')).toStrictEqual({
      str: 'hello world',
    });
    expect(validEpsil(`"Ç‘est l’été!"`)).toStrictEqual({
      str: 'Ç‘est l’été!',
    });
    expect(validEpsil(`"The multiplication sign is ×"`)).toStrictEqual({
      str: 'The multiplication sign is ×',
    });
    expect(validEpsil(`"The set of real numbers is ℝ"`)).toStrictEqual({
      str: 'The set of real numbers is ℝ',
    });
  });

  test('String escaping', () => {
    // Escape sequences are cooked once, by the lexer. The resulting `str`
    // MathJSON value holds the *actual* control character (a real tab, a real
    // newline), never a re-escaped `\t`/`\n` — the single-segment plain-string
    // path must agree with the interpolation path (see 'String interpolating').
    expect(validEpsil('"hello\\t world"')).toStrictEqual({
      str: 'hello\t world',
    });
    expect(validEpsil('"hello \\u0061 world"')).toStrictEqual({
      str: 'hello a world',
    });
    expect(validEpsil('"hello \\u{0061} world"')).toStrictEqual({
      str: 'hello a world',
    });
    expect(validEpsil('"hello \\u{1F30D}"')).toStrictEqual({
      str: 'hello \u{1F30D}',
    });
    expect(validEpsil('"hello \\\\ world"')).toStrictEqual({
      str: 'hello \\ world',
    });
    expect(validEpsil('"hello \\n world"')).toStrictEqual({
      str: 'hello \n world',
    });
    // A plain string that is a single cooked segment with several control
    // characters is not double-processed (regression: `escapeJsonString` was
    // re-escaping the cooked segment).
    expect(validEpsil('"a\\tb\\nc"')).toStrictEqual({ str: 'a\tb\nc' });
    // An extended string (`#"…"#`) performs NO escape processing: a backslash
    // and the following letter are both literal.
    expect(validEpsil('#"a\\tb"#')).toStrictEqual({ str: 'a\\tb' });
  });

  test('String interpolating', () => {
    expect(validEpsil('"hello\\(" world")"')).toStrictEqual({
      str: 'hello world',
    });
    expect(validEpsil('"hello \\(world)"')).toStrictEqual([
      'String',
      { str: 'hello ' },
      'world',
    ]);
    expect(validEpsil('"hello \\()"')).toStrictEqual({ str: 'hello ' });

    expect(validEpsil('"hello\\(3.1456)"')).toStrictEqual([
      'String',
      { str: 'hello' },
      3.1456,
    ]);
    // expect(validEpsil('"hello\\(2 + 3 + x)"')).toMatchInlineSnapshot();
    // expect(
    //   validEpsil('"hello \\(2 + 3 + x) is equal to \\(5 + x)"')
    // ).toMatchInlineSnapshot();
  });

  test('Invalid string', () => {
    expect(invalidEpsil('"invalid \\x escape "')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-escape-sequence,
            \\x,
          ],
        ],
      ]
    `);

    // `end` is a *merely* reserved word — no construct claims it — so it
    // parses as an ordinary symbol and only the unterminated string is
    // diagnosed. (A HARD-reserved word here would add `reserved-word`.)
    expect(invalidEpsil('end"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidEpsil('end"\n')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"start\nend"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"start')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"invalid \\x escape "')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-escape-sequence,
            \\x,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"invalid \\U0041 escape "')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-escape-sequence,
            \\U,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"invalid \\u23ghjik escape "'))
      .toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-unicode-codepoint-string,
            23g,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"invalid \\u{defughjik} escape "'))
      .toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-unicode-codepoint-string,
            defughji,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"invalid \\u{20ffff} escape "'))
      .toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-unicode-codepoint-value,
            U+0020FFFF,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"invalid \\u{d888} escape "')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            invalid-unicode-codepoint-value,
            U+D888,
          ],
        ],
      ]
    `);
    // Prematurely closed interpolated expression
    expect(invalidEpsil('"start \\("')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            closing-bracket-expected,
            ),
          ],
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
          [
            string-literal-opening-delimiter-expected,
            ",
          ],
        ],
      ]
    `);
    // `+` in the interpolation is now a prefix operator; its operand is the
    // (unterminated) closing `"`, which yields the string-delimiter diagnostics.
    expect(invalidEpsil('"start \\(+"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            closing-bracket-expected,
            ),
          ],
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
          [
            string-literal-opening-delimiter-expected,
            ",
          ],
        ],
      ]
    `);
    // `end` is a reserved word inside the interpolation.
    expect(invalidEpsil('"start \\(end"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            closing-bracket-expected,
            ),
          ],
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidEpsil('"start \\( end"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            closing-bracket-expected,
            ),
          ],
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
  });
});

describe('EPSIL PARSING MULTILINE STRINGS', () => {
  test('Valid string', () => {
    // Lines are joined with a real newline (`\n`), and any escape sequence in a
    // line is cooked once — the `str` value holds real control characters, not
    // re-escaped `\n`.
    expect(validEpsil('"""\nhello\nworld\n"""')).toStrictEqual({
      str: 'hello\nworld',
    });

    expect(validEpsil('"""\nhello\n \\u{1F30D}\n"""')).toStrictEqual({
      str: 'hello\n \u{1F30D}',
    });

    expect(validEpsil('"""\n   hello\n   world\n   """')).toStrictEqual({
      str: 'hello\nworld',
    });

    expect(validEpsil('"""\n\t\thello\n\t\tworld\n\t\t"""')).toStrictEqual({
      str: 'hello\nworld',
    });

    expect(validEpsil('"""\n\t  hello\n\t  world\n\t  """')).toStrictEqual({
      str: 'hello\nworld',
    });

    expect(validEpsil('"""\n\t  hello\\\n\t  world\n\t  """')).toStrictEqual({
      str: 'helloworld',
    });
  });
  test('Invalid string', () => {
    expect(invalidEpsil('"""abc\nhello\nworld\n"""')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          multiline-string-expected,
          [
            unexpected-symbol,
            abc,
          ],
          [
            string-literal-closing-delimiter-expected,
            """,
          ],
        ],
      ]
    `);

    expect(invalidEpsil('"""\nhello\nworld\n boo  """'))
      .toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          multiline-whitespace-expected,
        ],
      ]
    `);
  });
});

describe('EPSIL PARSING EXTENDED STRINGS', () => {
  test('Valid string', () => {
    expect(validEpsil('#"hello world"#')).toStrictEqual({
      str: 'hello world',
    });
    expect(validEpsil('##"hello world"##')).toStrictEqual({
      str: 'hello world',
    });
    expect(validEpsil('#"hello "world""#')).toStrictEqual({
      str: 'hello "world"',
    });
    expect(validEpsil('#"hello \\n "world""#')).toMatchInlineSnapshot(`
      {
        str: hello \\n "world",
      }
    `);
  });
  test('Invalid string', () => {
    expect(invalidEpsil('#"hello world"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            string-literal-closing-delimiter-expected,
            #",
          ],
        ],
      ]
    `);
    expect(invalidEpsil('##"hello world"#')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            string-literal-closing-delimiter-expected,
            ##",
          ],
        ],
      ]
    `);
  });
});

describe('EPSIL PARSING DICTIONARY', () => {
  test('Empty dictionary', () => {
    expect(validEpsil('{->}')).toMatchInlineSnapshot(`
      [
        Dictionary,
      ]
    `);
  });
  test('Empty dictionary', () => {
    expect(validEpsil('Dictionary()')).toMatchInlineSnapshot(`
      [
        Dictionary,
      ]
    `);
  });

  test('Valid dictionary', () => {
    expect(validEpsil('{ one -> 1}')).toMatchInlineSnapshot(`
      [
        Dictionary,
        [
          KeyValuePair,
          {
            str: one,
          },
          1,
        ],
      ]
    `);
    expect(validEpsil('{ one -> 1, two -> 2}')).toMatchInlineSnapshot(`
      [
        Dictionary,
        [
          KeyValuePair,
          {
            str: one,
          },
          1,
        ],
        [
          KeyValuePair,
          {
            str: two,
          },
          2,
        ],
      ]
    `);
    expect(validEpsil('{ one -> 1, three -> 2 + 1}')).toMatchInlineSnapshot(`
      [
        Dictionary,
        [
          KeyValuePair,
          {
            str: one,
          },
          1,
        ],
        [
          KeyValuePair,
          {
            str: three,
          },
          [
            Add,
            2,
            1,
          ],
        ],
      ]
    `);
    expect(validEpsil('{x -> 1, y -> 2, z -> 2 + x}')).toMatchInlineSnapshot(`
      [
        Dictionary,
        [
          KeyValuePair,
          {
            str: x,
          },
          1,
        ],
        [
          KeyValuePair,
          {
            str: y,
          },
          2,
        ],
        [
          KeyValuePair,
          {
            str: z,
          },
          [
            Add,
            2,
            x,
          ],
        ],
      ]
    `);
  });

  test('Nested dictionary', () => {
    expect(validEpsil('{x -> {a -> 7, b -> 5}, y -> 2, z -> 2 + x}'))
      .toMatchInlineSnapshot(`
      [
        Dictionary,
        [
          KeyValuePair,
          {
            str: x,
          },
          [
            Dictionary,
            [
              KeyValuePair,
              {
                str: a,
              },
              7,
            ],
            [
              KeyValuePair,
              {
                str: b,
              },
              5,
            ],
          ],
        ],
        [
          KeyValuePair,
          {
            str: y,
          },
          2,
        ],
        [
          KeyValuePair,
          {
            str: z,
          },
          [
            Add,
            2,
            x,
          ],
        ],
      ]
    `);
  });

  test('Invalid dictionary', () => {
    expect(invalidEpsil('{ one -> 1, one -> 2}')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            duplicate-dictionary-key,
            one,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('{ one -> 1, two -> 2, }')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        [
          Dictionary,
          [
            KeyValuePair,
            {
              str: one,
            },
            1,
          ],
          [
            KeyValuePair,
            {
              str: two,
            },
            2,
          ],
        ],
      ]
    `);
    expect(invalidEpsil('{ one -> 1, , two -> 2}')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ,,
          ],
        ],
      ]
    `);
  });
});

describe('EPSIL PARSING COLLECTIONS', () => {
  test('Sets', () => {
    expect(validEpsil('{}')).toMatchInlineSnapshot(`
      [
        Set,
      ]
    `);
    expect(validEpsil('{1}')).toMatchInlineSnapshot(`
      [
        Set,
        1,
      ]
    `);
    expect(validEpsil('{1, 2}')).toMatchInlineSnapshot(`
      [
        Set,
        1,
        2,
      ]
    `);
    expect(validEpsil('{1, {2, 3}, 4}')).toMatchInlineSnapshot(`
      [
        Set,
        1,
        [
          Set,
          2,
          3,
        ],
        4,
      ]
    `);
    expect(validEpsil('Set()')).toMatchInlineSnapshot(`
      [
        Set,
      ]
    `);
    expect(validEpsil('Set(1, 2, 3)')).toMatchInlineSnapshot(`
      [
        Set,
        1,
        2,
        3,
      ]
    `);
    expect(validEpsil('Set(1, {2, 3}, 3)')).toMatchInlineSnapshot(`
      [
        Set,
        1,
        [
          Set,
          2,
          3,
        ],
        3,
      ]
    `);
  });
  test('Lists', () => {
    expect(validEpsil('[]')).toMatchInlineSnapshot(`
      [
        List,
      ]
    `);
    expect(validEpsil('[1]')).toMatchInlineSnapshot(`
      [
        List,
        1,
      ]
    `);
    expect(validEpsil('[1, 2]')).toMatchInlineSnapshot(`
      [
        List,
        1,
        2,
      ]
    `);
    expect(validEpsil('[1, [2, 3], 4]')).toMatchInlineSnapshot(`
      [
        List,
        1,
        [
          List,
          2,
          3,
        ],
        4,
      ]
    `);
    expect(validEpsil('List()')).toMatchInlineSnapshot(`
      [
        List,
      ]
    `);
    expect(validEpsil('List(2, 2x, 4)')).toMatchInlineSnapshot(`
      [
        List,
        2,
        [
          Multiply,
          2,
          x,
        ],
        4,
      ]
    `);
    expect(validEpsil('List(2, [2x, 5], 4)')).toMatchInlineSnapshot(`
      [
        List,
        2,
        [
          List,
          [
            Multiply,
            2,
            x,
          ],
          5,
        ],
        4,
      ]
    `);
  });
  test('Sequence', () => {
    expect(validEpsil('1, 2, 3')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ,,
          ],
        ],
      ]
    `);
    expect(validEpsil('1,, 3')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ,,
          ],
        ],
      ]
    `);
    expect(validEpsil('1, 2,')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ,,
          ],
        ],
      ]
    `);
    expect(validEpsil(', 2,')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ,,
          ],
        ],
      ]
    `);
    expect(validEpsil('Sequence()')).toMatchInlineSnapshot(`
      [
        Sequence,
      ]
    `);
    expect(validEpsil('Sequence(1, 2, 3)')).toMatchInlineSnapshot(`
      [
        Sequence,
        1,
        2,
        3,
      ]
    `);
    expect(validEpsil('Sequence(1, 2x + 4, 3)')).toMatchInlineSnapshot(`
      [
        Sequence,
        1,
        [
          Add,
          [
            Multiply,
            2,
            x,
          ],
          4,
        ],
        3,
      ]
    `);
  });
  test('Tuple', () => {
    expect(validEpsil('()')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            expression-expected,
          ],
        ],
      ]
    `);
    expect(validEpsil('(a,b)')).toMatchInlineSnapshot(`
      [
        Tuple,
        a,
        b,
      ]
    `);
    expect(validEpsil('(a,,b)')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ,,
          ],
        ],
      ]
    `);
    expect(validEpsil('(a , , b)')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            ,,
          ],
        ],
      ]
    `);
    expect(validEpsil('Tuple()')).toMatchInlineSnapshot(`
      [
        Tuple,
      ]
    `);
    expect(validEpsil('Tuple(a, 2b, c^3)')).toMatchInlineSnapshot(`
      [
        Tuple,
        a,
        [
          Multiply,
          2,
          b,
        ],
        [
          Power,
          c,
          3,
        ],
      ]
    `);
  });
  // Dictionaries: see above.
});

describe('EPSIL PARSING OPERATORS', () => {
  test('Unary Operators', () => {
    expect(validEpsil('-x')).toStrictEqual(['Negate', 'x']);
    expect(validEpsil('-(2+1)')).toStrictEqual(['Negate', ['Add', 2, 1]]);
    // Unary `+` on a non-literal is the identity.
    expect(validEpsil('+(2+1)')).toStrictEqual(['Add', 2, 1]);
    expect(validEpsil('!a')).toStrictEqual(['Not', 'a']);
    // `!!` maximal-munches into one operator token that peels into two `Not`s.
    expect(validEpsil('!!a')).toStrictEqual(['Not', ['Not', 'a']]);
  });
  test('Invalid unary Operators', () => {
    // A prefix operator must abut its operand: `- x` (with a space) is invalid.
    expect(invalidEpsil('- x')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '-']],
    ]);
  });
  test('Arithmetic Operators', () => {
    expect(validEpsil('2 * x')).toStrictEqual(['Multiply', 2, 'x']);
    expect(validEpsil('2*x')).toStrictEqual(['Multiply', 2, 'x']);
    expect(validEpsil('-1 + -2')).toStrictEqual(['Add', -1, -2]);
    expect(validEpsil('-1 * -2')).toStrictEqual(['Multiply', -1, -2]);
    expect(validEpsil('-x * -y')).toStrictEqual([
      'Multiply',
      ['Negate', 'x'],
      ['Negate', 'y'],
    ]);
    expect(validEpsil('(x + 1) * (x - 1)')).toStrictEqual([
      'Multiply',
      ['Add', 'x', 1],
      ['Subtract', 'x', 1],
    ]);
    expect(validEpsil('1 + (2 + 3)')).toStrictEqual(['Add', 1, ['Add', 2, 3]]);
    expect(validEpsil('2 * (2 + 3)')).toStrictEqual([
      'Multiply',
      2,
      ['Add', 2, 3],
    ]);
    // `2 (2 + 3)` is invisible multiplication — Stage B.
    expect(validEpsil('x * -1 + x * 2')).toStrictEqual([
      'Add',
      ['Multiply', 'x', -1],
      ['Multiply', 'x', 2],
    ]);
    expect(validEpsil('-x - -1')).toStrictEqual([
      'Subtract',
      ['Negate', 'x'],
      -1,
    ]);
    expect(validEpsil('x * y + a * b')).toStrictEqual([
      'Add',
      ['Multiply', 'x', 'y'],
      ['Multiply', 'a', 'b'],
    ]);
    expect(validEpsil('(x + y) * (a + b)')).toStrictEqual([
      'Multiply',
      ['Add', 'x', 'y'],
      ['Add', 'a', 'b'],
    ]);
    // Arithmetic is left-associative binary (n-ary folding happens later).
    expect(validEpsil('x * y * a * b')).toStrictEqual([
      'Multiply',
      ['Multiply', ['Multiply', 'x', 'y'], 'a'],
      'b',
    ]);
  });
  test('Invalid Arithmetic Operators', () => {
    // Whitespace only on one side is invalid.
    // `2 *x`: `*` has a space before but not after → `2` ends, `*x` is not a
    // valid new statement.
    expect(invalidEpsil('2 *x')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '*']],
    ]);
    // `2* x`: `*` has a space after but not before → asymmetric; recovers as
    // infix Multiply, but the diagnostic remains.
    expect(invalidEpsil('2* x')).toStrictEqual([
      'Error',
      ['String', ['asymmetric-operator-whitespace', '*']],
    ]);
    // `-1+-2`: the lexer maximal-munches `+-` into one (non-operator) token, so
    // `-1` ends the first expression; `+-2` on the same line with no separator
    // is a diagnostic (language-review §2.5), no longer a silent `Block`.
    expect(invalidEpsil('-1+-2')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '+-']],
    ]);
  });
  test('Logic Operators', () => {
    expect(validEpsil('x && y && (a || b)')).toStrictEqual([
      'And',
      ['And', 'x', 'y'],
      ['Or', 'a', 'b'],
    ]);
    expect(validEpsil('x && !y || !(a&&b)')).toStrictEqual([
      'Or',
      ['And', 'x', ['Not', 'y']],
      ['Not', ['And', 'a', 'b']],
    ]);
    // `&&` binds tighter than `||`.
    expect(validEpsil('x && !y || !a&&b')).toStrictEqual([
      'Or',
      ['And', 'x', ['Not', 'y']],
      ['And', ['Not', 'a'], 'b'],
    ]);
  });
  test('Relational Operators', () => {
    expect(validEpsil('x * y == a + b')).toStrictEqual([
      'Equal',
      ['Multiply', 'x', 'y'],
      ['Add', 'a', 'b'],
    ]);
    expect(validEpsil('0 > -1')).toStrictEqual(['Greater', 0, -1]);
    expect(validEpsil('0 >= -1')).toStrictEqual(['GreaterEqual', 0, -1]);
    // A run of the same relational operator flattens to an n-ary node.
    expect(validEpsil('a < b < c')).toStrictEqual(['Less', 'a', 'b', 'c']);
    // A mix of relational operators nests left-associatively.
    expect(validEpsil('a < b <= c')).toStrictEqual([
      'LessEqual',
      ['Less', 'a', 'b'],
      'c',
    ]);
  });
  test('Equality ladder: == / === / IdenticallyEqual(…)', () => {
    // Three tiers: `==` arithmetic equality (Equal), `===` structural
    // sameness (Same), and the identity prover, which is deliberately
    // spelled ONLY as a call — `IdenticallyEqual(a, b)`.
    expect(validEpsil('a == b')).toStrictEqual(['Equal', 'a', 'b']);
    expect(validEpsil('a === b')).toStrictEqual(['Same', 'a', 'b']);
    expect(validEpsil('IdenticallyEqual(a, b)')).toStrictEqual([
      'IdenticallyEqual',
      'a',
      'b',
    ]);
    // The equivalence glyphs are rejected outright (ruling 2026-08-13):
    // their bar counts cross the `=`-run lengths (`≡` three bars, `≣` four,
    // vs `===`), so a visual transliteration would silently land on the
    // wrong tier. They must error loudly, never resolve to ANY tier.
    expect(invalidEpsil('a ≡ b')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '≡']],
    ]);
    expect(invalidEpsil('a ≣ b')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '≣']],
    ]);
    expect(invalidEpsil('a ≢ b')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '≢']],
    ]);
  });
  test('Invisible Operators', () => {
    expect(validEpsil('2x')).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        x,
      ]
    `);
    expect(validEpsil('x(2+1)')).toMatchInlineSnapshot(`
      [
        x,
        [
          Add,
          2,
          1,
        ],
      ]
    `);
    expect(validEpsil('2(2+1)')).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        [
          Add,
          2,
          1,
        ],
      ]
    `);
    expect(validEpsil('(a+b)(2+1)')).toMatchInlineSnapshot(`
      [
        Apply,
        [
          Add,
          a,
          b,
        ],
        [
          Add,
          2,
          1,
        ],
      ]
    `);
    expect(validEpsil('2 1/2')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            1,
          ],
        ],
      ]
    `);
    expect(validEpsil('x 1/2')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            1,
          ],
        ],
      ]
    `);
  });
  test('Power', () => {
    expect(validEpsil('x^2')).toStrictEqual(['Power', 'x', 2]);
    // `^` binds tighter than `/`, so `x^1/2` is `(x^1)/2`.
    expect(validEpsil('x^1/2')).toStrictEqual([
      'Divide',
      ['Power', 'x', 1],
      2,
    ]);
    expect(validEpsil('x ^ 1 / 2')).toStrictEqual([
      'Divide',
      ['Power', 'x', 1],
      2,
    ]);
    expect(validEpsil('(x + 1) ^ (n - 1)')).toStrictEqual([
      'Power',
      ['Add', 'x', 1],
      ['Subtract', 'n', 1],
    ]);
    // `**` is an alias for `^`.
    expect(validEpsil('x**2')).toStrictEqual(['Power', 'x', 2]);
    // `^` is right-associative.
    expect(validEpsil('2^3^2')).toStrictEqual(['Power', 2, ['Power', 3, 2]]);
  });
  test('Mod (`%`)', () => {
    // `%` is infix Mod at multiplicative precedence (same tier as `*`/`/`).
    expect(validEpsil('a % b')).toStrictEqual(['Mod', 'a', 'b']);
    expect(validEpsil('a%b')).toStrictEqual(['Mod', 'a', 'b']);
    // `%` binds tighter than `+`, so `a + b % c` is `a + (b % c)`.
    expect(validEpsil('a + b % c')).toStrictEqual([
      'Add',
      'a',
      ['Mod', 'b', 'c'],
    ]);
    // Left-associative binary (same as `*`/`/`).
    expect(validEpsil('a % b % c')).toStrictEqual([
      'Mod',
      ['Mod', 'a', 'b'],
      'c',
    ]);
    // Same tier as `*`: left-associative, left-to-right.
    expect(validEpsil('a * b % c')).toStrictEqual([
      'Mod',
      ['Multiply', 'a', 'b'],
      'c',
    ]);
  });
  test('Factorial (postfix `!`)', () => {
    expect(validEpsil('5!')).toStrictEqual(['Factorial', 5]);
    expect(validEpsil('n!')).toStrictEqual(['Factorial', 'n']);
    // Prefix `!` (Not) is unchanged — position disambiguates.
    expect(validEpsil('!x')).toStrictEqual(['Not', 'x']);
    // `!=` stays NotEqual (the lexer munches `!=` into one token).
    expect(validEpsil('x != y')).toStrictEqual(['NotEqual', 'x', 'y']);
    expect(validEpsil('x!=y')).toStrictEqual(['NotEqual', 'x', 'y']);
    // Factorial binds tighter than Power's operands: `2^3!` = `2^(3!)`.
    expect(validEpsil('2^3!')).toStrictEqual(['Power', 2, ['Factorial', 3]]);
    // …and `3! ^ 2` = `(3!)^2` (spaced, since the lexer munches `!^`).
    expect(validEpsil('3! ^ 2')).toStrictEqual(['Power', ['Factorial', 3], 2]);
    // Prefix `-` is looser than postfix `!`: `-3!` = `-(3!)`.
    expect(validEpsil('-3!')).toStrictEqual(['Negate', ['Factorial', 3]]);
    // Applies after a parenthesized expression, a call, and an index.
    expect(validEpsil('(a + b)!')).toStrictEqual([
      'Factorial',
      ['Add', 'a', 'b'],
    ]);
    expect(validEpsil('f(x)!')).toStrictEqual(['Factorial', ['f', 'x']]);
    // Factorial as an operand of an infix operator.
    expect(validEpsil('n! + 1')).toStrictEqual(['Add', ['Factorial', 'n'], 1]);
  });
  test('Invalid postfix `!`', () => {
    // A postfix `!` must abut its operand: `x !y` (space before `!`) is not a
    // factorial — `x` ends and the abutting `!y` (prefix Not) has no separator.
    expect(invalidEpsil('x !y')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '!']],
    ]);
  });
  test('Range operator `..` (and Unicode `‥`)', () => {
    expect(validEpsil('1..5')).toStrictEqual(['Range', 1, 5]);
    expect(validEpsil('1‥5')).toStrictEqual(['Range', 1, 5]);
    expect(validEpsil('1 .. 5')).toStrictEqual(['Range', 1, 5]);
    expect(validEpsil('x..y')).toStrictEqual(['Range', 'x', 'y']);
    expect(validEpsil('(a + 1)..(b - 1)')).toStrictEqual([
      'Range',
      ['Add', 'a', 1],
      ['Subtract', 'b', 1],
    ]);
    // `..` binds looser than `-` (so `1..n-1` is `1..(n-1)`) and tighter than
    // the relational operators (so `k in 1..5` is `k in (1..5)`).
    expect(validEpsil('1..n - 1')).toStrictEqual([
      'Range',
      1,
      ['Subtract', 'n', 1],
    ]);
    expect(validEpsil('k in 1..5')).toStrictEqual([
      'Element',
      'k',
      ['Range', 1, 5],
    ]);
  });
  test('`..` does not disturb decimal literals', () => {
    // The maximal-munch fix keeps `1.5`/`1.`/`3.14` as numbers, and `1..5` as a
    // range (not `1.` `.5`).
    expect(validEpsil('1.5')).toStrictEqual(1.5);
    expect(validEpsil('3.14')).toStrictEqual(3.14);
    expect(validEpsil('1..5')).toStrictEqual(['Range', 1, 5]);
  });
});

describe('EPSIL PARSING BOOLEAN LITERALS', () => {
  test('`true`/`false` are input aliases for `True`/`False`', () => {
    expect(validEpsil('true')).toStrictEqual('True');
    expect(validEpsil('false')).toStrictEqual('False');
    expect(validEpsil('true && false')).toStrictEqual([
      'And',
      'True',
      'False',
    ]);
    expect(validEpsil('!true')).toStrictEqual(['Not', 'True']);
    expect(validEpsil('let x = true')).toStrictEqual([
      'Declare',
      'x',
      ['Dictionary', ['KeyValuePair', 'value', 'True']],
    ]);
  });
  test('the verbatim form still names a plain symbol', () => {
    expect(validEpsil('`true`')).toStrictEqual('true');
  });
  test('`true`/`false` are reserved as binding names', () => {
    expect(invalidEpsil('let true = 1')).toStrictEqual([
      'Error',
      ['String', ['reserved-word', 'true']],
    ]);
    expect(invalidEpsil('const false = 2')).toStrictEqual([
      'Error',
      ['String', ['reserved-word', 'false']],
    ]);
  });
});

// The parser and serializer both read the shared `operators.ts` table, so a
// serialized operator row must parse back to itself.
describe('EPSIL OPERATOR ROUND-TRIP', () => {
  test('parse(serialize(row)) is identity', () => {
    const rows = [
      ['Add', 'a', 'b'],
      ['Subtract', 'a', 'b'],
      ['Multiply', 'a', 'b'],
      ['Divide', 'a', 'b'],
      ['Mod', 'a', 'b'],
      ['Power', 'a', 'b'],
      ['Factorial', 'a'],
      ['Equal', 'a', 'b'],
      ['Same', 'a', 'b'],
      ['IdenticallyEqual', 'a', 'b'],
      ['And', 'a', 'b'],
      ['Or', 'a', 'b'],
      ['Less', 'a', 'b'],
      ['LessEqual', 'a', 'b'],
      ['Element', 'a', 'b'],
      ['NotElement', 'a', 'b'],
      ['KeyValuePair', 'a', 'b'],
    ];
    for (const row of rows) {
      expect(validEpsil(serializeEpsil(row as any))).toStrictEqual(row);
    }
  });

  test('parse(serialize(x)) for collections, calls and indexing', () => {
    const rows: any[] = [
      ['List', 'a', 'b'],
      ['List'],
      ['Set', 'a', 'b'],
      ['Set'],
      ['Tuple', 'a', 'b'],
      ['At', 'xs', 'i'],
      ['At', ['Add', 'a', 'b'], 1],
      ['Apply', ['g', 'f'], 'x'],
      ['f', 'x', 'y'],
      ['f'],
      ['Dictionary'],
      ['Dictionary', ['KeyValuePair', { str: 'a' }, 'b']],
      [
        'Dictionary',
        ['KeyValuePair', { str: 'a' }, 'b'],
        ['KeyValuePair', { str: 'c' }, ['Add', 2, 1]],
      ],
    ];
    for (const row of rows) {
      expect(validEpsil(serializeEpsil(row as any))).toStrictEqual(row);
    }
  });
});

describe('EPSIL PARSING FUNCTIONS', () => {
  test('Functions', () => {
    expect(validEpsil('f()')).toMatchInlineSnapshot(`
      [
        f,
      ]
    `);
    expect(validEpsil('f(x)')).toMatchInlineSnapshot(`
      [
        f,
        x,
      ]
    `);
    expect(validEpsil('f(x, y)')).toMatchInlineSnapshot(`
      [
        f,
        x,
        y,
      ]
    `);
    expect(validEpsil('Add()')).toMatchInlineSnapshot(`
      [
        Add,
      ]
    `);
    expect(validEpsil('Add(2, 3)')).toMatchInlineSnapshot(`
      [
        Add,
        2,
        3,
      ]
    `);
    // A verbatim symbol (needs backticks because `new` is a reserved word)
    // as a call head. Verbatim content is literal and must be a valid
    // MathJSON symbol, so e.g. `` `a+b` `` or `` `\sin` `` are not
    // expressible as Epsil symbols.
    expect(validEpsil('`new`(x)')).toMatchInlineSnapshot(`
      [
        new,
        x,
      ]
    `);
    expect(validEpsil('Apply(g(f), [x, 1, 0])')).toMatchInlineSnapshot(`
      [
        Apply,
        [
          g,
          f,
        ],
        [
          List,
          x,
          1,
          0,
        ],
      ]
    `);
  });
});

describe('EPSIL PARSING `do { … }` BLOCK EXPRESSIONS', () => {
  test('a do-block in expression position is a Block', () => {
    // The `do` keyword turns the brace-delimited statement block (otherwise the
    // `{…}` collection grammar) into a `Block` usable anywhere an expression
    // can. Its value is its final statement.
    expect(validEpsil('do { let t = 3; t + 1 }')).toStrictEqual([
      'Block',
      ['Declare', 't', ['Dictionary', ['KeyValuePair', 'value', 3]]],
      ['Add', 't', 1],
    ]);
  });

  test('a do-block as an assignment RHS', () => {
    expect(validEpsil('let y = do { let t = 3; t + 1 }')).toStrictEqual([
      'Declare',
      'y',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'value',
          [
            'Block',
            ['Declare', 't', ['Dictionary', ['KeyValuePair', 'value', 3]]],
            ['Add', 't', 1],
          ],
        ],
      ],
    ]);
  });

  test('a do-block as a lambda body', () => {
    expect(validEpsil('x => do { let t = x * x; t + 1 }')).toStrictEqual([
      'Function',
      [
        'Block',
        [
          'Declare',
          't',
          ['Dictionary', ['KeyValuePair', 'value', ['Multiply', 'x', 'x']]],
        ],
        ['Add', 't', 1],
      ],
      'x',
    ]);
  });

  test('an empty do-block is `["Block"]`', () => {
    expect(validEpsil('do {}')).toStrictEqual(['Block']);
  });

  test('a single-statement do-block', () => {
    expect(validEpsil('do { 42 }')).toStrictEqual(['Block', 42]);
  });

  test('a bare `{…}` lambda body stays a Set (no regression)', () => {
    expect(validEpsil('x => {1, 2}')).toStrictEqual([
      'Function',
      ['Set', 1, 2],
      'x',
    ]);
  });

  test('`do` not followed by `{` is a diagnostic', () => {
    const [, diags] = parseEpsil('do 5');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['opening-bracket-expected', '{']);
  });

  test('`do` used as a bare value (no `{`) is a diagnostic', () => {
    // In expression position `do` opens a block; without a following `{` it is
    // an `opening-bracket-expected` diagnostic (not a bare reserved-word one).
    const [, diags] = parseEpsil('y = do');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['opening-bracket-expected', '{']);
  });

  test('`do` stays contextually usable as a binding name', () => {
    // Reserved words other than the boolean literals `true`/`false` remain
    // usable as identifiers (existing convention), so `let do = 1` is accepted.
    const [, diags] = parseEpsil('let do = 1');
    expect(diags).toEqual([]);
  });
});

describe('EPSIL PARSING ZERO-PARAMETER LAMBDAS', () => {
  test('`() => expr` is a zero-parameter Function', () => {
    expect(validEpsil('() => 42')).toStrictEqual(['Function', 42]);
  });

  test('a zero-argument call `c()` parses', () => {
    expect(validEpsil('c()')).toStrictEqual(['c']);
  });

  test('a bare `()` (not before `=>`) is still a diagnostic', () => {
    const [, diags] = parseEpsil('()');
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].message).toStrictEqual(['expression-expected']);
  });
});

describe('EPSIL PARSING SPREAD ARGUMENTS', () => {
  test('`f(...p)` is a Spread argument', () => {
    expect(validEpsil('f(...p)')).toStrictEqual(['f', ['Spread', 'p']]);
  });

  test('spread mixes with positional arguments', () => {
    expect(validEpsil('f(1, ...p, q)')).toStrictEqual([
      'f',
      1,
      ['Spread', 'p'],
      'q',
    ]);
  });

  test('a parenthesized tuple can be spread', () => {
    expect(validEpsil('f(...(1, 2))')).toStrictEqual([
      'f',
      ['Spread', ['Tuple', 1, 2]],
    ]);
  });

  test('multiple spreads in one call', () => {
    expect(validEpsil('f(...p, ...q)')).toStrictEqual([
      'f',
      ['Spread', 'p'],
      ['Spread', 'q'],
    ]);
  });

  test('spread is a diagnostic outside a spreadable position', () => {
    // Since 2026-08-14 a LIST literal is a spreadable position too
    // (`[...p]` is valid — see EPSIL PARSING LIST SPREAD below); a bare
    // expression position still is not.
    const [, inLet] = parseEpsil('let x = ...p');
    expect(inLet.length).toBeGreaterThan(0);
  });
});

describe('EPSIL ABSENCE COALESCING `??`', () => {
  test('`a ?? b` is Coalesce', () => {
    expect(validEpsil('a ?? b')).toStrictEqual(['Coalesce', 'a', 'b']);
  });

  test('right-associative: a chain falls through left to right', () => {
    expect(validEpsil('a ?? b ?? c')).toStrictEqual([
      'Coalesce',
      'a',
      ['Coalesce', 'b', 'c'],
    ]);
  });

  test('LOOSER than `|>`: the default is for the pipeline result', () => {
    expect(validEpsil('xs |> f ?? 0')).toStrictEqual([
      'Coalesce',
      ['Pipe', 'xs', 'f'],
      0,
    ]);
  });

  test('TIGHTER than `=>`: the default is inside the lambda body', () => {
    expect(validEpsil('x => x.a ?? 0')).toStrictEqual([
      'Function',
      ['Coalesce', ['Field', 'x', { str: 'a' }], 0],
      'x',
    ]);
  });

  test('looser than `||` (the C# position)', () => {
    expect(validEpsil('a ?? b || c')).toStrictEqual([
      'Coalesce',
      'a',
      ['Or', 'b', 'c'],
    ]);
  });
});

/**
 * Pipe-stage sugar, parser half (2026-08-13; the runtime half — implicit
 * topic argument and implicit Map — is pinned in `execute.test.ts` and
 * `test/compute-engine/functions.test.ts`).
 */
describe('EPSIL PARSING PIPE-STAGE SUGAR', () => {
  test('a `=>` after a pipe operand forms the stage lambda', () => {
    // Globally `=>` (15) is looser than `|>` (20); only in stage position
    // does the mapsto bind tighter, and its body ends at the next `|>`.
    expect(validEpsil('a |> x => x^2 |> Sum')).toStrictEqual([
      'Pipe',
      ['Pipe', 'a', ['Function', ['Power', 'x', 2], 'x']],
      'Sum',
    ]);
  });

  test('a curried stage lambda right-associates', () => {
    expect(validEpsil('a |> x => y => x + y')).toStrictEqual([
      'Pipe',
      'a',
      ['Function', ['Function', ['Add', 'x', 'y'], 'y'], 'x'],
    ]);
  });

  test('a stage lambda still yields the pipeline result to `??`', () => {
    expect(validEpsil('xs |> x => x + 1 ?? 0')).toStrictEqual([
      'Coalesce',
      ['Pipe', 'xs', ['Function', ['Add', 'x', 1], 'x']],
      0,
    ]);
  });

  test('an operator-written placeholder stage becomes a Function literal', () => {
    expect(validEpsil('a |> _^2')).toStrictEqual([
      'Pipe',
      'a',
      ['Function', ['Power', '_', 2]],
    ]);
    expect(validEpsil('a ~> -_')).toStrictEqual([
      'Pipe',
      'a',
      ['Function', ['Negate', '_']],
    ]);
  });

  test('a CALL stage with a placeholder is left alone (`_` is the topic)', () => {
    expect(validEpsil('a |> Take(_, 10)')).toStrictEqual([
      'Pipe',
      'a',
      ['Take', '_', 10],
    ]);
    expect(validEpsil('a |> Take(10)')).toStrictEqual([
      'Pipe',
      'a',
      ['Take', 10],
    ]);
    // Indexing is call-shaped too: `_[2]` reads the topic's element.
    expect(validEpsil('a |> _[2]')).toStrictEqual([
      'Pipe',
      'a',
      ['At', '_', 2],
    ]);
  });

  test('a bare `_` stage stays the identity shorthand', () => {
    expect(validEpsil('a |> _')).toStrictEqual(['Pipe', 'a', '_']);
  });
});

/**
 * List-literal spread (2026-08-14): `...expr` as a list element parses to
 * `["Spread", expr]` — the same marker call arguments use — and `List`'s
 * canonicalization splices it (see `canonicalList`,
 * `library/collections.ts`; execution pins in `execute.test.ts`).
 */
describe('EPSIL PARSING LIST SPREAD', () => {
  test('spread elements parse to Spread nodes', () => {
    expect(validEpsil('[...xs, 3]')).toStrictEqual([
      'List',
      ['Spread', 'xs'],
      3,
    ]);
    expect(validEpsil('[1, ...xs, ...ys]')).toStrictEqual([
      'List',
      1,
      ['Spread', 'xs'],
      ['Spread', 'ys'],
    ]);
  });

  test('the spread operand is a full expression', () => {
    expect(validEpsil('[...(1..4)]')).toStrictEqual([
      'List',
      ['Spread', ['Range', 1, 4]],
    ]);
    expect(validEpsil('[...Join(xs, ys)]')).toStrictEqual([
      'List',
      ['Spread', ['Join', 'xs', 'ys']],
    ]);
  });

  test('call-argument spread is unchanged', () => {
    expect(validEpsil('f(...t)')).toStrictEqual(['f', ['Spread', 't']]);
  });

  test('brace spread: a `->`-free brace is a set-spread', () => {
    expect(validEpsil('{1, ...s}')).toStrictEqual([
      'Set',
      1,
      ['Spread', 's'],
    ]);
    expect(validEpsil('{...a, ...b}')).toStrictEqual([
      'Set',
      ['Spread', 'a'],
      ['Spread', 'b'],
    ]);
  });

  test('brace spread: any `->` element makes it a dictionary merge', () => {
    expect(validEpsil('{...d, "k" -> 1}')).toStrictEqual([
      'Dictionary',
      ['Spread', 'd'],
      ['KeyValuePair', { str: 'k' }, 1],
    ]);
    // The bare `->` marker (cf. the empty dictionary `{->}`) forces the
    // dictionary reading of a pure merge.
    expect(validEpsil('{->, ...d1, ...d2}')).toStrictEqual([
      'Dictionary',
      ['Spread', 'd1'],
      ['Spread', 'd2'],
    ]);
  });

  test('the `->` marker is FIRST-element only; elsewhere it is a diagnostic', () => {
    const [, diags] = parseEpsil('{"x" -> 1, ->}');
    expect(diags.length).toBeGreaterThan(0);
  });

  test('tighter than `=`, so it is the whole initializer', () => {
    expect(validEpsil('let t = c ?? 30')).toStrictEqual([
      'Declare',
      't',
      ['Dictionary', ['KeyValuePair', 'value', ['Coalesce', 'c', 30]]],
    ]);
  });

  test('an index access is a natural left operand', () => {
    expect(validEpsil('xs[1] ?? 0')).toStrictEqual([
      'Coalesce',
      ['At', 'xs', 1],
      0,
    ]);
  });
});

describe('EPSIL TYPE TEST `is`', () => {
  test('`x is integer` lowers to the MatchesType test', () => {
    // The single IR of every type test (first-class types phase 2,
    // `docs/plans/2026-08-18-first-class-types.md` §3.2): the source text
    // rides a `TypeFrom` that settles engine-side.
    expect(validEpsil('x is integer')).toStrictEqual([
      'MatchesType',
      'x',
      ['TypeFrom', { str: 'integer' }],
    ]);
  });

  test('it binds tighter than `&&`/`||`, so tests conjoin', () => {
    // The TYPE grammar's `&`/`|` must not swallow the EXPRESSION grammar's
    // `&&`/`||`: the lexer munches `&&`/`||` into single tokens, so only a
    // LONE `|`/`&` continues a type.
    expect(validEpsil('x is integer && y is string')).toStrictEqual([
      'And',
      ['MatchesType', 'x', ['TypeFrom', { str: 'integer' }]],
      ['MatchesType', 'y', ['TypeFrom', { str: 'string' }]],
    ]);
    expect(validEpsil('x is integer || y is string')).toStrictEqual([
      'Or',
      ['MatchesType', 'x', ['TypeFrom', { str: 'integer' }]],
      ['MatchesType', 'y', ['TypeFrom', { str: 'string' }]],
    ]);
  });

  test('it binds looser than arithmetic', () => {
    expect(validEpsil('x + 1 is integer')).toStrictEqual([
      'MatchesType',
      ['Add', 'x', 1],
      ['TypeFrom', { str: 'integer' }],
    ]);
  });

  test('it is usable as an `if` condition', () => {
    expect(validEpsil('if x is integer { 1 } else { 2 }')).toStrictEqual([
      'If',
      ['MatchesType', 'x', ['TypeFrom', { str: 'integer' }]],
      ['Block', 1],
      ['Block', 2],
    ]);
  });

  test('a misspelled type is a parse-time diagnostic', () => {
    const [, diags] = parseEpsil('x is intger');
    expect(diags.map((d) => (d.message as string[])[0])).toContain(
      'type-annotation-error'
    );
  });

  test('a COMPOUND type is supported, carrying its source text', () => {
    // Formerly diagnosed `type-pattern-unsupported`; the typed-pattern work
    // (first-class types phase 2) lifted the simple-name restriction.
    for (const [src, text] of [
      ['x is integer | string', 'integer | string'],
      ['x is !error', '!error'],
      ['x is list<integer>', 'list<integer>'],
    ] as const) {
      const [, diags] = parseEpsil(src);
      expect([src, diags.length]).toEqual([src, 0]);
      expect(validEpsil(src)).toStrictEqual([
        'MatchesType',
        'x',
        ['TypeFrom', { str: text }],
      ]);
    }
  });

  test('`is` stays an ordinary identifier outside the test position', () => {
    expect(parseEpsil('let is = 5')[1]).toEqual([]);
    expect(validEpsil('f(is)')).toStrictEqual(['f', 'is']);
    expect(validEpsil('is + 1')).toStrictEqual(['Add', 'is', 1]);
  });

  test('the TYPE must be on the same line as `is` too', () => {
    // The left-side guard alone let the test reach across a statement
    // separator: `x is` / `integer + 1` silently fused into
    // `Add(Element(x, integer), 1)` with no diagnostic at all.
    const [expr, diags] = parseEpsil('x is\ninteger + 1');
    expect(diags.map((d) => (d.message as string[])[0])).toEqual([
      'type-annotation-error',
    ]);
    // The two statements stay separate: the `+ 1` belongs to the SECOND one.
    const bare = JSON.parse(
      JSON.stringify(expr, (k, v) => (k === 'sourceOffsets' ? undefined : v))
    );
    expect(bare).toEqual({
      fn: [
        'Block',
        { sym: 'x' },
        { fn: ['Add', { sym: 'integer' }, { num: '1' }] },
      ],
    });
  });

  test('it must be on the SAME LINE as its left operand', () => {
    // A linebreak is a statement separator, and `is` is still spellable as an
    // identifier — so an `is` starting a line is a new statement reading that
    // variable, not a type test on the previous one.
    expect(parseEpsil('x\nis + 1')[1]).toEqual([]);
    expect(validEpsil('x\nis + 1')).toStrictEqual([
      'Block',
      'x',
      ['Add', 'is', 1],
    ]);
  });
});
