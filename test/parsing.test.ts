import { expression, expressionError } from './utils';

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
