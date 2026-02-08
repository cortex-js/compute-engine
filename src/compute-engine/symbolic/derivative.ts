import { apply } from '../function-utils';
import { mul } from '../boxed-expression/arithmetic-mul-div';
import type { BoxedExpression } from '../global-types';
import { add } from '../boxed-expression/arithmetic-add';

/**
 * Maximum recursion depth for differentiation.
 *
 * This guards against pathological cases where differentiation rules
 * might loop indefinitely. Normal derivatives (including higher-order)
 * should never approach this limit.
 */
const MAX_DIFFERENTIATION_DEPTH = 100;

/**
 * Return a derivative result without simplification.
 *
 * ## Recursion Safety
 *
 * IMPORTANT: Do not call `.simplify()` on the result to avoid infinite recursion
 * when derivative operations are called from within simplification rules.
 *
 * The differentiation system has multiple layers of recursion protection:
 *
 * 1. **This function** - Returns expressions without calling `.simplify()`
 * 2. **D operator guard** (calculus.ts) - Returns early if result is still `D`
 * 3. **differentiate() guard** - Returns `undefined` if evaluating `D` yields `D`
 * 4. **Depth limit** - `MAX_DIFFERENTIATION_DEPTH` prevents runaway recursion
 * 5. **DERIVATIVES_TABLE check** - Uses `=== undefined` not `!h` to handle `h = 0`
 *
 * The arithmetic operations (add, mul, etc.) already produce canonical forms.
 */
function simplifyDerivative(expr: BoxedExpression): BoxedExpression {
  return expr;
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
    [
      'Multiply',
      ['Divide', 2, ['Sqrt', 'Pi']],
      ['Exp', ['Negate', ['Square', '_']]],
    ],
  ],
  // d/dx ln(Γ(x)) = ψ(x) (digamma function)
  GammaLn: ['Digamma', '_'],
  // d/dx ψ(x) = ψ₁(x) (trigamma function)
  // https://en.wikipedia.org/wiki/Trigamma_function
  Digamma: ['Trigamma', '_'],
  // d/dx W(x) = W(x)/(x·(1+W(x))) where W is the Lambert W function
  // https://en.wikipedia.org/wiki/Lambert_W_function#Derivative
  LambertW: [
    'Divide',
    ['LambertW', '_'],
    ['Multiply', '_', ['Add', 1, ['LambertW', '_']]],
  ],
  // d/dx S(x) = sin(πx²/2) where S is the Fresnel sine integral
  FresnelS: ['Sin', ['Multiply', ['Divide', 'Pi', 2], ['Square', '_']]],
  // d/dx C(x) = cos(πx²/2) where C is the Fresnel cosine integral
  FresnelC: ['Cos', ['Multiply', ['Divide', 'Pi', 2], ['Square', '_']]],
  // d/dx erfi(x) = (2/√π)·e^(x²) where erfi is the imaginary error function
  Erfi: ['Multiply', ['Divide', 2, ['Sqrt', 'Pi']], ['Exp', ['Square', '_']]],
  // Note: Bessel functions (BesselJ, BesselY, BesselI, BesselK) and Airy functions
  // (AiryAi, AiryBi) have been omitted because their derivatives involve functions
  // of different orders or related derivative functions that are not in the standard
  // function set. For example, d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2.
  //
  // Similarly, Zeta, PolyGamma, and Beta derivatives are omitted because
  // they either don't have simple closed forms or involve the polygamma function
  // with varying orders.
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
 * ## Recursion Safety
 *
 * This function includes a depth limit (`MAX_DIFFERENTIATION_DEPTH`) to prevent
 * stack overflow from pathological expressions. The depth is tracked internally
 * and incremented on each recursive call. If the limit is reached, the function
 * returns `undefined` rather than continuing to recurse.
 *
 * Normal differentiation (including higher-order derivatives of complex
 * expressions) should never approach this limit. Hitting the limit indicates
 * either a bug in the differentiation rules or a maliciously constructed input.
 *
 * @param expr - The expression to differentiate
 * @param v - The variable to differentiate with respect to
 * @param depth - Internal recursion depth counter (do not pass manually)
 * @returns The derivative expression, or `undefined` if unable to differentiate
 */
