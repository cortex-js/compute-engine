import { ComputeEngine } from '../../../src/compute-engine';
import { LatexSyntax } from '../../../src/compute-engine/latex-syntax/latex-syntax';
import { LATEX_DICTIONARY } from '../../../src/compute-engine/latex-syntax/dictionary/default-dictionary';
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

  // REVIEW.md C4: parseTextRun joined nested-brace runs with Array.join()
  // (default ',' separator), so `\text{hello {world}}` became 'hello ,world'.
  test('\\text with nested braces joins without a stray comma', () => {
    expect((parse('\\text{hello {world}}') as any).string).toEqual(
      'hello world'
    );
    expect((parse('\\text{a {b} c}') as any).string).toEqual('a b c');
  });
});

describe('FUNCTIONS', () => {
  test('Multiple arguments of known function that take a single arugment', () =>
    expect(parse('\\exp(2, 1)')).toMatchInlineSnapshot(
      `["Exp", 2, ["Error", "unexpected-argument", "'1'"]]`
    ));
  test('Multiple arguments of known function that take multiple arguments', () =>
    expect(parse('\\operatorname{Binomial}(2, 1)')).toMatchInlineSnapshot(
      `["Binomial", 2, 1]`
    ));
  test('Multiple arguments of unknown symbol', () =>
    expect(parse('q(2, 1)')).toMatchInlineSnapshot(`["q", 2, 1]`));
});

