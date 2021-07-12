import { expression, expressionError } from '../utils';

describe('BASIC PARSING', () => {
  test('', () => {
    expect(expression('')).toMatchInlineSnapshot(`''`);
    expect(expression('1')).toMatchInlineSnapshot(`1`);
    expect(expression('2{xy}')).toMatchInlineSnapshot(
      `['Sequence', 2, ['Error', ['LatexString', {str: '{xy}'}], ''syntax-error'']]`
    ); // @todo: interpret as a group?
  });
});

describe('UNKNOWN COMMANDS', () => {
  test('Parse', () => {
    expect(expression('\\foo')).toMatchInlineSnapshot(
      `['Error', ['LatexString', {str: '\\foo'}], 'unknown-command']`
    );
    expect(expression('x=\\foo+1')).toMatchInlineSnapshot(
      `['Equal', ['Add', ['Error', ['LatexString', {str: '\\foo'}], 'unknown-command'], 1], 'x']`
    );
    expect(expression('x=\\foo   {1}  {x+1}+1')).toMatchInlineSnapshot(
      `['Sequence', ['Equal', ['Error', ['LatexString', {str: '\\foo{1}'}], 'unknown-command'], 'x'], ['Error', ['LatexString', {str: '{x+1}+1'}], ''syntax-error'']]`
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
