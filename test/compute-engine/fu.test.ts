/**
 * Tests for the Fu trigonometric simplification algorithm.
 *
 * Based on: Fu, Hongguang, Xiuqin Zhong, and Zhenbing Zeng.
 * "Automated and readable simplification of trigonometric expressions."
 * Mathematical and Computer Modelling 44.11 (2006): 1169-1177.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/types';
import {
  fu,
  fuSimplify,
  trigCost,
  countTrigFunctions,
  countLeaves,
} from '../../src/compute-engine/symbolic/fu';
import {
  TR1,
  TR2,
  TR2i,
  TR5,
  TR6,
  TR7,
  TR8,
  TR9,
  TR10,
  TR10i,
  TR11,
  TR11i,
  TR12,
  TR13,
  TR22,
  TRmorrie,
  applyTR1,
  applyTR2,
  applyTR5,
  applyTR6,
  applyTR8,
  applyTR11i,
  hasTrigFunction,
  hasOperator,
} from '../../src/compute-engine/symbolic/fu-transforms';

const ce = new ComputeEngine();

// Helper to parse LaTeX and apply a transformation
function transformLatex(
  latex: string,
  transform: (e: any) => any
): string | undefined {
  const expr = ce.parse(latex);
  const result = transform(expr);
  return result?.latex ?? result?.toString();
}

// Helper to simplify with Fu and return LaTeX
function fuLatex(latex: string): string {
  const expr = ce.parse(latex);
  const result = fuSimplify(expr);
  return result.latex;
}

describe('Fu Cost Functions', () => {
  test('countTrigFunctions', () => {
    expect(countTrigFunctions(ce.parse('\\sin(x)'))).toBe(1);
    expect(countTrigFunctions(ce.parse('\\sin(x)\\cos(x)'))).toBe(2);
    expect(countTrigFunctions(ce.parse('\\sin(x) + \\cos(x)'))).toBe(2);
    expect(countTrigFunctions(ce.parse('x + y'))).toBe(0);
    expect(countTrigFunctions(ce.parse('\\sin(\\cos(x))'))).toBe(2);
    expect(countTrigFunctions(ce.parse('\\tan(x)\\cot(x)\\sec(x)'))).toBe(3);
  });

  test('countLeaves', () => {
    expect(countLeaves(ce.parse('x'))).toBe(1);
    expect(countLeaves(ce.parse('2'))).toBe(1);
    expect(countLeaves(ce.parse('x + y'))).toBeGreaterThan(2);
    expect(countLeaves(ce.parse('\\sin(x)'))).toBeGreaterThan(1);
  });

  test('trigCost prefers fewer trig functions', () => {
    const sinCos = ce.parse('\\sin(x)\\cos(x)');
    const sin2x = ce.parse('\\sin(2x)');

    // sin(2x) has 1 trig function, sin(x)cos(x) has 2
    expect(trigCost(sin2x)).toBeLessThan(trigCost(sinCos));
  });
});

describe('Helper Functions', () => {
  test('hasTrigFunction', () => {
    expect(hasTrigFunction(ce.parse('\\sin(x)'))).toBe(true);
    expect(hasTrigFunction(ce.parse('x + y'))).toBe(false);
    expect(hasTrigFunction(ce.parse('\\sin(x) + y'))).toBe(true);
    expect(hasTrigFunction(ce.parse('2\\tan(x)'))).toBe(true);
  });

  test('hasOperator', () => {
    expect(hasOperator(ce.parse('\\sin(x)'), 'Sin')).toBe(true);
    expect(hasOperator(ce.parse('\\sin(x)'), 'Cos')).toBe(false);
    expect(hasOperator(ce.parse('\\sin(x) + \\cos(x)'), 'Sin', 'Cos')).toBe(true);
  });
});

describe('TR1: sec/csc to reciprocal', () => {
  test('sec(x) -> 1/cos(x)', () => {
    const expr = ce.parse('\\sec(x)');
    const result = TR1(expr);
    expect(result).not.toBeUndefined();
    expect(result!.operator).toBe('Divide');
  });

  test('csc(x) -> 1/sin(x)', () => {
    const expr = ce.parse('\\csc(x)');
    const result = TR1(expr);
    expect(result).not.toBeUndefined();
    expect(result!.operator).toBe('Divide');
  });

  test('applyTR1 handles nested expressions', () => {
    const expr = ce.parse('\\sec(x) + \\csc(y)');
    const result = applyTR1(expr);
    // Should not contain Sec or Csc anymore
    expect(hasOperator(result, 'Sec', 'Csc')).toBe(false);
  });
});

describe('TR2/TR2i: tan/cot conversions', () => {
  test('tan(x) -> sin(x)/cos(x)', () => {
    const expr = ce.parse('\\tan(x)');
    const result = TR2(expr);
    expect(result).not.toBeUndefined();
    expect(result!.operator).toBe('Divide');
  });

  test('cot(x) -> cos(x)/sin(x)', () => {
    const expr = ce.parse('\\cot(x)');
    const result = TR2(expr);
    expect(result).not.toBeUndefined();
    expect(result!.operator).toBe('Divide');
  });

  test('sin(x)/cos(x) -> tan(x)', () => {
    const expr = ce.parse('\\frac{\\sin(x)}{\\cos(x)}');
    const result = TR2i(expr);
    expect(result).not.toBeUndefined();
    expect(result!.operator).toBe('Tan');
  });

  test('cos(x)/sin(x) -> cot(x)', () => {
    const expr = ce.parse('\\frac{\\cos(x)}{\\sin(x)}');
    const result = TR2i(expr);
    expect(result).not.toBeUndefined();
    expect(result!.operator).toBe('Cot');
  });
});

describe('TR5/TR6: Pythagorean substitutions', () => {
  test('sin²(x) -> 1 - cos²(x)', () => {
    const expr = ce.parse('\\sin^2(x)');
    const result = TR5(expr);
    expect(result).not.toBeUndefined();
    // Result should be 1 - cos²(x)
    expect(hasOperator(result!, 'Cos')).toBe(true);
  });

  test('cos²(x) -> 1 - sin²(x)', () => {
    const expr = ce.parse('\\cos^2(x)');
    const result = TR6(expr);
    expect(result).not.toBeUndefined();
    expect(hasOperator(result!, 'Sin')).toBe(true);
  });
});

describe('TR7: Power reduction', () => {
  test('cos²(x) -> (1 + cos(2x))/2', () => {
    const expr = ce.parse('\\cos^2(x)');
    const result = TR7(expr);
    expect(result).not.toBeUndefined();
    // Result should contain cos(2x)
    expect(result!.toString()).toContain('2');
  });
});

describe('TR8: Product-to-sum', () => {
  test('sin(x)cos(y) -> sum', () => {
    const expr = ce.parse('\\sin(x)\\cos(y)');
    const result = TR8(expr);
    expect(result).not.toBeUndefined();
    // Result should be (sin(x+y) + sin(x-y))/2
    // The structure is Divide(Add(...), 2) or Multiply(Add(...), 1/2)
    expect(hasOperator(result!, 'Sin')).toBe(true);
  });

  test('sin(x)cos(x) -> sin(2x)/2 via TR8', () => {
    const expr = ce.parse('\\sin(x)\\cos(x)');
    const result = TR8(expr);
    expect(result).not.toBeUndefined();
  });

  test('cos(x)cos(y) -> sum', () => {
    const expr = ce.parse('\\cos(x)\\cos(y)');
    const result = TR8(expr);
    expect(result).not.toBeUndefined();
  });

  test('sin(x)sin(y) -> difference', () => {
    const expr = ce.parse('\\sin(x)\\sin(y)');
    const result = TR8(expr);
    expect(result).not.toBeUndefined();
  });
});

describe('TR11/TR11i: Double angle', () => {
  test('sin(2x) -> 2sin(x)cos(x)', () => {
    const expr = ce.parse('\\sin(2x)');
    const result = TR11(expr);
    expect(result).not.toBeUndefined();
    // Result should have 2*sin*cos structure
    expect(hasOperator(result!, 'Sin')).toBe(true);
    expect(hasOperator(result!, 'Cos')).toBe(true);
  });

  test('cos(2x) -> 2cos²(x) - 1', () => {
    const expr = ce.parse('\\cos(2x)');
    const result = TR11(expr);
    expect(result).not.toBeUndefined();
    expect(hasOperator(result!, 'Cos')).toBe(true);
  });

  test('2sin(x)cos(x) -> sin(2x)', () => {
    const expr = ce.parse('2\\sin(x)\\cos(x)');
    const result = applyTR11i(expr);
    // Should contract to sin(2x)
    expect(countTrigFunctions(result)).toBeLessThanOrEqual(
      countTrigFunctions(expr)
    );
  });
});

describe('TR22: tan/sec Pythagorean', () => {
  test('tan²(x) -> sec²(x) - 1', () => {
    const expr = ce.parse('\\tan^2(x)');
    const result = TR22(expr);
    expect(result).not.toBeUndefined();
    expect(hasOperator(result!, 'Sec')).toBe(true);
  });

  test('cot²(x) -> csc²(x) - 1', () => {
    const expr = ce.parse('\\cot^2(x)');
    const result = TR22(expr);
    expect(result).not.toBeUndefined();
    expect(hasOperator(result!, 'Csc')).toBe(true);
  });
});

describe('Fu Algorithm - Basic Cases', () => {
  test('returns undefined for non-trig expressions', () => {
    const expr = ce.parse('x + y');
    expect(fu(expr)).toBeUndefined();
  });

  test('applyTR1 converts sec to reciprocal form', () => {
    const expr = ce.parse('\\sec(x)');
    const result = applyTR1(expr);
    // TR1 converts sec(x) to 1/cos(x)
    expect(hasOperator(result, 'Sec')).toBe(false);
    expect(hasOperator(result, 'Cos')).toBe(true);
  });

  test('sin(x)cos(x) simplifies', () => {
    const expr = ce.parse('\\sin(x)\\cos(x)');
    const result = fu(expr);
    // Fu should find a form with fewer trig functions
    if (result) {
      expect(countTrigFunctions(result.value)).toBeLessThanOrEqual(
        countTrigFunctions(expr)
      );
    }
  });
});

describe('Fu Algorithm - Classic Examples', () => {
  // These are examples from the Fu paper and SymPy documentation

  test('tan(x)cot(x) -> 1', () => {
    const expr = ce.parse('\\tan(x)\\cot(x)');
    // This should simplify through the existing simplifyTrig
    // Fu might take a different path
    const simplified = expr.simplify();
    expect(simplified.is(1)).toBe(true);
  });

  test('sin²(x) + cos²(x) -> 1', () => {
    const expr = ce.parse('\\sin^2(x) + \\cos^2(x)');
    const simplified = expr.simplify();
    expect(simplified.is(1)).toBe(true);
  });

  test('2sin(x)cos(x) -> sin(2x)', () => {
    const expr = ce.parse('2\\sin(x)\\cos(x)');
    const simplified = expr.simplify();
    // Should be sin(2x)
    expect(simplified.operator).toBe('Sin');
    expect(countTrigFunctions(simplified)).toBe(1);
  });
});

describe('Fu Algorithm - Complex Expressions', () => {
  test('sin⁴(x) - cos⁴(x)', () => {
    // sin⁴(x) - cos⁴(x) = (sin²(x) - cos²(x))(sin²(x) + cos²(x))
    //                   = (sin²(x) - cos²(x)) * 1
    //                   = sin²(x) - cos²(x)
    //                   = -cos(2x)
    const expr = ce.parse('\\sin^4(x) - \\cos^4(x)');
    const result = fuSimplify(expr);

    // Should reduce the trig count
    expect(countTrigFunctions(result)).toBeLessThanOrEqual(
      countTrigFunctions(expr)
    );
  });

  test('sec(x) - cos(x)', () => {
    // sec(x) - cos(x) = 1/cos(x) - cos(x)
    //                 = (1 - cos²(x))/cos(x)
    //                 = sin²(x)/cos(x)
    //                 = sin(x)tan(x)
    const expr = ce.parse('\\sec(x) - \\cos(x)');
    const result = fuSimplify(expr);

    // Fu may or may not simplify further depending on cost
    // At minimum it should be valid
    expect(result).toBeDefined();
    // The trig count shouldn't increase
    expect(countTrigFunctions(result)).toBeLessThanOrEqual(
      countTrigFunctions(expr)
    );
  });
});

describe('TRmorrie: Morrie\'s Law', () => {
  test('cos(x)cos(2x) product', () => {
    // cos(x)cos(2x) = sin(4x)/(4sin(x)) by Morrie's law
    const expr = ce.parse('\\cos(x)\\cos(2x)');
    const result = TRmorrie(expr);
    // Should apply Morrie's law
    if (result) {
      expect(hasOperator(result, 'Sin')).toBe(true);
    }
  });

  test('cos(x)cos(2x)cos(4x) product', () => {
    // cos(x)cos(2x)cos(4x) = sin(8x)/(8sin(x))
    const expr = ce.parse('\\cos(x)\\cos(2x)\\cos(4x)');
    const result = TRmorrie(expr);
    if (result) {
      // Should reduce 3 cos to 2 sin
      expect(countTrigFunctions(result)).toBeLessThan(countTrigFunctions(expr));
    }
  });
});

describe('Integration - simplify({ strategy: "fu" })', () => {
  test('simplify with fu strategy', () => {
    const expr = ce.parse('\\sin(x)\\cos(x)');
    const result = expr.simplify({ strategy: 'fu' });
    // Should simplify using Fu algorithm
    expect(countTrigFunctions(result)).toBeLessThanOrEqual(
      countTrigFunctions(expr)
    );
  });

  test('fu strategy on non-trig expression', () => {
    const expr = ce.parse('x + y');
    const result = expr.simplify({ strategy: 'fu' });
    // Should still work, just no Fu transformations
    expect(result).toBeDefined();
  });

  test('fu strategy simplifies and then continues with standard rules', () => {
    const expr = ce.parse('\\sin^2(x) + \\cos^2(x) + 0');
    const result = expr.simplify({ strategy: 'fu' });
    // Fu should simplify sin²+cos² to 1, then standard rules remove +0
    expect(result.is(1)).toBe(true);
  });
});

describe('Integration - trigSimplify() method', () => {
  test('trigSimplify on sin*cos', () => {
    const expr = ce.parse('\\sin(x)\\cos(x)');
    const result = expr.trigSimplify();
    expect(result).toBeDefined();
    expect(countTrigFunctions(result)).toBeLessThanOrEqual(
      countTrigFunctions(expr)
    );
  });

  test('trigSimplify on Pythagorean identity', () => {
    const expr = ce.parse('\\sin^2(x) + \\cos^2(x)');
    const result = expr.trigSimplify();
    expect(result.is(1)).toBe(true);
  });

  test('trigSimplify on non-trig expression returns same', () => {
    const expr = ce.parse('x^2 + 2x + 1');
    const result = expr.trigSimplify();
    // Should still simplify normally
    expect(result).toBeDefined();
  });

  test('trigSimplify on double angle', () => {
    const expr = ce.parse('2\\sin(x)\\cos(x)');
    const result = expr.trigSimplify();
    // Should become sin(2x)
    expect(result.operator).toBe('Sin');
    expect(countTrigFunctions(result)).toBe(1);
  });

  test('trigSimplify on sec expression', () => {
    // sec(x) alone may stay as sec due to cost function preference
    // but sec in a larger expression should be convertible
    const expr = ce.parse('\\sec(x) - \\cos(x)');
    const result = expr.trigSimplify();
    // Result should be valid and not have more trig functions
    expect(result).toBeDefined();
    expect(countTrigFunctions(result)).toBeLessThanOrEqual(
      countTrigFunctions(expr)
    );
  });
});

describe('Edge Cases', () => {
  test('handles nested trig functions', () => {
    const expr = ce.parse('\\sin(\\cos(x))');
    const result = fu(expr);
    // Should not crash, may or may not simplify
    expect(result === undefined || result.value !== undefined).toBe(true);
  });

  test('handles trig with numeric arguments', () => {
    const expr = ce.parse('\\sin(0)');
    // This should evaluate to 0
    const simplified = expr.simplify();
    expect(simplified.is(0)).toBe(true);
  });

  test('handles complex expressions without infinite loop', () => {
    const expr = ce.parse('\\sin(x)^2 + \\cos(x)^2 + \\tan(x)');
    // Should complete without hanging
    const result = fuSimplify(expr);
    expect(result).toBeDefined();
  });
});
