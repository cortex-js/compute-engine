import { expression } from '../utils';

describe.skip('STEFNOTCH #9', () => {
  test('/1', () => {
    expect(
      expression('\\int_{\\placeholder{⬚}}^{\\placeholder{⬚}}3x')
    ).toMatchInlineSnapshot();
  });
});

describe.skip('STEFNOTCH #10', () => {
  test('/1', () => {
    expect(
      expression(
        '\\displaystyle \\left(\\sin^{-1}\\mleft(x\\mright)\\right)^{\\prime}'
      )
    ).toMatchInlineSnapshot();
  });

  test('/2', () => {
    expect(expression('1^{\\sin(x)}')).toMatch(`['Power', 1, ['Sin', 'x']]`);
  });

  test('/3', () => {
    expect(expression('3\\text{hello}6')).toMatchInlineSnapshot();
  });

  test('/4', () => {
    expect(expression('\\color{red}3')).toMatchInlineSnapshot();
  });

  test('/5', () => {
    expect(expression('\\ln(3)')).toMatchInlineSnapshot();
  });

  test('/6', () => {
    expect(expression('f:[a,b]\\to R ')).toMatchInlineSnapshot();
  });

  test('/7', () => {
    expect(expression('\\lim_{n\\to\\infin}3')).toMatchInlineSnapshot();
  });

  test.skip('/8', () => {
    expect(
      expression('\\begin{cases} 3 & x < 5 \\ 7 & else \\end{cases}')
    ).toMatchInlineSnapshot();
  });
});

describe.skip('STEFNOTCH #12', () => {
  test('/1', () => {
    expect(
      expression('e^{i\\pi\\text{nope!?\\lparen sum}}')
    ).toMatchInlineSnapshot();
  });
});

describe.skip('STEFNOTCH #13', () => {
  test('/1', () => {
    expect(
      expression(
        'N(\\varepsilon)\\coloneq\\lceil\\frac{4}{\\varepsilon^2}\\rceil'
      )
    ).toMatchInlineSnapshot();
  });

  test('/2', () => {
    expect(expression('x_{1,2}=1,2')).toMatchInlineSnapshot();
  });

  test('/3', () => {
    expect(expression('\\{1,2\\}')).toMatchInlineSnapshot();
  });

  test('/4', () => {
    expect(expression('[1,2]')).toMatchInlineSnapshot();
  });

  test('/5', () => {
    expect(
      expression('\\frac{2}{\\sqrt{n}}\\Leftrightarrow n>\\frac{5}{n^2}')
    ).toMatchInlineSnapshot();
  });

  test('/6', () => {
    expect(
      expression('|a_n|\\le\\frac{2}{\\sqrt{n}}\\Rightarrow a_n\\to0=0')
    ).toMatchInlineSnapshot();
  });

  test('/7', () => {
    expect(expression('3\\equiv5\\mod7')).toMatchInlineSnapshot();
  });

  test('/8', () => {
    expect(
      expression('a={\displaystyle \lim_{n\to\infin}a_n}')
    ).toMatchInlineSnapshot();
  });

  test('/9', () => {
    expect(
      expression('\forall x\in\C^2:|x|<0')
    ).toMatchInlineSnapshot();
  });

  test('/10', () => {
    expect(
      expression('\forall n\colon a_n\le c_n\le b_n\implies\lim_{n\to\infin}c_n=a')
    ).toMatchInlineSnapshot();
  });
});
