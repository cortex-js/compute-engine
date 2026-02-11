/**
 * Fu Algorithm Transformation Rules
 *
 * Programmatic implementations of TR1-TR22 from the Fu trigonometric
 * simplification algorithm.
 *
 * Reference: Fu, Hongguang, Xiuqin Zhong, and Zhenbing Zeng.
 * "Automated and readable simplification of trigonometric expressions."
 * Mathematical and Computer Modelling 44.11 (2006): 1169-1177.
 *
 * Each TR function applies a specific transformation to an expression.
 * Returns the transformed expression, or undefined if the rule doesn't apply.
 *
 * IMPORTANT: These functions should NOT call .simplify() on their results
 * to avoid infinite recursion when called from the simplification pipeline.
 */

import type { Expression } from '../global-types';
import {
  isFunction,
  isNumber,
  isSymbol,
} from '../boxed-expression/type-guards';

// ============================================================================
// Helper Functions
// ============================================================================

const TRIG_FUNC_REGEX = /^(Sin|Cos|Tan|Cot|Sec|Csc)$/;

/**
 * Check if an expression contains any trigonometric functions
 */
export function hasTrigFunction(expr: Expression): boolean {
  if (TRIG_FUNC_REGEX.test(expr.operator)) return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some(hasTrigFunction);
}

/**
 * Check if expression contains specific operators anywhere in the tree
 */
export function hasOperator(expr: Expression, ...ops: string[]): boolean {
  if (ops.includes(expr.operator)) return true;
  if (!isFunction(expr)) return false;
  return expr.ops.some((x) => hasOperator(x, ...ops));
}

/**
 * Apply a transformation function to all subexpressions (bottom-up)
 */
function mapSubexpressions(
  expr: Expression,
  fn: (e: Expression) => Expression | undefined
): Expression {
  const ce = expr.engine;

  // First, recursively process operands
  if (isFunction(expr) && expr.ops.length > 0) {
    const fnExpr = expr;
    const newOps = fnExpr.ops.map((op) => mapSubexpressions(op, fn));
    const changed = newOps.some((op, i) => op !== fnExpr.ops[i]);
    if (changed) {
      expr = ce._fn(fnExpr.operator, newOps);
    }
  }

  // Then apply the function to this expression
  return fn(expr) ?? expr;
}

/**
 * Check if two expressions have the same argument (for trig functions)
 */
function sameArg(a: Expression, b: Expression): boolean {
  if (!isFunction(a) || !isFunction(b)) return false;
  const argA = a.op1;
  const argB = b.op1;
  return argA !== undefined && argB !== undefined && argA.isSame(argB);
}

// ============================================================================
// TR1: sec(x) -> 1/cos(x), csc(x) -> 1/sin(x)
// Convert secant and cosecant to reciprocal forms
// ============================================================================

export function TR1(expr: Expression): Expression | undefined {
  const ce = expr.engine;
  const op = expr.operator;
  if (!isFunction(expr)) return undefined;
  const arg = expr.op1;

  if (!arg) return undefined;

  if (op === 'Sec') {
    // sec(x) -> 1/cos(x)
    return ce.One.div(ce._fn('Cos', [arg]));
  }

  if (op === 'Csc') {
    // csc(x) -> 1/sin(x)
    return ce.One.div(ce._fn('Sin', [arg]));
  }

  return undefined;
}

/**
 * Apply TR1 to all subexpressions
 */
export function applyTR1(expr: Expression): Expression {
  return mapSubexpressions(expr, TR1);
}

// ============================================================================
// TR2: tan(x) -> sin(x)/cos(x), cot(x) -> cos(x)/sin(x)
// Convert tangent and cotangent to ratio forms
// ============================================================================

export function TR2(expr: Expression): Expression | undefined {
  const ce = expr.engine;
  const op = expr.operator;
  if (!isFunction(expr)) return undefined;
  const arg = expr.op1;

  if (!arg) return undefined;

  if (op === 'Tan') {
    // tan(x) -> sin(x)/cos(x)
    return ce._fn('Sin', [arg]).div(ce._fn('Cos', [arg]));
  }

  if (op === 'Cot') {
    // cot(x) -> cos(x)/sin(x)
    return ce._fn('Cos', [arg]).div(ce._fn('Sin', [arg]));
  }

  return undefined;
}

/**
 * Apply TR2 to all subexpressions
 */
export function applyTR2(expr: Expression): Expression {
  return mapSubexpressions(expr, TR2);
}

// ============================================================================
// TR2i: sin(x)/cos(x) -> tan(x), cos(x)/sin(x) -> cot(x)
// Inverse of TR2 - convert ratios back to tan/cot
// ============================================================================

export function TR2i(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Divide') return undefined;
  if (!isFunction(expr)) return undefined;

  const num = expr.op1;
  const den = expr.op2;

  if (!num || !den) return undefined;

  // sin(x)/cos(x) -> tan(x)
  if (num.operator === 'Sin' && den.operator === 'Cos' && sameArg(num, den)) {
    if (!isFunction(num)) return undefined;
    return ce._fn('Tan', [num.op1]);
  }

  // cos(x)/sin(x) -> cot(x)
  if (num.operator === 'Cos' && den.operator === 'Sin' && sameArg(num, den)) {
    if (!isFunction(num)) return undefined;
    return ce._fn('Cot', [num.op1]);
  }

  return undefined;
}

/**
 * Apply TR2i to all subexpressions
 */
export function applyTR2i(expr: Expression): Expression {
  return mapSubexpressions(expr, TR2i);
}

// ============================================================================
// TR3: Angle canonicalization
// Normalize negative angles using even/odd function properties:
// - cos(-x) -> cos(x) (cosine is even)
// - sin(-x) -> -sin(x) (sine is odd)
// - tan(-x) -> -tan(x) (tangent is odd)
// - sec(-x) -> sec(x) (secant is even)
// - csc(-x) -> -csc(x) (cosecant is odd)
// - cot(-x) -> -cot(x) (cotangent is odd)
// ============================================================================

/**
 * Check if an expression is a negation (either Negate or multiply by -1)
 * Returns the inner expression if it's a negation, undefined otherwise
 */
function getNegatedArg(expr: Expression): Expression | undefined {
  // Check for Negate(x)
  if (expr.operator === 'Negate' && isFunction(expr)) {
    return expr.op1;
  }

  // Check for Multiply with -1 factor
  if (expr.operator === 'Multiply' && isFunction(expr)) {
    const negOneIndex = expr.ops.findIndex((f) => f.is(-1));
    if (negOneIndex >= 0) {
      const remaining = expr.ops.filter((_, i) => i !== negOneIndex);
      if (remaining.length === 1) return remaining[0];
      return expr.engine._fn('Multiply', remaining);
    }
  }

  return undefined;
}

export function TR3(expr: Expression): Expression | undefined {
  const ce = expr.engine;
  const op = expr.operator;
  if (!isFunction(expr)) return undefined;
  const arg = expr.op1;

  if (!arg) return undefined;

  // Check if the argument is negated
  const innerArg = getNegatedArg(arg);
  if (!innerArg) return undefined;

  // Even functions: cos(-x) = cos(x), sec(-x) = sec(x)
  if (op === 'Cos') {
    return ce._fn('Cos', [innerArg]);
  }

  if (op === 'Sec') {
    return ce._fn('Sec', [innerArg]);
  }

  // Odd functions: sin(-x) = -sin(x), tan(-x) = -tan(x), etc.
  if (op === 'Sin') {
    return ce._fn('Sin', [innerArg]).neg();
  }

  if (op === 'Tan') {
    return ce._fn('Tan', [innerArg]).neg();
  }

  if (op === 'Csc') {
    return ce._fn('Csc', [innerArg]).neg();
  }

  if (op === 'Cot') {
    return ce._fn('Cot', [innerArg]).neg();
  }

  return undefined;
}

/**
 * Apply TR3 to all subexpressions
 */
export function applyTR3(expr: Expression): Expression {
  return mapSubexpressions(expr, TR3);
}

// ============================================================================
// TR5: sin^2(x) -> 1 - cos^2(x)
// Pythagorean substitution for sin^2
// ============================================================================

export function TR5(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  // Check for Power(Sin(x), 2)
  if (expr.operator !== 'Power') return undefined;
  if (!isFunction(expr)) return undefined;

  const base = expr.op1;
  const exp = expr.op2;

  if (!base || !exp) return undefined;
  if (base.operator !== 'Sin') return undefined;
  if (!exp.is(2)) return undefined;

  if (!isFunction(base)) return undefined;
  const arg = base.op1;
  if (!arg) return undefined;

  // sin^2(x) -> 1 - cos^2(x)
  return ce.One.sub(ce._fn('Cos', [arg]).pow(2));
}

/**
 * Apply TR5 to all subexpressions
 */
export function applyTR5(expr: Expression): Expression {
  return mapSubexpressions(expr, TR5);
}

// ============================================================================
// TR6: cos^2(x) -> 1 - sin^2(x)
// Pythagorean substitution for cos^2
// ============================================================================

