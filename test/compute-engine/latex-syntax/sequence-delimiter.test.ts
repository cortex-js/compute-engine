import { Expression } from '../../../src/math-json';
import { engine, printExpression } from '../../utils';

function check(arg: string | Expression): string {
  const boxed =
    typeof arg === 'string'
      ? engine.parse(arg, { canonical: false })
      : engine.box(arg, { canonical: false });
  const canonical = boxed.canonical;
  const evaluated = canonical.evaluate();

  return `box       = ${printExpression(boxed.json)}
canonical = ${printExpression(canonical.json)}
evaluated = ${printExpression(evaluated.json)}`;
}

describe('SEQUENCES', () => {
  test('Simple sequence are serialized without separator', () =>
    expect(check(['Sequence', 1, 2, 3])).toMatchInlineSnapshot(`
      box       = ["Sequence", 1, 2, 3]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Sequences are automatically associative', () =>
    expect(check(['Sequence', 1, ['Sequence', 2, 3], 4]))
      .toMatchInlineSnapshot(`
      box       = ["Sequence", 1, ["Sequence", 2, 3], 4]
      canonical = ["Sequence", 1, 2, 3, 4]
      evaluated = ["Sequence", 1, 2, 3, 4]
    `));
  test('Sequences can be used as arguments', () =>
    expect(check(['Add', ['Sequence', 1, 2, 3]])).toMatchInlineSnapshot(`
      box       = ["Add", ["Sequence", 1, 2, 3]]
      canonical = ["Add", 1, 2, 3]
      evaluated = 6
    `));
  test('Empty sequences are ignored', () =>
    expect(check(['Add', 1, ['Sequence'], 2])).toMatchInlineSnapshot(`
      box       = ["Add", 1, ["Sequence"], 2]
      canonical = ["Add", 1, 2]
      evaluated = 3
    `));
});

describe('SEQUENCE PARSING', () => {
  test('Simple sequence can be comma separated', () =>
    expect(check('1, 2, 3')).toMatchInlineSnapshot(`
      box       = ["Sequence", 1, 2, 3]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Simple sequence can be semicolon separated', () =>
    expect(check('1; 2; 3')).toMatchInlineSnapshot(`
      box       = ["Sequence", 1, 2, 3]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Sequences with a mix of colon and semicolon are embedded', () =>
    expect(check('1; 2, 3, 4, 5; 6; 7')).toMatchInlineSnapshot(`
      box       = ["Sequence", 1, ["List", 2, 3, 4, 5], 6, 7]
      canonical = ["Sequence", 1, ["List", 2, 3, 4, 5], 6, 7]
      evaluated = ["Sequence", 1, ["List", 2, 3, 4, 5], 6, 7]
    `));
});

describe('LISTS', () => {
  test('Lists can be enclosed in braces', () =>
    expect(check('\\{1, 2, 3\\}')).toMatchInlineSnapshot(`
      box       = [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["Latex", "'1, 2, 3\\}'"]
        ]
      ]
      canonical = [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["Latex", "'1, 2, 3\\}'"]
        ]
      ]
      evaluated = [
        "Sequence",
        [
          "Error",
          ["ErrorCode", "'unexpected-command'", "'\\{'"],
          ["Latex", "'\\{'"]
        ],
        [
          "Error",
          ["ErrorCode", "'unexpected-token'", "'1'"],
          ["Latex", "'1, 2, 3\\}'"]
        ]
      ]
    `));
  test('Lists can be enclosed in square brackets', () =>
    expect(check('\\[1, 2, 3\\]')).toMatchInlineSnapshot(`
      box       = ["List", 1, 2, 3]
      canonical = ["List", 1, 2, 3]
      evaluated = ["List", 1, 2, 3]
    `));
  test('Lists can be enclosed in parenthesis', () =>
    expect(check('(1, 2, 3)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3]]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Lists can be enclosed in extensible parenthesis', () =>
    expect(check('\\left(1, 2, 3\\right)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3]]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));

  test('Lists can be embedded in other lists', () =>
    expect(check('(1, \\{2, 3, 4\\}, 5)')).toMatchInlineSnapshot(`
      box       = [
        "Delimiter",
        [
          "Sequence",
          [
            "Sequence",
            1,
            [
              "Error",
              ["ErrorCode", "'unexpected-command'", "'\\{'"],
              ["Latex", "'\\{'"]
            ],
            2
          ],
          3,
          [
            "Sequence",
            4,
            [
              "Error",
              ["ErrorCode", "'expected-open-delimiter'", "'\\{'"],
              ["Latex", "'\\}'"]
            ]
          ],
          5
        ]
      ]
      canonical = [
        "Delimiter",
        [
          "Sequence",
          [
            "Sequence",
            1,
            [
              "Error",
              ["ErrorCode", "'unexpected-command'", "'\\{'"],
              ["Latex", "'\\{'"]
            ],
            2
          ],
          3,
          [
            "Sequence",
            4,
            [
              "Error",
              ["ErrorCode", "'expected-open-delimiter'", "'\\{'"],
              ["Latex", "'\\}'"]
            ]
          ],
          5
        ]
      ]
      evaluated = [
        "Delimiter",
        [
          "Sequence",
          [
            "Sequence",
            1,
            [
              "Error",
              ["ErrorCode", "'unexpected-command'", "'\\{'"],
              ["Latex", "'\\{'"]
            ],
            2
          ],
          3,
          [
            "Sequence",
            4,
            [
              "Error",
              ["ErrorCode", "'expected-open-delimiter'", "'\\{'"],
              ["Latex", "'\\}'"]
            ]
          ],
          5
        ]
      ]
    `));
});

describe('DELIMITERS', () => {
  test('Sequence with default parens and comma', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3]])).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3]]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Expression with default parens and comma', () =>
    expect(check(['Delimiter', ['Add', 1, 2]])).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Add", 1, 2]]
      canonical = ["Add", 1, 2]
      evaluated = 3
    `));
  test('List with default parens and comma', () =>
    expect(check(['Delimiter', ['List', 1, 2, 3]])).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["List", 1, 2, 3]]
      canonical = ["List", 1, 2, 3]
      evaluated = ["List", 1, 2, 3]
    `));
  test('Sequence with square brackets', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3], "'[]'"]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'[]'"]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Sequence with mix of brackets', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3], "')['"]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "')['"]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Sequence with custom separator', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3], "'()'", "';'"]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'()'", "';'"]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
  test('Sequence with custom Pipe separator', () =>
    expect(
      check([
        'Delimiter',
        ['Sequence', 1, 2, 3],
        "'\\langle\\rangle)'",
        "'\\vert'",
      ])
    ).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'\\langle\\rangle)'", "'\\vert'"]
      canonical = ["Sequence", 1, 2, 3]
      evaluated = ["Sequence", 1, 2, 3]
    `));
});

