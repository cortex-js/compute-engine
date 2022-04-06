import { parse, expressionError } from '../../utils';

describe('BASIC PARSING', () => {
  test('', () => {
    expect(parse('')).toMatchInlineSnapshot(`'"Nothing"'`);
    expect(parse('1')).toMatchInlineSnapshot(`'1'`);
    expect(parse('2{xy}')).toMatchInlineSnapshot(`'["Multiply", 2, "x", "y"]'`);
  });
});

describe('UNKNOWN COMMANDS', () => {
  test('Parse', () => {
    expect(parse('\\foo')).toMatchInlineSnapshot(
      `'["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\\\foo'"]]'`
    );
    expect(parse('x=\\foo+1')).toMatchInlineSnapshot(`
      '[
        "Equal",
        "x",
        [
          "Add",
          ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\\\foo'"]],
          1
        ]
      ]'
    `);
    expect(parse('x=\\foo   {1}  {x+1}+1')).toMatchInlineSnapshot(`
      '[
        "Error",
        [
          "Equal",
          "x",
          [
            "Error",
            "Missing",
            "'unknown-command'",
            ["LatexForm", "'\\\\foo{1}'"]
          ]
        ],
        "'syntax-error'",
        ["LatexForm", "'{x+1}+1'"]
      ]'
    `);
  });
  test('Errors', () => {
    expect(expressionError('\\foo')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('x=\\foo+1')).toMatchInlineSnapshot(`[]`);
    expect(expressionError('x=\\foo   {1}  {x+1}+1')).toMatchInlineSnapshot(
      `[]`
    );
  });
});
