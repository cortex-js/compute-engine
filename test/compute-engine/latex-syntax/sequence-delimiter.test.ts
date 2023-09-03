import { check } from '../../utils';

describe('SEQUENCES AND DELIMITERS', () => {
  test('Valid groups', () => {
    expect(check('(a+b)')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Add", "a", "b"]]
      ["Add", "a", "b"]
    `);
    expect(check('-(a+b)')).toMatchInlineSnapshot(`
      latex     = ["Negate", ["Delimiter", ["Add", "a", "b"]]]
      ["Subtract", ["Negate", "b"], "a"]
    `);
    expect(check('(a+(c+d))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Add", "a", ["Delimiter", ["Add", "c", "d"]]]]
      ["Add", "a", "c", "d"]
    `);
    expect(check('(a\\times(c\\times d))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Multiply", "c", "d"]]]]
      ["Multiply", "a", "c", "d"]
    `);
    expect(check('(a\\times(c+d))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Add", "c", "d"]]]]
      ["Multiply", "a", ["Add", "c", "d"]]
    `);
    // Sequence with empty element
    expect(check('(a,,b)')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "Nothing", "b"]]
      ["Sequence", "a", "Nothing", "b"]
    `);
  });
  test('Groups', () => {
    expect(check('(a, b, c)')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", "b", "c"]]
      ["Sequence", "a", "b", "c"]
    `);
    // @fixme
    expect(check('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(`
      latex     = [
        "Delimiter",
        [
          "Sequence",
          ["List", "a", "b"],
          [
            "List",
            "c",
            "d",
            [
              "Sequence",
              ["Error", "'missing'", ["Latex", "';'"]],
              "Nothing",
              ["List", "n", "Nothing", "m"]
            ]
          ]
        ]
      ]
      [
        "Delimiter",
        [
          "Sequence",
          ["List", "a", "b"],
          [
            "List",
            "c",
            "d",
            [
              "Sequence",
              ["Error", "'missing'", ["Latex", "';'"]],
              "Nothing",
              ["List", "n", "Nothing", "m"]
            ]
          ]
        ]
      ]
    `);
    expect(check('(a, (b, c))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", ["Delimiter", ["Sequence", "b", "c"]]]]
      ["Sequence", "a", "b", "c"]
    `);
    expect(check('(a, (b; c))')).toMatchInlineSnapshot(`
      latex     = ["Delimiter", ["Sequence", "a", ["Delimiter", ["Sequence", "b", "c"]]]]
      ["Sequence", "a", "b", "c"]
    `);
  });
  test('Sequences', () => {
    expect(check('a, b, c')).toMatchInlineSnapshot(`
      latex     = ["Sequence", "a", "b", "c"]
      ["Sequence", "a", "b", "c"]
    `);
    // Sequence with missing element
    expect(check('a,, c')).toMatchInlineSnapshot(`
      latex     = ["Sequence", "a", "Nothing", "c"]
      ["Sequence", "a", "Nothing", "c"]
    `);
    // Sequence with missing final element
    expect(check('a,c,')).toMatchInlineSnapshot(`
      latex     = ["Sequence", "a", "c", "Nothing"]
      ["Sequence", "a", "c", "Nothing"]
    `);
    // Sequence with missing initial element
    expect(check(',c,b')).toMatchInlineSnapshot(`
      latex     = ["Sequence", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]
      ["Sequence", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]
    `); // @fixme: initial element should not be an error
  });
  test('Subsequences', () => {
    expect(check('a,b;c,d,e;f;g,h')).toMatchInlineSnapshot(`
      latex     = [
        "Sequence",
        ["List", "a", "b"],
        ["List", "c", "d", "e"],
        "f",
        ["List", "g", "h"]
      ]
      box       = [
        "Sequence",
        ["List", "a", "b"],
        ["List", "c", "d", "ExponentialE"],
        "f",
        ["List", "g", "h"]
      ]
      N-auto    = [
        "Sequence",
        ["List", "a", "b"],
        [
          "List",
          "c",
          "d",
          "2.718281828459045235360287471352662497757247093699959574966967627724076630353547594571382178525166427"
        ],
        "f",
        ["List", "g", "h"]
      ]
      N-mach    = [
        "Sequence",
        ["List", "a", "b"],
        ["List", "c", "d", 2.718281828459045],
        "f",
        ["List", "g", "h"]
      ]
    `);
    // @fixme
    expect(check(';;a;')).toMatchInlineSnapshot(`
      latex     = [
        "Sequence",
        ["Error", "'missing'", ["Latex", "';'"]],
        "Nothing",
        "a",
        "Nothing"
      ]
      [
        "Sequence",
        ["Error", "'missing'", ["Latex", "';'"]],
        "Nothing",
        "a",
        "Nothing"
      ]
    `);
  });
});
