import { latex, engine as ce } from '../../utils';

function parse(s: string) {
  return ce.parse(s);
}

describe('LIST PARSING', () => {
  test('Empty list', () => {
    expect(parse('\\lbrack\\rbrack')).toMatchInlineSnapshot(`["List"]`);
    expect(parse('\\lbrack \\rbrack')).toMatchInlineSnapshot(`["List"]`);
  });

  test('One element list', () => {
    expect(parse('\\lbrack2\\rbrack')).toMatchInlineSnapshot(`["List", 2]`);
    expect(parse('\\lbrack x\\rbrack')).toMatchInlineSnapshot(`["List", "x"]`);
    expect(parse('\\lbrack x+1\\rbrack')).toMatchInlineSnapshot(
      `["List", ["Add", "x", 1]]`
    );
  });

  test('Iverson bracket (not a list)', () => {
    expect(parse('\\lbrack x+1=0\\rbrack')).toMatchInlineSnapshot(
      `["Boole", ["Equal", ["Add", "x", 1], 0]]`
    );
  });

  test('Multi element list', () => {
    expect(parse('\\lbrack 1, 2\\rbrack')).toMatchInlineSnapshot(
      `["List", 1, 2]`
    );
    expect(parse('\\lbrack 2, y\\rbrack')).toMatchInlineSnapshot(
      `["List", 2, "y"]`
    );
    expect(parse('\\lbrack x+1=0, 2x^2+5=1\\rbrack')).toMatchInlineSnapshot(`
      [
        "List",
        ["Equal", ["Add", "x", 1], 0],
        ["Equal", ["Add", ["Multiply", 2, ["Square", "x"]], 5], 1]
      ]
    `);
  });

  test('Lists of lists', () => {
    expect(
      parse('\\lbrack \\lbrack 1, 2\\rbrack, \\lbrack 3, 4\\rbrack \\rbrack')
    ).toMatchInlineSnapshot(`["List", ["List", 1, 2], ["List", 3, 4]]`);
    expect(parse('\\lbrack 1, 2; 3, 4 \\rbrack')).toMatchInlineSnapshot(
      `["List", ["List", 1, 2], ["List", 3, 4]]`
    );
  });
});

// A number cannot be indexed, so a bracketed list directly after a number
// literal is a factor of a product, like `4(1,2)` or `4\cdot[1,2]`.
// Before, the bracket was left over: `4[1,2]` parsed as
// `Sequence(4, Error('unexpected-operator', '['))`.
describe('NUMBER BEFORE A BRACKETED LIST', () => {
  test.each([
    ['4[1,2]', ['Multiply', 4, ['List', 1, 2]]],
    ['4\\left[1,2\\right]', ['Multiply', 4, ['List', 1, 2]]],
    ['4\\lbrack 1,2\\rbrack', ['Multiply', 4, ['List', 1, 2]]],
    ['4\\left\\lbrack 1,2\\right\\rbrack', ['Multiply', 4, ['List', 1, 2]]],
    ['4 [1,2]', ['Multiply', 4, ['List', 1, 2]]],
    ['4.5[1,2]', ['Multiply', 4.5, ['List', 1, 2]]],
    ['-4[1,2]', ['Multiply', -4, ['List', 1, 2]]],
    ['\\frac12[1,2]', ['Multiply', ['Rational', 1, 2], ['List', 1, 2]]],
    ['t-4\\left[1,2\\right]', ['Add', 't', ['Multiply', -4, ['List', 1, 2]]]],
    [
      '4[[1,2],[3,4]]',
      ['Multiply', 4, ['List', ['List', 1, 2], ['List', 3, 4]]],
    ],
    // A suffix after the list binds to the list, not to the product
    ['4[1,2]^2', ['Multiply', 4, ['Power', ['List', 1, 2], 2]]],
    ['4[1,2,3][2]', ['Multiply', 4, ['At', ['List', 1, 2, 3], 2]]],
  ])('%s', (input, expected) => {
    const expr = parse(input);
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(expected);
  });

  test('The raw form is a juxtaposition, as for 4(1,2)', () => {
    expect(ce.parse('4[1,2]', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      4,
      ['List', 1, 2],
    ]);
  });

  test('The product evaluates element-wise', () => {
    expect(parse('4[1,2]').evaluate().json).toEqual(['List', 4, 8]);
    expect(parse('4\\left[1,2\\right]').evaluate().json).toEqual([
      'List',
      4,
      8,
    ]);
  });

  test('A symbol, a list or a call before a bracket is still indexed', () => {
    expect(parse('a\\left[1,2\\right]').json).toEqual(['At', 'a', 1, 2]);
    expect(parse('2x[1,2]').json).toEqual(['Multiply', 2, ['At', 'x', 1, 2]]);
    expect(parse('[1,2,3][2]').json).toEqual(['At', ['List', 1, 2, 3], 2]);
    expect(parse('[1,2,3][2]').evaluate().json).toEqual(2);
  });

  test('A bracket that does not open a list is not read as a factor', () => {
    // `[1,2)` is a half-open interval, not a list: the input stays invalid
    expect(parse('4[1,2)').isValid).toBe(false);
    expect(parse('4\\left[1,2\\right)').isValid).toBe(false);
    // A bracket group alone still reads as an interval
    expect(parse('[1,2)').json).toEqual(['Interval', 1, ['Open', 2]]);
  });
});

