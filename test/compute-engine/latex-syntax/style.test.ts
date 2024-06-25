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
      box       = ["InvisibleOperator", "a", "' and '", "b"]
      canonical = ["Triple", "a", "' and '", "b"]
    `);

    // Math mode inside text mode
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", "'x' in  ''", "b"]
      canonical = ["Triple", "a", "'x' in  ''", "b"]
    `);

    expect(check('a\\text{ black \\textcolor{red}{RED} }b'))
      .toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", "'red,RED, black \\textcolor '", "b"]
      canonical = ["Triple", "a", "'red,RED, black \\textcolor '", "b"]
    `);

    expect(check('a\\text{ black \\color{red}RED\\color{blue}BLUE} b'))
      .toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", "' black '", "b"]
      canonical = ["Triple", "a", "' black '", "b"]
    `);
    expect(check('a\\text{ black \\textcolor{red}{RED} black} b'))
      .toMatchInlineSnapshot(`
      box       = ["InvisibleOperator", "a", "'red,RED, black \\textcolor black'", "b"]
      canonical = ["Triple", "a", "'red,RED, black \\textcolor black'", "b"]
    `);

    expect(
      check(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`' abc 'red''r''`);
  });
});
