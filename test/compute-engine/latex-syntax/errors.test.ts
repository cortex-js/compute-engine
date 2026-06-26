import { engine } from '../../utils';
import { LatexSyntax } from '../../../src/latex-syntax';
import type { MathJsonExpression } from '../../../src/math-json/types';

engine.declare('g', 'function');

function check(s: string, f: jest.ProvidesCallback) {
  describe(s, () => test(s, f));
}

type ErrorExpressionObject = {
  fn: ['Error', ...MathJsonExpression[]];
  sourceOffsets?: [start: number, end: number];
};

function errorCode(expr: ErrorExpressionObject): string | undefined {
  const code = expr.fn[1];
  if (typeof code === 'string') return code.replace(/^'|'$/g, '');
  if (code && typeof code === 'object' && !Array.isArray(code) && 'str' in code)
    return code.str.replace(/^'|'$/g, '');
  if (Array.isArray(code) && code[0] === 'ErrorCode') {
    const head = code[1];
    if (typeof head === 'string') return head.replace(/^'|'$/g, '');
    if (head && typeof head === 'object' && 'str' in head)
      return head.str.replace(/^'|'$/g, '');
  }
  return undefined;
}

function collectErrors(expr: MathJsonExpression): ErrorExpressionObject[] {
  const result: ErrorExpressionObject[] = [];

  function visit(x: MathJsonExpression): void {
    if (Array.isArray(x)) {
      if (x[0] === 'Error')
        result.push({ fn: x as ErrorExpressionObject['fn'] });
      for (const child of x.slice(1)) visit(child);
      return;
    }

    if (x && typeof x === 'object' && 'fn' in x) {
      if (x.fn[0] === 'Error') result.push(x as ErrorExpressionObject);
      for (const child of x.fn.slice(1)) visit(child);
    }
  }

  visit(expr);
  return result;
}

function findError(
  expr: MathJsonExpression,
  code: string
): ErrorExpressionObject {
  const result = collectErrors(expr).find((error) => errorCode(error) === code);
  expect(result).toBeDefined();
  return result!;
}

describe('Parser Error source offsets', () => {
  test('raw parser errors identify the original source range for unknown commands', () => {
    const syntax = new LatexSyntax();
    const expr = syntax.parse('\\foo')!;
    const error = findError(expr, 'unexpected-command');

    expect(error.fn[0]).toBe('Error');
    expect(error.sourceOffsets).toEqual([0, 4]);
  });

  test('nested parser errors survive ComputeEngine.parse().toMathJson()', () => {
    const expr = engine.parse('1+\\oops+2')!.toMathJson();
    const error = findError(expr, 'unexpected-command');

    expect(error.fn[0]).toBe('Error');
    expect(error.sourceOffsets).toEqual([2, 7]);
  });

  test('unexpected delimiters identify the delimiter source range', () => {
    const expr = engine.parse(')+1')!.toMathJson();
    const error = findError(expr, 'unexpected-delimiter');

    expect(error.sourceOffsets).toEqual([0, 1]);
  });

  test('missing parser operands use a zero-width source range at the parser position', () => {
    const expr = engine.parse('1+\\sqrt')!.toMathJson();
    const error = findError(expr, 'missing');

    expect(error.sourceOffsets).toEqual([7, 7]);
  });

  test('missing closing delimiters identify the unterminated group range', () => {
    const expr = engine.parse('x_{a')!.toMathJson();
    const error = findError(expr, 'expected-closing-delimiter');

    expect(error.sourceOffsets).toEqual([2, 4]);
  });
});

check('Syntax error inside group with invisible operator', () =>
  expect(engine.parse('{2\\pi)}')).toMatchInlineSnapshot(`
    [
      "Tuple",
      2,
      "Pi",
      {
        fn: ["Error", "expected-closing-delimiter", ["LatexString", "{2\\pi)}"]];
          sourceOffsets: [0, 7]
      }
    ]
  `)
);

