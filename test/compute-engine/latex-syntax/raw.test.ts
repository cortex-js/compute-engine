import { rawExpression } from '../../utils';

describe('NO DICTIONARY/NO DEFAULTS', () => {
  test('Parsing', () => {
    expect(rawExpression('')).toMatchInlineSnapshot(`'"Nothing"'`);
    expect(rawExpression('1+x')).toMatchInlineSnapshot(
      `'["Error",1,"'syntax-error'",["LatexForm","'+x'"]]'`
    );
    expect(rawExpression('x^2')).toMatchInlineSnapshot(`'"x"'`);
    expect(rawExpression('\\frac{1}{x}')).toMatchInlineSnapshot(
      `'["Error","\\\\frac","'syntax-error'",["LatexForm","'{1}{x}'"]]'`
    );
    expect(
      rawExpression('\\sqrt{(1+x_0)}=\\frac{\\pi^2}{2}')
    ).toMatchInlineSnapshot(
      `'["Error","\\\\sqrt","'syntax-error'",["LatexForm","'{(1+x_0)}=\\\\frac{\\\\pi^2}{2}'"]]'`
    );
  });
});
