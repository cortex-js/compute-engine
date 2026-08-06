import type { Expression } from './global-types.js';
import type { NumericValue } from './numeric-value/types.js';
import {
  isSymbol,
  isNumber,
  isFunction,
  numericValue,
} from './boxed-expression/type-guards.js';

/**
 * The Cost Function is used to select the simplest between two expressions:
 * the one with the lowest cost function.
 *
 * It is based on the Mathematica cost function.
 *
 *
 * From https://reference.wolfram.com/language/ref/ComplexityFunction.html
 *
 * ```
 * SimplifyCount[p_] :=
 *  Which[
 *
 *   Head[p] === Symbol, 1,
 *
 *   IntegerQ[p],
 *   If[
 *      p == 0, 1,
 *      Floor[N[Log[2, Abs[p]]/Log[2, 10]]] + If[p > 0, 1, 2]
 *   ],
 *
 *   Head[p] === Rational,
 *   SimplifyCount[Numerator[p]] + SimplifyCount[Denominator[p]] + 1,
 *
 *   Head[p] === Complex,
 *   SimplifyCount[Re[p]] + SimplifyCount[Im[p]] + 1,
 *
 *   NumberQ[p], 2,
 *
 *   True, SimplifyCount[Head[p]] +
 *    If[
 *      Length[p] == 0, 0,
 *      Plus @@ (SimplifyCount /@ (List @@ p))]
 *    ]
 * ```
 */

function numericCostFunction(n: NumericValue | number): number {
  if (typeof n === 'number') {
    if (n === 0) return 1;
    if (Number.isInteger(n))
      return (
        Math.floor(Math.log2(Math.abs(n)) / Math.log2(10)) + (n > 0 ? 1 : 2)
      );
    return 2;
  }

  if (n.isZero) return 1;

  if (n.im !== 0) {
    // A pure-imaginary exact value carries its radical in `imRadical`, so it
    // needs the same treatment as the real one below — otherwise `i√17` prices
    // at 4 while `√17` prices at 7, and D6's fix is only half applied.
    const imRad = (n as { imRadical?: number }).imRadical;
    const imExtra =
      imRad !== undefined && imRad > 1 ? 3 + numericCostFunction(imRad) : 0;
    return (
      numericCostFunction(n.re) + numericCostFunction(n.im) + imExtra + 1
    );
  }

  // An exact value is `rational × √radical`. Price the radical explicitly:
  // `.re` is a machine float, so without this `√3`, `2√3` and `√17` all cost
  // 2 — exactly what the plain float `0.5` costs — and the radical is
  // invisible to every comparison. That is what let the nested `√(2√3)` (7)
  // beat the single `⁴√12` (8).
  //
  // The premium is calibrated so a radical LITERAL costs about what the
  // equivalent expression costs: `Sqrt(y)` prices at 6, and `√3` now prices
  // at 6 too.
  const radical = (n as { radical?: number }).radical;
  if (radical !== undefined && radical > 1)
    return numericCostFunction(n.re) + 3 + numericCostFunction(radical);

  return numericCostFunction(n.re);
}

/**
 * The default cost function, used to determine if a new expression is simpler
 * than the old one.
 *
 * To change the cost function used by the engine, set the
 * `ce.costFunction` property of the engine or pass a custom cost function
 * to the `simplify` function.
 *
 */
/**
 * Price a `Power(base, exp)`. Extracted so the alias heads that canonicalize
 * to a Power (`Square`, `Exp`) price identically to the canonical form — the
 * cost function must not depend on which representation it is handed.
 *
 * The base is mostly ignored so that `2q^2` beats `2qq`, except when the base
 * is a `Negate` (so `(-x)^n` is not cheaper than `-x^n`) or a `Multiply` (so
 * `(ab)^n` is not artificially cheaper than the distributed `a^n b^n`).
 */
function powerCost(base: Expression, exp: Expression): number {
  const expCost = costFunction(exp);
  // Count a negated base too. This used to be a flat `expCost + 4`, which
  // discarded everything under the sign — the same defect as the removed
  // `Negate(Power(...))` shortcut, just on the other side. Once `Power` began
  // counting its base it became load-bearing: `(-sin x)^2` scored 5 against
  // `sin(x)^2` at 12, so the gate REJECTED the rewrite and left the negation
  // in place. A symbol base hid it (`(-x)^2 -> x^2` still worked).
  if (base.operator === 'Negate') return expCost + costFunction(base);
  if (isFunction(base, 'Multiply')) {
    // A negative coefficient under a fractional exponent must factor its sign
    // out for a correct real result, so make the unfactored form expensive.
    const hasNegativeCoef = base.ops.some(
      (f) => isNumber(f) && f.isNegative === true
    );
    if (hasNegativeCoef && exp.isRational === true && !exp.isInteger)
      return expCost + costFunction(base) + 15;
    return expCost + costFunction(base);
  }
  // Count the base. It used to be discarded for every base that was not a
  // `Negate` or `Multiply`, which priced `(a+b+c+d)^20` at 2 — the same as
  // `x^20`, and barely above `x^2` — even though it expands to 1,771 terms.
  // The stated goal ("`2q^2` should beat `2qq`") survives: a power still costs
  // far less than the repeated multiplication it replaces.
  return expCost + costFunction(base);
}

