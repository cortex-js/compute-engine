import { engine as ce } from '../utils';

function parse(s: string) {
  return ce.parse(s);
}

describe('basic', () => {
  test('LaTex Syntax Errors', () => {
    expect(parse('\\frac')).toMatchInlineSnapshot(
      `["Divide", ["Error", "'missing'"], ["Error", "'missing'"]]`
    );
    expect(parse('\\frac{')).toMatchInlineSnapshot(`
      [
        "Divide",
        ["Error", "'expected-closing-delimiter'", ["LatexString", "'{'"]],
        ["Error", "'missing'"]
      ]
    `);
    expect(parse('\\frac{{')).toMatchInlineSnapshot(`
      [
        "Divide",
        ["Error", "'expected-closing-delimiter'", ["LatexString", "'{'"]],
        ["Error", "'missing'"]
      ]
    `);
    expect(parse('\\frac{}}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        ["Divide", ["Error", "'missing'"], ["Error", "'missing'"]],
        ["Error", "'unexpected-closing-delimiter'", ["LatexString", "'}'"]]
      ]
    `);
    expect(parse('\\frac{1}}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        ["Divide", 1, ["Error", "'missing'"]],
        ["Error", "'unexpected-closing-delimiter'", ["LatexString", "'}'"]]
      ]
    `);
    expect(parse('\\frac{1}{2')).toMatchInlineSnapshot(`
      [
        "Divide",
        1,
        [
          "Tuple",
          2,
          ["Error", "'expected-closing-delimiter'", ["LatexString", "'{2'"]]
        ]
      ]
    `);
    expect(parse('\\sqrt{}')).toMatchInlineSnapshot(
      `["Sqrt", ["Error", "'missing'"]]`
    );
    expect(parse('\\sqrt{}{}')).toMatchInlineSnapshot(
      `["Sqrt", ["Error", "'missing'"]]`
    );
    expect(parse('\\sqrt')).toMatchInlineSnapshot(
      `["Sqrt", ["Error", "'missing'"]]`
    );
  });

  test('Semantic Errors', () => {
    expect(parse('1+')).toMatchInlineSnapshot(`
      [
        "Sequence",
        1,
        ["Error", "'unexpected-operator'", ["LatexString", "'+'"]]
      ]
    `);
    expect(parse('1\\times')).toMatchInlineSnapshot(
      `["Multiply", 1, ["Error", "'missing'"]]`
    );
    expect(parse('\\times')).toMatchInlineSnapshot(`
      [
        "Multiply",
        ["Error", "'missing'", ["LatexString", "'\\times'"]],
        ["Error", "'missing'"]
      ]
    `);
    expect(parse('\\times3')).toMatchInlineSnapshot(
      `["Multiply", ["Error", "'missing'", ["LatexString", "'\\times'"]], 3]`
    );
    expect(parse('2*')).toMatchInlineSnapshot(
      `["Multiply", 2, ["Error", "'missing'"]]`
    );
    expect(parse('\\frac{}{}')).toMatchInlineSnapshot(
      `["Divide", ["Error", "'missing'"], ["Error", "'missing'"]]`
    );
    expect(parse('\\frac{1}{}')).toMatchInlineSnapshot(
      `["Divide", 1, ["Error", "'missing'"]]`
    );
    expect(parse('\\frac{}{2}')).toMatchInlineSnapshot(
      `["Divide", ["Error", "'missing'"], 2]`
    );

    expect(parse('=x')).toMatchInlineSnapshot(
      `["Equal", ["Error", "'missing'", ["LatexString", "'='"]], "x"]`
    );
  });

  test('Valid Incomplete', () => {
    expect(parse('x=')).toMatchInlineSnapshot(
      `["Equal", "x", ["Error", "'missing'"]]`
    );
    expect(parse('2 \\times 2 = ')).toMatchInlineSnapshot(
      `["Equal", ["Multiply", 2, 2], ["Error", "'missing'"]]`
    );
    expect(parse('x+1=')).toMatchInlineSnapshot(
      `["Equal", ["Add", "x", 1], ["Error", "'missing'"]]`
    );
    expect(parse('2+1\\le')).toMatchInlineSnapshot(
      `["LessEqual", ["Add", 1, 2], ["Error", "'missing'"]]`
    );
  });
});
