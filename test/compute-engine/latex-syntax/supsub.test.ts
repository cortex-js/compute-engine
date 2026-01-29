import { engine as ce } from '../../utils';

describe('SUPSUB', () => {
  test('Superscript', () => {
    expect(ce.parse('2^2')).toMatchInlineSnapshot(`["Square", 2]`);
    expect(ce.parse('x^t')).toMatchInlineSnapshot(`["Power", "x", "t"]`);
    expect(ce.parse('2^{10}')).toMatchInlineSnapshot(`["Power", 2, 10]`);
    expect(ce.parse('\\pi^2')).toMatchInlineSnapshot(`["Square", "Pi"]`);
    expect(ce.parse('2^23')).toMatchInlineSnapshot(
      `["Multiply", 3, ["Square", 2]]`
    );
    expect(ce.parse('2^\\pi')).toMatchInlineSnapshot(`["Power", 2, "Pi"]`);
    expect(ce.parse('2^\\frac12')).toMatchInlineSnapshot(`["Sqrt", 2]`);
    expect(ce.parse('2^{3^4}')).toMatchInlineSnapshot(
      `["Power", 2, ["Power", 3, 4]]`
    );
    expect(ce.parse('2^{10}')).toMatchInlineSnapshot(`["Power", 2, 10]`);
    expect(ce.parse('2^{-2}')).toMatchInlineSnapshot(`["Divide", 1, 4]`);
    expect(ce.parse('2^3^4')).toMatchInlineSnapshot(
      `["Power", 2, ["List", 3, 4]]`
    );
    expect(ce.parse('2^{3^4}')).toMatchInlineSnapshot(
      `["Power", 2, ["Power", 3, 4]]`
    );
    expect(ce.parse('12^34.5')).toMatchInlineSnapshot(
      `["Multiply", 4.5, ["Power", 12, 3]]`
    );
    expect(ce.parse('x^2')).toMatchInlineSnapshot(`["Square", "x"]`);
    expect(ce.parse('x^{x+1}')).toMatchInlineSnapshot(
      `["Power", "x", ["Add", "x", 1]]`
    );
  });
  test('Subscript', () => {
    expect(ce.parse('x_0')).toMatchInlineSnapshot(`x_0`);
    expect(ce.parse('x^2_0')).toMatchInlineSnapshot(`["Square", "x_0"]`);
    expect(ce.parse('x_0^2')).toMatchInlineSnapshot(`["Square", "x_0"]`);
    expect(ce.parse('x_{n+1}')).toMatchInlineSnapshot(
      `["Subscript", "x", ["Add", "n", 1]]`
    );
    expect(ce.parse('x_n_{+1}')).toMatchInlineSnapshot(`x_n_1`);
  });
  test('Pre-sup, pre-sub', () => {
    expect(ce.parse('_p^qx')).toMatchInlineSnapshot(
      `["Multiply", "_", "x", ["Power", "p", "q"]]`
    ); // @fixme: nope...
    expect(ce.parse('_p^qx_r^s')).toMatchInlineSnapshot(
      `["Multiply", "_", ["Power", "p", "q"], ["Power", "x_r", "s"]]`
    ); // @fixme: nope...
    expect(ce.parse('_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        "_",
        ["Power", ["Add", "p", 1], ["Add", "q", 1]],
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'number'", "'symbol'"]
          ],
          ["Add", "s", 1]
        ]
      ]
    `); // @fixme: nope...
    expect(ce.parse('x{}_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'number'", "'symbol'"]
          ],
          ["Add", "q", 1]
        ],
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'number'", "'symbol'"]
          ],
          ["Add", "s", 1]
        ]
      ]
    `); // @fixme: nope...
  });
  test('Sup/Sub groups', () => {
    expect(ce.parse('(x+1)^{n-1}')).toMatchInlineSnapshot(
      `["Power", ["Add", "x", 1], ["Subtract", "n", 1]]`
    );
    expect(ce.parse('(x+1)_{n-1}')).toMatchInlineSnapshot(
      `["Subscript", ["Add", "x", 1], ["Subtract", "n", 1]]`
    );
    expect(ce.parse('(x+1)^n_0')).toMatchInlineSnapshot(
      `["Power", ["Add", "x", 1], "n_0"]`
    );
    expect(ce.parse('^p_q{x+1}^n_0')).toMatchInlineSnapshot(`
      [
        "Superscript",
        ["Error", "'missing'", ["LatexString", "^"]],
        ["Error", "'missing'"]
      ]
    `); // @fixme: nope...
    expect(ce.parse('^{12}_{34}(x+1)^n_0')).toMatchInlineSnapshot(
      `["Superscript", ["Error", "'missing'", ["LatexString", "^"]], 12]`
    ); // @fixme: nope...
  });
  test('Accents', () => {
    expect(ce.parse('\\vec{x}')).toMatchInlineSnapshot(`["OverVector", "x"]`);
    expect(ce.parse('\\vec{AB}')).toMatchInlineSnapshot(
      `["OverVector", ["Multiply", "A", "B"]]`
    ); // @fixme: nope...
    expect(ce.parse('\\vec{AB}^{-1}')).toMatchInlineSnapshot(
      `["Divide", 1, ["OverVector", ["Multiply", "A", "B"]]]`
    );
  });
});

