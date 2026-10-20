import { ComputeEngine } from '../../../src/compute-engine';

// A symbol with two or more subscripts, such as `x_1_2`, is the canonical
// form of `Subscript(Subscript(x, 1), 2)`. Its LaTeX uses nested subscripts,
// `{x_1}_2`, which read back as the same symbol. A comma list, `x_{1,2}`,
// reads back as a different expression, `Subscript(x, Sequence(1, 2))`, so
// the serializer does not use it for such a symbol.

const ce = new ComputeEngine();
ce.declare('M', 'matrix');

function latexOf(name: string): string {
  return ce.symbol(name).latex;
}

function roundTrip(name: string): unknown {
  return ce.parse(ce.symbol(name).latex).json;
}

describe('DOUBLE SUBSCRIPT SYMBOL', () => {
  test('a symbol with two or more subscripts is written nested', () => {
    expect(latexOf('x_1_2')).toBe('{x_1}_2');
    expect(latexOf('x_1_2_3')).toBe('{{x_1}_2}_3');
    expect(latexOf('x_10_20')).toBe('{x_{10}}_{20}');
    expect(latexOf('x_n_m')).toBe('{x_{n}}_{m}');
    expect(latexOf('alpha_1_2')).toBe('{\\alpha_1}_2');
    expect(latexOf('x_alpha_beta')).toBe('{x_{\\alpha}}_{\\beta}');
    // A multi-letter base is upright. The second subscript is outside the
    // `\mathrm{}` wrapper: the parser does not accept a brace group in it.
    expect(latexOf('speed_1_2')).toBe('{\\mathrm{speed_1}}_2');
    expect(latexOf('x_hat_1_2')).toBe('{\\mathrm{\\hat{x}_1}}_2');
    // A wildcard name: the second subscript is outside the `\operatorname{}`.
    expect(latexOf('_x_1_2')).toBe('{\\operatorname{\\_x_1}}_2');
  });

  test.each([
    'x_1_2',
    'x_1_2_3',
    'x_10_20',
    'x_12_3',
    'x_n_m',
    'x_max_2',
    'A_1_2',
    'alpha_1_2',
    'x_alpha_beta',
    'speed_1_2',
    'x_hat_1_2',
    'x1_2',
    '_x_1_2',
    '__x_1_2',
  ])('the symbol %s reads back as the same symbol', (name) => {
    expect(roundTrip(name)).toEqual(name);
  });

  test('a digit run before a subscript stays in the name', () => {
    // `x1_2` is not `x_1_2`: its trailing digits are not written as a first
    // subscript.
    expect(latexOf('x1_2')).toBe('\\mathrm{x1_2}');
  });

  test.each(['x_1_2', 'x_{1}_{2}', '{x_1}_2', '{x_{1}}_{2}'])(
    '%s parses as the symbol x_1_2',
    (latex) => {
      expect(ce.parse(latex).json).toEqual('x_1_2');
    }
  );

  test('a nested Subscript is the same symbol, and reads back', () => {
    const expr = ce.box(['Subscript', ['Subscript', 'x', 1], 2]);
    expect(expr.json).toEqual('x_1_2');
    expect(ce.parse(expr.latex).json).toEqual('x_1_2');
    expect(ce.parse('{{x_{1}}_{2}}_{3}').json).toEqual('x_1_2_3');
  });

  test('a power, a prime or a function of the symbol reads back', () => {
    for (const latex of ['x_1_2^2', "x_1_2'", '\\sin(x_1_2)', 'x_1_2 y_3_4']) {
      const expr = ce.parse(latex);
      expect(ce.parse(expr.latex).isSame(expr)).toBe(true);
    }
    expect(ce.parse('x_1_2^2').latex).toBe('{x_1}_2^2');
    expect(ce.parse("x_1_2'").latex).toBe('{x_1}_2^{\\prime}');
  });

  test('a single subscript is not changed', () => {
    expect(latexOf('x_1')).toBe('x_1');
    expect(latexOf('x_12')).toBe('x_{12}');
    expect(latexOf('alpha_1')).toBe('\\alpha_1');
    expect(latexOf('speed_max')).toBe('\\mathrm{speed_{max}}');
    expect(ce.parse('x_{12}').json).toEqual('x_12');
  });

  test('a comma list in a subscript is not a symbol', () => {
    const expr = ce.parse('x_{1,2}');
    expect(expr.json).toEqual(['Subscript', 'x', ['Sequence', 1, 2]]);
    expect(expr.latex).toBe('x_{1, 2}');
    expect(ce.parse(expr.latex).json).toEqual(expr.json);
  });

  test('a matrix element is not changed', () => {
    const expr = ce.box(['At', 'M', 1, 2]);
    expect(expr.latex).toBe('M[1, 2]');
    expect(expr.toLatex({ indexStyle: 'subscript' })).toBe('M_{1,2}');
    expect(ce.parse('M[1, 2]').json).toEqual(['At', 'M', 1, 2]);
  });
});

