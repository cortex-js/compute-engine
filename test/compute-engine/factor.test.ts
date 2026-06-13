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
} from '../../src/compute-engine/boxed-expression/factor';

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
    const r = factor(ce.box(['Add', 1, 'ImaginaryUnit']));
    expect(r.isNaN).not.toBe(true);
    expect(r.isSame(ce.box(['Add', 1, 'ImaginaryUnit']))).toBe(true);
  });

  it('factor(2 + 2i) is not NaN', () => {
    const r = factor(ce.box(['Add', 2, ['Multiply', 2, 'ImaginaryUnit']]));
    expect(r.isNaN).not.toBe(true);
  });

  it('dividing a Gaussian integer by an integer preserves the value', () => {
    const q = ce.box(['Divide', ['Add', 1, 'ImaginaryUnit'], 2]);
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
    const r = factor(e.box(['Less', ['Multiply', 'x', 'y'], ['Multiply', 'x', 'z']]));
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
    const factored = ce.box(['Factor', expr]).evaluate();
    expect(factored.latex).toBe('(x+2)(x+3)');
  });

  test('Factor() with no variable does content extraction + quadratic', () => {
    const expr = parse('2x^2 + 10x + 12');
    const factored = ce.box(['Factor', expr]).evaluate();
    expect(factored.latex).toBe('2(x+2)(x+3)');
  });

  test('linear content is kept in factored form', () => {
    // The numeric content must not be distributed back over the primitive:
    // `Factor(6x + 9)` is `3(2x + 3)`, not the expanded `6x + 9`.
    expect(ce.box(['Factor', parse('6x + 9')]).evaluate().latex).toBe(
      '3(2x+3)'
    );
    expect(ce.box(['Factor', parse('2x + 4')]).evaluate().latex).toBe(
      '2(x+2)'
    );
    expect(ce.box(['Factor', parse('10x - 15')]).evaluate().latex).toBe(
      '5(2x-3)'
    );
  });

  test('Factor() with no variable factors a cubic via rational roots', () => {
    const expr = parse('x^3 - 6x^2 + 11x - 6');
    const factored = ce.box(['Factor', expr]).evaluate();
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
    const factored = ce.box(['Factor', expr]).evaluate();
    expect(factored.latex).toBe('x^2+1');
  });

  test('multivariate expression is not mis-factored', () => {
    // Two unknowns: cannot infer a single variable, so the variable-aware
    // strategies are skipped (the variable-agnostic perfect-square strategy
    // still applies here).
    const expr = parse('x^2 + 2xy + y^2');
    const factored = ce.box(['Factor', expr]).evaluate();
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
      factor(ce.box(['Add', ['Multiply', 2, 'u'], ['Multiply', 2, 'v']])).latex
    ).toBe('2(u+v)');
    expect(
      factor(ce.box(['Add', ['Multiply', 6, 'u'], ['Multiply', 9, 'v']])).latex
    ).toBe('3(2u+3v)');
  });

  test('toNumericValue extracts the content from a sum', () => {
    const [c1, r1] = parse('2x + 4').toNumericValue();
    expect(c1.eq(2)).toBe(true);
    expect(r1.isSame(parse('x + 2'))).toBe(true);

    const [c2, r2] = ce
      .box(['Add', ['Multiply', 2, 'u'], ['Multiply', 2, 'v']])
      .toNumericValue();
    expect(c2.eq(2)).toBe(true);
    expect(r2.isSame(ce.box(['Add', 'u', 'v']))).toBe(true);
  });

  test('a radical gcd is factored out too', () => {
    const sum = ce.box([
      'Add',
      ['Multiply', ['Sqrt', 2], 'u'],
      ['Multiply', ['Sqrt', 2], 'v'],
    ]);
    // √2·u + √2·v → √2(u + v)
    expect(factor(sum).operator).toBe('Multiply');
    const [c, r] = sum.toNumericValue();
    expect(c.eq(ce._numericValue(2).sqrt())).toBe(true);
    expect(r.isSame(ce.box(['Add', 'u', 'v']))).toBe(true);
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
    ce.box(['Factor', parse(s)]).evaluate();

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
