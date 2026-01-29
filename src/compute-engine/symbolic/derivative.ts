import { apply } from '../function-utils';
import { mul } from '../boxed-expression/arithmetic-mul-div';
import type { BoxedExpression } from '../global-types';
import { add } from '../boxed-expression/arithmetic-add';
import { hasSymbolicTranscendental } from '../boxed-expression/utils';

/**
 * Simplify a derivative result, preserving symbolic transcendental constants.
 * If the expression contains symbolic transcendentals like ln(2), return it
 * without full evaluation to avoid numeric conversion.
 */
function simplifyDerivative(expr: BoxedExpression): BoxedExpression {
  if (hasSymbolicTranscendental(expr)) {
    // Just return canonical form without simplification to preserve
    // symbolic transcendentals like ln(2). Using simplify() would
    // convert ln(2) to its numeric value 0.693...
    return expr.canonical;
  }
  return expr.simplify();
}

// See also:
//
// - Table of 113 common integrals (antiderivative tables):
// https://www.physics.umd.edu/hep/drew/IntegralTable.pdf
//
// - More extensive table:
// https://www.math.stonybrook.edu/~bishop/classes/math126.F20/CRC_integrals.pdf
//

const DERIVATIVES_TABLE = {
  Sin: ['Cos', '_'],
  Cos: ['Negate', ['Sin', '_']],
  Tan: ['Power', ['Sec', '_'], 2],
  Sec: ['Multiply', ['Tan', '_'], ['Sec', '_']],
  Csc: ['Multiply', ['Negate', ['Cot', '_']], ['Csc', '_']],
  Cot: ['Negate', ['Power', ['Csc', '_'], 2]],
  Arcsin: ['Power', ['Subtract', 1, ['Power', '_', 2]], ['Negate', 'Half']],
  Arccos: [
    'Negate',
    ['Power', ['Subtract', 1, ['Power', '_', 2]], ['Negate', 'Half']],
  ],
  Arctan: ['Power', ['Add', 1, ['Power', '_', 2]], -1],
  Arcsec: [
    'Multiply',
    ['Power', ['Subtract', 1, ['Power', '_', 2]], ['Negate', 'Half']],
    ['Negate', ['Power', '_', 2]],
  ],
  Arccsc: [
    'Multiply',
    ['Power', ['Subtract', 1, ['Power', '_', 2]], ['Negate', 'Half']],
    ['Negate', ['Power', '_', 2]],
  ],
  Arccot: ['Negate', ['Power', ['Add', 1, ['Power', '_', 2]], -1]],
  Sinh: ['Cosh', '_'],
  Cosh: ['Sinh', '_'],
  Tanh: ['Power', ['Sech', '_'], 2],
  // d/dx sech(x) = -tanh(x)*sech(x)
  Sech: ['Negate', ['Multiply', ['Tanh', '_'], ['Sech', '_']]],
  // d/dx csch(x) = -coth(x)*csch(x)
  Csch: ['Negate', ['Multiply', ['Coth', '_'], ['Csch', '_']]],
  Coth: ['Negate', ['Power', ['Csch', '_'], 2]],
  Arsinh: ['Power', ['Add', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Arcosh: ['Power', ['Subtract', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Artanh: ['Power', ['Subtract', 1, ['Power', '_', 2]], -1],
  // d/dx arsech(x) = -1 / (x * sqrt(1 - x^2))
  Arsech: [
    'Negate',
    [
      'Divide',
      1,
      ['Multiply', '_', ['Sqrt', ['Subtract', 1, ['Power', '_', 2]]]],
    ],
  ],
  // d/dx arcsch(x) = -1 / (|x| * sqrt(1 + x^2))
  Arcsch: [
    'Negate',
    [
      'Divide',
      1,
      ['Multiply', ['Abs', '_'], ['Sqrt', ['Add', 1, ['Power', '_', 2]]]],
    ],
  ],
  Arcoth: ['Negate', ['Power', ['Subtract', 1, ['Power', '_', 2]], -1]],
  // Exp: ['Exp', '_'],   // Gets canonicalized to Power
  Ln: ['Divide', 1, '_'],
  Log: ['Power', ['Multiply', '_', ['Ln', '10']], -1],
  Sqrt: ['Multiply', ['Power', '_', ['Negate', 'Half']], 'Half'],
  // d/dx |x| = x/|x| = sign(x) for x ≠ 0 (undefined at x = 0)
  Abs: ['Sign', '_'],
  // Step functions: derivative is 0 almost everywhere (undefined at discontinuities)
  Floor: 0,
  Ceil: 0,
  Round: 0,
  // https://proofwiki.org/wiki/Derivative_of_Error_Function
  Erf: [
    'Multiply',
    ['Divide', '2', ['Sqrt', 'Pi']],
    ['Exp', ['Negate', ['Square', '_']]],
  ],
  // https://proofwiki.org/wiki/Derivative_of_Gamma_Function
  // https://en.wikipedia.org/wiki/Gamma_function
  // d/dx Γ(x) = Γ(x)·ψ(x) where ψ is the digamma function
  Gamma: ['Multiply', ['Gamma', '_'], ['Digamma', '_']],
  // d/dx erfc(x) = -d/dx erf(x) = -2/√π * e^(-x²)
  Erfc: [
    'Negate',
    ['Multiply', ['Divide', 2, ['Sqrt', 'Pi']], ['Exp', ['Negate', ['Square', '_']]]],
  ],
  // d/dx ln(Γ(x)) = ψ(x) (digamma function)
  LogGamma: ['Digamma', '_'],
  // Note: LambertW derivative d/dx W(x) = W(x)/(x·(1+W(x))) is mathematically correct
  // but omitted because LambertW lacks a type signature, causing type errors.
  //
  // d/dx S(x) = sin(πx²/2) where S is the Fresnel sine integral
  FresnelS: ['Sin', ['Multiply', ['Divide', 'Pi', 2], ['Square', '_']]],
  // d/dx C(x) = cos(πx²/2) where C is the Fresnel cosine integral
  FresnelC: ['Cos', ['Multiply', ['Divide', 'Pi', 2], ['Square', '_']]],
  // d/dx erfi(x) = (2/√π)·e^(x²) where erfi is the imaginary error function
  Erfi: [
    'Multiply',
    ['Divide', 2, ['Sqrt', 'Pi']],
    ['Exp', ['Square', '_']],
  ],
  // Note: Bessel functions (BesselJ, BesselY, BesselI, BesselK) and Airy functions
  // (AiryAi, AiryBi) have been omitted because their derivatives involve functions
  // of different orders or related derivative functions that are not in the standard
  // function set. For example, d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2.
  //
  // Similarly, Zeta, Digamma, PolyGamma, and Beta derivatives are omitted because
  // they either don't have simple closed forms or involve additional functions not
  // in the standard set (trigamma function, etc.).
};

/**
 *
 * @param fn The function to differentiate, a function literal.
 *
 * @returns a function expression representing the derivative of `fn` with
 * respect to the variables in `degrees`.
 */
export function derivative(
  fn: BoxedExpression,
  order: number
): BoxedExpression | undefined {
  if (order === 0) return fn;
  const ce = fn.engine;
  let v = '_';
  if (fn.symbol && fn.operatorDefinition) {
    // We have, e.g. fn = 'Sin"
    fn = apply(ce.symbol(fn.symbol), [ce.symbol('_')]);
  }
  if (fn.operator === 'Function') {
    // We have, e.g. fn = ['Function', ['Sin', 'x'], 'x']
    v = fn.ops![1]?.symbol ?? '_';
    fn = fn.ops![0];
  }
  let result: BoxedExpression | undefined = fn;
  while (order-- > 0 && result) result = differentiate(result, v);
  return result;
}

/**
 * Calculate the partial derivative of an expression with respect to a
 * variable, `v`.
 *
 * All expressions that do not explicitly depend on `v` are taken to have zero
 * partial derivative.
 *
 */
export function differentiate(
  expr: BoxedExpression,
  v: string
): BoxedExpression | undefined {
  const ce = expr.engine;

  // A few easy ones...
  if (expr.string) return undefined;
  if (expr.isNumberLiteral) return expr.engine.Zero;
  if (expr.symbol === v) return expr.engine.One;
  if (expr.symbol) return expr.engine.Zero;
  if (!expr.operator) return undefined;
  if (expr.operator === 'Negate') {
    const gPrime = differentiate(expr.op1, v);
    if (gPrime) return gPrime.neg();
    return ce._fn('D', [expr.op1!, ce.symbol(v)]).neg();
  }

  // Block - just differentiate the content
  if (expr.operator === 'Block') {
    return differentiate(expr.op1, v);
  }

  // D - evaluate the derivative first, then differentiate the result
  if (expr.operator === 'D') {
    const evaluated = expr.evaluate();
    // Avoid infinite recursion if D doesn't simplify
    if (evaluated.operator === 'D') return undefined;
    return differentiate(evaluated, v);
  }

  // Sum rule
  if (expr.operator === 'Add') {
    const terms = expr.ops!.map((op) => differentiate(op, v));
    if (terms.some((term) => term === undefined)) return undefined;
    return simplifyDerivative(add(...(terms as BoxedExpression[])));
  }

  // Product rule
  if (expr.operator === 'Multiply') {
    const terms = expr.ops!.map((op, i) => {
      const otherTerms = expr.ops!.slice();
      otherTerms.splice(i, 1);
      const otherProduct = mul(...otherTerms);
      const gPrime = differentiate(op, v) ?? ce._fn('D', [op, ce.symbol(v)]);
      return gPrime.mul(otherProduct);
    });
    if (terms.some((term) => term === undefined)) return undefined;
    return simplifyDerivative(add(...(terms as BoxedExpression[])));
  }

  // Power rule
  if (expr.operator === 'Power') {
    const [base, exponent] = expr.ops!;
    const baseHasV = base.has(v);
    const expHasV = exponent.has(v);

    if (!baseHasV && !expHasV) {
      // Neither depends on v - derivative is 0
      return ce.Zero;
    }

    if (baseHasV && !expHasV) {
      // Only base depends on v: d/dx f(x)^n = n * f(x)^(n-1) * f'(x)
      const fPrime =
        differentiate(base, v) ?? ce._fn('D', [base, ce.symbol(v)]);
      return simplifyDerivative(
        exponent.mul(base.pow(exponent.add(ce.NegativeOne))).mul(fPrime)
      );
    }

    if (!baseHasV && expHasV) {
      // Only exponent depends on v: d/dx a^g(x) = a^g(x) * ln(a) * g'(x)
      // Use ce._fn('Ln', ...) instead of base.ln() to keep ln symbolic
      // (base.ln() evaluates to a numeric value).
      const gPrime =
        differentiate(exponent, v) ?? ce._fn('D', [exponent, ce.symbol(v)]);
      const lnBase = ce._fn('Ln', [base]);
      return simplifyDerivative(expr.mul(lnBase).mul(gPrime));
    }

    // Both depend on v: d/dx f(x)^g(x) = f(x)^g(x) * (g'(x) * ln(f(x)) + g(x) * f'(x) / f(x))
    const f = base;
    const g = exponent;
    const fPrime = differentiate(f, v) ?? ce._fn('D', [f, ce.symbol(v)]);
    const gPrime = differentiate(g, v) ?? ce._fn('D', [g, ce.symbol(v)]);
    // Use ce._fn('Ln', ...) instead of f.ln() to keep ln symbolic
    // (f.ln() evaluates to a numeric value when f is a constant).
    const lnF = ce._fn('Ln', [f]);
    const term1 = gPrime.mul(lnF);
    const term2 = g.mul(fPrime).div(f);
    return simplifyDerivative(expr.mul(term1.add(term2)));
  }

  // Quotient rule
  if (expr.operator === 'Divide') {
    const [numerator, denominator] = expr.ops!;
    const gPrime =
      differentiate(numerator, v) ?? ce._fn('D', [numerator, ce.symbol(v)]);
    const hPrime =
      differentiate(denominator, v) ?? ce._fn('D', [denominator, ce.symbol(v)]);
    return simplifyDerivative(
      gPrime.mul(denominator).sub(hPrime.mul(numerator)).div(denominator.pow(2))
    );
  }

  const h = DERIVATIVES_TABLE[expr.operator];
  if (h === undefined) {
    if (expr.nops > 1) return undefined;

    // If we don't know how to differentiate this function, assume it's a
    // function of v and apply the chain rule.
    const fPrime = ce._fn('Derivative', [ce.symbol(expr.operator), ce.One]);
    if (!fPrime.isValid) return undefined;
    const g = expr.ops![0];
    const gPrime = differentiate(g, v) ?? ce._fn('D', [g, ce.symbol(v)]);
    if (!gPrime.isValid) return undefined;
    return ce._fn('Apply', [fPrime, g]).mul(gPrime);
  }

  // Apply the chain rule:
  // d/dx f(g(x)) = f'(g(x)) * g'(x)
  if (expr.nops > 1) return ce._fn('D', [expr, ce.symbol(v)]);
  const g = expr.ops![0];
  const gPrime = differentiate(g, v) ?? ce._fn('D', [g, ce.symbol(v)]);
  // Substitute the argument into the derivative formula
  // We use subs() instead of apply() to avoid evaluating the expression,
  // which would convert symbolic transcendentals like ln(10) to numeric values.
  const derivFormula = ce.box(h).subs({ _: g });
  return simplifyDerivative(derivFormula.mul(gPrime));
}
