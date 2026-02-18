import { engine as ce } from '../../utils';

function parse(s: string) {
  return ce.parse(s);
}

describe('BASIC PARSING', () => {
  test('', () => {
    expect(parse('')).toMatchInlineSnapshot(`Nothing`);
    expect(parse('1')).toMatchInlineSnapshot(`1`);
    expect(parse('2{xy}')).toMatchInlineSnapshot(`["Multiply", 2, "x", "y"]`);
  });
});

describe('ADVANCED PARSING', () => {
  // Empty argument should not be interpreted as space group when argument is
  // expected
  test('\\frac{x}{} y', () =>
    expect(parse('\\frac{x}{} \\text{ cm}')).toMatchInlineSnapshot(
      `["Tuple", ["Divide", "x", ["Error", "'missing'"]], "cm"]`
    ));
});

describe('FUNCTIONS', () => {
  test('Multiple arguments', () =>
    expect(parse('\\gamma(2, 1)')).toMatchInlineSnapshot(
      `["Multiply", "EulerGamma", ["Pair", 2, 1]]`
    ));
});

describe('CUSTOM SYMBOL TYPE CALLBACK', () => {
  test('Accept type strings from getSymbolType()', () => {
    expect(
      ce.parse('f(x)', {
        getSymbolType: (symbol) => (symbol === 'f' ? 'function' : 'unknown'),
      })
    ).toMatchInlineSnapshot(`["f", "x"]`);
  });

  test('Accept mixed getSymbolType() return styles', () => {
    expect(
      ce.parse('f(g)', {
        getSymbolType: (symbol) => {
          if (symbol === 'f') return 'function';
          if (symbol === 'g') return ce.type('unknown');
          return 'unknown';
        },
      })
    ).toMatchInlineSnapshot(`["f", "g"]`);
  });

  test('Report invalid getSymbolType() return values', () => {
    expect(() =>
      ce.parse('f(x)', {
        getSymbolType: (symbol) =>
          symbol === 'f'
            ? ({} as unknown as ReturnType<typeof ce.type>)
            : 'unknown',
      })
    ).toThrow(
      /ce\.parse\(\): getSymbolType\("f"\) must return a BoxedType or a type string, received object/
    );
  });
});

describe('UNKNOWN COMMANDS', () => {
  test('Parse', () => {
    expect(parse('\\foo')).toMatchInlineSnapshot(
      `["Error", "unexpected-command", ["LatexString", "\\foo"]]`
    );
    expect(parse('x=\\foo+1')).toMatchInlineSnapshot(`
      [
        "Equal",
        "x",
        ["Add", ["Error", "unexpected-command", ["LatexString", "\\foo"]], 1]
      ]
    `);
    expect(parse('x=\\foo   {1}  {x+1}+1')).toMatchInlineSnapshot(`
      [
        "Equal",
        "x",
        [
          "Add",
          [
            "InvisibleOperator",
            ["Error", "unexpected-command", ["LatexString", "\\foo"]],
            1,
            ["Add", "x", 1]
          ],
          1
        ]
      ]
    `);
  });
});