export function TR6(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  // Check for Power(Cos(x), 2)
  if (expr.operator !== 'Power') return undefined;
  if (!isFunction(expr)) return undefined;

  const base = expr.op1;
  const exp = expr.op2;

  if (!base || !exp) return undefined;
  if (base.operator !== 'Cos') return undefined;
  if (!exp.is(2)) return undefined;

  if (!isFunction(base)) return undefined;
  const arg = base.op1;
  if (!arg) return undefined;

  // cos^2(x) -> 1 - sin^2(x)
  return ce.One.sub(ce._fn('Sin', [arg]).pow(2));
}

/**
 * Apply TR6 to all subexpressions
 */
export function applyTR6(expr: Expression): Expression {
  return mapSubexpressions(expr, TR6);
}

// ============================================================================
// TR7: cos^2(x) -> (1 + cos(2x))/2
// Power reduction using double angle
// ============================================================================

export function TR7(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  // Check for Power(Cos(x), 2)
  if (expr.operator !== 'Power') return undefined;
  if (!isFunction(expr)) return undefined;

  const base = expr.op1;
  const exp = expr.op2;

  if (!base || !exp) return undefined;
  if (base.operator !== 'Cos') return undefined;
  if (!exp.is(2)) return undefined;

  if (!isFunction(base)) return undefined;
  const arg = base.op1;
  if (!arg) return undefined;

  // cos^2(x) -> (1 + cos(2x))/2
  return ce.One.add(ce._fn('Cos', [arg.mul(2)])).div(2);
}

/**
 * Apply TR7 to all subexpressions
 */
export function applyTR7(expr: Expression): Expression {
  return mapSubexpressions(expr, TR7);
}

// ============================================================================
// TR7i: Inverse power reduction (inverse of TR7)
// (1 - cos(2x))/2 -> sin^2(x)
// (1 + cos(2x))/2 -> cos^2(x)
// ============================================================================

export function TR7i(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  // Looking for pattern: (1 +/- cos(2x))/2
  // This can appear as:
  // - Multiply(1/2, Add(1, +/-Cos(2x)))
  // - Divide(Add(...), 2)
  // - Add(1/2, +/-cos(2x)/2) - expanded form

  // Check for Divide by 2
  if (expr.operator === 'Divide' && isFunction(expr)) {
    const num = expr.op1;
    const den = expr.op2;

    if (!num || !den || !den.is(2)) return undefined;

    // Check numerator is Add(1, +/-cos(2x))
    if (num.operator === 'Add' && isFunction(num) && num.ops.length === 2) {
      return checkHalfAnglePattern(ce, num.ops);
    }
  }

  const isHalf = (f: Expression): boolean => {
    // Check .re property for numeric 0.5
    if (f.re === 0.5 && f.im === 0) return true;
    // Also check isSame with ce.Half
    if (f.isSame(ce.Half)) return true;
    return false;
  };

  // Check for Multiply by 1/2 (can be 0.5, 1/2 as Divide, or Rational(1,2))
  if (expr.operator === 'Multiply' && isFunction(expr)) {
    const halfIndex = expr.ops.findIndex((f) => isHalf(f));

    if (halfIndex >= 0) {
      const remaining = expr.ops.filter((_, i) => i !== halfIndex);
      if (remaining.length === 1 && remaining[0].operator === 'Add') {
        const addExpr = remaining[0];
        if (isFunction(addExpr) && addExpr.ops.length === 2) {
          return checkHalfAnglePattern(ce, addExpr.ops);
        }
      }
    }
  }

  // Check for expanded form: 1/2 +/- cos(2x)/2
  // This appears as Add(1/2, +/-Multiply(1/2, Cos(2x))) or Add(1/2, +/-Divide(Cos(2x), 2))
  // Also handles: Add(Multiply(-1/2, Cos(2x)), 1/2) where -1/2 is Rational(-1, 2)
  if (expr.operator === 'Add' && isFunction(expr) && expr.ops.length === 2) {
    let halfTerm: Expression | undefined;
    let cosTerm: Expression | undefined;
    let isNegCos = false;

    const isNegHalf = (f: Expression): boolean => {
      if (f.re === -0.5 && f.im === 0) return true;
      return false;
    };

    for (const op of expr.ops) {
      // Check for 1/2
      if (isHalf(op)) {
        halfTerm = op;
        continue;
      }

      // Check for +/-cos(2x)/2 or +/-(1/2)*cos(2x) or (-1/2)*cos(2x)
      let checkOp = op;
      let neg = false;

      if (op.operator === 'Negate' && isFunction(op)) {
        neg = true;
        checkOp = op.op1;
      }

      // cos(2x)/2
      if (
        checkOp.operator === 'Divide' &&
        isFunction(checkOp) &&
        checkOp.op2?.is(2)
      ) {
        const num = checkOp.op1;
        if (num?.operator === 'Cos') {
          cosTerm = num;
          isNegCos = neg;
          continue;
        }
      }

      // (1/2)*cos(2x) or (-1/2)*cos(2x)
      if (checkOp.operator === 'Multiply' && isFunction(checkOp)) {
        // Check for positive 1/2
        const halfIdx = checkOp.ops.findIndex((f) => isHalf(f));
        if (halfIdx >= 0) {
          const rest = checkOp.ops.filter((_, i) => i !== halfIdx);
          if (rest.length === 1 && rest[0].operator === 'Cos') {
            cosTerm = rest[0];
            isNegCos = neg;
            continue;
          }
        }

        // Check for negative -1/2
        const negHalfIdx = checkOp.ops.findIndex((f) => isNegHalf(f));
        if (negHalfIdx >= 0) {
          const rest = checkOp.ops.filter((_, i) => i !== negHalfIdx);
          if (rest.length === 1 && rest[0].operator === 'Cos') {
            cosTerm = rest[0];
            isNegCos = !neg; // Flip the sign because coefficient is already negative
            continue;
          }
        }
      }
    }

    if (halfTerm && cosTerm) {
      if (!isFunction(cosTerm)) return undefined;
      const cosArg = cosTerm.op1;
      if (!cosArg) return undefined;

      // Check if cos argument is 2*x
      let x: Expression | undefined;

      if (cosArg.operator === 'Multiply' && isFunction(cosArg)) {
        const twoIndex = cosArg.ops.findIndex((f) => f.is(2));
        if (twoIndex >= 0) {
          const remaining = cosArg.ops.filter((_, i) => i !== twoIndex);
          x =
            remaining.length === 1
              ? remaining[0]
              : ce._fn('Multiply', remaining);
        }
      }

      if (!x) return undefined;

      // 1/2 - cos(2x)/2 -> sin^2(x)
      // 1/2 + cos(2x)/2 -> cos^2(x)
      if (isNegCos) {
        return ce._fn('Sin', [x]).pow(2);
      } else {
        return ce._fn('Cos', [x]).pow(2);
      }
    }
  }

  return undefined;
}

/**
 * Helper for TR7i: Check if ops form pattern [1, +/-cos(2x)] or [+/-cos(2x), 1]
 */
function checkHalfAnglePattern(
  ce: Expression['engine'],
  ops: readonly Expression[]
): Expression | undefined {
  let oneIndex = -1;
  let cosIndex = -1;
  let isNegCos = false;

  for (let i = 0; i < ops.length; i++) {
    if (ops[i].is(1)) {
      oneIndex = i;
    } else if (ops[i].operator === 'Cos') {
      cosIndex = i;
      isNegCos = false;
    } else if (ops[i].operator === 'Negate') {
      const negExpr = ops[i];
      if (isFunction(negExpr) && negExpr.op1?.operator === 'Cos') {
        cosIndex = i;
        isNegCos = true;
      }
    }
  }

  if (oneIndex < 0 || cosIndex < 0) return undefined;

  // Get the cos expression
  let cosExpr: Expression;
  if (isNegCos) {
    const negExpr = ops[cosIndex];
    if (!isFunction(negExpr)) return undefined;
    cosExpr = negExpr.op1!;
  } else {
    cosExpr = ops[cosIndex];
  }

  if (!isFunction(cosExpr)) return undefined;
  const cosArg = cosExpr.op1;

  if (!cosArg) return undefined;

  // Check if cos argument is 2*x
  let x: Expression | undefined;

  if (cosArg.operator === 'Multiply' && isFunction(cosArg)) {
    const twoIndex = cosArg.ops.findIndex((f) => f.is(2));
    if (twoIndex >= 0) {
      const remaining = cosArg.ops.filter((_, i) => i !== twoIndex);
      x = remaining.length === 1 ? remaining[0] : ce._fn('Multiply', remaining);
    }
  }

  if (!x) return undefined;

  // (1 - cos(2x))/2 -> sin^2(x)
  // (1 + cos(2x))/2 -> cos^2(x)
  if (isNegCos) {
    // 1 - cos(2x) pattern -> sin^2(x)
    return ce._fn('Sin', [x]).pow(2);
  } else {
    // 1 + cos(2x) pattern -> cos^2(x)
    return ce._fn('Cos', [x]).pow(2);
  }
}

/**
 * Apply TR7i to all subexpressions
 */
export function applyTR7i(expr: Expression): Expression {
  return mapSubexpressions(expr, TR7i);
}

// ============================================================================
// TR8: Product-to-sum identities
// sin(x)cos(y) -> (sin(x+y) + sin(x-y))/2
// cos(x)cos(y) -> (cos(x+y) + cos(x-y))/2
// sin(x)sin(y) -> (cos(x-y) - cos(x+y))/2
// ============================================================================

