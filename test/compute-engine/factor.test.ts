import {
  Expression,
  ComputeEngine,
  factor as factorFn,
} from '../../src/compute-engine';
import {
  factor,
  factorPerfectSquare,
  factorDifferenceOfSquares,
  factorQuadratic,
  factorPolynomial,
  factorByRationalRoots,
  together,
} from '../../src/compute-engine/boxed-expression/factor';
import { cancelCommonFactors } from '../../src/compute-engine/boxed-expression/polynomials';

const ce = new ComputeEngine();

function parse(latex: string): Expression {
  return ce.parse(latex);
}

// REVIEW.md G13: factor()'s Add case takes the gcd of term coefficients to
// extract content; a complex coefficient (the `i` in `1 + i`) has no gcd, so
// `gcd` returned NaN and poisoned the whole result. factor() must leave such
// sums unfactored — otherwise dividing a Gaussian integer destroys it at
// boxing time (Divide((1+i), 2) → Multiply(1/2, NaN)).
describe('Gaussian-integer sums (G13)', () => {
  it('factor(1 + i) is not NaN', () => {
    const r = factor(ce.expr(['Add', 1, 'ImaginaryUnit']));
    expect(r.isNaN).not.toBe(true);
    expect(r.isSame(ce.expr(['Add', 1, 'ImaginaryUnit']))).toBe(true);
  });

  it('factor(2 + 2i) is not NaN', () => {
    const r = factor(ce.expr(['Add', 2, ['Multiply', 2, 'ImaginaryUnit']]));
    expect(r.isNaN).not.toBe(true);
  });

  it('dividing a Gaussian integer by an integer preserves the value', () => {
    const q = ce.expr(['Divide', ['Add', 1, 'ImaginaryUnit'], 2]);
    expect(q.isNaN).not.toBe(true);
    const n = q.N();
    expect(n.re).toBeCloseTo(0.5, 12);
    expect(n.im).toBeCloseTo(0.5, 12);
  });
});

// REVIEW.md A10: commonTerms early-returned when the numeric gcd was 1,
// skipping symbolic common factors — so `factor` could not cancel `x` from
// `x·y < x·z` even when `x > 0`.
describe('Common symbolic factors (A10)', () => {
  it('factor cancels a positive symbolic common factor', () => {
    const e = new ComputeEngine();
    e.assume(['Greater', 'x', 0]);
    const r = factor(e.expr(['Less', ['Multiply', 'x', 'y'], ['Multiply', 'x', 'z']]));
    expect(r.toString()).toBe('y < z');
  });
});

