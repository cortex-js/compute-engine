import { engine as ce } from '../../utils';

describe('SEMICOLON BLOCKS - PARSING', () => {
  test('Semicolon with assignment produces Block', () => {
    expect(ce.parse('a \\coloneq 5; a + 1')).toMatchInlineSnapshot(
      `["Block", ["Declare", "a"], ["Assign", "a", 5], ["Add", "a", 1]]`
    );
  });

  test('Multiple assignments in semicolon block', () => {
    expect(
      ce.parse('a \\coloneq 1; b \\coloneq 2; a + b')
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "a"],
        ["Assign", "a", 1],
        ["Declare", "b"],
        ["Assign", "b", 2],
        ["Add", "a", "b"]
      ]
    `);
  });

  test('Plain semicolons without assignment stay as Triple (backward compat)', () => {
    expect(ce.parse('1; 2; 3')).toMatchInlineSnapshot(`["Triple", 1, 2, 3]`);
  });

  test('Single assignment with semicolon', () => {
    expect(ce.parse('x \\coloneq 10; x^2')).toMatchInlineSnapshot(
      `["Block", ["Declare", "x"], ["Assign", "x", 10], ["Square", "x"]]`
    );
  });

  test('Semicolon + \\; (thin space) is treated same as plain semicolon', () => {
    // Gap #5 sub-issue A: ;\; should not produce Nothing in the parse tree
    expect(ce.parse('a \\coloneq x^2;\\; (a+1)')).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "a"],
        ["Assign", "a", ["Square", "x"]],
        ["Add", "a", 1]
      ]
    `);
  });

  test('Multiple semicolons with \\; spacing', () => {
    expect(
      ce.parse('a \\coloneq 1;\\; b \\coloneq 2;\\; a + b')
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "a"],
        ["Assign", "a", 1],
        ["Declare", "b"],
        ["Assign", "b", 2],
        ["Add", "a", "b"]
      ]
    `);
  });

  test('Subscripted variable names in blocks are treated as compound symbols', () => {
    // Req #10: r_1 \coloneq expr should create a local variable named "r_1"
    const expr = ce.parse('r_1 \\coloneq x^2 + y^2; \\frac{1}{r_1}');
    expect(expr.isValid).toBe(true);
    // r_1 should be a compound symbol, not a Subscript expression
    const json = JSON.stringify(expr.json);
    expect(json).toContain('"r_1"');
    expect(json).not.toContain('"Subscript"');
    expect(json).toContain('"Declare"');
    expect(json).toContain('"Assign"');
  });

  test('Subscripted variable with where clause', () => {
    const expr = ce.parse(
      '\\frac{1}{r_1} \\text{ where } r_1 \\coloneq \\sqrt{x^2 + y^2}'
    );
    expect(expr.isValid).toBe(true);
    // r_1 should appear as a compound symbol, not Subscript
    expect(JSON.stringify(expr.json)).toContain('"r_1"');
    expect(JSON.stringify(expr.json)).not.toContain('"Subscript"');
  });

  test('Semicolon block with \\; produces valid expression', () => {
    const expr = ce.parse('a \\coloneq x^2;\\; (a+1)');
    expect(expr.isValid).toBe(true);
    // Should not contain Nothing or InvisibleOperator
    expect(JSON.stringify(expr.json)).not.toContain('Nothing');
    expect(JSON.stringify(expr.json)).not.toContain('InvisibleOperator');
  });
});