export function TR8(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Multiply') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length < 2) return undefined;

  // Find pairs of sin/cos
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i];
      const b = ops[j];

      if (!isFunction(a) || !isFunction(b)) continue;
      const argA = a.op1;
      const argB = b.op1;

      if (!argA || !argB) continue;

      let result: Expression | undefined;

      // sin(x)cos(y) -> (sin(x+y) + sin(x-y))/2
      if (a.operator === 'Sin' && b.operator === 'Cos') {
        result = ce
          ._fn('Sin', [argA.add(argB)])
          .add(ce._fn('Sin', [argA.sub(argB)]))
          .div(2);
      }
      // cos(x)sin(y) -> (sin(x+y) - sin(x-y))/2
      else if (a.operator === 'Cos' && b.operator === 'Sin') {
        result = ce
          ._fn('Sin', [argA.add(argB)])
          .sub(ce._fn('Sin', [argA.sub(argB)]))
          .div(2);
      }
      // cos(x)cos(y) -> (cos(x+y) + cos(x-y))/2
      else if (a.operator === 'Cos' && b.operator === 'Cos') {
        result = ce
          ._fn('Cos', [argA.add(argB)])
          .add(ce._fn('Cos', [argA.sub(argB)]))
          .div(2);
      }
      // sin(x)sin(y) -> (cos(x-y) - cos(x+y))/2
      else if (a.operator === 'Sin' && b.operator === 'Sin') {
        result = ce
          ._fn('Cos', [argA.sub(argB)])
          .sub(ce._fn('Cos', [argA.add(argB)]))
          .div(2);
      }

      if (result) {
        // Multiply by remaining factors
        const remaining = ops.filter((_, k) => k !== i && k !== j);
        if (remaining.length === 0) return result;
        return result.mul(
          remaining.length === 1 ? remaining[0] : ce._fn('Multiply', remaining)
        );
      }
    }
  }

  return undefined;
}

/**
 * Apply TR8 to all subexpressions
 */
export function applyTR8(expr: Expression): Expression {
  return mapSubexpressions(expr, TR8);
}

// ============================================================================
// TR9: Sum-to-product identities
// sin(x) + sin(y) -> 2sin((x+y)/2)cos((x-y)/2)
// sin(x) - sin(y) -> 2cos((x+y)/2)sin((x-y)/2)
// cos(x) + cos(y) -> 2cos((x+y)/2)cos((x-y)/2)
// cos(x) - cos(y) -> -2sin((x+y)/2)sin((x-y)/2)
// ============================================================================

export function TR9(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Add') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length < 2) return undefined;

  // Find pairs of sin+sin, cos+cos, or sin-sin patterns
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i];
      const b = ops[j];

      let result: Expression | undefined;

      // sin(x) + sin(y)
      if (a.operator === 'Sin' && b.operator === 'Sin') {
        if (!isFunction(a) || !isFunction(b)) continue;
        const argA = a.op1;
        const argB = b.op1;
        if (argA && argB) {
          const sum = argA.add(argB).div(2);
          const diff = argA.sub(argB).div(2);
          result = ce
            ._fn('Sin', [sum])
            .mul(ce._fn('Cos', [diff]))
            .mul(2);
        }
      }
      // cos(x) + cos(y)
      else if (a.operator === 'Cos' && b.operator === 'Cos') {
        if (!isFunction(a) || !isFunction(b)) continue;
        const argA = a.op1;
        const argB = b.op1;
        if (argA && argB) {
          const sum = argA.add(argB).div(2);
          const diff = argA.sub(argB).div(2);
          result = ce
            ._fn('Cos', [sum])
            .mul(ce._fn('Cos', [diff]))
            .mul(2);
        }
      }
      // sin(x) + Negate(sin(y)) = sin(x) - sin(y)
      else if (a.operator === 'Sin' && b.operator === 'Negate') {
        if (!isFunction(a) || !isFunction(b)) continue;
        if (b.op1?.operator !== 'Sin') continue;
        const bInner = b.op1;
        if (!isFunction(bInner)) continue;
        const argA = a.op1;
        const argB = bInner.op1;
        if (argA && argB) {
          const sum = argA.add(argB).div(2);
          const diff = argA.sub(argB).div(2);
          result = ce
            ._fn('Cos', [sum])
            .mul(ce._fn('Sin', [diff]))
            .mul(2);
        }
      }
      // cos(x) + Negate(cos(y)) = cos(x) - cos(y)
      else if (a.operator === 'Cos' && b.operator === 'Negate') {
        if (!isFunction(a) || !isFunction(b)) continue;
        if (b.op1?.operator !== 'Cos') continue;
        const bInner = b.op1;
        if (!isFunction(bInner)) continue;
        const argA = a.op1;
        const argB = bInner.op1;
        if (argA && argB) {
          const sum = argA.add(argB).div(2);
          const diff = argA.sub(argB).div(2);
          result = ce
            ._fn('Sin', [sum])
            .mul(ce._fn('Sin', [diff]))
            .mul(-2);
        }
      }

      if (result) {
        // Add remaining terms
        const remaining = ops.filter((_, k) => k !== i && k !== j);
        if (remaining.length === 0) return result;
        return result.add(
          remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
        );
      }
    }
  }

  return undefined;
}

/**
 * Apply TR9 to all subexpressions
 */
export function applyTR9(expr: Expression): Expression {
  return mapSubexpressions(expr, TR9);
}

// ============================================================================
// TR10: Angle expansion (addition formulas)
// sin(x+y) -> sin(x)cos(y) + cos(x)sin(y)
// sin(x-y) -> sin(x)cos(y) - cos(x)sin(y)
// cos(x+y) -> cos(x)cos(y) - sin(x)sin(y)
// cos(x-y) -> cos(x)cos(y) + sin(x)sin(y)
// ============================================================================

export function TR10(expr: Expression): Expression | undefined {
  const ce = expr.engine;
  const op = expr.operator;

  if (op !== 'Sin' && op !== 'Cos') return undefined;
  if (!isFunction(expr)) return undefined;

  const arg = expr.op1;
  if (!arg) return undefined;

  // Check for Add or Subtract in argument
  if (arg.operator === 'Add' && isFunction(arg) && arg.ops.length === 2) {
    const [x, y] = arg.ops;

    if (op === 'Sin') {
      // sin(x+y) -> sin(x)cos(y) + cos(x)sin(y)
      return ce
        ._fn('Sin', [x])
        .mul(ce._fn('Cos', [y]))
        .add(ce._fn('Cos', [x]).mul(ce._fn('Sin', [y])));
    } else {
      // cos(x+y) -> cos(x)cos(y) - sin(x)sin(y)
      return ce
        ._fn('Cos', [x])
        .mul(ce._fn('Cos', [y]))
        .sub(ce._fn('Sin', [x]).mul(ce._fn('Sin', [y])));
    }
  }

  if (arg.operator === 'Subtract' && isFunction(arg)) {
    const x = arg.op1;
    const y = arg.op2;

    if (!x || !y) return undefined;

    if (op === 'Sin') {
      // sin(x-y) -> sin(x)cos(y) - cos(x)sin(y)
      return ce
        ._fn('Sin', [x])
        .mul(ce._fn('Cos', [y]))
        .sub(ce._fn('Cos', [x]).mul(ce._fn('Sin', [y])));
    } else {
      // cos(x-y) -> cos(x)cos(y) + sin(x)sin(y)
      return ce
        ._fn('Cos', [x])
        .mul(ce._fn('Cos', [y]))
        .add(ce._fn('Sin', [x]).mul(ce._fn('Sin', [y])));
    }
  }

  return undefined;
}

/**
 * Apply TR10 to all subexpressions
 */
export function applyTR10(expr: Expression): Expression {
  return mapSubexpressions(expr, TR10);
}

// ============================================================================
// TR10i: Angle contraction (inverse of TR10)
// sin(x)cos(y) + cos(x)sin(y) -> sin(x+y)
// sin(x)cos(y) - cos(x)sin(y) -> sin(x-y)
// cos(x)cos(y) - sin(x)sin(y) -> cos(x+y)
// cos(x)cos(y) + sin(x)sin(y) -> cos(x-y)
// ============================================================================

