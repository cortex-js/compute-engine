import { engine, latex, parse } from '../../utils';

describe('SERIALIZING SETS', () => {
  test('Set', () => {
    expect(latex(['Set'])).toMatchInlineSnapshot(`\\mathrm{Set}()`);
    expect(latex(['Set', 2, 5, 7])).toMatchInlineSnapshot(
      `\\mathrm{Set}(2, 5, 7)`
    );
    // With lambda-condition
    // expect(
    //   latex(['Set', 'Number', ['Condition', ['NotEqual', '_', 0]]])
    // ).toMatchInlineSnapshot(
    //   `\\mathrm{Set}(\\mathrm{Number}, \\mathrm{Condition}(0\\ne\\text{\\_}))`
    // );
    // With predicate and named arguments
    expect(
      latex([
        'Set',
        ['Element', 'x', 'Number'],
        ['Condition', ['NotEqual', 'x', 0]],
      ])
    ).toMatchInlineSnapshot(
      `\\mathrm{Set}(x\\in\\mathbf{\\mathrm{Number}}, \\mathrm{Condition}(0\\ne x))`
    );
  });

  // test('Range', () => {});

  // test('Interval', () => {});

  test('Multiple', () => {
    expect(latex(['Multiple', 'Integer'])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integer', 1])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integer', 1, 0])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integer', 2])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integer', 2, 0])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Integer', 2, 1])).toMatchInlineSnapshot(``);
    expect(latex(['Multiple', 'Pi', 2, 3])).toMatchInlineSnapshot(``);
    expect(
      latex(['Multiple', ['Divide', 'Pi', 2], 2, 3])
    ).toMatchInlineSnapshot(``);
  });

  test('Union, Intersection, etc...', () => {
    expect(latex(['Union', 'Integer', 'RealNumber'])).toMatchInlineSnapshot(
      `\\Z\\cup\\R`
    );
    expect(
      latex(['Intersection', 'Integer', 'RealNumber'])
    ).toMatchInlineSnapshot(`\\Z\\cap\\R`);
    expect(latex(['Complement', 'ComplexNumber'])).toMatchInlineSnapshot(
      `\\C^{\\complement}`
    );
    expect(latex(['CartesianProduct'])).toMatchInlineSnapshot(
      `\\error{\\blacksquare}\\times\\error{\\blacksquare}`
    );
    expect(latex(['CartesianProduct', 'Integer'])).toMatchInlineSnapshot(
      `\\Z\\times\\error{\\blacksquare}`
    );
    expect(
      latex(['CartesianProduct', 'Integer', 'Integer'])
    ).toMatchInlineSnapshot(`\\Z\\times\\Z`);
    expect(
      latex(['CartesianProduct', 'Integer', 'RationalNumber'])
    ).toMatchInlineSnapshot(`\\Z\\times\\Q`);
    expect(
      latex(['CartesianProduct', 'Integer', 'Integer', 'Integer'])
    ).toMatchInlineSnapshot(`\\Z\\times\\Z\\times\\Z`);
    expect(latex(['CartesianPower', 'Integer', 3])).toMatchInlineSnapshot(
      `\\mathrm{CartesianPower}(\\Z, 3)`
    );
    expect(latex(['CartesianPower', 'Integer', 'n'])).toMatchInlineSnapshot(
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
      `["Union", "NonNegativeInteger", "RealNumber"]`
    );
    expect(parse('\\N \\cap \\R')).toMatchInlineSnapshot(
      `["Intersection", "NonNegativeInteger", "RealNumber"]`
    );
    expect(parse('\\N \\setminus \\R')).toMatchInlineSnapshot(
      `["SetMinus", "NonNegativeInteger", "RealNumber"]`
    );
    expect(parse('\\N^\\complement')).toMatchInlineSnapshot(
      `["Complement", "NonNegativeInteger"]`
    );
    expect(parse('\\N \\times \\N')).toMatchInlineSnapshot(`
      [
        "Multiply",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "Number"],
            ["Domain", "Set"]
          ],
          "NonNegativeInteger"
        ],
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "Number"],
            ["Domain", "Set"]
          ],
          "NonNegativeInteger"
        ]
      ]
    `);
    expect(parse('\\N^3')).toMatchInlineSnapshot(`
      [
        "Power",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "Number"],
            ["Domain", "Set"]
          ],
          "NonNegativeInteger"
        ],
        3
      ]
    `);
    expect(parse('\\N^{n}')).toMatchInlineSnapshot(`
      [
        "Power",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "Number"],
            ["Domain", "Set"]
          ],
          "NonNegativeInteger"
        ],
        "n"
      ]
    `);
  });
});
