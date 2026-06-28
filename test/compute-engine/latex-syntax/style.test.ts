import { check, engine, latex } from '../../utils';
import { serialize } from '../../../src/compute-engine/latex-syntax/latex-syntax';

describe('STYLE - MATH MODE', () => {
  // When `\textcolor` spans a math expression, its content is wrapped in an
  // `Annotated` carrying the color.
  test('\\textcolor', () => {
    expect(check('x = \\textcolor{red}{y + 1} - z')).toMatchInlineSnapshot(`
      box       = [
        "Equal",
        "x",
        [
          "Subtract",
          ["Annotated", ["Add", "y", 1], {dict: {color: "red"}}],
          "z"
        ]
      ]
      eval-auto = "False"
    `);
  });

  // A `\textcolor` wrapping a bare infix operator acts as that operator. Since
  // MathJSON cannot annotate a lone operator glyph, the color is dropped and
  // the result is the plain operator expression. (Previously this errored,
  // yielding a Tuple wrapping an 'expected-closing-delimiter' error.)
  test('\\textcolor wrapping an operator', () => {
    expect(check('x \\textcolor{red}{=} y')).toMatchInlineSnapshot(`
      box       = ["Equal", "x", "y"]
      eval-auto = "False"
    `);
    expect(check('x \\textcolor{red}{+} y')).toMatchInlineSnapshot(
      `["Add", "x", "y"]`
    );
    expect(check('a \\textcolor{blue}{\\le} b')).toMatchInlineSnapshot(
      `["LessEqual", "a", "b"]`
    );
  });

  // The operator wrapper must not disturb operand coloring: when the content
  // is an operand (not a bare operator), it stays an `Annotated`.
  test('\\textcolor wrapping an operand is unchanged', () => {
    expect(check('x \\textcolor{red}{y}')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "x", ["Annotated", "y", {dict: {color: "red"}}]]
      canonical = ["Multiply", "x", ["Annotated", "y", {dict: {color: "red"}}]]
      eval-auto = x * y
    `);
  });
});

describe('STYLE - TEXT MODE', () => {
  test('\\text', () => {
    // "and" is recognized as a math operator
    expect(check('a\\text{ and }b')).toMatchInlineSnapshot(`["And", "a", "b"]`);

    // Math mode inside text mode -> the math expression is parsed and promoted to Text
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", ["Text", " in ", "x", " "], "b"]
      canonical = ["Text", "a", " in ", "x", " ", "b"]
      eval-auto = "a in x b"
    `);

    expect(check('a\\text{ black \\textcolor{red}{RED} }b'))
      .toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        "a",
        [
          "Text",
          " black ",
          ["Annotated", "'RED'", {dict: {color: "red"}}],
          " "
        ],
        "b"
      ]
      canonical = [
        "Text",
        "a",
        " black ",
        ["Annotated", "'RED'", {dict: {color: "red"}}],
        " ",
        "b"
      ]
      eval-auto = "a black RED b"
    `);

    expect(check('a\\text{ black \\color{red}RED\\color{blue}BLUE} b'))
      .toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        "a",
        [
          "Text",
          " black ",
          ["Annotated", "'RED'", {dict: {color: "red"}}],
          ["Annotated", "'BLUE'", {dict: {color: "blue"}}]
        ],
        "b"
      ]
      canonical = [
        "Text",
        "a",
        " black ",
        ["Annotated", "'RED'", {dict: {color: "red"}}],
        ["Annotated", "'BLUE'", {dict: {color: "blue"}}],
        "b"
      ]
      eval-auto = "a black REDBLUEb"
    `);
    expect(check('a\\text{ black \\textcolor{red}{RED} black} b'))
      .toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        "a",
        [
          "Text",
          " black ",
          ["Annotated", "'RED'", {dict: {color: "red"}}],
          " black"
        ],
        "b"
      ]
      canonical = [
        "Text",
        "a",
        " black ",
        ["Annotated", "'RED'", {dict: {color: "red"}}],
        " black",
        "b"
      ]
      eval-auto = "a black RED blackb"
    `);

    expect(
      check(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`
      box       = [
        "Text",
        " abc ",
        ["Annotated", " b ", {dict: {color: "blue"}}],
        ["Annotated", " y ", {dict: {color: "yellow"}}],
        ["Text", "y ", ["Annotated", " g", {dict: {color: "green"}}]],
        " ",
        ["Annotated", "'r'", {dict: {color: "red"}}],
        " g"
      ]
      eval-auto = " abc  b  y y  g r g"
    `);
  });
});

describe('TEXT PROMOTION', () => {
  test('math + text + math promotes to Text', () => {
    expect(check('a\\text{ hello }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", " hello ", "b"]
      canonical = ["Text", "a", " hello ", "b"]
      eval-auto = "a hello b"
    `);
  });

  test('math + text with inline math + math promotes to Text', () => {
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", ["Text", " in ", "x", " "], "b"]
      canonical = ["Text", "a", " in ", "x", " ", "b"]
      eval-auto = "a in x b"
    `);
  });

  test('text alone (no surrounding math) stays as-is', () => {
    expect(check('\\text{hello}')).toMatchInlineSnapshot(`'hello'`);
  });
});

describe('MATH STYLE SWITCHES', () => {
  test('\\displaystyle parse', () => {
    const expr = engine.parse('{\\displaystyle x+y}', { form: 'raw' });
    expect(expr.json).toEqual([
      'Annotated',
      ['Add', 'x', 'y'],
      { dict: { mathStyle: 'normal' } },
    ]);
  });

  test('\\textstyle parse', () => {
    const expr = engine.parse('{\\textstyle x+y}', { form: 'raw' });
    expect(expr.json).toEqual([
      'Annotated',
      ['Add', 'x', 'y'],
      { dict: { mathStyle: 'compact' } },
    ]);
  });

  test('\\scriptstyle parse', () => {
    const expr = engine.parse('{\\scriptstyle x+y}', { form: 'raw' });
    expect(expr.json).toEqual([
      'Annotated',
      ['Add', 'x', 'y'],
      { dict: { mathStyle: 'script' } },
    ]);
  });

  test('\\scriptscriptstyle parse', () => {
    const expr = engine.parse('{\\scriptscriptstyle x+y}', { form: 'raw' });
    expect(expr.json).toEqual([
      'Annotated',
      ['Add', 'x', 'y'],
      { dict: { mathStyle: 'scriptscript' } },
    ]);
  });

  test('\\displaystyle roundtrip', () => {
    const input = '{\\displaystyle x+y}';
    expect(engine.parse(input).latex).toBe(input);
  });

  test('\\textstyle roundtrip', () => {
    const input = '{\\textstyle x+y}';
    expect(engine.parse(input).latex).toBe(input);
  });

  test('\\scriptstyle roundtrip', () => {
    const input = '{\\scriptstyle x+y}';
    expect(engine.parse(input).latex).toBe(input);
  });

  test('\\scriptscriptstyle roundtrip', () => {
    const input = '{\\scriptscriptstyle x+y}';
    expect(engine.parse(input).latex).toBe(input);
  });

  test('\\displaystyle inside equation', () => {
    expect(check('a={\\displaystyle \\frac{1}{2}}')).toMatchInlineSnapshot(`
      box       = [
        "Equal",
        "a",
        ["Annotated", ["Divide", 1, 2], {dict: {mathStyle: "normal"}}]
      ]
      canonical = [
        "Equal",
        "a",
        ["Annotated", ["Rational", 1, 2], {dict: {mathStyle: "normal"}}]
      ]
      eval-auto = "False"
    `);
  });

  test('serialize Annotated with mathStyle', () => {
    expect(latex(['Annotated', 'x', { dict: { mathStyle: 'normal' } }])).toBe(
      '{\\displaystyle x}'
    );
    expect(latex(['Annotated', 'x', { dict: { mathStyle: 'compact' } }])).toBe(
      '{\\textstyle x}'
    );
    expect(latex(['Annotated', 'x', { dict: { mathStyle: 'script' } }])).toBe(
      '{\\scriptstyle x}'
    );
    expect(
      latex(['Annotated', 'x', { dict: { mathStyle: 'scriptscript' } }])
    ).toBe('{\\scriptscriptstyle x}');
  });
});

describe('FONT SIZE SWITCHES', () => {
  test('all sizes parse correctly', () => {
    const expected: [string, number][] = [
      ['\\tiny', 1],
      ['\\scriptsize', 2],
      ['\\footnotesize', 3],
      ['\\small', 4],
      ['\\normalsize', 5],
      ['\\large', 6],
      ['\\Large', 7],
      ['\\LARGE', 8],
      ['\\huge', 9],
      ['\\Huge', 10],
    ];
    for (const [cmd, size] of expected) {
      const expr = engine.parse(`{${cmd} x}`, { form: 'raw' });
      expect(expr.json).toEqual(['Annotated', 'x', { dict: { size } }]);
    }
  });

  test('all sizes roundtrip', () => {
    const sizes = [
      '{\\tiny x}',
      '{\\scriptsize x}',
      '{\\footnotesize x}',
      '{\\small x}',
      '{\\normalsize x}',
      '{\\large x}',
      '{\\Large x}',
      '{\\LARGE x}',
      '{\\huge x}',
      '{\\Huge x}',
    ];
    for (const input of sizes) {
      expect(engine.parse(input).latex).toBe(input);
    }
  });

  test('size switch with compound expression roundtrip', () => {
    const input = '{\\large x+y}';
    const expr = engine.parse(input, { form: 'raw' });
    expect(expr.json).toEqual([
      'Annotated',
      ['Add', 'x', 'y'],
      { dict: { size: 6 } },
    ]);
    expect(engine.parse(input).latex).toBe(input);
  });

  test('serialize Annotated with size', () => {
    expect(latex(['Annotated', 'x', { dict: { size: 1 } }])).toBe('{\\tiny x}');
    expect(latex(['Annotated', 'x', { dict: { size: 5 } }])).toBe(
      '{\\normalsize x}'
    );
    expect(latex(['Annotated', 'x', { dict: { size: 10 } }])).toBe(
      '{\\Huge x}'
    );
  });
});

describe('COLOR SWITCH', () => {
  test('\\color parse', () => {
    const expr = engine.parse('\\color{red}x', { form: 'raw' });
    expect(expr.json).toEqual(['Annotated', 'x', { dict: { color: 'red' } }]);
  });

  test('\\color with compound expression', () => {
    const expr = engine.parse('\\color{blue}x+y', { form: 'raw' });
    expect(expr.json).toEqual([
      'Annotated',
      ['Add', 'x', 'y'],
      { dict: { color: 'blue' } },
    ]);
  });

  test('\\color scoped to group', () => {
    const expr = engine.parse('a+{\\color{red}b}+c', { form: 'raw' });
    expect(expr.json).toEqual([
      'Add',
      'a',
      ['Annotated', 'b', { dict: { color: 'red' } }],
      'c',
    ]);
  });

  test('\\color serializes as \\textcolor', () => {
    // \color is a switch; serialization normalizes to \textcolor
    const expr = engine.parse('\\color{red}x');
    expect(expr.latex).toBe('\\textcolor{red}{x}');
  });

  test('\\textcolor roundtrip', () => {
    const input = '\\textcolor{red}{x}';
    expect(engine.parse(input).latex).toBe(input);
  });
});

describe('COMBINED ANNOTATIONS', () => {
  test('serialize Annotated with mathStyle and color', () => {
    expect(
      latex(['Annotated', 'x', { dict: { mathStyle: 'normal', color: 'red' } }])
    ).toBe('\\textcolor{red}{{\\displaystyle x}}');
  });

  test('serialize Annotated with size and color', () => {
    expect(
      latex(['Annotated', 'x', { dict: { size: 6, color: 'blue' } }])
    ).toBe('\\textcolor{blue}{{\\large x}}');
  });
});

describe('TEXT KEYWORDS', () => {
  test('\\text{such that} as infix', () => {
    expect(check('x \\text{ such that } x > 0')).toMatchInlineSnapshot(`
      box       = ["Colon", "x", ["Greater", "x", 0]]
      canonical = ["Colon", "x", ["Less", 0, "x"]]
    `);
  });

  test('\\text{for all} as prefix', () => {
    expect(check('\\text{for all} x: x > 0')).toMatchInlineSnapshot(`
      box       = ["ForAll", "x", ["Greater", "x", 0]]
      simplify  = ForAll(x, 0 < x)
      eval-auto = ForAll(x, x > 0)
    `);
  });

  test('\\text{there exists} as prefix', () => {
    expect(check('\\text{there exists} x: x > 0')).toMatchInlineSnapshot(`
      box       = ["Exists", "x", ["Greater", "x", 0]]
      simplify  = Exists(x, 0 < x)
      eval-auto = Exists(x, x > 0)
    `);
  });
});

describe('SPACING COMMANDS', () => {
  test('\\hspace{dim} is skipped', () => {
    expect(engine.parse('x\\hspace{1em}y').json).toEqual([
      'Multiply',
      'x',
      'y',
    ]);
  });

  test('\\hspace*{dim} is skipped', () => {
    expect(engine.parse('x\\hspace*{2em}y').json).toEqual([
      'Multiply',
      'x',
      'y',
    ]);
  });

  test('\\kern with dimension is skipped', () => {
    expect(engine.parse('x\\kern3mu y').json).toEqual(['Multiply', 'x', 'y']);
  });

  test('\\kern with negative dimension is skipped', () => {
    expect(engine.parse('x\\kern-3mu y').json).toEqual(['Multiply', 'x', 'y']);
  });

  test('\\kern with decimal dimension is skipped', () => {
    expect(engine.parse('x\\kern0.5em y').json).toEqual(['Multiply', 'x', 'y']);
  });

  test('\\hskip with dimension is skipped', () => {
    expect(engine.parse('x\\hskip5pt y').json).toEqual(['Multiply', 'x', 'y']);
  });

  test('\\kern without dimension is skipped', () => {
    expect(engine.parse('x\\kern y').json).toEqual(['Multiply', 'x', 'y']);
  });

  test('\\kern alone parses to Nothing', () => {
    expect(engine.parse('\\kern3mu').json).toEqual('Nothing');
  });

  test('\\hspace alone parses to Nothing', () => {
    expect(engine.parse('\\hspace{1em}').json).toEqual('Nothing');
  });

  test('\\hskip alone parses to Nothing', () => {
    expect(engine.parse('\\hskip5pt').json).toEqual('Nothing');
  });
});

describe('HORIZONTAL SPACING SERIALIZE', () => {
  test('HorizontalSpacing with math class bin', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'bin'"])).toBe('\\mathbin{x}');
  });

  test('HorizontalSpacing with math class rel', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'rel'"])).toBe('\\mathrel{x}');
  });

  test('HorizontalSpacing with math class op', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'op'"])).toBe('\\mathop{x}');
  });

  test('HorizontalSpacing with math class ord', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'ord'"])).toBe('\\mathord{x}');
  });

  test('HorizontalSpacing with math class open', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'open'"])).toBe(
      '\\mathopen{x}'
    );
  });

  test('HorizontalSpacing with math class close', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'close'"])).toBe(
      '\\mathclose{x}'
    );
  });

  test('HorizontalSpacing with math class punct', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'punct'"])).toBe(
      '\\mathpunct{x}'
    );
  });

  test('HorizontalSpacing with math class inner', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'inner'"])).toBe(
      '\\mathinner{x}'
    );
  });

  test('HorizontalSpacing with unknown class falls back', () => {
    expect(serialize(['HorizontalSpacing', 'x', "'foo'"])).toBe('x');
  });

  test('HorizontalSpacing with compound expression', () => {
    expect(serialize(['HorizontalSpacing', ['Add', 'x', 1], "'bin'"])).toBe(
      '\\mathbin{x+1}'
    );
  });
});

describe('STYLE - LONG NUMERATOR OVER A SINGLE POWER', () => {
  // A long numerator over a single power of a small base serializes with an
  // inline solidus rather than a tall, lopsided fraction.
  const numer = '3x^4+2x^3+x+5';
  const frac = (denom: string) =>
    engine.parse(`\\frac{${numer}}{${denom}}`).latex;

  test('large integer power', () => {
    expect(frac('x^{23}')).toBe('(3x^4+2x^3+x+5)/x^{23}');
    expect(frac('x^{3}')).toBe('(3x^4+2x^3+x+5)/x^3');
  });

  test('Square (exponent 2) is covered', () => {
    // `Power(x, 2)` is rewritten to `Square(x)` while prettifying; it still
    // takes the solidus path.
    expect(frac('x^{2}')).toBe('(3x^4+2x^3+x+5)/x^2');
  });

  test('Sqrt (exponent 1/2) is covered', () => {
    expect(frac('\\sqrt{x}')).toBe('(3x^4+2x^3+x+5)/\\sqrt{x}');
  });

  test('only a small base qualifies', () => {
    // A compound base stays a quotient.
    expect(frac('(x+1)^{23}')).toBe('\\frac{3x^4+2x^3+x+5}{(x+1)^{23}}');
    expect(frac('\\sqrt{x+1}')).toBe('\\frac{3x^4+2x^3+x+5}{\\sqrt{x+1}}');
  });

  test('only a single power qualifies', () => {
    // `a·x^n` is a product, not a single power, so it stays a quotient.
    expect(frac('2x^{23}')).toBe('\\frac{3x^4+2x^3+x+5}{2x^{23}}');
  });

  test('a small numerator is unaffected', () => {
    // `1/x^{23}` keeps its fraction; the rewrite needs a long numerator.
    expect(engine.parse('\\frac{1}{x^{23}}').latex).toBe('\\frac{1}{x^{23}}');
    expect(engine.parse('\\frac{1}{\\sqrt{x}}').latex).toBe(
      '\\frac{1}{\\sqrt{x}}'
    );
  });

  test('disabled by prettify: false', () => {
    expect(
      engine.parse(`\\frac{${numer}}{x^{23}}`).toLatex({ prettify: false })
    ).toBe('\\frac{3x^4+2x^3+x+5}{x^{23}}');
    expect(
      engine.parse(`\\frac{${numer}}{\\sqrt{x}}`).toLatex({ prettify: false })
    ).toBe('\\frac{3x^4+2x^3+x+5}{\\sqrt{x}}');
  });
});
