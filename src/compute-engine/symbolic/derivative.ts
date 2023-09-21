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
  Sin: 'Cos',
  Cos: ['Negate', 'Sin'],
  Tan: ['Power', ['Sec', '_'], 2],
  Sec: ['Multiply', 'Tan', 'Sec'],
  Csc: ['Multiply', ['Negate', 'Cot'], 'Csc'],
  Cot: ['Negate', ['Power', ['Csc', '_'], 2]],
  ArcSin: ['Power', ['Subtract', 1, ['Power', '_', 2]], -0.5],
  ArcCos: ['Negate', ['Power', ['Subtract', 1, ['Power', '_', 2]], -0.5]],
  ArcTan: ['Power', ['Add', 1, ['Power', '_', 2]], -1],
  ArcSec: [
    'Multiply',
    ['Power', ['Subtract', 1, ['Power', '_', 2]], -0.5],
    ['Negate', ['Power', '_', 2]],
  ],
  ArcCsc: [
    'Multiply',
    ['Power', ['Subtract', 1, ['Power', '_', 2]], -0.5],
    ['Negate', ['Power', '_', 2]],
  ],
  ArcCot: ['Negate', ['Power', ['Add', 1, ['Power', '_', 2]], -1]],
  Sinh: 'Cosh',
  Cosh: 'Sinh',
  Tanh: ['Power', ['Sech', '_'], 2],
  Sech: ['Multiply', ['Tanh', '_'], 'Sech'],
  Csch: ['Multiply', ['Coth', '_'], 'Csch'],
  Coth: ['Negate', ['Power', ['Csch', '_'], 2]],
  ArcSinh: ['Power', ['Add', ['Power', '_', 2], 1], -0.5],
  ArcCosh: ['Power', ['Subtract', ['Power', '_', 2], 1], -0.5],
  ArcTanh: ['Power', ['Subtract', 1, ['Power', '_', 2]], -1],
  ArcSech: [
    'Negate',
    ['Power', ['Multiply', '2', 'Subtract', ['Power', '_', 2]], -0.5],
  ],
  ArcCsch: [
    'Negate',
    ['Power', ['Multiply', '2', 'Add', ['Power', '_', 2]], -0.5],
  ],
  ArcCoth: ['Negate', ['Power', ['Subtract', 1, ['Power', '_', 2]], -1]],
  Exp: 'Exp',
  Ln: ['Power', '_', -1],
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
 * Calculate the partial derivative of an expression with respect to a
 * variable, `v`.
 */
export function partialDerivative(
  expr: BoxedExpression,
  v: string
): BoxedExpression | undefined {
  // A few easy ones...
  if (expr.string || expr.keys) return undefined;
  if (expr.numericValue !== null) return expr.engine._ZERO;
  if (expr.symbol === v) return expr.engine._ONE;
  if (expr.symbol) return expr.engine._ZERO;

  if (expr.head && typeof expr.head === 'string') {
    const ce = expr.engine;

    if (expr.head === 'Negate') {
      const gPrime = partialDerivative(expr.op1, v);
      if (!gPrime)
        return ce.neg(ce._fn('Derivative', [expr.op1!, ce.symbol(v)]));
      return ce.neg(gPrime);
    }

    // Sum rule
    if (expr.head === 'Add') {
      const terms = expr.ops!.map((op) => partialDerivative(op, v));
      if (terms.some((term) => term === undefined)) return undefined;
      return ce.add(terms as BoxedExpression[]);
    }

    // Product rule
    if (expr.head === 'Multiply') {
      const terms = expr.ops!.map((op, i) => {
        const otherTerms = expr.ops!.slice();
        otherTerms.splice(i, 1);
        const otherProduct = ce.mul(otherTerms);
        const gPrime =
          partialDerivative(op, v) ?? ce._fn('Derivative', [op, ce.symbol(v)]);
        return ce.mul([gPrime, otherProduct]);
      });
      if (terms.some((term) => term === undefined)) return undefined;
      return ce.add(terms as BoxedExpression[]);
    }

    // Power rule
    if (expr.head === 'Power') {
      const [base, exponent] = expr.ops!;
      const gPrime =
        partialDerivative(base, v) ??
        ce._fn('Derivative', [base, ce.symbol(v)]);
      const hPrime =
        partialDerivative(exponent, v) ??
        ce._fn('Derivative', [exponent, ce.symbol(v)]);
      return ce.mul([
        ce._fn('Power', [base, exponent]),
        ce.add([
          ce.mul([gPrime, ce._fn('Ln', [base])]),
          ce.mul([hPrime, exponent]),
        ]),
      ]);
    }

    // Quotient rule
    if (expr.head === 'Divide') {
      const [numerator, denominator] = expr.ops!;
      const gPrime =
        partialDerivative(numerator, v) ??
        ce._fn('Derivative', [numerator, ce.symbol(v)]);
      const hPrime =
        partialDerivative(denominator, v) ??
        ce._fn('Derivative', [denominator, ce.symbol(v)]);
      return ce.div(
        ce.add([
          ce.mul([gPrime, denominator]),
          ce.neg(ce.mul([hPrime, numerator])),
        ]),
        ce.pow(denominator, 2)
      );
    }

    const h = DERIVATIVES_TABLE[expr.head];
    if (!h) return ce._fn('Derivative', [expr, ce.symbol(v)]);
    // Apply the chain rule:
    // d/dx f(g(x)) = f'(g(x)) * g'(x)
    if (expr.nops > 1) return ce._fn('Derivative', [expr, ce.symbol(v)]);
    const g = expr.ops![0];
    const gPrime =
      partialDerivative(g, v) ?? ce._fn('Derivative', [g, ce.symbol(v)]);
    return ce.mul([ce._fn(h, [g]), ce._fn(gPrime, [expr.op1!])]);
  }

  return undefined;
}