///

describe('SEQUENCES AND DELIMITERS', () => {
  test('Valid groups', () => {
    expect(check('(a+b)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Add", "a", "b"]]
      canonical = ["Add", "a", "b"]
      evaluated = ["Add", "a", "b"]
    `);
    expect(check('-(a+b)')).toMatchInlineSnapshot(`
      box       = ["Negate", ["Delimiter", ["Add", "a", "b"]]]
      canonical = ["Subtract", ["Negate", "b"], "a"]
      evaluated = ["Subtract", ["Negate", "b"], "a"]
    `);
    expect(check('(a+(c+d))')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Add", "a", ["Delimiter", ["Add", "c", "d"]]]]
      canonical = ["Add", "a", "c", "d"]
      evaluated = ["Add", "a", "c", "d"]
    `);
    expect(check('(a\\times(c\\times d))')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Multiply", "c", "d"]]]]
      canonical = ["Multiply", "a", "c", "d"]
      evaluated = ["Multiply", "a", "c", "d"]
    `);
    expect(check('(a\\times(c+d))')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Add", "c", "d"]]]]
      canonical = ["Multiply", "a", ["Add", "c", "d"]]
      evaluated = ["Multiply", "a", ["Add", "c", "d"]]
    `);
    // Sequence with empty element
    expect(check('(a,,b)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "Nothing", "b"]]
      canonical = ["Sequence", "a", "Nothing", "b"]
      evaluated = ["Sequence", "a", "Nothing", "b"]
    `);
  });

  test('Groups', () => {
    expect(check('(a, b, c)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"]]
      canonical = ["Sequence", "a", "b", "c"]
      evaluated = ["Sequence", "a", "b", "c"]
    `);
    // @fixme
    expect(check('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(`
      box       = [
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
      canonical = [
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
      evaluated = [
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
      box       = ["Delimiter", ["Sequence", "a", ["Delimiter", ["Sequence", "b", "c"]]]]
      canonical = ["Sequence", "a", "b", "c"]
      evaluated = ["Sequence", "a", "b", "c"]
    `);
    expect(check('(a, (b; c))')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", ["Delimiter", ["Sequence", "b", "c"]]]]
      canonical = ["Sequence", "a", "b", "c"]
      evaluated = ["Sequence", "a", "b", "c"]
    `);
  });
  test('Sequences', () => {
    expect(check('a, b, c')).toMatchInlineSnapshot(`
      box       = ["Sequence", "a", "b", "c"]
      canonical = ["Sequence", "a", "b", "c"]
      evaluated = ["Sequence", "a", "b", "c"]
    `);
    // Sequence with missing element
    expect(check('a,, c')).toMatchInlineSnapshot(`
      box       = ["Sequence", "a", "Nothing", "c"]
      canonical = ["Sequence", "a", "Nothing", "c"]
      evaluated = ["Sequence", "a", "Nothing", "c"]
    `);
    // Sequence with missing final element
    expect(check('a,c,')).toMatchInlineSnapshot(`
      box       = ["Sequence", "a", "c", "Nothing"]
      canonical = ["Sequence", "a", "c", "Nothing"]
      evaluated = ["Sequence", "a", "c", "Nothing"]
    `);
    // Sequence with missing initial element
    expect(check(',c,b')).toMatchInlineSnapshot(`
      box       = ["Sequence", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]
      canonical = ["Sequence", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]
      evaluated = ["Sequence", ["Error", "'missing'", ["Latex", "','"]], "c", "b"]
    `); // @fixme: initial element should not be an error
  });
  test('Subsequences', () => {
    expect(check('a,b;k,l,m;f;g,h')).toMatchInlineSnapshot(`
      box       = [
        "Sequence",
        ["List", "a", "b"],
        ["List", "k", "l", "m"],
        "f",
        ["List", "g", "h"]
      ]
      canonical = [
        "Sequence",
        ["List", "a", "b"],
        ["List", "k", "l", "m"],
        "f",
        ["List", "g", "h"]
      ]
      evaluated = [
        "Sequence",
        ["List", "a", "b"],
        ["List", "k", "l", "m"],
        "f",
        ["List", "g", "h"]
      ]
    `);
    // @fixme
    expect(check(';;a;')).toMatchInlineSnapshot(`
      box       = [
        "Sequence",
        ["Error", "'missing'", ["Latex", "';'"]],
        "Nothing",
        "a",
        "Nothing"
      ]
      canonical = [
        "Sequence",
        ["Error", "'missing'", ["Latex", "';'"]],
        "Nothing",
        "a",
        "Nothing"
      ]
      evaluated = [
        "Sequence",
        ["Error", "'missing'", ["Latex", "';'"]],
        "Nothing",
        "a",
        "Nothing"
      ]
    `);
  });
});
