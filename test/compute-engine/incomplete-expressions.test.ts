import { ComputeEngine } from '../../src/compute-engine';
import { parse } from '../utils';
export const ce = new ComputeEngine();

// function parse(s: string): Expression {
//   return parse(s).json;
// }

describe('basic', () => {
  test('LaTex Syntax Errors', () => {
    expect(parse('\\frac')).toMatchInlineSnapshot(
      `["Divide", ["Error", "'missing'"], ["Error", "'missing'"]]`
    );
    expect(parse('\\frac{')).toMatchInlineSnapshot(`
      [
        "Divide",
        ["Error", "'expected-closing-delimiter'", ["Latex", "''"]],
        ["Error", "'missing'"]
      ]
    `);
    expect(parse('\\frac{{')).toMatchInlineSnapshot(`
      [
        "Divide",
        ["Error", "'expected-closing-delimiter'", ["Latex", "'{'"]],
        ["Error", "'missing'"]
      ]
    `);
    expect(parse('\\frac{}}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Divide", ["Error", "'missing'"], ["Error", "'missing'"]],
        ["Error", "'unexpected-closing-delimiter'", ["Latex", "'}'"]]
      ]
    `);
    expect(parse('\\frac{1}}')).toMatchInlineSnapshot(`
      [
        "Sequence",
        ["Divide", 1, ["Error", "'missing'"]],
        ["Error", "'unexpected-closing-delimiter'", ["Latex", "'}'"]]
      ]
    `);
    expect(parse('\\frac{1}{2')).toMatchInlineSnapshot(`
      [
        "Divide",
        1,
        ["Error", "'expected-closing-delimiter'", ["Latex", "'2'"]]
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
    expect(parse('1+')).toMatchInlineSnapshot(
      `["Add", 1, ["Error", "'missing'", ["Latex", "'+'"]]]`
    );
    expect(parse('1\\times')).toMatchInlineSnapshot(
      `["Multiply", 1, ["Error", "'missing'"]]`
    );
    expect(parse('\\times')).toMatchInlineSnapshot(`
      [
        "Multiply",
        ["Error", "'missing'", ["Latex", "'\\times'"]],
        ["Error", "'missing'"]
      ]
    `);
    expect(parse('\\times3')).toMatchInlineSnapshot(
      `["Multiply", ["Error", "'missing'", ["Latex", "'\\times'"]], 3]`
    );
    expect(parse('2*')).toMatchInlineSnapshot(`
      [
        "Sequence",
        2,
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'*'"],
          ["Latex", "'*'"]
        ]
      ]
    `);
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
      `["Equal", ["Error", "'missing'", ["Latex", "'='"]], "x"]`
    );
  });

  test('Valid Incomplete', () => {
    expect(parse('x=')).toMatchInlineSnapshot(
      `["Equal", "x", ["Error", "'missing'"]]`
    );
    expect(parse('2 \\times 2 = ')).toMatchInlineSnapshot(
      `["Equal", 4, ["Error", "'missing'"]]`
    );
    expect(parse('x+1=')).toMatchInlineSnapshot(
      `["Equal", ["Add", 1, "x"], ["Error", "'missing'"]]`
    );
    expect(parse('2+1\\le')).toMatchInlineSnapshot(
      `["LessEqual", ["Add", 1, 2], ["Error", "'missing'"]]`
    );
  });
});
