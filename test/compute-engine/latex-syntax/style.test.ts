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
    `);

    expect(check('a\\text{ black \\textcolor{red}{RED} }b'))
      .toMatchInlineSnapshot(`
      invalid   =[
        "InvisibleOperator",
        "a",
        [
          "Text",
          [
            "Annotated",
            [
              "InvisibleOperator",
              "R",
              "E",
              "D",
              ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]],
              "b"
            ],
            {dict: {color: "red"}}
          ],
          " black "
        ]
      ]
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
      eval-auto = Text(a, " black ", Annotated("RED", {"dict":{"color":"red"}}), Annotated("BLUE", {"dict":{"color":"blue"}}), b)
      eval-mach = Text(a, " black ", "RED", "BLUE", b)
    `);
    expect(check('a\\text{ black \\textcolor{red}{RED} black} b'))
      .toMatchInlineSnapshot(`
      invalid   =[
        "InvisibleOperator",
        "a",
        [
          "Text",
          [
            "Annotated",
            [
              "InvisibleOperator",
              "R",
              "E",
              "D",
              "b",
              "l",
              "a",
              "c",
              "k",
              ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]],
              "b"
            ],
            {dict: {color: "red"}}
          ],
          " black "
        ]
      ]
    `);

    expect(
      check(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`
      invalid   =[
        "Text",
        " abc ",
        ["Annotated", " b ", {dict: {color: "blue"}}],
        ["Annotated", " y ", {dict: {color: "yellow"}}],
        ["Text", "y ", ["Annotated", " g", {dict: {color: "green"}}]],
        [
          "Annotated",
          [
            "InvisibleOperator",
            "r",
            "g",
            ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]]
          ],
          {dict: {color: "red"}}
        ],
        " "
      ]
    `);
  });
});

describe('TEXT PROMOTION', () => {
  test('math + text + math promotes to Text', () => {
    expect(check('a\\text{ hello }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", " hello ", "b"]
      canonical = ["Text", "a", " hello ", "b"]
    `);
  });

  test('math + text with inline math + math promotes to Text', () => {
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", ["Text", " in ", "x", " "], "b"]
      canonical = ["Text", "a", " in ", "x", " ", "b"]
    `);
  });

  test('text alone (no surrounding math) stays as-is', () => {
    expect(check('\\text{hello}')).toMatchInlineSnapshot(`'hello'`);
  });
});
