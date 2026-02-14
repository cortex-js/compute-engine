import { replace } from './rules';
import { holdMap } from './hold';
import type {
  Expression,
  SimplifyOptions,
  BoxedRuleSet,
  RuleSteps,
} from '../global-types';
import { isNumber, isSymbol, isFunction, isString } from './type-guards';

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
function containsConstructibleTrig(expr: Expression): boolean {
  if (CONSTRUCTIBLE_TRIG.includes(expr.operator)) return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((op) => containsConstructibleTrig(op));
}

/**
 * Recursively evaluate purely numeric subexpressions without full simplification.
 * This handles cases like Power(x, Add(1,2)) where Add(1,2) should become 3.
 * Unlike full simplification, this won't expand polynomial factors.
 */
function evaluateNumericSubexpressions(expr: Expression): Expression {
  // Number literals are already simplified
  if (isNumber(expr)) return expr;

  // No ops means symbol or other atomic - return as is
  if (!isFunction(expr)) return expr;

  // Don't evaluate Power expressions that should stay symbolic:
  // - e^n (for potential combination with e^x)
  // - n^{p/q} where result is irrational (e.g., 2^{3/5})
  if (expr.operator === 'Power') {
    if (isSymbol(expr.op1) && expr.op1.symbol === 'ExponentialE') {
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
    if (isNumber(evaluated)) return evaluated;
  }

  // Otherwise, recursively process operands
  const newOps = expr.ops.map((op) => evaluateNumericSubexpressions(op));

  // Check if anything changed
  const changed = newOps.some((op, i) => op !== expr.ops[i]);
  if (!changed) return expr;

  // Reconstruct with _fn to avoid re-canonicalization
  return expr.engine._fn(expr.operator, newOps);
}

export function simplify(
  expr: Expression,
  options?: Partial<InternalSimplifyOptions>,
  steps?: RuleSteps
): RuleSteps {
  const hasSeen = (x: Expression) =>
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

    const costFn = (e: Expression) => ce.costFunction(e);

    // Approach 1: Fu first (for Morrie-like patterns)
    const fuFirst = ce._fuAlgorithm(expr);
    let result1 = fuFirst?.value ?? expr;
    if (fuFirst) {
      const postSimplified = result1.simplify();
      if (!postSimplified.isSame(result1)) {
        result1 = postSimplified;
      }
    }

    // Approach 2: Simplify first, then Fu (for period reduction patterns)
    const preSimplified = expr.simplify();
    const fuSecond = ce._fuAlgorithm(preSimplified);
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
  oldExpr: Expression,
  newExpr: Expression | null | undefined,
  costFunction?: (expr: Expression) => number
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

function simplifyOperands(
  expr: Expression,
  options?: Partial<SimplifyOptions>
): Expression {
  if (!isFunction(expr)) return expr;

  const def = expr.operatorDefinition;

  // For scoped functions (Sum, Product, D), use holdMap but simplify non-body operands
  if (def?.scoped === true) {
    const simplifiedOps = [...expr.ops].map((x, i) => {
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
      // Simplify Ln/Log operands within Add/Multiply to enable term cancellation
      // (e.g., ln(x^3) -> 3*ln(x) so that ln(x^3) - 3*ln(x) = 0)
      // Only simplify Ln (natural log), not Log (which may lose base info)
      if (x.operator === 'Ln') {
        return simplify(x, options).at(-1)!.value;
      }
      // Simplify Abs operands to enable cancellation
      // (e.g., |xy| -> |x||y| so that |xy| - |x||y| = 0)
      // Also handle Negate(Abs(...)) which appears in subtraction expressions
      if (x.operator === 'Abs') {
        return simplify(x, options).at(-1)!.value;
      }
      if (
        x.operator === 'Negate' &&
        isFunction(x) &&
        x.op1?.operator === 'Abs'
      ) {
        return simplify(x, options).at(-1)!.value;
      }
      // Power expressions with fractional exponents may need sign factoring
      // e.g., (-2x)^{3/5} should become -(2x)^{3/5} for correct real evaluation
      if (
        x.operator === 'Power' &&
        isFunction(x) &&
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
    if (!isNumber(x) && isFunction(x) && x.unknowns.length === 0) {
      if (BASIC_ARITHMETIC.includes(x.operator)) {
        // Don't evaluate Power expressions that produce irrational results
        if (x.operator === 'Power') {
          if (isSymbol(x.op1) && x.op1.symbol === 'ExponentialE') return x;
          if (x.op2?.isRational === true && x.op2?.isInteger === false)
            return x;
        }
        const evaluated = x.evaluate();
        if (isNumber(evaluated)) return evaluated;
      }
    }
    // For other expressions with ops (like Tan, Sqrt, etc.), recursively simplify
    if (isFunction(x)) {
      return simplify(x, options).at(-1)!.value;
    }
    return x;
  });
  // Use _fn() since operands are already canonical (simplified above)
  return expr.engine._fn(expr.operator, simplifiedOps);
}

function simplifyExpression(
  expr: Expression,
  rules: BoxedRuleSet,
  options: SimplifyOptions,
  steps: RuleSteps
): RuleSteps {
  //
  // 1/ If a number or a string, no simplification to do
  //
  if (isNumber(expr) || isString(expr)) return steps;

  //
  // 2/ Simplify a symbol
  //
  if (isSymbol(expr)) {
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

  // Try to simplify the function expression
  const result = simplifyNonCommutativeFunction(expr, rules, options, steps);
  if (result.length > steps.length) return result;

  // NOTE: Trying permutations of operands for commutative functions is
  // NOT needed:
  //
  // 1. Pattern-based rules already try permutations via `matchPermutations:
  //    true` (default) which permutes the *pattern* operands to find matches.
  //
  // 2. Most simplification rules (90%+) are functional, not pattern-based.
  //    Functional rules have direct access to operands and can check any
  //    ordering they need.
  //
  // 3. Canonicalization sorts commutative operators during boxing, providing
  //    consistent ordering that most rules rely on.
  //
  // 4. The performance cost would be factorial: 6× for 3 operands, 24× for
  //    4 operands, 720× for 6 operands - far exceeding any benefit.
  //
  // 5. Rules that truly need custom permutation logic
  //    (like factorPerfectSquare) implement it internally with controlled
  //    complexity.

  return steps;
}

function simplifyNonCommutativeFunction(
  expr: Expression,
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

  // If the simplified expression is not cheaper, we're done.
  // Exception: power combination results (e.g., -4·2^x → -2^(x+2)) may be
  // structurally more expensive but are mathematically preferred.
  const because = result.at(-1)!.because;
  const isPowerCombination =
    because === 'combined powers' ||
    because === 'combined powers with same base';
  // Log/ln rules from simplifyLog are always valid simplifications
  // even if structurally more expensive (e.g., ln(x^n) -> n*ln(x))
  const isLogRule =
    because === 'ln' ||
    because?.startsWith('ln(') ||
    because?.startsWith('log_');
  // Root sign extraction: root(-a, n) -> -root(a, n) for odd n
  const isRootSignRule = because?.startsWith('root(-');
  // Abs identity rules (|xy| -> |x||y|, |x/y| -> |x|/|y|) normalize structure
  const isAbsRule = because?.startsWith('|');
  // Quotient-power distribution: a/(b/c)^d -> a*(c/b)^d eliminates nested fractions
  const isQuotientPowerRule = because === 'a / (b/c)^d -> a * (c/b)^d';
  // Factorial factoring: n! - (n-1)! -> (n-1)! * (n-1) is structurally preferred
  const isFactorialFactoring = because === 'factor common factorial';
  // Double factorial identity: (2n)!! -> 2^n * n! converts to standard form
  const isDoubleFactorialIdentity = because === '(2n)!! -> 2^n * n!';
  // Gamma to factorial: Gamma(n+1) -> n! is always preferred
  const isGammaToFactorial =
    because === 'Gamma(n+1) -> n!' ||
    because === 'Gamma(n) -> (n-1)!' ||
    because === 'Gamma(1) -> 1' ||
    because === 'Gamma(n) -> (n-1)!';
  // Expand may produce more nodes but enables term cancellation
  // Accept when expansion reduces terms or eliminates Power-of-Add patterns
  const isExpandWithSimplification =
    because === 'expand' &&
    (() => {
      if (!isFunction(last) || !isFunction(expr)) return false;
      // Fewer terms means cancellation happened
      if (
        expr.operator === 'Add' &&
        last.operator === 'Add' &&
        last.nops < expr.nops
      )
        return true;
      // Expansion eliminated Power(Add(...), n) patterns — the result is flatter
      if (
        expr.operator === 'Add' &&
        last.operator === 'Add' &&
        last.nops <= expr.nops
      ) {
        // Check if original had Power-of-Add that was expanded away
        const hasPowerOfAdd = (e: Expression): boolean => {
          if (
            e.operator === 'Power' &&
            isFunction(e) &&
            e.op1?.operator === 'Add'
          )
            return true;
          if (isFunction(e)) return e.ops.some(hasPowerOfAdd);
          return false;
        };
        return hasPowerOfAdd(expr) && !hasPowerOfAdd(last);
      }
      return false;
    })();
  if (
    !isCheaper(expr, last, options?.costFunction) &&
    !isPowerCombination &&
    !isLogRule &&
    !isRootSignRule &&
    !isAbsRule &&
    !isQuotientPowerRule &&
    !isFactorialFactoring &&
    !isDoubleFactorialIdentity &&
    !isGammaToFactorial &&
    !isExpandWithSimplification
  )
    return steps;

  result.at(-1)!.value = last;
  return [...steps, ...result];
}
