import type {
  BoxedExpression,
  BoxedRuleSet,
  RuleSteps,
  SimplifyOptions,
} from '../public';

import { factor } from './factor';
import { isRelationalOperator } from './utils';
import { replace } from './rules';
import { holdMap } from './hold';
import { permutations } from '../../common/utils';

type InternalSimplifyOptions = SimplifyOptions & {
  useVariations: boolean;
};

export function simplify(
  expr: BoxedExpression,
  options?: Partial<InternalSimplifyOptions>,
  steps?: RuleSteps
): RuleSteps {
  const hasSeen = (x: BoxedExpression) =>
    steps && steps.some((y) => y.value.isSame(x));

  // Check we are not recursing infinitely
  if (hasSeen(expr)) return steps!;

  if (!steps) steps = [{ value: expr, because: 'initial' }];

  //
  // 1/ Use the canonical form, if applicable
  //
  if (!expr.isValid) return steps;

  if (!(expr.isCanonical || expr.isStructural)) {
    const canonical = expr.canonical;
    if (!(canonical.isCanonical || canonical.isStructural)) return steps;
    return simplify(canonical, options, steps);
  }

  //
  // 2/ Is it a symbol?
  // Some symbols can get simplified by substitution, for example,
  // phi, the golden ratio, can be replaced by `(1 + sqrt(5)) / 2`
  //
  // We check for `!expr.isStructural` to avoid infinite recursion

  if (expr.symbol && !expr.isStructural)
    return [
      ...(steps ?? []),
      { value: expr.simplify(options), because: `value of ${expr.toString()}` },
    ];

  // If not a function, we're done
  if (expr.isNumberLiteral || expr.string || !expr.ops) return steps;

  //
  // 3/ Relational Operator or Equation?
  //
  const ce = expr.engine;

  if (isRelationalOperator(expr.operator) || expr.operator === 'Equal') {
    //
    // 3.1/ Simplify both sides of the relational operator
    //

    const op1 = simplify(expr.op1, options, steps).at(-1)?.value ?? expr.op1;
    const op2 = simplify(expr.op2, options, steps).at(-1)?.value ?? expr.op2;
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
    return [...steps, { value: expr, because: 'factor-relational-operator' }];
  }

  //
  // 4/ Apply rules, until no rules can be applied
  //

  const rules = options?.rules
    ? ce.rules(options.rules)
    : expr.engine.getRuleSet('standard-simplification')!;

  options = { ...options, rules };

  // Simplify the operands...
  expr = simplifyFunctionOperands(
    expr,
    [{ value: expr, because: 'initial' }],
    options
  );

  //
  // Loop until the expression has been previously seen,
  // or no rules can be applied
  //
  do {
    const newSteps = simplifyExpression(expr, rules, options, steps);

    if (newSteps.length <= steps.length) break;

    // Record the new expression as the current one
    expr = newSteps.at(-1)!.value;

    steps = newSteps;
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
  steps: RuleSteps,
  options?: Partial<SimplifyOptions>
): BoxedExpression {
  if (!expr.ops) return expr;

  return expr.engine.function(
    expr.operator,
    holdMap(
      expr,
      (x) => simplify(x, { ...options, useVariations: false }).at(-1)!?.value
    )
  );
}

function simplifyExpression(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  options: SimplifyOptions,
  steps: RuleSteps
): RuleSteps {
  //@fixme: move the check for symbols, etc... from xsimplify to here

  // If this is an associative function, we try to simplify it first
  let result = simplifyAssociativeFunction(expr, rules, options, steps);
  if (result.length > steps.length) return result;

  // Try to simplify the expression without considering associativity
  return simplifyNonAssociativeExpression(expr, rules, options, steps);
}

function simplifyNonAssociativeExpression(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  options: Partial<InternalSimplifyOptions>,
  steps: RuleSteps
): RuleSteps {
  const result = replace(expr, rules, {
    recursive: false,
    canonical: true,
    useVariations: options.useVariations ?? false,
  });

  if (result.length === 0) return steps;

  // Two rules could be conflicting, for example: `ln(xy) = ln(x) + ln(y)`
  // and `ln(x) + ln(y) = ln(xy)`, resulting in a loop. In this case,
  // we bail out.

  let last = result.at(-1)!.value;
  if (last.isSame(expr)) return steps;

  last = simplifyFunctionOperands(last, result);

  // If the simplified expression is not cheaper, we're done
  if (!isCheaper(expr, last, options?.costFunction)) [];

  result.at(-1)!.value = last;
  return [...steps, ...result];
}

function simplifyAssociativeFunction(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  options: SimplifyOptions,
  steps: RuleSteps
): RuleSteps {
  if (!(expr.functionDefinition?.associative === true)) return steps;

  //
  // 1/ First, try to simplify with all the operands
  //
  const newSteps = simplifyNonAssociativeExpression(
    expr,
    rules,
    options,
    steps
  );
  if (newSteps.length > steps.length) return newSteps;

  if (expr.nops! < 3) return steps;

  const operator = expr.operator;
  const ce = expr.engine;

  // If the function is commutative, we will try all permutations
  // of the arguments
  const ps =
    expr.functionDefinition?.commutative === true
      ? permutations(expr.ops!)
      : [expr.ops!];

  for (const p of ps) {
    // For a given permutation, try to simplify the first nth arguments
    for (let i = p.length - 1; i >= 2; i--) {
      const left = ce.function(operator, p.slice(0, i));
      const newSteps = simplifyExpression(left, rules, options, steps);
      if (newSteps.length > steps.length) {
        let last = newSteps.at(-1)!.value;
        const right = ce.function(operator, expr.ops!.slice(i));
        last = ce.function(operator, [last, right]);
        newSteps.at(-1)!.value = last;
        return newSteps;
      }
    }
  }
  return steps;
}