describe('NON-STRICT MODE (Math-ASCII/Typst-like syntax)', () => {
  describe('Parentheses for superscripts and subscripts', () => {
    test('Superscript with parentheses: x^(n+1)', () => {
      // Strict mode (default) - should fail
      expect(parse('x^(n+1)')).toMatchInlineSnapshot(`
        [
          "Tuple",
          ["Error", "'missing'", ["LatexString", "^"]],
          ["Add", "n", 1]
        ]
      `);

      // Non-strict mode - should work
      expect(ce.parse('x^(n+1)', { strict: false })).toMatchInlineSnapshot(
        `["Power", "x", ["Add", "n", 1]]`
      );
    });

    test('Subscript with parentheses: a_(k+m)', () => {
      // Strict mode (default) - should fail
      expect(parse('a_(k+m)')).toMatchInlineSnapshot(`
        [
          "Tuple",
          ["Subscript", "a", ["Error", "'missing'"]],
          ["Add", "k", "m"]
        ]
      `);

      // Non-strict mode - should work
      expect(ce.parse('a_(k+m)', { strict: false })).toMatchInlineSnapshot(
        `["Subscript", "a", ["Add", "k", "m"]]`
      );
    });

    test('Multiple superscripts/subscripts: x^(n+1)_(k+m)', () => {
      expect(
        ce.parse('x^(n+1)_(k+m)', { strict: false })
      ).toMatchInlineSnapshot(
        `["Power", ["Subscript", "x", ["Add", "k", "m"]], ["Add", "n", 1]]`
      );
    });

    test('LaTeX syntax still works in non-strict mode: x^{n+1}', () => {
      expect(ce.parse('x^{n+1}', { strict: false })).toMatchInlineSnapshot(
        `["Power", "x", ["Add", "n", 1]]`
      );
    });
  });

  describe('Bare function names', () => {
    test('Trigonometric functions', () => {
      expect(ce.parse('sin(x)', { strict: false })).toMatchInlineSnapshot(
        `["Sin", "x"]`
      );
      expect(ce.parse('cos(x+1)', { strict: false })).toMatchInlineSnapshot(
        `["Cos", ["Add", "x", 1]]`
      );
      expect(ce.parse('tan(2*x)', { strict: false })).toMatchInlineSnapshot(
        `["Tan", ["Multiply", 2, "x"]]`
      );
    });

    test('Hyperbolic functions', () => {
      expect(ce.parse('sinh(x)', { strict: false })).toMatchInlineSnapshot(
        `["Sinh", "x"]`
      );
      expect(ce.parse('cosh(x)', { strict: false })).toMatchInlineSnapshot(
        `["Cosh", "x"]`
      );
    });

    test('Inverse trigonometric functions', () => {
      expect(ce.parse('arcsin(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arcsin", "x"]`
      );
      expect(ce.parse('asin(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arcsin", "x"]`
      );
      expect(ce.parse('arctan(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arctan", "x"]`
      );
    });

    test('Logarithmic and exponential functions', () => {
      expect(ce.parse('log(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x"]`
      );
      expect(ce.parse('ln(x)', { strict: false })).toMatchInlineSnapshot(
        `["Ln", "x"]`
      );
      expect(ce.parse('exp(x)', { strict: false })).toMatchInlineSnapshot(
        `["Exp", "x"]`
      );
    });

    test('Other common functions', () => {
      expect(ce.parse('sqrt(x)', { strict: false })).toMatchInlineSnapshot(
        `["Sqrt", "x"]`
      );
      expect(ce.parse('abs(x)', { strict: false })).toMatchInlineSnapshot(
        `["Abs", "x"]`
      );
      expect(ce.parse('floor(x)', { strict: false })).toMatchInlineSnapshot(
        `["Floor", "x"]`
      );
    });

    test('LaTeX syntax still works in non-strict mode: \\sin(x)', () => {
      expect(ce.parse('\\sin(x)', { strict: false })).toMatchInlineSnapshot(
        `["Sin", "x"]`
      );
    });

    test('Strict mode rejects bare function names', () => {
      // In strict mode, 'sin' should be parsed as individual symbols
      expect(parse('sin(x)')).toMatchInlineSnapshot(
        `["Multiply", ["Complex", 0, 1], "n", "s", "x"]`
      );
    });

    test('Unknown function names are rejected', () => {
      // 'foo' is not a recognized function, should parse as individual symbols
      expect(ce.parse('foo(x)', { strict: false })).toMatchInlineSnapshot(
        `["Tuple", "f", "o", "o", "x"]`
      );
    });
  });

  describe('Combined features', () => {
    test('Bare function with parenthesized superscript', () => {
      expect(ce.parse('sin(x)^(2)', { strict: false })).toMatchInlineSnapshot(
        `["Square", ["Sin", "x"]]`
      );
    });

    test('Multiple bare functions', () => {
      expect(
        ce.parse('sin(x) + cos(y)', { strict: false })
      ).toMatchInlineSnapshot(`["Add", ["Sin", "x"], ["Cos", "y"]]`);
    });

    test('Nested bare functions', () => {
      expect(ce.parse('sin(cos(x))', { strict: false })).toMatchInlineSnapshot(
        `["Sin", ["Cos", "x"]]`
      );
    });
  });

  describe('Bare symbols (Greek letters, constants)', () => {
    test('Greek lowercase', () => {
      expect(ce.parse('alpha', { strict: false })).toMatchInlineSnapshot(
        `alpha`
      );
      expect(ce.parse('beta', { strict: false })).toMatchInlineSnapshot(
        `beta`
      );
      expect(ce.parse('omega', { strict: false })).toMatchInlineSnapshot(
        `omega`
      );
      expect(ce.parse('theta', { strict: false })).toMatchInlineSnapshot(
        `theta`
      );
    });

    test('Greek uppercase', () => {
      expect(ce.parse('Gamma', { strict: false })).toMatchInlineSnapshot(
        `Gamma`
      );
      expect(ce.parse('Delta', { strict: false })).toMatchInlineSnapshot(
        `Delta`
      );
      expect(ce.parse('Omega', { strict: false })).toMatchInlineSnapshot(
        `Omega`
      );
    });

    test('pi maps to Pi', () => {
      expect(ce.parse('pi', { strict: false })).toMatchInlineSnapshot(`Pi`);
    });

    test('Infinity: oo', () => {
      expect(ce.parse('oo', { strict: false })).toMatchInlineSnapshot(
        `PositiveInfinity`
      );
    });

    test('Infinity: inf', () => {
      expect(ce.parse('inf', { strict: false })).toMatchInlineSnapshot(
        `PositiveInfinity`
      );
    });

    test('Imaginary unit: ii', () => {
      expect(ce.parse('ii', { strict: false })).toMatchInlineSnapshot(
        `ImaginaryUnit`
      );
    });

    test('Bare symbol in expression: 2*pi', () => {
      expect(ce.parse('2*pi', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", 2, "Pi"]`
      );
    });

    test('Strict mode: bare symbols are not recognized', () => {
      // In strict mode, 'alpha' should be parsed as individual symbols
      expect(parse('alpha')).toMatchInlineSnapshot(
        `["Multiply", "a", "a", "h", "l", "p"]`
      );
    });
  });

  describe('Arrow operators', () => {
    test('-> maps to To', () => {
      expect(ce.parse('x -> y', { strict: false })).toMatchInlineSnapshot(
        `["To", "x", "y"]`
      );
    });

    test('=> maps to Implies', () => {
      expect(ce.parse('p => q', { strict: false })).toMatchInlineSnapshot(
        `["Implies", "p", "q"]`
      );
    });

    test('<=> maps to Equivalent', () => {
      expect(ce.parse('p <=> q', { strict: false })).toMatchInlineSnapshot(
        `["Equivalent", "p", "q"]`
      );
    });
  });

  describe('Inline division', () => {
    test('a/b', () => {
      expect(ce.parse('a/b', { strict: false })).toMatchInlineSnapshot(
        `["Divide", "a", "b"]`
      );
    });

    test('a+b/c+d tight binding', () => {
      expect(ce.parse('a+b/c+d', { strict: false })).toMatchInlineSnapshot(
        `["Add", "a", ["Divide", "b", "c"], "d"]`
      );
    });
  });

  describe('Double star exponentiation', () => {
    test('x**2', () => {
      expect(ce.parse('x**2', { strict: false })).toMatchInlineSnapshot(
        `["Square", "x"]`
      );
    });

    test('x**3', () => {
      expect(ce.parse('x**3', { strict: false })).toMatchInlineSnapshot(
        `["Power", "x", 3]`
      );
    });

    test('Strict mode: ** is not power', () => {
      // In strict mode, ** should not be treated as exponentiation
      // (produces a type error due to missing operand)
      expect(parse('x**2')).toMatchInlineSnapshot(`
        [
          "Multiply",
          "x",
          [
            "Error",
            [
              "ErrorCode",
              "incompatible-type",
              "'number'",
              "tuple<string, finite_integer>"
            ]
          ]
        ]
      `);
    });
  });

  describe('Multi-digit exponents and subscripts', () => {
    test('x^123', () => {
      expect(ce.parse('x^123', { strict: false })).toMatchInlineSnapshot(
        `["Power", "x", 123]`
      );
    });

    test('x^-1', () => {
      expect(ce.parse('x^-1', { strict: false })).toMatchInlineSnapshot(
        `["Divide", 1, "x"]`
      );
    });

    test('x^-12', () => {
      expect(ce.parse('x^-12', { strict: false })).toMatchInlineSnapshot(
        `["Divide", 1, ["Power", "x", 12]]`
      );
    });

    test('x_12', () => {
      // Absorbed into compound symbol x_12
      expect(ce.parse('x_12', { strict: false })).toMatchInlineSnapshot(
        `x_12`
      );
    });

    test('x^2+y^3 expression', () => {
      expect(
        ce.parse('x^2+y^3', { strict: false })
      ).toMatchInlineSnapshot(
        `["Add", ["Power", "y", 3], ["Square", "x"]]`
      );
    });
  });

  describe('Extended bare functions', () => {
    test('cbrt(x)', () => {
      expect(ce.parse('cbrt(x)', { strict: false })).toMatchInlineSnapshot(
        `["Root", "x", 3]`
      );
    });

    test('cbrt(8)', () => {
      expect(ce.parse('cbrt(8)', { strict: false })).toMatchInlineSnapshot(
        `["Root", 8, 3]`
      );
    });

    test('binom(n, k)', () => {
      expect(ce.parse('binom(n, k)', { strict: false })).toMatchInlineSnapshot(`
        [
          "Binomial",
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'integer'", "'number'"]
          ],
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'integer'", "'number'"]
          ]
        ]
      `);
    });

    test('nCr(n, k)', () => {
      expect(ce.parse('nCr(n, k)', { strict: false })).toMatchInlineSnapshot(`
        [
          "Binomial",
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'integer'", "'number'"]
          ],
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'integer'", "'number'"]
          ]
        ]
      `);
    });
  });

  describe('Bare function exponents', () => {
    test('sin^2(x)', () => {
      expect(ce.parse('sin^2(x)', { strict: false })).toMatchInlineSnapshot(
        `["Square", ["Sin", "x"]]`
      );
    });

    test('cos^{10}(x)', () => {
      expect(
        ce.parse('cos^{10}(x)', { strict: false })
      ).toMatchInlineSnapshot(`["Power", ["Cos", "x"], 10]`);
    });

    test('tan^-1(x)', () => {
      expect(ce.parse('tan^-1(x)', { strict: false })).toMatchInlineSnapshot(
        `["Divide", 1, ["Tan", "x"]]`
      );
    });

    test('sin^2(x) + cos^2(x) identity', () => {
      const a = ce.parse('sin^2(x) + cos^2(x)', { strict: false });
      expect(a.isEqual(1)).toBe(true);
    });
  });

  describe('Bare log with subscript', () => {
    test('log_2(x) → base 2', () => {
      expect(ce.parse('log_2(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x", 2]`
      );
    });

    test('log_{10}(x) → base 10 (default)', () => {
      expect(
        ce.parse('log_{10}(x)', { strict: false })
      ).toMatchInlineSnapshot(`["Log", "x"]`);
    });

    test('log_3(x) → base 3', () => {
      expect(ce.parse('log_3(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x", 3]`
      );
    });

    test('log_b(x) → variable base', () => {
      expect(ce.parse('log_b(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x", "b"]`
      );
    });
  });

  describe('Unicode superscripts', () => {
    test('x² → Power', () => {
      expect(ce.parse('x²')).toMatchInlineSnapshot(`["Square", "x"]`);
    });

    test('x²³ → multi-digit exponent', () => {
      expect(ce.parse('x²³')).toMatchInlineSnapshot(
        `["Power", "x", 23]`
      );
    });

    test('x⁻² → negative exponent', () => {
      expect(ce.parse('x⁻²')).toMatchInlineSnapshot(
        `["Divide", 1, ["Square", "x"]]`
      );
    });

    test('xⁿ → letter superscript', () => {
      expect(ce.parse('xⁿ')).toMatchInlineSnapshot(
        `["Power", "x", "n"]`
      );
    });

    test('2ⁿ → numeric base with letter exponent', () => {
      expect(ce.parse('2ⁿ')).toMatchInlineSnapshot(
        `["Power", 2, "n"]`
      );
    });

    test('\\sin²(x) → trig with Unicode exponent', () => {
      expect(ce.parse('\\sin²(x)')).toMatchInlineSnapshot(
        `["Square", ["Sin", "x"]]`
      );
    });

    test('sin²(x) bare + Unicode', () => {
      expect(ce.parse('sin²(x)', { strict: false })).toMatchInlineSnapshot(
        `["Square", ["Sin", "x"]]`
      );
    });
  });

  describe('Unicode subscripts', () => {
    test('x₁ → subscript', () => {
      expect(ce.parse('x₁')).toMatchInlineSnapshot(`x_1`);
    });

    test('x₁₂ → multi-digit subscript', () => {
      expect(ce.parse('x₁₂')).toMatchInlineSnapshot(`x_12`);
    });

    test('x₁² → subscript + superscript', () => {
      expect(ce.parse('x₁²')).toMatchInlineSnapshot(
        `["Square", "x_1"]`
      );
    });

    test('log₂(x) → Unicode subscript on bare log', () => {
      expect(ce.parse('log₂(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x", 2]`
      );
    });

    test('log₁₀(x) → Unicode subscript base 10', () => {
      expect(
        ce.parse('log₁₀(x)', { strict: false })
      ).toMatchInlineSnapshot(`["Log", "x"]`);
    });
  });
});
