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
      latex(['Filter', 'Numbers', ['NotEqual', '_', 0]])
    ).toMatchInlineSnapshot(
      `\\lbrace1+\\imaginaryI, -1+\\imaginaryI, 1-\\imaginaryI, -1-\\imaginaryI, 0.5+0.5\\imaginaryI, \\dots\\rbrace`
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

  // test('Union, Intersection, etc...', () => {
  //   expect(latex(['Union', 'Integers', 'RealNumbers'])).toMatchInlineSnapshot(
  //     `\\Z\\cup\\R`
  //   );
  //   expect(
  //     latex(['Intersection', 'Integers', 'RealNumbers'])
  //   ).toMatchInlineSnapshot(`\\Z\\cap\\R`);
  //   expect(latex(['Complement', 'ComplexNumber'])).toMatchInlineSnapshot(
  //     `\\mathrm{ComplexNumber}^{\\complement}`
  //   );
  //   expect(latex(['CartesianProduct'])).toMatchInlineSnapshot(
  //     `\\mathrm{CartesianProduct}(\\error{\\blacksquare})`
  //   );
  //   expect(latex(['CartesianProduct', 'Integers'])).toMatchInlineSnapshot(
  //     `\\mathrm{CartesianProduct}(\\Z)`
  //   );
  //   expect(
  //     latex(['CartesianProduct', 'Integers', 'Integers'])
  //   ).toMatchInlineSnapshot(`\\mathrm{CartesianProduct}(\\Z, \\Z)`);
  //   expect(
  //     latex(['CartesianProduct', 'Integers', 'RationalNumbers'])
  //   ).toMatchInlineSnapshot(`\\mathrm{CartesianProduct}(\\Z, \\Q)`);
  //   expect(
  //     latex(['CartesianProduct', 'Integers', 'Integers', 'Integers'])
  //   ).toMatchInlineSnapshot(`\\mathrm{CartesianProduct}(\\Z, \\Z, \\Z)`);
  //   expect(latex(['CartesianPower', 'Integers', 3])).toMatchInlineSnapshot(
  //     `\\mathrm{CartesianPower}(\\Z, 3)`
  //   );
  //   expect(latex(['CartesianPower', 'Integers', 'n'])).toMatchInlineSnapshot(
  //     `\\mathrm{CartesianPower}(\\Z, n)`
  //   );
  // });
});

// describe('PARSING SETS', () => {
//   // test('Set', () => {
//   //   // Empty set
//   //   expect(parse('\\lbrace\\rbrace')).toMatchInlineSnapshot(`EmptySet`);

//   //   // Finite set
//   //   expect(parse('\\{1, 2, 3\\}')).toMatchInlineSnapshot(`["Set", 1, 2, 3]`);

//   //   // Infinite sets
//   //   // expect(parse('\\{1, 2, 3...\\}')).toMatchInlineSnapshot(); // @todo
//   //   // expect(parse('\\{1, 2, 3, ...\\}')).toMatchInlineSnapshot(); // @todo
//   //   // expect(parse('\\{...-2, -1, 0, 1, 2, 3...\\}')).toMatchInlineSnapshot();// @todo
//   //   // expect(parse('\\{...-2, -1, 0\\}')).toMatchInlineSnapshot();// @todo
//   // });
//   test.skip('Union, Intersection, etc...', () => {
//     expect(parse('\\N \\cup \\R')).toMatchInlineSnapshot(
//       `["Union", "NonNegativeIntegers", "RealNumbers"]`
//     );
//     expect(parse('\\N \\cap \\R')).toMatchInlineSnapshot(
//       `["Intersection", "NonNegativeIntegers", "RealNumbers"]`
//     );
//     expect(parse('\\N \\setminus \\R')).toMatchInlineSnapshot(
//       `["SetMinus", "NonNegativeIntegers", "RealNumbers"]`
//     );
//     expect(parse('\\N^\\complement')).toMatchInlineSnapshot(
//       `["Complement", "NonNegativeIntegers"]`
//     );
//     expect(parse('\\N \\times \\N')).toMatchInlineSnapshot(`
//       [
//         "Multiply",
//         [
//           "Error",
//           ["ErrorCode", "'incompatible-type'", "'number'", "'set<integer>'"]
//         ],
//         [
//           "Error",
//           ["ErrorCode", "'incompatible-type'", "'number'", "'set<integer>'"]
//         ]
//       ]
//     `); // @fixme
//     expect(parse('\\N^3')).toMatchInlineSnapshot(`
//       [
//         "Power",
//         [
//           "Error",
//           ["ErrorCode", "'incompatible-type'", "'number'", "'set<integer>'"]
//         ],
//         3
//       ]
//     `); // @fixme
//     expect(parse('\\N^{n}')).toMatchInlineSnapshot(`
//       [
//         "Power",
//         [
//           "Error",
//           ["ErrorCode", "'incompatible-type'", "'number'", "'set<integer>'"]
//         ],
//         "n"
//       ]
//     `);
//   }); // @fixme
// });