check('Valid empty group', () =>
  expect(engine.parse('{}')).toMatchInlineSnapshot(`Nothing`)
);

check('Invalid open delimiter', () =>
  expect(engine.parse(')+1')).toMatchInlineSnapshot(`
    {
      fn: ["Error", "unexpected-delimiter", ["LatexString", ")"]];
      sourceOffsets: [0, 1]
    }
  `)
);

check('Unknown symbol', () =>
  expect(engine.parse('\\oops')).toMatchInlineSnapshot(`
    {
      fn: ["Error", "unexpected-command", ["LatexString", "\\oops"]];
      sourceOffsets: [0, 5]
    }
  `)
);

check('Unknown symbol in argument list', () =>
  expect(engine.parse('1+\\oops+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      {
        fn: ["Error", "unexpected-command", ["LatexString", "\\oops"]];
          sourceOffsets: [2, 7]
      },
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
        "Tuple",
        {
          fn: ["Error", "unexpected-command", ["LatexString", "\\oops"]];
              sourceOffsets: [2, 7]
        },
        "b",
        "a",
        "r"
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
      {
        fn: [
          "Error",
          ["ErrorCode", "unknown-environment", "'oops'"],
          ["LatexString", "\\begin{oops}\\end{oops}"]
        ];
          sourceOffsets: [2, 24]
      },
      2
    ]
  `)
);

check('Unbalanced environment by name', () =>
  expect(engine.parse('1+\\begin{cases}\\end{oops}+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      {
        fn: [
          "Error",
          "unbalanced-environment",
          ["LatexString", "\\end{oops}+2"]
        ];
          sourceOffsets: [15, 27]
      }
    ]
  `)
);

check('Unbalanced environment, \\end without \\begin', () =>
  expect(engine.parse('1+\\end{cases}+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Tuple",
        {
          fn: ["Error", "unexpected-command", ["LatexString", "\\end"]];
              sourceOffsets: [2, 6]
        },
        "c",
        "a",
        "s",
        "ExponentialE",
        "s"
      ],
      2
    ]
  `)
);

check('Unbalanced environment, \\begin without \\end', () =>
  expect(engine.parse('\\begin{cases}1+2')).toMatchInlineSnapshot(`
    {
      fn: ["Error", "unbalanced-environment", ["LatexString", "1+2"]];
      sourceOffsets: [13, 16]
    }
  `)
);

// REVIEW.md C3: an unbalanced brace in an environment name at end of input
// threw a TypeError (parseStringGroupContent read past the end). It must
// degrade to an Error expression instead.
check('Unbalanced brace in environment name does not crash', () => {
  expect(() => engine.parse('\\begin{ca{ses')).not.toThrow();
  expect(engine.parse('\\begin{ca{ses').toString()).toContain('Error');
});

check('Environment without name', () =>
  expect(engine.parse('1 + \\begin +2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      {
        fn: ["Error", "expected-environment-name", ["LatexString", "\\begin"]];
          sourceOffsets: [4, 10]
      },
      2
    ]
  `)
);

check('Missing argument with \\sqrt custom parser', () =>
  expect(engine.parse('1+\\sqrt')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      ["Sqrt", {fn: ["Error", "'missing'"]; sourceOffsets: [7, 7]}]
    ]
  `)
);

check('Paren instead of braces with \\sqrt', () =>
  expect(engine.parse('\\sqrt[x](y)')).toMatchInlineSnapshot(`
    [
      "Tuple",
      ["Root", {fn: ["Error", "'missing'"]; sourceOffsets: [8, 8]}, "x"],
      "y"
    ]
  `)
);

check('Missing 1 argument with \\frac custom parser', () =>
  expect(engine.parse('1+\\frac{2}')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      ["Divide", 2, {fn: ["Error", "'missing'"]; sourceOffsets: [10, 10]}]
    ]
  `)
);

check('Missing all arguments with \\frac custom parser', () =>
  expect(engine.parse('1+\\frac')).toMatchInlineSnapshot(
    `["Add", 1, ["Divide", ["Error", "'missing'"], ["Error", "'missing'"]]]`
  )
);

