import { stringValue } from '../../src/math-json/utils';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { validCortex, invalidCortex } from '../utils';

describe('CORTEX PARSING SHEBANG', () => {
  test('Valid shebang', () => {
    expect(validCortex('#! /bin/cortex\n3.14 ')).toBe(3.14);
  });
  test('Invalid shebang', () => {
    // @fixme: should output shebang specific error message
    expect(invalidCortex('\n#! boo\n ')).toMatchInlineSnapshot(`
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

describe('CORTEX PARSING DIRECTIVES', () => {
  test('Navigator directive', () => {
    // `navigator` is not available when running in a node environment
    // node v22 added support for the navigator object
    const ua = validCortex('#navigator("userAgent")');
    const validUa = ua === 'Undefined' || stringValue(ua)?.startsWith('Node');
    expect(validUa).toBe(true);
  });
  test('Environment variable directive', () => {
    expect(validCortex('#env("HOME")')).toStrictEqual({
      str: process.env['HOME'],
    });
  });
  test('Warning directive', () => {
    // `#warning` no longer writes to the console; it evaluates to its
    // interpolated message as a string value.
    expect(validCortex('#warning("hello")')).toStrictEqual({ str: 'hello' });
  });
  test('Date directive', () => {
    // Assert the format shape (`YYYY-MM-DD`), never the actual date value.
    expect(validCortex('#date')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('CORTEX PARSING SPACES', () => {
  test('Whitespace', () => {
    expect(validCortex(' ')).toBe('Nothing');
    expect(validCortex(' \t ')).toBe('Nothing');
    expect(validCortex(' \t\n ')).toBe('Nothing');
    expect(validCortex(' \u2000 ')).toBe('Nothing');
    expect(validCortex(' \u2009 ')).toBe('Nothing');
    // Two expressions on one line with no separator (a tab is not a linebreak)
    // is a diagnostic — no silent `Do`-juxtaposition (language-review §2.5).
    expect(validCortex('1\t2')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '2']],
    ]);
    // A tab is whitespace on both sides of `+`, so it parses as an infix Add.
    expect(validCortex('1\t+\t2')).toStrictEqual(['Add', 1, 2]);
    expect(validCortex(' 2 \t 1')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '1']],
    ]);
  });
});

