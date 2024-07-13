import { canonicalAdd } from '../library/arithmetic-add';
import { canonicalDivide } from '../library/arithmetic-divide';
import { canonicalMultiply } from '../library/arithmetic-multiply';
import { canonicalPower } from '../library/arithmetic-power';
import { canonicalInvisibleOperator } from '../library/core';
import { BoxedExpression, CanonicalOptions } from '../public';
import { flattenOps } from '../symbolic/flatten';
import { canonicalOrder } from './order';

export function canonicalForm(
  expr: BoxedExpression,
  forms: CanonicalOptions
): BoxedExpression {
  // No canonical form?
  if (forms === false) return expr;

  // Full canonical form?
  if (forms === true) return expr.canonical;

  if (typeof forms === 'string') forms = [forms];

  // Apply each form in turn
  for (const form of forms) {
    switch (form) {
      // @todo: consider additional forms: "Symbol", "Tensor"
      case 'InvisibleOperator':
        expr = invisibleOperatorForm(expr);
        break;
      case 'Number':
        expr = numberForm(expr);
        break;
      case 'Multiply':
        expr = multiplyForm(expr);
        break;
      case 'Add':
        expr = addForm(expr);
        break;
      case 'Power':
        expr = powerForm(expr);
        break;
      case 'Divide':
        expr = divideForm(expr);
        break;
      case 'Flatten':
        // Flatten ops, delimiters and sequences
        expr = flattenForm(expr);
        break;
      case 'Order':
        expr = canonicalOrder(expr, { recursive: true });
        break;
      default:
        throw Error('Invalid canonical form');
    }
  }

  return expr;
}

/**
 * Apply the "Flatten" form to the expression:
 * - remove delimiters
 * - flatten associative functions
 *
 * This function is recursive.
 */
function flattenForm(expr: BoxedExpression) {
  if (!expr.head) return expr;

  if (!expr.ops || expr.nops === 0) return expr;

  if (expr.head === 'Delimiter') return flattenForm(expr.op1);

  //
  // Now, flatten any associative function
  //

  const ce = expr.engine;

  let isAssociative = expr.head === 'Add' || expr.head === 'Multiply';
  if (!isAssociative) {
    const def = ce.lookupFunction(expr.head);
    if (def?.associative) isAssociative = true;
  }

  if (isAssociative && typeof expr.head === 'string')
    return ce.function(
      expr.head,
      flattenOps(expr.ops.map(flattenForm), expr.head)
    );

  return expr;
}

function invisibleOperatorForm(expr: BoxedExpression) {
  if (!expr.ops) return expr;

  if (expr.head === 'InvisibleOperator') {
    return (
      canonicalInvisibleOperator(
        expr.engine,
        expr.ops.map(invisibleOperatorForm)
      ) ?? expr
    );
  }

  return expr.engine._fn(expr.head, expr.ops.map(invisibleOperatorForm));
}

function numberForm(expr: BoxedExpression) {
  // Return the canonical form if a number literal
  if (expr.numericValue) return expr.canonical;

  // Recursively visit all sub-expressions
  if (expr.ops) return expr.engine._fn(expr.head, expr.ops.map(numberForm));
  return expr;
}

function multiplyForm(expr: BoxedExpression) {
  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;
  const ops = expr.ops.map(multiplyForm);

  // If this is a multiply, canonicalize it
  if (expr.head === 'Multiply')
    return canonicalMultiply(
      expr.engine,
      ops.map((x) => x.canonical)
    );

  if (expr.head === 'Negate') {
    return canonicalMultiply(expr.engine, [ops[0], expr.engine.NegativeOne]);
  }

  return expr;
}

function addForm(expr: BoxedExpression) {
  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;
  const ops = expr.ops.map(addForm);

  // If this is an addition or subtraction, canonicalize it
  if (expr.head === 'Add') return canonicalAdd(expr.engine, ops);

  if (expr.head === 'Subtract')
    return canonicalAdd(expr.engine, [ops[0], expr.engine.neg(ops[1])]);

  return expr.engine._fn(expr.head, ops);
}

function powerForm(expr: BoxedExpression) {
  if (!expr.ops) return expr;

  // If this is a power, canonicalize it
  if (expr.head === 'Power')
    return canonicalPower(powerForm(expr.op1), powerForm(expr.op2));

  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;

  return expr.engine._fn(expr.head, expr.ops.map(powerForm));
}

function divideForm(expr: BoxedExpression) {
  // If this is a divide, canonicalize it
  if (expr.head === 'Divide')
    return canonicalDivide(powerForm(expr.op1), powerForm(expr.op2));

  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;

  return expr.engine._fn(expr.head, expr.ops.map(divideForm));
}
