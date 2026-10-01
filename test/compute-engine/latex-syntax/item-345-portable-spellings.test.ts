import { ComputeEngine } from '../../../src/compute-engine';
import type { MathJsonExpression } from '../../../src/math-json/types';

/**
 * #345: constants, sets and functions that were written with a command that
 * is not standard LaTeX (`\lcm`, `\Z`, `\degree`, or a `\mathrm{Log2}` that
 * no other tool reads as a logarithm). Each is now written with a standard
 * spelling, and every new spelling parses back to the same expression.
 */

const ce = new ComputeEngine();

const raw = (json: MathJsonExpression) => ce.box(json, { form: 'raw' }).latex;

const roundTrips = (json: MathJsonExpression, latex: string) =>
  ce.parse(latex).isSame(ce.box(json));

const cases: [string, MathJsonExpression, string][] = [
  ['LCM(a, b)', ['LCM', 'a', 'b'], '\\operatorname{lcm}(a, b)'],
  ['Log2(x)', ['Log2', 'x'], '\\log_{2}(x)'],
  ['Log10(x)', ['Log10', 'x'], '\\log_{10}(x)'],
  ['EulerGamma', 'EulerGamma', '\\gamma'],
  ['Degrees(30)', ['Degrees', 30], '30^{\\circ}'],
  ['Integers', 'Integers', '\\mathbb{Z}'],
  ['RationalNumbers', 'RationalNumbers', '\\mathbb{Q}'],
  ['RealNumbers', 'RealNumbers', '\\mathbb{R}'],
  ['ComplexNumbers', 'ComplexNumbers', '\\mathbb{C}'],
  ['NonNegativeIntegers', 'NonNegativeIntegers', '\\mathbb{N}'],
  ['PositiveIntegers', 'PositiveIntegers', '\\mathbb{N}^*'],
  ['NegativeIntegers', 'NegativeIntegers', '\\mathbb{Z}_{<0}'],
  ['NonPositiveIntegers', 'NonPositiveIntegers', '\\mathbb{Z}_{\\le0}'],
  ['PositiveNumbers', 'PositiveNumbers', '\\mathbb{R}_{>0}'],
  ['NegativeNumbers', 'NegativeNumbers', '\\mathbb{R}_{<0}'],
  ['NonNegativeNumbers', 'NonNegativeNumbers', '\\mathbb{R}_{\\geq0}'],
  ['NonPositiveNumbers', 'NonPositiveNumbers', '\\mathbb{R}_{\\le0}'],
];

describe('345 portable spellings', () => {
  for (const [name, json, latex] of cases) {
    test(`${name} writes ${latex} and reads it back`, () => {
      expect(raw(json)).toBe(latex);
      expect(roundTrips(json, latex)).toBe(true);
    });
  }
});

describe('345 the MathLive-only spellings still parse', () => {
  const legacy: [string, MathJsonExpression][] = [
    ['\\lcm(a, b)', ['LCM', 'a', 'b']],
    ['30\\degree', ['Degrees', 30]],
    ['\\Z', 'Integers'],
    ['\\Q', 'RationalNumbers'],
    ['\\R', 'RealNumbers'],
    ['\\C', 'ComplexNumbers'],
    ['\\N', 'NonNegativeIntegers'],
    ['\\N^*', 'PositiveIntegers'],
    ['\\Z_{<0}', 'NegativeIntegers'],
    ['\\R_{>0}', 'PositiveNumbers'],
  ];
  for (const [latex, json] of legacy)
    test(`${latex} parses`, () => {
      expect(roundTrips(json, latex)).toBe(true);
    });
});

describe('345 a wrong number of arguments is written as a function call', () => {
  test('Mod(a, n, 1)', () => {
    expect(raw(['Mod', 'a', 'n', 1])).toBe('\\mathrm{Mod}(a, n, 1)');
  });

  test('Mod(a)', () => {
    expect(raw(['Mod', 'a'])).toBe('\\mathrm{Mod}(a)');
  });

  test('Interval(List(0, 1)) has no trailing comma', () => {
    expect(raw(['Interval', ['List', 0, 1]])).toBe(
      '\\mathrm{Interval}(\\bigl\\lbrack0, 1\\bigr\\rbrack)'
    );
  });

  test('Interval(0, 1, 2)', () => {
    expect(raw(['Interval', 0, 1, 2])).toBe('\\mathrm{Interval}(0, 1, 2)');
  });

  test('Log2(x, y) and LCM() keep their arguments', () => {
    expect(raw(['Log2', 'x', 'y'])).toBe('\\mathrm{Log2}(x, y)');
    expect(raw(['LCM'])).toBe('\\operatorname{lcm}()');
  });
});

describe('345 the glyphs of i and e are serialization options', () => {
  test('defaults are \\imaginaryI and \\exponentialE', () => {
    expect(ce.box('ImaginaryUnit').toLatex()).toBe('\\imaginaryI');
    expect(ce.box('ExponentialE').toLatex()).toBe('\\exponentialE');
    expect(ce.box(['Complex', 1, 2]).toLatex()).toBe('1+2\\imaginaryI');
  });

  test('imaginaryUnit is honoured by the symbol and by complex numbers', () => {
    const opt = { imaginaryUnit: '\\mathrm{i}' };
    expect(ce.box('ImaginaryUnit').toLatex(opt)).toBe('\\mathrm{i}');
    expect(ce.box(['Complex', 1, 2]).toLatex(opt)).toBe('1+2\\mathrm{i}');
    expect(ce.box(['Complex', 1, -1]).toLatex(opt)).toBe('1-\\mathrm{i}');
    expect(
      ce
        .parse(ce.box(['Complex', 1, 2]).toLatex(opt))
        .isSame(ce.box(['Complex', 1, 2]))
    ).toBe(true);
  });

  test('exponentialE is honoured', () => {
    const opt = { exponentialE: '\\mathrm{e}' };
    expect(ce.box('ExponentialE').toLatex(opt)).toBe('\\mathrm{e}');
    expect(
      ce.box(['Power', 'ExponentialE', 'x'], { form: 'raw' }).toLatex(opt)
    ).toContain('\\mathrm{e}');
    expect(ce.parse('\\mathrm{e}').isSame(ce.box('ExponentialE'))).toBe(true);
  });
});
