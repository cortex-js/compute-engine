import { permutations } from '../../common/utils';

import { replace } from './rules';
import { holdMap } from './hold';
import type {
  BoxedExpression,
  SimplifyOptions,
  BoxedRuleSet,
  RuleSteps,
} from '../global-types';

// eslint-disable-next-line import/no-restricted-paths
import { fu as fuAlgorithm } from '../symbolic/fu';

type InternalSimplifyOptions = SimplifyOptions & {
  useVariations: boolean;
};

const BASIC_ARITHMETIC = [
  'Add',
  'Subtract',
  'Multiply',
  'Divide',
  'Negate',
  'Power',
  'Rational',
];

// Trig functions with constructible special values
const CONSTRUCTIBLE_TRIG = ['Sin', 'Cos', 'Tan', 'Csc', 'Sec', 'Cot'];

/**
 * Check if an expression contains a constructible trig function somewhere
 * in its subexpressions. Used to determine if we need to recursively
 * simplify an operand to get constructible value simplification.
 */
function containsConstructibleTrig(expr: BoxedExpression): boolean {
  if (CONSTRUCTIBLE_TRIG.includes(expr.operator)) return true;
  if (!expr.ops) return false;
  return expr.ops.some((op) => containsConstructibleTrig(op));
}

/**
 * Recursively evaluate purely numeric subexpressions without full simplification.
 * This handles cases like Power(x, Add(1,2)) where Add(1,2) should become 3.
 * Unlike full simplification, this won't expand polynomial factors.
 */
function evaluateNumericSubexpressions(expr: BoxedExpression): BoxedExpression {
  // Number literals are already simplified
  if (expr.isNumberLiteral) return expr;

  // No ops means symbol or other atomic - return as is
  if (!expr.ops) return expr;

  // Don't evaluate Power expressions that should stay symbolic:
  // - e^n (for potential combination with e^x)
  // - n^{p/q} where result is irrational (e.g., 2^{3/5})
  if (expr.operator === 'Power') {
    if (expr.op1?.symbol === 'ExponentialE') {
      return expr;
    }
    // Skip n^{p/q} with non-integer exponent - these produce irrational results
    if (expr.op2?.isRational === true && expr.op2?.isInteger === false) {
      return expr;
    }
  }

  // If purely numeric (no unknowns), evaluate the whole expression
  if (expr.unknowns.length === 0 && BASIC_ARITHMETIC.includes(expr.operator)) {
    const evaluated = expr.evaluate();
    if (evaluated.isNumberLiteral) return evaluated;
  }

  // Otherwise, recursively process operands
  const newOps = expr.ops.map((op) => evaluateNumericSubexpressions(op));

  // Check if anything changed
  const changed = newOps.some((op, i) => op !== expr.ops![i]);
  if (!changed) return expr;

  // Reconstruct with _fn to avoid re-canonicalization
  return expr.engine._fn(expr.operator, newOps);
}

