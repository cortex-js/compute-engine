import { flattenOps } from './flatten';

import { canonicalAdd } from './arithmetic-add';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div';
import { canonicalPower } from './arithmetic-power';
import { canonicalInvisibleOperator } from '../library/invisible-operator';

import { canonicalOrder } from './order';
import { asBigint } from './numerics';
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

/**
 * Apply the 'Number' form to the expression, _recursively_.
 *
 * This involes casting as numbers various (non-BoxedNumber) expression structures, such as:
 *
 * This includes :
 * - Expressions with an operator of `Complex` are converted to a (complex) number
 *     or a `Add`/`Multiply` expression.
 *
 * - An expression with a `Rational` operator is converted to a rational
 *    number if possible, and to a `Divide` otherwise.
 *
 * - A `Negate` function applied to a number literal is converted to a number.
 *
 * <!--
 * (!note: the procedure outlined is a contracted one of that affixed to function 'box')
 * -->
 *
 * @param expr
 * @returns
 */
function numberForm(expr: BoxedExpression): BoxedExpression {
  //(↓note: this is redundant, since numbers are _always_ boxed as canonical (v27.0), but preserving
  //for explicitness in case things change)
  if (expr.isNumberLiteral) return expr.canonical;

  if (!expr.isFunctionExpression) return expr;

  const { engine: ce } = expr;

  // Recursively visit all sub-expressions
  const ops = expr.ops!.map(numberForm);
  let { operator: name } = expr;

  //
  // Rational (as Divide)
  //
  if ((name === 'Divide' || name === 'Rational') && ops.length === 2) {
    const n = asBigint(ops[0]);
    if (n !== null) {
      const d = asBigint(ops[1]);
      if (d !== null) return ce.number([n, d]);
    }
    name = 'Divide';
  }

  //
  // Complex
  //
  if (name === 'Complex') {
    if (ops.length === 1) {
      // If single argument, assume it's imaginary
      const op1 = ops[0];
      if (op1.isNumberLiteral) return ce.number(ce.complex(0, op1.re));

      return op1.mul(ce.I);
    }
    if (ops.length === 2) {
      const re = ops[0].re;
      const im = ops[1].re;
      if (im !== null && re !== null && !isNaN(im) && !isNaN(re)) {
        if (im === 0 && re === 0) return ce.Zero;
        if (im !== 0) return ce.number(ce._numericValue({ re, im }));
        return ops[0];
      }
      return ops[0].add(ops[1].mul(ce.I));
    }
    throw new Error('Expected one or two arguments with Complex expression');
  }

  //
  // Negate
  //
  // Distribute over literals
  //
  if (name === 'Negate' && ops.length === 1) {
    const op1 = ops[0]!;
    const { numericValue } = op1;
    if (numericValue !== null)
      return ce.number(
        typeof numericValue === 'number' ? -numericValue : numericValue.neg()
      );
  }

  return ops.every((op, index) => op === expr.ops![index])
    ? expr
    : ce._fn(name, ops, { canonical: false });
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

  const ops = expr.ops.map((expr) => powerForm(expr));

  // If this is a power, canonicalize it
  if (expr.operator === 'Power') return canonicalPower(ops[0], ops[1]);

  return expr.engine._fn(expr.operator, ops, { canonical: false });
}

function divideForm(expr: BoxedExpression) {
  // If this is a divide, canonicalize it
  if (expr.operator === 'Divide')
    return canonicalDivide(powerForm(expr.op1), powerForm(expr.op2));

  // Recursively visit all sub-expressions
  if (!expr.ops) return expr;

  return expr.engine._fn(expr.operator, expr.ops.map(divideForm));
}
