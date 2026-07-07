import { Lexer, tokenize } from '../../src/cortex/lexer';
import { Token, TokenType } from '../../src/cortex/tokens';

/** Tokenize and drop the trailing EOF for concise assertions. */
function lex(source: string): Token[] {
  const tokens = tokenize(source);
  expect(tokens[tokens.length - 1].type).toBe('EOF');
  return tokens.slice(0, -1);
}

/** The `[type, text]` pairs of the (non-EOF) token stream. */
function pairs(source: string): [TokenType, string][] {
  return lex(source).map((t) => [t.type, t.text]);
}

/** The token types of the (non-EOF) token stream. */
function types(source: string): TokenType[] {
  return lex(source).map((t) => t.type);
}

/** The single (non-EOF) token; fails if there is not exactly one. */
function single(source: string): Token {
  const tokens = lex(source);
  expect(tokens).toHaveLength(1);
  return tokens[0];
}

describe('CORTEX LEXER — numbers', () => {
  test('integers keep raw text', () => {
    expect(pairs('0')).toEqual([['NUMBER', '0']]);
    expect(pairs('1234')).toEqual([['NUMBER', '1234']]);
    expect(pairs('62737547')).toEqual([['NUMBER', '62737547']]);
  });

  test('underscore separators are preserved verbatim', () => {
    expect(single('62_73_7__547').text).toBe('62_73_7__547');
    expect(single('1_000.5e-2').text).toBe('1_000.5e-2');
  });

  test('floating point (with leading zeros, fraction, exponent)', () => {
    expect(single('0.1e-4').text).toBe('0.1e-4');
    expect(single('1.2').text).toBe('1.2');
    expect(single('0001.2000').text).toBe('0001.2000');
    expect(single('62_73_7547.38383e-2').text).toBe('62_73_7547.38383e-2');
    expect(single('1.25e2').text).toBe('1.25e2');
  });

  test('binary numbers (fraction + binary exponent markers)', () => {
    expect(single('0b0101001011').text).toBe('0b0101001011');
    expect(single('0b0101001011.110101').text).toBe('0b0101001011.110101');
    expect(single('0b10e2').text).toBe('0b10e2');
    expect(single('0b10p4').text).toBe('0b10p4');
    expect(single('0b0101001011.001p-2').text).toBe('0b0101001011.001p-2');
    expect(single('0B10').text).toBe('0B10');
  });

  test('hexadecimal numbers (e/E are digits, p is the exponent marker)', () => {
    expect(single('0xdeadbeef').text).toBe('0xdeadbeef');
    expect(single('0xdead.beef').text).toBe('0xdead.beef');
    expect(single('0x3.0cp2').text).toBe('0x3.0cp2');
    expect(single('0x1.91eb851eb851fp+1').text).toBe('0x1.91eb851eb851fp+1');
    expect(single('0x1F').text).toBe('0x1F');
    expect(single('0X400').text).toBe('0X400');
  });

  test('signs lex as OPERATOR tokens, not part of the number', () => {
    // Sign-vs-infix is resolved by the parser in Phase 2 using the
    // `precededByWhitespace` flag; the lexer keeps them separate.
    expect(pairs('-5')).toEqual([
      ['OPERATOR', '-'],
      ['NUMBER', '5'],
    ]);
    expect(pairs('+0')).toEqual([
      ['OPERATOR', '+'],
      ['NUMBER', '0'],
    ]);
    expect(pairs('-62_73_7__547')).toEqual([
      ['OPERATOR', '-'],
      ['NUMBER', '62_73_7__547'],
    ]);
  });

  test('a 40-digit integer lexes as ONE NUMBER token preserving all digits', () => {
    const big = '1234567890123456789012345678901234567890';
    expect(big).toHaveLength(40);
    const tok = single(big);
    expect(tok.type).toBe('NUMBER');
    expect(tok.text).toBe(big);
  });

  test('fullwidth digits are supported (kept as written)', () => {
    // U+FF11 U+FF12 U+FF13 → the number 123 (kept verbatim by the lexer).
    const tok = single('１２３');
    expect(tok.type).toBe('NUMBER');
    expect(tok.text).toBe('１２３');
  });

  test('a second decimal point ends the number and errors', () => {
    expect(pairs('1.2.3')).toEqual([
      ['NUMBER', '1.2'],
      ['ERROR', '.'],
      ['NUMBER', '3'],
    ]);
  });

  test('a stray exponent letter is not consumed', () => {
    expect(pairs('2et')).toEqual([
      ['NUMBER', '2'],
      ['SYMBOL', 'et'],
    ]);
  });
});