export function TR10i(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Add') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length < 2) return undefined;

  // Look for patterns like sin(x)cos(y) + cos(x)sin(y)
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i];
      const b = ops[j];

      // Extract products: looking for sin(x)cos(y) type patterns
      const extractSinCos = (
        term: Expression
      ): { sin: Expression; cos: Expression } | null => {
        if (term.operator !== 'Multiply') return null;
        if (!isFunction(term)) return null;
        const factors = term.ops;
        if (factors.length !== 2) return null;

        const [f1, f2] = factors;
        if (f1.operator === 'Sin' && f2.operator === 'Cos') {
          return { sin: f1, cos: f2 };
        }
        if (f1.operator === 'Cos' && f2.operator === 'Sin') {
          return { sin: f2, cos: f1 };
        }
        return null;
      };

      const extractCosCos = (
        term: Expression
      ): { cos1: Expression; cos2: Expression } | null => {
        if (term.operator !== 'Multiply') return null;
        if (!isFunction(term)) return null;
        const factors = term.ops;
        if (factors.length !== 2) return null;

        const [f1, f2] = factors;
        if (f1.operator === 'Cos' && f2.operator === 'Cos') {
          return { cos1: f1, cos2: f2 };
        }
        return null;
      };

      const extractSinSin = (
        term: Expression
      ): { sin1: Expression; sin2: Expression } | null => {
        if (term.operator !== 'Multiply') return null;
        if (!isFunction(term)) return null;
        const factors = term.ops;
        if (factors.length !== 2) return null;

        const [f1, f2] = factors;
        if (f1.operator === 'Sin' && f2.operator === 'Sin') {
          return { sin1: f1, sin2: f2 };
        }
        return null;
      };

      /** Helper to get .op1 from an expression known to be a function */
      const getOp1 = (e: Expression): Expression | undefined =>
        isFunction(e) ? e.op1 : undefined;

      // Check for sin(x)cos(y) + cos(x)sin(y) -> sin(x+y)
      // and sin(x)cos(y) - cos(x)sin(y) -> sin(x-y)
      const scA = extractSinCos(a);
      const scB = extractSinCos(b);
      // Also check for negated terms (either position due to canonicalization)
      const negScA =
        a.operator === 'Negate' && isFunction(a) && a.op1
          ? extractSinCos(a.op1)
          : null;
      const negScB =
        b.operator === 'Negate' && isFunction(b) && b.op1
          ? extractSinCos(b.op1)
          : null;

      if (scA && scB) {
        const xA = getOp1(scA.sin);
        const yA = getOp1(scA.cos);
        const xB = getOp1(scB.sin);
        const yB = getOp1(scB.cos);

        if (xA && yA && xB && yB) {
          // sin(x)cos(y) + cos(x)sin(y) pattern -> sin(x+y)
          if (xA.isSame(yB) && yA.isSame(xB)) {
            const remaining = ops.filter((_, k) => k !== i && k !== j);
            const result = ce._fn('Sin', [xA.add(yA)]);
            if (remaining.length === 0) return result;
            return result.add(
              remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
            );
          }
        }
      }

      // sin(x)cos(y) - cos(x)sin(y) -> sin(x-y)
      // Pattern 1: scA + negScB (positive term first)
      if (scA && negScB) {
        const xA = getOp1(scA.sin);
        const yA = getOp1(scA.cos);
        const xB = getOp1(negScB.sin);
        const yB = getOp1(negScB.cos);

        if (xA && yA && xB && yB) {
          // sin(x)cos(y) - cos(x)sin(y) pattern -> sin(x-y)
          if (xA.isSame(yB) && yA.isSame(xB)) {
            const remaining = ops.filter((_, k) => k !== i && k !== j);
            const result = ce._fn('Sin', [xA.sub(yA)]);
            if (remaining.length === 0) return result;
            return result.add(
              remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
            );
          }
        }
      }

      // Pattern 2: negScA + scB (negated term first due to canonicalization)
      // -cos(x)sin(y) + sin(x)cos(y) -> sin(x-y)
      if (negScA && scB) {
        const xA = getOp1(negScA.sin);
        const yA = getOp1(negScA.cos);
        const xB = getOp1(scB.sin);
        const yB = getOp1(scB.cos);

        if (xA && yA && xB && yB) {
          // -cos(x)sin(y) + sin(x)cos(y) -> sin(x-y)
          // Here the negated term has sin(y)cos(x), positive has sin(x)cos(y)
          // So we want sin(xB - yB) where xB matches yA and yB matches xA
          if (xB.isSame(yA) && yB.isSame(xA)) {
            const remaining = ops.filter((_, k) => k !== i && k !== j);
            const result = ce._fn('Sin', [xB.sub(yB)]);
            if (remaining.length === 0) return result;
            return result.add(
              remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
            );
          }
        }
      }

      // Check for cos(x)cos(y) - sin(x)sin(y) -> cos(x+y)
      // and cos(x)cos(y) + sin(x)sin(y) -> cos(x-y)
      // Check both orders (a,b) and (b,a) for these patterns
      const ccA = extractCosCos(a);
      const ccB = extractCosCos(b);
      const ssA = extractSinSin(a);
      const ssB = extractSinSin(b);
      const negSsA =
        a.operator === 'Negate' && isFunction(a) && a.op1
          ? extractSinSin(a.op1)
          : null;
      const negSsB =
        b.operator === 'Negate' && isFunction(b) && b.op1
          ? extractSinSin(b.op1)
          : null;

      // cos(x)cos(y) - sin(x)sin(y) -> cos(x+y)
      // Pattern 1: ccA + negSsB
      if (ccA && negSsB) {
        const x = getOp1(ccA.cos1);
        const y = getOp1(ccA.cos2);
        const x2 = getOp1(negSsB.sin1);
        const y2 = getOp1(negSsB.sin2);

        if (
          x &&
          y &&
          x2 &&
          y2 &&
          ((x.isSame(x2) && y.isSame(y2)) || (x.isSame(y2) && y.isSame(x2)))
        ) {
          const remaining = ops.filter((_, k) => k !== i && k !== j);
          const result = ce._fn('Cos', [x.add(y)]);
          if (remaining.length === 0) return result;
          return result.add(
            remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
          );
        }
      }

      // Pattern 2: negSsA + ccB (reversed order)
      if (negSsA && ccB) {
        const x = getOp1(ccB.cos1);
        const y = getOp1(ccB.cos2);
        const x2 = getOp1(negSsA.sin1);
        const y2 = getOp1(negSsA.sin2);

        if (
          x &&
          y &&
          x2 &&
          y2 &&
          ((x.isSame(x2) && y.isSame(y2)) || (x.isSame(y2) && y.isSame(x2)))
        ) {
          const remaining = ops.filter((_, k) => k !== i && k !== j);
          const result = ce._fn('Cos', [x.add(y)]);
          if (remaining.length === 0) return result;
          return result.add(
            remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
          );
        }
      }

      // cos(x)cos(y) + sin(x)sin(y) -> cos(x-y)
      // Pattern 1: ccA + ssB
      if (ccA && ssB) {
        const x = getOp1(ccA.cos1);
        const y = getOp1(ccA.cos2);
        const x2 = getOp1(ssB.sin1);
        const y2 = getOp1(ssB.sin2);

        if (
          x &&
          y &&
          x2 &&
          y2 &&
          ((x.isSame(x2) && y.isSame(y2)) || (x.isSame(y2) && y.isSame(x2)))
        ) {
          const remaining = ops.filter((_, k) => k !== i && k !== j);
          const result = ce._fn('Cos', [x.sub(y)]);
          if (remaining.length === 0) return result;
          return result.add(
            remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
          );
        }
      }

      // Pattern 2: ssA + ccB (reversed order)
      if (ssA && ccB) {
        const x = getOp1(ccB.cos1);
        const y = getOp1(ccB.cos2);
        const x2 = getOp1(ssA.sin1);
        const y2 = getOp1(ssA.sin2);

        if (
          x &&
          y &&
          x2 &&
          y2 &&
          ((x.isSame(x2) && y.isSame(y2)) || (x.isSame(y2) && y.isSame(x2)))
        ) {
          const remaining = ops.filter((_, k) => k !== i && k !== j);
          const result = ce._fn('Cos', [x.sub(y)]);
          if (remaining.length === 0) return result;
          return result.add(
            remaining.length === 1 ? remaining[0] : ce._fn('Add', remaining)
          );
        }
      }
    }
  }

  return undefined;
}

/**
 * Apply TR10i to all subexpressions
 */
export function applyTR10i(expr: Expression): Expression {
  return mapSubexpressions(expr, TR10i);
}

// ============================================================================
// TR11: Double angle expansion
// sin(2x) -> 2sin(x)cos(x)
// cos(2x) -> 2cos^2(x) - 1  (or cos^2(x) - sin^2(x) or 1 - 2sin^2(x))
// ============================================================================

export function TR11(expr: Expression): Expression | undefined {
  const ce = expr.engine;
  const op = expr.operator;

  if (op !== 'Sin' && op !== 'Cos') return undefined;
  if (!isFunction(expr)) return undefined;

  const arg = expr.op1;
  if (!arg) return undefined;

  // Check if argument is 2*x (Multiply with factor 2)
  if (arg.operator === 'Multiply' && isFunction(arg)) {
    const factors = arg.ops;
    const twoIndex = factors.findIndex((f) => f.is(2));

    if (twoIndex >= 0) {
      const otherFactors = factors.filter((_, i) => i !== twoIndex);
      const x =
        otherFactors.length === 1
          ? otherFactors[0]
          : ce._fn('Multiply', otherFactors);

      if (op === 'Sin') {
        // sin(2x) -> 2sin(x)cos(x)
        return ce
          ._fn('Sin', [x])
          .mul(ce._fn('Cos', [x]))
          .mul(2);
      } else {
        // cos(2x) -> 2cos^2(x) - 1
        return ce._fn('Cos', [x]).pow(2).mul(2).sub(ce.One);
      }
    }
  }

  return undefined;
}

/**
 * Apply TR11 to all subexpressions
 */
export function applyTR11(expr: Expression): Expression {
  return mapSubexpressions(expr, TR11);
}

