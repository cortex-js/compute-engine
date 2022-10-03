import { parse, expressionError } from '../../utils';

describe('SYMBOLS', () => {
  test('Basic', () => {
    expect(parse('x')).toMatch('x');
    expect(parse('\\alpha')).toMatchInlineSnapshot(`Alpha`);
    expect(parse('x\\alpha\\beta')).toMatchInlineSnapshot(
      `["Multiply", "x", "Alpha", "Beta"]`
    );
    expect(parse('x \\beta \\alpha ')).toMatchInlineSnapshot(
      `["Multiply", "x", "Beta", "Alpha"]`
    );
    expect(parse('\\foo')).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\foo'"],
        ["Latex", "'\\foo'"]
      ]
    `);
  });
  test('Symbol expressions', () => {
    expect(parse('2x')).toMatch('["Multiply", 2, "x"]');
    expect(parse('2x^3')).toMatchInlineSnapshot(
      `["Multiply", 2, ["Power", "x", 3]]`
    );
  });
  test('LaTeX concatenation', () => {
    // Letter following command
    expect(parse('\\alpha b')).toMatchInlineSnapshot(
      `["Multiply", "Alpha", "b"]`
    );
  });
  test('Errors', () => {
    expect(expressionError('=')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('x_5')).toMatchInlineSnapshot(`[]`);
  });
});
