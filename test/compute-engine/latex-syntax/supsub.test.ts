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
        "Multiply",
        "_",
        ["Power", ["Add", "p", 1], ["Add", "q", 1]],
        ["Power", ["Subscript", "x", ["Add", "r", 1]], ["Add", "s", 1]]
      ]
    `); // @fixme: nope...
    expect(ce.parse('x{}_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(`
      [
        "Multiply",
        ["Power", ["Subscript", "x", ["Add", "p", 1]], ["Add", "q", 1]],
        ["Power", ["Subscript", "x", ["Add", "r", 1]], ["Add", "s", 1]]
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
    expect(ce.parse('x_{n}^{k}')).toMatchInlineSnapshot(
      `["Power", "x_n", "k"]`
    );
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

describe('COMPLEX SUBSCRIPTS IN ARITHMETIC (Issue #273)', () => {
  // Issue #273: Complex subscripts like a_{n+1} should work in arithmetic operations
  // Previously, these would fail with 'incompatible-type' errors because Subscript
  // returned type 'symbol' instead of allowing numeric type inference.

  test('Complex subscripts in addition', () => {
    // These should NOT produce errors
    expect(ce.parse('a_{n+1}+1').json).toMatchInlineSnapshot(`
      [
        Add,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
        1,
      ]
    `);
    expect(ce.parse('a_{n+1}+a_{m+1}').json).toMatchInlineSnapshot(`
      [
        Add,
        [
          Subscript,
          a,
          [
            Add,
            m,
            1,
          ],
        ],
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
    expect(ce.parse('a_{n+1}+b_{n+1}').json).toMatchInlineSnapshot(`
      [
        Add,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
        [
          Subscript,
          b,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
  });

  test('Complex subscripts in multiplication', () => {
    expect(ce.parse('2a_{n+1}').json).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
    expect(ce.parse('2\\cdot a_{n+1}').json).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
    expect(ce.parse('a_{n+1}\\cdot b_{m+1}').json).toMatchInlineSnapshot(`
      [
        Multiply,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
        [
          Subscript,
          b,
          [
            Add,
            m,
            1,
          ],
        ],
      ]
    `);
  });

  test('Complex subscripts in division', () => {
    expect(ce.parse('\\frac{a_{n+1}}{4}').json).toMatchInlineSnapshot(`
      [
        Multiply,
        [
          Rational,
          1,
          4,
        ],
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
    expect(ce.parse('\\frac{a_{n+1}}{b_{m+1}}').json).toMatchInlineSnapshot(`
      [
        Divide,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
        [
          Subscript,
          b,
          [
            Add,
            m,
            1,
          ],
        ],
      ]
    `);
  });

  test('Complex subscripts with exponents', () => {
    expect(ce.parse('a_{n+1}^2').json).toMatchInlineSnapshot(`
      [
        Power,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
        2,
      ]
    `);
    expect(ce.parse('a_{n+1}^{n+2}').json).toMatchInlineSnapshot(`
      [
        Power,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
        [
          Add,
          n,
          2,
        ],
      ]
    `);
  });

  test('Multi-index subscripts in arithmetic', () => {
    // Multi-index subscripts (with comma) should also work in arithmetic
    expect(ce.parse('a_{n,s}+1').json).toMatchInlineSnapshot(`
      [
        Add,
        [
          Subscript,
          a,
          [
            Sequence,
            n,
            s,
          ],
        ],
        1,
      ]
    `);
    expect(ce.parse('2a_{n,s}').json).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        [
          Subscript,
          a,
          [
            Sequence,
            n,
            s,
          ],
        ],
      ]
    `);
    expect(ce.parse('a_{n,s}^2').json).toMatchInlineSnapshot(`
      [
        Power,
        [
          Subscript,
          a,
          [
            Sequence,
            n,
            s,
          ],
        ],
        2,
      ]
    `);
    expect(ce.parse('a_{n,1}+a_{m,1}').json).toMatchInlineSnapshot(`
      [
        Add,
        [
          Subscript,
          a,
          [
            Sequence,
            m,
            1,
          ],
        ],
        [
          Subscript,
          a,
          [
            Sequence,
            n,
            1,
          ],
        ],
      ]
    `);
  });

  test('Mixed simple and complex subscripts', () => {
    // Mixing simple subscripted symbols with complex subscript expressions
    expect(ce.parse('a_n + a_{n+1}').json).toMatchInlineSnapshot(`
      [
        Add,
        a_n,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
    expect(ce.parse('x_0 \\cdot x_{n+1}').json).toMatchInlineSnapshot(`
      [
        Multiply,
        x_0,
        [
          Subscript,
          x,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
  });

  test('Complex subscripts with superscripts mixed', () => {
    // Complex: both subscript and superscript have expressions
    expect(ce.parse('a_{n+1}^{m+1}').json).toMatchInlineSnapshot(`
      [
        Power,
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
        [
          Add,
          m,
          1,
        ],
      ]
    `);
    // Mixing with addition
    expect(ce.parse('a_{n+1}+a^{m+1}').json).toMatchInlineSnapshot(`
      [
        Add,
        [
          Power,
          a,
          [
            Add,
            m,
            1,
          ],
        ],
        [
          Subscript,
          a,
          [
            Add,
            n,
            1,
          ],
        ],
      ]
    `);
  });
});

describe('TEXT SUBSCRIPTS', () => {
  // Text subscripts like x_{\text{max}} are clearly naming, not indexing
  test('Text subscripts become compound symbols', () => {
    expect(ce.parse('x_{\\text{max}}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        "x_\\text<{>max",
        ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]]
      ]
    `);
    expect(ce.parse('T_{\\text{ambient}}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        "T_\\text<{>ambient",
        ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]]
      ]
    `);
    expect(ce.parse('v_{\\mathrm{max}}')).toMatchInlineSnapshot(`v_max`);
  });

  test('Text subscripts work in arithmetic', () => {
    expect(ce.parse('x_{\\text{max}}+1').json).toMatchInlineSnapshot(`
      [
        Add,
        [
          Tuple,
          'x_\\text<{>max',
          [
            Error,
            'unexpected-closing-delimiter',
            [
              LatexString,
              '}',
            ],
          ],
        ],
        1,
      ]
    `);
    expect(ce.parse('2\\cdot T_{\\text{ambient}}').json).toMatchInlineSnapshot(`
      [
        Multiply,
        2,
        [
          Tuple,
          'T_\\text<{>ambient',
          [
            Error,
            'unexpected-closing-delimiter',
            [
              LatexString,
              '}',
            ],
          ],
        ],
      ]
    `);
  });
});

describe('SUBSCRIPTED FUNCTION APPLICATION', () => {
  // f_{n+1}(x) - subscripted function applied to argument
  test('Subscripted function application', () => {
    // The subscript applies to f, then the result is applied to x
    expect(ce.parse('f_{n+1}(x)').json).toMatchInlineSnapshot(`
      [
        Apply,
        [
          Subscript,
          f,
          [
            Add,
            n,
            1,
          ],
        ],
        x,
      ]
    `);
    expect(ce.parse('g_{n}(x)').json).toMatchInlineSnapshot(`
      [
        g_n,
        x,
      ]
    `);
  });
});

describe('PRIMED SYMBOLS WITH SUBSCRIPTS', () => {
  // f'_n - is this (f')_n or (f_n)'?
  test('Prime with subscript', () => {
    // Currently: subscript is applied first, then prime
    expect(ce.parse("f'_n")).toMatchInlineSnapshot(
      `["Subscript", ["Derivative", "f"], "n"]`
    );
    expect(ce.parse("f_n'")).toMatchInlineSnapshot(`["Prime", "f_n"]`);
    expect(ce.parse("f'_{n+1}").json).toMatchInlineSnapshot(`
      [
        Subscript,
        [
          Derivative,
          f,
        ],
        [
          Add,
          n,
          1,
        ],
      ]
    `);
  });
});

describe('TYPE-AWARE SUBSCRIPT HANDLING', () => {
  // When a symbol is declared as a collection type, subscripts become At() calls
  test('Collection-typed symbols convert subscripts to At', () => {
    // Create a fresh engine for these tests to avoid pollution
    const { ComputeEngine } = require('../../../src/compute-engine');
    const ce2 = new ComputeEngine();
    ce2.declare('v', 'list<number>');
    ce2.declare('A', 'matrix<number>');

    // Complex subscripts on collection-typed symbols become At
    expect(ce2.parse('v_{n+1}').json).toMatchInlineSnapshot(`
      [
        At,
        v,
        [
          Add,
          n,
          1,
        ],
      ]
    `);

    // Multi-index subscripts (note: using k,j to avoid 'i' being imaginary unit)
    expect(ce2.parse('A_{k,j}').json).toMatchInlineSnapshot(`
      [
        At,
        A,
        [
          Tuple,
          k,
          j,
        ],
      ]
    `);

    // Simple subscripts on collection-typed symbols also become At
    expect(ce2.parse('v_n').json).toMatchInlineSnapshot(`
      [
        At,
        v,
        n,
      ]
    `);
    expect(ce2.parse('v[n]').json).toMatchInlineSnapshot(`
      [
        At,
        v,
        n,
      ]
    `);
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
