import { engine } from '../../utils';

engine.assume(['Element', 'f', 'Functions']);

function check(s: string, f: jest.ProvidesCallback) {
  describe(s, () => test(s, f));
}

check('Unknown symbol', () =>
  expect(engine.parse('\\oops')).toMatchInlineSnapshot(`
    [
      "Error",
      ["ErrorCode", "'unexpected-command'", "'\\oops'"],
      ["LatexString", "'\\oops'"]
    ]
  `)
);

check('Unknown symbol in argument list', () =>
  expect(engine.parse('1+\\oops+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\oops'"],
        ["LatexString", "'\\oops'"]
      ],
      2
    ]
  `)
);

check('Unknown command with arguments', () =>
  expect(engine.parse('1+\\oops{bar}+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\oops'"],
        ["LatexString", "'\\oops{bar}'"]
      ],
      2
    ]
  `)
);

check('Unknown environment', () =>
  expect(engine.parse('1+\\begin{oops}\\end{oops}+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Error",
        ["ErrorCode", "'unknown-environment'", "'oops'"],
        ["LatexString", "'\\begin{oops}\\end{oops}'"]
      ],
      2
    ]
  `)
);

check('Unbalanced environment by name', () =>
  expect(engine.parse('1+\\begin{cases}\\end{oops}+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Error",
        "'unbalanced-environment'",
        ["LatexString", "'\\end{oops}+2'"]
      ]
    ]
  `)
);

check('Unbalanced environment, \\end without \\begin', () =>
  expect(engine.parse('1+\\end{cases}+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Error",
        ["ErrorCode", "'unbalanced-environment'", "'cases'"],
        ["LatexString", "'\\end{cases}'"]
      ],
      2
    ]
  `)
);

check('Unbalanced environment, \\begin without \\end', () =>
  expect(engine.parse('\\begin{cases}1+2')).toMatchInlineSnapshot(
    `["Error", "'unbalanced-environment'", ["LatexString", "'1+2'"]]`
  )
);

check('Environment without name', () =>
  expect(engine.parse('1 + \\begin +2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      ["Error", "'expected-environment-name'", ["LatexString", "'\\begin'"]],
      2
    ]
  `)
);

check('Missing argument with \\sqrt custom parser', () =>
  expect(engine.parse('1+\\sqrt')).toMatchInlineSnapshot(
    `["Add", 1, ["Sqrt", ["Error", "'missing'"]]]`
  )
);

check('Paren instead of braces with \\sqrt', () =>
  expect(engine.parse('\\sqrt[x](y)')).toMatchInlineSnapshot(
    `["Multiply", ["Root", ["Error", "'missing'"], "x"], "y"]`
  )
);

check('Missing 1 argument with \\frac custom parser', () =>
  expect(engine.parse('1+\\frac{2}')).toMatchInlineSnapshot(
    `["Add", 1, ["Divide", 2, ["Error", "'missing'"]]]`
  )
);

check('Missing all arguments with \\frac custom parser', () =>
  expect(engine.parse('1+\\frac')).toMatchInlineSnapshot(
    `["Add", 1, ["Divide", ["Error", "'missing'"], ["Error", "'missing'"]]]`
  )
);

check('Missing argument with \\placeholder parser', () =>
  expect(engine.parse('1+\\placeholder')).toMatchInlineSnapshot(
    `["Add", "Nothing", 1]`
  )
);

check('Invalid argument in sequence', () =>
  expect(engine.parse('1+(2=2)+3').canonical).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Error",
        [
          "ErrorCode",
          "'incompatible-domain'",
          ["Domain", "Numbers"],
          ["Domain", "MaybeBooleans"]
        ],
        ["Equal", 2, 2]
      ],
      3
    ]
  `)
);

check('Invalid argument positional', () =>
  expect(engine.parse('1+\\frac{2}{2=2}+2').canonical).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Divide",
        2,
        [
          "Error",
          [
            "ErrorCode",
            "'incompatible-domain'",
            ["Domain", "Numbers"],
            ["Domain", "MaybeBooleans"]
          ],
          ["Equal", 2, 2]
        ]
      ],
      2
    ]
  `)
);

check('Invalid infix operator', () =>
  expect(engine.parse('\\times 3')).toMatchInlineSnapshot(
    `["Multiply", ["Error", "'missing'", ["LatexString", "'\\times'"]], 3]`
  )
);

check('Invalid prefix operator', () =>
  expect(engine.parse('2\\partial')).toMatchInlineSnapshot(`
    [
      "Sequence",
      2,
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\partial'"],
        ["LatexString", "'\\partial'"]
      ]
    ]
  `)
);