export function simplify(
  expr: BoxedExpression,
  options?: Partial<InternalSimplifyOptions>,
  steps?: RuleSteps
): RuleSteps {
  const hasSeen = (x: BoxedExpression) =>
    steps && steps.some((y) => y.value.isSame(x));

  // Check we are not recursing infinitely
  if (hasSeen(expr)) return steps!;

  // Additional safety: limit maximum simplification steps to prevent stack overflow
  // This catches cases where .simplify() is called recursively in new contexts
  const MAX_SIMPLIFY_STEPS = 1000;
  if (steps && steps.length >= MAX_SIMPLIFY_STEPS) {
    console.warn(
      `Simplification exceeded ${MAX_SIMPLIFY_STEPS} steps, stopping to prevent infinite recursion`
    );
    return steps;
  }

  if (!steps) steps = [{ value: expr, because: 'initial' }];

  //
  // 1/ Use the canonical form, if applicable
  //
  if (!expr.isValid) return steps;

  if (!(expr.isCanonical || expr.isStructural)) {
    const canonical = expr.canonical;
    if (!(canonical.isCanonical || canonical.isStructural)) return steps;
    // Don't pass steps when recursing for canonicalization.
    // The non-canonical form is structurally the same (isSame returns true),
    // so the hasSeen check would incorrectly trigger and skip simplification.
    return simplify(canonical, options);
  }

  const ce = expr.engine;

  //
  // 2/ If the 'fu' strategy is requested, apply the Fu algorithm
  //
  if (options?.strategy === 'fu') {
    // Strategy: Try both approaches and pick the best result
    // 1. Fu first (preserves symbolic patterns like Morrie's law)
    // 2. Simplify first, then Fu (handles period reduction for angle contraction)

    const costFn = (e: BoxedExpression) => ce.costFunction(e);

    // Approach 1: Fu first (for Morrie-like patterns)
    const fuFirst = fuAlgorithm(expr);
    let result1 = fuFirst?.value ?? expr;
    if (fuFirst) {
      const postSimplified = result1.simplify();
      if (!postSimplified.isSame(result1)) {
        result1 = postSimplified;
      }
    }

    // Approach 2: Simplify first, then Fu (for period reduction patterns)
    const preSimplified = expr.simplify();
    const fuSecond = fuAlgorithm(preSimplified);
    let result2 = fuSecond?.value ?? preSimplified;
    if (fuSecond) {
      const postSimplified = result2.simplify();
      if (!postSimplified.isSame(result2)) {
        result2 = postSimplified;
      }
    }

    // Pick the best result (lower cost wins)
    const cost1 = costFn(result1);
    const cost2 = costFn(result2);
    const bestResult = cost1 <= cost2 ? result1 : result2;

    if (!bestResult.isSame(expr)) {
      steps.push({ value: bestResult, because: 'fu' });
    }

    return steps as RuleSteps;
  }

  const rules = options?.rules
    ? ce.rules(options.rules, { canonical: true })
    : ce.getRuleSet('standard-simplification')!;

  options = { ...options, rules };

  //
  // 3/ Loop until the expression has been previously seen,
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

  const oldCost = costFunction(oldExpr);
  const newCost = costFunction(newExpr);

  // Use a threshold of 1.3 (30% more expensive) to allow mathematically valid
  // simplifications like combining powers (2 * 2^x -> 2^(x+1))
  if (newCost <= 1.3 * oldCost) return true;

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

  const def = expr.operatorDefinition;

  // For scoped functions (Sum, Product, D), use holdMap but simplify non-body operands
  if (def?.scoped === true) {
    const simplifiedOps = expr.ops.map((x, i) => {
      // Don't simplify the body (first operand) to allow pattern-matching rules to work
      if (i === 0) return x;
      // Simplify other operands (like Limits)
      return simplify(x, options).at(-1)!.value;
    });
    // Use _fn() to bypass canonicalization - operands are already canonical.
    // This avoids triggering handlers like D's canonicalFunctionLiteralArguments
    // which would add extra Function wrappers.
    return expr.engine._fn(expr.operator, simplifiedOps);
  }

  // For non-scoped functions, we need to balance simplification with holdMap semantics

  // First get the operands through holdMap
  const ops = holdMap(expr, (x) => x);

  // For lazy functions (Multiply, Add), only simplify Sum/Product operands
  // and expressions containing constructible trig functions
  // to avoid interfering with their special handling in simplify-rules.
  // However, always evaluate purely numeric subexpressions (like 2*3 in exponents)
  // so that (x^3)^2 * (y^2)^2 becomes x^6 * y^4.
  // Also simplify Power expressions with negative bases and fractional exponents
  // to ensure proper sign factoring (e.g., (-2x)^{3/5} -> -(2x)^{3/5}).
  if (def?.lazy) {
    const simplifiedOps = ops.map((x) => {
      if (
        x.operator === 'Sum' ||
        x.operator === 'Product' ||
        containsConstructibleTrig(x)
      ) {
        return simplify(x, options).at(-1)!.value;
      }
      // Power expressions with fractional exponents may need sign factoring
      // e.g., (-2x)^{3/5} should become -(2x)^{3/5} for correct real evaluation
      if (
        x.operator === 'Power' &&
        x.op2?.isRational === true &&
        !x.op2.isInteger
      ) {
        return simplify(x, options).at(-1)!.value;
      }
      // Evaluate purely numeric subexpressions in all operands
      return evaluateNumericSubexpressions(x);
    });
    return expr.engine.function(expr.operator, simplifiedOps);
  }

  // For non-lazy, non-scoped functions (e.g., Factorial2, Sqrt, Degrees),
  // recursively simplify operands. This ensures expressions like Factorial2(-1 + 2*3)
  // become Factorial2(5) and Degrees(tan(90-0.000001)) becomes Degrees(tan(89.999999)).
  //
  // EXCEPTION: For Divide expressions, only evaluate purely numeric subexpressions
  // but don't do full recursive simplification. This preserves factored polynomial
  // structure for the cancelCommonFactors rule.
  // e.g., (x-1)(x+2)/((x-1)(x+3)) should cancel to (x+2)/(x+3), not expand first.
  // But x^(1+2)/(1+2) should still simplify to x^3/3.
  if (expr.operator === 'Divide') {
    const simplifiedOps = ops.map((x) => evaluateNumericSubexpressions(x));
    const changed = simplifiedOps.some((op, i) => op !== ops[i]);
    if (!changed) return expr;
    return expr.engine._fn(expr.operator, simplifiedOps);
  }

  const simplifiedOps = ops.map((x) => {
    // For purely numeric basic arithmetic expressions, evaluate directly
    // to get simpler results like √(1+2) → √3
    // BUT skip Power expressions that should stay symbolic:
    // - e^n and n^{p/q} with non-integer exponent
    if (!x.isNumberLiteral && x.ops && x.unknowns.length === 0) {
      if (BASIC_ARITHMETIC.includes(x.operator)) {
        // Don't evaluate Power expressions that produce irrational results
        if (x.operator === 'Power') {
          if (x.op1?.symbol === 'ExponentialE') return x;
          if (x.op2?.isRational === true && x.op2?.isInteger === false)
            return x;
        }
        const evaluated = x.evaluate();
        if (evaluated.isNumberLiteral) return evaluated;
      }
    }
    // For other expressions with ops (like Tan, Sqrt, etc.), recursively simplify
    if (x.ops) {
      return simplify(x, options).at(-1)!.value;
    }
    return x;
  });
  // Use _fn() since operands are already canonical (simplified above)
  return expr.engine._fn(expr.operator, simplifiedOps);
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

  // Try to simplify, not considering commutativity
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
    expr.operatorDefinition?.commutative === true
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
