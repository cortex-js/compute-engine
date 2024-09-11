import { latex, engine as ce } from '../../utils';

function parse(s: string) {
  return ce.parse(s);
}

describe('LIST PARSING', () => {
  test('Empty list', () => {
    expect(parse('\\lbrack\\rbrack')).toMatchInlineSnapshot(`["List"]`);
    expect(parse('\\lbrack \\rbrack')).toMatchInlineSnapshot(`["List"]`);
  });

  test('One element list', () => {
    expect(parse('\\lbrack2\\rbrack')).toMatchInlineSnapshot(`["List", 2]`);
    expect(parse('\\lbrack x\\rbrack')).toMatchInlineSnapshot(`["List", "x"]`);
    expect(parse('\\lbrack x+1\\rbrack')).toMatchInlineSnapshot(
      `["List", ["Add", "x", 1]]`
    );
  });

  test('Iverson bracket (not a list)', () => {
    expect(parse('\\lbrack x+1=0\\rbrack')).toMatchInlineSnapshot(
      `["Boole", ["Equal", ["Add", "x", 1], 0]]`
    );
  });

  test('Multi element list', () => {
    expect(parse('\\lbrack 1, 2\\rbrack')).toMatchInlineSnapshot(
      `["List", 1, 2]`
    );
    expect(parse('\\lbrack 2, y\\rbrack')).toMatchInlineSnapshot(
      `["List", 2, "y"]`
    );
    expect(parse('\\lbrack x+1=0, 2x^2+5=1\\rbrack')).toMatchInlineSnapshot(`
      [
        "List",
        ["Equal", ["Add", "x", 1], 0],
        ["Equal", ["Add", ["Multiply", 2, ["Power", "x", 2]], 5], 1]
      ]
    `);
  });

  test('Lists of lists', () => {
    expect(
      parse('\\lbrack \\lbrack 1, 2\\rbrack, \\lbrack 3, 4\\rbrack \\rbrack')
    ).toMatchInlineSnapshot(`["List", ["List", 1, 2], ["List", 3, 4]]`);
    expect(parse('\\lbrack 1, 2; 3, 4 \\rbrack')).toMatchInlineSnapshot(
      `["List", ["List", 1, 2], ["List", 3, 4]]`
    );
  });
});

describe('LIST SERIALIZATION', () => {
  test('Empty list', () =>
    expect(latex('\\lbrack\\rbrack')).toMatchInlineSnapshot(
      `\\error{\\text{\\lbrack\\rbrack}}`
    ));
});

describe('RANGE', () => {
  test('simple range', () => {
    expect(parse('1..5')).toMatchInlineSnapshot(`["Range", 1, 5]`);
  });

  test('simple range with step', () => {
    expect(parse('1..3..5')).toMatchInlineSnapshot(`
      [
        "Range",
        1,
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-type'",
            "'number'",
            "'collection<integer>'"
          ]
        ]
      ]
    `);
  }); // @fixme

  test('range with expressions', () => {
    expect(parse('n+1..n+10')).toMatchInlineSnapshot(
      `["Add", "n", ["Range", 1, ["Add", "n", 10]]]`
    );
  });

  test('range with expressions with multiplication', () => {
    expect(parse('2n..3n')).toMatchInlineSnapshot(
      `["Multiply", 2, ["Range", "n", ["Multiply", 3, "n"]]]`
    );
  });

  test('range with expressions with addition and multiplication', () => {
    expect(parse('(2n + 1)..(3n + 10)')).toMatchInlineSnapshot(`
      [
        "Range",
        ["Add", ["Multiply", 2, "n"], 1],
        ["Add", ["Multiply", 3, "n"], 10]
      ]
    `);
  });

  test('range with equality', () => {
    expect(parse('x = n+1..n+10')).toMatchInlineSnapshot(
      `["Equal", "x", ["Add", "n", ["Range", 1, ["Add", "n", 10]]]]`
    );
  });

  test('range with assignment', () => {
    expect(parse('x := 5..13')).toMatchInlineSnapshot(
      `["Assign", "x", ["Range", 5, 13]]`
    );
  });
});
