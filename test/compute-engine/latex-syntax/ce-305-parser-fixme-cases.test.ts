import { ComputeEngine } from '../../../src/compute-engine';

const ce = new ComputeEngine();
const raw = (s: string) => ce.parse(s, { form: 'raw' }).json;

// CE-305.2: `\over` and `\choose` are not associative. TeX accepts one of
// them in a group, so a chain is an error. Before the fix, the chain was read
// right-associatively: `1\over 2\over 3` was 3/2.
describe('CE-305.2 chained \\over', () => {
  test('a chain is a non-associative-operator error', () => {
    const expr = ce.parse('1\\over 2 \\over 3');
    expect(expr.isValid).toBe(false);
    expect(raw('1\\over 2 \\over 3')).toEqual([
      'Divide',
      1,
      ['Error', "'non-associative-operator'", ['LatexString', "'2 \\over3'"]],
    ]);
    expect(ce.parse('n\\choose k \\choose j').isValid).toBe(false);
  });

  test('one \\over and a braced group are valid', () => {
    expect(raw('1\\over 2')).toEqual(['Divide', 1, 2]);
    expect(raw('{1\\over 2}\\over 3')).toEqual(['Divide', ['Divide', 1, 2], 3]);
    expect(raw('n\\choose k')).toEqual(['Binomial', 'n', 'k']);
  });
});

// CE-305.3: a degree sign after the parenthesized argument of a trigonometric
// function applies to the argument. Before the fix, it applied to the result:
// `\tan(90-x)\degree` was `Degrees(Tan(90-x))`.
describe('CE-305.3 postfix \\degree after a trigonometric argument', () => {
  test.each([
    '\\tan(90-1)\\degree',
    '\\tan(90-1)^\\circ',
    '\\tan(90-1)^{\\circ}',
    '\\tan(90-1)°',
  ])('%s', (latex) => {
    expect(raw(latex)).toEqual(['Tan', ['Degrees', ['Subtract', 90, 1]]]);
  });

  test('the value is tan(89°)', () => {
    const v = ce.parse('\\tan(90-1)\\degree').N().re;
    expect(v).toBeCloseTo(Math.tan((89 * Math.PI) / 180), 10);
  });

  test('other postfix operators still apply to the call', () => {
    expect(raw('\\sin(30)!')).toEqual(['Factorial', ['Sin', 30]]);
    expect(raw('\\sin(x)^2')).toEqual(['Power', ['Sin', 'x'], 2]);
  });
});

// CE-305.5: a differential in the denominator of an integrand is malformed.
// Before the fix, `\int\frac{3x}{5dx}` was a valid integral over `d` and `x`.
describe('CE-305.5 differential in a denominator', () => {
  test('is an error', () => {
    expect(ce.parse('\\int\\frac{3x}{5dx}').isValid).toBe(false);
  });

  test.each([
    '\\int 2\\frac{3x}{5dx}',
    '\\int -\\frac{3x}{5dx}',
    '\\int (\\frac{3x}{5dx})',
    '\\int 1+\\frac{3x}{5dx}',
    '\\int \\sin\\frac{x}{5dx}',
  ])('is an error inside the body: %s', (latex) => {
    expect(ce.parse(latex).isValid).toBe(false);
    expect(JSON.stringify(raw(latex))).toContain('unexpected-differential');
  });

  test('a differential in the numerator is still read', () => {
    expect(raw('\\int\\frac{3xdx}{5}')).toEqual([
      'Integrate',
      ['Divide', ['InvisibleOperator', 3, 'x'], 5],
      'x',
    ]);
    expect(raw('\\int\\frac{dx}{x}')).toEqual([
      'Integrate',
      ['Divide', 1, 'x'],
      'x',
    ]);
  });
});
