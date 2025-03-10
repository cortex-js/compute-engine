import { flattenOps } from './flatten';

import { canonicalAdd } from './arithmetic-add';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div';
import { canonicalInvisibleOperator } from '../library/invisible-operator';

import { canonicalOrder } from './order';
import type { BoxedExpression, CanonicalOptions } from '../global-types';

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
  if (!expr.operator) return expr;

  if (!expr.ops || expr.nops === 0) return expr;

  if (expr.operator === 'Delimiter') return flattenForm(expr.op1);

  //
  // Now, flatten any associative function
  //

  const ce = expr.engine;

  let isAssociative = expr.operator === 'Add' || expr.operator === 'Multiply';
  if (!isAssociative) {
    const def = ce.lookupFunction(expr.operator);
    if (def?.associative) isAssociative = true;
  }

  if (isAssociative)
    return ce.function(
      expr.operator,
      flattenOps(expr.ops.map(flattenForm), expr.operator)
    );

  return expr;
}

function invisibleOperatorForm(expr: BoxedExpression) {
  if (!expr.ops) return expr;

  if (expr.operator === 'InvisibleOperator') {
    return (
      canonicalInvisibleOperator(expr.ops.map(invisibleOperatorForm), {
        engine: expr.engine,
      }) ?? expr
    );
  }

  return expr.engine._fn(expr.operator, expr.ops.map(invisibleOperatorForm));
}

function numberForm(expr: BoxedExpression) {
  // Return the canonical form if a number literal
  if (expr.isNumberLiteral) return expr.canonical;

  // Recursively visit all sub-expressions
  if (expr.ops) return expr.engine._fn(expr.operator, expr.ops.map(numberForm));
  return expr;
}

function multiplyForm(expr: BoxedExpression) {
  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;
  const ops = expr.ops.map(multiplyForm);

  // If this is a multiply, canonicalize it
  if (expr.operator === 'Multiply')
    return canonicalMultiply(
      expr.engine,
      ops.map((x) => x.canonical)
    );

  if (expr.operator === 'Negate')
    return canonicalMultiply(expr.engine, [ops[0], expr.engine.NegativeOne]);

  return expr;
}

function addForm(expr: BoxedExpression) {
  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;
  const ops = expr.ops.map(addForm);

  // If this is an addition or subtraction, canonicalize it
  if (expr.operator === 'Add') return canonicalAdd(expr.engine, ops);

  if (expr.operator === 'Subtract')
    return canonicalAdd(expr.engine, [ops[0], ops[1].neg()]);

  return expr.engine._fn(expr.operator, ops);
}

function powerForm(expr: BoxedExpression) {
  if (!expr.ops) return expr;

  // If this is a power, canonicalize it
  if (expr.operator === 'Power')
    return powerForm(expr.op1).pow(powerForm(expr.op2));

  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;

  return expr.engine._fn(expr.operator, expr.ops.map(powerForm));
}

function divideForm(expr: BoxedExpression) {
  // If this is a divide, canonicalize it
  if (expr.operator === 'Divide')
    return canonicalDivide(powerForm(expr.op1), powerForm(expr.op2));

  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;

  return expr.engine._fn(expr.operator, expr.ops.map(divideForm));
}