describe('SUBSCRIPT SYMBOL HANDLING', () => {
  // Issue #256: Subscripts on single-letter symbols should create new symbol names
  // to prevent constants like 'i', 'e', 'Pi' from being interpreted before the
  // subscript is applied.

  test('Simple subscripts become part of symbol name', () => {
    // Single letter + simple subscript = symbol
    expect(ce.parse('i_A')).toMatchInlineSnapshot(`i_A`);
    expect(ce.parse('e_1')).toMatchInlineSnapshot(`e_1`);
    expect(ce.parse('x_n')).toMatchInlineSnapshot(`x_n`);
    expect(ce.parse('x_0')).toMatchInlineSnapshot(`x_0`);

    // Braced simple subscripts also become symbols
    expect(ce.parse('A_{n}')).toMatchInlineSnapshot(`A_n`);
    expect(ce.parse('A_{AB}')).toMatchInlineSnapshot(`A_AB`);
  });

  test('Complex subscripts remain as Subscript expressions', () => {
    // Operators in subscript indicate an expression
    expect(ce.parse('A_{n+1}')).toMatchInlineSnapshot(
      `["Subscript", "A", ["Add", "n", 1]]`
    );
    expect(ce.parse('x_{n-1}')).toMatchInlineSnapshot(
      `["Subscript", "x", ["Subtract", "n", 1]]`
    );

    // Parentheses indicate an expression
    expect(ce.parse('A_{(n+1)}')).toMatchInlineSnapshot(
      `["Subscript", "A", ["Add", "n", 1]]`
    );

    // Comma indicates multi-index (Sequence)
    expect(ce.parse('k_{n,m}')).toMatchInlineSnapshot(
      `["Subscript", "k", ["Sequence", "n", "m"]]`
    );
    expect(ce.parse('T_{a,b,c}')).toMatchInlineSnapshot(
      `["Subscript", "T", ["Sequence", "a", "b", "c"]]`
    );
  });

  test('Greek letters with subscripts', () => {
    // Greek letters can have subscripts too
    expect(ce.parse('\\pi_1')).toMatchInlineSnapshot(`Pi_1`);
    expect(ce.parse('\\alpha_n')).toMatchInlineSnapshot(`alpha_n`);
    expect(ce.parse('\\beta_{ij}')).toMatchInlineSnapshot(`beta_ij`);

    // Complex subscripts on Greek letters
    // Note: \gamma is EulerGamma, \delta is KroneckerDelta in the library
    expect(ce.parse('\\epsilon_{n+1}')).toMatchInlineSnapshot(
      `["Subscript", "epsilon", ["Add", "n", 1]]`
    );
  });

  test('Nested subscripts', () => {
    // Nested simple subscripts are flattened into one symbol
    expect(ce.parse('x_{i_j}')).toMatchInlineSnapshot(`x_i_j`);
    expect(ce.parse('A_{n_1}')).toMatchInlineSnapshot(`A_n_1`);
  });

  test('Mixed subscript and superscript', () => {
    // Subscript creates symbol, then superscript applies Power
    expect(ce.parse('x_i^2')).toMatchInlineSnapshot(`["Square", "x_i"]`);
    expect(ce.parse('x_{i}^{2}')).toMatchInlineSnapshot(`["Square", "x_i"]`);
    expect(ce.parse('x^2_i')).toMatchInlineSnapshot(`["Square", "x_i"]`);
    expect(ce.parse('x_{n}^{k}')).toMatchInlineSnapshot(`["Power", "x_n", "k"]`);
  });

  test('LaTeX commands in subscripts', () => {
    // Greek letters in subscripts
    expect(ce.parse('A_{\\alpha}')).toMatchInlineSnapshot(`A_alpha`);
    expect(ce.parse('A_{\\alpha\\beta}')).toMatchInlineSnapshot(`A_alphabeta`);
    expect(ce.parse('x_{\\mu}')).toMatchInlineSnapshot(`x_mu`);
  });

  test('Original issue #256: i with subscript', () => {
    // 'i' alone is the imaginary unit
    expect(ce.parse('i')).toMatchInlineSnapshot(`["Complex", 0, 1]`);

    // 'i' with subscript is a new symbol, not ImaginaryUnit
    expect(ce.parse('i_A')).toMatchInlineSnapshot(`i_A`);
    expect(ce.parse('i_A+1')).toMatchInlineSnapshot(`["Add", "i_A", 1]`);
    expect(ce.parse('\\frac{i_{A}}{i}')).toMatchInlineSnapshot(
      `["Divide", "i_A", ["Complex", 0, 1]]`
    );

    // Similarly for 'e' (ExponentialE)
    expect(ce.parse('e')).toMatchInlineSnapshot(`ExponentialE`);
    expect(ce.parse('e_1')).toMatchInlineSnapshot(`e_1`);
  });
});

describe('PRIME', () => {
  test('Valid forms', () => {
    expect(ce.parse("f'")).toMatchInlineSnapshot(`["Derivative", "f"]`);
    expect(ce.parse("f''")).toMatchInlineSnapshot(`["Derivative", "f", 2]`);
    expect(ce.parse("f'''")).toMatchInlineSnapshot(`["Derivative", "f", 3]`);
    expect(ce.parse('f\\prime')).toMatchInlineSnapshot(`["Derivative", "f"]`);
    expect(ce.parse('f\\prime\\prime')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(ce.parse('f\\prime\\prime\\prime')).toMatchInlineSnapshot(
      `["Derivative", "f", 3]`
    );
    expect(ce.parse('f\\doubleprime')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(ce.parse('f^{\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f"]`
    );
    expect(ce.parse('f^{\\prime\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(ce.parse('f^{\\prime\\prime\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 3]`
    );
    expect(ce.parse('f^{\\doubleprime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
  });
});
