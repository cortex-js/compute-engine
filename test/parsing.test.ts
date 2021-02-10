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
describe('BASIC PARSING', () => {
  test('', () => {
    expect(expression('')).toMatchInlineSnapshot(`''`);
    expect(expression('1')).toMatchInlineSnapshot(`1`);
    expect(expression('2{xy}')).toMatchInlineSnapshot(`[2, 'syntax-error']`); // @todo: interpret as a group?
  });
});

describe('UNKNOWN COMMANDS', () => {
  test('Parse', () => {
    expect(expression('\\foo')).toMatchInlineSnapshot(`'\\foo'`);
    expect(expression('x=\\foo+1')).toMatchInlineSnapshot(
      `['Equal', 'x', ['Add', '\\foo', 1]]`
    );
    expect(expression('x=\\foo   {1}  {x+1}+1')).toMatchInlineSnapshot(
      `['Equal', 'x', ['Add', ['\\foo', 1, ['Add', 'x', 1]], 1]]`
    );
  });
  test('Errors', () => {
    expect(expressionError('\\foo')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('x=\\foo+1')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('x=\\foo   {1}  {x+1}+1')).toMatchInlineSnapshot(
      `[]`
    );
  });
});
