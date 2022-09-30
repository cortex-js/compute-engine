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
      `'["Delimiter", ["List", "a", "Nothing", "b"]]'`
    );
  });
  test('Groups', () => {
    expect(parse('(a, b, c)')).toMatchInlineSnapshot(
      `'["Delimiter", ["List", "a", "b", "c"]]'`
    );
    // @todo
    expect(parse('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(`
      '[
        "Delimiter",
        [
          "List",
          "List",
          ["List", "a", "b"],
          "List",
          [
            "List",
            "c",
            "d",
            [
              "Sequence",
              "List",
              ["Error", "'missing'", ["Latex", "';'"]],
              "List",
              ["Error", "'missing'", ["Latex", "';'"]],
              "List",
              ["List", "n", "Nothing", "m"]
            ]
          ]
        ]
      ]'
    `);
    expect(parse('(a, (b, c))')).toMatchInlineSnapshot(
      `'["Delimiter", ["List", "a", ["Delimiter", ["List", "b", "c"]]]]'`
    );
    expect(parse('(a, (b; c))')).toMatchInlineSnapshot(`
      '[
        "Delimiter",
        ["List", "a", ["Delimiter", ["List", "List", "b", "List", "c"]]]
      ]'
    `);
  });
  test('Sequences', () => {
    expect(parse('a, b, c')).toMatchInlineSnapshot(`'["List", "a", "b", "c"]'`);
    // Sequence with missing element
    expect(parse('a,, c')).toMatchInlineSnapshot(
      `'["List", "a", "Nothing", "c"]'`
    );
    // Sequence with missing final element
    expect(parse('a,c,')).toMatchInlineSnapshot(
      `'["List", "a", "c", "Nothing"]'`
    );
    // Sequence with missing initial element
    expect(parse(',c,b')).toMatchInlineSnapshot(
      `'["List", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]'`
    );
  });
  test('Subsequences', () => {
    expect(parse('a,b;c,d,e;f;g,h')).toMatchInlineSnapshot(`
      '[
        "Sequence",
        "List",
        ["List", "a", "b"],
        "List",
        ["List", "c", "d", "ExponentialE"],
        "List",
        "f",
        "List",
        ["List", "g", "h"]
      ]'
    `);
    // @todo
    expect(parse(';;a;')).toMatchInlineSnapshot(`
      '[
        "Sequence",
        "List",
        ["Error", "'missing'", ["Latex", "';'"]],
        "List",
        ["Error", "'missing'", ["Latex", "';'"]],
        "List",
        "a",
        "Nothing"
      ]'
    `);
  });
});
