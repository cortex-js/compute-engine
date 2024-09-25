import type {
  BoxedExpression,
  BoxedRuleSet,
  RuleSteps,
  SimplifyOptions,
} from '../public';

import { permutations } from '../../common/utils';

import { replace } from './rules';
import { holdMap } from './hold';

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

  const ce = expr.engine;
  const rules = options?.rules
    ? ce.rules(options.rules, { canonical: true })
    : ce.getRuleSet('standard-simplification')!;

  options = { ...options, rules };

  //
  // 2/ Loop until the expression has been previously seen,
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

function simplifyOperands(
  expr: BoxedExpression,
  options?: Partial<SimplifyOptions>
): BoxedExpression {
  if (!expr.ops) return expr;

  return expr.engine.function(
    expr.operator,
    holdMap(expr, (x) => simplify(x, options).at(-1)!.value)
  );
}

function simplifyExpression(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  options: SimplifyOptions,
  steps: RuleSteps
): RuleSteps {
  //
  // 1/ If a number or a string, no simplification to do
  //
  if (expr.isNumberLiteral || expr.string) return steps;

  //
  // 2/ Simplify a symbol
  //
  if (expr.symbol) {
    const result = replace(expr, rules, {
      recursive: false,
      canonical: true,
      useVariations: false,
    });
    if (result.length > 0) return [...steps, ...result];
    return steps;
  }

  //
  // 3/ Simplify a function expression
  //

  // Simplify the operands...
  const alt = simplifyOperands(expr, options);
  if (!alt.isSame(expr)) {
    steps = [...steps, { value: alt, because: 'simplified operands' }];
    expr = alt;
  }

  // Try to simplify, not considering associativity
  const result = simplifyNonCommutativeFunction(expr, rules, options, steps);
  if (result.length > steps.length) return result;

  // If this is a commutative function, try variations on the order of the operands
  // if (expr.functionDefinition?.commutative === true) {
  //   result = simplifyCommutativeFunction(expr, rules, options, steps);
  //   if (result.length > steps.length) return result;
  // }
  // @fixme: should try permutations on rules that are commutative

  return steps;
}

function simplifyNonCommutativeFunction(
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

  last = simplifyOperands(last);

  // If the simplified expression is not cheaper, we're done
  if (!isCheaper(expr, last, options?.costFunction)) return steps;

  result.at(-1)!.value = last;
  return [...steps, ...result];
}

function simplifyCommutativeFunction(
  expr: BoxedExpression,
  rules: BoxedRuleSet,
  options: SimplifyOptions,
  steps: RuleSteps,
  seen: BoxedExpression[] = []
): RuleSteps {
  if (expr.nops < 3)
    return simplifyNonCommutativeFunction(expr, rules, options, steps);

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

      if (seen.some((x) => x.isSame(left))) continue;

      seen.push(left);
      const newSteps = simplifyCommutativeFunction(
        left,
        rules,
        options,
        steps,
        seen
      );
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
