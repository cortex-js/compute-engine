import { check } from '../../utils';

describe('STYLE - MATH MODE', () => {
  test('\\textcolor', () => {
    expect(check('x \\textcolor{red}{=} y')).toMatchInlineSnapshot(`
      'box      = ["Multiply", ["Sequence", "x", ["Error", ["ErrorCode", "'unexpected-command'", "'\\textcolor'"], ["Latex", "'\\textcolor{red}{=}'"]]], "y"]
      canonical = ["Multiply", "x", ["Error", ["ErrorCode", "'unexpected-command'", "'\\textcolor'"], ["Latex", "'\\textcolor{red}{=}'"]], "y"]'
    `);
  });
});

describe('STYLE - TEXT MODE', () => {
  test('\\text', () => {
    // Whitespace should be preserved
    expect(check('a\\text{ and }b')).toMatchInlineSnapshot(`
      'box      = ["Multiply", "a", "' and '", "b"]
      canonical = ["Multiply", "a", ["Error", ["ErrorCode", "'mismatched-argument-domain'", ["Domain", "Number"]], "' and '"], "b"]'
    `);

    // Math mode inside text mode
    expect(check('a\\text{ in $x$ }b')).toMatchInlineSnapshot(`
      'box      = ["Multiply", "a", "'x' in  ''", "b"]
      canonical = ["Multiply", "a", ["Error", ["ErrorCode", "'mismatched-argument-domain'", ["Domain", "Number"]], "'x' in  ''"], "b"]'
    `);

    expect(check('a\\text{ black \\textcolor{red}{RED} }b'))
      .toMatchInlineSnapshot(`
      'box      = ["Multiply", "a", "''red''RED'' black \\textcolor ''", "b"]
      canonical = ["Multiply", "a", ["Error", ["ErrorCode", "'mismatched-argument-domain'", ["Domain", "Number"]], "''red''RED'' black \\textcolor ''"], "b"]'
    `);

    expect(
      check('a\\text{ black \\color{red}RED\\color{blue}BLUE} }b')
    ).toMatchInlineSnapshot(`'["Multiply", "a", "' black '"]'`);
    expect(check('a\\text{ black \\textcolor{red}{RED} black} }b'))
      .toMatchInlineSnapshot(`
      'box      = ["Multiply", "a", ["Sequence", "''red''RED'' black \\textcolor black''", ["Error", "'unexpected-closing-delimiter'", ["Latex", "'}'"]]], "b"]
      canonical = ["Multiply", "a", ["Error", ["ErrorCode", "'mismatched-argument-domain'", ["Domain", "Number"]], "''red''RED'' black \\textcolor black''"], ["Error", "'unexpected-closing-delimiter'", ["Latex", "'}'"]], "b"]'
    `);

    expect(
      check(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`'"' abc '"'`);
  });
});
