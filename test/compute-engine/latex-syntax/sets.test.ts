import { box, latex, parse } from '../../utils';

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
      `\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}\\cup\\mathtip{\\error{\\R}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}`
    );
    expect(
      latex(['Intersection', 'Integer', 'RealNumber'])
    ).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}\\cap\\mathtip{\\error{\\R}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}`
    );
    expect(latex(['Complement', 'ComplexNumber'])).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\C}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}`
    );
    expect(latex(['CartesianProduct'])).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\blacksquare}}{\\mathrm{Set}\\text{ missing}}\\times\\mathtip{\\error{\\blacksquare}}{\\mathrm{Set}\\text{ missing}}`
    );
    expect(latex(['CartesianProduct', 'Integer'])).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}\\times\\mathtip{\\error{\\blacksquare}}{\\mathrm{Set}\\text{ missing}}`
    );
    expect(
      latex(['CartesianProduct', 'Integer', 'Integer'])
    ).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}\\times\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}`
    );
    expect(
      latex(['CartesianProduct', 'Integer', 'RationalNumber'])
    ).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}\\times\\mathtip{\\error{\\Q}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}`
    );
    expect(
      latex(['CartesianProduct', 'Integer', 'Integer', 'Integer'])
    ).toMatchInlineSnapshot(
      `\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}\\times\\mathtip{\\error{\\Z}}{\\in \\mathbf{\\bar\\R}\\notin \\mathrm{Set}}\\times\\error{\\Z}`
    );
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
          ["Latex", "'\\lbrace'"]
        ],
        [
          "Error",
          ["ErrorCode", "'expected-open-delimiter'", "\\lbrace"],
          ["Latex", "'\\rbrace'"]
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
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["Latex", "'1, 2, 3\\}'"]
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
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["Latex", "'1, 2, 3...\\}'"]
        ]
      ]
    `);
    expect(parse('\\{1, 2, 3, ...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["Latex", "'1, 2, 3, ...\\}'"]
        ]
      ]
    `);
    expect(parse('\\{...-2, -1, 0, 1, 2, 3...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'.'"],
          ["Latex", "'...-2, -1, 0, 1, 2, 3...\\}'"]
        ]
      ]
    `);
    expect(parse('\\{...-2, -1, 0\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'.'"],
          ["Latex", "'...-2, -1, 0\\}'"]
        ]
      ]
    `);
  });
  test('Union, Intersection, etc...', () => {
    expect(parse('\\N \\cup \\R')).toMatchInlineSnapshot(`
      [
        "Union",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Set",
            ["Domain", "ExtendedRealNumber"]
          ],
          "NonNegativeInteger"
        ],
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Set",
            ["Domain", "ExtendedRealNumber"]
          ],
          "RealNumber"
        ]
      ]
    `);
    expect(parse('\\N \\cap \\R')).toMatchInlineSnapshot(`
      [
        "Intersection",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Set",
            ["Domain", "ExtendedRealNumber"]
          ],
          "NonNegativeInteger"
        ],
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Set",
            ["Domain", "ExtendedRealNumber"]
          ],
          "RealNumber"
        ]
      ]
    `);
    expect(parse('\\N \\setminus \\R')).toMatchInlineSnapshot(`
      [
        "SetMinus",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Set",
            ["Domain", "ExtendedRealNumber"]
          ],
          "NonNegativeInteger"
        ],
        "RealNumber"
      ]
    `);
    expect(box('\\N^\\complement')).toMatchInlineSnapshot(`\\N^\\complement`);
    expect(parse('\\N \\times \\N')).toMatchInlineSnapshot(
      `["Square", "NonNegativeInteger"]`
    );
    expect(parse('\\N^3')).toMatchInlineSnapshot(
      `["Power", "NonNegativeInteger", 3]`
    );
    expect(parse('\\N^{n}')).toMatchInlineSnapshot(
      `["Power", "NonNegativeInteger", "n"]`
    );
  });
});