export function differentiate(
  expr: BoxedExpression,
  v: string,
  depth: number = 0
): BoxedExpression | undefined {
  // Guard against runaway recursion
  if (depth > MAX_DIFFERENTIATION_DEPTH) {
    console.assert(
      false,
      `Differentiation depth limit (${MAX_DIFFERENTIATION_DEPTH}) exceeded`
    );
    return undefined;
  }

  const ce = expr.engine;

  // A few easy ones...
  if (expr.string) return undefined;
  if (expr.isNumberLiteral) return expr.engine.Zero;
  if (expr.symbol === v) return expr.engine.One;
  if (expr.symbol) return expr.engine.Zero;
  if (!expr.operator) return undefined;
  if (expr.operator === 'Negate') {
    const gPrime = differentiate(expr.op1, v, depth + 1);
    if (gPrime) return gPrime.neg();
    return ce._fn('D', [expr.op1!, ce.symbol(v)]).neg();
  }

  // Block - just differentiate the content
  if (expr.operator === 'Block') {
    return differentiate(expr.op1, v, depth + 1);
  }

  // D - evaluate the derivative first, then differentiate the result
  if (expr.operator === 'D') {
    const evaluated = expr.evaluate();
    // Avoid infinite recursion if D doesn't simplify
    if (evaluated.operator === 'D') return undefined;
    return differentiate(evaluated, v, depth + 1);
  }

  // Sum rule
  if (expr.operator === 'Add') {
    const terms = expr.ops!.map((op) => differentiate(op, v, depth + 1));
    if (terms.some((term) => term === undefined)) return undefined;
    return simplifyDerivative(add(...(terms as BoxedExpression[])));
  }

  // Product rule
  if (expr.operator === 'Multiply') {
    const terms = expr.ops!.map((op, i) => {
      const otherTerms = expr.ops!.slice();
      otherTerms.splice(i, 1);
      const otherProduct = mul(...otherTerms);
      const gPrime =
        differentiate(op, v, depth + 1) ?? ce._fn('D', [op, ce.symbol(v)]);
      return gPrime.mul(otherProduct);
    });
    if (terms.some((term) => term === undefined)) return undefined;
    return simplifyDerivative(add(...(terms as BoxedExpression[])));
  }

  // Root rule: Root(base, n) = base^(1/n)
  // d/dx Root(base, n) = d/dx base^(1/n) = (1/n) * base^((1/n) - 1) * d/dx base
  if (expr.operator === 'Root') {
    const [base, n] = expr.ops!;
    if (!base.has(v)) return ce.Zero;

    // Compute derivative using the power rule
    // d/dx base^(1/n) = (1/n) * base^((1/n) - 1) * base'
    const exponent = ce.One.div(n); // 1/n
    const basePrime =
      differentiate(base, v, depth + 1) ?? ce._fn('D', [base, ce.symbol(v)]);
    const newExponent = exponent.sub(ce.One); // (1/n) - 1 = (1-n)/n

    // Create Power expression as structural (bound but not canonicalized) to avoid Root conversion
    const power = ce.function('Power', [base, newExponent], {
      form: 'structural',
    });

    return simplifyDerivative(exponent.mul(power).mul(basePrime));
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
        differentiate(base, v, depth + 1) ?? ce._fn('D', [base, ce.symbol(v)]);
      return simplifyDerivative(
        exponent.mul(base.pow(exponent.add(ce.NegativeOne))).mul(fPrime)
      );
    }

    if (!baseHasV && expHasV) {
      // Only exponent depends on v: d/dx a^g(x) = a^g(x) * ln(a) * g'(x)
      // Use ce._fn('Ln', ...) instead of base.ln() to keep ln symbolic
      // (base.ln() evaluates to a numeric value).
      const gPrime =
        differentiate(exponent, v, depth + 1) ??
        ce._fn('D', [exponent, ce.symbol(v)]);
      const lnBase = ce._fn('Ln', [base]);
      return simplifyDerivative(expr.mul(lnBase).mul(gPrime));
    }

    // Both depend on v: d/dx f(x)^g(x) = f(x)^g(x) * (g'(x) * ln(f(x)) + g(x) * f'(x) / f(x))
    const f = base;
    const g = exponent;
    const fPrime =
      differentiate(f, v, depth + 1) ?? ce._fn('D', [f, ce.symbol(v)]);
    const gPrime =
      differentiate(g, v, depth + 1) ?? ce._fn('D', [g, ce.symbol(v)]);
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
      differentiate(numerator, v, depth + 1) ??
      ce._fn('D', [numerator, ce.symbol(v)]);
    const hPrime =
      differentiate(denominator, v, depth + 1) ??
      ce._fn('D', [denominator, ce.symbol(v)]);
    return simplifyDerivative(
      gPrime.mul(denominator).sub(hPrime.mul(numerator)).div(denominator.pow(2))
    );
  }

  // Log(x, base) - logarithm with custom base
  // d/dx log_b(x) = 1/(x·ln(b)) when only x depends on v
  // If both x and base depend on v, use quotient rule on ln(x)/ln(base)
  if (expr.operator === 'Log' && expr.nops === 2) {
    const [x, base] = expr.ops!;
    const xHasV = x.has(v);
    const baseHasV = base.has(v);

    if (!xHasV && !baseHasV) {
      // Neither depends on v - derivative is 0
      return ce.Zero;
    }

    if (xHasV && !baseHasV) {
      // Only x depends on v: d/dx log_b(x) = 1/(x·ln(b)) * x'
      const xPrime =
        differentiate(x, v, depth + 1) ?? ce._fn('D', [x, ce.symbol(v)]);
      const lnBase = ce._fn('Ln', [base]);
      return simplifyDerivative(xPrime.div(x.mul(lnBase)));
    }

    // If base depends on v, convert to ln(x)/ln(base) and differentiate
    // d/dx (ln(x)/ln(base)) uses quotient rule
    const lnX = ce._fn('Ln', [x]);
    const lnBase = ce._fn('Ln', [base]);
    return differentiate(lnX.div(lnBase), v, depth + 1);
  }

  // Discrete functions: Mod, GCD, LCM
  // These are step functions with derivative 0 almost everywhere
  // (undefined at discontinuities, but we return 0 as a useful approximation)
  if (['Mod', 'GCD', 'LCM'].includes(expr.operator)) {
    return ce.Zero;
  }

  // Bessel function derivatives
  // BesselJ, BesselY, BesselI, BesselK have signature (order, x)
  // d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2
  // d/dx Y_n(x) = (Y_{n-1}(x) - Y_{n+1}(x))/2
  // d/dx I_n(x) = (I_{n-1}(x) + I_{n+1}(x))/2
  // d/dx K_n(x) = -(K_{n-1}(x) + K_{n+1}(x))/2
  if (
    ['BesselJ', 'BesselY', 'BesselI', 'BesselK'].includes(expr.operator) &&
    expr.nops === 2
  ) {
    const [order, x] = expr.ops!;
    const xHasV = x.has(v);
    const orderHasV = order.has(v);

    if (!xHasV && !orderHasV) {
      // Neither depends on v - derivative is 0
      return ce.Zero;
    }

    if (orderHasV) {
      // If order depends on v, we can't compute a simple derivative
      // Return symbolic derivative
      return undefined;
    }

    // Only x depends on v - apply the standard Bessel derivative formulas
    const xPrime =
      differentiate(x, v, depth + 1) ?? ce._fn('D', [x, ce.symbol(v)]);
    const op = expr.operator;
    const nMinus1 = order.sub(ce.One);
    const nPlus1 = order.add(ce.One);

    let derivative: BoxedExpression;
    if (op === 'BesselJ' || op === 'BesselY') {
      // d/dx J_n(x) = (J_{n-1}(x) - J_{n+1}(x))/2
      // d/dx Y_n(x) = (Y_{n-1}(x) - Y_{n+1}(x))/2
      const fNMinus1 = ce._fn(op, [nMinus1, x]);
      const fNPlus1 = ce._fn(op, [nPlus1, x]);
      derivative = fNMinus1.sub(fNPlus1).div(2);
    } else if (op === 'BesselI') {
      // d/dx I_n(x) = (I_{n-1}(x) + I_{n+1}(x))/2
      const fNMinus1 = ce._fn(op, [nMinus1, x]);
      const fNPlus1 = ce._fn(op, [nPlus1, x]);
      derivative = fNMinus1.add(fNPlus1).div(2);
    } else {
      // BesselK: d/dx K_n(x) = -(K_{n-1}(x) + K_{n+1}(x))/2
      const fNMinus1 = ce._fn(op, [nMinus1, x]);
      const fNPlus1 = ce._fn(op, [nPlus1, x]);
      derivative = fNMinus1.add(fNPlus1).div(2).neg();
    }

    return simplifyDerivative(derivative.mul(xPrime));
  }

  const h = DERIVATIVES_TABLE[expr.operator];
  if (h === undefined) {
    if (expr.nops > 1) return undefined;

    // If we don't know how to differentiate this function, assume it's a
    // function of v and apply the chain rule.
    const fPrime = ce._fn('Derivative', [ce.symbol(expr.operator), ce.One]);
    if (!fPrime.isValid) return undefined;
    const g = expr.ops![0];
    const gPrime =
      differentiate(g, v, depth + 1) ?? ce._fn('D', [g, ce.symbol(v)]);
    if (!gPrime.isValid) return undefined;
    return ce._fn('Apply', [fPrime, g]).mul(gPrime);
  }

  // Apply the chain rule:
  // d/dx f(g(x)) = f'(g(x)) * g'(x)
  if (expr.nops > 1) return ce._fn('D', [expr, ce.symbol(v)]);
  const g = expr.ops![0];
  const gPrime =
    differentiate(g, v, depth + 1) ?? ce._fn('D', [g, ce.symbol(v)]);
  // Substitute the argument into the derivative formula
  // We use subs() instead of apply() to avoid evaluating the expression,
  // which would convert symbolic transcendentals like ln(10) to numeric values.
  const derivFormula = ce.box(h).subs({ _: g });
  return simplifyDerivative(derivFormula.mul(gPrime));
}
