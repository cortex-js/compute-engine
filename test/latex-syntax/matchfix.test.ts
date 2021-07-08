import { expression, latex, expressionError } from '../utils';

describe('MATCHFIX', () => {
  test('Parse valid matchfix', () => {
    expect(expression('\\lbrack\\rbrack')).toMatchInlineSnapshot(
      `['Sequence', ['Error', ['LatexString', {str: '\\lbrack'}], 'unknown-command'], ['Error', ['LatexString', {str: '\\rbrack'}], ''syntax-error'']]`
    );
    expect(expression('\\lbrack a\\rbrack')).toMatchInlineSnapshot(
      `['Sequence', ['Error', ['LatexString', {str: '\\lbrack'}], 'unknown-command'], ['Error', ['LatexString', {str: 'a\\rbrack'}], ''syntax-error'']]`
    );
    expect(expression('\\lbrack a, b\\rbrack')).toMatchInlineSnapshot(
      `['Sequence', ['Error', ['LatexString', {str: '\\lbrack'}], 'unknown-command'], ['Error', ['LatexString', {str: 'a, b\\rbrack'}], ''syntax-error'']]`
    );
    expect(
      expression('\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
    ).toMatchInlineSnapshot(
      `['Sequence', ['Error', ['LatexString', {str: '\\lbrack'}], 'unknown-command'], ['Error', ['LatexString', {str: 'a, \\lbrack b, c\\rbrack\\rbrack'}], ''syntax-error'']]`
    );
    expect(
      expression('\\sin\\lbrack a, \\lbrack b, c\\rbrack\\rbrack')
    ).toMatchInlineSnapshot(
      `['Sequence', ['Sin', ['Error', ['LatexString', {str: '\\lbrack'}], 'unknown-command']], ['Error', ['LatexString', {str: 'a, \\lbrack b, c\\rbrack\\rbrack'}], ''syntax-error'']]`
    ); // @todo
  });
  test('Serialize valid matchfix', () => {
    expect(latex(['List'])).toMatchInlineSnapshot(`'\\operatorname{List}()'`);
    expect(latex(['List', 'a'])).toMatchInlineSnapshot(
      `'\\operatorname{List}(a)'`
    );
    expect(latex(['List', 'a', 'b'])).toMatchInlineSnapshot(
      `'\\operatorname{List}(a, b)'`
    );
    expect(latex(['List', 'a', ['List', 'b', 'c']])).toMatchInlineSnapshot(
      `'\\operatorname{List}(a, \\operatorname{List}(b, c))'`
    );
  });

  test('Parse prefixed matchfix', () => {
    // A given matchfix operators has automatic synonyms:
    // () -> \left(\right)
    //    -> \bigl(\bigr)
    //    -> \lparen\rparen
    //    -> etc...

    expect(expression(`(a, b, c)`)).toMatchInlineSnapshot(
      `['Delimiter', 'a', 'b', 'c']`
    );
    expect(expression(`\\left(a, b, c\\right)`)).toMatchInlineSnapshot(
      `['Delimiter', 'a', 'b', 'c']`
    );
    expect(expression(`\\bigl(a, b, c\\bigr)`)).toMatchInlineSnapshot(
      `['Delimiter', 'a', 'b', 'c']`
    );
    expect(expression(`\\big(a, b, c\\big)`)).toMatchInlineSnapshot(
      `['Delimiter', 'a', 'b', 'c']`
    );
    expect(expression(`\\lparen a, b, c\\rparen)`)).toMatchInlineSnapshot(
      `['Sequence', ['Delimiter', 'a', 'b', 'c'], ['Error', ['LatexString', {str: ')'}], ''syntax-error'']]`
    );
    expect(
      expression(`\\left\\lparen a, b, c\\right\\rparen)`)
    ).toMatchInlineSnapshot(
      `['Sequence', ['Delimiter', 'a', 'b', 'c'], ['Error', ['LatexString', {str: ')'}], ''syntax-error'']]`
    );
  });
});

test('Absolute value & Norm', () => {
  expect(expression('1+|a|+2')).toMatchInlineSnapshot(
    `['Sequence', 1, ['Error', ['LatexString', {str: '+|a|+2'}], ''syntax-error'']]`
  );
  expect(expression('|(1+|a|+2)|')).toMatchInlineSnapshot(
    `['Error', ['LatexString', {str: '|(1+|a|+2)|'}], ''syntax-error'']`
  ); // @todo
  expect(expression('|1+|a|+2|')).toMatchInlineSnapshot(
    `['Error', ['LatexString', {str: '|1+|a|+2|'}], ''syntax-error'']`
  );
  expect(expression('||a||')).toMatchInlineSnapshot(
    `['Error', ['LatexString', {str: '||a||'}], ''syntax-error'']`
  );
  expect(expression('||a||+|b|')).toMatchInlineSnapshot(
    `['Error', ['LatexString', {str: '||a||+|b|'}], ''syntax-error'']`
  );
});
test('Invalid groups', () => {
  expect(expression('(')).toMatchInlineSnapshot(
    `['Error', ['LatexString', {str: '('}], ''syntax-error'']`
  );
  expect(expression(')')).toMatchInlineSnapshot(
    `['Error', ['LatexString', {str: ')'}], ''syntax-error'']`
  );
  expect(expressionError('-(')).toMatchInlineSnapshot(`[]`);
});