describe('CORTEX LEXER — symbols', () => {
  test('plain identifiers', () => {
    expect(pairs('a')).toEqual([['SYMBOL', 'a']]);
    expect(pairs('abcdef')).toEqual([['SYMBOL', 'abcdef']]);
    expect(pairs('ABcde')).toEqual([['SYMBOL', 'ABcde']]);
    expect(pairs('a01234')).toEqual([['SYMBOL', 'a01234']]);
    expect(pairs('_abc')).toEqual([['SYMBOL', '_abc']]);
    expect(pairs('_01234')).toEqual([['SYMBOL', '_01234']]);
  });

  test('accented and non-latin identifiers', () => {
    expect(single('été').text).toBe('été');
    expect(single('garçon').text).toBe('garçon');
  });

  test('emoji (with ZWJ sequences) form a single symbol', () => {
    const tok = single('👩🏻‍🎤🤯');
    expect(tok.type).toBe('SYMBOL');
    expect(tok.text).toBe('👩🏻‍🎤🤯');
  });

  test('verbatim symbols carry a cooked value', () => {
    expect(single('`a`').value).toBe('a');
    const tok = single('`a+b`');
    expect(tok.type).toBe('VERBATIM_SYMBOL');
    expect(tok.text).toBe('`a+b`');
    expect(tok.value).toBe('a+b');
  });

  test('verbatim symbols resolve escapes', () => {
    // `\u{2135}0` → ℵ0
    expect(single('`\\u{2135}0`').value).toBe('ℵ0');
  });

  test('invalid verbatim symbols carry diagnostics, do not throw', () => {
    expect(single('``').diagnostics).toEqual(['empty-verbatim-symbol']);
    expect(single('`abc').diagnostics).toEqual([
      ['unbalanced-verbatim-symbol', 'abc'],
    ]);
    expect(single('`#abcd`').diagnostics).toEqual([
      ['invalid-symbol-name', '#abcd'],
    ]);
    expect(single('`ab cd`').diagnostics).toEqual([
      ['invalid-symbol-name', 'ab cd'],
    ]);
  });
});

describe('CORTEX LEXER — operators (maximal munch)', () => {
  test('a run of operator characters is a single OPERATOR token', () => {
    expect(pairs('===')).toEqual([['OPERATOR', '===']]);
    expect(pairs('!==')).toEqual([['OPERATOR', '!==']]);
    expect(pairs('<=')).toEqual([['OPERATOR', '<=']]);
    expect(pairs('->')).toEqual([['OPERATOR', '->']]);
    expect(pairs('|>')).toEqual([['OPERATOR', '|>']]);
    expect(pairs('~>')).toEqual([['OPERATOR', '~>']]);
    expect(pairs('&&')).toEqual([['OPERATOR', '&&']]);
  });

  test('operators split from adjacent symbols and numbers', () => {
    expect(pairs('a<=b->c')).toEqual([
      ['SYMBOL', 'a'],
      ['OPERATOR', '<='],
      ['SYMBOL', 'b'],
      ['OPERATOR', '->'],
      ['SYMBOL', 'c'],
    ]);
    expect(pairs('1/2')).toEqual([
      ['NUMBER', '1'],
      ['OPERATOR', '/'],
      ['NUMBER', '2'],
    ]);
  });

  test('word operators are lexed as symbols (recombined in Phase 2)', () => {
    expect(pairs('!in')).toEqual([
      ['OPERATOR', '!'],
      ['SYMBOL', 'in'],
    ]);
  });
});

describe('CORTEX LEXER — brackets and punctuation', () => {
  test('each bracket / separator is its own token', () => {
    expect(types('[{()}]')).toEqual([
      'OPEN_BRACKET',
      'OPEN_BRACE',
      'OPEN_PAREN',
      'CLOSE_PAREN',
      'CLOSE_BRACE',
      'CLOSE_BRACKET',
    ]);
    expect(types('a;b,c')).toEqual([
      'SYMBOL',
      'SEMICOLON',
      'SYMBOL',
      'COMMA',
      'SYMBOL',
    ]);
  });
});

describe('CORTEX LEXER — comments and trivia', () => {
  test('line comments are skipped', () => {
    expect(lex('// comment')).toHaveLength(0);
    expect(pairs('3 // trailing')).toEqual([['NUMBER', '3']]);
  });

  test('doc line comments (///) are recorded on the following token', () => {
    const tokens = lex('/// doc\nx');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('SYMBOL');
    expect(tokens[0].docComments).toEqual([
      { text: '/// doc', start: 0, end: 7 },
    ]);
  });

  test('block comments (nested) are skipped', () => {
    expect(pairs('3 /* a comment */')).toEqual([['NUMBER', '3']]);
    expect(pairs('/* a /* b */ c */ y')).toEqual([['SYMBOL', 'y']]);
  });

  test('doc block comments (/** */) are recorded', () => {
    const tokens = lex('/** doc */ x');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].docComments?.[0].text).toBe('/** doc */');
    // `/**/` is an ordinary (empty) block comment, not a doc comment.
    expect(lex('/**/ x')[0].docComments).toBeUndefined();
  });

  test('an unterminated block comment is an ERROR token, not a throw', () => {
    const tokens = lex('/* under nested /* comment */');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('ERROR');
    expect(tokens[0].diagnostics).toEqual(['end-of-comment-expected']);
  });
});