describe('CUSTOM SYMBOL RESOLUTION CALLBACK', () => {
  // The shared test engine explicitly declares f. Explicit declarations now
  // take precedence, so exercise external facts on an undeclared name.
  const ce = new ComputeEngine();
  test('Accept type strings from resolveSymbol()', () => {
    expect(
      ce.parse('f(x)', {
        resolveSymbol: (symbol) =>
          symbol === 'f' ? { type: 'function' } : undefined,
      })
    ).toMatchInlineSnapshot(`["f", "x"]`);
  });

  test('Accept mixed resolveSymbol() type styles', () => {
    expect(
      ce.parse('f(g)', {
        resolveSymbol: (symbol) => {
          if (symbol === 'f') return { type: 'function' };
          if (symbol === 'g') return { type: ce.type('unknown') };
          return undefined;
        },
      })
    ).toMatchInlineSnapshot(`["f", "g"]`);
  });

  test('Preserve subscriptEvaluate through both type styles', () => {
    // The normalization branches (BoxedType pass-through, string → BoxedType)
    // must carry `subscriptEvaluate` along: the symbol keeps its subscript as
    // a Subscript expression instead of absorbing it into a compound name.
    for (const type of ['number', ce.type('number')] as const) {
      expect(
        ce
          .parse('S_{5}', {
            resolveSymbol: (symbol) =>
              symbol === 'S' ? { type, subscriptEvaluate: true } : undefined,
            canonical: false,
          })
          .json.toString()
      ).toBe(['Subscript', 'S', 5].toString());
    }
    // Control: without the flag the subscript is absorbed into the name.
    expect(
      ce.parse('S_{5}', {
        resolveSymbol: (symbol) =>
          symbol === 'S' ? { type: 'number' } : undefined,
        canonical: false,
      }).json
    ).toBe('S_5');
  });

  test('Report invalid resolveSymbol() type values', () => {
    expect(() =>
      ce.parse('f(x)', {
        resolveSymbol: (symbol) =>
          symbol === 'f'
            ? { type: {} as unknown as ReturnType<typeof ce.type> }
            : undefined,
      })
    ).toThrow(
      /ce\.parse\(\): resolveSymbol\("f"\) must return a `type` that is a BoxedType or a type string, received object/
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

    test('An unknown name before a parenthesis is applied as one name', () => {
      // 'foo' is not a recognized function, but a letter run before a
      // parenthesis is one name, and an undeclared name before a
      // parenthesized argument is applied.
      expect(ce.parse('foo(x)', { strict: false })).toMatchInlineSnapshot(
        `["foo", "x"]`
      );
      expect(ce.parse('myfn(2, 3)', { strict: false })).toMatchInlineSnapshot(
        `["myfn", 2, 3]`
      );
      expect(ce.parse('2foo (x)', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", 2, ["foo", "x"]]`
      );
      expect(
        ce.parse('foo\\left(x\\right)', { strict: false })
      ).toMatchInlineSnapshot(`["foo", "x"]`);
      // Only a parenthesis joins the run: a sized bar or bracket does not.
      expect(
        ce.parse('ab\\left|x\\right|', { strict: false })
      ).toMatchInlineSnapshot(`["Multiply", "a", "b", ["Abs", "x"]]`);
      // A dictionary entry that claims the run keeps it: the rule applies to
      // an UNKNOWN name only.
      const custom = new ComputeEngine({
        latexSyntax: new LatexSyntax({
          dictionary: [
            ...LATEX_DICTIONARY,
            {
              latexTrigger: ['f', 'o', 'o'],
              kind: 'function',
              parse: 'CustomFoo',
            },
          ] as any,
        }),
      } as any);
      expect(custom.parse('foo(x)', { strict: false }).json).toEqual([
        'CustomFoo',
        'x',
      ]);
      // No stray diagnostic for the letters the run is not split into.
      const withDiagnostics = ce.parse('foo(x)', {
        strict: false,
        diagnostics: true,
      });
      expect(withDiagnostics.diagnostics ?? []).toEqual([]);
      // Away from a parenthesis the run is still split into letters.
      expect(ce.parse('foo', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", "f", "o", "o"]`
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

  // In non-strict mode a bare function name applies to a following factor even
  // without parentheses, the same way `\sin x` does. Previously `sin x` split
  // into letters (`i·n·s·x`, including the imaginary unit).
  describe('Bare function without parentheses (implicit argument)', () => {
    test('sin x → Sin(x)', () => {
      expect(ce.parse('sin x', { strict: false })).toMatchInlineSnapshot(
        `["Sin", "x"]`
      );
    });

    test('cos 2x → Cos(2x)', () => {
      expect(ce.parse('cos 2x', { strict: false })).toMatchInlineSnapshot(
        `["Cos", ["Multiply", 2, "x"]]`
      );
    });

    test('sqrt4 → Sqrt(4) = 2', () => {
      expect(ce.parse('sqrt4', { strict: false }).evaluate().json).toBe(2);
    });

    test('log2(8) → 3 (bare digit is the base)', () => {
      expect(ce.parse('log2(8)', { strict: false }).evaluate().json).toBe(3);
    });

    test('another bare function stops the implicit argument', () => {
      expect(ce.parse('sin x cos y', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", ["Sin", "x"], ["Cos", "y"]]`
      );
    });

    test('loge is NOT log base e (unknown name, stays symbols)', () => {
      expect(ce.parse('loge', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", "ExponentialE", "g", "l", "o"]`
      );
    });
  });

  describe('Bare symbols (Greek letters, constants)', () => {
    test('Greek lowercase', () => {
      expect(ce.parse('alpha', { strict: false })).toMatchInlineSnapshot(
        `alpha`
      );
      expect(ce.parse('beta', { strict: false })).toMatchInlineSnapshot(`beta`);
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
        `["Complex", 0, 1]`
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
      expect(ce.parse('p => q', { strict: false })).toMatchInlineSnapshot(`
        [
          "Implies",
          "p",
          [
            "Error",
            ["ErrorCode", "incompatible-type", "'boolean'", "'function'"],
            "q"
          ]
        ]
      `);
    });

    test('<=> maps to Equivalent', () => {
      // A fresh engine: the shared one has used `q` as a function above,
      // and `Equivalent` refuses a function-typed operand at boxing.
      const e = new ComputeEngine();
      expect(e.parse('p <=> q', { strict: false })).toMatchInlineSnapshot(
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

    test('÷ is the same as /', () => {
      const raw = (s: string) =>
        ce.parse(s, { strict: false, form: 'raw' }).json;
      expect(raw('x ÷ 2')).toEqual(['Divide', 'x', 2]);
      expect(raw('x ÷ 2')).toEqual(raw('x / 2'));
      expect(raw('a ÷ b ÷ c')).toEqual(raw('a / b / c'));
      expect(raw('1 + x ÷ 2')).toEqual(raw('1 + x / 2'));
    });

    test('Strict mode: ÷ is not an operator', () => {
      const json = JSON.stringify(ce.parse('x ÷ 2', { form: 'raw' }).json);
      expect(json).toContain('Error');
      expect(json).not.toContain('Divide');
    });

    test('Strict mode: ÷ is an unexpected token', () => {
      expect(ce.parse('a ÷ b', { form: 'raw' }).json).toEqual([
        'Sequence',
        'a',
        [
          'Error',
          ['ErrorCode', "'unexpected-token'", "'÷'"],
          ['LatexString', "'÷'"],
        ],
      ]);
    });
  });

  describe('Loose relational operator spellings', () => {
    const raw = (s: string, strict = false) =>
      ce.parse(s, { strict, form: 'raw' }).json;

    test('=< is LessEqual', () => {
      expect(raw('a =< b')).toEqual(['LessEqual', 'a', 'b']);
      expect(raw('a =< b =< c')).toEqual(raw('a <= b <= c'));
    });

    test('<> is NotEqual', () => {
      expect(raw('a <> b')).toEqual(['NotEqual', 'a', 'b']);
      expect(raw('a <> b <> c')).toEqual(raw('a \\ne b \\ne c'));
    });

    test('Strict mode: =< and <> are not relational operators', () => {
      expect(raw('a =< b', true)).not.toEqual(['LessEqual', 'a', 'b']);
      expect(raw('a <> b', true)).not.toEqual(['NotEqual', 'a', 'b']);
    });

    test('<= and >= chains are flat, in both modes', () => {
      for (const strict of [false, true]) {
        expect(raw('0.1 <= M <= 5', strict)).toEqual([
          'LessEqual',
          0.1,
          'M',
          5,
        ]);
        expect(raw('0.1 <= M <= 5', strict)).toEqual(
          raw('0.1 ≤ M ≤ 5', strict)
        );
        expect(raw('5 >= M >= 0.1', strict)).toEqual([
          'GreaterEqual',
          5,
          'M',
          0.1,
        ]);
        expect(raw('5 >= M >= 0.1', strict)).toEqual(
          raw('5 ≥ M ≥ 0.1', strict)
        );
        expect(raw('a != b != c', strict)).toEqual(raw('a ≠ b ≠ c', strict));
      }
    });

    test('mixed chains and LaTeX chains are unchanged', () => {
      expect(raw('0.1 \\le M \\le 5')).toEqual(['LessEqual', 0.1, 'M', 5]);
      expect(raw('a < b <= c')).toEqual(['LessEqual', ['Less', 'a', 'b'], 'c']);
      expect(raw('a <= b < c')).toEqual(['LessEqual', 'a', ['Less', 'b', 'c']]);
      expect(raw('a < b < c')).toEqual(['Less', 'a', 'b', 'c']);
    });
  });

  describe('Square root glyph with parentheses', () => {
    test('√(x+1) is Sqrt(x+1), as sqrt(x+1)', () => {
      const raw = (s: string) =>
        ce.parse(s, { strict: false, form: 'raw' }).json;
      expect(raw('√(x+1)')).toEqual(['Sqrt', ['Add', 'x', 1]]);
      expect(raw('√(x+1)')).toEqual(raw('sqrt(x+1)'));
      expect(raw('√\\left(x+1\\right)')).toEqual(['Sqrt', ['Add', 'x', 1]]);
      // Other radicands are unchanged
      expect(raw('√4')).toEqual(['Sqrt', 4]);
      expect(raw('√{x+1}')).toEqual(['Sqrt', ['Add', 'x', 1]]);
      expect(raw('√x+1')).toEqual(['Add', ['Sqrt', 'x'], 1]);
    });

    test('Strict mode: √( is unchanged', () => {
      expect(ce.parse('√(x+1)', { form: 'raw' }).json).toEqual([
        'InvisibleOperator',
        'Sqrt',
        ['Delimiter', ['Add', 'x', 1]],
      ]);
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
      // (second * produces a missing operand error in the multiplication)
      expect(parse('x**2')).toMatchInlineSnapshot(
        `["Multiply", "x", ["Error", "'missing'"], 2]`
      );
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
      expect(ce.parse('x_12', { strict: false })).toMatchInlineSnapshot(`x_12`);
    });

    test('x^2+y^3 expression', () => {
      expect(ce.parse('x^2+y^3', { strict: false })).toMatchInlineSnapshot(
        `["Add", ["Power", "y", 3], ["Square", "x"]]`
      );
    });
  });

  describe('Implicit subscript (non-strict)', () => {
    // A single-letter variable immediately followed by one or more digits is
    // interpreted as an implicit *subscript* in non-strict mode (`x2 → x_2`,
    // `x12 → x_12`). This preserves the index (a flattened indexed variable is
    // the common intent of ASCII/copy-paste input) and matches the strict `x_2`
    // form; adjacent digits in loose input are ordinary identifier text.

    test('x2 → x_2', () => {
      expect(ce.parse('x2', { strict: false })).toMatchInlineSnapshot(`x_2`);
    });

    test('y3 → y_3', () => {
      expect(ce.parse('y3', { strict: false })).toMatchInlineSnapshot(`y_3`);
    });

    test('x2 + y2 full expression', () => {
      expect(ce.parse('x2 + y2', { strict: false })).toMatchInlineSnapshot(
        `["Add", "x_2", "y_2"]`
      );
    });

    test('a3b2 implicit multiply', () => {
      expect(ce.parse('a3b2', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", "a_3", "b_2"]`
      );
    });

    test('r2 = 1 equation', () => {
      expect(ce.parse('r2 = 1', { strict: false })).toMatchInlineSnapshot(
        `["Equal", "r_2", 1]`
      );
    });

    // In strict mode the digit is a separate factor (no implicit subscript).
    test('strict mode: x2 is a product, not a subscript', () => {
      expect(parse('x2')).toMatchInlineSnapshot(`["Multiply", 2, "x"]`);
    });

    test('x0 → x_0', () => {
      expect(ce.parse('x0', { strict: false })).toMatchInlineSnapshot(`x_0`);
    });

    test('x1 → x_1 (index preserved)', () => {
      expect(ce.parse('x1', { strict: false })).toMatchInlineSnapshot(`x_1`);
    });

    test('x12 multi-digit → x_12', () => {
      expect(ce.parse('x12', { strict: false })).toMatchInlineSnapshot(`x_12`);
    });

    test('22 non-letter lhs should not be affected', () => {
      expect(ce.parse('22', { strict: false })).toMatchInlineSnapshot(`22`);
    });

    test('x 2 with space should NOT be an implicit subscript', () => {
      expect(ce.parse('x 2', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", 2, "x"]`
      );
    });

    test('x22 → x_22 (all trailing digits form the index)', () => {
      expect(ce.parse('x22', { strict: false })).toMatchInlineSnapshot(`x_22`);
    });
  });

  describe('End-to-end: copy-paste from web pages', () => {
    test('x2 + y2 = sin(5x)cos(y)', () => {
      expect(ce.parse('x2 + y2 = sin(5x)cos(y)', { strict: false }))
        .toMatchInlineSnapshot(`
        [
          "Equal",
          ["Add", "x_2", "y_2"],
          ["Multiply", ["Sin", ["Multiply", 5, "x"]], ["Cos", "y"]]
        ]
      `);
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
      expect(ce.parse('binom(n, k)', { strict: false })).toMatchInlineSnapshot(
        `["Binomial", "n", "k"]`
      );
    });

    test('nCr(n, k)', () => {
      expect(ce.parse('nCr(n, k)', { strict: false })).toMatchInlineSnapshot(
        `["Binomial", "n", "k"]`
      );
    });
  });

  describe('Bare function exponents', () => {
    test('sin^2(x)', () => {
      expect(ce.parse('sin^2(x)', { strict: false })).toMatchInlineSnapshot(
        `["Square", ["Sin", "x"]]`
      );
    });

    test('cos^{10}(x)', () => {
      expect(ce.parse('cos^{10}(x)', { strict: false })).toMatchInlineSnapshot(
        `["Power", ["Cos", "x"], 10]`
      );
    });

    test('tan^-1(x) → Arctan (inverse, not reciprocal)', () => {
      // A `-1` exponent denotes the inverse function, mirroring strict
      // `\tan^{-1}`. Other exponents remain a reciprocal power (see below).
      expect(ce.parse('tan^-1(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arctan", "x"]`
      );
    });

    test('sin^2(x) + cos^2(x) identity', () => {
      const a = ce.parse('sin^2(x) + cos^2(x)', { strict: false })!;
      // An identity in `x`: the prover tier, not arithmetic `=`.
      expect(a.isIdenticallyEqual(1)).toBe(true);
    });
  });

  // A `-1` exponent on a bare function denotes the inverse function, matching
  // strict `\sin^{-1}`. Other exponents stay a reciprocal power.
  describe('Bare inverse functions (^-1)', () => {
    test('sin^-1 1 → Arcsin(1)', () => {
      expect(ce.parse('sin^-1 1', { strict: false })).toMatchInlineSnapshot(
        `["Arcsin", 1]`
      );
    });

    test('cos^-1 x → Arccos(x)', () => {
      expect(ce.parse('cos^-1 x', { strict: false })).toMatchInlineSnapshot(
        `["Arccos", "x"]`
      );
    });

    test('tan^-1 x → Arctan(x)', () => {
      expect(ce.parse('tan^-1 x', { strict: false })).toMatchInlineSnapshot(
        `["Arctan", "x"]`
      );
    });

    test('sinh^-1 x → Arsinh(x)', () => {
      expect(ce.parse('sinh^-1 x', { strict: false })).toMatchInlineSnapshot(
        `["Arsinh", "x"]`
      );
    });

    test('sin^-2 x stays a reciprocal power (matches strict)', () => {
      // Only `-1` is the inverse function; `-2` is an ordinary reciprocal
      // power, exactly as strict `\sin^{-2}` parses it.
      const loose = ce.parse('sin^-2 x', { strict: false });
      const strict = ce.parse('\\sin^{-2} x', { strict: true });
      expect(loose.json).toEqual(strict.json);
      expect(loose.operator).not.toBe('Arcsin');
    });
  });

  // Function names that embed a trailing digit (`atan2`) and previously-missing
  // inverse-trig aliases.
  describe('Bare function name gaps', () => {
    test('atan2(1, 2) → Arctan2(1, 2)', () => {
      expect(ce.parse('atan2(1, 2)', { strict: false })).toMatchInlineSnapshot(
        `["Arctan2", 1, 2]`
      );
    });

    test('acot(x) → Arccot(x)', () => {
      expect(ce.parse('acot(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arccot", "x"]`
      );
    });

    test('asec(x) → Arcsec(x)', () => {
      expect(ce.parse('asec(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arcsec", "x"]`
      );
    });

    test('acsc(x) → Arccsc(x)', () => {
      expect(ce.parse('acsc(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arccsc", "x"]`
      );
    });

    // `atan` alone is unaffected — the digit is only absorbed when it forms a
    // known longer name (`atan2`).
    test('atan(x) stays Arctan(x)', () => {
      expect(ce.parse('atan(x)', { strict: false })).toMatchInlineSnapshot(
        `["Arctan", "x"]`
      );
    });
  });

  // Greedy segmentation of a multi-letter run that isn't a whole known word:
  // embedded Greek constants are recognized and a stray `*`-blocked function
  // name becomes a plain symbol rather than imaginary-unit letter soup.
  describe('Bare letter-run segmentation', () => {
    test('2pix → 2·π·x', () => {
      expect(ce.parse('2pix', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", 2, "Pi", "x"]`
      );
    });

    test('xpi → x·π', () => {
      expect(ce.parse('xpi', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", "Pi", "x"]`
      );
    });

    // `sin` cannot take an implicit argument across the explicit `*`, so it is
    // returned as a plain symbol (not the letter soup `i·n·s`).
    test('sin*x → sin·x (sin as unknown symbol)', () => {
      expect(ce.parse('sin*x', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", "sin", "x"]`
      );
    });

    // Word-bounded ASCII shorthands are NOT matched inside a run: `foo` keeps
    // its letters and does not pick up `oo` → ∞.
    test('foo stays letters (oo not matched mid-run)', () => {
      expect(ce.parse('foo', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", "f", "o", "o"]`
      );
      // A run holding a Greek constant keeps its segmentation before a
      // parenthesis too: `pix(3)` is `π·x·3`, not a call of `pix`.
      expect(ce.parse('pix(3)', { strict: false })).toMatchInlineSnapshot(
        `["Multiply", 3, "Pi", "x"]`
      );
    });
  });

  // An implicit subscript is also accepted on a recognized multi-letter
  // constant base (`alpha2` → `alpha_2`), not only single letters.
  describe('Implicit subscript on constant base', () => {
    test('alpha2 → alpha_2', () => {
      expect(ce.parse('alpha2', { strict: false })).toMatchInlineSnapshot(
        `alpha_2`
      );
    });

    test('theta12 → theta_12', () => {
      expect(ce.parse('theta12', { strict: false })).toMatchInlineSnapshot(
        `theta_12`
      );
    });
  });

  describe('Bare log with subscript', () => {
    test('log_2(x) → base 2', () => {
      expect(ce.parse('log_2(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x", 2]`
      );
    });

    test('log_{10}(x) → base 10 (default)', () => {
      expect(ce.parse('log_{10}(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x"]`
      );
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

  // The superscript binds to the *applied* logarithm, like `\sin^2 x`, and a
  // `^{-1}` superscript is the inverse function (not the reciprocal power).
  // (This engine renders `Power(_, 2)` as `Square` and `Power(e, _)` as `Exp`.)
  describe('Log/Ln/Exp superscript (power and inverse)', () => {
    test('\\log_2^2 x → (log_2 x)^2', () => {
      expect(ce.parse('\\log_2^2 x')).toMatchInlineSnapshot(
        `["Square", ["Log", "x", 2]]`
      );
    });

    test('\\log_2^2 8 evaluates to 9', () => {
      expect(ce.parse('\\log_2^2 8').evaluate().json).toBe(9);
    });

    test('\\ln^2 x → (ln x)^2', () => {
      expect(ce.parse('\\ln^2 x')).toMatchInlineSnapshot(
        `["Square", ["Ln", "x"]]`
      );
    });

    test('\\log^2 x → (log x)^2', () => {
      expect(ce.parse('\\log^2 x')).toMatchInlineSnapshot(
        `["Square", ["Log", "x"]]`
      );
    });

    test('\\ln^{-1} x → exp(x)', () => {
      expect(ce.parse('\\ln^{-1} x')).toMatchInlineSnapshot(`["Exp", "x"]`);
    });

    test('\\exp^2 x → (exp x)^2 = e^{2x}', () => {
      expect(ce.parse('\\exp^2 x')).toMatchInlineSnapshot(
        `["Exp", ["Multiply", 2, "x"]]`
      );
    });

    test('\\lg^2 x → (log_10 x)^2', () => {
      expect(ce.parse('\\lg^2 x')).toMatchInlineSnapshot(
        `["Square", ["Log", "x", 10]]`
      );
    });

    test('\\log_2 8 (no superscript) still evaluates to 3', () => {
      expect(ce.parse('\\log_2 8').evaluate().json).toBe(3);
    });
  });

  describe('Unicode superscripts', () => {
    test('x² → Power', () => {
      expect(ce.parse('x²')).toMatchInlineSnapshot(`["Square", "x"]`);
    });

    test('x²³ → multi-digit exponent', () => {
      expect(ce.parse('x²³')).toMatchInlineSnapshot(`["Power", "x", 23]`);
    });

    test('x⁻² → negative exponent', () => {
      expect(ce.parse('x⁻²')).toMatchInlineSnapshot(
        `["Divide", 1, ["Square", "x"]]`
      );
    });

    test('xⁿ → letter superscript', () => {
      expect(ce.parse('xⁿ')).toMatchInlineSnapshot(`["Power", "x", "n"]`);
    });

    test('2ⁿ → numeric base with letter exponent', () => {
      expect(ce.parse('2ⁿ')).toMatchInlineSnapshot(`["Power", 2, "n"]`);
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
      expect(ce.parse('x₁²')).toMatchInlineSnapshot(`["Square", "x_1"]`);
    });

    test('log₂(x) → Unicode subscript on bare log', () => {
      expect(ce.parse('log₂(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x", 2]`
      );
    });

    test('log₁₀(x) → Unicode subscript base 10', () => {
      expect(ce.parse('log₁₀(x)', { strict: false })).toMatchInlineSnapshot(
        `["Log", "x"]`
      );
    });
  });

  // The raw (non-canonical) parse, so the comparisons below are between the
  // trees the parser builds, before any canonical rewriting.
  const lenient = (s: string) =>
    ce.parse(s, { strict: false, form: 'raw' }).json;
  const strict = (s: string) => ce.parse(s, { form: 'raw' }).json;

  describe('Deeply nested exponents', () => {
    // A bare-function check used to read the exponent group of every `e^…`
    // before finding that `e` is not a function name, then discard it: the
    // work doubled at each level of nesting.
    test('a 40-level nest parses quickly and as in strict mode', () => {
      const n = 40;
      const src = 'e^{-('.repeat(n) + 'x' + ')}'.repeat(n);
      const t0 = Date.now();
      const result = lenient(src);
      // The time depends on the load of the machine, so the limit is asserted
      // only in a `CE_PERF=1` run. The comparison with strict mode below does
      // not depend on time.
      if (process.env.CE_PERF === '1')
        expect(Date.now() - t0).toBeLessThan(2000);
      expect(result).toEqual(strict(src));
    });

    test('a 40-level nest of signed unbraced exponents', () => {
      const n = 40;
      const t0 = Date.now();
      const result = lenient('e^-('.repeat(n) + 'x' + ')'.repeat(n));
      // The time depends on the load of the machine, so the limit is asserted
      // only in a `CE_PERF=1` run. The comparison below does not depend on
      // time.
      if (process.env.CE_PERF === '1')
        expect(Date.now() - t0).toBeLessThan(2000);
      expect(result).toEqual(lenient('e^{-('.repeat(n) + 'x' + ')}'.repeat(n)));
    });
  });

  describe('Bare sign and sgn', () => {
    test('map to Sign', () => {
      expect(lenient('sign(-2)')).toEqual(['Sign', ['Negate', 2]]);
      expect(lenient('sgn(x)')).toEqual(['Sign', 'x']);
      expect(ce.parse('sign(-2)', { strict: false }).evaluate().json).toEqual(
        -1
      );
      expect(ce.parse('sgn(3)', { strict: false }).evaluate().json).toEqual(1);
    });

    test('strict mode is unchanged', () => {
      expect(strict('sign(-2)')).not.toEqual(['Sign', ['Negate', 2]]);
    });
  });

  describe('Unbraced letter subscripts', () => {
    test('a run of letters is the whole subscript', () => {
      expect(lenient('x_max')).toEqual('x_max');
      expect(lenient('x_max')).toEqual(lenient('x_{max}'));
      expect(lenient('T_max')).toEqual('T_max');
      expect(lenient('y = x_1 + x_max')).toEqual([
        'Equal',
        'y',
        ['Add', 'x_1', 'x_max'],
      ]);
      expect(lenient('x_max^2')).toEqual(['Power', 'x_max', 2]);
      expect(lenient('\\alpha_max')).toEqual('alpha_max');
    });

    test('a two-letter run before a script keeps the adjacent symbols', () => {
      expect(lenient('a_nb_n')).toEqual(['InvisibleOperator', 'a_n', 'b_n']);
      expect(lenient('a_kx^k')).toEqual([
        'InvisibleOperator',
        'a_k',
        ['Power', 'x', 'k'],
      ]);
    });

    test('strict mode is unchanged', () => {
      expect(strict('x_max')).toEqual(['InvisibleOperator', 'x_m', 'a', 'x']);
    });
  });

  describe('Unbraced exponent operand', () => {
    test('reads one whole operand, as the braced spelling does', () => {
      for (const [bare, braced] of [
        ['x^2.5', 'x^{2.5}'],
        ['x^1.23456789012345678901', 'x^{1.23456789012345678901}'],
        ['x^pi', 'x^{pi}'],
        ['x^theta', 'x^{theta}'],
        ['x^inf', 'x^{inf}'],
        ['e^sin(x)', 'e^{sin(x)}'],
        ['x^12', 'x^{12}'],
      ])
        expect(lenient(bare)).toEqual(lenient(braced));
      expect(lenient('x^2.5')).toEqual(['Power', 'x', 2.5]);
      expect(lenient('x^pi')).toEqual(['Power', 'x', 'Pi']);
      expect(lenient('e^sin(x)')).toEqual(['Power', 'e', ['Sin', 'x']]);
    });

    test('white space and an ambiguous extent keep the previous reading', () => {
      expect(lenient('x^2 y')).toEqual([
        'InvisibleOperator',
        ['Power', 'x', 2],
        'y',
      ]);
      expect(lenient('x^2y')).toEqual([
        'InvisibleOperator',
        ['Power', 'x', 2],
        'y',
      ]);
      expect(lenient('e^2pi')).toEqual([
        'InvisibleOperator',
        ['Power', 'e', 2],
        'Pi',
      ]);
      expect(lenient('e^i pi')).toEqual([
        'InvisibleOperator',
        ['Power', 'e', 'i'],
        'Pi',
      ]);
      expect(lenient('x^ab')).toEqual([
        'InvisibleOperator',
        ['Power', 'x', 'a'],
        'b',
      ]);
    });

    test('strict mode is unchanged', () => {
      expect(strict('x^pi')).toEqual([
        'InvisibleOperator',
        ['Power', 'x', 'p'],
        'i',
      ]);
      expect(strict('x^2.5')).toEqual([
        'InvisibleOperator',
        ['Power', 'x', 2],
        0.5,
      ]);
    });
  });

  describe('Signed unbraced exponent', () => {
    test('the sign and one operand are the exponent', () => {
      for (const [bare, braced] of [
        ['e^-x', 'e^{-x}'],
        ['2^-x', '2^{-x}'],
        ['e^-sin(x)', 'e^{-sin(x)}'],
        ['e^-(x)', 'e^{-(x)}'],
        ['e^-\\left(x\\right)', 'e^{-\\left(x\\right)}'],
        ['e^-\\pi', 'e^{-\\pi}'],
        ['e^+x', 'e^{+x}'],
        ['x^-2.5', 'x^{-2.5}'],
      ])
        expect(lenient(bare)).toEqual(lenient(braced));
      expect(lenient('e^-x')).toEqual(['Power', 'e', ['Negate', 'x']]);
      expect(lenient('e^+x')).toEqual(['Power', 'e', 'x']);
      expect(lenient('x^-2')).toEqual(['Power', 'x', -2]);
      // A second superscript is the same error as for `e^{-x}^2`
      expect(lenient('e^-x^2')).toEqual([
        'Error',
        "'unexpected-superscript'",
        ['LatexString', "'^-x^2'"],
      ]);
    });

    test('a sign with no operand directly after it keeps its reading', () => {
      expect(lenient('\\Z^+')).toEqual('PositiveIntegers');
      expect(lenient('A^+')).toEqual(['PseudoInverse', 'A']);
      expect(lenient('A^+ x')).toEqual([
        'InvisibleOperator',
        ['PseudoInverse', 'A'],
        'x',
      ]);
      // White space after a `-` on a letter base is skipped: `e^- x` is
      // `e^-x` (see lenient-ambiguity-f.test.ts)
      expect(lenient('e^- x')).toEqual(['Power', 'e', ['Negate', 'x']]);
      expect(lenient('\\lim_{x\\to0^+}f(x)')).toEqual(
        strict('\\lim_{x\\to0^+}f(x)')
      );
      expect(lenient('\\lim_{x\\to0^-}f(x)')).toEqual(
        strict('\\lim_{x\\to0^-}f(x)')
      );
    });

    test('a script, a visual space or a closing delimiter is not an operand', () => {
      expect(lenient('x^-_k')).toEqual(['Subscript', ['Superminus', 'x'], 'k']);
      expect(lenient('n^+_k')).toEqual([
        'Subscript',
        ['PseudoInverse', 'n'],
        'k',
      ]);
      expect(lenient('x^-\\,y')).toEqual([
        'InvisibleOperator',
        ['Superminus', 'x'],
        ['HorizontalSpacing', 3],
        'y',
      ]);
      for (const src of ['x^-_k', 'n^+_k', 'x^-\\,y', 'x^-\\quad y', '(x^-)'])
        expect(lenient(src)).toEqual(strict(src));
    });

    test('a second superscript is an error, as in the other spellings', () => {
      for (const src of ['e^-x^2', 'e^{-x}^2', 'x^y^z'])
        expect((lenient(src) as unknown[]).slice(0, 2)).toEqual([
          'Error',
          "'unexpected-superscript'",
        ]);
    });

    test('strict mode is unchanged', () => {
      expect(strict('e^-x')).toEqual([
        'InvisibleOperator',
        ['Superminus', 'e'],
        'x',
      ]);
      expect(strict('e^+x')).toEqual([
        'InvisibleOperator',
        ['PseudoInverse', 'e'],
        'x',
      ]);
    });
  });

  describe('Bare words in and infinity', () => {
    test('in between two operands is Element', () => {
      expect(lenient('M in [0,1]')).toEqual([
        'Element',
        'M',
        ['Interval', 0, 1],
      ]);
      expect(lenient('M in [0,1]')).toEqual(lenient('M \\in [0,1]'));
      expect(lenient('x in A')).toEqual(['Element', 'x', 'A']);
      expect(lenient('x+1 in A')).toEqual(lenient('x+1 \\in A'));
      expect(lenient('\\{x in \\R : x>0\\}')).toEqual(
        lenient('\\{x \\in \\R : x>0\\}')
      );
    });

    test('infinity is PositiveInfinity', () => {
      expect(lenient('infinity')).toEqual('PositiveInfinity');
      expect(lenient('x < infinity')).toEqual([
        'Less',
        'x',
        'PositiveInfinity',
      ]);
    });

    test('other words that start with in keep their reading', () => {
      expect(lenient('index')).toEqual([
        'InvisibleOperator',
        'i',
        'n',
        'd',
        'e',
        'x',
      ]);
      expect(lenient('ink')).toEqual(['InvisibleOperator', 'i', 'n', 'k']);
      expect(lenient('x inf')).toEqual([
        'InvisibleOperator',
        'x',
        'PositiveInfinity',
      ]);
      expect(lenient('x in')).toEqual(['InvisibleOperator', 'x', 'i', 'n']);
      expect(lenient('x index')).toEqual(strict('x index'));
      expect(lenient('x int y')).toEqual(strict('x int y'));
    });

    test('a subscript or a letter run next to in keeps its reading', () => {
      expect(lenient('x_in S')).toEqual(['InvisibleOperator', 'x_in', 'S']);
      expect(lenient('x_i in S')).toEqual(['Element', 'x_i', 'S']);
      expect(lenient('a_nx')).toEqual('a_nx');
      expect(lenient('a_nx^n')).toEqual([
        'InvisibleOperator',
        'a_n',
        ['Power', 'x', 'n'],
      ]);
    });

    test('strict mode is unchanged', () => {
      expect(strict('x in A')).toEqual([
        'InvisibleOperator',
        'x',
        'i',
        'n',
        'A',
      ]);
      expect(strict('infinity')).not.toEqual('PositiveInfinity');
    });
  });
});

describe('UNICODE NORMALIZATION', () => {
  // "café" decomposed (NFD): 'c','a','f','e' + combining acute accent (U+0301).
  // NFC is derived from it via normalize() rather than written as a literal.
  // Input is normalized to NFC at tokenization, so NFD and NFC parse alike.
  const NFD = 'café';
  const NFC = NFD.normalize('NFC'); // 'café' with precomposed U+00E9

  test('decomposed (NFD) input parses identically to precomposed (NFC)', () => {
    expect(NFD).not.toEqual(NFC); // sanity: distinct code-point sequences
    const a = parse(NFC);
    const b = parse(NFD);
    expect(a.isValid).toBe(true);
    expect(b.isValid).toBe(true);
    expect(a.isSame(b)).toBe(true);
  });

  test('decomposed text inside \\mathrm matches its precomposed form', () => {
    const a = parse(`\\mathrm{${NFD}}`);
    expect(a.isValid).toBe(true);
    expect(a.isSame(parse(`\\mathrm{${NFC}}`))).toBe(true);
  });
});

// Call-vs-multiply disambiguation for a single-UPPERCASE-letter symbol before a
// parenthesized group. The predicate heuristic (single uppercase letter + `(`)
// only applies when the symbol carries no conflicting scope information: a
// KNOWN non-function type (assigned value or numeric/value declaration) means
// the symbol is a variable, so the group is a factor, not an argument list.
// Unknown or function-typed symbols keep the predicate/call default.
describe('uppercase-before-paren: scope overrides the predicate heuristic', () => {
  test('K assigned a numeric value → Multiply (strict and lenient), evaluates', () => {
    const ce = new ComputeEngine();
    ce.assign('K', -32.3);
    expect(ce.parse('K(2-0.1)').operator).toEqual('Multiply');
    expect(ce.parse('K(2-0.1)', { canonical: true }).operator).toEqual(
      'Multiply'
    );
    expect(ce.parse('K(2-0.1)').evaluate().re).toBeCloseTo(-61.37, 10);
  });

  test('K assigned → Multiply with ce.strict = false', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    ce.assign('K', -32.3);
    expect(ce.parse('K(2-0.1)').operator).toEqual('Multiply');
    expect(ce.parse('K(2-0.1)').evaluate().re).toBeCloseTo(-61.37, 10);
  });

  test('K declared as `number` → Multiply', () => {
    const ce = new ComputeEngine();
    ce.declare('K', 'number');
    expect(ce.parse('K(2-0.1)').operator).toEqual('Multiply');
  });

  test('K unknown → call (predicate default, UNCHANGED)', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('K(2-0.1)').operator).toEqual('K');
  });

  test('K unknown → call even with ce.strict = false (UNCHANGED)', () => {
    const ce = new ComputeEngine();
    ce.strict = false;
    expect(ce.parse('K(2-0.1)').operator).toEqual('K');
  });

  test('K declared as `(number) -> number` → call (UNCHANGED)', () => {
    const ce = new ComputeEngine();
    ce.declare('K', '(number) -> number');
    expect(ce.parse('K(2-0.1)').operator).toEqual('K');
  });

  test('lowercase v: assigned / declared number → Multiply, undeclared / declared fn → call', () => {
    {
      const ce = new ComputeEngine();
      ce.assign('v', 0.5);
      expect(ce.parse('v(2-0.1)').operator).toEqual('Multiply');
    }
    {
      const ce = new ComputeEngine();
      ce.declare('v', 'number');
      expect(ce.parse('v(2-0.1)').operator).toEqual('Multiply');
    }
    {
      // Undeclared: no type information, so the juxtaposition is a call.
      const ce = new ComputeEngine();
      expect(ce.parse('v(2-0.1)').operator).toEqual('v');
    }
    {
      const ce = new ComputeEngine();
      ce.declare('v', '(number) -> number');
      expect(ce.parse('v(2-0.1)').operator).toEqual('v');
    }
  });
});
