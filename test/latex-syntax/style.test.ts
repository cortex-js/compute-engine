import { expression } from '../utils';

describe('STYLE - MATH MODE', () => {
  test('\\textcolor', () => {
    expect(expression('x \\textcolor{red}{=} y')).toMatchInlineSnapshot(
      `['Sequence', 'x', ['Error', ['LatexString', {str: '\\textcolor{red}{=} y'}], ''syntax-error'']]`
    );
  });
});

describe('STYLE - TEXT MODE', () => {
  test('\\text', () => {
    // Whitespace should be preserved
    expect(expression('a\\text{ and }b')).toMatchInlineSnapshot(
      `['Sequence', 'a', ['Error', ['LatexString', {str: '\\text{ and }b'}], ''syntax-error'']]`
    );

    // Math mode inside text mode
    expect(expression('a\\text{ in $x$ }b')).toMatchInlineSnapshot(
      `['Sequence', 'a', ['Error', ['LatexString', {str: '\\text{ in $x$ }b'}], ''syntax-error'']]`
    );

    expect(
      expression('a\\text{ black \\textcolor{red}{RED} }b')
    ).toMatchInlineSnapshot(
      `['Sequence', 'a', ['Error', ['LatexString', {str: '\\text{ black \\textcolor{red}{RED} }b'}], ''syntax-error'']]`
    );

    expect(
      expression('a\\text{ black \\color{red}RED\\color{blue}BLUE} }b')
    ).toMatchInlineSnapshot(
      `['Sequence', 'a', ['Error', ['LatexString', {str: '\\text{ black \\color{red}RED\\color{blue}BLUE} }b'}], ''syntax-error'']]`
    );
    expect(
      expression('a\\text{ black \\textcolor{red}{RED} black} }b')
    ).toMatchInlineSnapshot(
      `['Sequence', 'a', ['Error', ['LatexString', {str: '\\text{ black \\textcolor{red}{RED} black} }b'}], ''syntax-error'']]`
    );

    expect(
      expression(
        '\\text{ abc \\color{blue} b \\color{yellow} y {y \\color{green} g} \\textcolor{red}{r} g}'
      )
    ).toMatchInlineSnapshot(`['String', ['String', ' abc ']]`);
  });
});
