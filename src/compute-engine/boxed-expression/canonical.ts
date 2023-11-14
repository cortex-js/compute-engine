import { canonicalAdd } from '../library/arithmetic-add';
import { canonicalDivide } from '../library/arithmetic-divide';
import { canonicalMultiply } from '../library/arithmetic-multiply';
import { canonicalPower } from '../library/arithmetic-power';
import { canonicalInvisibleOperator } from '../library/core';
import { BoxedExpression, CanonicalForm } from '../public';
import {
  flattenDelimiter,
  flattenOps,
  flattenSequence,
} from '../symbolic/flatten';
import { canonicalOrder } from './order';

export function canonicalForm(
  expr: BoxedExpression,
  forms: boolean | CanonicalForm | CanonicalForm[]
): BoxedExpression {
  // No canonical form?
  if (forms === false) return expr;

  // Full canonical form?
  if (forms === true) return expr.canonical;

  if (typeof forms === 'string') forms = [forms];

  // Apply each form in turn
  for (const form of forms) {
    switch (form) {
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

function flattenForm(expr: BoxedExpression) {
  if (!expr.ops) return expr;

  //
  // Recursively visit all sub-expressions
  //
  let ops = expr.ops.map(flattenForm);

  //
  // Flatter any delimiters
  //
  if (expr.head === 'Delimiter')
    ops = [flattenDelimiter(expr.engine, expr.op1)];

  //
  // Now, flatten any associative function
  //
  const ce = expr.engine;
  let isCommutative = expr.head === 'Add' || expr.head === 'Multiply';
  if (!isCommutative) {
    const def = ce.lookupFunction(expr.head);
    if (def?.commutative) isCommutative = true;
  }
  if (isCommutative && typeof expr.head === 'string')
    expr = ce._fn(expr.head, flattenOps(ops, expr.head));

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
  if (expr.head === 'Multiply') return canonicalMultiply(expr.engine, ops);

  if (expr.head === 'Negate')
    return canonicalMultiply(expr.engine, [expr.op1, expr.engine.NegativeOne]);

  return expr;
}

function addForm(expr: BoxedExpression) {
  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;
  const ops = expr.ops.map(addForm);

  // If this is a multiply, canonicalize it
  if (expr.head === 'Add') return canonicalAdd(expr.engine, ops);

  if (expr.head === 'Subtract')
    return expr.engine._fn('Add', [
      addForm(expr.op1),
      addForm(expr.engine.neg(expr.op2)),
    ]);

  return expr.engine._fn(expr.head, ops);
}

function powerForm(expr: BoxedExpression) {
  if (!expr.ops) return expr;

  // If this is a multiply, canonicalize it
  if (expr.head === 'Power')
    return canonicalPower(
      expr.engine,
      powerForm(expr.op1),
      powerForm(expr.op2)
    );

  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;

  return expr.engine._fn(expr.head, expr.ops.map(powerForm));
}

function divideForm(expr: BoxedExpression) {
  // If this is a divide, canonicalize it
  if (expr.head === 'Divide')
    return canonicalDivide(
      expr.engine,
      powerForm(expr.op1),
      powerForm(expr.op2)
    );

  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;

  return expr.engine._fn(expr.head, expr.ops.map(divideForm));
}
