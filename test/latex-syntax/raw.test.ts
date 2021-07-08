import { rawExpression } from '../utils';

describe('NO DICTIONARY/NO DEFAULTS', () => {
  test('Parsing', () => {
    expect(rawExpression('')).toMatchInlineSnapshot(`'""'`);
    expect(rawExpression('1+x')).toMatchInlineSnapshot(
      `'["Sequence",1,["Error",["LatexString",{"str":"+x"}],"'syntax-error'"]]'`
    );
    expect(rawExpression('x^2')).toMatchInlineSnapshot(`'"x"'`);
    expect(rawExpression('\\frac{1}{x}')).toMatchInlineSnapshot(
      `'["Sequence","\\\\frac",["Error",["LatexString",{"str":"{1}{x}"}],"'syntax-error'"]]'`
    );
    expect(
      rawExpression('\\sqrt{(1+x_0)}=\\frac{\\pi^2}{2}')
    ).toMatchInlineSnapshot(
      `'["Sequence","\\\\sqrt",["Error",["LatexString",{"str":"{(1+x_0)}=\\\\frac{\\\\pi^2}{2}"}],"'syntax-error'"]]'`
    );
  });
});
