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

  test('nested parser errors survive ComputeEngine.parse().toMathJson() when requested', () => {
    const expr = engine
      .parse('1+\\oops+2')!
      .toMathJson({ metadata: ['sourceOffsets'] });
    const error = findError(expr, 'unexpected-command');

    expect(error.fn[0]).toBe('Error');
    expect(error.sourceOffsets).toEqual([2, 7]);
  });

  test('unexpected delimiters identify the delimiter source range', () => {
    const expr = engine
      .parse(')+1')!
      .toMathJson({ metadata: ['sourceOffsets'] });
    const error = findError(expr, 'unexpected-delimiter');

    expect(error.sourceOffsets).toEqual([0, 1]);
  });

  test('missing parser operands use a zero-width source range at the parser position', () => {
    // `\sqrt{}` (explicit empty radical) is the missing-operand case; a bare
    // `\sqrt` is now a function reference, not a missing-argument error.
    const expr = engine
      .parse('1+\\sqrt{}')!
      .toMathJson({ metadata: ['sourceOffsets'] });
    const error = findError(expr, 'missing');

    expect(error.sourceOffsets).toEqual([9, 9]);
  });

  test('missing closing delimiters identify the unterminated group range', () => {
    const expr = engine
      .parse('x_{a')!
      .toMathJson({ metadata: ['sourceOffsets'] });
    const error = findError(expr, 'expected-closing-delimiter');

    expect(error.sourceOffsets).toEqual([2, 4]);
  });

  test('missing operand before an infix operator points at the insertion slot', () => {
    // The left operand of `=` is missing: the caret sits before the `=`, where
    // the operand belongs, not after it.
    const expr = new LatexSyntax().parse('=x')!;
    expect(findError(expr, 'missing').sourceOffsets).toEqual([0, 0]);
  });

  test('missing operand of a postfix operator points at the insertion slot', () => {
    // The operand of `!` is missing: the caret sits before the `!`.
    const expr = new LatexSyntax().parse('! 3')!;
    expect(findError(expr, 'missing').sourceOffsets).toEqual([0, 0]);
  });

  test('source offsets are opt-in metadata: omitted from the default boxed serialization', () => {
    // The raw parser always carries offsets...
    const raw = new LatexSyntax().parse('\\foo')!;
    expect(findError(raw, 'unexpected-command').sourceOffsets).toEqual([0, 4]);

    // ...but the boxed serialization only emits them when requested (like
    // `latex`/`wikidata`).
    const dflt = engine.parse('\\foo')!.toMathJson();
    expect(findError(dflt, 'unexpected-command').sourceOffsets).toBeUndefined();

    const all = engine.parse('\\foo')!.toMathJson({ metadata: 'all' });
    expect(findError(all, 'unexpected-command').sourceOffsets).toEqual([0, 4]);
  });
});

check('Syntax error inside group with invisible operator', () =>
  expect(engine.parse('{2\\pi)}')).toMatchInlineSnapshot(`
    [
      "Tuple",
      2,
      "Pi",
      ["Error", "expected-closing-delimiter", ["LatexString", "{2\\pi)}"]]
    ]
  `)
);

check('Valid empty group', () =>
  expect(engine.parse('{}')).toMatchInlineSnapshot(`Nothing`)
);

check('Invalid open delimiter', () =>
  expect(engine.parse(')+1')).toMatchInlineSnapshot(
    `["Error", "unexpected-delimiter", ["LatexString", ")"]]`
  )
);

check('Unknown symbol', () =>
  expect(engine.parse('\\oops')).toMatchInlineSnapshot(
    `["Error", "unexpected-command", ["LatexString", "\\oops"]]`
  )
);

check('Unknown symbol in argument list', () =>
  expect(engine.parse('1+\\oops+2')).toMatchInlineSnapshot(`
    [
      "Add",
      1,
      ["Error", "unexpected-command", ["LatexString", "\\oops"]],
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
        ["Error", "unexpected-command", ["LatexString", "\\oops"]],
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
      [
        "Error",
        ["ErrorCode", "unknown-environment", "'oops'"],
        ["LatexString", "\\begin{oops}\\end{oops}"]
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
      ["Error", "unbalanced-environment", ["LatexString", "\\end{oops}+2"]]
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
        ["Error", "unexpected-command", ["LatexString", "\\end"]],
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
  expect(engine.parse('\\begin{cases}1+2')).toMatchInlineSnapshot(
    `["Error", "unbalanced-environment", ["LatexString", "1+2"]]`
  )
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
      ["Error", "expected-environment-name", ["LatexString", "\\begin"]],
      2
    ]
  `)
);