describe('SPACE BEFORE A BRACKET', () => {
  // LaTeX ignores plain whitespace, so a bracket after plain whitespace is
  // an index, as without the whitespace. The tokenizer reads `\ ` and `~` as
  // plain whitespace too.
  test.each([
    ['u [1,2]', ['At', 'u', 1, 2]],
    ['u \\left[1,2\\right]', ['At', 'u', 1, 2]],
    ['u \\left\\lbrack 1,2\\right\\rbrack', ['At', 'u', 1, 2]],
    ['u\\ [1,2]', ['At', 'u', 1, 2]],
    ['u~[1,2]', ['At', 'u', 1, 2]],
    ['u_1 [2]', ['At', 'u_1', 2]],
    ['u [1,2] [1]', ['At', ['At', 'u', 1, 2], 1]],
    ['u [1,2]^2', ['Power', ['At', 'u', 1, 2], 2]],
    ['[1,2,3] [2]', ['At', ['List', 1, 2, 3], 2]],
  ])('Plain whitespace, index: %s', (input, expected) => {
    const expr = parse(input);
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(expected);
  });

  test('Plain whitespace before a bracket reads as no whitespace', () => {
    for (const [spaced, tight] of [
      ['f(x) [1]', 'f(x)[1]'],
      ['\\sin x [1,2]', '\\sin x[1,2]'],
      ['2w [1,2]', '2w[1,2]'],
    ])
      expect(parse(spaced).json).toEqual(parse(tight).json);
  });

  // A visual-space command before a bracketed list makes a product
  // (Desmos semantics), whatever the left operand is.
  test.each([
    ['p\\,[1,2]', ['Multiply', 'p', ['List', 1, 2]]],
    ['p\\,\\left[1,2\\right]', ['Multiply', 'p', ['List', 1, 2]]],
    ['p\\;[1,2]', ['Multiply', 'p', ['List', 1, 2]]],
    ['p\\quad\\lbrack 1,2\\rbrack', ['Multiply', 'p', ['List', 1, 2]]],
    ['p\\hspace{1em}[1,2]', ['Multiply', 'p', ['List', 1, 2]]],
    ['p \\, [1,2]', ['Multiply', 'p', ['List', 1, 2]]],
    ['2p\\,[1,2]', ['Multiply', 2, 'p', ['List', 1, 2]]],
    ['\\pi\\,[1,2]', ['Multiply', 'Pi', ['List', 1, 2]]],
    ['4\\,[1,2]', ['Multiply', 4, ['List', 1, 2]]],
    // A suffix after the list binds to the list, not to the product
    ['p\\,[1,2]^2', ['Multiply', 'p', ['Power', ['List', 1, 2], 2]]],
    ['p\\,[1,2,3][2]', ['Multiply', 'p', ['At', ['List', 1, 2, 3], 2]]],
  ])('Visual space, product: %s', (input, expected) => {
    const expr = parse(input);
    expect(expr.isValid).toBe(true);
    expect(expr.json).toEqual(expected);
  });

  test('The raw form of a visual-space product is a juxtaposition', () => {
    expect(ce.parse('p\\,[1,2]', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      'p',
      ['List', 1, 2],
    ]);
  });

  test('The visual-space product evaluates element-wise', () => {
    expect(parse('q\\,\\left[1,2\\right]').evaluate().toString()).toBe(
      '[q,2q]'
    );
  });

  test('A bracket that does not open a list is not read as a factor', () => {
    expect(parse('p\\,[1,2)').isValid).toBe(false);
    expect(parse('p [1,2)').isValid).toBe(false);
  });

  test('Other constructs after a space are unchanged', () => {
    expect(parse('x\\in [0,1]').json).toEqual([
      'Element',
      'x',
      ['Interval', 0, 1],
    ]);
    expect(parse('x^2\\,\\{x>0\\}').json).toEqual([
      'When',
      ['Power', 'x', 2],
      ['Less', 0, 'x'],
    ]);
    expect(parse('x^2 \\{x>0\\}').json).toEqual([
      'When',
      ['Power', 'x', 2],
      ['Less', 0, 'x'],
    ]);
  });
});

