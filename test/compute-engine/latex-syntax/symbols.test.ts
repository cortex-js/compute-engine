import { parse, expressionError } from '../../utils';

describe('SYMBOLS', () => {
  test('Basic', () => {
    expect(parse('x')).toMatch('x');
    expect(parse('\\alpha')).toMatchInlineSnapshot(`Alpha`);
    expect(parse('x\\alpha\\beta')).toMatchInlineSnapshot(
      `["Multiply", "Alpha", "Beta", "x"]`
    );
    expect(parse('x \\beta \\alpha ')).toMatchInlineSnapshot(
      `["Multiply", "Alpha", "Beta", "x"]`
    );
    expect(parse('\\foo')).toMatchInlineSnapshot(`
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\foo'"],
        ["Latex", "'\\foo'"]
      ]
    `);
  });

  test('Multichar symbols', () => {
    expect(parse('\\mathrm{Speed}')).toMatchInlineSnapshot(`Speed`);
    expect(parse('\\mathit{Speed}')).toMatchInlineSnapshot(`Speed`);
    expect(parse('\\operatorname{Besel}')).toMatchInlineSnapshot(`Besel`);
    expect(parse('V_1')).toMatchInlineSnapshot(`V_1`);
    expect(parse('V_{10}')).toMatchInlineSnapshot(`V_10`);
    expect(parse('V_{\\alpha}')).toMatchInlineSnapshot(`V_Alpha`);
    expect(parse('V_{\\mathrm{max}}')).toMatchInlineSnapshot(`V_max`);
    expect(parse('\\mathrm{V_1}')).toMatchInlineSnapshot(`V_1`);
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