// ============================================================================
// TR11i: Double angle contraction (inverse of TR11)
// 2sin(x)cos(x) -> sin(2x)
// cos^2(x) - sin^2(x) -> cos(2x)
// 2cos^2(x) - 1 -> cos(2x)
// 1 - 2sin^2(x) -> cos(2x)
// ============================================================================

export function TR11i(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  // 2sin(x)cos(x) -> sin(2x)
  if (expr.operator === 'Multiply' && isFunction(expr)) {
    const ops = expr.ops;

    // Look for 2, sin(x), cos(x) factors
    const twoIndex = ops.findIndex((f) => f.is(2));
    if (twoIndex >= 0) {
      const remaining = ops.filter((_, i) => i !== twoIndex);

      let sinTerm: Expression | undefined;
      let cosTerm: Expression | undefined;

      for (const f of remaining) {
        if (f.operator === 'Sin' && !sinTerm) sinTerm = f;
        else if (f.operator === 'Cos' && !cosTerm) cosTerm = f;
      }

      if (sinTerm && cosTerm && sameArg(sinTerm, cosTerm)) {
        if (!isFunction(sinTerm)) return undefined;
        const otherFactors = remaining.filter(
          (f) => f !== sinTerm && f !== cosTerm
        );
        const result = ce._fn('Sin', [sinTerm.op1.mul(2)]);
        if (otherFactors.length === 0) return result;
        return result.mul(
          otherFactors.length === 1
            ? otherFactors[0]
            : ce._fn('Multiply', otherFactors)
        );
      }
    }
  }

  // cos^2(x) - sin^2(x) -> cos(2x)
  // This appears as Add(Power(Cos(x), 2), Negate(Power(Sin(x), 2)))
  if (expr.operator === 'Add' && isFunction(expr) && expr.ops.length === 2) {
    const [a, b] = expr.ops;

    // Check for cos^2(x) + (-sin^2(x))
    if (
      a.operator === 'Power' &&
      isFunction(a) &&
      a.op1?.operator === 'Cos' &&
      a.op2?.is(2) &&
      b.operator === 'Negate' &&
      isFunction(b) &&
      b.op1?.operator === 'Power' &&
      isFunction(b.op1) &&
      b.op1.op1?.operator === 'Sin' &&
      b.op1.op2?.is(2)
    ) {
      const cosBase = a.op1;
      const sinPower = b.op1;
      if (isFunction(cosBase) && isFunction(sinPower)) {
        const sinBase = sinPower.op1;
        if (isFunction(sinBase)) {
          const cosArg = cosBase.op1;
          const sinArg = sinBase.op1;
          if (cosArg && sinArg && cosArg.isSame(sinArg)) {
            return ce._fn('Cos', [cosArg.mul(2)]);
          }
        }
      }
    }

    // 2cos^2(x) - 1 -> cos(2x)
    // Pattern: Add(Multiply(2, Power(Cos(x), 2)), -1) or Add(-1, Multiply(2, Power(Cos(x), 2)))
    const extractTwoCosSq = (term: Expression): Expression | undefined => {
      if (term.operator !== 'Multiply' || !isFunction(term)) return undefined;
      const twoIdx = term.ops.findIndex((f) => f.is(2));
      if (twoIdx < 0) return undefined;
      const rest = term.ops.filter((_, i) => i !== twoIdx);
      if (rest.length !== 1) return undefined;
      const powerTerm = rest[0];
      if (
        powerTerm.operator === 'Power' &&
        isFunction(powerTerm) &&
        powerTerm.op1?.operator === 'Cos' &&
        powerTerm.op2?.is(2)
      ) {
        const cosBase = powerTerm.op1;
        if (isFunction(cosBase)) return cosBase.op1;
      }
      return undefined;
    };

    // Check: 2cos^2(x) + (-1) or (-1) + 2cos^2(x)
    let cosArg = extractTwoCosSq(a);
    if (
      cosArg &&
      (b.is(-1) || (b.operator === 'Negate' && isFunction(b) && b.op1?.is(1)))
    ) {
      return ce._fn('Cos', [cosArg.mul(2)]);
    }
    cosArg = extractTwoCosSq(b);
    if (
      cosArg &&
      (a.is(-1) || (a.operator === 'Negate' && isFunction(a) && a.op1?.is(1)))
    ) {
      return ce._fn('Cos', [cosArg.mul(2)]);
    }

    // 1 - 2sin^2(x) -> cos(2x)
    // Pattern: Add(1, Negate(Multiply(2, Power(Sin(x), 2)))) or similar
    const extractTwoSinSq = (term: Expression): Expression | undefined => {
      if (term.operator !== 'Multiply' || !isFunction(term)) return undefined;
      const twoIdx = term.ops.findIndex((f) => f.is(2));
      if (twoIdx < 0) return undefined;
      const rest = term.ops.filter((_, i) => i !== twoIdx);
      if (rest.length !== 1) return undefined;
      const powerTerm = rest[0];
      if (
        powerTerm.operator === 'Power' &&
        isFunction(powerTerm) &&
        powerTerm.op1?.operator === 'Sin' &&
        powerTerm.op2?.is(2)
      ) {
        const sinBase = powerTerm.op1;
        if (isFunction(sinBase)) return sinBase.op1;
      }
      return undefined;
    };

    // Check: 1 + Negate(2sin^2(x))
    if (a.is(1) && b.operator === 'Negate' && isFunction(b) && b.op1) {
      const sinArg = extractTwoSinSq(b.op1);
      if (sinArg) {
        return ce._fn('Cos', [sinArg.mul(2)]);
      }
    }
    if (b.is(1) && a.operator === 'Negate' && isFunction(a) && a.op1) {
      const sinArg = extractTwoSinSq(a.op1);
      if (sinArg) {
        return ce._fn('Cos', [sinArg.mul(2)]);
      }
    }

    // Also handle: 1 + (-2)sin^2(x) where -2 is a single number
    const extractNegTwoSinSq = (term: Expression): Expression | undefined => {
      if (term.operator !== 'Multiply' || !isFunction(term)) return undefined;
      const negTwoIdx = term.ops.findIndex((f) => f.is(-2));
      if (negTwoIdx < 0) return undefined;
      const rest = term.ops.filter((_, i) => i !== negTwoIdx);
      if (rest.length !== 1) return undefined;
      const powerTerm = rest[0];
      if (
        powerTerm.operator === 'Power' &&
        isFunction(powerTerm) &&
        powerTerm.op1?.operator === 'Sin' &&
        powerTerm.op2?.is(2)
      ) {
        const sinBase = powerTerm.op1;
        if (isFunction(sinBase)) return sinBase.op1;
      }
      return undefined;
    };

    // Check: 1 + (-2)sin^2(x)
    if (a.is(1)) {
      const sinArg = extractNegTwoSinSq(b);
      if (sinArg) {
        return ce._fn('Cos', [sinArg.mul(2)]);
      }
    }
    if (b.is(1)) {
      const sinArg = extractNegTwoSinSq(a);
      if (sinArg) {
        return ce._fn('Cos', [sinArg.mul(2)]);
      }
    }
  }

  return undefined;
}

/**
 * Apply TR11i to all subexpressions
 */
export function applyTR11i(expr: Expression): Expression {
  return mapSubexpressions(expr, TR11i);
}

// ============================================================================
// TR12: Tangent addition formula
// tan(x+y) -> (tan(x) + tan(y))/(1 - tan(x)tan(y))
// tan(x-y) -> (tan(x) - tan(y))/(1 + tan(x)tan(y))
// ============================================================================

export function TR12(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Tan') return undefined;
  if (!isFunction(expr)) return undefined;

  const arg = expr.op1;
  if (!arg) return undefined;

  // Check for Add
  if (arg.operator === 'Add' && isFunction(arg) && arg.ops.length === 2) {
    const [x, y] = arg.ops;
    const tanX = ce._fn('Tan', [x]);
    const tanY = ce._fn('Tan', [y]);

    // tan(x+y) -> (tan(x) + tan(y))/(1 - tan(x)tan(y))
    return tanX.add(tanY).div(ce.One.sub(tanX.mul(tanY)));
  }

  // Check for Subtract
  if (arg.operator === 'Subtract' && isFunction(arg)) {
    const x = arg.op1;
    const y = arg.op2;

    if (!x || !y) return undefined;

    const tanX = ce._fn('Tan', [x]);
    const tanY = ce._fn('Tan', [y]);

    // tan(x-y) -> (tan(x) - tan(y))/(1 + tan(x)tan(y))
    return tanX.sub(tanY).div(ce.One.add(tanX.mul(tanY)));
  }

  return undefined;
}

/**
 * Apply TR12 to all subexpressions
 */
export function applyTR12(expr: Expression): Expression {
  return mapSubexpressions(expr, TR12);
}

// ============================================================================
// TR12i: Tangent sum identity (inverse of tan addition)
// When A + B + C = pi: tan(A) + tan(B) - tan(C)*tan(A)*tan(B) = -tan(C)
// This recognizes patterns like tan(a) + tan(b) - k*tan(a)*tan(b)
// where k = tan(c) and a + b + c = pi
// ============================================================================

/**
 * Known tangent values for special angles (as fractions of pi)
 */
