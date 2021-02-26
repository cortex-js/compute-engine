import { rawExpression } from './utils';

describe('NO DICTIONARY/NO DEFAULTS', () => {
  test('Parsing', () => {
    expect(rawExpression('')).toMatchInlineSnapshot(`'""'`);
    expect(rawExpression('1+x')).toMatchInlineSnapshot(`'["Latex",1,"+","x"]'`);
    expect(rawExpression('x^2')).toMatchInlineSnapshot(`'["Latex","x","^",2]'`);
    expect(rawExpression('\\frac{1}{x}')).toMatchInlineSnapshot(
      `'["Latex","\\\\frac","<{>",1,"<}>","<{>","x","<}>"]'`
    );
    expect(
      rawExpression('\\sqrt{(1+x_0)}=\\frac{\\pi^2}{2}')
    ).toMatchInlineSnapshot(
      `'["Latex","\\\\sqrt","<{>","(",1,"+","x","_",0,")","<}>","=","\\\\frac","<{>","\\\\pi","^",2,"<}>","<{>",2,"<}>"]'`
    );
  });
});
