import { latex, engine as ce } from '../../utils';

function parse(s) {
  return ce.parse(s);
}

describe('SERIALIZING SETS', () => {
  test('Set', () => {
    expect(latex(['Set'])).toMatchInlineSnapshot(`\\lbrace \\rbrace`);
    expect(latex(['Set', 2, 5, 7])).toMatchInlineSnapshot(
      `\\lbrace2, 5, 7\\rbrace`
    );
    // With lambda-condition
    // expect(
    //   latex(['Set', 'Numbers', ['Condition', ['NotEqual', '_', 0]]])
    // ).toMatchInlineSnapshot(
    //   `\\mathrm{Set}(\\mathrm{Number}, \\mathrm{Condition}(0\\ne\\text{\\_}))`
    // );
    // With predicate and named arguments
    expect(
      latex([
        'Set',
        ['Element', 'x', 'Numbers'],
        ['Condition', ['NotEqual', 'x', 0]],
      ])
    ).toMatchInlineSnapshot(
      `\\lbrace x\\in\\mathrm{Numbers}, \\mathrm{Condition}(x\\ne0)\\rbrace`
    );
  });

  // test('Range', () => {});

  // test('Interval', () => {});

  test('Multiple', () => {
    expect(latex(['Multiple', 'Integers'])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integers', 1])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integers', 1, 0])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integers', 2])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integers', 2, 0])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integers', 2, 1])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Pi', 2, 3])).toMatchInlineSnapshot(``);
    expect(
      latex(['Multiple', ['Divide', 'Pi', 2], 2, 3])
    ).toMatchInlineSnapshot(``);
  });

  test('Union, Intersection, etc...', () => {
    expect(latex(['Union', 'Integers', 'RealNumbers'])).toMatchInlineSnapshot(
      `\\Z\\cup\\R`
    );
    expect(
      latex(['Intersection', 'Integers', 'RealNumbers'])
    ).toMatchInlineSnapshot(`\\Z\\cap\\R`);
    expect(latex(['Complement', 'ComplexNumber'])).toMatchInlineSnapshot(
      `\\mathrm{ComplexNumber}^{\\complement}`
    );
    expect(latex(['CartesianProduct'])).toMatchInlineSnapshot(
      `\\mathrm{CartesianProduct}(\\error{\\blacksquare})`
    );
    expect(latex(['CartesianProduct', 'Integers'])).toMatchInlineSnapshot(
      `\\mathrm{CartesianProduct}(\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}})`
    );
    expect(
      latex(['CartesianProduct', 'Integers', 'Integers'])
    ).toMatchInlineSnapshot(
      `\\mathrm{CartesianProduct}(\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}, \\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}})`
    );
    expect(
      latex(['CartesianProduct', 'Integers', 'RationalNumber'])
    ).toMatchInlineSnapshot(
      `\\mathrm{CartesianProduct}(\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}, \\mathrm{RationalNumber})`
    );
    expect(
      latex(['CartesianProduct', 'Integers', 'Integers', 'Integers'])
    ).toMatchInlineSnapshot(
      `\\mathrm{CartesianProduct}(\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}, \\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}, \\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}})`
    );
    expect(latex(['CartesianPower', 'Integers', 3])).toMatchInlineSnapshot(
      `\\mathrm{CartesianPower}(\\Z, 3)`
    );
    expect(latex(['CartesianPower', 'Integers', 'n'])).toMatchInlineSnapshot(
      `\\mathrm{CartesianPower}(\\Z, n)`
    );
  });
});

describe('PARSING SETS', () => {
  test('Set', () => {
    // Empty set
    expect(parse('\\lbrace\\rbrace')).toMatchInlineSnapshot(`EmptySet`);

    // Finite set
    expect(parse('\\{1, 2, 3\\}')).toMatchInlineSnapshot(`["Set", 1, 2, 3]`);

    // Infinite sets
    expect(parse('\\{1, 2, 3...\\}')).toMatchInlineSnapshot(
      `["Error", "'unexpected-delimiter'", ["LatexString", "'\\{'"]]`
    );
    expect(parse('\\{1, 2, 3, ...\\}')).toMatchInlineSnapshot(
      `["Error", "'unexpected-delimiter'", ["LatexString", "'\\{'"]]`
    );
    expect(parse('\\{...-2, -1, 0, 1, 2, 3...\\}')).toMatchInlineSnapshot(
      `["Error", "'unexpected-delimiter'", ["LatexString", "'\\{'"]]`
    );
    expect(parse('\\{...-2, -1, 0\\}')).toMatchInlineSnapshot(
      `["Error", "'unexpected-delimiter'", ["LatexString", "'\\{'"]]`
    );
  });
  test('Union, Intersection, etc...', () => {
    expect(parse('\\N \\cup \\R')).toMatchInlineSnapshot(
      `["Union", "NonNegativeIntegers", "RealNumbers"]`
    );
    expect(parse('\\N \\cap \\R')).toMatchInlineSnapshot(
      `["Intersection", "NonNegativeIntegers", "RealNumbers"]`
    );
    expect(parse('\\N \\setminus \\R')).toMatchInlineSnapshot(`
      [
        "SetMinus",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Sets", "Domains"],
          "NonNegativeIntegers"
        ],
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Values", "Domains"],
          "RealNumbers"
        ]
      ]
    `);
    expect(parse('\\N^\\complement')).toMatchInlineSnapshot(`
      [
        "Complement",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Sets", "Domains"],
          "NonNegativeIntegers"
        ]
      ]
    `);
    expect(parse('\\N \\times \\N')).toMatchInlineSnapshot(`
      [
        "Multiply",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Numbers", "Domains"],
          "NonNegativeIntegers"
        ],
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Numbers", "Domains"],
          "NonNegativeIntegers"
        ]
      ]
    `);
    expect(parse('\\N^3')).toMatchInlineSnapshot(`
      [
        "Power",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Numbers", "Domains"],
          "NonNegativeIntegers"
        ],
        3
      ]
    `);
    expect(parse('\\N^{n}')).toMatchInlineSnapshot(`
      [
        "Power",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Numbers", "Domains"],
          "NonNegativeIntegers"
        ],
        "n"
      ]
    `);
  });
});
