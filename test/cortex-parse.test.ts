// import { parseCortex } from '../src/cortex/parse-cortex';
import { validCortex, invalidCortex } from './utils';

describe.skip('CORTEX PARSING SPACES', () => {
  test('Symbols', () => {
    expect(validCortex(' ')).toMatchInlineSnapshot(
      `{severity: 'error', code: undefined}`
    );
    expect(validCortex('x\ty')).toMatchInlineSnapshot(
      `{severity: 'error', code: undefined}`
    );
    expect(validCortex('x\t+\ty')).toMatchInlineSnapshot(
      `{severity: 'error', code: undefined}`
    );
    expect(validCortex(' x \t y')).toMatchInlineSnapshot(
      `{severity: 'error', code: undefined}`
    );
  });
});

describe.skip('CORTEX PARSING COMMENTS', () => {
  test('Single-line comments;', () => {
    expect(validCortex('// Comment')).toMatchInlineSnapshot();
    expect(
      validCortex('/// Documentation **comment**')
    ).toMatchInlineSnapshot();
    expect(validCortex('3.14 // Trailing comment')).toMatchInlineSnapshot();
  });
  test('Multi-line comments;', () => {
    expect(
      validCortex(`3.14
/*
 * Multi-line comment
 */`)
    ).toMatchInlineSnapshot();
    expect(
      validCortex(`3.14 +
3.14 /*
 * Multi-line comment
 */`)
    ).toMatchInlineSnapshot();
    expect(
      validCortex(`3.14 +
3.14 /*
 * Nested /* Comment */
 */`)
    ).toMatchInlineSnapshot();
  });
});