const KNOWN_TAN_VALUES: { value: number; angle: [number, number] }[] = [
  { value: 0, angle: [0, 1] }, // tan(0)
  { value: 1 / Math.sqrt(3), angle: [1, 6] }, // tan(pi/6) = 1/sqrt(3)
  { value: 1, angle: [1, 4] }, // tan(pi/4) = 1
  { value: Math.sqrt(3), angle: [1, 3] }, // tan(pi/3) = sqrt(3)
  { value: 2 - Math.sqrt(3), angle: [1, 12] }, // tan(pi/12) = 2-sqrt(3)
  { value: 2 + Math.sqrt(3), angle: [5, 12] }, // tan(5pi/12) = 2+sqrt(3)
];

/**
 * Try to find angle C (as fraction of pi) such that tan(C) ~ k
 */
function findTanAngle(
  k: number,
  tolerance: number = 1e-10
): [number, number] | undefined {
  for (const entry of KNOWN_TAN_VALUES) {
    if (Math.abs(entry.value - k) < tolerance) {
      return entry.angle;
    }
  }
  return undefined;
}

/**
 * Extract the coefficient and tangent arguments from a product term.
 * Returns [coef, tanArg1, tanArg2] if the term is coef*tan(a)*tan(b)
 */
function extractTanProduct(
  expr: Expression
): [number, Expression, Expression] | undefined {
  if (expr.operator !== 'Multiply') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length < 2) return undefined;

  // Find tan factors and numeric coefficient
  const tanFactors: Expression[] = [];
  let coef = 1;

  for (const op of ops) {
    if (op.operator === 'Tan' && isFunction(op) && op.op1) {
      tanFactors.push(op.op1);
    } else if (
      op.operator === 'Negate' &&
      isFunction(op) &&
      op.op1?.operator === 'Sqrt'
    ) {
      const sqrtExpr = op.op1;
      if (isFunction(sqrtExpr)) {
        const sqrtArg = sqrtExpr.op1;
        if (sqrtArg && isNumber(sqrtArg) && typeof sqrtArg.re === 'number') {
          coef *= -Math.sqrt(sqrtArg.re);
        } else {
          return undefined;
        }
      } else {
        return undefined;
      }
    } else if (op.operator === 'Sqrt' && isFunction(op)) {
      const sqrtArg = op.op1;
      if (sqrtArg && isNumber(sqrtArg) && typeof sqrtArg.re === 'number') {
        coef *= Math.sqrt(sqrtArg.re);
      } else {
        return undefined;
      }
    } else if (isNumber(op) && typeof op.re === 'number') {
      coef *= op.re;
    } else {
      return undefined; // Unknown factor
    }
  }

  if (tanFactors.length !== 2) return undefined;

  return [coef, tanFactors[0], tanFactors[1]];
}

/**
 * Extract the angle from a tan argument, returning [numerator, denominator]
 * representing the fraction of pi.
 */
function extractPiFraction(arg: Expression): [number, number] | undefined {
  // Check for k*pi pattern where k is a Rational
  if (arg.operator === 'Multiply' && isFunction(arg)) {
    let piFound = false;
    let fraction: [number, number] | undefined;

    for (const op of arg.ops) {
      if (isSymbol(op) && op.symbol === 'Pi') {
        piFound = true;
      } else if (isNumber(op) && typeof op.re === 'number') {
        // Could be a simple number or a rational
        const val = op.re;
        // Try to express as a fraction
        for (let d = 1; d <= 36; d++) {
          const n = Math.round(val * d);
          if (Math.abs(n / d - val) < 1e-10) {
            fraction = [n, d];
            break;
          }
        }
      }
    }

    if (piFound && fraction) return fraction;
  }

  // Check for just pi
  if (isSymbol(arg) && arg.symbol === 'Pi') return [1, 1];

  return undefined;
}

export function TR12i(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Add') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length !== 3) return undefined;

  // Find the pattern: tan(A) + tan(B) + product_term
  // where product_term = -k*tan(A)*tan(B) for some k
  const tanTerms: { arg: Expression; index: number }[] = [];
  let productTerm:
    | {
        coef: number;
        arg1: Expression;
        arg2: Expression;
        index: number;
      }
    | undefined;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];

    if (op.operator === 'Tan' && isFunction(op) && op.op1) {
      tanTerms.push({ arg: op.op1, index: i });
    } else {
      const extracted = extractTanProduct(op);
      if (extracted) {
        productTerm = {
          coef: extracted[0],
          arg1: extracted[1],
          arg2: extracted[2],
          index: i,
        };
      }
    }
  }

  // Need exactly 2 tan terms and 1 product term
  if (tanTerms.length !== 2 || !productTerm) return undefined;

  const [tanA, tanB] = tanTerms;

  // Check if the product term contains the same tan arguments
  const arg1MatchesA =
    tanA.arg.isSame(productTerm.arg1) || tanA.arg.isSame(productTerm.arg2);
  const arg1MatchesB =
    tanB.arg.isSame(productTerm.arg1) || tanB.arg.isSame(productTerm.arg2);
  const arg2MatchesA =
    tanA.arg.isSame(productTerm.arg2) || tanA.arg.isSame(productTerm.arg1);
  const arg2MatchesB =
    tanB.arg.isSame(productTerm.arg2) || tanB.arg.isSame(productTerm.arg1);

  if (!((arg1MatchesA && arg2MatchesB) || (arg1MatchesB && arg2MatchesA))) {
    return undefined;
  }

  // The pattern is: tan(A) + tan(B) - k*tan(A)*tan(B)
  // For this to equal -tan(C), we need k = tan(C) and A + B + C = pi
  const k = -productTerm.coef; // Negate because pattern has -k

  if (k <= 0) return undefined; // tan(C) must be positive for C in (0, pi/2)

  // Try to find angle C such that tan(C) = k
  const angleC = findTanAngle(k);
  if (!angleC) return undefined;

  // Extract angles A and B as fractions of pi
  const fracA = extractPiFraction(tanA.arg);
  const fracB = extractPiFraction(tanB.arg);

  if (!fracA || !fracB) return undefined;

  // Check if A + B + C = pi (i.e., fracA + fracB + angleC = 1)
  // Using common denominator
  const lcd = lcm(lcm(fracA[1], fracB[1]), angleC[1]);
  const sumNumerator =
    fracA[0] * (lcd / fracA[1]) +
    fracB[0] * (lcd / fracB[1]) +
    angleC[0] * (lcd / angleC[1]);

  // Sum should equal lcd (representing 1 = pi/pi)
  if (sumNumerator !== lcd) return undefined;

  // Return -tan(C) in symbolic form
  const tanCArg = ce._fn('Multiply', [
    ce.number([angleC[0], angleC[1]]),
    ce.symbol('Pi'),
  ]);
  return ce._fn('Tan', [tanCArg]).neg();
}

/**
 * Least common multiple
 */
function lcm(a: number, b: number): number {
  return Math.abs(a * b) / gcd(a, b);
}

/**
 * Greatest common divisor
 */
function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) {
    const t = b;
    b = a % b;
    a = t;
  }
  return a;
}

/**
 * Apply TR12i to all subexpressions
 */
export function applyTR12i(expr: Expression): Expression {
  return mapSubexpressions(expr, TR12i);
}

// ============================================================================
// TR13: Tangent/cotangent product identities
// tan(x)tan(y) -> 1 - (tan(x) + tan(y))cot(x+y)
// cot(x)cot(y) -> 1 + (cot(x) + cot(y))cot(x+y)
// ============================================================================

export function TR13(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Multiply') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length < 2) return undefined;

  // Find tan*tan or cot*cot pairs
  for (let i = 0; i < ops.length; i++) {
    for (let j = i + 1; j < ops.length; j++) {
      const a = ops[i];
      const b = ops[j];

      if (!isFunction(a) || !isFunction(b)) continue;
      const argA = a.op1;
      const argB = b.op1;

      if (!argA || !argB) continue;

      // tan(x)tan(y) -> 1 - (tan(x) + tan(y))cot(x+y)
      if (a.operator === 'Tan' && b.operator === 'Tan') {
        const tanX = a;
        const tanY = b;
        const cotSum = ce._fn('Cot', [argA.add(argB)]);
        const result = ce.One.sub(tanX.add(tanY).mul(cotSum));

        const remaining = ops.filter((_, k) => k !== i && k !== j);
        if (remaining.length === 0) return result;
        return result.mul(
          remaining.length === 1 ? remaining[0] : ce._fn('Multiply', remaining)
        );
      }

      // cot(x)cot(y) -> 1 + (cot(x) + cot(y))cot(x+y)
      if (a.operator === 'Cot' && b.operator === 'Cot') {
        const cotX = a;
        const cotY = b;
        const cotSum = ce._fn('Cot', [argA.add(argB)]);
        const result = ce.One.add(cotX.add(cotY).mul(cotSum));

        const remaining = ops.filter((_, k) => k !== i && k !== j);
        if (remaining.length === 0) return result;
        return result.mul(
          remaining.length === 1 ? remaining[0] : ce._fn('Multiply', remaining)
        );
      }
    }
  }

  return undefined;
}

/**
 * Apply TR13 to all subexpressions
 */
export function applyTR13(expr: Expression): Expression {
  return mapSubexpressions(expr, TR13);
}