describe('CORTEX LEXER — shebang', () => {
  test('a shebang on the first line is a SHEBANG token', () => {
    expect(pairs('#! /bin/cortex\n3.14')).toEqual([
      ['SHEBANG', '#! /bin/cortex'],
      ['NUMBER', '3.14'],
    ]);
  });

  test('a `#!` not at offset 0 is not a shebang', () => {
    const tokens = lex('\n#! boo');
    expect(tokens[0].type).not.toBe('SHEBANG');
    expect(tokens[0].type).toBe('ERROR'); // the lone `#`
  });
});

describe('CORTEX LEXER — pragmas', () => {
  test('`#name` is a PRAGMA token; its argument clause is separate tokens', () => {
    expect(pairs('#date')).toEqual([['PRAGMA', '#date']]);
    expect(pairs('#warning("hi")')).toEqual([
      ['PRAGMA', '#warning'],
      ['OPEN_PAREN', '('],
      ['STRING', '"hi"'],
      ['CLOSE_PAREN', ')'],
    ]);
  });

  test('a lone `#` (no identifier) is an ERROR token', () => {
    expect(pairs('# not-a-pragma')[0]).toEqual(['ERROR', '#']);
  });
});

describe('CORTEX LEXER — LaTeX islands', () => {
  test('`$…$` is a LATEX_ISLAND with inner-content offsets', () => {
    const tok = single('$x + 1$');
    expect(tok.type).toBe('LATEX_ISLAND');
    expect(tok.text).toBe('$x + 1$');
    expect(tok.island).toEqual({ start: 1, end: 6 });
    expect(tok.diagnostics).toBeUndefined();
  });

  test('`\\$` does not close the island', () => {
    const tok = single('$a \\$ b$');
    expect(tok.type).toBe('LATEX_ISLAND');
    expect(tok.island).toEqual({ start: 1, end: 7 });
  });

  test('an unterminated island carries a diagnostic, does not throw', () => {
    const tok = single('$unterminated');
    expect(tok.type).toBe('LATEX_ISLAND');
    expect(tok.diagnostics).toEqual([
      ['string-literal-closing-delimiter-expected', '$'],
    ]);
  });
});

describe('CORTEX LEXER — single-line strings', () => {
  test('plain and empty strings', () => {
    expect(single('""').parts).toEqual(['']);
    expect(single('"x"').parts).toEqual(['x']);
    expect(single('"hello world"').parts).toEqual(['hello world']);
    expect(single('"The multiplication sign is ×"').parts).toEqual([
      'The multiplication sign is ×',
    ]);
  });

  test('escape sequences are cooked', () => {
    expect(single('"a\\tb"').parts).toEqual(['a\tb']);
    expect(single('"hello \\u0061 world"').parts).toEqual(['hello a world']);
    expect(single('"hello \\u{0061} world"').parts).toEqual(['hello a world']);
    expect(single('"hello \\u{1F30D}"').parts).toEqual(['hello \u{1F30D}']);
  });

  test('interpolation holes become raw source spans', () => {
    expect(single('"hello \\(world)"').parts).toEqual([
      'hello ',
      { start: 9, end: 14 },
    ]);
    expect(single('"hello \\()"').parts).toEqual(['hello ', { start: 9, end: 9 }]);
    // A string literal inside the interpolation does not confuse paren-matching.
    expect(single('"hello\\(" world")"').parts).toEqual([
      'hello',
      { start: 8, end: 16 },
    ]);
  });

  test('invalid escapes produce a diagnostic, not a throw', () => {
    expect(single('"invalid \\x escape "').diagnostics).toEqual([
      ['invalid-escape-sequence', '\\x'],
    ]);
    expect(single('"invalid \\U0041 escape "').diagnostics).toEqual([
      ['invalid-escape-sequence', '\\U'],
    ]);
    expect(single('"invalid \\u23ghjik escape "').diagnostics).toEqual([
      ['invalid-unicode-codepoint-string', '23g'],
    ]);
    expect(single('"invalid \\u{20ffff} escape "').diagnostics).toEqual([
      ['invalid-unicode-codepoint-value', 'U+0020FFFF'],
    ]);
    expect(single('"invalid \\u{d888} escape "').diagnostics).toEqual([
      ['invalid-unicode-codepoint-value', 'U+D888'],
    ]);
  });

  test('unterminated strings are STRING tokens with diagnostics (never throw)', () => {
    expect(() => tokenize('"start')).not.toThrow();
    expect(single('"start').diagnostics).toEqual([
      ['string-literal-closing-delimiter-expected', '"'],
    ]);
    // A lone closing quote at end of line/source: opening delimiter expected.
    const tokens = lex('end"');
    expect(tokens[tokens.length - 1].diagnostics).toEqual([
      ['string-literal-opening-delimiter-expected', '"'],
    ]);
  });

  test('a string does not span a linebreak', () => {
    const tokens = lex('"start\nend"');
    expect(tokens[0].type).toBe('STRING');
    expect(tokens[0].diagnostics).toEqual([
      ['string-literal-closing-delimiter-expected', '"'],
    ]);
    expect(tokens[1]).toMatchObject({ type: 'SYMBOL', text: 'end' });
  });
});

