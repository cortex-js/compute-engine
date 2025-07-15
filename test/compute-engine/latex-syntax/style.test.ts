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
          [
            "Annotated",
            ["Add", "y", 1],
            ["Dictionary", {dict: {color: "red"}}]
          ],
          "z"
        ]
      ]
      eval-auto = "False"
    `);
  });
});

describe('STYLE - TEXT MODE', () => {
  test('\\text', () => {
    // Whitespace should be preserved
    expect(check('a\\text{ and }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", " and ", "b"]
      canonical = ["Triple", "a", " and ", "b"]
    `);

    // Math mode inside text mode
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", ["Text", "x", " in  "], "b"]
      canonical = ["Triple", "a", ["Text", "x", " in  "], "b"]
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
            ["Dictionary", {dict: {color: "red"}}]
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
          ["Annotated", "'RED'", ["Dictionary", {dict: {color: "red"}}]],
          ["Annotated", "'BLUE'", ["Dictionary", {dict: {color: "blue"}}]]
        ],
        "b"
      ]
      canonical = [
        "Triple",
        "a",
        [
          "Text",
          " black ",
          ["Annotated", "'RED'", ["Dictionary", {dict: {color: "red"}}]],
          ["Annotated", "'BLUE'", ["Dictionary", {dict: {color: "blue"}}]]
        ],
        "b"
      ]
      eval-auto = (a, Text(" black ", "RED", "BLUE"), b)
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
            ["Dictionary", {dict: {color: "red"}}]
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
        ["Annotated", " b ", ["Dictionary", {dict: {color: "blue"}}]],
        ["Annotated", " y ", ["Dictionary", {dict: {color: "yellow"}}]],
        [
          "Text",
          "y ",
          ["Annotated", " g", ["Dictionary", {dict: {color: "green"}}]]
        ],
        [
          "Annotated",
          [
            "InvisibleOperator",
            "r",
            "g",
            ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]]
          ],
          ["Dictionary", {dict: {color: "red"}}]
        ],
        " "
      ]
    `);
  });
});