// A style written around the base only (`\mathbf{x}_1`) and a style written
// around the base and the subscript (`\mathbf{x_1}`) are two different
// symbols, `x_bold_1` and `x_1_bold`. Each one is written in the spelling
// that reads back as itself.
describe('STYLED SYMBOL WITH A SUBSCRIPT', () => {
  test.each([
    ['\\mathbf{x}_1', 'x_bold_1', '\\mathbf{x}_1'],
    ['{\\mathbf{x}_1}_2', 'x_bold_1_2', '{\\mathbf{x}_1}_2'],
    ['\\mathbf{x}_1_2', 'x_bold_1_2', '{\\mathbf{x}_1}_2'],
    ['\\mathbf{x_1}', 'x_1_bold', '\\mathbf{x_1}'],
    ['\\mathbf{x_{12}}', 'x_12_bold', '\\mathbf{x_{12}}'],
    // Two subscripts in a row are not valid LaTeX: the output nests them.
    ['\\mathbf{x_1_2}', 'x_1_2_bold', '\\mathbf{{x_1}_2}'],
    ['\\mathbf{{x_1}_2}', 'x_1_2_bold', '\\mathbf{{x_1}_2}'],
    ['\\mathbf{{{x_1}_2}_3}', 'x_1_2_3_bold', '\\mathbf{{{x_1}_2}_3}'],
    ['\\mathbf{{speed_1}_2}', 'speed_1_2_bold', '\\mathbf{{speed_1}_2}'],
    ['{\\mathbf{x_1}}_2', 'x_1_bold_2', '{\\mathbf{x_1}}_2'],
    ['\\mathbf{x}_{a}', 'x_bold_a', '\\mathbf{x}_{a}'],
    ['x_{\\mathbf{a}}', 'x_a_bold', 'x_{\\mathbf{a}}'],
    ['\\mathbf{speed}_1', 'speed_bold_1', '\\mathbf{speed}_1'],
    ['\\mathbf{speed_1}', 'speed_1_bold', '\\mathbf{speed_1}'],
    ['\\mathbf{\\alpha}_1', 'alpha_bold_1', '\\mathbf{\\alpha}_1'],
    ['\\mathbf{\\hat{x}}_1', 'x_hat_bold_1', '\\mathbf{\\hat{x}}_1'],
    ['\\mathit{\\mathbf{x}}_1', 'x_bold_italic_1', '\\mathit{\\mathbf{x}}_1'],
    ['\\mathbb{x}_1_2', 'x_doublestruck_1_2', '{\\mathbb{x}_1}_2'],
    ['\\mathrm{x}_1', 'x_upright_1', '\\mathrm{x}_1'],
    ['\\mathbf{x1}', 'x1_bold', '\\mathbf{x1}'],
  ])('%s parses as %s, written %s', (input, name, output) => {
    const expr = ce.parse(input);
    expect(expr.json).toEqual(name);
    expect(expr.latex).toBe(output);
    expect(ce.parse(expr.latex).json).toEqual(name);
  });

  test('two braced subscripts in a style wrapper are two parts of the name', () => {
    expect(ce.parse('\\mathrm{x_{1}_{2}}').json).toEqual('x_1_2');
    expect(ce.parse('\\mathrm{speed_{1}_{2}}').json).toEqual('speed_1_2');
    expect(ce.parse('\\operatorname{\\_x_{1}_{2}}').json).toEqual('_x_1_2');
    expect(ce.parse('\\mathbf{x_{1}_{2}}').json).toEqual('x_1_2_bold');
    // One braced subscript is not changed.
    expect(ce.parse('\\mathrm{x_{12}}').json).toEqual('x_12');
  });

  test('a digit subscript with only the upright style is written without it', () => {
    // No spelling reads back as `x_1_upright`: the parser drops the upright
    // style of a name of more than one character (`\mathrm{x_1}` is `x_1`),
    // and it spells out a styled digit (`x_{\mathrm{1}}` is `x_one`). The
    // nearest spelling is `x_1`.
    expect(latexOf('x_1_upright')).toBe('x_1');
    expect(roundTrip('x_1_upright')).toEqual('x_1');
    expect(roundTrip('x__a_1_upright')).toEqual('x__a_1');
  });

  test('a wildcard name with a digit subscript and a style reads back', () => {
    // The `\_` of the wildcard name is inside the style:
    // `\operatorname{\_\mathbf{x_1}}` does not parse, and the older spelling,
    // `\operatorname{\_x_{\mathbf{1}}}`, read back as `_x_one_bold`.
    expect(latexOf('_x_1_bold')).toBe('\\operatorname{\\mathbf{\\_x_1}}');
    expect(roundTrip('_x_1_bold')).toEqual('_x_1_bold');
  });
});

describe('DOUBLE SUBSCRIPT SYMBOL WITH AN INDEXED COLLECTION BASE', () => {
  test('a name whose base is a matrix reads back as an index', () => {
    // With `A` a matrix, neither `{A_1}_2` nor `A_{1,2}` reads back as the
    // symbol `A_1_2`: the subscript of `A` is an index. This pins the current
    // output.
    const engine = new ComputeEngine();
    engine.declare('A', 'matrix');
    const latex = engine.symbol('A_1_2').latex;
    expect(latex).toBe('{A_1}_2');
    expect(engine.parse(latex).json).toEqual(['Subscript', ['At', 'A', 1], 2]);
  });
});
