import { engine as ce } from '../../utils';

describe('WHERE - PARSING', () => {
  test('Simple \\text{where} expression', () => {
    expect(
      ce.parse('x^2 \\text{ where } x \\coloneq 5')
    ).toMatchInlineSnapshot(
      `["Block", ["Declare", "x"], ["Assign", "x", 5], ["Square", "x"]]`
    );
  });

  test('Multiple bindings with comma', () => {
    expect(
      ce.parse('a + b \\text{ where } a \\coloneq 1, b \\coloneq 2')
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

  test('\\operatorname{where} variant', () => {
    expect(
      ce.parse('x^2 \\operatorname{where} x \\coloneq 5')
    ).toMatchInlineSnapshot(
      `["Block", ["Declare", "x"], ["Assign", "x", 5], ["Square", "x"]]`
    );
  });

  test('\\text{wherever} stays as text (not a keyword match)', () => {
    expect(ce.parse('\\text{wherever}')).toMatchInlineSnapshot(`'wherever'`);
  });

  test('\\text{where} without lhs is parsed as text', () => {
    expect(ce.parse('\\text{where}')).toMatchInlineSnapshot(`'where'`);
  });

  test('5 \\text{cm} still works (invisible multiply with text)', () => {
    // Regression: \text-triggered infix should not block invisible operator
    expect(ce.parse('5\\text{cm}')).toMatchInlineSnapshot(
      `["Quantity", 5, "cm"]`
    );
  });

  test('Visual spacing (\\;) between comma-separated bindings', () => {
    expect(
      ce.parse('x + y \\text{ where } a \\coloneq 1,\\; b \\coloneq 2')
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "a"],
        ["Assign", "a", 1],
        ["Declare", "b"],
        ["Assign", "b", 2],
        ["Add", "x", "y"]
      ]
    `);
  });

  test('Where with complex body', () => {
    expect(
      ce.parse('x^2 + y^2 \\text{ where } x \\coloneq 3, y \\coloneq 4')
    ).toMatchInlineSnapshot(`
      [
        "Block",
        ["Declare", "x"],
        ["Assign", "x", 3],
        ["Declare", "y"],
        ["Assign", "y", 4],
        ["Add", ["Square", "x"], ["Square", "y"]]
      ]
    `);
  });
});

describe('WHERE - EVALUATION', () => {
  test('Simple where expression evaluates', () => {
    expect(
      ce.parse('x^2 \\operatorname{where} x \\coloneq 5').evaluate().re
    ).toEqual(25);
  });

  test('Multiple bindings evaluate sequentially', () => {
    expect(
      ce
        .parse('b \\operatorname{where} a \\coloneq 5, b \\coloneq a + 1')
        .evaluate().re
    ).toEqual(6);
  });

  test('where-clause does not leak bindings to outer scope', () => {
    ce.pushScope();
    try {
      ce.assign('x', 100);
      // Inside the where-clause, x is shadowed to 7.
      expect(
        ce.parse('x \\operatorname{where} x \\coloneq 7').evaluate().re
      ).toEqual(7);
      // After the clause, outer x is unchanged.
      expect(ce.expr('x').evaluate().re).toEqual(100);
    } finally {
      ce.popScope();
    }
  });
});
