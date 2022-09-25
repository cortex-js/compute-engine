import { parse } from '../../utils';

describe('BASIC PARSING', () => {
  test('', () => {
    expect(parse('')).toMatchInlineSnapshot(`'"Nothing"'`);
    expect(parse('1')).toMatchInlineSnapshot(`'1'`);
    expect(parse('2{xy}')).toMatchInlineSnapshot(`'["Multiply", 2, "x", "y"]'`);
  });
});

describe('ADVANCED PARSING', () => {
  // Empty argument should not be interpreted as space group when argument is
  // expected
  test('\\frac{x}{} y', () =>
    expect(parse('\\frac{x}{} \\text{ cm}')).toMatchInlineSnapshot(
      `'["Multiply", ["Divide", "x", ["Error", "'missing'"]], "' cm'"]'`
    ));
});

describe('UNKNOWN COMMANDS', () => {
  test('Parse', () => {
    expect(parse('\\foo')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\\\foo'"],
        ["Latex", "'\\\\foo'"]
      ]'
    `);
    expect(parse('x=\\foo+1')).toMatchInlineSnapshot(`
      '[
        "Equal",
        "x",
        [
          "Add",
          [
            "Error",
            ["ErrorCode", "'unexpected-command'", "'\\\\foo'"],
            ["Latex", "'\\\\foo'"]
          ],
          1
        ]
      ]'
    `);
    expect(parse('x=\\foo   {1}  {x+1}+1')).toMatchInlineSnapshot(`
      '[
        "Add",
        [
          "Multiply",
          [
            "Equal",
            "x",
            [
              "Error",
              ["ErrorCode", "'unexpected-command'", "'\\\\foo'"],
              ["Latex", "'\\\\foo{1}'"]
            ]
          ],
          ["Add", "x", 1]
        ],
        1
      ]'
    `);
  });
});