check('Missing argument with \\placeholder parser', () =>
  expect(engine.parse('1+\\placeholder')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      {
        fn: ["Error", "unexpected-operator", ["LatexString", "+\\placeholder"]];
          sourceOffsets: [1, 14]
      }
    ]
  `)
);

check('Invalid argument in sequence', () =>
  expect(engine.parse('1+(2=2)+3').canonical).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      [
        "Error",
        ["ErrorCode", "incompatible-type", "'number'", "'boolean'"]
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
          ["ErrorCode", "incompatible-type", "'number'", "'boolean'"]
        ]
      ],
      2
    ]
  `)
);

check('Invalid infix operator', () =>
  expect(engine.parse('\\times 3')).toMatchInlineSnapshot(`
    [
      "Tuple",
      {
        fn: ["Error", "unexpected-command", ["LatexString", "\\times"]];
          sourceOffsets: [0, 6]
      },
      3
    ]
  `)
);

check('Invalid prefix operator', () =>
  expect(engine.parse('2\\partial')).toMatchInlineSnapshot(
    `["Sequence", 2, ["PartialDerivative"]]`
  )
);

check('Invalid postfix operator', () =>
  expect(engine.parse('! 3')).toMatchInlineSnapshot(`
    [
      "Factorial",
      {
        fn: ["Error", "'missing'", ["LatexString", "!"]];
          sourceOffsets: [1, 1]
      }
    ]
  `)
);

check('Supsub syntax error', () =>
  expect(engine.parse('x__+1')).toMatchInlineSnapshot(`["Add", "x__", 1]`)
);

check('Supsub syntax error', () =>
  expect(engine.parse('\\sqrt{x__}+1')).toMatchInlineSnapshot(
    `["Add", ["Sqrt", "x__"], 1]`
  )
);

check('Supsub syntax error', () =>
  expect(engine.parse('x_')).toMatchInlineSnapshot(
    `["Subscript", "x", ["Error", "'missing'"]]`
  )
);

check('Supsub syntax error', () =>
  expect(engine.parse('x_{a')).toMatchInlineSnapshot(`
    [
      "Subscript",
      "x",
      [
        "InvisibleOperator",
        "a",
        {
          fn: ["Error", "expected-closing-delimiter", ["LatexString", "{a"]];
              sourceOffsets: [2, 4]
        }
      ]
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
    `["Text", 1, "hello \\alpha"]`
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

check(
  'VALID function application of unknown symbol with empty argument list',
  () => expect(engine.parse('g\\left(\\right)')).toMatchInlineSnapshot(`["g"]`)
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

// This is valid, because Multiply is threaded, and can accept an empty
// tuple as an argument.
check('VALID empty delimiter expression', () =>
  expect(engine.parse('1()')).toMatchInlineSnapshot(`["Tuple"]`)
);

check('VALID empty delimiter expression', () =>
  expect(engine.parse('1\\left(\\right)')).toMatchInlineSnapshot(`["Tuple"]`)
);

check('Invalid delimiter: expected closing', () =>
  expect(engine.parse('1\\left(')).toMatchInlineSnapshot(`
    [
      "Sequence",
      [
        "InvisibleOperator",
        1,
        {
          fn: ["Error", "unexpected-command", ["LatexString", "\\left"]];
              sourceOffsets: [1, 6]
        }
      ],
      {
        fn: ["Error", "unexpected-delimiter", ["LatexString", "("]];
          sourceOffsets: [6, 7]
      }
    ]
  `)
);

check('Invalid delimiter: expected closing', () =>
  expect(engine.parse('1(')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      {
        fn: ["Error", "unexpected-delimiter", ["LatexString", "("]];
          sourceOffsets: [1, 2]
      }
    ]
  `)
);