// ============================================================================
// TR22: Pythagorean identities for tan/sec, cot/csc
// tan^2(x) -> sec^2(x) - 1
// cot^2(x) -> csc^2(x) - 1
// sec^2(x) -> 1 + tan^2(x)
// csc^2(x) -> 1 + cot^2(x)
// ============================================================================

export function TR22(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Power') return undefined;
  if (!isFunction(expr)) return undefined;

  const base = expr.op1;
  const exp = expr.op2;

  if (!base || !exp) return undefined;
  if (!exp.is(2)) return undefined;

  if (!isFunction(base)) return undefined;
  const arg = base.op1;
  if (!arg) return undefined;

  // tan^2(x) -> sec^2(x) - 1
  if (base.operator === 'Tan') {
    return ce._fn('Sec', [arg]).pow(2).sub(ce.One);
  }

  // cot^2(x) -> csc^2(x) - 1
  if (base.operator === 'Cot') {
    return ce._fn('Csc', [arg]).pow(2).sub(ce.One);
  }

  // sec^2(x) -> 1 + tan^2(x)
  if (base.operator === 'Sec') {
    return ce.One.add(ce._fn('Tan', [arg]).pow(2));
  }

  // csc^2(x) -> 1 + cot^2(x)
  if (base.operator === 'Csc') {
    return ce.One.add(ce._fn('Cot', [arg]).pow(2));
  }

  return undefined;
}

/**
 * Apply TR22 to all subexpressions
 */
export function applyTR22(expr: Expression): Expression {
  return mapSubexpressions(expr, TR22);
}

// ============================================================================
// TR22i: Inverse Pythagorean identities for tan/sec, cot/csc
// sec^2(x) - 1 -> tan^2(x)
// csc^2(x) - 1 -> cot^2(x)
// 1 + tan^2(x) -> sec^2(x)
// 1 + cot^2(x) -> csc^2(x)
// ============================================================================

export function TR22i(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Add') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length !== 2) return undefined;

  // First, check for special patterns that simplify to constants:
  // cot^2(x) - csc^2(x) = -1 (since csc^2 = 1 + cot^2)
  // tan^2(x) - sec^2(x) = -1 (since sec^2 = 1 + tan^2)
  // csc^2(x) - cot^2(x) = 1
  // sec^2(x) - tan^2(x) = 1

  const extractPower2 = (
    op: Expression
  ): { func: string; arg: Expression; neg: boolean } | null => {
    let neg = false;
    let powerOp = op;

    if (op.operator === 'Negate' && isFunction(op)) {
      neg = true;
      powerOp = op.op1;
    }

    if (!isFunction(powerOp)) return null;
    if (powerOp.operator !== 'Power' || !powerOp.op2?.is(2)) return null;

    const base = powerOp.op1;
    if (!base || !isFunction(base) || !base.op1) return null;

    const func = base.operator;
    if (!['Tan', 'Cot', 'Sec', 'Csc'].includes(func)) return null;

    return { func, arg: base.op1, neg };
  };

  const p0 = extractPower2(ops[0]);
  const p1 = extractPower2(ops[1]);

  if (p0 && p1 && p0.arg.isSame(p1.arg)) {
    // cot^2(x) - csc^2(x) = -1
    if (
      (p0.func === 'Cot' && !p0.neg && p1.func === 'Csc' && p1.neg) ||
      (p0.func === 'Csc' && p0.neg && p1.func === 'Cot' && !p1.neg)
    ) {
      return ce.number(-1);
    }

    // csc^2(x) - cot^2(x) = 1
    if (
      (p0.func === 'Csc' && !p0.neg && p1.func === 'Cot' && p1.neg) ||
      (p0.func === 'Cot' && p0.neg && p1.func === 'Csc' && !p1.neg)
    ) {
      return ce.One;
    }

    // tan^2(x) - sec^2(x) = -1
    if (
      (p0.func === 'Tan' && !p0.neg && p1.func === 'Sec' && p1.neg) ||
      (p0.func === 'Sec' && p0.neg && p1.func === 'Tan' && !p1.neg)
    ) {
      return ce.number(-1);
    }

    // sec^2(x) - tan^2(x) = 1
    if (
      (p0.func === 'Sec' && !p0.neg && p1.func === 'Tan' && p1.neg) ||
      (p0.func === 'Tan' && p0.neg && p1.func === 'Sec' && !p1.neg)
    ) {
      return ce.One;
    }
  }

  // Look for patterns: sec^2(x) - 1, csc^2(x) - 1, 1 + tan^2(x), 1 + cot^2(x)
  // Also handle: -1 + sec^2(x), tan^2(x) + 1, etc.

  let oneIndex = -1;
  let powerIndex = -1;
  let isNegOne = false;

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op.is(1)) {
      oneIndex = i;
      isNegOne = false;
    } else if (op.is(-1)) {
      oneIndex = i;
      isNegOne = true;
    } else if (op.operator === 'Negate' && isFunction(op) && op.op1?.is(1)) {
      oneIndex = i;
      isNegOne = true;
    } else if (op.operator === 'Power' && isFunction(op) && op.op2?.is(2)) {
      powerIndex = i;
    }
  }

  if (oneIndex < 0 || powerIndex < 0) return undefined;

  const powerExpr = ops[powerIndex];
  if (!isFunction(powerExpr)) return undefined;
  const base = powerExpr.op1;
  if (!base) return undefined;

  if (!isFunction(base)) return undefined;
  const arg = base.op1;
  if (!arg) return undefined;

  // sec^2(x) - 1 -> tan^2(x)
  if (base.operator === 'Sec' && isNegOne) {
    return ce._fn('Tan', [arg]).pow(2);
  }

  // csc^2(x) - 1 -> cot^2(x)
  if (base.operator === 'Csc' && isNegOne) {
    return ce._fn('Cot', [arg]).pow(2);
  }

  // 1 + tan^2(x) -> sec^2(x)
  if (base.operator === 'Tan' && !isNegOne) {
    return ce._fn('Sec', [arg]).pow(2);
  }

  // 1 + cot^2(x) -> csc^2(x)
  if (base.operator === 'Cot' && !isNegOne) {
    return ce._fn('Csc', [arg]).pow(2);
  }

  return undefined;
}

/**
 * Apply TR22i to all subexpressions
 */
export function applyTR22i(expr: Expression): Expression {
  return mapSubexpressions(expr, TR22i);
}

// ============================================================================
// TRmorrie: Morrie's law
// cos(x)cos(2x)cos(4x)...cos(2^(n-1)x) -> sin(2^n x)/(2^n sin(x))
// ============================================================================

/**
 * Helper to extract a numeric multiplier from an expression.
 * Returns [numericValue, coeffExpr, baseArg] where:
 * - numericValue: the numeric value of the coefficient (for ratio checking)
 * - coeffExpr: the original symbolic coefficient expression
 * - baseArg: the remaining expression after removing the coefficient
 * Handles both plain numbers and Rationals.
 */
function extractMultiplier(
  expr: Expression
): [number, Expression, Expression] | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Multiply' || !isFunction(expr)) {
    return [1, ce.One, expr];
  }

  // Look for a numeric coefficient (number or Rational)
  for (let i = 0; i < expr.ops.length; i++) {
    const op = expr.ops[i];
    let numValue: number | undefined;

    if (isNumber(op)) {
      // Get numeric value for ratio checking
      if (typeof op.re === 'number' && op.im === 0) {
        numValue = op.re;
      }
    }

    if (numValue !== undefined) {
      const rest = expr.ops.filter((_, j) => j !== i);
      const baseArg = rest.length === 1 ? rest[0] : ce._fn('Multiply', rest);
      return [numValue, op, baseArg];
    }
  }

  return [1, ce.One, expr];
}

