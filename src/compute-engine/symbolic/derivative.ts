import { apply } from '../function-utils';
import { mul } from '../boxed-expression/arithmetic-mul-div';
import type { BoxedExpression } from '../global-types';
import { add } from '../boxed-expression/arithmetic-add';

/**
 * Check if an expression contains symbolic transcendental functions of constants
 * (like ln(2), sin(1), etc.) that should not be evaluated numerically.
 */
function hasSymbolicTranscendental(expr: BoxedExpression): boolean {
  const op = expr.operator;
  // Transcendental functions applied to numeric constants
  const transcendentals = [
    'Ln',
    'Log',
    'Log2',
    'Log10',
    'Sin',
    'Cos',
    'Tan',
    'Exp',
  ];
  if (transcendentals.includes(op) && expr.op1?.isConstant) {
    return true;
  }
  // Recursively check sub-expressions
  if (expr.ops) {
    for (const child of expr.ops) {
      if (hasSymbolicTranscendental(child)) return true;
    }
  }
  return false;
}

/**
 * Simplify a derivative result, preserving symbolic transcendental constants.
 * If the expression contains symbolic transcendentals like ln(2), return it
 * without full evaluation to avoid numeric conversion.
 */
function simplifyDerivative(expr: BoxedExpression): BoxedExpression {
  if (hasSymbolicTranscendental(expr)) {
    // Just return canonical form without simplification to preserve
    // symbolic transcendentals like ln(2).
    // Note: simplify() has a bug that returns NaN for expressions
    // like ['Multiply', ['Power', 2, 'x'], ['Ln', 2]] (see TODO #10)
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
  Arcsinh: ['Power', ['Add', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Arccosh: ['Power', ['Subtract', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Arctanh: ['Power', ['Subtract', 1, ['Power', '_', 2]], -1],
  // d/dx arcsech(x) = -1 / (x * sqrt(1 - x^2))
  Arcsech: [
    'Negate',
    [
      'Divide',
      1,
      ['Multiply', '_', ['Sqrt', ['Subtract', 1, ['Power', '_', 2]]]],
    ],
  ],
  // d/dx arccsch(x) = -1 / (|x| * sqrt(1 + x^2))
  Arccsch: [
    'Negate',
    [
      'Divide',
      1,
      ['Multiply', ['Abs', '_'], ['Sqrt', ['Add', 1, ['Power', '_', 2]]]],
    ],
  ],
  Arccoth: ['Negate', ['Power', ['Subtract', 1, ['Power', '_', 2]], -1]],
  // Exp: ['Exp', '_'],   // Gets canonicalized to Power
  Ln: ['Divide', 1, '_'],
  Log: ['Power', ['Multiply', '_', ['Ln', '10']], -1],
  Sqrt: ['Multiply', ['Power', '_', ['Negate', 'Half']], 'Half'],
  Abs: [
    'Which',
    ['Equal', '_', 0],
    NaN,
    ['Less', '_', 0],
    -1,
    ['Greater', '_', 0],
    1,
    'True',
    ['D', ['Abs', '_'], '_'],
  ],
  // https://proofwiki.org/wiki/Derivative_of_Error_Function
  Erf: [
    'Multiply',
    ['Divide', '2', ['Sqrt', 'Pi']],
    ['Exp', ['Negate', ['Square', '_']]],
  ],
  // https://proofwiki.org/wiki/Derivative_of_Gamma_Function
  // https://en.wikipedia.org/wiki/Gamma_function
  Gamma: ['Multiply', ['Gamma', '_'], ['Digamma', '_']],
  Digamma: [
    'Add',
    ['Multiply', ['Digamma', '_'], ['Gamma', '_']],
    ['Multiply', ['Power', '_', -1], ['Gamma', '_']],
  ],
  Zeta: ['Multiply', ['Multiply', -1, ['Zeta', '_']], ['Digamma', '_']],
  PolyGamma: [
    'Add',
    ['Multiply', ['PolyGamma', '_'], ['Gamma', '_']],
    ['Multiply', ['Power', '_', -1], ['Gamma', '_']],
  ],
  Beta: [
    'Multiply',
    [
      'Add',
      ['Multiply', ['Beta', '_'], ['Digamma', '_']],
      ['Multiply', ['Power', '_', -1], ['Beta', '_']],
    ],
    ['Beta', '_'],
  ],
  Erfc: [
    'Multiply',
    ['Negate', ['Erfc', '_']],
    ['Exp', ['Negate', ['Power', '_', 2]]],
    ['Power', '_', -1],
  ],
  LambertW: [
    'Multiply',
    ['Power', '_', -1],
    [
      'Multiply',
      ['Add', '_', ['LambertW', '_']],
      ['Add', ['LambertW', '_'], 1],
    ],
  ],
  AiryAi: ['Multiply', ['AiryAi', '_'], ['AiryBi', '_']],
  AiryBi: ['Multiply', ['AiryAi', '_'], ['AiryBi', '_']],
  BesselJ: ['Multiply', ['BesselJ', '_'], ['BesselY', '_']],
  BesselY: ['Multiply', ['BesselJ', '_'], ['BesselY', '_']],
  BesselI: ['Multiply', ['BesselI', '_'], ['BesselK', '_']],
  BesselK: ['Multiply', ['BesselI', '_'], ['BesselK', '_']],
  FresnelS: ['Multiply', ['FresnelS', '_'], ['FresnelC', '_']],
  FresnelC: ['Multiply', ['FresnelS', '_'], ['FresnelC', '_']],
  Erfi: ['Multiply', ['Erfi', '_'], ['Erf', '_']],
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
      const fPrime = differentiate(base, v) ?? ce._fn('D', [base, ce.symbol(v)]);
      return simplifyDerivative(
        exponent.mul(base.pow(exponent.add(ce.NegativeOne))).mul(fPrime)
      );
    }

    if (!baseHasV && expHasV) {
      // Only exponent depends on v: d/dx a^g(x) = a^g(x) * ln(a) * g'(x)
      // Use ce._fn('Ln', ...) instead of base.ln() to keep ln symbolic
      // Use ce._fn('Multiply', ...) instead of .mul() to avoid the NaN bug
      // in Product.mul() when multiplying by ln(constant) (see TODO #10)
      const gPrime =
        differentiate(exponent, v) ?? ce._fn('D', [exponent, ce.symbol(v)]);
      const lnBase = ce._fn('Ln', [base]);
      // Construct the multiply expression directly to avoid Product.mul() NaN bug
      const terms = [expr, lnBase];
      if (!gPrime.is(1)) terms.push(gPrime);
      const result =
        terms.length === 1 ? terms[0] : ce._fn('Multiply', terms).canonical;
      return simplifyDerivative(result);
    }

    // Both depend on v: d/dx f(x)^g(x) = f(x)^g(x) * (g'(x) * ln(f(x)) + g(x) * f'(x) / f(x))
    const f = base;
    const g = exponent;
    const fPrime = differentiate(f, v) ?? ce._fn('D', [f, ce.symbol(v)]);
    const gPrime = differentiate(g, v) ?? ce._fn('D', [g, ce.symbol(v)]);
    // Use ce._fn('Ln', ...) instead of f.ln() to keep ln symbolic
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
  if (!h) {
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
  return apply(ce.box(h), [g]).mul(gPrime);
}
