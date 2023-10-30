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
          ["LatexString", "'\\textcolor{red}{=}'"]
        ]
      ]
      [
        "Sequence",
        "x",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\textcolor'"],
          ["LatexString", "'\\textcolor{red}{=}'"]
        ]
      ]
    `);
  });
});

describe('STYLE - TEXT MODE', () => {
  test('\\text', () => {
    // Whitespace should be preserved
    expect(check('a\\text{ and }b')).toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", "a", "' and '", "b"]
      ["Triple", "a", "' and '", "b"]
    `);

    // Math mode inside text mode
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", "a", "'x' in  ''", "b"]
      ["Triple", "a", "'x' in  ''", "b"]
    `);

    expect(check('a\\text{ black \\textcolor{red}{RED} }b'))
      .toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", "a", "'red,RED, black \\textcolor '", "b"]
      ["Triple", "a", "'red,RED, black \\textcolor '", "b"]
    `);

    expect(check('a\\text{ black \\color{red}RED\\color{blue}BLUE} b'))
      .toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", "a", "' black '", "b"]
      ["Triple", "a", "' black '", "b"]
    `);
    expect(check('a\\text{ black \\textcolor{red}{RED} black} b'))
      .toMatchInlineSnapshot(`
      latex     = ["InvisibleOperator", "a", "'red,RED, black \\textcolor black'", "b"]
      ["Triple", "a", "'red,RED, black \\textcolor black'", "b"]
    `);

    expect(
      check(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`
      latex     = ' abc 'red''r''
      ' abc 'red''r''
    `);
  });
});
