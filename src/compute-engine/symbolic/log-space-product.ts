import type { Expression } from '../global-types.js';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards.js';

/**
 * The product `body` written in log space, `sign · exp(Σ log|factor|)`, for
 * the samples of a numeric integral where `body` evaluates to `NaN` or to an
 * infinity, or `undefined` when `body` is not such a product.
 *
 * A product of a factor that grows and an exponential that decays has a value
 * where each factor alone does not: `x¹⁰⁰·e⁻ˣ` at `x = 2000` is about
 * `10⁻⁵³⁸`, but `x¹⁰⁰` is `∞` and `e⁻ˣ` is `0` in double precision, and their
 * product is `NaN`. The same product in log space,
 * `exp(100·ln x − x)`, is a number. A quadrature of such an integrand reads a
 * `NaN` tail and does not converge (`∫₀^∞ x¹⁰⁰·e⁻ˣ dx = 100!`). The callers
 * evaluate `body` first and use this form only where `body` is not finite, so
 * the value of every other sample is unchanged.
 *
 * The form is built when `body` (a `Block` of one statement is read through)
 * is a `Multiply` or a `Divide` with an exponential factor (`Exp(u)` or
 * `Power(ExponentialE, u)`) whose argument depends on one of `variables`, and
 * another factor that depends on one of them. Each factor `g` contributes:
 * - `Exp(u)`: `u` to the sum, sign `1`;
 * - `Power(b, p)` with `p` free of `variables`: `p·ln(b)` when `p` is a
 *   number literal that is not an integer (a negative base has no real
 *   power, and `ln(b)` is `NaN` there too), and `p·ln|b|` with the sign
 *   `sign(b)^p` otherwise (an integer, or a symbol that may hold one);
 * - `Sqrt(b)`: `ln(b)/2`;
 * - any other factor: `ln|g|` and the sign `sign(g)`.
 * A factor of a `Divide` denominator contributes the opposite term. A zero
 * factor gives `ln 0 = −∞`, so the form is `0` there, as the product is. A
 * factor free of `variables` (`1/Γ(k/2)`) is kept out of the exponential, as
 * a factor of the result.
 */
export function logSpaceProduct(
  body: Expression,
  variables: ReadonlyArray<string>
): Expression | undefined {
  const ce = body.engine;
  const expr =
    isFunction(body, 'Block') && body.nops === 1 ? body.ops[0] : body;
  const dependsOnVariable = (e: Expression) => variables.some((v) => e.has(v));

  // The factors, with `1` for a numerator factor and `-1` for a denominator
  // factor.
  const factors: { factor: Expression; power: 1 | -1 }[] = [];
  const collect = (e: Expression, power: 1 | -1): void => {
    if (isFunction(e, 'Multiply')) {
      for (const op of e.ops) collect(op, power);
    } else if (isFunction(e, 'Divide')) {
      collect(e.op1, power);
      collect(e.op2, power === 1 ? -1 : 1);
    } else factors.push({ factor: e, power });
  };
  if (!isFunction(expr, 'Multiply') && !isFunction(expr, 'Divide'))
    return undefined;
  collect(expr, 1);

  const exponentOf = (e: Expression): Expression | undefined => {
    if (isFunction(e, 'Exp')) return e.op1;
    if (isFunction(e, 'Power') && isSymbol(e.op1, 'ExponentialE')) return e.op2;
    return undefined;
  };
  const hasDecay = factors.some(({ factor }) => {
    const u = exponentOf(factor);
    return u !== undefined && dependsOnVariable(u);
  });
  const variableFactors = factors.filter(({ factor }) =>
    dependsOnVariable(factor)
  ).length;
  if (!hasDecay || variableFactors < 2) return undefined;

  const terms: Expression[] = [];
  const signs: Expression[] = [];
  // The factors free of the variables stay out of the exponential, as they
  // are: they are finite where the integral has a value, and a compiled
  // integrand computes them once (`hoistLoopInvariants`).
  const numerator: Expression[] = [];
  const denominator: Expression[] = [];
  for (const { factor, power } of factors) {
    if (!dependsOnVariable(factor)) {
      (power === 1 ? numerator : denominator).push(factor);
      continue;
    }
    let term: Expression;
    const u = exponentOf(factor);
    if (u !== undefined) term = u;
    else if (isFunction(factor, 'Power') && !dependsOnVariable(factor.op2)) {
      const [base, p] = [factor.op1, factor.op2];
      // A number literal that is not an integer: a negative base has no real
      // power, and `ln(b)` is `NaN` there too. Any other exponent free of the
      // variables (an integer, or a symbol that may hold one) reads the sign
      // of the base: `sign(b)^p` is `±1` for an integer `p`, and `NaN` for a
      // negative base otherwise, as the power is.
      if (!(isNumber(p) && p.isInteger !== true)) {
        term = ce.function('Multiply', [
          p,
          ce.function('Ln', [ce.function('Abs', [base])]),
        ]);
        signs.push(ce.function('Power', [ce.function('Sign', [base]), p]));
      } else term = ce.function('Multiply', [p, ce.function('Ln', [base])]);
    } else if (isFunction(factor, 'Sqrt'))
      term = ce.function('Multiply', [
        ce.Half,
        ce.function('Ln', [factor.op1]),
      ]);
    else {
      term = ce.function('Ln', [ce.function('Abs', [factor])]);
      signs.push(ce.function('Sign', [factor]));
    }
    terms.push(power === 1 ? term : ce.function('Negate', [term]));
  }
  const exponential = ce.function('Exp', [ce.function('Add', terms)]);
  const product =
    signs.length + numerator.length === 0
      ? exponential
      : ce.function('Multiply', [...numerator, ...signs, exponential]);
  return denominator.length === 0
    ? product
    : ce.function('Divide', [
        product,
        denominator.length === 1
          ? denominator[0]
          : ce.function('Multiply', denominator),
      ]);
}
