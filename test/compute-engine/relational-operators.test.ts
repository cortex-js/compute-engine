import { ComputeEngine } from '../../src/compute-engine';

const ce = new ComputeEngine();

describe('Approximate equality operators', () => {
  describe('Approx (≈)', () => {
    test('Equal numbers are approximately equal', () => {
      expect(ce.expr(['Approx', 3, 3]).evaluate().json).toBe('True');
    });

    test('Numbers within tolerance are approximately equal', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['Approx', 1, 1 + tol / 2]).evaluate().json
      ).toBe('True');
    });

    test('Numbers outside tolerance are not approximately equal', () => {
      expect(ce.expr(['Approx', 1, 2]).evaluate().json).toBe('False');
    });

    test('Pi ≈ 3.14159265 within tolerance', () => {
      expect(
        ce.expr(['Approx', 'Pi', 3.141592653589793]).evaluate().json
      ).toBe('True');
    });

    test('Pi is not approximately 3', () => {
      expect(ce.expr(['Approx', 'Pi', 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: all close', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['Approx', 1, 1 + tol / 3, 1 + tol / 4]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: one pair not close', () => {
      expect(
        ce.expr(['Approx', 1, 1.0000001, 5]).evaluate().json
      ).toBe('False');
    });

    test('Single argument returns True', () => {
      expect(ce.expr(['Approx', 3]).evaluate().json).toBe('True');
    });

    test('Symbolic arguments return undefined', () => {
      const result = ce.expr(['Approx', 'x', 'y']).evaluate();
      // When evaluate can't determine a result, it returns the expression
      expect(result.operator).toBe('Approx');
    });
  });

  describe('TildeFullEqual (≅)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['TildeFullEqual', 5, 5]).evaluate().json).toBe('True');
    });

    test('Numbers within tolerance', () => {
      const tol = ce.tolerance;
      expect(
        ce.expr(['TildeFullEqual', 2, 2 + tol / 2]).evaluate().json
      ).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['TildeFullEqual', 1, 2]).evaluate().json
      ).toBe('False');
    });
  });

  describe('TildeEqual (≃)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['TildeEqual', 7, 7]).evaluate().json).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['TildeEqual', 1, 100]).evaluate().json
      ).toBe('False');
    });
  });

  describe('ApproxEqual (≊)', () => {
    test('Equal numbers', () => {
      expect(ce.expr(['ApproxEqual', 10, 10]).evaluate().json).toBe('True');
    });

    test('Numbers outside tolerance', () => {
      expect(
        ce.expr(['ApproxEqual', 0, 1]).evaluate().json
      ).toBe('False');
    });
  });

  describe('ApproxNotEqual', () => {
    test('Different numbers are approximately not equal', () => {
      expect(
        ce.expr(['ApproxNotEqual', 1, 2]).evaluate().json
      ).toBe('True');
    });

    test('Close numbers are not approximately-not-equal', () => {
      expect(
        ce.expr(['ApproxNotEqual', 5, 5]).evaluate().json
      ).toBe('False');
    });
  });
});

describe('Negated approximate equality operators', () => {
  describe('NotApprox', () => {
    test('Different numbers', () => {
      expect(ce.expr(['NotApprox', 1, 2]).evaluate().json).toBe('True');
    });

    test('Same numbers', () => {
      expect(ce.expr(['NotApprox', 3, 3]).evaluate().json).toBe('False');
    });
  });

  describe('NotTildeFullEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotTildeFullEqual', 1, 100]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotTildeFullEqual', 5, 5]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotTildeEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotTildeEqual', 1, 50]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotTildeEqual', 7, 7]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotApproxEqual', () => {
    test('Different numbers', () => {
      expect(
        ce.expr(['NotApproxEqual', 0, 1]).evaluate().json
      ).toBe('True');
    });

    test('Same numbers', () => {
      expect(
        ce.expr(['NotApproxEqual', 10, 10]).evaluate().json
      ).toBe('False');
    });
  });
});

