import { parse } from '../../utils';

describe('STYLE - MATH MODE', () => {
  test('\\textcolor', () => {
    expect(parse('x \\textcolor{red}{=} y')).toMatchInlineSnapshot(`
      '[
        "Error",
        "x",
        "'syntax-error'",
        ["LatexForm", "'\\\\textcolor{red}{=} y'"]
      ]'
    `);
  });
});

describe('STYLE - TEXT MODE', () => {
  test('\\text', () => {
    // Whitespace should be preserved
    expect(parse('a\\text{ and }b')).toMatchInlineSnapshot(
      `'["Error", "a", "'syntax-error'", ["LatexForm", "'\\\\text{ and }b'"]]'`
    );

    // Math mode inside text mode
    expect(parse('a\\text{ in $x$ }b')).toMatchInlineSnapshot(
      `'["Error", "a", "'syntax-error'", ["LatexForm", "'\\\\text{ in $x$ }b'"]]'`
    );

    expect(parse('a\\text{ black \\textcolor{red}{RED} }b'))
      .toMatchInlineSnapshot(`
      '[
        "Error",
        "a",
        "'syntax-error'",
        ["LatexForm", "'\\\\text{ black \\\\textcolor{red}{RED} }b'"]
      ]'
    `);

    expect(parse('a\\text{ black \\color{red}RED\\color{blue}BLUE} }b'))
      .toMatchInlineSnapshot(`
      '[
        "Error",
        "a",
        "'syntax-error'",
        ["LatexForm", "'\\\\text{ black \\\\color{red}RED\\\\color{blue}BLUE} }b'"]
      ]'
    `);
    expect(parse('a\\text{ black \\textcolor{red}{RED} black} }b'))
      .toMatchInlineSnapshot(`
      '[
        "Error",
        "a",
        "'syntax-error'",
        ["LatexForm", "'\\\\text{ black \\\\textcolor{red}{RED} black} }b'"]
      ]'
    `);

    expect(
      parse(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`'"' abc '"'`);
  });
});