export function TRmorrie(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Multiply') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length < 2) return undefined;

  // Find all cos factors, preserving symbolic coefficients
  const cosFactors: {
    arg: Expression;
    numericMult: number;
    symbolicCoeff: Expression;
  }[] = [];
  const otherFactors: Expression[] = [];

  for (const op of ops) {
    if (op.operator === 'Cos' && isFunction(op) && op.op1) {
      // Extract the base argument and multiplier
      const extracted = extractMultiplier(op.op1);
      if (extracted) {
        cosFactors.push({
          arg: extracted[2],
          numericMult: extracted[0],
          symbolicCoeff: extracted[1],
        });
      } else {
        cosFactors.push({
          arg: op.op1,
          numericMult: 1,
          symbolicCoeff: ce.One,
        });
      }
    } else {
      otherFactors.push(op);
    }
  }

  if (cosFactors.length < 2) return undefined;

  // Group cos factors by their base argument
  const baseArg = cosFactors[0].arg;

  // Filter to only those with the same base arg
  const matchingFactors = cosFactors.filter((f) => f.arg.isSame(baseArg));
  const nonMatchingCosFactors = cosFactors.filter(
    (f) => !f.arg.isSame(baseArg)
  );

  if (matchingFactors.length < 2) return undefined;

  // Sort by numeric multiplier value
  matchingFactors.sort((a, b) => a.numericMult - b.numericMult);

  // Find the longest ratio-2 subsequence starting from the smallest multiplier
  // The Morrie pattern requires consecutive terms with ratio 2: a, 2a, 4a, 8a, ...
  const morrieFactors: typeof matchingFactors = [];
  let remainingCosFactors: typeof matchingFactors = [];

  // Build the Morrie sequence greedily
  const sorted = [...matchingFactors];
  const currentMult = sorted[0].numericMult;

  if (currentMult > 0) {
    morrieFactors.push(sorted[0]);
    const used = new Set([0]);

    // Look for each subsequent power of 2
    let nextMult = currentMult * 2;
    while (true) {
      const idx = sorted.findIndex(
        (f, i) => !used.has(i) && Math.abs(f.numericMult - nextMult) < 1e-10
      );
      if (idx === -1) break;
      morrieFactors.push(sorted[idx]);
      used.add(idx);
      nextMult *= 2;
    }

    // Remaining cos factors with same base arg that don't fit the Morrie pattern
    remainingCosFactors = sorted.filter((_, i) => !used.has(i));
  }

  if (morrieFactors.length < 2) return undefined;

  const minMult = morrieFactors[0].numericMult;

  // Add non-Morrie cos factors to otherFactors
  const allOtherFactors = [...otherFactors];
  for (const f of remainingCosFactors) {
    const cosArg = f.symbolicCoeff.isSame(ce.One)
      ? f.arg
      : ce._fn('Multiply', [f.symbolicCoeff, f.arg]);
    allOtherFactors.push(ce._fn('Cos', [cosArg]));
  }
  for (const f of nonMatchingCosFactors) {
    const cosArg = f.symbolicCoeff.isSame(ce.One)
      ? f.arg
      : ce._fn('Multiply', [f.symbolicCoeff, f.arg]);
    allOtherFactors.push(ce._fn('Cos', [cosArg]));
  }

  // Apply Morrie's law:
  // cos(a)cos(2a)cos(4a)...cos(2^(n-1)a) = sin(2^n * a) / (2^n * sin(a))
  // where a = minCoeff * baseArg (using symbolic coefficient)
  const n = morrieFactors.length;
  const minCoeff = morrieFactors[0].symbolicCoeff; // Symbolic coefficient for smallest
  const powerOf2n = Math.pow(2, n);

  // Special case: when baseArg is Pi and minCoeff = 1/(2^n + 1),
  // then 2^n * minCoeff * Pi + minCoeff * Pi = Pi
  // so sin(2^n * minCoeff * Pi) = sin(Pi - minCoeff * Pi) = sin(minCoeff * Pi)
  // and the result simplifies to 1/2^n
  //
  // This happens when minCoeff * (2^n + 1) = 1, i.e., minMult = 1/(2^n + 1)
  if (isSymbol(baseArg) && baseArg.symbol === 'Pi') {
    const targetCoeff = 1 / (powerOf2n + 1);
    if (Math.abs(minMult - targetCoeff) < 1e-10) {
      // The sines cancel, result is just 1/2^n
      const result = ce.number([1, powerOf2n]);
      if (allOtherFactors.length === 0) return result;
      return result.mul(
        allOtherFactors.length === 1
          ? allOtherFactors[0]
          : ce._fn('Multiply', allOtherFactors)
      );
    }
  }

  // Compute 2^n * minCoeff symbolically
  const finalCoeff = minCoeff.mul(powerOf2n);

  // sin(2^n * minCoeff * baseArg) / (2^n * sin(minCoeff * baseArg))
  // Build the argument expressions preserving symbolic form
  const smallArg = minCoeff.isSame(ce.One)
    ? baseArg
    : ce._fn('Multiply', [minCoeff, baseArg]);
  const largeArg = ce._fn('Multiply', [finalCoeff, baseArg]);

  const sinNumerator = ce._fn('Sin', [largeArg]);
  const sinDenominator = ce._fn('Sin', [smallArg]);

  const result = sinNumerator.div(ce.number(powerOf2n).mul(sinDenominator));

  if (allOtherFactors.length === 0) return result;
  return result.mul(
    allOtherFactors.length === 1
      ? allOtherFactors[0]
      : ce._fn('Multiply', allOtherFactors)
  );
}

/**
 * Apply TRmorrie to all subexpressions
 */
export function applyTRmorrie(expr: Expression): Expression {
  return mapSubexpressions(expr, TRmorrie);
}

// ============================================================================
// TRpythagorean: Pythagorean identity in compound expressions
// Handles sin^2(x)+cos^2(x) within larger Add expressions
// Also handles patterns like c - c*sin^2(x) -> c*cos^2(x)
// ============================================================================

/**
 * Extract sin^2 or cos^2 term info from an expression
 */
function extractSquaredTrig(
  op: Expression
): { func: 'Sin' | 'Cos'; arg: Expression; coef: number } | null {
  // Direct Power(Sin/Cos, 2)
  if (op.operator === 'Power' && isFunction(op) && op.op2?.is(2)) {
    const base = op.op1;
    if (base?.operator === 'Sin' && isFunction(base) && base.op1) {
      return { func: 'Sin', arg: base.op1, coef: 1 };
    }
    if (base?.operator === 'Cos' && isFunction(base) && base.op1) {
      return { func: 'Cos', arg: base.op1, coef: 1 };
    }
  }

  // Multiply(coef, Power(Sin/Cos, 2))
  if (op.operator === 'Multiply' && isFunction(op)) {
    let coef = 1;
    let trigPower: Expression | undefined;

    for (const factor of op.ops) {
      if (
        factor.operator === 'Power' &&
        isFunction(factor) &&
        factor.op2?.is(2)
      ) {
        const base = factor.op1;
        if (base?.operator === 'Sin' || base?.operator === 'Cos') {
          trigPower = factor;
        }
      } else if (typeof factor.re === 'number' && factor.im === 0) {
        coef *= factor.re;
      }
    }

    if (trigPower && isFunction(trigPower)) {
      const base = trigPower.op1;
      if (base && base.operator === 'Sin' && isFunction(base) && base.op1) {
        return { func: 'Sin', arg: base.op1, coef };
      }
      if (base && base.operator === 'Cos' && isFunction(base) && base.op1) {
        return { func: 'Cos', arg: base.op1, coef };
      }
    }
  }

  return null;
}

export function TRpythagorean(expr: Expression): Expression | undefined {
  const ce = expr.engine;

  if (expr.operator !== 'Add') return undefined;
  if (!isFunction(expr)) return undefined;

  const ops = expr.ops;
  if (ops.length < 2) return undefined;

  // Look for sin^2(x) + cos^2(x) pairs with the same argument
  const trigTerms: {
    func: 'Sin' | 'Cos';
    arg: Expression;
    coef: number;
    index: number;
  }[] = [];
  const otherTerms: { expr: Expression; index: number }[] = [];
  const constantTerms: { value: number; index: number }[] = [];

  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    const extracted = extractSquaredTrig(op);

    if (extracted) {
      trigTerms.push({ ...extracted, index: i });
    } else if (typeof op.re === 'number' && op.im === 0 && isNumber(op)) {
      constantTerms.push({ value: op.re, index: i });
    } else {
      otherTerms.push({ expr: op, index: i });
    }
  }

  // Pattern 1: sin^2(x) + cos^2(x) = 1 (with same coefficient)
  for (let i = 0; i < trigTerms.length; i++) {
    for (let j = i + 1; j < trigTerms.length; j++) {
      const a = trigTerms[i];
      const b = trigTerms[j];

      // Check if they have the same argument and complementary functions
      if (
        a.arg.isSame(b.arg) &&
        ((a.func === 'Sin' && b.func === 'Cos') ||
          (a.func === 'Cos' && b.func === 'Sin'))
      ) {
        // Same coefficient: c*sin^2 + c*cos^2 = c
        if (Math.abs(a.coef - b.coef) < 1e-10) {
          const coef = a.coef;
          const usedIndices = new Set([a.index, b.index]);

          // Build remaining terms
          const remaining = ops.filter((_, k) => !usedIndices.has(k));

          if (remaining.length === 0) {
            return ce.number(coef);
          }

          // Add the constant coef to the remaining terms
          if (coef === 1) {
            return ce._fn('Add', [ce.One, ...remaining]);
          }
          return ce._fn('Add', [ce.number(coef), ...remaining]);
        }
      }
    }
  }

  // Pattern 2: c - c*sin^2(x) = c*cos^2(x) or c - c*cos^2(x) = c*sin^2(x)
  for (const trig of trigTerms) {
    if (trig.coef < 0) {
      // We have -|coef|*sin^2(x) or -|coef|*cos^2(x)
      const absCoef = Math.abs(trig.coef);

      // Look for a matching constant term
      for (const constant of constantTerms) {
        if (Math.abs(constant.value - absCoef) < 1e-10) {
          // Found c + (-c)*sin^2(x) = c*cos^2(x) pattern
          const usedIndices = new Set([trig.index, constant.index]);
          const remaining = ops.filter((_, k) => !usedIndices.has(k));

          const otherFunc = trig.func === 'Sin' ? 'Cos' : 'Sin';
          const result = ce._fn(otherFunc, [trig.arg]).pow(2).mul(absCoef);

          if (remaining.length === 0) {
            return result;
          }
          return ce._fn('Add', [result, ...remaining]);
        }
      }
    }
  }

  return undefined;
}

/**
 * Apply TRpythagorean to all subexpressions
 */
export function applyTRpythagorean(expr: Expression): Expression {
  return mapSubexpressions(expr, TRpythagorean);
}
