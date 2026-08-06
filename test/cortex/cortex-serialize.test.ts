import { ComputeEngine } from '../../src/compute-engine';
import { serializeCortex } from '../../src/cortex/serialize-cortex';

describe('CORTEX SERIALIZING', () => {
  test('Numbers', () => {
    expect(serializeCortex(1)).toMatch('1');
    expect(serializeCortex(+1)).toMatch('1');
    expect(serializeCortex(-123)).toMatch('-123');
    expect(serializeCortex(-1234567.89)).toMatchInlineSnapshot(
      `"-1_234_567.89"`
    );
    expect(serializeCortex(-1234567.89e-123)).toMatchInlineSnapshot(
      `"-123_456_789e-125"`
    );
    expect(serializeCortex({ num: '-1234567.890e-123' })).toMatchInlineSnapshot(
      `"-1_234_567_890e-126"`
    );
    expect(
      serializeCortex({ num: '-123456789012345678901234567890.890e-123' })
    ).toMatchInlineSnapshot(
      `"-123_456_789_012_345_678_901_234_567_890_890e-126"`
    );
    // Cortex's canonical infinity spelling is unsigned (`Infinity`); the
    // `+Infinity` payload spelling is input-only.
    expect(serializeCortex({ num: '+Infinity' })).toBe('Infinity');
    expect(serializeCortex({ num: '-Infinity' })).toBe('-Infinity');
    expect(serializeCortex({ num: 'NaN' })).toMatch('NaN');
    expect(serializeCortex({ num: 'Infinity' })).toBe('Infinity');

    // Repeating pattern
    expect(
      serializeCortex({ num: '3.123456785678567856785678567856785678' })
    ).toMatchInlineSnapshot(
      `"3.123_456_785_678_567_856_785_678_567_856_785_678"`
    );

    expect(
      serializeCortex({ num: '0.1234567872368237462387623876' })
    ).toMatchInlineSnapshot(`"0.123_456_787_236_823_746_238_762_387_6"`);
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
});

describe('CORTEX SERIALIZING COMMENTS', () => {
  test('Comment', () => {
    expect(
      serializeCortex({
        fn: ['Multiply', 'Pi', 'x'],
        comment: 'This is a single line-comment',
      })
    ).toMatchInlineSnapshot(`"/* This is a single line-comment */Pi * x"`);
    expect(
      serializeCortex({
        fn: ['Multiply', 'Pi', 'x'],
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
});

describe('CORTEX SERIALIZING SPACES', () => {
  test('Spacing', () => {
    expect(serializeCortex(['Multiply', 'Pi', 'x'])).toMatchInlineSnapshot(
      `"Pi * x"`
    );
  });
});

describe('CORTEX SERIALIZING STRINGS', () => {
  test('Strings', () => {
    expect(serializeCortex("''")).toMatch('');
    expect(serializeCortex("'x'")).toMatchInlineSnapshot(`""x""`);
    expect(serializeCortex("'hello world'")).toMatchInlineSnapshot(
      `""hello world""`
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
    expect(serializeCortex(['Print', "'LaTeX loves \\'"])).toMatch(
      'Print("LaTeX loves \\\\")'
    );
    expect(serializeCortex(['Print', "'hello'", "'\nworld'"])).toMatch(
      'Print("hello", "\\nworld")'
    );
  });
});
describe('CORTEX SERIALIZING SYMBOLS', () => {
  test('Symbols (not wrapped)', () => {
    expect(serializeCortex('x')).toMatch('x');
    expect(serializeCortex('symbol')).toMatch('symbol');
    expect(serializeCortex('x12')).toMatch('x12');
    expect(serializeCortex('😀')).toMatch('😀');
    expect(serializeCortex('👨🏻‍🎤')).toMatch('👨🏻‍🎤');
    expect(serializeCortex('🤯')).toMatch('🤯');
    expect(serializeCortex('🤯😭')).toMatch('🤯😭');
    expect(serializeCortex('Mind🤯')).toMatch('Mind🤯'); // Mix of emojis and other things
    expect(serializeCortex({ sym: 'x' })).toMatch('x');
    expect(serializeCortex({ sym: '12' })).toMatch('12');
    expect(serializeCortex({ sym: 'symbol' })).toMatch('symbol');
    // Not a reserved word
    expect(serializeCortex('new2')).toMatch('new2');
    expect(serializeCortex('_f')).toMatch('_f');
    expect(serializeCortex('_')).toMatch('_');
  });

  test('Escaped Symbols', () => {
    expect(serializeCortex('`a\u0000b`')).toMatch('`a\\0b`'); // Include a null char
    expect(serializeCortex('`a\tb`')).toMatch('`a\\tb`'); // Include a tab
    expect(serializeCortex('`a\nb`')).toMatch('`a\\nb`'); // Include a linebreak
    expect(serializeCortex('`a\u0003b`')).toMatch('`a\\u0003b`'); // Include a ETX (END OF TEXT)
    expect(serializeCortex('`a\u007fb`')).toMatch('`a\\u007fb`'); // Include a delete char
  });

  test('Verbatim symbols', () => {
    // A word the grammar claims has no plain spelling
    expect(serializeCortex('while')).toMatch('`while`');
    expect(serializeCortex('NaN')).toMatch('`NaN`');
    // …but a merely-reserved word is an ordinary identifier and stays plain
    expect(serializeCortex('new')).toBe('new');
    // Contain a syntax character
    expect(serializeCortex('`x+y`')).toMatch('`x+y`');
    // Start with a Syntax character
    expect(serializeCortex('`\\sin`')).toMatch('`\\\\sin`');
    expect(serializeCortex('`~f`')).toMatch('`~f`');
    expect(serializeCortex('```')).toMatch('```');

    // Contains a non-letter/non-digit
    expect(serializeCortex('`a+b`')).toMatch('`a+b`');
    expect(serializeCortex('`a;b`')).toMatch('`a;b`');

    expect(serializeCortex('`a b`')).toMatch('`a b`'); // Includes a space
    expect(serializeCortex('`a\nb`')).toMatch('`a\\nb`');
  });

  test('Invalid Symbols', () => {
    // Contain a SPACE
    expect(serializeCortex('`a b`')).toMatchInlineSnapshot(`"\`a b\`"`);
    // Contain a reverse solidus
    expect(serializeCortex('`a\\b`')).toMatchInlineSnapshot(`"\`a\\\\b\`"`);
    // First char is a dollar
    expect(serializeCortex('`$a`')).toMatchInlineSnapshot(`"\`$a\`"`);
    // First char is a left square bracket
    expect(serializeCortex('`[a`')).toMatchInlineSnapshot(`"\`[a\`"`);
    // First char is a right square bracket
    expect(serializeCortex('`]a`')).toMatchInlineSnapshot(`"\`]a\`"`);
    // Start with a digit
    expect(serializeCortex('`12x`')).toMatch('12');
    // Start with a `+`
    expect(serializeCortex('`+x`')).toMatch('');
  });
});

describe('CORTEX SERIALIZING FUNCTIONS', () => {
  test('Functions', () => {
    expect(serializeCortex(['f'])).toMatchInlineSnapshot(`"f()"`);
    expect(serializeCortex(['f', 'x', 1, 0])).toMatchInlineSnapshot(
      `"f(x, 1, 0)"`
    );
    expect(serializeCortex(['foo', 'x', 1, 0])).toMatchInlineSnapshot(
      `"foo(x, 1, 0)"`
    );
    expect(serializeCortex(['Divide', 'n', 4])).toMatchInlineSnapshot(
      `"n / 4"`
    );
  });
});

describe('CORTEX SERIALIZING DICTIONARIES', () => {
  test('Dictionaries', () => {
    // Empty dictionary
    expect(serializeCortex({ dict: {} })).toMatchInlineSnapshot(`"{ -> }"`);

    //Regular dictionary
    expect(
      serializeCortex({ dict: { x: 1, y: 2, z: ['Add', 2, 'x'] } })
    ).toMatchInlineSnapshot(`"{"x" -> 1, "y" -> 2, "z" -> 2 + x}"`);

    // Nested dictionary
    expect(
      serializeCortex({
        dict: { x: { dict: { a: 7, b: 5 } }, y: 2, z: ['Add', 2, 'x'] },
      })
    ).toMatchInlineSnapshot(
      `"{"x" -> {"a" -> 7, "b" -> 5}, "y" -> 2, "z" -> 2 + x}"`
    );
    // @todo:indexed-access

    // The dictionary-object form (`{ dict: … }`) and the operator form
    // (`["Dictionary", ["KeyValuePair", …], …]`) serialize identically.
    expect(serializeCortex({ dict: { one: 1, two: 2 } })).toEqual(
      serializeCortex([
        'Dictionary',
        ['KeyValuePair', { str: 'one' }, 1],
        ['KeyValuePair', { str: 'two' }, 2],
      ])
    );
  });

  // A `{dict: …}` VALUE is a `DictionaryValue`, which — unlike a
  // `MathJsonExpression` — may be a JS boolean. Canonicalizing a dictionary
  // collapses the `True`/`False` symbols to booleans, so this is the shape a
  // round-tripped bag actually carries; it used to render as an EMPTY value
  // (`{"a" -> }`), which does not re-parse.
  test('boolean dictionary values render as the True/False symbols', () => {
    expect(
      serializeCortex({ dict: { a: true, b: false, c: 3 } })
    ).toMatchInlineSnapshot(`"{"a" -> True, "b" -> False, "c" -> 3}"`);

    // The operator form and the canonicalized shorthand agree.
    expect(serializeCortex({ dict: { a: true } })).toEqual(
      serializeCortex(['Dictionary', ['KeyValuePair', { str: 'a' }, 'True']])
    );
  });
});

describe('CORTEX SERIALIZING COLLECTIONS', () => {
  test('Sets', () => {
    // Empty set
    expect(serializeCortex(['Set'])).toMatchInlineSnapshot(`"{}"`);
    //Regular set
    expect(
      serializeCortex(['Set', 5, 7, 'x', ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"{5, 7, x, 5 + x + 2}"`);
    // Nested sets
    expect(
      serializeCortex(['Set', 5, 7, ['Set', 7, 8, 9], ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"{5, 7, {7, 8, 9}, 5 + x + 2}"`);

    // @todo:set membership
  });

  test('Lists', () => {
    // Empty list
    expect(serializeCortex(['List'])).toMatchInlineSnapshot(`"[]"`);
    //Regular list
    expect(
      serializeCortex(['List', 5, 7, 'x', ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"[5, 7, x, 5 + x + 2]"`);
    // Nested lists
    expect(
      serializeCortex(['Set', 5, 7, ['List', 7, 8, 9], ['Add', 5, 'x', 2]])
    ).toMatchInlineSnapshot(`"{5, 7, [7, 8, 9], 5 + x + 2}"`);
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
  });

  test('Tuple', () => {
    expect(serializeCortex(['Tuple'])).toMatchInlineSnapshot(`"Tuple()"`);
    // A 2+ element tuple serializes to the parenthesized `(…)` form (Stage B),
    // which round-trips back to a `Tuple`.
    expect(
      serializeCortex(['Tuple', 5, 'x', 7, ['Add', 'x', 3, 'y']])
    ).toMatchInlineSnapshot(`"(5, x, 7, x + 3 + y)"`);
    expect(
      serializeCortex([
        'Tuple',
        5,
        'x',
        ['Tuple', 11, 13],
        ['Add', 'x', 3, 'y'],
      ])
    ).toMatchInlineSnapshot(`"(5, x, (11, 13), x + 3 + y)"`);
  });
});
describe('CORTEX SERIALIZING OPERATORS', () => {
  test('Operators', () => {
    expect(serializeCortex(['Add', 'a', 'b'])).toMatchInlineSnapshot(`"a + b"`);
    // Invisible operator
    expect(serializeCortex(['Multiply', 'a', 'b'])).toMatchInlineSnapshot(
      `"a * b"`
    );
    expect(
      serializeCortex(['Multiply', ['Add', 'x', 1], ['Subtract', 'x', 1]])
    ).toMatchInlineSnapshot(`"(x + 1) * (x - 1)"`);
    expect(
      serializeCortex(['Add', ['Multiply', 'x', -1], ['Multiply', 'x', 2]])
    ).toMatchInlineSnapshot(`"x * -1 + x * 2"`);
    expect(
      serializeCortex(['Subtract', ['Negate', 'x'], -1])
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
    // Invisible multiplication: binary number×symbol.
    expect(serializeCortex(['Multiply', 2, 'x'])).toMatchInlineSnapshot(`"2x"`);
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
  test('Element', () => {
    expect(serializeCortex(['Element', 'x', 'S'])).toMatchInlineSnapshot(
      `"x in S"`
    );
    expect(serializeCortex(['NotElement', 'x', 'S'])).toMatchInlineSnapshot(
      `"x !in S"`
    );
  });
  test('Unary operators', () => {
    expect(serializeCortex(['Negate'])).toMatchInlineSnapshot(`"Negate()"`);
    expect(serializeCortex(['Negate', 2, 3])).toMatchInlineSnapshot(
      `"Negate(2, 3)"`
    );
    expect(serializeCortex(['Negate', 1])).toMatchInlineSnapshot(`"-1"`);
    // Negate of a negative literal folds the sign in (not `--1`, which is a
    // diagnostic).
    expect(serializeCortex(['Negate', -1])).toMatchInlineSnapshot(`"1"`);
    expect(serializeCortex(['Negate', ['Add', 2, 3]])).toMatchInlineSnapshot(
      `"-(2 + 3)"`
    );
    expect(serializeCortex(['Negate', 'x'])).toMatchInlineSnapshot(`"-x"`);
    expect(
      serializeCortex(['Negate', ['Multiply', 2, 3]])
    ).toMatchInlineSnapshot(`"-(2 * 3)"`);
  });
  // Invisible multiplication is emitted only for a binary number×symbol
  // (`2x`). Everything else — n-ary products, number×group (`2(3+4)`),
  // group×group — stays explicit `*`: `2(3+4)` would round-trip fine, but
  // `(x+y)(3+4)` parses back as `Apply`, not `Multiply`, so the serializer
  // keeps a uniform explicit rule for all non-`{num}{sym}` products.
  test('Multiply', () => {
    expect(serializeCortex(['Multiply', 2, 'x'])).toMatch('2x');
    expect(serializeCortex(['Multiply', 'x', 2])).toMatch('x * 2');
    expect(serializeCortex(['Multiply', 2, ['Add', 3, 4]])).toMatch(
      '2 * (3 + 4)'
    );
    expect(
      serializeCortex(['Multiply', ['Add', 'x', 'y'], ['Add', 3, 4]])
    ).toMatch('(x + y) * (3 + 4)');
    expect(
      serializeCortex(['Multiply', ['Multiply', 'x', 'y'], ['Add', 3, 4]])
    ).toMatch('x * y * (3 + 4)');
  });
  // `Rational` serializes as `a / b` (and re-parses as `Divide`, a documented
  // normalization). Mixed-number / invisible-plus rendering (`2½`) is out of
  // scope for v0 — the serializer never merges an `Add` into a mixed number.
  test('Plus', () => {
    expect(serializeCortex(['Add', 2, ['Rational', 1, 2]])).toMatch(
      '2 + 1 / 2'
    );
    expect(serializeCortex(['Add', 'x', ['Rational', 1, 2]])).toMatch(
      'x + 1 / 2'
    );
  });

  test('Power', () => {
    expect(serializeCortex(['Power', 'x', -2])).toMatchInlineSnapshot(
      `"x ^ -2"`
    );
    expect(
      serializeCortex(['Power', 'x', ['Divide', 1, 2]])
    ).toMatchInlineSnapshot(`"x ^ (1 / 2)"`);
    expect(
      serializeCortex(['Power', ['Negate', 2], ['Negate', 3]])
    ).toMatchInlineSnapshot(`"(-2) ^ (-3)"`);
    expect(
      serializeCortex(['Power', ['Add', 'x', 1], ['Divide', 1, 2]])
    ).toMatchInlineSnapshot(`"(x + 1) ^ (1 / 2)"`);
    expect(
      serializeCortex(['Power', ['Multiply', 2, 'x'], ['Divide', 1, 2]])
    ).toMatchInlineSnapshot(`"(2x) ^ (1 / 2)"`);
    expect(
      serializeCortex(['Power', ['Multiply', 2, 'x'], ['Subtract', 1, 'n']])
    ).toMatchInlineSnapshot(`"(2x) ^ (1 - n)"`);
  });

  test('Mod', () => {
    expect(serializeCortex(['Mod', 'a', 'b'])).toMatchInlineSnapshot(`"a % b"`);
    // `%` is multiplicative-precedence, so a `+` operand parenthesizes.
    expect(
      serializeCortex(['Mod', ['Add', 'a', 'b'], 'c'])
    ).toMatchInlineSnapshot(`"(a + b) % c"`);
    // …but a `Mod` inside an `Add` does not.
    expect(
      serializeCortex(['Add', 'a', ['Mod', 'b', 'c']])
    ).toMatchInlineSnapshot(`"a + b % c"`);
  });

  test('Factorial', () => {
    expect(serializeCortex(['Factorial', 5])).toMatchInlineSnapshot(`"5!"`);
    expect(serializeCortex(['Factorial', 'n'])).toMatchInlineSnapshot(`"n!"`);
    // A call operand needs no parens (`f(x)!` re-parses as Factorial(f(x))).
    expect(
      serializeCortex(['Factorial', ['f', 'x']])
    ).toMatchInlineSnapshot(`"f(x)!"`);
    // An operator operand at or below `!`'s precedence parenthesizes.
    expect(
      serializeCortex(['Factorial', ['Add', 'a', 'b']])
    ).toMatchInlineSnapshot(`"(a + b)!"`);
    expect(
      serializeCortex(['Factorial', ['Power', 'x', 2]])
    ).toMatchInlineSnapshot(`"(x ^ 2)!"`);
    // A nested factorial must parenthesize — `n!!` classically means double
    // factorial, so the serializer never emits it.
    expect(
      serializeCortex(['Factorial', ['Factorial', 'n']])
    ).toMatchInlineSnapshot(`"(n!)!"`);
    // As an operand of Power, `!` binds tighter, so no parens on the exponent.
    expect(
      serializeCortex(['Power', 2, ['Factorial', 3]])
    ).toMatchInlineSnapshot(`"2 ^ 3!"`);
  });
});

describe('CORTEX SERIALIZING SPREAD', () => {
  test('a Spread argument serializes as `...`', () => {
    expect(serializeCortex(['f', ['Spread', 'p']])).toBe('f(...p)');
    expect(serializeCortex(['f', 1, ['Spread', ['Tuple', 'p', 'q']]])).toBe(
      'f(1, ...(p, q))'
    );
  });
});

// `If` has two Cortex spellings, chosen by the shape of its branches: the
// block form (`Block` branches) and the conditional expression (plain
// expression branches). A shape that is neither keeps the generic call form.
describe('CORTEX SERIALIZING IF', () => {
  const rt = (src: string) => {
    const { parseCortex } = require('../../src/cortex/parse-cortex');
    const strip = (x: any) =>
      JSON.parse(
        JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
      );
    const [v] = parseCortex(src);
    return serializeCortex(strip(v));
  };

  test('Block branches serialize as the block form', () => {
    expect(serializeCortex(['If', 'c', ['Block', 1], ['Block', 2]])).toBe(
      'if c {1} else {2}'
    );
    expect(serializeCortex(['If', 'c', ['Block', 1]])).toBe('if c {1}');
    expect(
      serializeCortex([
        'If',
        'c',
        ['Block', 1],
        ['If', 'd', ['Block', 2], ['Block', 3]],
      ])
    ).toBe('if c {1} else if d {2} else {3}');
  });

  test('expression branches serialize as the conditional form', () => {
    expect(serializeCortex(['If', 'c', 1, 2])).toBe('1 if c else 2');
    expect(serializeCortex(['If', ['Greater', 'x', 0], 1, 2])).toBe(
      '1 if x > 0 else 2'
    );
  });

  // The conditional binds looser than every ordinary operator, so an `If` in
  // operand position needs parentheses — without them `1 if c else 2 + 3`
  // re-parses as `If(c, 1, 2 + 3)`.
  test('a conditional in operand position is parenthesized', () => {
    expect(serializeCortex(['Add', ['If', 'c', 1, 2], 3])).toBe(
      '(1 if c else 2) + 3'
    );
    expect(serializeCortex(['Assign', 'x', ['If', 'c', 1, 2]])).toBe(
      'x := 1 if c else 2'
    );
  });

  // Chaining is right-nested: an `If` in the alternative needs no parentheses,
  // one in the consequent does.
  test('nested conditionals parenthesize on the left only', () => {
    expect(serializeCortex(['If', 'c', 1, ['If', 'd', 2, 3]])).toBe(
      '1 if c else 2 if d else 3'
    );
    expect(serializeCortex(['If', 'c', ['If', 'd', 1, 2], 3])).toBe(
      '(1 if d else 2) if c else 3'
    );
  });

  // The forms the conditional binds tighter than take no parentheses on the
  // right, and do take them when they are the consequent.
  test('parenthesization follows the precedence on both sides', () => {
    expect(
      serializeCortex(['KeyValuePair', { str: 'k' }, ['If', 'c', 1, 2]])
    ).toBe('"k" -> 1 if c else 2');
    expect(
      serializeCortex(['If', 'c', ['KeyValuePair', { str: 'k' }, 1], 2])
    ).toBe('("k" -> 1) if c else 2');
    expect(serializeCortex(['Pipe', 'xs', ['If', 'c', 'f', 'g']])).toBe(
      'xs |> f if c else g'
    );
    expect(serializeCortex(['If', 'c', ['Or', 'a', 'b'], 'd'])).toBe(
      'a || b if c else d'
    );
    expect(serializeCortex(['Or', ['If', 'c', 'a', 'b'], 'd'])).toBe(
      '(a if c else b) || d'
    );
  });

  test('shapes with neither spelling keep the generic call form', () => {
    // Mixed branches — a `Block` consequent with an expression alternative.
    expect(serializeCortex(['If', 'c', ['Block', 1], 2])).toBe(
      'If(c, do {1}, 2)'
    );
    // No else: there is no conditional spelling for a missing branch.
    expect(serializeCortex(['If', 'c', 1])).toBe('If(c, 1)');
  });

  test('both forms round-trip from source', () => {
    expect(rt('if c { 1 } else { 2 }')).toBe('if c {1} else {2}');
    expect(rt('if c { 1 } else if d { 2 } else { 3 }')).toBe(
      'if c {1} else if d {2} else {3}'
    );
    expect(rt('if c { let x = 1\n x + 1 }')).toBe('if c {let x = 1; x + 1}');
    expect(rt('1 if c else 2')).toBe('1 if c else 2');
    expect(rt('x = 1 if c else 2')).toBe('x := 1 if c else 2');
    expect(rt('1 if c else 2 if d else 3')).toBe('1 if c else 2 if d else 3');
    expect(rt('x + if c { 1 } else { 2 }')).toBe('x + (if c {1} else {2})');
  });
});

// `Declare` reconstructs the `let`/`const` statement syntax; shapes with no
// such spelling (extra attributes, a computed name) keep the generic form.
describe('CORTEX SERIALIZING DECLARATIONS', () => {
  const rt = (src: string) => {
    const { parseCortex } = require('../../src/cortex/parse-cortex');
    const strip = (x: any) =>
      JSON.parse(
        JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
      );
    const [v] = parseCortex(src);
    return serializeCortex(strip(v));
  };

  test('scalar declarations round-trip to their source form', () => {
    expect(rt('let x = 5')).toBe('let x = 5');
    expect(rt('const c = 6.28')).toBe('const c = 6.28');
    expect(rt('let x')).toBe('let x');
    expect(rt('let x: real')).toBe('let x: real');
    expect(rt('let x: real = 5')).toBe('let x: real = 5');
  });

  test('destructuring declarations round-trip', () => {
    expect(rt('let (x, y) = p')).toBe('let (x, y) = p');
    expect(rt('const (q, r) = divmod(17, 5)')).toBe(
      'const (q, r) = divmod(17, 5)'
    );
    expect(rt('let ((a, b), _, c) = t')).toBe('let ((a, b), _, c) = t');
  });

  test('inexpressible shapes fall back to the generic form', () => {
    expect(
      serializeCortex([
        'Declare',
        'x',
        ['Dictionary', ['KeyValuePair', { sym: 'holdUntil' }, { str: 'never' }]],
      ] as any)
    ).toBe('Declare(x, {holdUntil -> "never"})');
  });

  // Canonicalizing rewrites the attributes bag into the `{dict: …}` shorthand
  // and collapses the `True` symbol to a JS boolean. Reading only the operator
  // `Dictionary` form lost the `let`/`const` spelling on that route, and the
  // boolean rendered empty (`{"constant" -> }`).
  test('declarations survive a canonical-box round trip', () => {
    const { parseCortex } = require('../../src/cortex/parse-cortex');
    const ce = new ComputeEngine();
    const rtBoxed = (src: string) =>
      serializeCortex(ce.box(parseCortex(src)[0]).json as any);

    expect(rtBoxed('let x = 5')).toBe('let x = 5');
    expect(rtBoxed('const c = 5')).toBe('const c = 5');
    expect(rtBoxed('type alias pt = tuple<integer, integer>')).toBe(
      'type alias pt = tuple<integer, integer>'
    );
    expect(rtBoxed('type alias Pair<T> = tuple<T, T>')).toBe(
      'type alias Pair<T> = tuple<T, T>'
    );
    expect(rtBoxed('type nom = tuple<integer, integer>')).toBe(
      'type nom = tuple<integer, integer>'
    );
  });

  // The flag is accepted in every encoding an attributes bag can carry it in,
  // matching the engine-side readers (`declareTypeStatement`, `Declare`'s
  // evaluate handler). A JS boolean is a `DictionaryValue`, so it is only
  // reachable through the `{dict: …}` shorthand — never inside the operator
  // form, where the value position holds a `MathJsonExpression`.
  test('the `constant`/`alias` flag is read in every encoding', () => {
    const constantBags = [
      ['Dictionary', ['KeyValuePair', { str: 'constant' }, 'True'], ['KeyValuePair', { str: 'value' }, 5]],
      ['Dictionary', ['KeyValuePair', { str: 'constant' }, { str: 'True' }], ['KeyValuePair', { str: 'value' }, 5]],
      { dict: { constant: 'True', value: 5 } },
      { dict: { constant: true, value: 5 } },
    ];
    for (const bag of constantBags)
      expect(serializeCortex(['Declare', 'k', bag] as any)).toBe('const k = 5');

    const aliasBags = [
      ['Dictionary', ['KeyValuePair', { str: 'alias' }, 'True']],
      ['Dictionary', ['KeyValuePair', { str: 'alias' }, { str: 'True' }]],
      { dict: { alias: 'True' } },
      { dict: { alias: true } },
    ];
    for (const bag of aliasBags)
      expect(
        serializeCortex([
          'DeclareType',
          'pt',
          { str: 'tuple<integer, integer>' },
          bag,
        ] as any)
      ).toBe('type alias pt = tuple<integer, integer>');
  });
});