describe('CORTEX PARSING NUMBERS', () => {
  test('Constants', () => {
    expect(validCortex('NaN')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('+Infinity')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('Infinity')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('-Infinity')).toMatchInlineSnapshot(`"Nothing"`);
  });
  test('Integers', () => {
    expect(validCortex('0')).toMatch('0');
    expect(validCortex('+0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('-0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('+62737547')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('+62_73_7__547')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('+62_73_7547.38383')).toMatchInlineSnapshot(`"Nothing"`);
  });
  test('Floating-point number', () => {
    expect(validCortex('1.2')).toMatchInlineSnapshot();
    expect(validCortex('-62_73_7547.38383e-13')).toMatchInlineSnapshot(
      `"Nothing"`
    );
    expect(validCortex('-62_73_7547.e-13')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('-.1e-13')).toMatchInlineSnapshot(`"Nothing"`);
  });

  test.only('Binary numbers', () => {
    expect(validCortex('0b0101001011')).toMatchInlineSnapshot(`331`);
    expect(validCortex('0b0101001011.110101')).toMatchInlineSnapshot(
      `331.828125`
    );
    expect(validCortex('0b0101001011.110101e-4')).toMatchInlineSnapshot(
      `0.0331828125`
    );
    expect(validCortex('0b0101001011E-4')).toMatchInlineSnapshot(`0.0331`);
    expect(validCortex('0b0101001011.001p-2')).toMatchInlineSnapshot(
      `82.78125`
    );
    expect(validCortex('-0b0')).toMatchInlineSnapshot(`'syntax-error'`);
    expect(validCortex('-0b10')).toMatchInlineSnapshot(`'syntax-error'`);
  });
  test('Hex numbers', () => {
    expect(validCortex('0xdeadbeef')).toMatchInlineSnapshot();
    expect(validCortex('-0xdeadbeef')).toMatchInlineSnapshot();
    expect(validCortex('0xdead.beef')).toMatchInlineSnapshot();
    expect(validCortex('0x3.0cp2')).toMatch('12.1875');
    expect(validCortex('0xc.3p0')).toMatch('12.1875');
    expect(validCortex('0x3.23d70a3d70a3ep0')).toMatch('3.14');
    expect(validCortex('0x1.91eb851eb851fp+1')).toMatch('3.14');
    expect(validCortex('0x400')).toMatch('1024');
    expect(validCortex('0x1.0p-4')).toMatch('0.0625');
    expect(validCortex('0x1.0p-8')).toMatch('0.00390625');
    expect(validCortex('0x1.0p-10')).toMatch('0.0009765625');
  });
});

describe.skip('CORTEX PARSING SYMBOLS', () => {
  test('Symbols', () => {
    expect(validCortex('a')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('abcdef')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('ABcde')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('été')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('Thé')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('garçon')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('a01234')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('_abc')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('_01234')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('#abcd')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('$abcd')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('$ab_cd$')).toMatchInlineSnapshot(`"Nothing"`);
    expect(validCortex('👩🏻‍🎤🤯')).toMatchInlineSnapshot();
  });
  test('Wrapped symbols', () => {
    expect(validCortex('`a`')).toMatchInlineSnapshot();
    expect(validCortex('`a+b`')).toMatchInlineSnapshot();
    expect(validCortex('`Mind 🤯`')).toMatchInlineSnapshot();
    expect(validCortex('`👩🏻‍🎤🤯`')).toMatchInlineSnapshot();
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

describe.skip('CORTEX PARSING STRINGS', () => {
  test('Strings', () => {
    expect(validCortex('')).toMatchInlineSnapshot();
    expect(validCortex('"x"')).toMatchInlineSnapshot();
    expect(validCortex('"hello world"')).toMatchInlineSnapshot();
    expect(validCortex(`"C'est l'été!"`)).toMatchInlineSnapshot();
    expect(validCortex(`"Times: ×"`)).toMatchInlineSnapshot();
    expect(
      validCortex(`"The set of real  numbers is ℝ"`)
    ).toMatchInlineSnapshot();
  });
  test('Interpolated strings', () => {
    expect(validCortex('hello\\(world)')).toMatchInlineSnapshot();
    expect(validCortex('hello\\(2 + 3 + 5)')).toMatchInlineSnapshot();
    expect(validCortex('hello\\(2 + 3 + x)')).toMatchInlineSnapshot();
    expect(
      validCortex('hello \\(2 + 3 + x) is equal to \\(5 + x)')
    ).toMatchInlineSnapshot();
  });
  test('String escaping', () => {
    expect(validCortex('Print("hello 21 \\"world")')).toMatchInlineSnapshot();
    expect(validCortex('Print("hello\\n world")')).toMatchInlineSnapshot();
    expect(
      validCortex('Print("hello\\u{000a} world")')
    ).toMatchInlineSnapshot();
    expect(validCortex('Print("Latex loves \\\\")')).toMatchInlineSnapshot();
    expect(validCortex('Print("hello", "\\nworld")')).toMatchInlineSnapshot();
  });
});

describe.skip('CORTEX PARSING DICTIONARY', () => {
  test('Empty dictionary', () => {
    expect(validCortex('{->}')).toMatchInlineSnapshot();
  });
  test('Empty dictionary', () => {
    expect(validCortex('Dictionary()')).toMatchInlineSnapshot();
  });

  test('Dictionaries', () => {
    expect(validCortex('{x -> 1, y -> 2, z -> 2 + x}')).toMatchInlineSnapshot();

    expect(
      validCortex('{x -> {a -> 7, b -> 5}, y -> 2, z -> 2 + x}')
    ).toMatchInlineSnapshot();
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
});

describe.skip('CORTEX PARSING OPERATORS', () => {
  test('Unary Operators', () => {
    expect(validCortex('-x')).toMatchInlineSnapshot();
    expect(validCortex('-(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('+(2+1)')).toMatchInlineSnapshot();
  });
  test('Arithmetic Operators', () => {
    expect(validCortex('2 * x')).toMatchInlineSnapshot();
    expect(validCortex('-1 + -2')).toMatchInlineSnapshot();
    expect(validCortex('-1 * -2')).toMatchInlineSnapshot();
    expect(validCortex('-x * -y')).toMatchInlineSnapshot();
    expect(validCortex('(x + 1) * (x - 1)')).toMatchInlineSnapshot();
    expect(validCortex('1 + (2 + 3)')).toMatchInlineSnapshot();
    expect(validCortex('2 * (2 + 3)')).toMatchInlineSnapshot();
    expect(validCortex('2 (2 + 3)')).toMatchInlineSnapshot();
    expect(validCortex('x * -1 + x * 2')).toMatchInlineSnapshot();
    expect(validCortex('-x - -1')).toMatchInlineSnapshot();
    expect(validCortex('x * y + a * b')).toMatchInlineSnapshot();
    expect(validCortex('(x + y) * (a + b)')).toMatchInlineSnapshot();
    expect(validCortex('x * y * a * b')).toMatchInlineSnapshot();
  });
  test('Logic Operators', () => {
    expect(validCortex('x && y && (a || b)')).toMatchInlineSnapshot();
  });
  test('Relational Operators', () => {
    expect(validCortex('x * y == a + b')).toMatchInlineSnapshot();
    expect(validCortex('0 > -1')).toMatchInlineSnapshot();
    expect(validCortex('0 >= -1')).toMatchInlineSnapshot();
  });
  test('Invisible Operators', () => {
    expect(validCortex('2x')).toMatchInlineSnapshot();
    expect(validCortex('x(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('2(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('(a+b)(2+1)')).toMatchInlineSnapshot();
    expect(validCortex('2 1/2')).toMatchInlineSnapshot();
    expect(validCortex('x 1/2')).toMatchInlineSnapshot();
  });
  test('Power', () => {
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