describe('Perfect Square Trinomial Factoring', () => {
  test('x² + 2x + 1 → (x+1)²', () => {
    const expr = parse('x^2 + 2x + 1');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    // Canonical form is Power with exponent 2, not Square
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
    expect(factored?.op1?.latex).toBe('x+1');
  });

  test('x² - 2x + 1 → (x-1)²', () => {
    const expr = parse('x^2 - 2x + 1');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
    expect(factored?.op1?.latex).toBe('x-1');
  });

  test('a² + 2ab + b² → (a+b)²', () => {
    const expr = parse('a^2 + 2ab + b^2');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
    // Check that the base is a+b (order may vary)
    const base = factored?.op1;
    expect(base?.operator).toBe('Add');
  });

  test('a² - 2ab + b² → (a-b)²', () => {
    const expr = parse('a^2 - 2ab + b^2');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
  });

  test('4x² + 12x + 9 → (2x+3)²', () => {
    const expr = parse('4x^2 + 12x + 9');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
  });

  test('4x² - 12x + 9 → (2x-3)²', () => {
    const expr = parse('4x^2 - 12x + 9');
    const factored = factorPerfectSquare(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Power');
    expect(factored?.op2?.is(2)).toBe(true);
  });

  test('non-perfect square returns null', () => {
    const expr = parse('x^2 + 3x + 1');
    const factored = factorPerfectSquare(expr);
    expect(factored).toBeNull();
  });

  test('not a trinomial returns null', () => {
    const expr = parse('x^2 + 2x + 1 + x');
    const factored = factorPerfectSquare(expr);
    expect(factored).toBeNull();
  });

  test('not an Add expression returns null', () => {
    const expr = parse('x^2');
    const factored = factorPerfectSquare(expr);
    expect(factored).toBeNull();
  });
});

describe('Difference of Squares Factoring', () => {
  test('x² - 4 → (x-2)(x+2)', () => {
    const expr = parse('x^2 - 4');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('x² - 1 → (x-1)(x+1)', () => {
    const expr = parse('x^2 - 1');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('a² - b² → (a-b)(a+b)', () => {
    const expr = parse('a^2 - b^2');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('4x² - 9 → (2x-3)(2x+3)', () => {
    const expr = parse('4x^2 - 9');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('sum of squares returns null', () => {
    const expr = parse('x^2 + 4');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).toBeNull();
  });

  test('not two terms returns null', () => {
    const expr = parse('x^2 - 4 + 1');
    const factored = factorDifferenceOfSquares(expr);
    expect(factored).toBeNull();
  });
});

describe('Quadratic Factoring', () => {
  test('x² + 5x + 6 → (x+2)(x+3)', () => {
    const expr = parse('x^2 + 5x + 6');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
    // The factored form should have 2 factors (both linear in x)
    expect(factored?.ops?.length).toBeGreaterThanOrEqual(2);
  });

  test('x² - 5x + 6 → (x-2)(x-3)', () => {
    const expr = parse('x^2 - 5x + 6');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('x² - 1 → (x-1)(x+1)', () => {
    const expr = parse('x^2 - 1');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
  });

  test('2x² - 8 → 2(x-2)(x+2)', () => {
    const expr = parse('2x^2 - 8');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).not.toBeNull();
    expect(factored?.operator).toBe('Multiply');
    // Should have 3 factors: 2, (x-2), (x+2)
    expect(factored?.ops?.length).toBeGreaterThanOrEqual(2);
  });

  test('irreducible quadratic returns null', () => {
    const expr = parse('x^2 + 1');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).toBeNull();
  });

  test('quadratic with irrational roots returns null', () => {
    const expr = parse('x^2 + 2x - 1');
    const factored = factorQuadratic(expr, 'x');
    // √8 is not rational, so this should return null
    expect(factored).toBeNull();
  });

  test('not a quadratic returns null', () => {
    const expr = parse('x^3 + 2x + 1');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).toBeNull();
  });

  test('linear expression returns null', () => {
    const expr = parse('2x + 3');
    const factored = factorQuadratic(expr, 'x');
    expect(factored).toBeNull();
  });
});

describe('Polynomial Factoring (general)', () => {
  test('factors perfect square trinomial', () => {
    const expr = parse('x^2 + 2x + 1');
    const factored = factorPolynomial(expr);
    expect(factored.operator).toBe('Power');
    expect(factored.op2?.is(2)).toBe(true);
  });

  test('factors difference of squares', () => {
    const expr = parse('x^2 - 4');
    const factored = factorPolynomial(expr);
    expect(factored.operator).toBe('Multiply');
  });

  test('factors quadratic when variable specified', () => {
    const expr = parse('x^2 + 5x + 6');
    const factored = factorPolynomial(expr, 'x');
    expect(factored.operator).toBe('Multiply');
  });

  test('returns expression unchanged if no factoring applies', () => {
    const expr = parse('x + y + z');
    const factored = factorPolynomial(expr);
    // If no factoring pattern applies, returns the original expression
    expect(factored).toBeTruthy();
  });
});

describe('Full factorization: monomial content and pre-factored products', () => {
  // factorPolynomial must return a fully-factored, prime-power form so that
  // partial-fraction decomposition sees irreducible factors. extractContent
  // only handled the numeric GCD, and pre-factored Multiply/Power inputs were
  // never recursed into — so x³+x² and x·(x²+x) came back unfactored.
  const sameValue = (a: Expression, b: Expression) => {
    for (const xv of [2, -3, 5, 0.7]) {
      expect(a.subs({ x: xv }).N().re).toBeCloseTo(b.subs({ x: xv }).N().re);
    }
  };

  test('pulls monomial content x^k: x³+x² → x²(x+1)', () => {
    const input = parse('x^3+x^2');
    const f = factorPolynomial(input, 'x');
    expect(f.operator).toBe('Multiply');
    expect(f.isSame(parse('x^2(x+1)'))).toBe(true);
    sameValue(f, input);
  });

  test('monomial content with leading coefficient: 3x⁴+2x³ → x³(3x+2)', () => {
    const input = parse('3x^4+2x^3');
    const f = factorPolynomial(input, 'x');
    expect(f.isSame(parse('x^3(3x+2)'))).toBe(true);
    sameValue(f, input);
  });

  test('re-factors a pre-factored product with shared factor: x(x²+x) = x²(x+1)', () => {
    const input = parse('x(x^2+x)');
    const f = factorPolynomial(input, 'x');
    // x·(x²+x) = x²·(x+1) by value. CE keeps the repeated factor as x·x rather
    // than collapsing to x² (collectFactors merges it), so assert value
    // equivalence + that it factored further and is now idempotent.
    sameValue(f, input);
    sameValue(f, parse('x^2(x+1)'));
    expect(f.isSame(input)).toBe(false);
    expect(f.isSame(factorPolynomial(f, 'x'))).toBe(true);
  });

  test('fully factors a pre-factored denominator, preserving irreducible quadratics', () => {
    // (x−1)·x·(1+x²)²·(1+x+x²) — already factored; must stay fully factored
    // with (x²+1) carrying multiplicity 2, not be expanded and lost.
    const input = parse('(x-1)x(1+x^2)^2(1+x+x^2)');
    const f = factorPolynomial(input, 'x');
    sameValue(f, input);
    expect(f.toString()).toContain('(x^2 + 1)^2');
  });

  test('leaves an irreducible repeated quadratic intact: (x²+1)²', () => {
    const input = parse('(x^2+1)^2');
    const f = factorPolynomial(input, 'x');
    expect(f.isSame(input)).toBe(true);
  });
});

describe('Issue #309: infer variable when none specified', () => {
  // `Factor(x^2 + 5x + 6)` with no variable argument should still factor
  // the univariate polynomial by inferring the single unknown, instead of
  // returning the expanded form unchanged.

  test('factorPolynomial infers variable for a quadratic', () => {
    const expr = parse('x^2 + 5x + 6');
    const factored = factorPolynomial(expr);
    expect(factored.operator).toBe('Multiply');
    expect(factored.latex).toBe('(x+2)(x+3)');
  });

  test('Factor() with no variable factors a quadratic (#309)', () => {
    const expr = parse('x^2 + 5x + 6');
    const factored = ce.expr(['Factor', expr]).evaluate();
    expect(factored.latex).toBe('(x+2)(x+3)');
  });

  test('Factor() with no variable does content extraction + quadratic', () => {
    const expr = parse('2x^2 + 10x + 12');
    const factored = ce.expr(['Factor', expr]).evaluate();
    expect(factored.latex).toBe('2(x+2)(x+3)');
  });

  test('linear content is kept in factored form', () => {
    // The numeric content must not be distributed back over the primitive:
    // `Factor(6x + 9)` is `3(2x + 3)`, not the expanded `6x + 9`.
    expect(ce.expr(['Factor', parse('6x + 9')]).evaluate().latex).toBe(
      '3(2x+3)'
    );
    expect(ce.expr(['Factor', parse('2x + 4')]).evaluate().latex).toBe(
      '2(x+2)'
    );
    expect(ce.expr(['Factor', parse('10x - 15')]).evaluate().latex).toBe(
      '5(2x-3)'
    );
  });

  test('Factor() with no variable factors a cubic via rational roots', () => {
    const expr = parse('x^3 - 6x^2 + 11x - 6');
    const factored = ce.expr(['Factor', expr]).evaluate();
    expect(factored.operator).toBe('Multiply');
    for (const val of [0, 1, 2, 3, -1, 5]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('inferred and explicit variable give the same result', () => {
    const expr = parse('x^2 + 5x + 6');
    const inferred = factorPolynomial(expr);
    const explicit = factorPolynomial(expr, 'x');
    expect(inferred.isSame(explicit)).toBe(true);
  });

  test('irreducible quadratic is left unchanged', () => {
    const expr = parse('x^2 + 1');
    const factored = ce.expr(['Factor', expr]).evaluate();
    expect(factored.latex).toBe('x^2+1');
  });

  test('multivariate expression is not mis-factored', () => {
    // Two unknowns: cannot infer a single variable, so the variable-aware
    // strategies are skipped (the variable-agnostic perfect-square strategy
    // still applies here).
    const expr = parse('x^2 + 2xy + y^2');
    const factored = ce.expr(['Factor', expr]).evaluate();
    expect(factored.operator).toBe('Power');
  });
});

describe('Integration with sqrt simplification', () => {
  test('sqrt(x² + 2x + 1) → |x+1|', () => {
    const expr = parse('\\sqrt{x^2 + 2x + 1}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });

  test('sqrt(x² - 2x + 1) → |x-1|', () => {
    const expr = parse('\\sqrt{x^2 - 2x + 1}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x-1');
  });

  test('sqrt(a² + 2ab + b²) → |a+b|', () => {
    const expr = parse('\\sqrt{a^2 + 2ab + b^2}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt(a² - 2ab + b²) → |a-b|', () => {
    const expr = parse('\\sqrt{a^2 - 2ab + b^2}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt(4x² + 12x + 9) → |2x+3|', () => {
    const expr = parse('\\sqrt{4x^2 + 12x + 9}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt(4x² - 12x + 9) → |2x-3|', () => {
    const expr = parse('\\sqrt{4x^2 - 12x + 9}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
  });

  test('sqrt of non-perfect square unchanged', () => {
    const expr = parse('\\sqrt{x^2 + 3x + 1}');
    const simplified = expr.simplify();
    // Should remain as sqrt since it's not a perfect square
    expect(simplified.operator).toBe('Sqrt');
  });

  test('already factored form works', () => {
    const expr = parse('\\sqrt{(x+1)^2}');
    const simplified = expr.simplify();
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });
});

describe('Rational Root Factoring (degree 3+)', () => {
  test('x³ - 6x² + 11x - 6 factors completely', () => {
    const expr = parse('x^3 - 6x^2 + 11x - 6');
    const factored = factorPolynomial(expr, 'x');
    // Should be a product (factored form)
    expect(factored.operator).toBe('Multiply');
    // Verify equivalence at several points using subs
    for (const val of [0, 1, 2, 3, -1, 5]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('x³ + 1 factors as (x+1)(x²-x+1)', () => {
    const expr = parse('x^3 + 1');
    const factored = factorPolynomial(expr, 'x');
    expect(factored.operator).toBe('Multiply');
    for (const val of [0, 1, -1, 2, -2]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('x⁴ - 5x² + 4 factors completely', () => {
    const expr = parse('x^4 - 5x^2 + 4');
    const factored = factorPolynomial(expr, 'x');
    expect(factored.operator).toBe('Multiply');
    for (const val of [0, 1, -1, 2, -2, 3]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('2x³ - 3x² - 3x + 2 has rational roots', () => {
    const expr = parse('2x^3 - 3x^2 - 3x + 2');
    const factored = factorPolynomial(expr, 'x');
    expect(factored.operator).toBe('Multiply');
    for (const val of [0, 1, -1, 2, 0.5]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('irreducible cubic returns equivalent expression', () => {
    // x³ + x + 1 has no rational roots
    const expr = parse('x^3 + x + 1');
    const factored = factorPolynomial(expr, 'x');
    // Should not crash, should return something equivalent
    for (const val of [0, 1, -1, 2]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });
});

describe('Issue #180 regression tests', () => {
  test('sqrt(x² + 2x + 1) simplifies correctly', () => {
    const expr = parse('\\sqrt{x^2+2x+1}');
    const simplified = expr.simplify();
    // LaTeX output may vary slightly - check for Abs operator instead
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });

  test('factored form still works', () => {
    const expr = parse('\\sqrt{(x+1)^2}');
    const simplified = expr.simplify();
    // Both \vert and \left| are acceptable LaTeX for absolute value
    expect(simplified.operator).toBe('Abs');
    expect(simplified.op1?.latex).toBe('x+1');
  });

  test('rational simplification with factoring', () => {
    const expr = parse('\\frac{x^2-1}{x-1}');
    const simplified = expr.simplify();
    // After factoring numerator to (x-1)(x+1), should cancel to x+1
    expect(simplified.latex).toBe('x+1');
  });
});

describe('CONTENT EXTRACTION (coefficient GCD)', () => {
  test('6x² + 12x + 6 factors as 6(x+1)²', () => {
    const expr = parse('6x^2 + 12x + 6');
    const factored = factorPolynomial(expr, 'x');
    for (const val of [0, 1, -1, 2, -2]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('2x² - 8 factors as 2(x-2)(x+2)', () => {
    const expr = parse('2x^2 - 8');
    const factored = factorPolynomial(expr, 'x');
    for (const val of [0, 1, -1, 2, -2, 3]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('3x³ - 18x² + 33x - 18 factors as 3(x-1)(x-2)(x-3)', () => {
    const expr = parse('3x^3 - 18x^2 + 33x - 18');
    const factored = factorPolynomial(expr, 'x');
    for (const val of [0, 1, 2, 3, -1]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });

  test('no extraction when content is 1', () => {
    const expr = parse('x^2 + 2x + 1');
    const factored = factorPolynomial(expr, 'x');
    for (const val of [0, 1, -1, 2]) {
      const v = ce.number(val);
      expect(factored.subs({ x: v }).N().re).toBeCloseTo(
        expr.subs({ x: v }).N().re
      );
    }
  });
});

// factor()'s Add case built the factored product with the expanding mul()
// helper, which distributes the content right back over the sum
// (mul(2, u+v) -> 2u+2v) — so `2x + 4` came back unchanged and
// toNumericValue() could not extract the coefficient. The factored form must
// be preserved (a canonical Multiply node, which does not distribute). The
// gcd content is factored out whether it is rational (2) or radical (√2).
describe('Linear content extraction (factor + toNumericValue)', () => {
  test('factor keeps the content factored, not re-distributed', () => {
    expect(factor(parse('2x + 4')).operator).toBe('Multiply');
    expect(factor(parse('2x + 4')).latex).toBe('2(x+2)');
    expect(
      factor(ce.expr(['Add', ['Multiply', 2, 'u'], ['Multiply', 2, 'v']])).latex
    ).toBe('2(u+v)');
    expect(
      factor(ce.expr(['Add', ['Multiply', 6, 'u'], ['Multiply', 9, 'v']])).latex
    ).toBe('3(2u+3v)');
  });

  test('toNumericValue extracts the content from a sum', () => {
    const [c1, r1] = parse('2x + 4').toNumericValue();
    expect(c1.eq(2)).toBe(true);
    expect(r1.isSame(parse('x + 2'))).toBe(true);

    const [c2, r2] = ce
      .expr(['Add', ['Multiply', 2, 'u'], ['Multiply', 2, 'v']])
      .toNumericValue();
    expect(c2.eq(2)).toBe(true);
    expect(r2.isSame(ce.expr(['Add', 'u', 'v']))).toBe(true);
  });

  test('a radical gcd is factored out too', () => {
    const sum = ce.expr([
      'Add',
      ['Multiply', ['Sqrt', 2], 'u'],
      ['Multiply', ['Sqrt', 2], 'v'],
    ]);
    // √2·u + √2·v → √2(u + v)
    expect(factor(sum).operator).toBe('Multiply');
    const [c, r] = sum.toNumericValue();
    expect(c.eq(ce._numericValue(2).sqrt())).toBe(true);
    expect(r.isSame(ce.expr(['Add', 'u', 'v']))).toBe(true);
  });
});

// The public free function must do full polynomial factoring, like the
// `Factor` operator — not just the internal GCD content extraction. It used
// to bind the internal factor() helper, so factor('x^2 + 5x + 6') returned
// its input unchanged.
describe('factor() free function (public API)', () => {
  test('factors a quadratic from LaTeX', () => {
    const factored = factorFn('x^2 + 5x + 6');
    expect(factored.operator).toBe('Multiply');
    expect(factored.latex).toBe('(x+2)(x+3)');
  });

  test('still simplifies relational operators', () => {
    expect(factorFn('2x < 4').latex).toBe('x\\lt2');
  });

  test('still combines products', () => {
    expect(factorFn('(2x)(2y)').latex).toBe('4xy');
  });

  test('leaves irreducible polynomials unchanged', () => {
    expect(factorFn('x^2 + x + 1').latex).toBe('x^2+x+1');
  });

  test('negative leading coefficient extracts a negative content', () => {
    expect(factorFn('-(2x + 4)').latex).toBe('-2(x+2)');
    expect(factorFn('-2x^2 - 10x - 12').latex).toBe('-2(x+2)(x+3)');
  });
});

// ROADMAP B4: `Factor` applied a difference-of-even-powers trick that took
// √(xⁿ), injecting `x·√x` (odd n) or `|x|^(n/2)` (even n) — factorizations that
// are value-equal only on x > 0 and are NOT polynomial. The square-root
// extraction is now gated to genuine polynomial perfect squares, and the
// difference-of-squares result is recursively factored to the full
// (cyclotomic) factorization.
describe('Factor(xⁿ − 1) returns polynomial factors (ROADMAP B4)', () => {
  const factored = (s: string) =>
    ce.expr(['Factor', parse(s)]).evaluate();

  // The defining regression: no factor may contain Sqrt/Abs/Root, and the
  // factorization must be value-equal to the input everywhere (not just x > 0,
  // which is where the old radical forms agreed).
  for (const n of [2, 3, 4, 5, 6, 7, 8]) {
    const input = `x^${n}-1`;
    test(`Factor(${input}) is polynomial and value-equal`, () => {
      const f = factored(input);
      expect(f.has(['Sqrt', 'Abs', 'Root'])).toBe(false);
      const orig = parse(input);
      // Check at points including negatives, where the old √x/|x| forms diverged.
      for (const xv of [-3, -2, 2, 3, 5]) {
        const v = ce.number(xv);
        expect(f.subs({ x: v }).N().re).toBeCloseTo(orig.subs({ x: v }).N().re);
      }
    });
  }

  test('odd powers factor fully via rational roots (x³ − 1)', () => {
    const f = factored('x^3-1');
    // (x − 1)(x² + x + 1)
    expect(f.operator).toBe('Multiply');
    expect(f.has('Sqrt')).toBe(false);
    expect(f.subs({ x: ce.number(1) }).N().re).toBeCloseTo(0);
  });

  test('x⁶ − 1 fully factors into the four cyclotomic factors', () => {
    const f = factored('x^6-1');
    // (x − 1)(x + 1)(x² + x + 1)(x² − x + 1) — four irreducible factors
    expect(f.operator).toBe('Multiply');
    expect(f.ops!.length).toBe(4);
    expect(f.has(['Sqrt', 'Abs'])).toBe(false);
  });

  test('x⁴ − 1 → (x − 1)(x + 1)(x² + 1) (no longer stops at (x²−1)(x²+1))', () => {
    const f = factored('x^4-1');
    expect(f.operator).toBe('Multiply');
    expect(f.ops!.length).toBe(3);
  });

  // A genuine even perfect power must still factor as a difference of squares,
  // now using the polynomial root x³ instead of |x|³.
  test('perfect-square trinomial with x⁶ uses x³, not |x|³', () => {
    const f = factored('x^6 + 2x^3 + 1');
    expect(f.has('Abs')).toBe(false);
    expect(f.toString()).toBe('(x^3 + 1)^2');
  });
});

// together()'s Add branch used to sum all numerators and all denominators
// independently (a/b + c/d → (a+c)/(b+d), 1 + 1/k → 2/k). It must fold the
// terms over a common denominator instead.
describe('together() common-denominator fold', () => {
  test('a/b + c/d → (ad + bc)/(bd)', () => {
    const t = together(parse('\\frac{a}{b} + \\frac{c}{d}'));
    expect(
      t.isSame(
        ce.expr([
          'Divide',
          ['Add', ['Multiply', 'a', 'd'], ['Multiply', 'b', 'c']],
          ['Multiply', 'b', 'd'],
        ])
      )
    ).toBe(true);
  });

  test('1 + 1/k → (k + 1)/k', () => {
    const t = together(parse('1 + \\frac{1}{k}'));
    expect(t.isSame(ce.expr(['Divide', ['Add', 'k', 1], 'k']))).toBe(true);
  });

  test('same denominator is reused: x/y + z/y → (x + z)/y', () => {
    const t = together(parse('\\frac{x}{y} + \\frac{z}{y}'));
    expect(t.isSame(ce.expr(['Divide', ['Add', 'x', 'z'], 'y']))).toBe(true);
  });

  test('a sum with no denominators is returned unchanged', () => {
    const e = parse('x + y');
    expect(together(e).isSame(e)).toBe(true);
  });
});

// `numeratorDenominator` split a *bare* negative power incorrectly: `1/x^2`
// canonicalizes to `Power(x, -2)`, whose `Power` branch returned
// `[x^-2, 1]` — a denominator of 1. The same factor inside a `Multiply`
// (`y/x^2`) routes through `Product.asNumeratorDenominator`, which splits on
// exponent sign and correctly reported `x^2`, so the two disagreed. This also
// leaked to the public `NumeratorDenominator` operator and `.denominator`.
describe('numeratorDenominator: bare negative power', () => {
  test.each([
    ['\\frac{1}{x^2}', '1', 'x^2'],
    ['x^{-2}', '1', 'x^2'],
    ['\\frac{1}{(x+1)^2}', '1', '(x + 1)^2'],
  ])('%s → [%s, %s]', (latex, num, den) => {
    const [n, d] = parse(latex).numeratorDenominator;
    expect(n.toString()).toBe(num);
    expect(d.toString()).toBe(den);
  });

  test('agrees with the Multiply path', () => {
    // `y/x^2` (a Multiply) already reported `x^2`; `1/x^2` must agree.
    expect(parse('x^{-2}y').denominator.toString()).toBe('x^2');
    expect(parse('x^{-2}').denominator.toString()).toBe('x^2');
  });

  test('a symbolic exponent is left alone (sign not decidable)', () => {
    const [n, d] = parse('x^{-n}').numeratorDenominator;
    expect(d.toString()).toBe('1');
    expect(n.toString()).toBe('x^(-n)');
  });
});

// together() only treated a `Divide` node as carrying a denominator, so terms
// written as negative powers (`1/x^2` → `Power(x, -2)`) were folded into the
// numerator and the "combined" fraction kept negative powers:
// `1/x + 1/x^2` → `(x·x^-2 + 1)/x`.
describe('together(): denominators written as negative powers', () => {
  test('1/x + 1/x^2 has no negative power in the result', () => {
    const t = together(parse('\\frac{1}{x} + \\frac{1}{x^2}'));
    const [n, d] = [t.op1, t.op2];
    expect(t.operator).toBe('Divide');
    expect(n.toString()).not.toContain('^(-');
    expect(d.toString()).not.toContain('^(-');
  });

  test('the combined fraction is value-preserving', () => {
    for (const src of [
      '\\frac{1}{x} + \\frac{1}{x^2}',
      '-\\frac{3y}{x} + \\frac{2}{x^2}',
    ]) {
      const e = parse(src);
      expect(together(e).sub(e).simplify().isSame(0)).toBe(true);
    }
  });

  test('numeric terms are not put over a common denominator', () => {
    // Splitting `1/2` into [1, 2] here would rewrite every rational
    // coefficient; Together is only asked to combine symbolic fractions.
    const t = together(parse('\\frac{1}{2} + x'));
    expect(t.isSame(parse('\\frac{1}{2} + x'))).toBe(true);
  });
});

// The `Together` operator now reduces its result to lowest terms. together()
// folds over the *product* of the denominators, so `1/x + 1/x^2` gave
// `(x^2 + x)/(x·x^2)`. Dividing through by the numerator/denominator GCD both
// reduces the fraction and yields the LCD (product / gcd IS the LCD).
describe('Together reduces to lowest terms', () => {
  const T = (latex: string) =>
    ce.function('Together', [parse(latex)]).evaluate();

  test.each([
    ['\\frac{1}{x} + \\frac{1}{x^2}', '(x + 1) / x^2'],
    ['\\frac{1}{x} + \\frac{1}{y}', '(x + y) / (x * y)'],
    ['\\frac{x}{y} + \\frac{z}{y}', '(x + z) / y'],
    ['1 + \\frac{1}{k}', '(k + 1) / k'],
  ])('Together(%s) = %s', (src, expected) => {
    expect(T(src).toString()).toBe(expected);
  });

  // The multivariate case: the univariate Euclidean GCD reports 1 here
  // (it treats `y` as an opaque coefficient); Brown's algorithm finds `x`.
  test('multivariate: -3y/x + 2/x^2 → (2 - 3xy)/x^2', () => {
    const t = T('-\\frac{3y}{x} + \\frac{2}{x^2}');
    expect(t.operator).toBe('Divide');
    expect(t.op2.toString()).toBe('x^2');
  });

  test('numeric oracle: reduction preserves the value', () => {
    const vals = { x: 3, y: 5, z: 7, a: 2, b: 3, c: 5, d: 7, k: 4 };
    const at = (e: Expression) =>
      e.subs(
        Object.fromEntries(Object.entries(vals).map(([s, v]) => [s, ce.box(v)]))
      ).N().re;
    for (const src of [
      '\\frac{1}{x} + \\frac{1}{x^2}',
      '-\\frac{3y}{x} + \\frac{2}{x^2}',
      '\\frac{1}{x+1} + \\frac{1}{(x+1)^2}',
      '\\frac{x}{x^2-1} + \\frac{1}{x+1}',
      '\\frac{a}{b} + \\frac{c}{d}',
    ]) {
      expect(at(T(src))).toBeCloseTo(at(parse(src)), 9);
    }
  });

  // The same-denominator simplify rule calls together() directly and must keep
  // the unreduced result: it runs inside the simplify fixpoint, where output
  // stability matters more than presentation.
  test('the bare together() helper is unchanged', () => {
    expect(together(parse('\\frac{1}{x} + \\frac{1}{x^2}')).toString()).toBe(
      '(x^2 + x) / (x * x^2)'
    );
  });
});

// Regression: the univariate Euclidean GCD in `x` treats `y` as an opaque
// coefficient, so for `y·(x+1) / (y·(x+1)²)` it returns the monic, nonconstant
// `x+1` (degree 1). Dividing by that alone leaves `y / (y·(x+1))` — value-
// correct but NOT lowest terms. Brown's multivariate algorithm recovers the
// full common factor `y·(x+1)`, reducing all the way to `1 / (x+1)`.
describe('cancelCommonFactors: nonconstant-but-incomplete univariate GCD', () => {
  test('y(x+1)/(y(x+1)^2) reduces to lowest terms 1/(x+1)', () => {
    const expr = ce.function('Divide', [
      parse('y(x+1)'),
      parse('y(x+1)^2'),
    ]);
    expect(cancelCommonFactors(expr, 'x').toString()).toBe('1 / (x + 1)');
  });
});
