import { ComputeEngine } from '../../src/compute-engine';
import { parse } from '../utils';
export const ce = new ComputeEngine();

// function parse(s: string): Expression {
//   return parse(s).json;
// }

describe('basic', () => {
  test('LaTex Syntax Errors', () => {
    expect(parse('\\frac')).toMatchInlineSnapshot(
      `'["Divide", "Missing", "Missing"]'`
    );
    expect(parse('\\frac{')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Divide", "Missing", "Missing"],
        "'syntax-error'",
        ["LatexForm", "'{'"]
      ]'
    `);
    expect(parse('\\frac{{')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Divide", "Missing", "Missing"],
        "'syntax-error'",
        ["LatexForm", "'{{'"]
      ]'
    `);
    expect(parse('\\frac{}}')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Divide", "Missing", "Missing"],
        "'syntax-error'",
        ["LatexForm", "'}'"]
      ]'
    `);
    expect(parse('\\frac{1}}')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Divide", 1, "Missing"],
        "'syntax-error'",
        ["LatexForm", "'}'"]
      ]'
    `);
    expect(parse('\\frac{1}{2')).toMatchInlineSnapshot(
      `'["Multiply", ["Divide", 1, "Missing"], 2]'`
    );
    expect(parse('\\sqrt{}')).toMatchInlineSnapshot(`'["Sqrt", "Missing"]'`);
    expect(parse('\\sqrt{}{}')).toMatchInlineSnapshot(`'["Sqrt", "Missing"]'`);
    expect(parse('\\sqrt')).toMatchInlineSnapshot(`'["Sqrt", "Missing"]'`);
  });

  test('Semantic Errors', () => {
    expect(parse('1+')).toMatchInlineSnapshot(
      `'["Error", 1, "'syntax-error'", ["LatexForm", "'+'"]]'`
    );
    expect(parse('1\\times')).toMatchInlineSnapshot(
      `'["Multiply", 1, "Missing"]'`
    );
    expect(parse('\\times')).toMatchInlineSnapshot(
      `'["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\\\times'"]]'`
    );
    expect(parse('\\times3')).toMatchInlineSnapshot(`
      '[
        "Error",
        ["Error", "Missing", "'unknown-command'", ["LatexForm", "'\\\\times'"]],
        "'syntax-error'",
        ["LatexForm", "'3'"]
      ]'
    `);
    expect(parse('2*')).toMatchInlineSnapshot(
      `'["Error", 2, "'syntax-error'", ["LatexForm", "'*'"]]'`
    );
    expect(parse('\\frac{}{}')).toMatchInlineSnapshot(
      `'["Divide", "Missing", "Missing"]'`
    );
    expect(parse('\\frac{1}{}')).toMatchInlineSnapshot(
      `'["Divide", 1, "Missing"]'`
    );
    expect(parse('\\frac{}{2}')).toMatchInlineSnapshot(
      `'["Divide", 2, "Missing"]'`
    );

    expect(parse('=x')).toMatchInlineSnapshot(
      `'["Error", "Nothing", "'syntax-error'", ["LatexForm", "'=x'"]]'`
    );
  });

  test('Valid Incomplete', () => {
    expect(parse('x=')).toMatchInlineSnapshot(`'["Equal", "x", "Missing"]'`);
    expect(parse('2 \\times 2 = ')).toMatchInlineSnapshot(
      `'["Equal", ["Multiply", 2, 2], "Missing"]'`
    );
    expect(parse('x+1=')).toMatchInlineSnapshot(
      `'["Equal", ["Add", "x", 1], "Missing"]'`
    );
    expect(parse('2+1\\le')).toMatchInlineSnapshot(
      `'["LessEqual", ["Add", 2, 1], "Missing"]'`
    );
  });
});