describe('CORTEX LEXER — extended strings', () => {
  test('extended strings are raw (no escapes cooked)', () => {
    expect(single('#"hello world"#').parts).toEqual(['hello world']);
    expect(single('##"hello world"##').parts).toEqual(['hello world']);
    expect(single('#"hello "world""#').parts).toEqual(['hello "world"']);
    expect(single('#"hello \\n "world""#').parts).toEqual(['hello \\n "world"']);
  });

  test('an unterminated extended string carries a diagnostic', () => {
    expect(single('#"hello world"').diagnostics).toEqual([
      ['string-literal-closing-delimiter-expected', '#"'],
    ]);
    expect(single('##"hello world"#').diagnostics).toEqual([
      ['string-literal-closing-delimiter-expected', '##"'],
    ]);
  });
});

describe('CORTEX LEXER — multiline strings', () => {
  test('basic multiline string, line breaks normalized to \\n', () => {
    expect(single('"""\nhello\nworld\n"""').parts).toEqual(['hello\nworld']);
  });

  test('closing-delimiter indentation is stripped', () => {
    expect(single('"""\n   hello\n   world\n   """').parts).toEqual([
      'hello\nworld',
    ]);
    expect(single('"""\n\t\thello\n\t\tworld\n\t\t"""').parts).toEqual([
      'hello\nworld',
    ]);
  });

  test('interpolation spans inside a multiline string', () => {
    expect(single('"""\nhi \\(x)\ndone\n"""').parts).toEqual([
      'hi ',
      { start: 9, end: 10 },
      '\ndone',
    ]);
  });

  test('a trailing `\\` continues the line (no `\\n`)', () => {
    expect(single('"""\nHello \\\nWorld\n"""').parts).toEqual(['Hello World']);
  });

  test('content after the opening `"""` is an error', () => {
    const tok = lex('"""abc\nhello\n"""')[0];
    expect(tok.type).toBe('STRING');
    expect(tok.diagnostics).toEqual(['multiline-string-expected']);
  });

  test('a nonblank line not matching the indentation is an error', () => {
    expect(single('"""\nhello\nworld\n boo  """').diagnostics).toEqual([
      'multiline-whitespace-expected',
    ]);
  });
});

describe('CORTEX LEXER — error tokens', () => {
  test('a run of unrecognized characters is a single ERROR token', () => {
    // `.` is not a valid token start.
    expect(pairs('.5')).toEqual([
      ['ERROR', '.'],
      ['NUMBER', '5'],
    ]);
  });

  test('the lexer never throws on invalid input', () => {
    for (const s of [
      '"unterminated',
      '`unbalanced',
      '/* unterminated',
      '"bad \\q escape"',
      '$latex',
      ' ',
      '@@@',
    ]) {
      expect(() => tokenize(s)).not.toThrow();
    }
  });
});

describe('CORTEX LEXER — offsets and trivia flags', () => {
  test('start/end offsets match the raw source slice', () => {
    const source = '  foo + 42';
    for (const t of lex(source)) {
      expect(source.slice(t.start, t.end)).toBe(t.text);
    }
  });

  test('precededByWhitespace / precededByLinebreak flags', () => {
    const tokens = lex('a b\nc');
    expect(tokens.map((t) => [t.text, t.precededByWhitespace, t.precededByLinebreak])).toEqual([
      ['a', false, false],
      ['b', true, false],
      ['c', true, true],
    ]);
  });

  test('the trailing EOF token carries the final trivia flags', () => {
    const tokens = tokenize('a\n');
    const eof = tokens[tokens.length - 1];
    expect(eof.type).toBe('EOF');
    expect(eof.precededByWhitespace).toBe(true);
    expect(eof.precededByLinebreak).toBe(true);
  });

  test('the empty source is a single EOF token', () => {
    const tokens = tokenize('');
    expect(tokens).toHaveLength(1);
    expect(tokens[0].type).toBe('EOF');
  });

  test('the Lexer class and the tokenize() helper agree', () => {
    const source = 'f(x) + 1';
    expect(new Lexer(source).tokenize()).toEqual(tokenize(source));
  });
});
