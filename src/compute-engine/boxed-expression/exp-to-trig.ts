import type { Expression } from '../global-types.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';
import { canonicalAngle } from './utils.js';

/** True if the expression carries the imaginary unit anywhere. */
function containsImaginary(e: Expression): boolean {
  if (isNumber(e)) return e.im !== 0;
  if (isSymbol(e, 'ImaginaryUnit')) return true;
  if (isFunction(e)) return e.ops.some(containsImaginary);
  return false;
}

/**
 * Rewrite exponentials of an imaginary argument to trigonometric form via
 * Euler's formula, `e^{i theta} -> cos(theta) + i sin(theta)`, throughout the
 * tree.
 */
export function expToTrig(expr: Expression): Expression {
  const ce = expr.engine;
  let e = expr;

  // Rewrite children first so nested exponentials are handled.
  if (isFunction(expr)) {
    const ops = expr.ops;
    const newOps = ops.map(expToTrig);
    if (newOps.some((o, i) => o !== ops[i]))
      e = ce.function(expr.operator, newOps);
  }

  if (
    isFunction(e) &&
    e.operator === 'Power' &&
    isSymbol(e.op1, 'ExponentialE')
  ) {
    const raw = e.op2.div(ce.I).evaluate();
    if (!containsImaginary(raw)) {
      const theta = canonicalAngle(raw) ?? raw;
      return ce
        .function('Cos', [theta])
        .add(ce.function('Sin', [theta]).mul(ce.I));
    }
  }
  return e;
}
