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
});