check('Invalid postfix operator', () =>
  expect(engine.parse('! 3')).toMatchInlineSnapshot(`
    [
      "Sequence",
      ["Factorial", ["Error", "'missing'", ["LatexString", "'!'"]]],
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "' '"],
        ["LatexString", "' 3'"]
      ]
    ]
  `)
);

check('Supsub syntax error', () =>
  expect(engine.parse('x__+1')).toMatchInlineSnapshot(`
    [
      "Add",
      [
        "Subscript",
        "x",
        ["Error", "'syntax-error'", ["LatexString", "'_'"]]
      ],
      1
    ]
  `)
);

check('Supsub syntax error', () =>
  expect(engine.parse('\\sqrt{x__}+1')).toMatchInlineSnapshot(`
    [
      "Add",
      [
        "Sqrt",
        [
          "Subscript",
          "x",
          ["Error", "'syntax-error'", ["LatexString", "'_'"]]
        ]
      ],
      1
    ]
  `)
);

check('Supsub syntax error', () =>
  expect(engine.parse('x_')).toMatchInlineSnapshot(
    `["Error", "'missing'", ["LatexString", "'_'"]]`
  )
);

check('Supsub syntax error', () =>
  expect(engine.parse('x_{a')).toMatchInlineSnapshot(
    `["Subscript", "x", ["Sequence", "a", ["Error", "'syntax-error'"]]]`
  )
);

check('VALID infix command', () =>
  expect(engine.parse('1\\over 2')).toMatchInlineSnapshot(`Half`)
);

// @fixme
check('Too many infix commands', () =>
  expect(engine.parse('1\\over 2 \\over 3')).toMatchInlineSnapshot(
    `["Rational", 3, 2]`
  )
);

check('Command in string', () =>
  expect(engine.parse('1\\text{hello \\alpha}')).toMatchInlineSnapshot(
    `["Sequence", 1, "'hello \\alpha'"]`
  )
);

// check('Missing unit', () =>
//   expect(engine.parse('1\\skip{3}+2')).toMatchInlineSnapshot(
//     `["Add",["Multiply",1,["Error",["ErrorCode","'unknown-command'","'\\\\skip'"],["Latex","'\\\\skip{3}'"]]],2]`
//   )
// );

check('VALID function application', () =>
  expect(engine.parse('f\\left(\\right)')).toMatchInlineSnapshot(`["f"]`)
);

check('INVALID function application', () =>
  expect(engine.parse('g\\left(\\right)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "g",
      [
        "Error",
        ["ErrorCode", "'unexpected-open-delimiter'", "'\\left'"],
        ["LatexString", "'\\left(\\right)'"]
      ]
    ]
  `)
);

check('VALID function application', () =>
  expect(engine.parse('f\\left(2\\right)')).toMatchInlineSnapshot(`["f", 2]`)
);

check('VALID function application', () =>
  expect(engine.parse('f()')).toMatchInlineSnapshot(`["f"]`)
);

check('VALID function application', () =>
  expect(engine.parse('f(2)')).toMatchInlineSnapshot(`["f", 2]`)
);

check('VALID function application', () =>
  expect(engine.parse('f\\left(2\\right)')).toMatchInlineSnapshot(`["f", 2]`)
);

check('Invalid empty delimiter expression', () =>
  expect(engine.parse('1()')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-open-delimiter'", "'('"],
        ["LatexString", "'()'"]
      ]
    ]
  `)
);

check('Invalid empty delimiter expression', () =>
  expect(engine.parse('1\\left(\\right)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-open-delimiter'", "'\\left'"],
        ["LatexString", "'\\left(\\right)'"]
      ]
    ]
  `)
);

check('Invalid delimiter: expected closing', () =>
  expect(engine.parse('1\\left(')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'expected-close-delimiter'", "'\\right)'"],
        ["LatexString", "'('"]
      ]
    ]
  `)
);

check('Invalid delimiter: expected closing', () =>
  expect(engine.parse('1(')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-open-delimiter'", "'('"],
        ["LatexString", "'('"]
      ]
    ]
  `)
);

check('Invalid delimiter: expected opening', () =>
  expect(engine.parse('1)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'expected-open-delimiter'", "'('"],
        ["LatexString", "')'"]
      ]
    ]
  `)
);

