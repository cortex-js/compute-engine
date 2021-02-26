import {
  MULTIPLY,
  PI,
  ADD,
  SUBTRACT,
  NEGATE,
  POWER,
  DIVIDE,
} from '../src/common/utils';
import { serializeCortex } from '../src/cortex/serialize-cortex';
import { parseCortex } from '../src/cortex/parse-cortex';

describe('CORTEX SERIALIZING', () => {
  test('Numbers', () => {
    expect(serializeCortex(1)).toMatch('1');
    expect(serializeCortex(+1)).toMatch('1');
    expect(serializeCortex(-123)).toMatch('-123');
    expect(serializeCortex(-1234567.89)).toMatchInlineSnapshot(
      `"-1_234_567.89"`
    );
    expect(serializeCortex(-1234567.89e-123)).toMatchInlineSnapshot(
      `"-1.234_567_89e-117"`
    );
    expect(serializeCortex({ num: '-1234567.890e-123' })).toMatchInlineSnapshot(
      `"-1_234_567.890e-123"`
    );
    expect(
      serializeCortex({ num: '-123456789012345678901234567890.890e-123' })
    ).toMatchInlineSnapshot(`"-123_456_789_012_345_678_901_234_567_890e-123"`);
    expect(serializeCortex({ num: 'Infinity' })).toMatch('Infinity');
    expect(serializeCortex({ num: '-Infinity' })).toMatch('-Infinity');
    expect(serializeCortex({ num: 'NaN' })).toMatch('NotANumber');
    expect(serializeCortex({ num: 'Infinity' })).toMatch('Infinity');

    // Repeating pattern
    expect(
      serializeCortex({ num: '3.123456785678567856785678567856785678' })
    ).toMatchInlineSnapshot(`"3.123_456_785_678_5"`);

    expect(
      serializeCortex({ num: '0.1234567872368237462387623876' })
    ).toMatchInlineSnapshot(`"0.123_456_787_236_8"`);
  });

  test('BaseForm', () => {
    expect(serializeCortex(['BaseForm', { num: '00012.1875000' }, 10])).toMatch(
      '12.187_500_0'
    );
    expect(serializeCortex(['BaseForm', 42, 2])).toMatch('0b101010');
    expect(serializeCortex(['BaseForm', 12.1875, 16])).toMatch('0x3.0cp2'); // Also:'0xc.3p0'
    expect(serializeCortex(['BaseForm', 3.14, 16])).toMatch(
      '0x3.23d70a3d70a3ep0' // Also '0x1.91eb851eb851fp+1'
    );
    expect(serializeCortex(['BaseForm', 1024.0, 16])).toMatch('0x400');
    expect(serializeCortex(['BaseForm', 1 / 16, 16])).toMatch('0x1.0p-4');
    expect(serializeCortex(['BaseForm', 1 / 256, 16])).toMatch('0x1.0p-8');
    expect(serializeCortex(['BaseForm', 1 / 16 + 1 / 256, 16])).toMatch(
      '0x1.1p-4'
    );
    expect(serializeCortex(['BaseForm', 1 / 1024, 16])).toMatch('0x1.0p-10');
  });

  test('Comment', () => {
    expect(
      serializeCortex({
        fn: [MULTIPLY, PI, 'x'],
        comment: 'This is a single line-comment',
      })
    ).toMatchInlineSnapshot(`"/* This is a single line-comment */Pi * x"`);
    expect(
      serializeCortex({
        fn: [MULTIPLY, PI, 'x'],
        comment: 'This is a multi-line-comment\nThis is the second line.',
      })
    ).toMatchInlineSnapshot(`
      "/* This is a multi-line-comment
      This is the second line. */Pi * x"
    `);
    expect(
      serializeCortex({
        fn: ['Add', 21, 20, 1],
        wikidata: 'Q42',
      })
    ).toMatchInlineSnapshot(`"21 + 20 + 1"`);
  });

  test('Spacing', () => {
    expect(serializeCortex([MULTIPLY, PI, 'x'])).toMatchInlineSnapshot(
      `"Pi * x"`
    );
  });

  test('Strings', () => {
    expect(serializeCortex("'x'")).toMatchInlineSnapshot(`"\\"x\\""`);
    expect(serializeCortex("'hello world'")).toMatchInlineSnapshot(
      `"\\"hello world\\""`
    );
  });

  test('Interpolated strings', () => {
    expect(serializeCortex(['String'])).toMatch('""');
    expect(serializeCortex(['String', "'hello world'"])).toMatch(
      '"hello world"'
    );
    expect(serializeCortex(['String', "'hello'", "'world'"])).toMatch(
      '"helloworld"'
    );
    expect(serializeCortex(['String', "'hello'", 'world'])).toMatch(
      '"hello\\(world)"'
    );
    expect(serializeCortex(['String', "'hello'", ['Add', 2, 3, 5]])).toMatch(
      '"hello\\(2 + 3 + 5)"'
    );
    expect(serializeCortex(['String', "'hello'", ['Add', 2, 3, 'x']])).toMatch(
      '"hello\\(2 + 3 + x)"'
    );
    expect(
      serializeCortex(['String', "'hello'", ['Multiply', ['Add', 2, 3], 'x']])
    ).toMatch('"hello\\((2 + 3) * x)"');
  });

  test('Strings escaping', () => {
    expect(serializeCortex(['Print', "'hello 21 \"world'"])).toMatch(
      'Print("hello 21 \\"world")'
    );
    expect(serializeCortex(['Print', "'hello\n world'"])).toMatch(
      'Print("hello\\n world")'
    );
    expect(serializeCortex(['Print', "'hello\u000a world'"])).toMatch(
      'Print("hello\\n world")'
    );
    expect(serializeCortex(['Print', "'Latex loves \\'"])).toMatch(
      'Print("Latex loves \\\\")'
    );
    expect(serializeCortex(['Print', "'hello'", "'\nworld'"])).toMatch(
      'Print("hello", "\\nworld")'
    );
  });

  test('Symbols (not wrapped)', () => {
    expect(serializeCortex('x')).toMatch('x');
    expect(serializeCortex('symbol')).toMatch('symbol');
    expect(serializeCortex('x12')).toMatch('x12');
    expect(serializeCortex('👨🏻‍🎤')).toMatch('👨🏻‍🎤');
    expect(serializeCortex('🤯')).toMatch('🤯');
    expect(serializeCortex('🤯😭')).toMatch('🤯😭');
    expect(serializeCortex({ sym: 'x' })).toMatch('x');
    expect(serializeCortex({ sym: '12' })).toMatch('12');
    expect(serializeCortex({ sym: 'symbol' })).toMatch('symbol');
  });

  test('Escaped Symbols', () => {
    expect(serializeCortex('a\u0000b')).toMatch('`a\\u{0000}b`'); // Include a null char
    expect(serializeCortex('a\tb')).toMatch('`a\\tb`'); // Include a tab
    expect(serializeCortex('a\nb')).toMatch('`a\\nb`'); // Include a newline
    expect(serializeCortex('a\u0003b')).toMatch('`a\\u{0003}b`'); // Include a ETX (END OF TEXT)
    expect(serializeCortex('a\u007fb')).toMatch('`a\\u{007f}b`'); // Include a delete char
    expect(serializeCortex('f\u2061(x))')).toMatch('`f\\u{2061}(x))`'); // Include a FUNCTION APPLICATION char
  });

  test('Wrapped symbols', () => {
    // Does not start with a letter
    expect(serializeCortex('12x')).toMatch('`12x`');
    expect(serializeCortex('\\sin')).toMatch('`\\\\sin`');
    expect(serializeCortex('~f')).toMatch('`~f`');
    expect(serializeCortex('_f')).toMatch('`_f`');
    expect(serializeCortex('_')).toMatch('`_`');
    expect(serializeCortex('`')).toMatch('```');

    // Contains a non-letter/non-digit
    expect(serializeCortex('a+b')).toMatch('`a+b`');
    expect(serializeCortex('a;b')).toMatch('`a;b`');

    expect(serializeCortex('Mind🤯')).toMatch('`Mind🤯`'); // Mix of emojis and other things
    expect(serializeCortex('a b')).toMatch('`a b`'); // Includes a space
    expect(serializeCortex('a\nb')).toMatch('`a\\nb`');
  });

  test('Functions', () => {
    expect(serializeCortex(['f'])).toMatchInlineSnapshot(`"f()"`);
    expect(serializeCortex(['f', 'x', 1, 0])).toMatchInlineSnapshot(
      `"f(x, 1, 0)"`
    );
    expect(serializeCortex(['\\foo', 'x', 1, 0])).toMatchInlineSnapshot(
      `"\`\\\\\\\\foo\`(x, 1, 0)"`
    );
    expect(serializeCortex(['\\frac', 'n', 4])).toMatchInlineSnapshot(
      `"\`\\\\\\\\frac\`(n, 4)"`
    );

    // Head as expression
    expect(serializeCortex([['g', 'f'], 'x', 1, 0])).toMatch(
      'Apply(g(f), [x, 1, 0])'
    );
  });
  test('Dictionaries', () => {
    // Empty dictionary
    expect(serializeCortex({ dict: {} })).toMatchInlineSnapshot(`"{}"`);
    //Regular dictionary
    expect(
      serializeCortex({ dict: { x: 1, y: 2, z: ['Add', 2, 'x'] } })
    ).toMatchInlineSnapshot(`"{x -> 1, y -> 2, z -> 2 + x}"`);
    // Nested dictionary
    expect(
      serializeCortex({
        dict: { x: { dict: { a: 7, b: 5 } }, y: 2, z: ['Add', 2, 'x'] },
      })
    ).toMatchInlineSnapshot(`"{x -> {a -> 7, b -> 5}, y -> 2, z -> 2 + x}"`);
    // @todo:indexed-access
  });

  test('Sets', () => {
    // Empty set
    expect(serializeCortex(['Set'])).toMatchInlineSnapshot(`"EmptySet"`);
    //Regular set
    expect(
      serializeCortex(['Set', 5, 7, 'x', ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"[5, 7, x, 5 + x + 2]"`);
    // Nested sets
    expect(
      serializeCortex(['Set', 5, 7, ['Set', 7, 8, 9], ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"[5, 7, [7, 8, 9], 5 + x + 2]"`);

    // @todo:set membership
  });

  test('Lists', () => {
    // Empty list
    expect(serializeCortex(['List'])).toMatchInlineSnapshot(`"{}"`);
    //Regular list
    expect(
      serializeCortex(['List', 5, 7, 'x', ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"{5, 7, x, 5 + x + 2}"`);
    // Nested lists
    expect(
      serializeCortex(['Set', 5, 7, ['List', 7, 8, 9], ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"[5, 7, {7, 8, 9}, 5 + x + 2]"`);
  });

  test('Sequence', () => {
    // Empty sequence
    expect(serializeCortex(['Sequence'])).toMatchInlineSnapshot(`"Sequence()"`);
    expect(
      serializeCortex(['Sequence', 5, 'x', 7, ['Add', 'x', 3, 'y']])
    ).toMatchInlineSnapshot(`"Sequence(5, x, 7, x + 3 + y)"`);
    expect(
      serializeCortex(['Sequence', 2, ['Sequence', 3, 4], 5])
    ).toMatchInlineSnapshot(`"Sequence(2, Sequence(3, 4), 5)"`);
    expect(
      serializeCortex(['Sequence2', 2, ['Sequence', 3, 4], 5])
    ).toMatchInlineSnapshot(`"Sequence2(2, Sequence(3, 4), 5)"`);
    expect(
      serializeCortex(['Sequence', 2, ['Sequence2', 3, 4], 5])
    ).toMatchInlineSnapshot(`"Sequence(2, Sequence2(3, 4), 5)"`);
  });

  test('Tuple', () => {
    expect(serializeCortex(['Tuple'])).toMatchInlineSnapshot(`"Tuple()"`);
    expect(
      serializeCortex(['Tuple', 5, 'x', 7, ['Add', 'x', 3, 'y']])
    ).toMatchInlineSnapshot(`"Tuple(5, x, 7, x + 3 + y)"`);
    expect(
      serializeCortex([
        'Tuple',
        5,
        'x',
        ['Tuple', 11, 13],
        ['Add', 'x', 3, 'y'],
      ])
    ).toMatchInlineSnapshot(`"Tuple(5, x, Tuple(11, 13), x + 3 + y)"`);
  });

  test('Operators', () => {
    expect(serializeCortex([ADD, 'a', 'b'])).toMatchInlineSnapshot(`"a + b"`);
    // Invisible operator
    expect(serializeCortex([MULTIPLY, 'a', 'b'])).toMatchInlineSnapshot(
      `"a * b"`
    );
    expect(
      serializeCortex([MULTIPLY, [ADD, 'x', 1], [SUBTRACT, 'x', 1]])
    ).toMatchInlineSnapshot(`"(x + 1) * (x - 1)"`);
    expect(
      serializeCortex([ADD, [MULTIPLY, 'x', -1], [MULTIPLY, 'x', 2]])
    ).toMatchInlineSnapshot(`"x * -1 + x * 2"`);
    expect(
      serializeCortex([SUBTRACT, [NEGATE, 'x'], -1])
    ).toMatchInlineSnapshot(`"-x - -1"`);
    expect(
      serializeCortex(['Add', ['Multiply', 'x', 'y'], ['Multiply', 'a', 'b']])
    ).toMatchInlineSnapshot(`"x * y + a * b"`);
    expect(
      serializeCortex(['Multiply', ['Add', 'x', 'y'], ['Add', 'a', 'b']])
    ).toMatchInlineSnapshot(`"(x + y) * (a + b)"`);
    expect(
      serializeCortex([
        'Multiply',
        ['Multiply', 'x', 'y'],
        ['Multiply', 'a', 'b'],
      ])
    ).toMatchInlineSnapshot(`"x * y * a * b"`);
    expect(
      serializeCortex(['Equal', ['Multiply', 'x', 'y'], ['Add', 'a', 'b']])
    ).toMatchInlineSnapshot(`"x * y == a + b"`);
    expect(
      serializeCortex(['And', ['And', 'x', 'y'], ['Or', 'a', 'b']])
    ).toMatchInlineSnapshot(`"x && y && (a || b)"`);
    expect(
      serializeCortex(['And', ['And', ['Not', 'x'], 'y'], ['Or', 'a', 'b']])
    ).toMatchInlineSnapshot(`"!x && y && (a || b)"`);
    expect(serializeCortex(['Multiply', 2, 'x'])).toMatchInlineSnapshot(
      `"2 * x"`
    );
    expect(
      serializeCortex(['Multiply', 2, ['Negate', 'x']])
    ).toMatchInlineSnapshot(`"2 * -x"`);
    expect(serializeCortex(['Multiply', 'x', 2, 'y'])).toMatchInlineSnapshot(
      `"x * 2 * y"`
    );
    expect(serializeCortex(['Multiply', 2, 'x', 'y'])).toMatchInlineSnapshot(
      `"2 * x * y"`
    );
  });

  test('Unary operators', () => {
    expect(serializeCortex(['Negate'])).toMatchInlineSnapshot(`"Negate()"`);
    expect(serializeCortex(['Negate', 2, 3])).toMatchInlineSnapshot(
      `"Negate(2, 3)"`
    );
    expect(serializeCortex(['Negate', 1])).toMatchInlineSnapshot(`"-1"`);
    expect(serializeCortex(['Negate', -1])).toMatchInlineSnapshot(`"--1"`);
    expect(serializeCortex(['Negate', ['Add', 2, 3]])).toMatchInlineSnapshot(
      `"-(2 + 3)"`
    );
    expect(serializeCortex(['Negate', 'x'])).toMatchInlineSnapshot(`"-x"`);
    expect(
      serializeCortex(['Negate', ['Multiply', 2, 3]])
    ).toMatchInlineSnapshot(`"-(2 * 3)"`);
  });

  test('Power', () => {
    expect(serializeCortex([POWER, 'x', -2])).toMatchInlineSnapshot(`"x ^ -2"`);
    expect(serializeCortex([POWER, 'x', [DIVIDE, 1, 2]])).toMatchInlineSnapshot(
      `"x ^ (1 / 2)"`
    );
    expect(
      serializeCortex([POWER, ['Negate', 2], ['Negate', 3]])
    ).toMatchInlineSnapshot(`"(-2) ^ (-3)"`);
    expect(
      serializeCortex([POWER, [ADD, 'x', 1], [DIVIDE, 1, 2]])
    ).toMatchInlineSnapshot(`"(x + 1) ^ (1 / 2)"`);
    expect(
      serializeCortex([POWER, [MULTIPLY, 2, 'x'], [DIVIDE, 1, 2]])
    ).toMatchInlineSnapshot(`"(2 * x) ^ (1 / 2)"`);
    expect(
      serializeCortex([POWER, [MULTIPLY, 2, 'x'], [SUBTRACT, 1, 'n']])
    ).toMatchInlineSnapshot(`"(2 * x) ^ (1 - n)"`);
  });
});

describe.skip('CORTEX PARSING', () => {
  test('Comments', () => {});

  test('Numbers', () => {
    expect(parseCortex('0')).toMatch('0');
    expect(parseCortex('+0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('NaN')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+Infinity')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('Infinity')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-Infinity')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+62737547')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+62_73_7__547')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('+62_73_7547.38383')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-62_73_7547.38383e-13')).toMatchInlineSnapshot(
      `"Nothing"`
    );
    expect(parseCortex('-62_73_7547.e-13')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-.1e-13')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('0b0101001011')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-0b0')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('-0b10')).toMatchInlineSnapshot(`"Nothing"`);
    expect(parseCortex('0x3.0cp2')).toMatch('12.1875');
    expect(parseCortex('0xc.3p0')).toMatch('12.1875');
    expect(parseCortex('0x3.23d70a3d70a3ep0')).toMatch('3.14');
    expect(parseCortex('0x1.91eb851eb851fp+1')).toMatch('3.14');
    expect(parseCortex('0x400')).toMatch('1024');
    expect(parseCortex('0x1.0p-4')).toMatch('0.0625');
    expect(parseCortex('0x1.0p-8')).toMatchInlineSnapshot('0.00390625');
    expect(parseCortex('0x1.0p-10')).toMatchInlineSnapshot('0.0009765625');
  });

  test('Symbols', () => {
    expect(parseCortex('`Mind 🤯`')).toMatchInlineSnapshot(`"Nothing"`);
  });

  // test('String escaping',()=>{
  // });
});