export function costFunction(expr: Expression): number {
  // Special-case: Encourage the "exp/log separation" rewrite used by
  // `simplifyLog()` for base-10 logs:
  //
  //   exp(log(x) + y)  ->  x^(1/ln(10)) * e^y
  //
  // Without this tweak, the separated form can look more expensive than
  // `exp(log(x)+y)` because it introduces an explicit `1/ln(10)` exponent.
  //
  // This is intentionally narrow and only affects the specific separated form
  // we generate (a 2-factor Multiply). It exists to prevent a readability
  // rewrite from being rejected purely by the default cost heuristic.
  const expLogSepCost = (() => {
    if (!isFunction(expr, 'Multiply') || expr.ops.length !== 2) return null;

    const match = (
      xPow: Expression,
      ePow: Expression
    ): { xBase: Expression; eExp: Expression } | null => {
      if (!isFunction(ePow, 'Power')) return null;
      if (!isSymbol(ePow.op1, 'ExponentialE')) return null;

      if (!isFunction(xPow, 'Power')) return null;

      // Match exponent: 1/ln(10)
      const exponent = xPow.op2;
      if (!isFunction(exponent, 'Divide')) return null;
      if (exponent.op1?.isSame(1) !== true) return null;

      const denom = exponent.op2;
      if (!isFunction(denom, 'Ln')) return null;
      if (denom.op1?.isSame(10) !== true) return null;

      return { xBase: xPow.op1, eExp: ePow.op2 };
    };

    const [a, b] = expr.ops;
    const m = match(a, b) ?? match(b, a);
    if (!m) return null;

    // Approximate the cost of exp(log(x)+y): Add(Log(x), y) ≈ 12 + cost(x) + cost(y)
    return 12 + costFunction(m.xBase) + costFunction(m.eExp);
  })();
  if (expLogSepCost !== null) return expLogSepCost;

  //
  // 1/ Symbols
  //

  if (isSymbol(expr)) return 1;

  //
  // 2/ Literal Numeric Values
  //

  if (isNumber(expr)) return numericCostFunction(expr.numericValue);

  const name = expr.operator;
  let nameCost = 2;
  if (['Add'].includes(name)) nameCost = 3;
  else if (name === 'Subtract') nameCost = 4;
  else if (name === 'Negate') {
    // No `Negate(Power(...))` shortcut. There used to be one returning
    // `3 + cost(exponent)`, which discarded the base — so once `Power` began
    // counting its base, `-sin²x` cost 4 while `sin²x` cost 12: the same
    // subexpression priced three-fold apart on nothing but a leading sign.
    // That inconsistency, not the base itself, is what broke `1 - sin²x →
    // cos²x` (the negated form scored 8 against the identity's 12). The
    // generic path below prices it as sign + power, which stays consistent.
    const fnNeg = isFunction(expr) ? expr : undefined;
    // A leading sign on a TERM is visually almost free — `-a - b - c` reads
    // lighter than `-(a + b + c)`, and the old flat cost of 4 said the
    // opposite (18 vs 10 for that pair), which is why distributing a negation
    // needed a `purpose: 'transform'` tag to survive the cost gate at all.
    // Negating a *sum* is different: it forces delimiters, so it keeps the
    // higher price. This also makes `Subtract(a,b)` cost the same as its
    // canonical form `Add(a, Negate(b))`, which it did not before.
    nameCost = isFunction(fnNeg?.op1, 'Add') ? 4 : 1;
  } else if (name === 'Sqrt') {
    // No perfect-square / odd-power penalties here. `Sqrt` used to carry +6
    // when its argument was a perfect square and +10 for an odd power,
    // explicitly "to encourage factoring out perfect squares" — a rewrite
    // preference encoded as a price. Those rewrites (`√(x²y) → |x|√y` and
    // friends) extract an `Abs` from under the radical, which genuinely GROWS
    // the expression, so no honest cost model will ever prefer them: the
    // penalty existed to make the model lie by exactly the margin needed
    // (`√(x²y)` 20 vs `|x|√y` 19 — a margin of 1, entirely manufactured).
    //
    // They are real-domain correctness rewrites, so they now declare
    // themselves with `purpose: 'transform'` in `simplify-power.ts` instead.
    // The penalty was not even sufficient: `√(x³)` (16) still beat `|x|√x`
    // (19) with the +10 applied.
    nameCost = 5;
  } else if (name === 'Square' || name === 'Exp') {
    // These canonicalize to a `Power` — `Square(x)` to `Power(x, 2)` and
    // `Exp(x)` to `Power(ExponentialE, x)` — so price them through the very
    // same helper. Costing them as ordinary function heads made the price
    // depend on which form the caller happened to be holding (`Square(x)` was
    // 6 structural vs 1 canonical, `Exp(x)` 10 vs 1), which matters because
    // the cost gate compares an incoming expression against a rule result that
    // may be in either form.
    const fnAlias = isFunction(expr) ? expr : undefined;
    const arg = fnAlias?.ops[0];
    if (arg !== undefined) {
      const ce = expr.engine;
      return name === 'Square'
        ? powerCost(arg, ce.number(2))
        : powerCost(ce.E, arg);
    }
    nameCost = 5;
  } else if (name === 'Abs') nameCost = 5;
  else if (name === 'Power') {
    const fnExprPow = isFunction(expr) ? expr : undefined;
    if (fnExprPow) return powerCost(fnExprPow.ops[0], fnExprPow.ops[1]);
  } else if (name === 'Root') {
    // Root(x^n, n) should have comparable cost to |x|
    // Use a base cost similar to Sqrt
    nameCost = 5;
  } else if (['Multiply'].includes(name)) {
    // We want 2x to be less expensive than x + x, so if the first operand
    // is a small number coefficient, treat it as cheaper
    const fnExprMul = isFunction(expr) ? expr : undefined;
    const ops = fnExprMul?.ops ?? [];
    if (ops.length === 2 && isNumber(ops[0])) {
      // A numeral times something is a "coefficient" shape and is priced
      // near an `Add`, so that `2x` beats `x + x`.
      //
      // The coefficient's OWN cost is included. It used to be discarded, with
      // a magnitude test (`|c| <= 10`, but any rational) standing in for it —
      // which made the price jump a cliff at an arbitrary point: `10x` cost 4
      // and `11x` cost 10, a 2.5x step for the same shape, while `(1/7)x`
      // counted as "small". Integer literals are already priced by digit
      // count, which is continuous and monotone, so it does that job properly
      // and the magnitude test is redundant.
      //
      // The base costs are one lower than the discarded-coefficient version so
      // the two behaviors that were tuned in stay put: `2x` is still 4 (below
      // `x + x` at 5), and `n·ln(x)` — the preferred form of `ln(x^n)` — keeps
      // its extra discount.
      // Only an integer or rational coefficient qualifies — the same class as
      // before. Do NOT widen this to any numeric coefficient: a radical
      // coefficient getting the discount makes `√3(x + √2x)` beat the factored
      // `√3·x(1+√2)`, because the discount applies to the unfactored form's
      // outer `√3` too.
      const coefType = isNumber(ops[0]) ? ops[0].numericValue : undefined;
      const t = typeof coefType === 'number' ? undefined : coefType?.type;
      const isCoef =
        typeof coefType === 'number'
          ? Number.isInteger(coefType)
          : t === 'finite_integer' || t === 'finite_rational';
      if (isCoef) {
        const secondOp = ops[1].operator;
        const base = ['Ln', 'Log', 'Lb'].includes(secondOp) ? 1 : 2;
        return base + costFunction(ops[0]) + costFunction(ops[1]);
      }
    }
    nameCost = 7;
  } else if (name === 'Integrate') {
    // Weigh an UNEVALUATED integral heavily, so a rewrite that resolves one is
    // not rejected for being bigger. Note this is a large finite premium, not
    // a guarantee: a closed form more than ~100 units larger than its integral
    // would still lose. Nothing else in the model weighs it at all: `Integrate` used to fall into the generic bucket
    // (11), and an antiderivative can be far larger than its integrand — so
    // `simplify()` kept `∫sec³x dx` (49) rather than accept its closed form
    // (78), and `∫1/(x⁴+1)dx` (62) rather than 145, even though `evaluate()`
    // resolves both. The flat premium below dominates that gap.
    //
    // It is a flat premium, not a multiplier, so it cancels when comparing two
    // expressions that each hold one integral (the integrand still decides),
    // and an expression with FEWER integrals still wins — which is what makes
    // `∫(f+g)` preferred over `∫f + ∫g`.
    nameCost = 100;
  } else if (['Divide'].includes(name)) nameCost = 8;
  else if (['Ln', 'Log', 'Lb'].includes(name)) nameCost = 9;
  else if (['Cos', 'Sin', 'Tan'].includes(name)) nameCost = 10;
  else nameCost = 11;

  const fnExprFinal = isFunction(expr) ? expr : undefined;
  return (
    nameCost +
    (fnExprFinal?.ops.reduce((acc, x) => acc + costFunction(x), 0) ?? 0)
  );
}

export function leafCount(expr: Expression): number {
  if (isSymbol(expr)) return 1;
  if (isNumber(expr)) return numericCostFunction(expr.numericValue);
  const fnExpr = isFunction(expr) ? expr : undefined;
  return 1 + (fnExpr?.ops.reduce((acc, x) => acc + leafCount(x), 0) ?? 0);
}

export const DEFAULT_COST_FUNCTION = costFunction;
