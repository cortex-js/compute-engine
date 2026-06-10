import { engine as ce } from '../utils';

const TESTS: [string, string][] = [
  ['1234', '1234.0'],
  ['2+2', '4'],
  ['x^2', 'x\\times x'],
  ['\\frac{1}{2}', '0.5'],
  ['\\sqrt{4}', '2'],
  ['\\sin(\\frac{\\pi}{2})', '1'],
  ['\\log_{10}(100)', '2'],
  // ['\\int_{0}^{1} x^2 dx', '\\frac{1}{3}'],
  ['\\sum_{n=1}^{10} n', '55'],
  // ['\\lim_{x \\to \\infty} (1 + \\frac{1}{x})^x', 'e'],
  ['2x+1=0', '2x=-1'],
  ['2x+1=0', 'x=-\\frac12'],
  ['x^2+2x+1=0', '(x+1)^2=0'],
  ['x^2+1=0', 'x^2=-1'],
  ['20x+10=0', '2x+1=0'],
  ['3x + 1 = 0', '6x + 2 = 0'],
  ['2(13.1+x)<(10-5)', '26.2+2x<5'],
  ['x^2 + 2x + 1 = 0', 'x^2 + 2x = -1'],
  // Same unknowns, structurally equal after expand/simplify
  ['(x+1)^2', 'x^2+2x+1'],
];

// Tests for equation equivalence - equations that should NOT be equal
// (different solution sets)
const NOT_EQUAL_EQUATIONS: [string, string][] = [
  // Different solution sets: x^2-1=0 has solutions {-1, 1}, x-1=0 has solution {1}
  ['x^2 - 1 = 0', 'x - 1 = 0'],
  // x=1 vs x=2 are completely different equations
  ['x = 1', 'x = 2'],
  // x+1=0 and x+2=0 have different solutions
  ['x + 1 = 0', 'x + 2 = 0'],
  // 0=0 (identity, always true) vs x=0 (only true when x=0)
  ['0 = 0', 'x = 0'],
];

describe('a.isEqual(b)', () => {
  for (const test of TESTS) {
    const [a, b] = test;
    it(`("${a}").isEqual("${b}")`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(true));
  }
});

describe('Equation equivalence - non-equivalent equations', () => {
  for (const test of NOT_EQUAL_EQUATIONS) {
    const [a, b] = test;
    it(`("${a}").isEqual("${b}") should be false`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(false));
  }
});

// REVIEW.md B13: the sample-based equivalence check substituted the SAME value
// for every unknown, so multi-unknown equations collapsed — e.g. `x + y` and
// `2x` both became `2v` and compared equal. Each unknown now gets an
// independent value.
describe('Equation equivalence - multiple unknowns (REVIEW.md B13)', () => {
  const EQUIVALENT: [string, string][] = [
    ['x+y=0', '2x+2y=0'], // differ by a non-zero constant factor
    ['x+y=0', 'y+x=0'], // reordered
    ['x+2y=0', '3x+6y=0'],
  ];
  const NOT_EQUIVALENT: [string, string][] = [
    ['x+y=0', '2x=0'], // the original false positive
    ['x-y=0', 'x+y=0'],
    ['x+y=0', 'x+2y=0'],
  ];

  for (const [a, b] of EQUIVALENT)
    it(`("${a}").isEqual("${b}") is true`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(true));

  for (const [a, b] of NOT_EQUIVALENT)
    it(`("${a}").isEqual("${b}") is false`, () =>
      expect(ce.parse(a).isEqual(ce.parse(b))).toBe(false));
});
