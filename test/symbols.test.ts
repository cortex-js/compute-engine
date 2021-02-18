import { expression, expressionError, printExpression } from './utils';

beforeEach(() => {
  jest.spyOn(console, 'assert').mockImplementation((assertion) => {
    if (!assertion) debugger;
  });
  jest.spyOn(console, 'log').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'warn').mockImplementation(() => {
    debugger;
  });
  jest.spyOn(console, 'info').mockImplementation(() => {
    debugger;
  });
});
expect.addSnapshotSerializer({
  // test: (val): boolean => Array.isArray(val) || typeof val === 'object',
  test: (_val): boolean => true,

  serialize: (val, _config, _indentation, _depth, _refs, _printer): string => {
    return printExpression(val);
  },
});

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
  test('Latex concatenation', () => {
    // Letter following command
    expect(expression('\\alpha b')).toMatchInlineSnapshot(
      `['Multiply', 'b', 'α']`
    );
  });
  test('Errors', () => {
    expect(expressionError('=')).toMatchInlineSnapshot(`'syntax-error'`);
    expect(expressionError('x_5')).toMatchInlineSnapshot(`[]`);
  });
});
