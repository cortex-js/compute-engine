import { check } from '../../utils';

describe('STYLE - MATH MODE', () => {
  // Note: the \textcolor command must span a valid math expression, so for example, `x = \textcolor{red}{y + 1}` is valid but `x \textcolor{red}{=} y + 1}` is not valid.
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
      eval-mach = "a black \\"RED\\" b"
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
      eval-mach = "a black \\"RED\\"\\"BLUE\\"b"
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
      eval-mach = "a black \\"RED\\" blackb"
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
