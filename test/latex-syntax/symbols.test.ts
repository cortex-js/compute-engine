import { expression, expressionError } from '../utils';

describe('SYMBOLS', () => {
  test('Basic', () => {
    expect(expression('x')).toMatchInlineSnapshot(`'x'`);
    expect(expression('\\alpha')).toMatchInlineSnapshot(`'Alpha'`);
    expect(expression('x\\alpha\\beta')).toMatchInlineSnapshot(
      `['Sequence', 'x', ['Error', ['LatexString', {str: '\\alpha\\beta'}], ''syntax-error'']]`
    );
    expect(expression('x \\beta \\alpha ')).toMatchInlineSnapshot(
      `['Sequence', 'x', ['Error', ['LatexString', {str: '\\beta\\alpha'}], ''syntax-error'']]`
    );
    // Unknown symbol is OK
    expect(expression('\\foo')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '\\foo'}], 'unknown-command']`
    );
  });
  test('Symbol expressions', () => {
    expect(expression('2x')).toMatchInlineSnapshot(`['Multiply', 2, 'x']`);
    expect(expression('2x^3')).toMatchInlineSnapshot(
      `['Multiply', 2, ['Power', 'x', 3]]`
    );
  });
  test('LaTeX concatenation', () => {
    // Letter following command
    expect(expression('\\alpha b')).toMatchInlineSnapshot(
      `['Sequence', 'Alpha', ['Error', ['LatexString', {str: 'b'}], ''syntax-error'']]`
    );
  });
  test('Errors', () => {
    expect(expressionError('=')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('x_5')).toMatchInlineSnapshot(`[]`);
  });
});
