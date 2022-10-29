import { check } from '../../utils';

describe('SEQUENCES AND DELIMITERS', () => {
  test('Valid groups', () => {
    expect(check('(a+b)')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Add", "a", "b"]]
      box       = ["Add", "a", "b"]
      N-auto    = ["Add", 0, "a", "b"]
    `);
    expect(check('-(a+b)')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Delimiter", ["Add", "a", "b"]]]
      box       = ["Subtract", ["Negate", "b"], "a"]
      N-auto    = ["Add", 0, ["Negate", "a"], ["Negate", "b"]]
    `);
    expect(check('(a+(c+d))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Add", "a", ["Delimiter", ["Add", "c", "d"]]]]
      box       = ["Add", "a", "c", "d"]
      N-auto    = ["Add", 0, "a", "c", "d"]
    `);
    expect(check('(a\\times(c\\times d))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Multiply", "c", "d"]]]]
      box       = ["Multiply", "a", "c", "d"]
      N-auto    = ["Multiply", 1, "a", "c", "d"]
    `);
    expect(check('(a\\times(c+d))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Add", "c", "d"]]]]
      box       = ["Multiply", "a", ["Add", "c", "d"]]
      N-auto    = ["Multiply", 1, "a", ["Add", 0, "c", "d"]]
    `);
    // Sequence with empty element
    expect(check('(a,,b)')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["List", "a", "Nothing", "b"]]
      ["List", "a", "Nothing", "b"]
    `);
  });
  test('Groups', () => {
    expect(check('(a, b, c)')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["List", "a", "b", "c"]]
      ["List", "a", "b", "c"]
    `);
    // @fixme
    expect(check('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(`
      latex     = [
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
      ]
      [
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
      ]
    `);
    expect(check('(a, (b, c))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["List", "a", ["Delimiter", ["List", "b", "c"]]]]
      ["List", "a", ["List", "b", "c"]]
    `);
    expect(check('(a, (b; c))')).toMatchInlineSnapshot(`
      latex     = [
        "Delimiter",
        ["List", "a", ["Delimiter", ["List", "List", "b", "List", "c"]]]
      ]
      ["List", "a", ["List", "List", "b", "List", "c"]]
    `);
  });
  test('Sequences', () => {
    expect(check('a, b, c')).toMatchInlineSnapshot(`
      latex     = ["List", "a", "b", "c"]
      ["List", "a", "b", "c"]
    `);
    // Sequence with missing element
    expect(check('a,, c')).toMatchInlineSnapshot(`
      latex     = ["List", "a", "Nothing", "c"]
      ["List", "a", "Nothing", "c"]
    `);
    // Sequence with missing final element
    expect(check('a,c,')).toMatchInlineSnapshot(`
      latex     = ["List", "a", "c", "Nothing"]
      ["List", "a", "c", "Nothing"]
    `);
    // Sequence with missing initial element
    expect(check(',c,b')).toMatchInlineSnapshot(`
      latex     = ["List", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]
      ["List", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]
    `);
  });
  test('Subsequences', () => {
    expect(check('a,b;c,d,e;f;g,h')).toMatchInlineSnapshot(`
      latex     = [
        "Sequence",
        "List",
        ["List", "a", "b"],
        "List",
        ["List", "c", "d", "ExponentialE"],
        "List",
        "f",
        "List",
        ["List", "g", "h"]
      ]
      [
        "Sequence",
        "List",
        ["List", "a", "b"],
        "List",
        ["List", "c", "d", "ExponentialE"],
        "List",
        "f",
        "List",
        ["List", "g", "h"]
      ]
    `);
    // @fixme
    expect(check(';;a;')).toMatchInlineSnapshot(`
      latex     = [
        "Sequence",
        "List",
        ["Error", "'missing'", ["Latex", "';'"]],
        "List",
        ["Error", "'missing'", ["Latex", "';'"]],
        "List",
        "a",
        "Nothing"
      ]
      [
        "Sequence",
        "List",
        ["Error", "'missing'", ["Latex", "';'"]],
        "List",
        ["Error", "'missing'", ["Latex", "';'"]],
        "List",
        "a",
        "Nothing"
      ]
    `);
  });
});
