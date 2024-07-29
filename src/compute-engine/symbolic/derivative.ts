import { apply } from '../function-utils';
import { mul } from '../library/arithmetic-multiply';
import { add } from '../numerics/terms';
import { BoxedExpression } from '../public';

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
  Sech: ['Multiply', ['Tanh', '_'], 'Sech'],
  Csch: ['Multiply', ['Coth', '_'], 'Csch'],
  Coth: ['Negate', ['Power', ['Csch', '_'], 2]],
  Arcsinh: ['Power', ['Add', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Arccosh: ['Power', ['Subtract', ['Power', '_', 2], 1], ['Negate', 'Half']],
  Arctanh: ['Power', ['Subtract', 1, ['Power', '_', 2]], -1],
  Arcsech: [
    'Negate',
    [
      'Power',
      ['Multiply', '2', 'Subtract', ['Power', '_', 2]],
      ['Negate', 'Half'],
    ],
  ],
  Arccsch: [
    'Negate',
    ['Power', ['Multiply', '2', 'Add', ['Power', '_', 2]], ['Negate', 'Half']],
  ],
  Arccoth: ['Negate', ['Power', ['Subtract', 1, ['Power', '_', 2]], -1]],
  // Exp: ['Exp', '_'],   // Gets canonicalized to Power
  Ln: ['Divide', 1, '_'],
  Log: ['Power', ['Multiply', '_', ['Ln', '10']], -1],
  Sqrt: ['Multiply', ['Power', '_', ['Negate', 'Half']], 'Half'],
  Abs: [
    'Piecewise',
    ['Tuple', ['Multiply', '_', ['Power', '_', -1]], ['Greater', '_', 0]],
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
 * @param fn The function to differentiate, a `["Function"]` expression or
 * an identifier for a function name.
 *
 * @param degrees
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
  if (fn.symbol && fn.functionDefinition) {
    // We have, e.g. fn = 'Sin"
    fn = apply(ce.symbol(fn.symbol), [ce.symbol('_')]);
  }
  if (fn.head === 'Function') {
    // We have, e.g. fn = ['Function', ['Sin', 'x'], 'x']
    v = fn.ops![1].symbol ?? '_';
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
  if (expr.string || expr.keys) return undefined;
  if (expr.numericValue !== null) return expr.engine.Zero;
  if (expr.symbol === v) return expr.engine.One;
  if (expr.symbol) return expr.engine.Zero;
  if (!expr.head) return undefined;
  if (expr.head === 'Negate') {
    const gPrime = differentiate(expr.op1, v);
    if (gPrime) return gPrime.neg();
    return ce._fn('D', [expr.op1!, ce.symbol(v)]).neg();
  }

  // Sum rule
  if (expr.head === 'Add') {
    const terms = expr.ops!.map((op) => differentiate(op, v));
    if (terms.some((term) => term === undefined)) return undefined;
    return add(...(terms as BoxedExpression[])).evaluate();
  }

  // Product rule
  if (expr.head === 'Multiply') {
    const terms = expr.ops!.map((op, i) => {
      const otherTerms = expr.ops!.slice();
      otherTerms.splice(i, 1);
      const otherProduct = mul(...otherTerms);
      const gPrime = differentiate(op, v) ?? ce._fn('D', [op, ce.symbol(v)]);
      return gPrime.mul(otherProduct);
    });
    if (terms.some((term) => term === undefined)) return undefined;
    return add(...(terms as BoxedExpression[])).evaluate();
  }

  // Power rule
  if (expr.head === 'Power') {
    const [base, exponent] = expr.ops!;
    if (base.symbol === v) {
      // Derivative Power Rule
      // d/dx x^n = n * x^(n-1)

      return exponent.mul(base.pow(exponent.add(ce.NegativeOne))).evaluate();
    }

    // Generalized case:
    // d/dx f(x)^g(x) = f(x)^g(x) * (g'(x) * ln(f(x)) + g(x) * f'(x) / f(x))
    const f = base;
    const g = exponent;
    const fPrime = differentiate(f, v) ?? ce._fn('D', [f, ce.symbol(v)]);
    const gPrime = differentiate(g, v) ?? ce._fn('D', [g, ce.symbol(v)]);
    const term1 = gPrime.mul(f.ln());
    const term3 = g.mul(fPrime).div(f);
    return expr.mul(term1.add(term3)).evaluate();
  }

  // Quotient rule
  if (expr.head === 'Divide') {
    const [numerator, denominator] = expr.ops!;
    const gPrime =
      differentiate(numerator, v) ?? ce._fn('D', [numerator, ce.symbol(v)]);
    const hPrime =
      differentiate(denominator, v) ?? ce._fn('D', [denominator, ce.symbol(v)]);
    return gPrime
      .mul(denominator)
      .sub(hPrime.mul(numerator))
      .div(denominator.pow(2))
      .evaluate();
  }

  const h = DERIVATIVES_TABLE[expr.head];
  if (!h) {
    if (expr.nops > 1) return undefined;

    // If we don't know how to differentiate this function, assume it's a
    // function of v and apply the chain rule.
    const fPrime = ce._fn('Derivative', [ce.symbol(expr.head), ce.One]);
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
