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
        {
          fn: ["Error", "expected-closing-delimiter", ["LatexString", "{"]];
            sourceOffsets: [5, 6]
        },
        {fn: ["Error", "'missing'"]; sourceOffsets: [6, 6]}
      ]
    `);
    expect(parse('\\frac{{')).toMatchInlineSnapshot(`
      [
        "Divide",
        {
          fn: ["Error", "expected-closing-delimiter", ["LatexString", "{"]];
            sourceOffsets: [6, 7]
        },
        {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]}
      ]
    `);
    expect(parse('\\frac{}}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        [
          "Divide",
          {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]},
          {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]}
        ],
        {
          fn: ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]];
            sourceOffsets: [7, 8]
        }
      ]
    `);
    expect(parse('\\frac{1}}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        ["Divide", 1, {fn: ["Error", "'missing'"]; sourceOffsets: [8, 8]}],
        {
          fn: ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]];
            sourceOffsets: [8, 9]
        }
      ]
    `);
    expect(parse('\\frac{1}{2')).toMatchInlineSnapshot(`
      [
        "Divide",
        1,
        [
          "Tuple",
          2,
          {
            fn: ["Error", "expected-closing-delimiter", ["LatexString", "{2"]];
                sourceOffsets: [8, 10]
          }
        ]
      ]
    `);
    expect(parse('\\sqrt{}')).toMatchInlineSnapshot(
      `["Sqrt", {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]}]`
    );
    expect(parse('\\sqrt{}{}')).toMatchInlineSnapshot(
      `["Sqrt", {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]}]`
    );
    expect(parse('\\sqrt')).toMatchInlineSnapshot(
      `["Sqrt", {fn: ["Error", "'missing'"]; sourceOffsets: [5, 5]}]`
    );
  });

  test('Semantic Errors', () => {
    expect(parse('1+')).toMatchInlineSnapshot(`
      [
        "Sequence",
        1,
        {
          fn: ["Error", "unexpected-operator", ["LatexString", "+"]];
            sourceOffsets: [1, 2]
        }
      ]
    `);
    expect(parse('1\\times')).toMatchInlineSnapshot(
      `["Multiply", 1, ["Error", "'missing'"]]`
    );
    expect(parse('\\times')).toMatchInlineSnapshot(`
      {
        fn: ["Error", "unexpected-command", ["LatexString", "\\times"]];
        sourceOffsets: [0, 6]
      }
    `);
    expect(parse('\\times3')).toMatchInlineSnapshot(`
      [
        "Tuple",
        {
          fn: ["Error", "unexpected-command", ["LatexString", "\\times"]];
            sourceOffsets: [0, 6]
        },
        3
      ]
    `);
    expect(parse('2*')).toMatchInlineSnapshot(
      `["Multiply", 2, ["Error", "'missing'"]]`
    );
    expect(parse('\\frac{}{}')).toMatchInlineSnapshot(`
      [
        "Divide",
        {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]},
        {fn: ["Error", "'missing'"]; sourceOffsets: [9, 9]}
      ]
    `);
    expect(parse('\\frac{1}{}')).toMatchInlineSnapshot(
      `["Divide", 1, {fn: ["Error", "'missing'"]; sourceOffsets: [10, 10]}]`
    );
    expect(parse('\\frac{}{2}')).toMatchInlineSnapshot(
      `["Divide", {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]}, 2]`
    );

    expect(parse('=x')).toMatchInlineSnapshot(`
      [
        "Equal",
        {
          fn: ["Error", "'missing'", ["LatexString", "="]];
            sourceOffsets: [1, 1]
        },
        "x"
      ]
    `);
  });

  test('Valid Incomplete', () => {
    expect(parse('x=')).toMatchInlineSnapshot(
      `["Equal", "x", ["Error", "'missing'"]]`
    );
    expect(parse('2 \\times 2 = ')).toMatchInlineSnapshot(
      `["Equal", 4, ["Error", "'missing'"]]`
    );
    expect(parse('x+1=')).toMatchInlineSnapshot(
      `["Equal", ["Add", "x", 1], ["Error", "'missing'"]]`
    );
    expect(parse('2+1\\le')).toMatchInlineSnapshot(
      `["LessEqual", 3, ["Error", "'missing'"]]`
    );
  });
});