describe('CORTEX PARSING COMMENTS', () => {
  test('Single-line comments', () => {
    expect(validCortex('// Comment')).toBe('Nothing');
    expect(validCortex('/// Documentation **comment**')).toBe('Nothing');
    expect(validCortex('3.14 // Trailing comment')).toBe(3.14);
    expect(validCortex('   // inline // comment')).toBe('Nothing');
    expect(validCortex('  12 // inline // comment')).toBe(12);
    expect(validCortex('  12 // inline 👩🏻‍🎤 // comment')).toBe(12);
    expect(validCortex('  12 /// inline 👩🏻‍🎤 // documentation')).toBe(12);
    expect(validCortex('  12 /// inline\n 👩🏻‍🎤 // documentation')).toStrictEqual([
      'Do',
      12,
      '👩🏻‍🎤',
    ]);
  });
  test('Multi-line comments;', () => {
    expect(
      validCortex(`3.14
/*
 * Multi-line comment
 */`)
    ).toBe(3.14);

    // A `+` with whitespace on both sides (a space, then a linebreak) is an
    // infix operator that continues onto the next line.
    expect(
      validCortex(`3.14 +
3.14 /*
 * Multi-line comment
 */`)
    ).toStrictEqual(['Add', 3.14, 3.14]);
    expect(
      validCortex(`3.14 +
5.67 /*
 * Nested /* Comment */
 */`)
    ).toStrictEqual(['Add', 3.14, 5.67]);
  });
  test('Invalid multiline comment', () => {
    expect(invalidCortex(`   /* over nested /* comment */ */ */`))
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

    expect(invalidCortex(`   /* under nested /* comment */`))
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

describe('CORTEX PARSING NUMBERS', () => {
  test('Constants', () => {
    expect(validCortex('NaN')).toStrictEqual('NaN');
    expect(validCortex('-Infinity')).toStrictEqual('NegativeInfinity');
    expect(validCortex('Infinity')).toStrictEqual('PositiveInfinity');
    expect(validCortex('+Infinity')).toStrictEqual('PositiveInfinity');
  });
  test('Integers', () => {
    expect(validCortex('0')).toBe(0);
    expect(validCortex('1234')).toBe(1234);
    expect(validCortex('62737547')).toBe(62737547);
    expect(validCortex('62_73_7__547')).toBe(62737547);
  });
  test('Signed Integers', () => {
    expect(validCortex('+0')).toBe(0);
    expect(validCortex('-0')).toBe(0);
    expect(validCortex('+62737547')).toBe(62737547);
    expect(validCortex('-62_73_7__547')).toBe(-62737547);
  });
  test('Floating-point number', () => {
    expect(validCortex('0.1e-4')).toBe(0.00001);
    expect(validCortex('1.2')).toBe(1.2);
    expect(validCortex('1.2000')).toBe(1.2);
    expect(validCortex('0001.2000')).toBe(1.2);
    expect(validCortex('62_73_7547.38383e-2')).toBe(627375.4738383);
    expect(validCortex('62_73_7547.38383')).toBe(62737547.38383);
  });
  test('Signed Floating-point number', () => {
    expect(validCortex('+1.2')).toBe(1.2);
    expect(validCortex('-62_73_7547.38383e-13')).toBe(-0.000006273754738383);
    expect(validCortex('+62_73_7547.38383')).toBe(62737547.38383);
    expect(validCortex('-62_73_7547.38383')).toBe(-62737547.38383);
  });

  test('Binary numbers', () => {
    expect(validCortex('0b0101001011')).toBe(331);
    expect(validCortex('0b0101001011.1')).toBe(331.5);
    expect(validCortex('0b0101001011.110101')).toBe(331.828125);
    expect(validCortex('0b10e2')).toBe(200);
    expect(validCortex('0b10p4')).toBe(32);
    expect(validCortex('0b0101001011.110101e-4')).toBe(0.0331828125);
    expect(validCortex('0b0101001011E-4')).toBe(0.0331);
    expect(validCortex('0b0101001011.001')).toBe(331.125);
    expect(validCortex('0b0101001011.001p-2')).toBe(82.78125);
    expect(validCortex('-0b0')).toBe(0);
    expect(validCortex('-0b10')).toBe(-2);
  });
  test('Invalid Floating-point number', () => {
    expect(invalidCortex('1.2.3')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('2et')).toStrictEqual([
      'UnexpectedSuccess',
      ['Multiply', 2, 'et'],
    ]);
    // `k-13`: the number abuts `k` (invisible multiplication); the `-` has no
    // whitespace on either side, so it is an infix Subtract.
    expect(invalidCortex('62_73_7547.k-13')).toStrictEqual([
      'UnexpectedSuccess',
      ['Subtract', ['Multiply', 62737547, 'k'], 13],
    ]);
    expect(invalidCortex('62_73_7547k-13')).toStrictEqual([
      'UnexpectedSuccess',
      ['Subtract', ['Multiply', 62737547, 'k'], 13],
    ]);
    expect(invalidCortex('.1e-13')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('62_73_7547.e-13')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        0.0000062737547,
      ]
    `);
    expect(invalidCortex('-62_73_7547.e-13')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        -0.0000062737547,
      ]
    `);
  });
  test('Invalid Binary numbers', () => {
    // expect(invalidCortex('0b0b0')).toMatchInlineSnapshot();
    // expect(invalidCortex('0b01b01')).toMatchInlineSnapshot();
    // expect(invalidCortex('0b01c')).toMatchInlineSnapshot();
  });
  test('Hex numbers', () => {
    expect(validCortex('0xdeadbeef')).toBe(3735928559);
    expect(validCortex('-0xdeadbeef')).toBe(-3735928559);
    expect(validCortex('0xdead.beef')).toBe(57005.745834350586);
    expect(validCortex('0x3.0cp2')).toBe(12.1875);
    expect(validCortex('0xc.3p0')).toBe(12.1875);
    expect(validCortex('0x3.23d70a3d70a3ep0')).toBe(3.14);
    expect(validCortex('0x1.91eb851eb851fp+1')).toBe(3.14);
    expect(validCortex('0x400')).toBe(1024);
    expect(validCortex('0x1.0p-4')).toBe(0.0625);
    expect(validCortex('0x1.0p-8')).toBe(0.00390625);
    expect(validCortex('0x1.0p-10')).toBe(0.0009765625);
  });
});

describe('CORTEX PARSING SYMBOLS', () => {
  test('Symbols', () => {
    expect(validCortex('a')).toBe('a');
    expect(validCortex('abcdef')).toBe('abcdef');
    expect(validCortex('ABcde')).toBe('ABcde');
    expect(validCortex('été')).toBe('été');
    expect(validCortex('Thé')).toBe('Thé');
    expect(validCortex('garçon')).toBe('garçon');
    expect(validCortex('a01234')).toBe('a01234');
    expect(validCortex('_abc')).toBe('_abc');
    expect(validCortex('_01234')).toBe('_01234');
    expect(validCortex('👩🏻‍🎤🤯')).toBe('👩🏻‍🎤🤯');
  });
  test('Verbatim symbols', () => {
    expect(validCortex('`a`')).toBe('a');
    expect(validCortex('`a+b`')).toBe('a+b');
    expect(validCortex('`👩🏻‍🎤🤯`')).toBe('👩🏻‍🎤🤯');
  });
  test('Invalid Symbols', () => {
    expect(invalidCortex('`abc')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('`abc\nd`')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('``')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          empty-verbatim-symbol,
        ],
      ]
    `);
    // Start with a hash sign
    expect(invalidCortex('`#abcd`')).toMatchInlineSnapshot(`
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
    // Starts with a dollar sign:
    expect(invalidCortex('`$abcd`')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('`"abcd`')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('`ab cd`')).toMatchInlineSnapshot(`
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
    expect(validCortex('`Mind 🤯`')).toMatchInlineSnapshot(`
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
    // expect(invalidCortex('#abcd')).toMatchInlineSnapshot();
    // expect(invalidCortex('$abcd')).toMatchInlineSnapshot();
    // expect(invalidCortex('$ab_cd$')).toMatchInlineSnapshot();
  });
});

// Unsupported: these Unicode operator aliases currently parse as unexpected
// symbols rather than their ASCII/operator equivalents.
describe('CORTEX PARSING FANCY SYMBOLS', () => {
  test('Fancy symbols', () => {
    // ∧ → &&, ¬ → !, ⋁ → ||
    expect(validCortex('a ∧ ¬b ⋁ !c')).toStrictEqual([
      'Or',
      ['And', 'a', ['Not', 'b']],
      ['Not', 'c'],
    ]);
    // \u2212 2 \u00d7 x
    expect(validCortex('−2 × x >= 5')).toStrictEqual([
      'GreaterEqual',
      ['Multiply', -2, 'x'],
      5,
    ]);
    // `3πⅈ` is invisible multiplication — Stage B.
    // ∈ → in (Element). Fancy constant symbols (ℝ) stay literal in Stage A.
    expect(validCortex('3.1 ∈ ℝ')).toStrictEqual(['Element', 3.1, 'ℝ']);
  });
});

describe('CORTEX PARSING SINGLE-LINE STRINGS', () => {
  test('Valid string', () => {
    expect(validCortex('""')).toStrictEqual({ str: '' });
    expect(validCortex('"x"')).toStrictEqual({ str: 'x' });
    expect(validCortex('"hello world"')).toStrictEqual({
      str: 'hello world',
    });
    expect(validCortex(`"Ç‘est l’été!"`)).toStrictEqual({
      str: 'Ç‘est l’été!',
    });
    expect(validCortex(`"The multiplication sign is ×"`)).toStrictEqual({
      str: 'The multiplication sign is ×',
    });
    expect(validCortex(`"The set of real numbers is ℝ"`)).toStrictEqual({
      str: 'The set of real numbers is ℝ',
    });
  });

  test('String escaping', () => {
    expect(validCortex('"hello\\t world"')).toStrictEqual({
      str: 'hello\\t world',
    });
    expect(validCortex('"hello \\u0061 world"')).toStrictEqual({
      str: 'hello a world',
    });
    expect(validCortex('"hello \\u{0061} world"')).toStrictEqual({
      str: 'hello a world',
    });
    expect(validCortex('"hello \\u{1F30D}"')).toStrictEqual({
      str: 'hello \\ud83c\\udf0d',
    });
    expect(validCortex('"hello \\\\ world"')).toStrictEqual({
      str: 'hello \\\\ world',
    });
    expect(validCortex('"hello \\n world"')).toStrictEqual({
      str: 'hello \\n world',
    });
  });

  test('String interpolating', () => {
    expect(validCortex('"hello\\(" world")"')).toStrictEqual({
      str: 'hello world',
    });
    expect(validCortex('"hello \\(world)"')).toStrictEqual([
      'String',
      { str: 'hello ' },
      'world',
    ]);
    expect(validCortex('"hello \\()"')).toStrictEqual({ str: 'hello ' });

    expect(validCortex('"hello\\(3.1456)"')).toStrictEqual([
      'String',
      { str: 'hello' },
      3.1456,
    ]);
    // expect(validCortex('"hello\\(2 + 3 + x)"')).toMatchInlineSnapshot();
    // expect(
    //   validCortex('"hello \\(2 + 3 + x) is equal to \\(5 + x)"')
    // ).toMatchInlineSnapshot();
  });

  test('Invalid string', () => {
    expect(invalidCortex('"invalid \\x escape "')).toMatchInlineSnapshot(`
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

    // `end` is a reserved word, rejected in expression position.
    expect(invalidCortex('end"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            reserved-word,
            end,
          ],
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidCortex('end"\n')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            reserved-word,
            end,
          ],
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidCortex('"start\nend"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
          [
            reserved-word,
            end,
          ],
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidCortex('"start')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('"invalid \\x escape "')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('"invalid \\U0041 escape "')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('"invalid \\u23ghjik escape "'))
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
    expect(invalidCortex('"invalid \\u{defughjik} escape "'))
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
    expect(invalidCortex('"invalid \\u{20ffff} escape "'))
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
    expect(invalidCortex('"invalid \\u{d888} escape "')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('"start \\("')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('"start \\(+"')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('"start \\(end"')).toMatchInlineSnapshot(`
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
            reserved-word,
            end,
          ],
          [
            unexpected-symbol,
            ",
          ],
        ],
      ]
    `);
    expect(invalidCortex('"start \\( end"')).toMatchInlineSnapshot(`
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
            reserved-word,
            end,
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

describe('CORTEX PARSING MULTILINE STRINGS', () => {
  test('Valid string', () => {
    expect(validCortex('"""\nhello\nworld\n"""')).toStrictEqual({
      str: 'hello\\nworld',
    });

    expect(validCortex('"""\nhello\n \\u{1F30D}\n"""')).toStrictEqual({
      str: 'hello\\n \\ud83c\\udf0d',
    });

    expect(validCortex('"""\n   hello\n   world\n   """')).toStrictEqual({
      str: 'hello\\nworld',
    });

    expect(validCortex('"""\n\t\thello\n\t\tworld\n\t\t"""')).toStrictEqual({
      str: 'hello\\nworld',
    });

    expect(validCortex('"""\n\t  hello\n\t  world\n\t  """')).toStrictEqual({
      str: 'hello\\nworld',
    });

    expect(validCortex('"""\n\t  hello\\\n\t  world\n\t  """')).toStrictEqual({
      str: 'helloworld',
    });
  });
  test('Invalid string', () => {
    expect(invalidCortex('"""abc\nhello\nworld\n"""')).toMatchInlineSnapshot(`
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

    expect(invalidCortex('"""\nhello\nworld\n boo  """'))
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

describe('CORTEX PARSING EXTENDED STRINGS', () => {
  test('Valid string', () => {
    expect(validCortex('#"hello world"#')).toStrictEqual({
      str: 'hello world',
    });
    expect(validCortex('##"hello world"##')).toStrictEqual({
      str: 'hello world',
    });
    expect(validCortex('#"hello "world""#')).toStrictEqual({
      str: 'hello "world"',
    });
    expect(validCortex('#"hello \\n "world""#')).toMatchInlineSnapshot(`
      {
        str: hello \\n "world",
      }
    `);
  });
  test('Invalid string', () => {
    expect(invalidCortex('#"hello world"')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('##"hello world"#')).toMatchInlineSnapshot(`
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

describe('CORTEX PARSING DICTIONARY', () => {
  test('Empty dictionary', () => {
    expect(validCortex('{->}')).toMatchInlineSnapshot(`
      [
        Dictionary,
      ]
    `);
  });
  test('Empty dictionary', () => {
    expect(validCortex('Dictionary()')).toMatchInlineSnapshot(`
      [
        Dictionary,
      ]
    `);
  });

  test('Valid dictionary', () => {
    expect(validCortex('{ one -> 1}')).toMatchInlineSnapshot(`
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
    expect(validCortex('{ one -> 1, two -> 2}')).toMatchInlineSnapshot(`
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
    expect(validCortex('{ one -> 1, three -> 2 + 1}')).toMatchInlineSnapshot(`
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
    expect(validCortex('{x -> 1, y -> 2, z -> 2 + x}')).toMatchInlineSnapshot(`
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
    expect(validCortex('{x -> {a -> 7, b -> 5}, y -> 2, z -> 2 + x}'))
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
    expect(invalidCortex('{ one -> 1, one -> 2}')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('{ one -> 1, two -> 2, }')).toMatchInlineSnapshot(`
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
    expect(invalidCortex('{ one -> 1, , two -> 2}')).toMatchInlineSnapshot(`
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

describe('CORTEX PARSING COLLECTIONS', () => {
  test('Sets', () => {
    expect(validCortex('{}')).toMatchInlineSnapshot(`
      [
        Set,
      ]
    `);
    expect(validCortex('{1}')).toMatchInlineSnapshot(`
      [
        Set,
        1,
      ]
    `);
    expect(validCortex('{1, 2}')).toMatchInlineSnapshot(`
      [
        Set,
        1,
        2,
      ]
    `);
    expect(validCortex('{1, {2, 3}, 4}')).toMatchInlineSnapshot(`
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
    expect(validCortex('Set()')).toMatchInlineSnapshot(`
      [
        Set,
      ]
    `);
    expect(validCortex('Set(1, 2, 3)')).toMatchInlineSnapshot(`
      [
        Set,
        1,
        2,
        3,
      ]
    `);
    expect(validCortex('Set(1, {2, 3}, 3)')).toMatchInlineSnapshot(`
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
    expect(validCortex('[]')).toMatchInlineSnapshot(`
      [
        List,
      ]
    `);
    expect(validCortex('[1]')).toMatchInlineSnapshot(`
      [
        List,
        1,
      ]
    `);
    expect(validCortex('[1, 2]')).toMatchInlineSnapshot(`
      [
        List,
        1,
        2,
      ]
    `);
    expect(validCortex('[1, [2, 3], 4]')).toMatchInlineSnapshot(`
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
    expect(validCortex('List()')).toMatchInlineSnapshot(`
      [
        List,
      ]
    `);
    expect(validCortex('List(2, 2x, 4)')).toMatchInlineSnapshot(`
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
    expect(validCortex('List(2, [2x, 5], 4)')).toMatchInlineSnapshot(`
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
    expect(validCortex('1, 2, 3')).toMatchInlineSnapshot(`
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
    expect(validCortex('1,, 3')).toMatchInlineSnapshot(`
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
    expect(validCortex('1, 2,')).toMatchInlineSnapshot(`
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
    expect(validCortex(', 2,')).toMatchInlineSnapshot(`
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
    expect(validCortex('Sequence()')).toMatchInlineSnapshot(`
      [
        Sequence,
      ]
    `);
    expect(validCortex('Sequence(1, 2, 3)')).toMatchInlineSnapshot(`
      [
        Sequence,
        1,
        2,
        3,
      ]
    `);
    expect(validCortex('Sequence(1, 2x + 4, 3)')).toMatchInlineSnapshot(`
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
    expect(validCortex('()')).toMatchInlineSnapshot(`
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
    expect(validCortex('(a,b)')).toMatchInlineSnapshot(`
      [
        Tuple,
        a,
        b,
      ]
    `);
    expect(validCortex('(a,,b)')).toMatchInlineSnapshot(`
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
    expect(validCortex('(a , , b)')).toMatchInlineSnapshot(`
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
    expect(validCortex('Tuple()')).toMatchInlineSnapshot(`
      [
        Tuple,
      ]
    `);
    expect(validCortex('Tuple(a, 2b, c^3)')).toMatchInlineSnapshot(`
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

describe('CORTEX PARSING OPERATORS', () => {
  test('Unary Operators', () => {
    expect(validCortex('-x')).toStrictEqual(['Negate', 'x']);
    expect(validCortex('-(2+1)')).toStrictEqual(['Negate', ['Add', 2, 1]]);
    // Unary `+` on a non-literal is the identity.
    expect(validCortex('+(2+1)')).toStrictEqual(['Add', 2, 1]);
    expect(validCortex('!a')).toStrictEqual(['Not', 'a']);
    // `!!` maximal-munches into one operator token that peels into two `Not`s.
    expect(validCortex('!!a')).toStrictEqual(['Not', ['Not', 'a']]);
  });
  test('Invalid unary Operators', () => {
    // A prefix operator must abut its operand: `- x` (with a space) is invalid.
    expect(invalidCortex('- x')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '-']],
    ]);
  });
  test('Arithmetic Operators', () => {
    expect(validCortex('2 * x')).toStrictEqual(['Multiply', 2, 'x']);
    expect(validCortex('2*x')).toStrictEqual(['Multiply', 2, 'x']);
    expect(validCortex('-1 + -2')).toStrictEqual(['Add', -1, -2]);
    expect(validCortex('-1 * -2')).toStrictEqual(['Multiply', -1, -2]);
    expect(validCortex('-x * -y')).toStrictEqual([
      'Multiply',
      ['Negate', 'x'],
      ['Negate', 'y'],
    ]);
    expect(validCortex('(x + 1) * (x - 1)')).toStrictEqual([
      'Multiply',
      ['Add', 'x', 1],
      ['Subtract', 'x', 1],
    ]);
    expect(validCortex('1 + (2 + 3)')).toStrictEqual(['Add', 1, ['Add', 2, 3]]);
    expect(validCortex('2 * (2 + 3)')).toStrictEqual([
      'Multiply',
      2,
      ['Add', 2, 3],
    ]);
    // `2 (2 + 3)` is invisible multiplication — Stage B.
    expect(validCortex('x * -1 + x * 2')).toStrictEqual([
      'Add',
      ['Multiply', 'x', -1],
      ['Multiply', 'x', 2],
    ]);
    expect(validCortex('-x - -1')).toStrictEqual([
      'Subtract',
      ['Negate', 'x'],
      -1,
    ]);
    expect(validCortex('x * y + a * b')).toStrictEqual([
      'Add',
      ['Multiply', 'x', 'y'],
      ['Multiply', 'a', 'b'],
    ]);
    expect(validCortex('(x + y) * (a + b)')).toStrictEqual([
      'Multiply',
      ['Add', 'x', 'y'],
      ['Add', 'a', 'b'],
    ]);
    // Arithmetic is left-associative binary (n-ary folding happens later).
    expect(validCortex('x * y * a * b')).toStrictEqual([
      'Multiply',
      ['Multiply', ['Multiply', 'x', 'y'], 'a'],
      'b',
    ]);
  });
  test('Invalid Arithmetic Operators', () => {
    // Whitespace only on one side is invalid.
    // `2 *x`: `*` has a space before but not after → `2` ends, `*x` is not a
    // valid new statement.
    expect(invalidCortex('2 *x')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '*']],
    ]);
    // `2* x`: `*` has a space after but not before → asymmetric; recovers as
    // infix Multiply, but the diagnostic remains.
    expect(invalidCortex('2* x')).toStrictEqual([
      'Error',
      ['String', ['asymmetric-operator-whitespace', '*']],
    ]);
    // `-1+-2`: the lexer maximal-munches `+-` into one (non-operator) token, so
    // `-1` ends the first expression; `+-2` on the same line with no separator
    // is a diagnostic (language-review §2.5), no longer a silent `Do`.
    expect(invalidCortex('-1+-2')).toStrictEqual([
      'Error',
      ['String', ['unexpected-symbol', '+-']],
    ]);
  });
  test('Logic Operators', () => {
    expect(validCortex('x && y && (a || b)')).toStrictEqual([
      'And',
      ['And', 'x', 'y'],
      ['Or', 'a', 'b'],
    ]);
    expect(validCortex('x && !y || !(a&&b)')).toStrictEqual([
      'Or',
      ['And', 'x', ['Not', 'y']],
      ['Not', ['And', 'a', 'b']],
    ]);
    // `&&` binds tighter than `||`.
    expect(validCortex('x && !y || !a&&b')).toStrictEqual([
      'Or',
      ['And', 'x', ['Not', 'y']],
      ['And', ['Not', 'a'], 'b'],
    ]);
  });
  test('Relational Operators', () => {
    expect(validCortex('x * y == a + b')).toStrictEqual([
      'Equal',
      ['Multiply', 'x', 'y'],
      ['Add', 'a', 'b'],
    ]);
    expect(validCortex('0 > -1')).toStrictEqual(['Greater', 0, -1]);
    expect(validCortex('0 >= -1')).toStrictEqual(['GreaterEqual', 0, -1]);
    // A run of the same relational operator flattens to an n-ary node.
    expect(validCortex('a < b < c')).toStrictEqual(['Less', 'a', 'b', 'c']);
    // A mix of relational operators nests left-associatively.
    expect(validCortex('a < b <= c')).toStrictEqual([
      'LessEqual',
      ['Less', 'a', 'b'],
      'c',
    ]);
  });
  test('Invisible Operators', () => {
    expect(validCortex('2x')).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        x,
      ]
    `);
    expect(validCortex('x(2+1)')).toMatchInlineSnapshot(`
      [
        x,
        [
          Add,
          2,
          1,
        ],
      ]
    `);
    expect(validCortex('2(2+1)')).toMatchInlineSnapshot(`
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
    expect(validCortex('(a+b)(2+1)')).toMatchInlineSnapshot(`
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
    expect(validCortex('2 1/2')).toMatchInlineSnapshot(`
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
    expect(validCortex('x 1/2')).toMatchInlineSnapshot(`
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
    expect(validCortex('x^2')).toStrictEqual(['Power', 'x', 2]);
    // `^` binds tighter than `/`, so `x^1/2` is `(x^1)/2`.
    expect(validCortex('x^1/2')).toStrictEqual([
      'Divide',
      ['Power', 'x', 1],
      2,
    ]);
    expect(validCortex('x ^ 1 / 2')).toStrictEqual([
      'Divide',
      ['Power', 'x', 1],
      2,
    ]);
    expect(validCortex('(x + 1) ^ (n - 1)')).toStrictEqual([
      'Power',
      ['Add', 'x', 1],
      ['Subtract', 'n', 1],
    ]);
    // `**` is an alias for `^`.
    expect(validCortex('x**2')).toStrictEqual(['Power', 'x', 2]);
    // `^` is right-associative.
    expect(validCortex('2^3^2')).toStrictEqual(['Power', 2, ['Power', 3, 2]]);
  });
});

// The parser and serializer both read the shared `operators.ts` table, so a
// serialized operator row must parse back to itself.
describe('CORTEX OPERATOR ROUND-TRIP', () => {
  test('parse(serialize(row)) is identity', () => {
    const rows = [
      ['Add', 'a', 'b'],
      ['Subtract', 'a', 'b'],
      ['Multiply', 'a', 'b'],
      ['Divide', 'a', 'b'],
      ['Power', 'a', 'b'],
      ['Equal', 'a', 'b'],
      ['Same', 'a', 'b'],
      ['And', 'a', 'b'],
      ['Or', 'a', 'b'],
      ['Less', 'a', 'b'],
      ['LessEqual', 'a', 'b'],
      ['Element', 'a', 'b'],
      ['NotElement', 'a', 'b'],
      ['KeyValuePair', 'a', 'b'],
    ];
    for (const row of rows) {
      expect(validCortex(serializeCortex(row as any))).toStrictEqual(row);
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
      expect(validCortex(serializeCortex(row as any))).toStrictEqual(row);
    }
  });
});

describe('CORTEX PARSING FUNCTIONS', () => {
  test('Functions', () => {
    expect(validCortex('f()')).toMatchInlineSnapshot(`
      [
        f,
      ]
    `);
    expect(validCortex('f(x)')).toMatchInlineSnapshot(`
      [
        f,
        x,
      ]
    `);
    expect(validCortex('f(x, y)')).toMatchInlineSnapshot(`
      [
        f,
        x,
        y,
      ]
    `);
    expect(validCortex('Add()')).toMatchInlineSnapshot(`
      [
        Add,
      ]
    `);
    expect(validCortex('Add(2, 3)')).toMatchInlineSnapshot(`
      [
        Add,
        2,
        3,
      ]
    `);
    // A verbatim symbol (needs backticks because of the `+`) as a call head.
    // NOTE: the roadmap's `` `\sin` `` example is not expressible as a Cortex
    // symbol — `\` is a prohibited identifier-start character and `\s` is the
    // Cortex space escape, so `` `\sin` `` is a genuine invalid-symbol-name.
    expect(validCortex('`a+b`(x)')).toMatchInlineSnapshot(`
      [
        a+b,
        x,
      ]
    `);
    expect(validCortex('Apply(g(f), [x, 1, 0])')).toMatchInlineSnapshot(`
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
