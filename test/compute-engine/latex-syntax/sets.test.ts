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

  test('Interval serialization', () => {
    // Closed interval [a, b]
    expect(latex(['Interval', 3, 4])).toMatchInlineSnapshot(
      `\\lbrack3, 4\\rbrack`
    );
    // Open-closed interval (a, b]
    expect(latex(['Interval', ['Open', 3], 4])).toMatchInlineSnapshot(
      `\\lparen3, 4\\rbrack`
    );
    // Closed-open interval [a, b)
    expect(latex(['Interval', 3, ['Open', 4]])).toMatchInlineSnapshot(
      `\\lbrack3, 4\\rparen`
    );
    // Open interval (a, b)
    expect(latex(['Interval', ['Open', 3], ['Open', 4]])).toMatchInlineSnapshot(
      `\\lparen3, 4\\rparen`
    );
  });

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

describe('PARSING INTERVALS', () => {
  // Issue #254: Interval notation parsing from MathLive

  it('should parse half-open intervals with mismatched brackets', () => {
    // [a, b) - closed-open (American notation)
    expect(parse('[3, 4)').json).toMatchInlineSnapshot(`
      [
        Interval,
        3,
        [
          Open,
          4,
        ],
      ]
    `);

    // (a, b] - open-closed (American notation)
    expect(parse('(3, 4]').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          3,
        ],
        4,
      ]
    `);
  });

  it('should parse intervals with ISO/European reversed bracket notation', () => {
    // ]a, b[ - open interval (ISO notation)
    // This uses reversed brackets which are unambiguous
    expect(parse(']3, 4[').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          3,
        ],
        [
          Open,
          4,
        ],
      ]
    `);

    // Note: [a, b[ and ]a, b] are NOT supported with plain brackets because
    // they conflict with nested list parsing. Use American notation instead:
    // [a, b) for closed-open, (a, b] for open-closed
  });

  it('should parse intervals with LaTeX bracket commands', () => {
    // Using \lbrack and \rparen
    expect(parse('\\lbrack 3, 4\\rparen').json).toMatchInlineSnapshot(`
      [
        Interval,
        3,
        [
          Open,
          4,
        ],
      ]
    `);

    // Using \lparen and \rbrack
    expect(parse('\\lparen 3, 4\\rbrack').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          3,
        ],
        4,
      ]
    `);
  });

  it('should parse intervals with \\mathopen and \\mathclose', () => {
    // Using \mathopen and \mathclose with brackets (as Range serializes)
    expect(parse('\\mathopen\\lbrack 3, 4\\mathclose\\rbrack').json)
      .toMatchInlineSnapshot(`
      [
        List,
        3,
        4,
      ]
    `);

    // Using \mathopen and \mathclose for half-open interval
    expect(parse('\\mathopen\\lbrack 3, 4\\mathclose\\rparen').json)
      .toMatchInlineSnapshot(`
      [
        Interval,
        3,
        [
          Open,
          4,
        ],
      ]
    `);

    // Using \mathopen and \mathclose with parentheses
    expect(parse('\\mathopen( 3, 4\\mathclose)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        3,
        4,
      ]
    `);
  });

  it('should parse intervals with \\left and \\right', () => {
    // \left[ ... \right) - closed-open interval
    expect(parse('\\left[ 3, 4 \\right)').json).toMatchInlineSnapshot(`
      [
        Interval,
        3,
        [
          Open,
          4,
        ],
      ]
    `);

    // \left( ... \right] - open-closed interval
    expect(parse('\\left( 3, 4 \\right]').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          3,
        ],
        4,
      ]
    `);

    // \left[ ... \right] - closed interval (remains List for backward compat)
    expect(parse('\\left[ 3, 4 \\right]').json).toMatchInlineSnapshot(`
      [
        List,
        3,
        4,
      ]
    `);

    // \left( ... \right) - open interval (remains Tuple for backward compat)
    expect(parse('\\left( 3, 4 \\right)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        3,
        4,
      ]
    `);

    // \left] ... \right[ - open interval (ISO notation)
    expect(parse('\\left] 3, 4 \\right[').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          3,
        ],
        [
          Open,
          4,
        ],
      ]
    `);
  });

  it('should parse intervals with \\bigl and \\bigr', () => {
    // \bigl[ ... \bigr) - closed-open interval
    expect(parse('\\bigl[ 3, 4 \\bigr)').json).toMatchInlineSnapshot(`
      [
        Interval,
        3,
        [
          Open,
          4,
        ],
      ]
    `);

    // \Bigl( ... \Bigr] - open-closed interval
    expect(parse('\\Bigl( 3, 4 \\Bigr]').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          3,
        ],
        4,
      ]
    `);
  });

  it('should parse intervals with expressions as endpoints', () => {
    // Variables
    expect(parse('[x, y)').json).toMatchInlineSnapshot(`
      [
        Interval,
        x,
        [
          Open,
          y,
        ],
      ]
    `);

    // Expressions
    expect(parse('(a+b, c-d]').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          [
            Add,
            a,
            b,
          ],
        ],
        [
          Subtract,
          c,
          d,
        ],
      ]
    `);
  });

  it('should parse intervals with infinity', () => {
    // [0, +∞)
    expect(parse('[0, +\\infty)').json).toMatchInlineSnapshot(`
      [
        Interval,
        0,
        [
          Open,
          PositiveInfinity,
        ],
      ]
    `);

    // (-∞, 0]
    expect(parse('(-\\infty, 0]').json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          [
            Negate,
            PositiveInfinity,
          ],
        ],
        0,
      ]
    `);
  });

  it('should maintain backward compatibility for matched brackets', () => {
    // [a, b] should remain a List (not an interval)
    expect(parse('[3, 4]').json).toMatchInlineSnapshot(`
      [
        List,
        3,
        4,
      ]
    `);

    // (a, b) should remain a Tuple (not an interval)
    expect(parse('(3, 4)').json).toMatchInlineSnapshot(`
      [
        Tuple,
        3,
        4,
      ]
    `);
  });

  it('should reject invalid interval bodies', () => {
    // Single element - not valid for interval, falls back to other parsing
    expect(parse('[3)').json).not.toHaveProperty('0', 'Interval');

    // Three elements - not valid for interval
    expect(parse('[3, 4, 5)').json).not.toHaveProperty('0', 'Interval');
  });
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
    expect(parse('P \\subset Q \\lor R \\subset S').json)
      .toMatchInlineSnapshot(`
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
    expect(parse('P \\subset Q \\land R \\subset S').json)
      .toMatchInlineSnapshot(`
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

describe('RANGE AND INTERVAL SERIALIZATION', () => {
  it('should serialize Range with a..b notation', () => {
    // Range with symbolic bounds serializes as a..b
    // Note: must use materialization:false to prevent lazy evaluation to List
    const range = ce.box(['Range', 'a', 'b']);
    expect(range.toLatex({ materialization: false })).toBe('a..b');
  });

  it('should round-trip Range expressions', () => {
    // Parse a..b -> Range -> serialize -> parse again
    const expr1 = ce.parse('a..b');
    expect(expr1.json).toMatchInlineSnapshot(`
      [
        Range,
        a,
        b,
      ]
    `);

    // Round-trip with materialization:false
    const latex = expr1.toLatex({ materialization: false });
    expect(latex).toBe('a..b');

    const expr2 = ce.parse(latex);
    expect(expr2.json).toEqual(expr1.json);
  });

  it('should round-trip Interval expressions', () => {
    // Closed interval [a, b]
    const closed = ce.box(['Interval', 3, 4]);
    const closedLatex = closed.latex;
    const closedReparsed = ce.parse(closedLatex);
    // Note: [3, 4] parses as List due to backward compatibility
    expect(closedReparsed.json).toMatchInlineSnapshot(`
      [
        List,
        3,
        4,
      ]
    `);

    // Half-open interval [a, b)
    const halfOpen = ce.box(['Interval', 3, ['Open', 4]]);
    const halfOpenLatex = halfOpen.latex;
    expect(halfOpenLatex).toMatchInlineSnapshot(`\\lbrack3, 4\\rparen`);
    const halfOpenReparsed = ce.parse(halfOpenLatex);
    expect(halfOpenReparsed.json).toMatchInlineSnapshot(`
      [
        Interval,
        3,
        [
          Open,
          4,
        ],
      ]
    `);

    // Open-closed interval (a, b]
    const openClosed = ce.box(['Interval', ['Open', 3], 4]);
    const openClosedLatex = openClosed.latex;
    expect(openClosedLatex).toMatchInlineSnapshot(`\\lparen3, 4\\rbrack`);
    const openClosedReparsed = ce.parse(openClosedLatex);
    expect(openClosedReparsed.json).toMatchInlineSnapshot(`
      [
        Interval,
        [
          Open,
          3,
        ],
        4,
      ]
    `);
  });

  it('should parse intervals with \\mathopen/\\mathclose round-trip', () => {
    // The \mathopen/\mathclose prefixes should be handled correctly
    const tests = [
      '\\mathopen\\lbrack 3, 4\\mathclose\\rparen', // half-open [3,4)
      '\\mathopen( 3, 4\\mathclose\\rbrack', // open-closed (3,4]
    ];

    for (const latex of tests) {
      const expr1 = ce.parse(latex);
      expect(expr1.json[0]).toBe('Interval');
    }
  });
});
