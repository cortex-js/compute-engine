import { expression, expressionError } from './utils';

describe('SYMBOLS', () => {
  test('Basic', () => {
    expect(expression('x')).toMatchInlineSnapshot(`'x'`);
    expect(expression('\\alpha')).toMatchInlineSnapshot(`'α'`);
    expect(expression('x\\alpha\\beta')).toMatchInlineSnapshot(
      `['Multiply', 'x', 'α', 'β']`
    );
    expect(expression('x \\beta \\alpha ')).toMatchInlineSnapshot(
      `['Multiply', 'x', 'α', 'β']`
    );
    // Unknown symbol is OK
    expect(expression('\\foo')).toMatchInlineSnapshot(`'\\foo'`);
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
      `['Multiply', 'b', 'α']`
    );
  });
  test('Errors', () => {
    expect(expressionError('=')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('x_5')).toMatchInlineSnapshot(`[]`);
  });
});