describe('BRACKET AFTER A FUNCTION NAME', () => {
  // A function is not a collection and cannot be indexed: a bracketed list
  // after a function name is the argument of the function, with or without
  // whitespace, for every spelling of the bracket.
  test.each([
    ['\\sin[a,b]', ['Sin', ['List', 'a', 'b']]],
    ['\\sin [a,b]', ['Sin', ['List', 'a', 'b']]],
    ['\\sin\\left[a,b\\right]', ['Sin', ['List', 'a', 'b']]],
    ['\\sin\\lbrack a,b\\rbrack', ['Sin', ['List', 'a', 'b']]],
    ['\\sin\\left\\lbrack a,b\\right\\rbrack', ['Sin', ['List', 'a', 'b']]],
    ['\\cos[1,2]', ['Cos', ['List', 1, 2]]],
    ['\\operatorname{sin}[a,b]', ['Sin', ['List', 'a', 'b']]],
    ['\\mathrm{sin}[a]', ['Sin', ['List', 'a']]],
    ['\\Gamma[a,b]', ['Gamma', ['List', 'a', 'b']]],
    ['\\Gamma [a]', ['Gamma', ['List', 'a']]],
    ['\\Gamma\\lbrack a\\rbrack', ['Gamma', ['List', 'a']]],
    ['\\Gamma\\left[a\\right]', ['Gamma', ['List', 'a']]],
    ['\\Gamma[a,b]^2', ['Power', ['Gamma', ['List', 'a', 'b']], 2]],
  ])('Function argument: %s', (input, expected) => {
    const expr = ce.parse(input, { form: 'raw' });
    expect(expr.json).toEqual(expected);
    expect(ce.parse(input).isValid).toBe(true);
  });

  test('The list argument broadcasts', () => {
    expect(parse('\\sin[a,b]').evaluate().toString()).toBe('[sin(a),sin(b)]');
    expect(parse('\\Gamma[a,b]').evaluate().toString()).toBe(
      '[Gamma(a),Gamma(b)]'
    );
  });

  test('A bracket after the argument of a function is an index', () => {
    expect(parse('\\sin x [1,2]').json).toEqual(['Sin', ['At', 'x', 1, 2]]);
    expect(ce.parse('\\sin(x)[1]', { form: 'raw' }).json).toEqual([
      'At',
      ['Sin', 'x'],
      1,
    ]);
  });

  test('A user symbol declared as a function takes the bracket as argument', () => {
    const ce2 = new (ce.constructor as any)();
    ce2.declare('f', 'function');
    expect(ce2.parse('f[1,2]', { form: 'raw' }).json).toEqual([
      'f',
      ['List', 1, 2],
    ]);
    // An undeclared symbol is indexed
    expect(ce2.parse('g[1,2]', { form: 'raw' }).json).toEqual([
      'At',
      'g',
      1,
      2,
    ]);
  });

  test('D and N are read as variables and are indexed', () => {
    expect(ce.parse('D[1]', { form: 'raw' }).json).toEqual(['At', 'D', 1]);
    expect(ce.parse('N[1]', { form: 'raw' }).json).toEqual(['At', 'N', 1]);
  });

  test('A visual space before the bracket still makes a product', () => {
    expect(ce.parse('\\Gamma\\,[a]', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      'Gamma',
      ['List', 'a'],
    ]);
  });
});

