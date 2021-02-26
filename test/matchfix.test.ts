import { expression, latex, printExpression } from './utils';

describe('MATCHFIX', () => {
  test('Parse valid matchfix', () => {
    expect(expression('\\lbrack\\rbrack')).toMatchInlineSnapshot(`['List']`);
    expect(expression('\\lbrack a\\rbrack')).toMatchInlineSnapshot(
      `['List', 'a']`
    );
    expect(expression('\\lbrack a, b\\rbrack')).toMatchInlineSnapshot(
      `['List', 'a', 'b']`
    );
    expect(
      expression('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
    ).toMatchInlineSnapshot(`['List', 'a', ['List', 'b', 'c']]`);
    expect(
      expression('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
    ).toMatchInlineSnapshot(`['Sin', ['List', 'a', ['List', 'b', 'c']]]`); // @todo
  });
  test('Serialize valid matchfix', () => {
    expect(latex(['List'])).toMatchInlineSnapshot(`'\\lbrack\\rbrack'`);
    expect(latex(['List', 'a'])).toMatchInlineSnapshot(`'\\lbrack a\\rbrack'`);
    expect(latex(['List', 'a', 'b'])).toMatchInlineSnapshot(
      `'\\lbrack a,b\\rbrack'`
    );
    expect(latex(['List', 'a', ['List', 'b', 'c']])).toMatchInlineSnapshot(
      `'\\lbrack a,\\lbrack b,c\\rbrack\\rbrack'`
    );
  });
});
