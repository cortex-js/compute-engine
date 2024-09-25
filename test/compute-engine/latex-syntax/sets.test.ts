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
        'Filter',
        ['Set', ['Element', '_', 'Numbers']],
        ['NotEqual', '_', 0],
      ])
    ).toMatchInlineSnapshot(
      `\\mathrm{Filter}(\\lbrace\\operatorname{\\_}\\in\\mathrm{Numbers}\\rbrace, \\operatorname{\\_}\\ne0)`
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
      `\\mathrm{CartesianProduct}(\\Z)`
    );
    expect(
      latex(['CartesianProduct', 'Integers', 'Integers'])
    ).toMatchInlineSnapshot(`\\mathrm{CartesianProduct}(\\Z, \\Z)`);
    expect(
      latex(['CartesianProduct', 'Integers', 'RationalNumbers'])
    ).toMatchInlineSnapshot(`\\mathrm{CartesianProduct}(\\Z, \\Q)`);
    expect(
      latex(['CartesianProduct', 'Integers', 'Integers', 'Integers'])
    ).toMatchInlineSnapshot(`\\mathrm{CartesianProduct}(\\Z, \\Z, \\Z)`);
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
    expect(parse('\\{1, 2, 3...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Delimiter",
          [
            "Sequence",
            [
              "InvisibleOperator",
              ["Error", "'unexpected-command'", ["LatexString", "'\\{'"]],
              1
            ],
            2,
            3
          ],
          "','"
        ],
        ["Error", "'unexpected-operator'", ["LatexString", "'..'"]]
      ]
    `);
    expect(parse('\\{1, 2, 3, ...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        [
          "Delimiter",
          [
            "Sequence",
            [
              "InvisibleOperator",
              ["Error", "'unexpected-command'", ["LatexString", "'\\{'"]],
              1
            ],
            2,
            3,
            "Nothing"
          ],
          "','"
        ],
        ["Error", "'unexpected-operator'", ["LatexString", "'..'"]]
      ]
    `);
    expect(parse('\\{...-2, -1, 0, 1, 2, 3...\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Error", "'unexpected-command'", ["LatexString", "'\\{'"]],
        ["Error", "'unexpected-operator'", ["LatexString", "'..'"]]
      ]
    `);
    expect(parse('\\{...-2, -1, 0\\}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Error", "'unexpected-command'", ["LatexString", "'\\{'"]],
        ["Error", "'unexpected-operator'", ["LatexString", "'..'"]]
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
    expect(parse('\\N \\setminus \\R')).toMatchInlineSnapshot(
      `["SetMinus", "NonNegativeIntegers", "RealNumbers"]`
    );
    expect(parse('\\N^\\complement')).toMatchInlineSnapshot(
      `["Complement", "NonNegativeIntegers"]`
    );
    expect(parse('\\N \\times \\N')).toMatchInlineSnapshot(`
      [
        "Multiply",
        ["Error", ["ErrorCode", "'incompatible-type'", "'number'", "'set'"]],
        ["Error", ["ErrorCode", "'incompatible-type'", "'number'", "'set'"]]
      ]
    `);
    expect(parse('\\N^3')).toMatchInlineSnapshot(`
      [
        "Power",
        ["Error", ["ErrorCode", "'incompatible-type'", "'number'", "'set'"]],
        3
      ]
    `);
    expect(parse('\\N^{n}')).toMatchInlineSnapshot(`
      [
        "Power",
        ["Error", ["ErrorCode", "'incompatible-type'", "'number'", "'set'"]],
        "n"
      ]
    `);
  });
});