describe('Ordering operators', () => {
  describe('Precedes (≺)', () => {
    test('2 ≺ 5', () => {
      expect(ce.expr(['Precedes', 2, 5]).evaluate().json).toBe('True');
    });

    test('5 ≺ 2 is false', () => {
      expect(ce.expr(['Precedes', 5, 2]).evaluate().json).toBe('False');
    });

    test('3 ≺ 3 is false', () => {
      expect(ce.expr(['Precedes', 3, 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: 1 ≺ 2 ≺ 3', () => {
      expect(
        ce.expr(['Precedes', 1, 2, 3]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: 1 ≺ 3 ≺ 2 is false', () => {
      expect(
        ce.expr(['Precedes', 1, 3, 2]).evaluate().json
      ).toBe('False');
    });

    test('Symbolic arguments return undefined', () => {
      const result = ce.expr(['Precedes', 'x', 'y']).evaluate();
      expect(result.operator).toBe('Precedes');
    });
  });

  describe('Succeeds (≻)', () => {
    test('5 ≻ 2', () => {
      expect(ce.expr(['Succeeds', 5, 2]).evaluate().json).toBe('True');
    });

    test('2 ≻ 5 is false', () => {
      expect(ce.expr(['Succeeds', 2, 5]).evaluate().json).toBe('False');
    });

    test('3 ≻ 3 is false', () => {
      expect(ce.expr(['Succeeds', 3, 3]).evaluate().json).toBe('False');
    });

    test('Multi-argument chain: 3 ≻ 2 ≻ 1', () => {
      expect(
        ce.expr(['Succeeds', 3, 2, 1]).evaluate().json
      ).toBe('True');
    });

    test('Multi-argument chain: 3 ≻ 1 ≻ 2 is false', () => {
      expect(
        ce.expr(['Succeeds', 3, 1, 2]).evaluate().json
      ).toBe('False');
    });
  });

  describe('NotPrecedes', () => {
    test('5 does not precede 2', () => {
      expect(ce.expr(['NotPrecedes', 5, 2]).evaluate().json).toBe('True');
    });

    test('2 does not precede 5 is false', () => {
      expect(ce.expr(['NotPrecedes', 2, 5]).evaluate().json).toBe('False');
    });
  });

  describe('NotSucceeds', () => {
    test('2 does not succeed 5', () => {
      expect(ce.expr(['NotSucceeds', 2, 5]).evaluate().json).toBe('True');
    });

    test('5 does not succeed 2 is false', () => {
      expect(ce.expr(['NotSucceeds', 5, 2]).evaluate().json).toBe('False');
    });
  });
});

describe('LaTeX round-trip', () => {
  test('\\approx parses and evaluates', () => {
    const expr = ce.parse('3.14 \\approx 3.14');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\cong parses and evaluates', () => {
    const expr = ce.parse('5 \\cong 5');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\prec parses and evaluates', () => {
    const expr = ce.parse('1 \\prec 2');
    expect(expr.evaluate().json).toBe('True');
  });

  test('\\succ parses and evaluates', () => {
    const expr = ce.parse('5 \\succ 3');
    expect(expr.evaluate().json).toBe('True');
  });
});

// REVIEW.md B14: Congruent used JS `%` (wrong for negatives) and read `.value`
// as a JS number, so it bailed under the bignum-preferred default precision.
describe('Congruent modular arithmetic (REVIEW.md B14)', () => {
  it('evaluates under the default (bignum) precision', () => {
    expect(ce.expr(['Congruent', 8, 1, 7]).evaluate().json).toBe('True');
    expect(ce.expr(['Congruent', 2, 3, 7]).evaluate().json).toBe('False');
  });
  it('handles negative operands with a floored modulo', () => {
    // -1 ≡ 6 (mod 7); -8 ≡ 6 (mod 7)
    expect(ce.expr(['Congruent', -1, 6, 7]).evaluate().json).toBe('True');
    expect(ce.expr(['Congruent', -8, 6, 7]).evaluate().json).toBe('True');
    expect(ce.expr(['Congruent', -1, 13, 7]).evaluate().json).toBe('True');
  });
});

// A mixed chained inequality (different operators, e.g. `5 ≤ b < 7`) must keep
// the middle term in both links. The canonicalizer used to splice the wrong
// operand of the nested relation, dropping it: `5 ≤ b < 7` became
// `And(5 ≤ 7, b < 7)`, which is true for any `b` (e.g. `3 ≤ 2 < 7` wrongly
// evaluated to True).
describe('Mixed chained inequalities (playground 5≤b<7)', () => {
  it('keeps the middle term: a ≤ b < c', () => {
    expect(ce.parse('5 \\le b \\lt 7').json).toEqual([
      'And',
      ['LessEqual', 5, 'b'],
      ['Less', 'b', 7],
    ]);
  });

  it('keeps the middle term: a < b ≤ c', () => {
    expect(ce.parse('5 \\lt b \\le 7').json).toEqual([
      'And',
      ['LessEqual', 'b', 7],
      ['Less', 5, 'b'],
    ]);
  });

  it('handles a longer mixed chain: a ≤ b ≤ c < d', () => {
    expect(ce.parse('a \\le b \\le c \\lt d').json).toEqual([
      'And',
      ['LessEqual', 'a', 'b', 'c'],
      ['Less', 'c', 'd'],
    ]);
  });

  it('evaluates to the correct truth value', () => {
    expect(ce.parse('5 \\le 6 \\lt 7').evaluate().json).toBe('True');
    expect(ce.parse('5 \\le 8 \\lt 7').evaluate().json).toBe('False');
    // Regression: 3 ≤ 2 < 7 must be False (the first link 3 ≤ 2 is false)
    expect(ce.parse('3 \\le 2 \\lt 7').evaluate().json).toBe('False');
  });
});

// A chain that *flips direction* (e.g. `a ≤ b > c`) must decompose into the
// pairwise `And` that shares the middle term `b` in each link. Previously the
// Greater→Less normalization reversed the nested chain's operands, and the
// canonicalizer spliced the wrong boundary term, producing wrong truth values
// (e.g. `1 ≤ 2 > 0` — a true statement — evaluated to False).
describe('Mixed-DIRECTION chained inequalities', () => {
  it('a ≤ b > c → And(a ≤ b, b > c)', () => {
    expect(ce.parse('a \\le b > c').json).toEqual([
      'And',
      ['LessEqual', 'a', 'b'],
      ['Less', 'c', 'b'],
    ]);
  });

  it('a > b < c → And(a > b, b < c)', () => {
    expect(ce.parse('a > b < c').json).toEqual([
      'And',
      ['Less', 'b', 'a'],
      ['Less', 'b', 'c'],
    ]);
  });

  it('1 = 2 > 0 → And(1 = 2, 2 > 0)', () => {
    expect(ce.parse('1 = 2 > 0').json).toEqual([
      'And',
      ['Less', 0, 2],
      ['Equal', 1, 2],
    ]);
  });

  it('evaluates flipped chains with the correct truth value', () => {
    // 1 ≤ 2 > 0 is True (1 ≤ 2 and 2 > 0)
    expect(ce.parse('1 \\le 2 > 0').evaluate().json).toBe('True');
    // 3 ≥ 2 < 4 is True (3 ≥ 2 and 2 < 4)
    expect(ce.parse('3 \\ge 2 < 4').evaluate().json).toBe('True');
    // 5 > 4 < 2 is False (5 > 4 but not 4 < 2)
    expect(ce.parse('5 > 4 < 2').evaluate().json).toBe('False');
    // 1 = 2 > 0 is False (1 ≠ 2)
    expect(ce.parse('1 = 2 > 0').evaluate().json).toBe('False');
  });

  it('same-direction chains keep their n-ary form', () => {
    expect(ce.parse('1 < 2 < 3').json).toEqual(['Less', 1, 2, 3]);
    expect(ce.parse('1 < 2 < 3').evaluate().json).toBe('True');
    expect(ce.parse('3 < 2 < 1').evaluate().json).toBe('False');
    expect(ce.parse('a > b > c').json).toEqual(['Less', 'c', 'b', 'a']);
  });
});
