import { Expression } from '../../../src/math-json';
import { engine, exprToString } from '../../utils';

function check(arg: string | Expression): string {
  const boxed =
    typeof arg === 'string'
      ? engine.parse(arg, { canonical: false })
      : engine.box(arg, { canonical: false });
  const canonical = boxed.canonical;
  // const evaluated = canonical.evaluate();

  const boxStr = exprToString(boxed);
  const canonicalStr = exprToString(canonical);

  let result =
    boxStr === canonicalStr
      ? boxStr
      : `box       = ${boxStr}
canonical = ${canonicalStr}`;

  result += `\nbox-latex = ${boxed.latex}\nlatex     = ${canonical.latex}`;

  return result;
  // evaluated = ${printExpression(evaluated.json)}`;
}

describe('SEQUENCES SERIALIZING', () => {
  test('Simple sequence are serialized without separator', () =>
    expect(check(['Sequence', 1, 2, 3])).toMatchInlineSnapshot(`
      ["Sequence", 1, 2, 3]
      box-latex = 1 2 3
      latex     = 1 2 3
    `));
  test('Sequences are automatically associative', () =>
    expect(check(['Sequence', 1, ['Sequence', 2, 3], 4]))
      .toMatchInlineSnapshot(`
      box       = ["Sequence", 1, ["Sequence", 2, 3], 4]
      canonical = ["Sequence", 1, 2, 3, 4]
      box-latex = 1 2 3 4
      latex     = 1 2 3 4
    `));
  test('Sequences can be used as arguments', () =>
    expect(check(['Add', ['Sequence', 1, 2, 3]])).toMatchInlineSnapshot(`
      box       = ["Add", ["Sequence", 1, 2, 3]]
      canonical = ["Add", 1, 2, 3]
      box-latex = 1 2 3
      latex     = 1+2+3
    `));
  test('Empty sequences are ignored', () =>
    expect(check(['Add', 1, ['Sequence'], 2])).toMatchInlineSnapshot(`
      box       = ["Add", 1, ["Sequence"], 2]
      canonical = ["Add", 1, 2]
      box-latex = 1++2
      latex     = 1+2
    `));
});