check('Invalid delimiter: expected opening', () =>
  expect(engine.parse('1)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      {
        fn: ["Error", "unexpected-delimiter", ["LatexString", ")"]];
          sourceOffsets: [1, 2]
      }
    ]
  `)
);

check('Invalid delimiter: expected opening', () =>
  expect(engine.parse('1\\right)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      [
        "InvisibleOperator",
        1,
        {
          fn: ["Error", "unexpected-command", ["LatexString", "\\right"]];
              sourceOffsets: [1, 7]
        }
      ],
      {
        fn: ["Error", "unexpected-delimiter", ["LatexString", ")"]];
          sourceOffsets: [7, 8]
      }
    ]
  `)
);

check('Invalid delimiter', () =>
  expect(engine.parse('1\\left\\alpha2\\right\\alpha')).toMatchInlineSnapshot(`
    [
      "Tuple",
      1,
      {
        fn: ["Error", "unexpected-command", ["LatexString", "\\left"]];
          sourceOffsets: [1, 6]
      },
      "alpha",
      2,
      {
        fn: ["Error", "unexpected-command", ["LatexString", "\\right"]];
          sourceOffsets: [13, 19]
      },
      "alpha"
    ]
  `)
);

check('Double superscript: threaded', () =>
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
      [
        "Tuple",
        2,
        {
          fn: ["Error", "expected-closing-delimiter", ["LatexString", "{2"]];
              sourceOffsets: [8, 10]
        }
      ]
    ]
  `)
);

check('Unexpected closing delimiter', () =>
  expect(engine.parse('\\frac{1}{2}}+1')).toMatchInlineSnapshot(`
    [
      "Add",
      [
        "Tuple",
        ["Rational", 1, 2],
        {
          fn: ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]];
              sourceOffsets: [11, 12]
        }
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
      {
        fn: [
          "Error",
          ["ErrorCode", "unexpected-token", "@"],
          ["LatexString", "@"]
        ];
          sourceOffsets: [1, 2]
      }
    ]
  `)
);

// A trailing bare `\` at end of input is tolerated (some sources, notably
// Desmos editors, emit a stray trailing `\`). It is silently discarded.
check('Trailing bare backslash is tolerated', () =>
  expect(engine.parse('x\\')).toMatchInlineSnapshot(`x`)
);

check('Syntax error: \\1', () =>
  expect(engine.parse('x\\1')).toMatchInlineSnapshot(`
    [
      "Tuple",
      "x",
      {
        fn: ["Error", "unexpected-command", ["LatexString", "\\1"]];
          sourceOffsets: [1, 3]
      }
    ]
  `)
);

check('Syntax error: ##', () =>
  expect(engine.parse('x##')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      {
        fn: [
          "Error",
          ["ErrorCode", "unexpected-token", "#"],
          ["LatexString", "#"]
        ];
          sourceOffsets: [1, 2]
      }
    ]
  `)
);

check('Syntax error: &', () =>
  expect(engine.parse('x&2')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      {
        fn: [
          "Error",
          ["ErrorCode", "unexpected-token", "&"],
          ["LatexString", "&"]
        ];
          sourceOffsets: [1, 2]
      }
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
        "InvisibleOperator",
        2,
        {
          fn: ["Error", "expected-closing-delimiter", ["LatexString", "{"]];
              sourceOffsets: [5, 6]
        }
      ]
    ]
  `)
);

check('Missing argument', () =>
  expect(engine.expr(['Sqrt'])).toMatchInlineSnapshot(
    `["Sqrt", ["Error", "'missing'"]]`
  )
);

check('Unexpected argument', () =>
  expect(engine.expr(['Sqrt', 12, 29, 74])).toMatchInlineSnapshot(`
    [
      "Sqrt",
      12,
      ["Error", "unexpected-argument", "'29'"],
      ["Error", "unexpected-argument", "'74'"]
    ]
  `)
);

check('Mismatched type', () => {
  expect(engine.expr(['Sqrt', 'True'])).toMatchInlineSnapshot(`
    [
      "Sqrt",
      [
        "Error",
        ["ErrorCode", "incompatible-type", "'number'", "'boolean'"]
      ]
    ]
  `);
});
