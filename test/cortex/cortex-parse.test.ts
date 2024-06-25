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
    expect(validCortex('#navigator("userAgent")')).toBe('Nothing');
  });
  test('Environment variable directive', () => {
    expect(validCortex('#env("TERM")')).toStrictEqual({
      str: process.env['TERM'],
    });
  });
  test('Warning directive', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    validCortex('#warning("hello")');
    expect(spy).toHaveBeenLastCalledWith('hello');
    spy.mockRestore();
  });
  test('Date directive', () => {
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    const spy = jest.spyOn(console, 'log').mockImplementation(() => {});
    validCortex('#warning(#date)');
    const today = new Date();
    const expecteDate =
      today.getFullYear() +
      '-' +
      ('00' + (1 + today.getMonth())).slice(-2) +
      '-' +
      ('00' + (1 + today.getDay())).slice(-2);

    expect(spy).toHaveBeenLastCalledWith(expecteDate);
    spy.mockRestore();
  });
});

describe('CORTEX PARSING SPACES', () => {
  test('Whitespace', () => {
    expect(validCortex(' ')).toBe('Nothing');
    expect(validCortex(' \t ')).toBe('Nothing');
    expect(validCortex(' \t\n ')).toBe('Nothing');
    expect(validCortex(' \u2000 ')).toBe('Nothing');
    expect(validCortex(' \u2009 ')).toBe('Nothing');
    expect(validCortex('1\t2')).toStrictEqual(['Do', 1, 2]);
    // @fixme: should parse tab correctly
    expect(validCortex('1\t+\t2')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            +,
          ],
        ],
      ]
    `);
    expect(validCortex(' 2 \t 1')).toStrictEqual(['Do', 2, 1]);
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

    // @fixme: should parse multi-line comment correctly
    expect(
      validCortex(`3.14 +
3.14 /*
 * Multi-line comment
 */`)
    ).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            +,
          ],
        ],
      ]
    `);
    expect(
      validCortex(`3.14 +
5.67 /*
 * Nested /* Comment */
 */`)
    ).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            unexpected-symbol,
            +,
          ],
        ],
      ]
    `);
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
            *,
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
    // @todo: revisit
    expect(invalidCortex('2et')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        2et,
      ]
    `);
    expect(invalidCortex('62_73_7547.k-13')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        [
          Do,
          62737547,
          k,
          -13,
        ],
      ]
    `);
    expect(invalidCortex('62_73_7547k-13')).toMatchInlineSnapshot(`
      [
        UnexpectedSuccess,
        [
          Do,
          62737547,
          k,
          -13,
        ],
      ]
    `);
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

describe.skip('CORTEX PARSING FANCY SYMBOLS', () => {
  test('Fancy symbols', () => {
    expect(validCortex('a ∧ ¬b ⋁ !c')).toMatchInlineSnapshot();
    // \u2212 2 \u00d7 x
    expect(validCortex('−2 × x >= 5')).toMatchInlineSnapshot();
    expect(validCortex('3πⅈ')).toMatchInlineSnapshot();
    expect(validCortex('3.1 ∈ ℝ')).toMatchInlineSnapshot();
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
      str: 'hello 🌍',
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

    expect(invalidCortex('end"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            string-literal-opening-delimiter-expected,
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
            string-literal-opening-delimiter-expected,
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
            unexpected-symbol,
            e,
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
            string-literal-opening-delimiter-expected,
            ",
          ],
          [
            closing-bracket-expected,
            ),
          ],
          [
            string-literal-closing-delimiter-expected,
            ",
          ],
        ],
      ]
    `);
    expect(invalidCortex('"start \\(+"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            closing-bracket-expected,
            ),
          ],
        ],
      ]
    `);
    expect(invalidCortex('"start \\(end"')).toMatchInlineSnapshot(`
      [
        Error,
        [
          String,
          [
            closing-bracket-expected,
            ),
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
      str: 'hello\\n 🌍',
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
      str: 'hello\\\\\\n\\t  world',
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
            a,
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

describe.skip('CORTEX PARSING DICTIONARY', () => {
  test('Empty dictionary', () => {
    expect(validCortex('{->}')).toMatchInlineSnapshot();
  });
  test('Empty dictionary', () => {
    expect(validCortex('Dictionary()')).toMatchInlineSnapshot();
  });

  test('Valid dictionary', () => {
    expect(validCortex('{ one -> 1)')).toMatchInlineSnapshot();
    expect(validCortex('{ one -> 1, two -> 2)')).toMatchInlineSnapshot();
    expect(validCortex('{ one -> 1, three -> 2 + 1)')).toMatchInlineSnapshot();
    expect(validCortex('{x -> 1, y -> 2, z -> 2 + x}')).toMatchInlineSnapshot();
  });

  test('Nested dictionary', () => {
    expect(
      validCortex('{x -> {a -> 7, b -> 5}, y -> 2, z -> 2 + x}')
    ).toMatchInlineSnapshot();
  });

  test('Invalid dictionary', () => {
    expect(invalidCortex('{ one -> 1, one -> 2}')).toMatchInlineSnapshot();
    expect(invalidCortex('{ one -> 1, two -> 2, }')).toMatchInlineSnapshot();
    expect(invalidCortex('{ one -> 1, , two -> 2}')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING COLLECTIONS', () => {
  test('Sets', () => {
    expect(validCortex('{}')).toMatchInlineSnapshot();
    expect(validCortex('{1}')).toMatchInlineSnapshot();
    expect(validCortex('{1, 2}')).toMatchInlineSnapshot();
    expect(validCortex('{1, {2, 3}, 4}')).toMatchInlineSnapshot();
    expect(validCortex('Set()')).toMatchInlineSnapshot();
    expect(validCortex('Set(1, 2, 3)')).toMatchInlineSnapshot();
    expect(validCortex('Set(1, {2, 3}, 3)')).toMatchInlineSnapshot();
  });
  test('Lists', () => {
    expect(validCortex('[]')).toMatchInlineSnapshot();
    expect(validCortex('[1]')).toMatchInlineSnapshot();
    expect(validCortex('[1, 2]')).toMatchInlineSnapshot();
    expect(validCortex('[1, [2, 3], 4]')).toMatchInlineSnapshot();
    expect(validCortex('List()')).toMatchInlineSnapshot();
    expect(validCortex('List(2, 2x, 4)')).toMatchInlineSnapshot();
    expect(validCortex('List(2, [2x, 5], 4)')).toMatchInlineSnapshot();
  });
  test('Sequence', () => {
    expect(validCortex('1, 2, 3')).toMatchInlineSnapshot();
    expect(validCortex('1,, 3')).toMatchInlineSnapshot();
    expect(validCortex('1, 2,')).toMatchInlineSnapshot();
    expect(validCortex(', 2,')).toMatchInlineSnapshot();
    expect(validCortex('Sequence()')).toMatchInlineSnapshot();
    expect(validCortex('Sequence(1, 2, 3)')).toMatchInlineSnapshot();
    expect(validCortex('Sequence(1, 2x + 4, 3)')).toMatchInlineSnapshot();
  });
  test('Tuple', () => {
    expect(validCortex('()')).toMatchInlineSnapshot();
    expect(validCortex('(a,b)')).toMatchInlineSnapshot();
    expect(validCortex('(a,,b)')).toMatchInlineSnapshot();
    expect(validCortex('(a , , b)')).toMatchInlineSnapshot();
    expect(validCortex('Tuple()')).toMatchInlineSnapshot();
    expect(validCortex('Tuple(a, 2b, c^3)')).toMatchInlineSnapshot();
  });
  // Dictionaries: see above.
});

describe.skip('CORTEX PARSING OPERATORS', () => {
  test('Unary Operators', () => {
    expect(validCortex('-x')).toStrictEqual(['Negate', 'x']);
    // expect(validCortex('-(2+1)')).toMatchInlineSnapshot();
    // expect(validCortex('+(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('!a')).toStrictEqual(['Not', 'a']);
    expect(validCortex('!!a')).toMatchInlineSnapshot(`['Not', ['Not', 'a']]`);
  });
  test('Invalid unary Operators', () => {
    // Must not have whitespace before term
    expect(invalidCortex('- x')).toMatchInlineSnapshot(
      `['Error', ['unexpected-symbol', '-']]`
    );
  });
  test.skip('Arithmetic Operators', () => {
    expect(validCortex('2 * x')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('2*x')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('-1 + -2')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('-1 * -2')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('-x * -y')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('(x + 1) * (x - 1)')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('1 + (2 + 3)')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('2 * (2 + 3)')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('2 (2 + 3)')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('x * -1 + x * 2')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('-x - -1')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('x * y + a * b')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('(x + y) * (a + b)')).toMatchInlineSnapshot(`'Nothing'`);
    expect(validCortex('x * y * a * b')).toMatchInlineSnapshot(`'Nothing'`);
  });
  test.skip('Invalid Arithmetic Operators', () => {
    // Must have whitespace on both sides, or no whitespace
    expect(invalidCortex('2 *x')).toMatchInlineSnapshot();
    expect(invalidCortex('2* x')).toMatchInlineSnapshot();
    expect(invalidCortex('-1+-2')).toMatchInlineSnapshot();
    expect(invalidCortex('-1+-2')).toMatchInlineSnapshot();
  });
  test.skip('Logic Operators', () => {
    expect(validCortex('x && y && (a || b)')).toMatchInlineSnapshot();
    expect(validCortex('x && !y || !(a&&b)')).toMatchInlineSnapshot();
    expect(validCortex('x && !y || !a&&b')).toMatchInlineSnapshot();
  });
  test.skip('Relational Operators', () => {
    expect(validCortex('x * y == a + b')).toMatchInlineSnapshot();
    expect(validCortex('0 > -1')).toMatchInlineSnapshot();
    expect(validCortex('0 >= -1')).toMatchInlineSnapshot();
  });
  test.skip('Invisible Operators', () => {
    expect(validCortex('2x')).toMatchInlineSnapshot();
    expect(validCortex('x(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('2(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('(a+b)(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('2 1/2')).toMatchInlineSnapshot();
    expect(validCortex('x 1/2')).toMatchInlineSnapshot();
  });
  test.skip('Power', () => {
    expect(validCortex('x^2')).toMatchInlineSnapshot();
    expect(validCortex('x^1/2')).toMatchInlineSnapshot();
    expect(validCortex('x ^ 1 / 2')).toMatchInlineSnapshot();
    expect(validCortex('(x + 1) ^ (n - 1)')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING FUNCTIONS', () => {
  test('Functions', () => {
    expect(validCortex('f()')).toMatchInlineSnapshot();
    expect(validCortex('f(x)')).toMatchInlineSnapshot();
    expect(validCortex('f(x, y)')).toMatchInlineSnapshot();
    expect(validCortex('Add()')).toMatchInlineSnapshot();
    expect(validCortex('Add(2, 3)')).toMatchInlineSnapshot();
    expect(validCortex('`\\sin`(x)')).toMatchInlineSnapshot();
    expect(validCortex('Apply(g(f), [x, 1, 0])')).toMatchInlineSnapshot();
  });
});
