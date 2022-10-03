import { check } from '../../utils';

describe('STYLE - MATH MODE', () => {
  test('\\textcolor', () => {
    expect(check('x \\textcolor{red}{=} y')).toMatchInlineSnapshot(`
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
    expect(check('a\\text{ and }b')).toMatchInlineSnapshot(
      `["Sequence", "a", "' and '", "b"]`
    );

    // Math mode inside text mode
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box      = ["Multiply", "a", "'x' in  ''", "b"]
      canonical = [
        "Multiply",
        "a",
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "Number"],
            ["Domain", "String"]
          ],
          "'x' in  ''"
        ],
        "b"
      ]
    `);

    expect(
      check('a\\text{ black \\textcolor{red}{RED} }b')
    ).toMatchInlineSnapshot(
      `["Sequence", "a", "'red,RED, black \\textcolor '", "b"]`
    );

    expect(
      check('a\\text{ black \\color{red}RED\\color{blue}BLUE} b')
    ).toMatchInlineSnapshot(`["Sequence", "a", "' black '"]`);
    expect(
      check('a\\text{ black \\textcolor{red}{RED} black} b')
    ).toMatchInlineSnapshot(
      `["Sequence", "a", "'red,RED, black \\textcolor black'", "b"]`
    );

    expect(
      check(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`' abc '`);
  });
});