check('Missing argument with \\sqrt custom parser', () =>
  expect(engine.parse('1+\\sqrt{}')).toMatchInlineSnapshot(
    `["Add", 1, ["Sqrt", ["Error", "'missing'"]]]`
  )
);

check('Paren instead of braces with \\sqrt', () =>
  expect(engine.parse('\\sqrt[x](y)')).toMatchInlineSnapshot(
    `["Tuple", ["Root", ["Error", "'missing'"], "x"], "y"]`
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
  expect(engine.parse('1+\\placeholder')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      ["Error", "unexpected-operator", ["LatexString", "+\\placeholder"]]
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
      ["Error", "unexpected-command", ["LatexString", "\\times"]],
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
  expect(engine.parse('! 3')).toMatchInlineSnapshot(
    `["Factorial", ["Error", "'missing'", ["LatexString", "!"]]]`
  )
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
        ["Error", "expected-closing-delimiter", ["LatexString", "{a"]]
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
        ["Error", "unexpected-command", ["LatexString", "\\left"]]
      ],
      ["Error", "unexpected-delimiter", ["LatexString", "("]]
    ]
  `)
);

check('Invalid delimiter: expected closing', () =>
  expect(engine.parse('1(')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      ["Error", "unexpected-delimiter", ["LatexString", "("]]
    ]
  `)
);

check('Invalid delimiter: expected opening', () =>
  expect(engine.parse('1)')).toMatchInlineSnapshot(`
    [
      "Sequence",
      1,
      ["Error", "unexpected-delimiter", ["LatexString", ")"]]
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
        ["Error", "unexpected-command", ["LatexString", "\\right"]]
      ],
      ["Error", "unexpected-delimiter", ["LatexString", ")"]]
    ]
  `)
);

check('Invalid delimiter', () =>
  expect(engine.parse('1\\left\\alpha2\\right\\alpha')).toMatchInlineSnapshot(`
    [
      "Tuple",
      1,
      ["Error", "unexpected-command", ["LatexString", "\\left"]],
      "alpha",
      2,
      ["Error", "unexpected-command", ["LatexString", "\\right"]],
      "alpha"
    ]
  `)
);

check('Double superscript: threaded', () =>
  expect(engine.parse('x^1^2').canonical).toMatchInlineSnapshot(
    `["Error", "unexpected-superscript", ["LatexString", "^1^2"]]`
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
        ["Error", "expected-closing-delimiter", ["LatexString", "{2"]]
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
        ["Error", "unexpected-closing-delimiter", ["LatexString", "}"]]
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
        ["ErrorCode", "unexpected-token", "@"],
        ["LatexString", "@"]
      ]
    ]
  `)
);

// A trailing bare `\` at end of input is tolerated (some sources, notably
// Desmos editors, emit a stray trailing `\`). It is silently discarded.
check('Trailing bare backslash is tolerated', () =>
  expect(engine.parse('x\\')).toMatchInlineSnapshot(`x`)
);

check('Syntax error: \\1', () =>
  expect(engine.parse('x\\1')).toMatchInlineSnapshot(
    `["Tuple", "x", ["Error", "unexpected-command", ["LatexString", "\\1"]]]`
  )
);

check('Syntax error: ##', () =>
  expect(engine.parse('x##')).toMatchInlineSnapshot(`
    [
      "Sequence",
      "x",
      [
        "Error",
        ["ErrorCode", "unexpected-token", "#"],
        ["LatexString", "#"]
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
        ["ErrorCode", "unexpected-token", "&"],
        ["LatexString", "&"]
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
        "InvisibleOperator",
        2,
        ["Error", "expected-closing-delimiter", ["LatexString", "{"]]
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
