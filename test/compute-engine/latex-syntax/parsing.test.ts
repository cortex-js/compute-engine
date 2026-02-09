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
      `["Tuple", ["Divide", "x", ["Error", "'missing'"]], " cm"]`
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
      // 'foo' is not a recognized function name, should parse as symbols
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
});
