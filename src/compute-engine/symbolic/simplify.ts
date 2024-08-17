import { factor } from '../boxed-expression/factor';
import { isRelationalOperator } from '../boxed-expression/utils';
import {
  BoxedExpression,
  RuleStep,
  RuleSteps,
  SimplifyOptions,
} from '../public';
import { replace } from '../rules';

export function simplify(
  expr: BoxedExpression,
  options?: Partial<SimplifyOptions>
): RuleSteps {
  //
  // 1/ Use the canonical form, if applicable
  //
  if (!expr.isValid) return [];

  // expr = expr.structural;

  if (
    (options?.applyDefaultSimplifications ?? true) &&
    !(expr.isCanonical || expr.isStructural)
  ) {
    const canonical = expr.canonical;
    if (
      !(canonical.isCanonical || canonical.isStructural) ||
      !canonical.isValid
    )
      return [];
    return simplify(canonical, options);
  }

  //
  // 2/ Is it a symbol?
  // Some symbols can get simplified by substitution, for example,
  // phi, the golden ratio, can be replaced by `(1 + sqrt(5)) / 2`
  //
  // We check for `!expr.isStructural` to avoid infinite recursion

  if (expr.symbol && !expr.isStructural)
    return [
      { value: expr.simplify(options), because: `value of ${expr.toString()}` },
    ];

  // If not a function, we're done
  if (expr.isNumberLiteral || expr.string || !expr.ops) return [];

  //
  // 3/ Relational Operator or Equation?
  //
  const ce = expr.engine;

  if (isRelationalOperator(expr.operator) || expr.operator === 'Equal') {
    //
    // 3.1/ Simplify both sides of the relational operator
    //

    const op1 = expr.op1.simplify(options);
    const op2 = expr.op2.simplify(options);
    expr = ce.function(expr.operator, [op1, op2]);
    if (!expr.isCanonical) debugger;

    //
    // 3.2/ Try to factor terms across the relational operator
    //   2x < 4t -> x < 2t
    //
    expr = factor(expr) ?? expr;
    console.assert(isRelationalOperator(expr.operator));
    if (expr.nops === 2) {
      // Try f(x) < g(x) -> f(x) - g(x) < 0
      if (expr.op2.isNotZero) {
        const alt = factor(
          ce.function(expr.operator, [expr.op1.sub(expr.op2), ce.Zero])
        );
        // Pick the cheapest (simplest) of the two
        expr = cheapest(expr, alt);
      }
    }
    return [{ value: expr, because: 'factor-relational-operator' }];
  }

  //
  // 4/ Apply rules, until no rules can be applied
  //

  // We assume that the arguments have been simplified, if necessary
  // (this is done in `BoxedFunction.simplify()`)

  const rules =
    options?.rules ?? expr.engine.getRuleSet('standard-simplification')!;
  const steps: RuleStep[] = [{ value: expr, because: 'initial' }];

  //
  // Loop until the expression has been previously seen,
  // or no rules can be applied
  //
  do {
    const newSteps = replace(expr, rules, options);
    if (newSteps.length === 0) break;

    const alt = newSteps.at(-1)!.value;
    if (isCheaper(expr, alt)) {
      expr = alt;
      steps.push(...newSteps);
    }
  } while (!steps.some((x) => x.value.isSame(expr)));

  return steps as RuleSteps;
}

function isCheaper(
  oldExpr: BoxedExpression,
  newExpr: BoxedExpression | null | undefined
): boolean {
  if (newExpr === null || newExpr === undefined) return false;
  if (oldExpr === newExpr) return false;

  if (oldExpr.isSame(newExpr)) return false;

  const ce = oldExpr.engine;
  if (ce.costFunction(newExpr) <= 1.2 * ce.costFunction(oldExpr)) {
    // console.log(
    //   'Picked new' + boxedNewExpr.toString() + ' over ' + oldExpr.toString()
    // );
    return true;
  }

  // console.log(
  //   'Picked old ' + oldExpr.toString() + ' over ' + newExpr.toString()
  // );
  return false;
}

/**
 * Considering an old (existing) expression and a new (simplified) one,
 * return the cheapest of the two, with a bias towards the new (which can
 * actually be a bit more expensive than the old one, and still be picked).
 */
function cheapest(
  oldExpr: BoxedExpression,
  newExpr: BoxedExpression | null | undefined
): BoxedExpression {
  return isCheaper(oldExpr, newExpr) ? newExpr! : oldExpr;
}
