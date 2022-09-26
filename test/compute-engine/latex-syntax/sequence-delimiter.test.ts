import { parse } from '../../utils';

describe('SEQUENCES AND DELIMITERS', () => {
  test('Valid groups', () => {
    expect(parse('(a+b)')).toMatchInlineSnapshot(
      `'["Delimiter", ["Add", "a", "b"]]'`
    );
    expect(parse('-(a+b)')).toMatchInlineSnapshot(
      `'["Negate", ["Delimiter", ["Add", "a", "b"]]]'`
    );
    expect(parse('(a+(c+d))')).toMatchInlineSnapshot(
      `'["Delimiter", ["Add", "a", ["Delimiter", ["Add", "c", "d"]]]]'`
    );
    expect(parse('(a\\times(c\\times d))')).toMatchInlineSnapshot(
      `'["Delimiter", ["Multiply", "a", ["Delimiter", ["Multiply", "c", "d"]]]]'`
    );
    expect(parse('(a\\times(c+d))')).toMatchInlineSnapshot(
      `'["Delimiter", ["Multiply", "a", ["Delimiter", ["Add", "c", "d"]]]]'`
    );
    // Sequence with empty element
    expect(parse('(a,,b)')).toMatchInlineSnapshot(
      `'["Delimiter", ["Sequence", "a", "Null", "b"]]'`
    );
  });
  test('Groups', () => {
    expect(parse('(a, b, c)')).toMatchInlineSnapshot(
      `'["Delimiter", ["Sequence", "a", "b", "c"]]'`
    );
    expect(parse('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(`
      '[
        "Delimiter",
        [
          "Sequence",
          "a",
          "b",
          "c",
          "d",
          [
            "Sequence",
            "Sequence",
            ["Error", "'missing'", ["Latex", "';'"]],
            "Sequence",
            ["Error", "'missing'", ["Latex", "';'"]],
            "n",
            "Null",
            "m"
          ]
        ]
      ]'
    `);
    expect(parse('(a, (b, c))')).toMatchInlineSnapshot(
      `'["Delimiter", ["Sequence", "a", ["Delimiter", ["Sequence", "b", "c"]]]]'`
    );
    expect(parse('(a, (b; c))')).toMatchInlineSnapshot(`
      '[
        "Delimiter",
        [
          "Sequence",
          "a",
          ["Delimiter", ["Sequence", "Sequence", "b", "Sequence", "c"]]
        ]
      ]'
    `);
  });
  test('Sequences', () => {
    expect(parse('a, b, c')).toMatchInlineSnapshot(
      `'["Sequence", "a", "b", "c"]'`
    );
    // Sequence with missing element
    expect(parse('a,, c')).toMatchInlineSnapshot(
      `'["Sequence", "a", "Null", "c"]'`
    );
    // Sequence with missing final element
    expect(parse('a,c,')).toMatchInlineSnapshot(
      `'["Sequence", "a", "c", "Null"]'`
    );
    // Sequence with missing initial element
    expect(parse(',c,b')).toMatchInlineSnapshot(
      `'["Sequence", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]'`
    );
  });
  test('Subsequences', () => {
    expect(parse('a,b;c,d,e;f;g,h')).toMatchInlineSnapshot(`
      '[
        "Sequence",
        "a",
        "b",
        "c",
        "d",
        "ExponentialE",
        "Sequence",
        "f",
        "g",
        "h"
      ]'
    `);
    expect(parse(';;a;')).toMatchInlineSnapshot(`
      '[
        "Sequence",
        "Sequence",
        ["Error", "'missing'", ["Latex", "';'"]],
        "Sequence",
        ["Error", "'missing'", ["Latex", "';'"]],
        "Sequence",
        "a",
        "Null"
      ]'
    `);
  });
});