describe('DELIMITERS SERIALIZING', () => {
  test('Sequence with default parens and comma', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3]])).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3]]
      canonical = ["Triple", 1, 2, 3]
      box-latex = (1,2,3)
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));

  test('Sequence expression with default parens and comma', () =>
    expect(check(['Delimiter', ['Sequence', ['Add', 1, 2]]]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", ["Add", 1, 2]]]
      canonical = ["Single", ["Add", 1, 2]]
      box-latex = (1+2)
      latex     = \\mathrm{Single}(1+2)
    `));

  test('Non-collection with default parens and comma', () =>
    expect(check(['Delimiter', ['Add', 1, 2]])).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Add", 1, 2]]
      canonical = ["Add", 1, 2]
      box-latex = (1+2)
      latex     = 1+2
    `));

  test('List with default parens and comma', () =>
    expect(check(['Delimiter', ['List', 1, 2, 3]])).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["List", 1, 2, 3]]
      canonical = ["List", 1, 2, 3]
      box-latex = \\lbrack1,2,3\\rbrack
      latex     = \\bigl\\lbrack1, 2, 3\\bigr\\rbrack
    `));

  test('Sequence with square brackets', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3], "'[]'"]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'[]'"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = \\lbrack123\\rbrack
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));

  test('Sequence with mix of brackets', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3], "')['"]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "')['"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = )123\\lbrack
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));

  test('Sequence with custom separator', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3], "'(;)'"]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'(;)'"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = (1;2;3)
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));

  test('Sequence with custom Pipe separator', () =>
    expect(check(['Delimiter', ['Sequence', 1, 2, 3], "'<|>'"]))
      .toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'<|>'"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = \\langle1\\mvert2\\mvert3\\rangle
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));
});

describe('SEQUENCE PARSING', () => {
  test('Simple sequences can be comma separated', () =>
    expect(check('1, 2, 3')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "','"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = 1,2,3
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));

  test('Sequences with no separators', () =>
    expect(check('1 2 3')).toMatchInlineSnapshot(`
      123
      box-latex = 123
      latex     = 123
    `));

  test('Sequences can be semicolon separated', () =>
    expect(check('1; 2; 3')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "';'"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = 1;2;3
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));

  test('Sequences with a mix of colon and semicolon are embedded', () =>
    expect(check('1; 2, 3, 4, 5; 6; 7')).toMatchInlineSnapshot(`
      box       = [
        "Delimiter",
        ["Sequence", 1, ["Delimiter", ["Sequence", 2, 3, 4, 5], "','"], 6, 7],
        "';'"
      ]
      canonical = ["Tuple", 1, ["Tuple", 2, 3, 4, 5], 6, 7]
      box-latex = 1;2,3,4,5;6;7
      latex     = \\mathrm{Tuple}(1, \\mathrm{Tuple}(2, 3, 4, 5), 6, 7)
    `));
});

describe('DELIMITERS PARSING', () => {
  test('Valid groups', () => {
    expect(check('()')).toMatchInlineSnapshot(`
      box       = ["Delimiter"]
      canonical = ["Tuple"]
      box-latex = ()
      latex     = \\mathrm{Tuple}()
    `);

    expect(check('(1)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", 1]
      canonical = 1
      box-latex = (1)
      latex     = 1
    `);

    expect(check('(2x)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["InvisibleOperator", 2, "x"]]
      canonical = ["Multiply", 2, "x"]
      box-latex = (2x)
      latex     = 2x
    `);

    // Trig function are a special case as they have optional
    // enclosing parentheses
    expect(check('\\sin 2x')).toMatchInlineSnapshot(`
      box       = ["Sin", ["InvisibleOperator", 2, "x"]]
      canonical = ["Sin", ["Multiply", 2, "x"]]
      box-latex = \\sin(2x)
      latex     = \\sin(2x)
    `);
    expect(check('\\sin (2x)')).toMatchInlineSnapshot(`
      box       = ["Sin", ["InvisibleOperator", 2, "x"]]
      canonical = ["Sin", ["Multiply", 2, "x"]]
      box-latex = \\sin(2x)
      latex     = \\sin(2x)
    `);

    // Expressions as element of the sequence
    expect(check('(x+1, a+b)')).toMatchInlineSnapshot(`
      box       = [
        "Delimiter",
        ["Sequence", ["Add", "x", 1], ["Add", "a", "b"]],
        "'(,)'"
      ]
      canonical = ["Pair", ["Add", "x", 1], ["Add", "a", "b"]]
      box-latex = (x+1,a+b)
      latex     = \\mathrm{Pair}(x+1, a+b)
    `);

    // Multiple nested arguments of a non-function declared identifier
    expect(check('q(1, 2,3; 4, 5, 6)')).toMatchInlineSnapshot(`
      box       = [
        "InvisibleOperator",
        "q",
        [
          "Delimiter",
          [
            "Sequence",
            ["Delimiter", ["Sequence", 1, 2, 3], "','"],
            ["Delimiter", ["Sequence", 4, 5, 6], "','"]
          ],
          "'(;)'"
        ]
      ]
      canonical = ["q", ["Triple", 1, 2, 3], ["Triple", 4, 5, 6]]
      box-latex = q(1,2,3;4,5,6)
      latex     = q(\\mathrm{Triple}(1, 2, 3), \\mathrm{Triple}(4, 5, 6))
    `);

    expect(check('\\lbrack x+1=0, 2x^2+5=1\\rbrack')).toMatchInlineSnapshot(`
      box       = [
        "List",
        ["Equal", ["Add", "x", 1], 0],
        ["Equal", ["Add", ["InvisibleOperator", 2, ["Power", "x", 2]], 5], 1]
      ]
      canonical = [
        "List",
        ["Equal", ["Add", "x", 1], 0],
        ["Equal", ["Add", ["Multiply", 2, ["Square", "x"]], 5], 1]
      ]
      box-latex = \\bigl\\lbrack x+1=0, 2x^2+5=1\\bigr\\rbrack
      latex     = \\bigl\\lbrack x+1=0, 2x^2+5=1\\bigr\\rbrack
    `);

    // expect(check('')).toMatchInlineSnapshot();

    expect(check('(a+b)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Add", "a", "b"]]
      canonical = ["Add", "a", "b"]
      box-latex = (a+b)
      latex     = a+b
    `);
    expect(check('-(a+b)')).toMatchInlineSnapshot(`
      box       = ["Negate", ["Delimiter", ["Add", "a", "b"]]]
      canonical = ["Subtract", ["Negate", "a"], "b"]
      box-latex = -(a+b)
      latex     = -a-b
    `);
    expect(check('(a+(c+d))')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Add", "a", ["Delimiter", ["Add", "c", "d"]]]]
      canonical = ["Add", "a", "c", "d"]
      box-latex = (a+(c+d))
      latex     = a+c+d
    `);
    expect(check('(a\\times(c\\times d))')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Multiply", "c", "d"]]]]
      canonical = ["Multiply", "a", "c", "d"]
      box-latex = (a(cd))
      latex     = acd
    `);
    expect(check('(a\\times(c+d))')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Multiply", "a", ["Delimiter", ["Add", "c", "d"]]]]
      canonical = ["Multiply", "a", ["Add", "c", "d"]]
      box-latex = (a(c+d))
      latex     = a(c+d)
    `);
    // Sequence with empty element
    expect(check('(a,,b)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "Nothing", "b"], "'(,)'"]
      canonical = ["Triple", "a", "Nothing", "b"]
      box-latex = (a,\\mathrm{Nothing},b)
      latex     = \\mathrm{Triple}(a, \\mathrm{Nothing}, b)
    `);
  });

  test('Groups', () => {
    expect(check('(a, b, c)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "'(,)'"]
      canonical = ["Triple", "a", "b", "c"]
      box-latex = (a,b,c)
      latex     = \\mathrm{Triple}(a, b, c)
    `);
    expect(check('(a, b; c, d, ;; n ,, m)')).toMatchInlineSnapshot(`
      box       = [
        "Delimiter",
        [
          "Sequence",
          ["Delimiter", ["Sequence", "a", "b"], "','"],
          ["Delimiter", ["Sequence", "c", "d", "Nothing"], "','"],
          "Nothing",
          ["Delimiter", ["Sequence", "n", "Nothing", "m"], "','"]
        ],
        "'(;)'"
      ]
      canonical = [
        "Tuple",
        ["Pair", "a", "b"],
        ["Triple", "c", "d", "Nothing"],
        "Nothing",
        ["Triple", "n", "Nothing", "m"]
      ]
      box-latex = (a,b;c,d,\\mathrm{Nothing};\\mathrm{Nothing};n,\\mathrm{Nothing},m)
      latex     = \\mathrm{Tuple}(\\mathrm{Pair}(a, b), \\mathrm{Triple}(c, d, \\mathrm{Nothing}), \\mathrm{Nothing}, \\mathrm{Triple}(n, \\mathrm{Nothing}, m))
    `);
    expect(check('(a, (b, c))')).toMatchInlineSnapshot(`
      box       = [
        "Delimiter",
        ["Sequence", "a", ["Delimiter", ["Sequence", "b", "c"], "'(,)'"]],
        "'(,)'"
      ]
      canonical = ["Pair", "a", ["Pair", "b", "c"]]
      box-latex = (a,(b,c))
      latex     = \\mathrm{Pair}(a, \\mathrm{Pair}(b, c))
    `);
    expect(check('(a, (b; c))')).toMatchInlineSnapshot(`
      box       = [
        "Delimiter",
        ["Sequence", "a", ["Delimiter", ["Sequence", "b", "c"], "'(;)'"]],
        "'(,)'"
      ]
      canonical = ["Pair", "a", ["Pair", "b", "c"]]
      box-latex = (a,(b;c))
      latex     = \\mathrm{Pair}(a, \\mathrm{Pair}(b, c))
    `);
  });
  test('Sequences', () => {
    expect(check('a, b, c')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "b", "c"], "','"]
      canonical = ["Triple", "a", "b", "c"]
      box-latex = a,b,c
      latex     = \\mathrm{Triple}(a, b, c)
    `);
    // Sequence with missing element
    expect(check('a,, c')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "Nothing", "c"], "','"]
      canonical = ["Triple", "a", "Nothing", "c"]
      box-latex = a,\\mathrm{Nothing},c
      latex     = \\mathrm{Triple}(a, \\mathrm{Nothing}, c)
    `);
    // Sequence with missing final element
    expect(check('a,c,')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "a", "c", "Nothing"], "','"]
      canonical = ["Triple", "a", "c", "Nothing"]
      box-latex = a,c,\\mathrm{Nothing}
      latex     = \\mathrm{Triple}(a, c, \\mathrm{Nothing})
    `);
    // Sequence with missing initial element
    expect(check(',c,b')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", "Nothing", "c", "b"], "','"]
      canonical = ["Triple", "Nothing", "c", "b"]
      box-latex = \\mathrm{Nothing},c,b
      latex     = \\mathrm{Triple}(\\mathrm{Nothing}, c, b)
    `);
  });
  test('Subsequences', () => {
    expect(check('a,b;k,l,m;f;g,h')).toMatchInlineSnapshot(`
      box       = [
        "Delimiter",
        [
          "Sequence",
          ["Delimiter", ["Sequence", "a", "b"], "','"],
          ["Delimiter", ["Sequence", "k", "l", "m"], "','"],
          "f",
          ["Delimiter", ["Sequence", "g", "h"], "','"]
        ],
        "';'"
      ]
      canonical = [
        "Tuple",
        ["Pair", "a", "b"],
        ["Triple", "k", "l", "m"],
        "f",
        ["Pair", "g", "h"]
      ]
      box-latex = a,b;k,l,m;f;g,h
      latex     = \\mathrm{Tuple}(\\mathrm{Pair}(a, b), \\mathrm{Triple}(k, l, m), f, \\mathrm{Pair}(g, h))
    `);
    expect(check(';;a;')).toMatchInlineSnapshot(`
      [
        "Delimiter",
        [
          "Sequence",
          ["Error", "'missing'", ["LatexString", "';'"]],
          "Nothing",
          "a",
          "Nothing"
        ],
        "';'"
      ]
      box-latex = \\error{\\blacksquare};\\mathrm{Nothing};a;\\mathrm{Nothing}
      latex     = \\error{\\blacksquare};\\mathrm{Nothing};a;\\mathrm{Nothing}
    `);
  });
});

describe('SETS, LISTS, TUPLES', () => {
  test('Sets can be enclosed in braces', () =>
    expect(check('\\{1, 2, 3\\}')).toMatchInlineSnapshot(`
      ["Set", 1, 2, 3]
      box-latex = \\lbrace1, 2, 3\\rbrace
      latex     = \\lbrace1, 2, 3\\rbrace
    `));
  test('Lists can be enclosed in square brackets', () =>
    expect(check('\\[1, 2, 3\\]')).toMatchInlineSnapshot(`
      ["List", 1, 2, 3]
      box-latex = \\bigl\\lbrack1, 2, 3\\bigr\\rbrack
      latex     = \\bigl\\lbrack1, 2, 3\\bigr\\rbrack
    `));
  test('Lists can be enclosed in extensible parenthesis', () =>
    expect(check('\\left(1, 2, 3\\right)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'(,)'"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = (1,2,3)
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));

  test('Lists can be embedded in other lists', () =>
    expect(check('\\[1, \\[2, 3, 4\\], 5\\]')).toMatchInlineSnapshot(`
      ["List", 1, ["List", 2, 3, 4], 5]
      box-latex = \\bigl\\lbrack1, \\bigl\\lbrack2, 3, 4\\bigr\\rbrack, 5\\bigr\\rbrack
      latex     = \\bigl\\lbrack1, \\bigl\\lbrack2, 3, 4\\bigr\\rbrack, 5\\bigr\\rbrack
    `));

  test('Tuples can be enclosed in parenthesis', () =>
    expect(check('(1, 2, 3)')).toMatchInlineSnapshot(`
      box       = ["Delimiter", ["Sequence", 1, 2, 3], "'(,)'"]
      canonical = ["Triple", 1, 2, 3]
      box-latex = (1,2,3)
      latex     = \\mathrm{Triple}(1, 2, 3)
    `));
});
