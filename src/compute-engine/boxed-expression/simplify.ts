import type {
  BoxedExpression,
  RuleStep,
  RuleSteps,
  SimplifyOptions,
} from '../public';

import { factor } from './factor';
import { isRelationalOperator } from './utils';
import { replace } from './rules';
import { holdMap } from './hold';

export function simplify(
  expr: BoxedExpression,
  options?: Partial<SimplifyOptions>
): RuleSteps {
  //
  // 1/ Use the canonical form, if applicable
  //
  if (!expr.isValid) return [];

  if (!(expr.isCanonical || expr.isStructural)) {
    const canonical = expr.canonical;
    if (!(canonical.isCanonical || canonical.isStructural)) return [];
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
        expr = cheapest(expr, alt, options?.costFunction);
      }
    }
    return [{ value: expr, because: 'factor-relational-operator' }];
  }

  //
  // 4/ Apply rules, until no rules can be applied
  //

  // Simplify the operands...
  expr = simplifyFunctionOperands(expr, options);

  const rules = options?.rules
    ? ce.rules(options.rules)
    : expr.engine.getRuleSet('standard-simplification')!;

  const steps: RuleStep[] = [{ value: expr, because: 'initial' }];

  //
  // Loop until the expression has been previously seen,
  // or no rules can be applied
  //
  do {
    const newSteps = replace(expr, rules, {
      ...options,
      recursive: false,
      canonical: true,
    });

    if (newSteps.length === 0 || expr.isSame(newSteps.at(-1)!.value)) break;
    const alt = simplifyFunctionOperands(newSteps.at(-1)!.value, options);
    newSteps.at(-1)!.value = alt;

    if (isCheaper(expr, alt, options?.costFunction)) {
      expr = alt;
      steps.push(...newSteps);
    }
  } while (!steps.slice(0, -1).some((x) => x.value.isSame(expr)));

  return steps as RuleSteps;
}

function isCheaper(
  oldExpr: BoxedExpression,
  newExpr: BoxedExpression | null | undefined,
  costFunction?: (expr: BoxedExpression) => number
): boolean {
  if (newExpr === null || newExpr === undefined) return false;
  if (oldExpr === newExpr) return false;

  if (oldExpr.isSame(newExpr)) return false;

  const ce = oldExpr.engine;

  costFunction ??= (x) => ce.costFunction(x);

  if (costFunction(newExpr) <= 1.2 * costFunction(oldExpr)) {
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
  newExpr: BoxedExpression | null | undefined,
  costFunction?: (expr: BoxedExpression) => number
): BoxedExpression {
  return isCheaper(oldExpr, newExpr, costFunction) ? newExpr! : oldExpr;
}

function simplifyFunctionOperands(
  expr: BoxedExpression,
  options?: Partial<SimplifyOptions>
): BoxedExpression {
  if (!expr.ops) return expr;

  return expr.engine.function(
    expr.operator,
    holdMap(expr, (x) => x.simplify(options))
  );
}
