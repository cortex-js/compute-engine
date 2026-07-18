import { N, evaluate, simplify } from '../../src/compute-engine';

describe('Free functions: lenient parsing and strict escape hatch', () => {
  // By default the string helpers parse in lenient (non-strict) mode, so
  // unbraced multi-digit scripts absorb all the digits.
  test('N("x^23") is x^{23} in the default (lenient) mode', () => {
    expect(N('x^23').json).toEqual(['Power', 'x', 23]);
  });

  // Passing { strict: true } restores the strict LaTeX grammar, where the two
  // digits are two adjacent scripts (x^2 · 3 → 3x²).
  test('N("x^23", { strict: true }) restores the strict meaning (3x²)', () => {
    const strict = N('x^23', { strict: true });
    expect(strict.json).toEqual(['Multiply', 3, ['Power', 'x', 2]]);
  });

  test('evaluate honors { strict: true }', () => {
    expect(evaluate('x^23', { strict: true }).json).toEqual([
      'Multiply',
      3,
      ['Power', 'x', 2],
    ]);
  });

  test('simplify honors { strict: true }', () => {
    expect(simplify('x^23', { strict: true }).json).toEqual([
      'Multiply',
      3,
      ['Power', 'x', 2],
    ]);
  });

  // Lenient features remain the default (bare functions, multi-letter symbols).
  test('lenient default still accepts documented AsciiMath syntax', () => {
    expect(evaluate('sqrt4').json).toEqual(2);
    expect(simplify('sin(alpha)').json).toEqual(['Sin', 'alpha']);
  });
});

describe('Bare combinatorics function names (lenient mode)', () => {
  // `nPr(n, k)` is the k-permutation count P(n, k) = C(n, k)·k!; it was
  // formerly absent from BARE_FUNCTION_MAP and parsed as letter soup.
  test('nPr(5, 2) is the permutation count 20', () => {
    expect(evaluate('nPr(5, 2)').json).toEqual(20);
  });

  test('nCr(5, 2) is the binomial coefficient 10', () => {
    expect(evaluate('nCr(5, 2)').json).toEqual(10);
  });
});