describe('SET OPERATOR PRECEDENCE WITH LOGIC', () => {
  // Set membership operators should bind tighter than logic operators
  // Precedence: \in (240) > \land (235) > \lor (230)

  it('should parse set membership with Or', () => {
    // x ∈ A ∨ y ∈ B → (x ∈ A) ∨ (y ∈ B)
    expect(parse('x \\in A \\lor y \\in B').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Element,
          x,
          A,
        ],
        [
          Element,
          y,
          B,
        ],
      ]
    `);
  });

  it('should parse set membership with And', () => {
    // x ∈ A ∧ y ∈ B → (x ∈ A) ∧ (y ∈ B)
    expect(parse('x \\in A \\land y \\in B').json).toMatchInlineSnapshot(`
      [
        And,
        [
          Element,
          x,
          A,
        ],
        [
          Element,
          y,
          B,
        ],
      ]
    `);
  });

  it('should parse subset with Or', () => {
    // P ⊂ Q ∨ R ⊂ S → (P ⊂ Q) ∨ (R ⊂ S)
    expect(parse('P \\subset Q \\lor R \\subset S').json).toMatchInlineSnapshot(`
      [
        Or,
        [
          Subset,
          P,
          Q,
        ],
        [
          Subset,
          R,
          S,
        ],
      ]
    `);
  });

  it('should parse subset with And', () => {
    // P ⊂ Q ∧ R ⊂ S → (P ⊂ Q) ∧ (R ⊂ S)
    expect(parse('P \\subset Q \\land R \\subset S').json).toMatchInlineSnapshot(`
      [
        And,
        [
          Subset,
          P,
          Q,
        ],
        [
          Subset,
          R,
          S,
        ],
      ]
    `);
  });

  it('should parse set membership with implies', () => {
    // x ∈ A → y ∈ B
    expect(parse('x \\in A \\implies y \\in B').json).toMatchInlineSnapshot(`
      [
        Implies,
        [
          Element,
          x,
          A,
        ],
        [
          Element,
          y,
          B,
        ],
      ]
    `);
  });

  it('should parse union/intersection with equality', () => {
    // A ∪ B = C → (A ∪ B) = C
    expect(parse('A \\cup B = C').json).toMatchInlineSnapshot(`
      [
        Equal,
        [
          Union,
          A,
          B,
        ],
        C,
      ]
    `);

    // A ∩ B = C → (A ∩ B) = C
    // Note: using X, Y, Z to avoid special symbols like N (NonNegativeIntegers)
    expect(parse('X \\cap Y = Z').json).toMatchInlineSnapshot(`
      [
        Equal,
        [
          Intersection,
          X,
          Y,
        ],
        Z,
      ]
    `);
  });

  it('should parse element of union/intersection', () => {
    // x ∈ A ∪ B → x ∈ (A ∪ B)
    expect(parse('x \\in A \\cup B').json).toMatchInlineSnapshot(`
      [
        Element,
        x,
        [
          Union,
          A,
          B,
        ],
      ]
    `);
  });

  it('should round-trip set expressions with logic', () => {
    const tests = [
      'x\\in A\\lor y\\in B',
      'x\\in A\\land y\\in B',
      'P\\subset Q\\lor R\\subset S',
    ];

    for (const latex of tests) {
      const expr1 = parse(latex);
      const expr2 = parse(expr1.latex);
      expect(expr2.json).toEqual(expr1.json);
    }
  });
});