check('Invalid delimiter: expected opening', () =>
  expect(engine.parse('1\\right)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'expected-open-delimiter'", "'\\left('"],
        ["LatexString", "'\\right)'"]
      ]
    ]
  `)
);

check('Invalid delimiter', () =>
  expect(engine.parse('1\\left\\alpha2\\right\\alpha')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\left'"],
        ["LatexString", "'\\left'"]
      ],
      "alpha",
      2,
      [
        "Error",
        ["ErrorCode", "'expected-open-delimiter'", "'\\left'"],
        ["LatexString", "'\\right\\alpha'"]
      ]
    ]
  `)
);

check('Invalid double superscript', () =>
  expect(engine.parse('x^1^2')).toMatchInlineSnapshot(`
    [
      "Power",
      "x",
      [
        "Error",
        [
          "ErrorCode",
          "'incompatible-domain'",
          ["Domain", "Numbers"],
          ["Domain", "Lists"]
        ],
        ["List", 1, 2]
      ]
    ]
  `)
);

check('Double superscript: invalid domain', () =>
  expect(engine.parse('x^1^2').canonical).toMatchInlineSnapshot(`
    [
      "Power",
      "x",
      [
        "Error",
        [
          "ErrorCode",
          "'incompatible-domain'",
          ["Domain", "Numbers"],
          ["Domain", "Lists"]
        ],
        ["List", 1, 2]
      ]
    ]
  `)
);

// check('Invalid double subscript', () =>
//   expect(engine.parse('x_1_2')).toMatchInlineSnapshot(
//     `["Subscript","x",["Sequence",1,2]]`
//   )
// );

check('Expected closing delimiter', () =>
  expect(engine.parse('\\frac{1}{2')).toMatchInlineSnapshot(
    `["Divide", 1, ["Sequence", 2, ["Error", "'syntax-error'"]]]`
  )
);

check('Unexpected closing delimiter', () =>
  expect(engine.parse('\\frac{1}{2}}+1')).toMatchInlineSnapshot(`
    [
      "Add",
      [
        "Sequence",
        "Half",
        ["Error", "'unexpected-closing-delimiter'", ["LatexString", "'}'"]]
      ],
      1
    ]
  `)
);

check('Syntax error: @', () =>
  expect(engine.parse('x@2')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "'@'"],
        ["LatexString", "'@2'"]
      ]
    ]
  `)
);

check('Syntax error: \\', () =>
  expect(engine.parse('x\\')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\'"],
        ["LatexString", "'\\'"]
      ]
    ]
  `)
);

check('Syntax error: \\1', () =>
  expect(engine.parse('x\\1')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\1'"],
        ["LatexString", "'\\1'"]
      ]
    ]
  `)
);

check('Syntax error: ##', () =>
  expect(engine.parse('x##')).toMatchInlineSnapshot(`["Multiply", "##", "x"]`)
);

check('Syntax error: &', () =>
  expect(engine.parse('x&2')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "'&'"],
        ["LatexString", "'&2'"]
      ]
    ]
  `)
);

check('VALID comment', () =>
  expect(engine.parse('x%2')).toMatchInlineSnapshot(`x`)
);

check('VALID empty group', () =>
  expect(engine.parse('x={}2')).toMatchInlineSnapshot(`["Equal", "x", 2]`)
);

check('VALID empty group', () =>
  expect(engine.parse('x={  }2')).toMatchInlineSnapshot(`["Equal", "x", 2]`)
);

check('Syntax error', () =>
  expect(engine.parse('x=2{{{')).toMatchInlineSnapshot(`
    [
      "Equal",
      "x",
      [
        "Sequence",
        2,
        [
          "Sequence",
          ["Error", "'expected-expression'", ["LatexString", "'{'"]],
          [
            "Error",
            "'expected-closing-delimiter'",
            ["LatexString", "'{{'"]
          ]
        ],
        ["Error", "'expected-closing-delimiter'", ["LatexString", "'{{{'"]]
      ]
    ]
  `)
);

check('Missing argument', () =>
  expect(engine.box(['Sqrt']).canonical).toMatchInlineSnapshot(
    `["Sqrt", ["Error", "'missing'"]]`
  )
);

check('Unexpected argument', () =>
  expect(engine.box(['Sqrt', 12, 29, 74]).canonical).toMatchInlineSnapshot(`
    [
      "Sqrt",
      12,
      ["Error", "'unexpected-argument'", 29],
      ["Error", "'unexpected-argument'", 74]
    ]
  `)
);

check('Mismatched domain', () =>
  expect(engine.box(['Sqrt', 'True']).canonical).toMatchInlineSnapshot(`
    [
      "Sqrt",
      [
        "Error",
        [
          "ErrorCode",
          "'incompatible-domain'",
          ["Domain", "Numbers"],
          ["Domain", "Booleans"]
        ],
        "True"
      ]
    ]
  `)
);
