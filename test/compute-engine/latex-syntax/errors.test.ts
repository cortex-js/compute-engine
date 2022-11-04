import { engine } from '../../utils';

engine.assume(['Element', 'f', 'Function']);

function check(s: string, f: jest.ProvidesCallback) {
  describe(s, () => test(s, f));
}

check('Unknown symbol', () =>
  expect(engine.parse('\\oops')).toMatchInlineSnapshot(`
    [
      "Error",
      ["ErrorCode", "'unexpected-command'", "'\\oops'"],
      ["Latex", "'\\oops'"]
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
        ["Latex", "'\\oops'"]
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
        ["Latex", "'\\oops{bar}'"]
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
        ["Latex", "'\\begin{oops}\\end{oops}'"]
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
      ["Error", "'unbalanced-environment'", ["Latex", "'\\end{oops}+2'"]]
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
        ["Latex", "'\\end{cases}'"]
      ],
      2
    ]
  `)
);

check('Unbalanced environment, \\begin without \\end', () =>
  expect(engine.parse('\\begin{cases}1+2')).toMatchInlineSnapshot(
    `["Error", "'unbalanced-environment'", ["Latex", "'1+2'"]]`
  )
);

check('Environment without name', () =>
  expect(engine.parse('1 + \\begin +2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      ["Error", "'expected-environment-name'", ["Latex", "'\\begin'"]],
      2
    ]
  `)
);

check('Missing argument with \\sqrt custom parser', () =>
  expect(engine.parse('1+\\sqrt')).toMatchInlineSnapshot(
    `["Add", 1, ["Sqrt", ["Error", "'missing'"]]]`
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
    `["Add", 1, "Nothing"]`
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
          "Number",
          ["Domain", "MaybeBoolean"]
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
            "Number",
            ["Domain", "MaybeBoolean"]
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
    `["Multiply", ["Error", "'missing'", ["Latex", "'\\times'"]], 3]`
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
        ["Latex", "'\\partial'"]
      ]
    ]
  `)
);

check('Invalid postfix operator', () =>
  expect(engine.parse('! 3')).toMatchInlineSnapshot(`
    [
      "Multiply",
      ["Factorial", ["Error", "'missing'", ["Latex", "'!'"]]],
      3
    ]
  `)
);

check('Supsub syntax error', () =>
  expect(engine.parse('x__+1')).toMatchInlineSnapshot(`
    [
      "Add",
      ["Subscript", "x", ["Error", "'syntax-error'", ["Latex", "'_'"]]],
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
        ["Subscript", "x", ["Error", "'syntax-error'", ["Latex", "'_'"]]]
      ],
      1
    ]
  `)
);

check('Supsub syntax error', () =>
  expect(engine.parse('x_')).toMatchInlineSnapshot(
    `["Error", "'missing'", ["Latex", "'_'"]]`
  )
);

check('Supsub syntax error', () =>
  expect(engine.parse('x_{a')).toMatchInlineSnapshot(`
    [
      "Subscript",
      "x",
      ["Error", "'expected-closing-delimiter'", ["Latex", "'a'"]]
    ]
  `)
);

check('VALID infix command', () =>
  expect(engine.parse('1\\over 2')).toMatchInlineSnapshot(`["Rational", 1, 2]`)
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
      ["Error", "'expected-expression'", ["Latex", "'\\left(\\right)'"]]
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
  expect(engine.parse('1()')).toMatchInlineSnapshot(
    `["Sequence", 1, ["Error", "'expected-expression'", ["Latex", "'()'"]]]`
  )
);

check('Invalid empty delimiter expression', () =>
  expect(engine.parse('1\\left(\\right)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      ["Error", "'expected-expression'", ["Latex", "'\\left(\\right)'"]]
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
        ["ErrorCode", "'unexpected-command'", "'\\left'"],
        ["Latex", "'\\left('"]
      ]
    ]
  `)
); // @fixme : should be expected-delimiter

check('Invalid delimiter: expected closing', () =>
  expect(engine.parse('1(')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "'('"],
        ["Latex", "'('"]
      ]
    ]
  `)
); // @fixme : should be expected-delimiter

check('Invalid delimiter: expected opening', () =>
  expect(engine.parse('1)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "')'"],
        ["Latex", "')'"]
      ]
    ]
  `)
); // @fixme : should be mismatched-delimiter

check('Invalid delimiter: expected opening', () =>
  expect(engine.parse('1\\right)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\right'"],
        ["Latex", "'\\right'"]
      ],
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "')'"],
        ["Latex", "')'"]
      ]
    ]
  `)
); // @fixme : should be mismatched-delimiter

check('Invalid delimiter', () =>
  expect(engine.parse('1\\left\\alpha2\\right\\alpha')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\left'"],
        ["Latex", "'\\left'"]
      ],
      "Alpha",
      2,
      [
        "Error",
        ["ErrorCode", "'unexpected-command'", "'\\right'"],
        ["Latex", "'\\right'"]
      ],
      "Alpha"
    ]
  `)
);

check('Invalid double superscript', () =>
  expect(engine.parse('x^1^2')).toMatchInlineSnapshot(
    `["Power", "x", ["List", 1, 2]]`
  )
);

check('Double superscript: invalid domain', () =>
  expect(engine.parse('x^1^2').canonical).toMatchInlineSnapshot(
    `["Power", "x", ["List", 1, 2]]`
  )
);

// check('Invalid double subscript', () =>
//   expect(engine.parse('x_1_2')).toMatchInlineSnapshot(
//     `["Subscript","x",["Sequence",1,2]]`
//   )
// );

check('Expected closing delimiter', () =>
  expect(engine.parse('\\frac{1}{2')).toMatchInlineSnapshot(`
    [
      "Divide",
      1,
      ["Error", "'expected-closing-delimiter'", ["Latex", "'2'"]]
    ]
  `)
);

check('Unexpected closing delimiter', () =>
  expect(engine.parse('\\frac{1}{2}}+1')).toMatchInlineSnapshot(`
    [
      "Add",
      [
        "Sequence",
        ["Rational", 1, 2],
        ["Error", "'unexpected-closing-delimiter'", ["Latex", "'}'"]]
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
        ["Latex", "'@2'"]
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
        ["Latex", "'\\'"]
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
        ["Latex", "'\\1'"]
      ]
    ]
  `)
);

check('Syntax error: ##', () =>
  expect(engine.parse('x##')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "'#'"],
        ["Latex", "'##'"]
      ]
    ]
  `)
);

check('Syntax error: &', () =>
  expect(engine.parse('x&2')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      [
        "Error",
        ["ErrorCode", "'unexpected-token'", "'&'"],
        ["Latex", "'&2'"]
      ]
    ]
  `)
);

check('VALID comment', () =>
  expect(engine.parse('x%2')).toMatchInlineSnapshot(`x`)
);

check('VALID empty group', () =>
  expect(engine.parse('x={}2')).toMatchInlineSnapshot(`["Equal", 2, "x"]`)
);

check('VALID empty group', () =>
  expect(engine.parse('x={  }2')).toMatchInlineSnapshot(`["Equal", 2, "x"]`)
);

check('Syntax error', () =>
  expect(engine.parse('x=2{{{')).toMatchInlineSnapshot(`
    [
      "Equal",
      "x",
      2,
      ["Error", "'expected-expression'", ["Latex", "''"]],
      ["Error", "'expected-closing-delimiter'", ["Latex", "'{'"]],
      ["Error", "'expected-closing-delimiter'", ["Latex", "'{{'"]]
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
          "Number",
          ["Domain", "Boolean"]
        ],
        "True"
      ]
    ]
  `)
);