describe('INDEX WITH \\lbrack', () => {
  // `\rbrack` closes the index as `]` does.
  test.each([
    ['u\\lbrack 1\\rbrack', ['At', 'u', 1]],
    ['u \\lbrack 1\\rbrack', ['At', 'u', 1]],
    ['u\\lbrack 1, 2\\rbrack', ['At', 'u', 1, 2]],
    ['u\\lbrack 1\\rbrack\\lbrack 2\\rbrack', ['At', ['At', 'u', 1], 2]],
    ['u\\lbrack v\\lbrack 1\\rbrack\\rbrack', ['At', 'u', ['At', 'v', 1]]],
    ['u\\lbrack 1\\rbrack^2', ['Power', ['At', 'u', 1], 2]],
    ['u\\lbrack 1\\rbrack+2', ['Add', ['At', 'u', 1], 2]],
  ])('Index: %s', (input, expected) => {
    expect(ce.parse(input, { form: 'raw' }).json).toEqual(expected);
  });
});

describe('LIST SERIALIZATION', () => {
  test('Empty list', () =>
    expect(latex(['List'])).toMatchInlineSnapshot(
      `\\bigl\\lbrack \\bigr\\rbrack`
    ));
});

describe('RANGE', () => {
  test('simple range', () => {
    expect(parse('1..5')).toMatchInlineSnapshot(`["Range", 1, 5]`);
  });

  test('simple range with step', () => {
    expect(parse('1..3..5')).toMatchInlineSnapshot(`["Range", 1, 5, 2]`);
  });

  test('range with expressions', () => {
    expect(parse('n+1..n+10')).toMatchInlineSnapshot(
      `["Range", ["Add", "n", 1], ["Add", "n", 10]]`
    );
  });

  test('range with expressions with multiplication', () => {
    expect(parse('2n..3n')).toMatchInlineSnapshot(
      `["Range", ["Multiply", 2, "n"], ["Multiply", 3, "n"]]`
    );
  });

  test('range with expressions with addition and multiplication', () => {
    expect(parse('(2n + 1)..(3n + 10)')).toMatchInlineSnapshot(`
      [
        "Range",
        ["Add", ["Multiply", 2, "n"], 1],
        ["Add", ["Multiply", 3, "n"], 10]
      ]
    `);
  });

  test('range with equality', () => {
    expect(parse('x = n+1..n+10')).toMatchInlineSnapshot(
      `["Equal", "x", ["Range", ["Add", "n", 1], ["Add", "n", 10]]]`
    );
  });

  test('range with assignment', () => {
    expect(parse('x := 5..13')).toMatchInlineSnapshot(
      `["Assign", "x", ["Range", 5, 13]]`
    );
  });
});
