import { check } from '../../utils';

describe('STYLE - MATH MODE', () => {
  test('\\textcolor', () => {
    expect(check('x \\textcolor{red}{=} y')).toMatchInlineSnapshot(`
      latex     = [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\textcolor'"],
          ["Latex", "'\\textcolor{red}{=}'"]
        ],
        "y"
      ]
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\textcolor'"],
          ["Latex", "'\\textcolor{red}{=}'"]
        ],
        "y"
      ]
    `);
  });
});

describe('STYLE - TEXT MODE', () => {
  test('\\text', () => {
    // Whitespace should be preserved
    expect(check('a\\text{ and }b')).toMatchInlineSnapshot(`
      latex     = ["Sequence", "a", "' and '", "b"]
      ["Sequence", "a", "' and '", "b"]
    `);

    // Math mode inside text mode
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      latex     = ["Multiply", "a", "'x' in  ''", "b"]
      [
        "Multiply",
        "a",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            "Number",
            ["Domain", "String"]
          ],
          "'x' in  ''"
        ],
        "b"
      ]
    `);

    expect(check('a\\text{ black \\textcolor{red}{RED} }b'))
      .toMatchInlineSnapshot(`
      latex     = ["Sequence", "a", "'red,RED, black \\textcolor '", "b"]
      ["Sequence", "a", "'red,RED, black \\textcolor '", "b"]
    `);

    expect(check('a\\text{ black \\color{red}RED\\color{blue}BLUE} b'))
      .toMatchInlineSnapshot(`
      latex     = ["Sequence", "a", "' black '"]
      ["Sequence", "a", "' black '"]
    `);
    expect(check('a\\text{ black \\textcolor{red}{RED} black} b'))
      .toMatchInlineSnapshot(`
      latex     = ["Sequence", "a", "'red,RED, black \\textcolor black'", "b"]
      ["Sequence", "a", "'red,RED, black \\textcolor black'", "b"]
    `);

    expect(
      check(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`
      latex     = ' abc '
      ' abc '
    `);
  });
});
