import { engine as ce } from '../utils';

const TESTS: [string, string][] = [
  ['1234', '1234.0'],
  ['2+2', '4'],
  ['x^2', 'x^2'],
  ['\\frac{1}{2}', '0.5'],
  ['\\sqrt{4}', '2'],
  ['\\sin(\\frac{\\pi}{2})', '1'],
  ['\\log_{10}(100)', '2'],
  ['\\int_{0}^{1} x^2 dx', '\\frac{1}{3}'],
  ['\\sum_{n=1}^{10} n', '55'],
  // ['\\lim_{x \\to \\infty} (1 + \\frac{1}{x})^x', 'e'],
  ['2x+1=0', '2x=-1'],
  ['2x+1=0', 'x=-\\frac12'],
  ['x^2+2x+1=0', '(x+1)^2=0'],
  ['x^2+1=0', 'x^2=-1'],
  ['20x+10=0', '2x+1=0'],
  ['3x + 1 = 0', '6x + 2 = 0'],
  ['2(13.1+x)<(10-5)', '26.2+2x<5'],
];

describe('a.isEqual(b)', () => {
  for (const test of TESTS) {
    const [a, b] = test;
    it(`("${a}").isEqual("${b}")`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(true));
  }
});
