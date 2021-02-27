import { parseCortex } from '../src/cortex/parse-cortex';

describe.skip('CORTEX PARSING SPACES', () => {
  test('Symbols', () => {
    expect(parseCortex(' ')).toMatchInlineSnapshot();
    expect(parseCortex('x\ty')).toMatchInlineSnapshot();
    expect(parseCortex('x\t+\ty')).toMatchInlineSnapshot();
    expect(parseCortex(' x \t y')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING COMMENTS', () => {
  test('Single-line comments;', () => {
    expect(parseCortex('// Comment')).toMatchInlineSnapshot();
    expect(
      parseCortex('/// Documentation **comment**')
    ).toMatchInlineSnapshot();
    expect(parseCortex('3.14 // Trailing comment')).toMatchInlineSnapshot();
  });
  test('Multi-line comments;', () => {
    expect(
      parseCortex(`3.14
/*
 * Multi-line comment
 */`)
    ).toMatchInlineSnapshot();
    expect(
      parseCortex(`3.14 +
3.14 /*
 * Multi-line comment
 */`)
    ).toMatchInlineSnapshot();
    expect(
      parseCortex(`3.14 +
3.14 /*
 * Nested /* Comment */
 */`)
    ).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING NUMBERS', () => {
  test('Constants', () => {
    expect(parseCortex('NaN')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+Infinity')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('Infinity')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-Infinity')).toMatchInlineSnapshot(`"Nothing"`);
  });
  test('Integers', () => {
    expect(parseCortex('0')).toMatch('0');
    expect(parseCortex('+0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+62737547')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+62_73_7__547')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+62_73_7547.38383')).toMatchInlineSnapshot(`"Nothing"`);
  });
  test('Floating-point number', () => {
    expect(parseCortex('1.2')).toMatchInlineSnapshot();
    expect(parseCortex('-62_73_7547.38383e-13')).toMatchInlineSnapshot(
      `"Nothing"`
    );
    expect(parseCortex('-62_73_7547.e-13')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-.1e-13')).toMatchInlineSnapshot(`"Nothing"`);
  });

  test('Binary numbers', () => {
    expect(parseCortex('0b0101001011')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-0b0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-0b10')).toMatchInlineSnapshot(`"Nothing"`);
  });
  test('Hex numbers', () => {
    expect(parseCortex('0x3.0cp2')).toMatch('12.1875');
    expect(parseCortex('0xc.3p0')).toMatch('12.1875');
    expect(parseCortex('0x3.23d70a3d70a3ep0')).toMatch('3.14');
    expect(parseCortex('0x1.91eb851eb851fp+1')).toMatch('3.14');
    expect(parseCortex('0x400')).toMatch('1024');
    expect(parseCortex('0x1.0p-4')).toMatch('0.0625');
    expect(parseCortex('0x1.0p-8')).toMatch('0.00390625');
    expect(parseCortex('0x1.0p-10')).toMatch('0.0009765625');
  });
});

describe.skip('CORTEX PARSING SYMBOLS', () => {
  test('Symbols', () => {
    expect(parseCortex('a')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('abcdef')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('ABcde')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('été')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('Thé')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('garçon')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('a01234')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('_abc')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('_01234')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('#abcd')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('$abcd')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('$ab_cd$')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('👩🏻‍🎤🤯')).toMatchInlineSnapshot();
  });
  test('Wrapped symbols', () => {
    expect(parseCortex('`a`')).toMatchInlineSnapshot();
    expect(parseCortex('`a+b`')).toMatchInlineSnapshot();
    expect(parseCortex('`Mind 🤯`')).toMatchInlineSnapshot();
    expect(parseCortex('`👩🏻‍🎤🤯`')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING FANCY SYMBOLS', () => {
  test('Fancy symbols', () => {
    expect(parseCortex('a ∧ ¬b ⋁ !c')).toMatchInlineSnapshot();
    // \u2212 2 \u00d7 x
    expect(parseCortex('−2 × x >= 5')).toMatchInlineSnapshot();
    expect(parseCortex('3πⅈ')).toMatchInlineSnapshot();
    expect(parseCortex('3.1 ∈ ℝ')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING STRINGS', () => {
  test('Strings', () => {
    expect(parseCortex('')).toMatchInlineSnapshot();
    expect(parseCortex('"x"')).toMatchInlineSnapshot();
    expect(parseCortex('"hello world"')).toMatchInlineSnapshot();
    expect(parseCortex(`"C'est l'été!"`)).toMatchInlineSnapshot();
    expect(parseCortex(`"Times: ×"`)).toMatchInlineSnapshot();
    expect(
      parseCortex(`"The set of real  numbers is ℝ"`)
    ).toMatchInlineSnapshot();
  });
  test('Interpolated strings', () => {
    expect(parseCortex('hello\\(world)')).toMatchInlineSnapshot();
    expect(parseCortex('hello\\(2 + 3 + 5)')).toMatchInlineSnapshot();
    expect(parseCortex('hello\\(2 + 3 + x)')).toMatchInlineSnapshot();
    expect(
      parseCortex('hello \\(2 + 3 + x) is equal to \\(5 + x)')
    ).toMatchInlineSnapshot();
  });
  test('String escaping', () => {
    expect(parseCortex('Print("hello 21 \\"world")')).toMatchInlineSnapshot();
    expect(parseCortex('Print("hello\\n world")')).toMatchInlineSnapshot();
    expect(
      parseCortex('Print("hello\\u{000a} world")')
    ).toMatchInlineSnapshot();
    expect(parseCortex('Print("Latex loves \\\\")')).toMatchInlineSnapshot();
    expect(parseCortex('Print("hello", "\\nworld")')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING DICTIONARY', () => {
  test('Empty dictionary', () => {
    expect(parseCortex('{->}')).toMatchInlineSnapshot();
  });
  test('Empty dictionary', () => {
    expect(parseCortex('Dictionary()')).toMatchInlineSnapshot();
  });

  test('Dictionaries', () => {
    expect(parseCortex('{x -> 1, y -> 2, z -> 2 + x}')).toMatchInlineSnapshot();

    expect(
      parseCortex('{x -> {a -> 7, b -> 5}, y -> 2, z -> 2 + x}')
    ).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING COLLECTIONS', () => {
  test('Sets', () => {
    expect(parseCortex('{}')).toMatchInlineSnapshot();
    expect(parseCortex('{1}')).toMatchInlineSnapshot();
    expect(parseCortex('{1, 2}')).toMatchInlineSnapshot();
    expect(parseCortex('{1, {2, 3}, 4}')).toMatchInlineSnapshot();
    expect(parseCortex('Set()')).toMatchInlineSnapshot();
    expect(parseCortex('Set(1, 2, 3)')).toMatchInlineSnapshot();
    expect(parseCortex('Set(1, {2, 3}, 3)')).toMatchInlineSnapshot();
  });
  test('Lists', () => {
    expect(parseCortex('[]')).toMatchInlineSnapshot();
    expect(parseCortex('[1]')).toMatchInlineSnapshot();
    expect(parseCortex('[1, 2]')).toMatchInlineSnapshot();
    expect(parseCortex('[1, [2, 3], 4]')).toMatchInlineSnapshot();
    expect(parseCortex('List()')).toMatchInlineSnapshot();
    expect(parseCortex('List(2, 2x, 4)')).toMatchInlineSnapshot();
    expect(parseCortex('List(2, [2x, 5], 4)')).toMatchInlineSnapshot();
  });
  test('Sequence', () => {
    expect(parseCortex('1, 2, 3')).toMatchInlineSnapshot();
    expect(parseCortex('1,, 3')).toMatchInlineSnapshot();
    expect(parseCortex('1, 2,')).toMatchInlineSnapshot();
    expect(parseCortex(', 2,')).toMatchInlineSnapshot();
    expect(parseCortex('Sequence()')).toMatchInlineSnapshot();
    expect(parseCortex('Sequence(1, 2, 3)')).toMatchInlineSnapshot();
    expect(parseCortex('Sequence(1, 2x + 4, 3)')).toMatchInlineSnapshot();
  });
  test('Tuple', () => {
    expect(parseCortex('()')).toMatchInlineSnapshot();
    expect(parseCortex('(a,b)')).toMatchInlineSnapshot();
    expect(parseCortex('(a,,b)')).toMatchInlineSnapshot();
    expect(parseCortex('(a , , b)')).toMatchInlineSnapshot();
    expect(parseCortex('Tuple()')).toMatchInlineSnapshot();
    expect(parseCortex('Tuple(a, 2b, c^3)')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING OPERATORS', () => {
  test('Unary Operators', () => {
    expect(parseCortex('-x')).toMatchInlineSnapshot();
    expect(parseCortex('-(2+1)')).toMatchInlineSnapshot();
    expect(parseCortex('+(2+1)')).toMatchInlineSnapshot();
  });
  test('Arithmetic Operators', () => {
    expect(parseCortex('2 * x')).toMatchInlineSnapshot();
    expect(parseCortex('-1 + -2')).toMatchInlineSnapshot();
    expect(parseCortex('-1 * -2')).toMatchInlineSnapshot();
    expect(parseCortex('-x * -y')).toMatchInlineSnapshot();
    expect(parseCortex('(x + 1) * (x - 1)')).toMatchInlineSnapshot();
    expect(parseCortex('1 + (2 + 3)')).toMatchInlineSnapshot();
    expect(parseCortex('2 * (2 + 3)')).toMatchInlineSnapshot();
    expect(parseCortex('2 (2 + 3)')).toMatchInlineSnapshot();
    expect(parseCortex('x * -1 + x * 2')).toMatchInlineSnapshot();
    expect(parseCortex('-x - -1')).toMatchInlineSnapshot();
    expect(parseCortex('x * y + a * b')).toMatchInlineSnapshot();
    expect(parseCortex('(x + y) * (a + b)')).toMatchInlineSnapshot();
    expect(parseCortex('x * y * a * b')).toMatchInlineSnapshot();
  });
  test('Logic Operators', () => {
    expect(parseCortex('x && y && (a || b)')).toMatchInlineSnapshot();
  });
  test('Relational Operators', () => {
    expect(parseCortex('x * y == a + b')).toMatchInlineSnapshot();
    expect(parseCortex('0 > -1')).toMatchInlineSnapshot();
    expect(parseCortex('0 >= -1')).toMatchInlineSnapshot();
  });
  test('Invisible Operators', () => {
    expect(parseCortex('2x')).toMatchInlineSnapshot();
    expect(parseCortex('x(2+1)')).toMatchInlineSnapshot();
    expect(parseCortex('2(2+1)')).toMatchInlineSnapshot();
    expect(parseCortex('(a+b)(2+1)')).toMatchInlineSnapshot();
    expect(parseCortex('2 1/2')).toMatchInlineSnapshot();
    expect(parseCortex('x 1/2')).toMatchInlineSnapshot();
  });
  test('Power', () => {
    expect(parseCortex('x^2')).toMatchInlineSnapshot();
    expect(parseCortex('x^1/2')).toMatchInlineSnapshot();
    expect(parseCortex('x ^ 1 / 2')).toMatchInlineSnapshot();
    expect(parseCortex('(x + 1) ^ (n - 1)')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING FUNCTIONS', () => {
  test('Functions', () => {
    expect(parseCortex('f()')).toMatchInlineSnapshot();
    expect(parseCortex('f(x)')).toMatchInlineSnapshot();
    expect(parseCortex('f(x, y)')).toMatchInlineSnapshot();
    expect(parseCortex('Add()')).toMatchInlineSnapshot();
    expect(parseCortex('Add(2, 3)')).toMatchInlineSnapshot();
    expect(parseCortex('`\\sin`(x)')).toMatchInlineSnapshot();
    expect(parseCortex('Apply(g(f), [x, 1, 0])')).toMatchInlineSnapshot();
  });
});
