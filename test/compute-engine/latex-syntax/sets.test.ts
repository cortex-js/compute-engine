import { latex, parse } from '../../utils';

describe('SERIALIZING SETS', () => {
  test('Set', () => {
    expect(latex(['Set'])).toMatchInlineSnapshot(`\\mathrm{Set}()`);
    expect(latex(['Set', 2, 5, 7])).toMatchInlineSnapshot(
      `\\mathrm{Set}(2, 5, 7)`
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
      `\\mathrm{Set}(x\\in\\mathrm{Numbers}, \\mathrm{Condition}(0\\ne x))`
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
      `\\mathtip{\\error{\\mathrm{ComplexNumber}}}{\\in \\bar\\R\\notin \\mathrm{Sets}}^{\\complement}`
    );
    expect(latex(['CartesianProduct'])).toMatchInlineSnapshot(
      `\\error{\\blacksquare}\\times\\error{\\blacksquare}`
    );
    expect(latex(['CartesianProduct', 'Integers'])).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}\\times\\error{\\blacksquare}`
    );
    expect(
      latex(['CartesianProduct', 'Integers', 'Integers'])
    ).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}\\times\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}`
    );
    expect(
      latex(['CartesianProduct', 'Integers', 'RationalNumber'])
    ).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}\\times\\mathtip{\\error{\\mathrm{RationalNumber}}}{\\in \\bar\\R\\notin \\mathrm{Sets}}`
    );
    expect(
      latex(['CartesianProduct', 'Integers', 'Integers', 'Integers'])
    ).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}\\times\\mathtip{\\error{\\Z}}{\\in \\mathrm{Domains}\\notin \\mathrm{Sets}}\\times\\error{\\Z}`
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
    expect(parse('\\lbrace\\rbrace')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\lbrace'"],
          ["LatexString", "'\\lbrace'"]
        ],
        [
          "Error",
          ["ErrorCode", "'expected-open-delimiter'", "'\\lbrace'"],
          ["LatexString", "'\\rbrace'"]
        ]
      ]
    `);

    // Finite set
    expect(parse('\\{1, 2, 3\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["LatexString", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["LatexString", "'1, 2, 3\\}'"]
        ]
      ]
    `);

    // Infinite sets
    expect(parse('\\{1, 2, 3...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["LatexString", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["LatexString", "'1, 2, 3...\\}'"]
        ]
      ]
    `);
    expect(parse('\\{1, 2, 3, ...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["LatexString", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["LatexString", "'1, 2, 3, ...\\}'"]
        ]
      ]
    `);
    expect(parse('\\{...-2, -1, 0, 1, 2, 3...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["LatexString", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'.'"],
          ["LatexString", "'...-2, -1, 0, 1, 2, 3...\\}'"]
        ]
      ]
    `);
    expect(parse('\\{...-2, -1, 0\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["LatexString", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'.'"],
          ["LatexString", "'...-2, -1, 0\\}'"]
        ]
      ]
    `);
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
