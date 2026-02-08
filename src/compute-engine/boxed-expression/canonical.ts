import type { BoxedExpression, CanonicalOptions, Scope } from '../global-types';

import { canonicalInvisibleOperator } from './invisible-operator';

import { flattenOps } from './flatten';
import { canonicalAdd } from './arithmetic-add';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div';
import { canonicalPower } from './arithmetic-power';
import { canonicalOrder } from './order';
import { asBigint } from './numerics';
import { isOperatorDef, isImaginaryUnit } from './utils';
import { isBoxedFunction, isBoxedNumber, isBoxedSymbol } from './type-guards';

export function canonicalForm(
  expr: BoxedExpression,
  forms: CanonicalOptions,
  scope?: Scope
): BoxedExpression {
  // No canonical form?
  if (forms === false) return expr;

  // Full canonical form?
  if (forms === true) return expr.engine._inScope(scope, () => expr.canonical);

  if (typeof forms === 'string') forms = [forms];

  // Like for full canonicalization, request the canonical form of symbols.
  // Automatically, this involves the substitution of the symbol with its
  // value, if it is a constant-flagged symbol, with a 'holdUntil' attribute of
  // 'never'
  // (@note: the reasoning for carrying this out here is because:
  // 1/ 'CanonicalForm' can be regarded as producing a 'canonical'
  // expression, (albeit a 'custom' one) but with the resulting expr.
  // having an 'isCanonical' value of 'true'
  // 2/ Symbol canonicalization (and substitution where appropriate)
  // facilitates several simplifications which would otherwise not be made:
  // for example 'x^y' where 'y=0', for canonicalPower.

  expr = symbolForm(expr);

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

  // Partial canonicalization produces a structural expression, not a fully
  // canonical one. This allows subsequent .canonical calls to perform full
  // canonicalization.
  if (isBoxedFunction(expr) && expr.isCanonical) {
    expr = expr.engine.function(expr.operator, [...expr.ops!], {
      form: 'structural',
    });
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

  if (!isBoxedFunction(expr) || expr.nops === 0) return expr;

  if (expr.operator === 'Delimiter') return flattenForm(expr.op1);

  //
  // Now, flatten any associative function
  //

  const ce = expr.engine;

  let isAssociative = expr.operator === 'Add' || expr.operator === 'Multiply';
  if (!isAssociative) {
    const def = ce.lookupDefinition(expr.operator);
    if (isOperatorDef(def) && def.operator.associative) isAssociative = true;
  }

  if (isAssociative)
    return ce.function(
      expr.operator,
      flattenOps(expr.ops.map(flattenForm), expr.operator)
    );

  return expr;
}

function invisibleOperatorForm(expr: BoxedExpression) {
  if (!isBoxedFunction(expr)) return expr;

  if (expr.operator === 'InvisibleOperator') {
    return (
      canonicalInvisibleOperator(expr.ops.map(invisibleOperatorForm), {
        engine: expr.engine,
      }) ?? expr
    );
  }

  return expr.engine._fn(expr.operator, [...expr.ops].map(invisibleOperatorForm));
}

/**
 * Apply the 'Number' form to the expression, _recursively_, in the case
 * where a **partial** canonicalization is requested. The result is not
 * canonical.
 *
 * This involes casting as numbers various (non-BoxedNumber) expression
 * structures, such as:
 *
 * - Expressions with a `Complex` operator are converted to a (complex)
 *   number or a `Add`/`Multiply` expression.
 *
 * - Expressions with a `Rational` operator are converted to a rational
 *    number if possible, and to a `Divide` otherwise.
 *
 * - A `Negate` operator applied to a number literal is converted to a number.
 *
 * <!--
 * (!note: the procedure outlined is a contracted one of that affixed to function 'box')
 *
 * @wip ?
 * -As discussed in compute-engine/pull/238, other possible transformations here:
 *  -Promotion of 'complex-numbers': ['Multiply', 2, 'ImaginaryUnit'] -> 2i)
 *    -^or even for 'InvisibleOperator',too...
 *  -Creation of complex: e.g. from `a + ib` or `ai + b` ('Add' instances)
 *
 * ^I.e., a cross-selection of ops. from 'Add','Multiply', 'InvisibleOperator'...
 * -->
 *
 */
function numberForm(expr: BoxedExpression): BoxedExpression {
  //(↓note: this is redundant, since numbers are _always_ boxed as canonical (v27.0), but preserving
  //for explicitness in case things change)
  if (isBoxedNumber(expr)) return expr.canonical;

  // Ensure that all representations of the imaginary unit are represented
  // with the BoxedNumber variant: this makes further simplifications more
  // straightforward.
  if (isImaginaryUnit(expr)) return expr.engine.I;

  // Only deal with function expressions henceforth
  if (!isBoxedFunction(expr)) return expr;

  const { engine: ce } = expr;

  // Recursively visit all sub-expressions
  const ops = expr.ops.map(numberForm);
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

    return ce._fn('Divide', ops, { canonical: false });
  }

  //
  // Complex
  //
  if (name === 'Complex') {
    if (ops.length === 1) {
      // If single argument, assume it's imaginary, i.e.
      // `["Complex", 2]` -> `2i`
      const op1 = ops[0];
      if (isBoxedNumber(op1)) return ce.number(ce.complex(0, op1.re));

      return ce._fn('Multiply', [op1, ce.I], { canonical: false });
    }
    if (ops.length === 2) {
      const re = ops[0].re;
      const im = ops[1].re;
      if (im !== null && re !== null && !isNaN(im) && !isNaN(re)) {
        if (im === 0 && re === 0) return ce.Zero;
        if (im !== 0) return ce.number(ce._numericValue({ re, im }));
        return ops[0];
      }
      return ce._fn(
        'Add',
        [ops[0], ce._fn('Multiply', [ops[1], ce.I], { canonical: false })],
        { canonical: false }
      );
    }
    throw new Error('Expected one or two arguments with `Complex` expression');
  }

  //
  // Negate
  //
  // Distribute over literals
  //
  if (name === 'Negate' && ops.length === 1) {
    const op1 = ops[0]!;
    if (isBoxedNumber(op1)) {
      const { numericValue } = op1;
      if (numericValue !== undefined)
        return ce.number(
          typeof numericValue === 'number' ? -numericValue : numericValue.neg()
        );
    }

    // @consider: getImaginaryFactor/InvisibleOperator: i.e. account for '-2i', & so on.
    // Capture -ve Imaginary
    if (isImaginaryUnit(op1)) return ce.number(ce.complex(0, -1));
  }

  // Re-box only if some transformation has applied
  return ops.every((op, index) => op === expr.ops![index])
    ? expr
    : ce._fn(name, ops, { canonical: false });
}

/**
 * Apply the 'Multiply' form recursively. Each sub-expression is visited
 * and any `Multiply` or `Negate` at the current level is canonicalized.
 *
 * Operands are passed directly to `canonicalMultiply` without calling
 * `.canonical` on them, consistent with `addForm` and `powerForm`.
 * `canonicalMultiply` documents that "The input ops may not be canonical."
 */
function multiplyForm(expr: BoxedExpression) {
  // Recursively visit all sub-expressions
  if (!isBoxedFunction(expr)) return expr;
  const ops = expr.ops.map(multiplyForm);

  // If this is a multiply, canonicalize it
  if (expr.operator === 'Multiply') return canonicalMultiply(expr.engine, ops);

  if (expr.operator === 'Negate')
    return canonicalMultiply(expr.engine, [ops[0], expr.engine.NegativeOne]);

  return expr;
}

function addForm(expr: BoxedExpression) {
  // Recursively visit all sub-expressions
  if (!isBoxedFunction(expr)) return expr;
  const ops = expr.ops.map(addForm);

  // If this is an addition or subtraction, canonicalize it
  if (expr.operator === 'Add') return canonicalAdd(expr.engine, ops);

  if (expr.operator === 'Subtract')
    return canonicalAdd(expr.engine, [ops[0], ops[1].neg()]);

  return expr.engine._fn(expr.operator, ops);
}

/**
 * Apply the 'Power' form recursively. Each sub-expression is visited
 * and any `Power` at the current level is canonicalized via `canonicalPower`.
 *
 * Note: `divideForm` intentionally calls `powerForm` on its operands before
 * passing them to `canonicalDivide`, since division canonicalization benefits
 * from normalized power expressions.
 */
function powerForm(expr: BoxedExpression) {
  if (!isBoxedFunction(expr)) return expr;

  const ops = expr.ops.map((expr) => powerForm(expr));

  // If this is a power, canonicalize it
  if (expr.operator === 'Power') return canonicalPower(ops[0], ops[1]);

  return expr.engine._fn(expr.operator, ops, { canonical: false });
}

/**
 * Replace symbols within expr. with canonical variants, *recursively*.
 *
 * @param expr
 * @returns
 */
function symbolForm(expr: BoxedExpression): BoxedExpression {
  if (isBoxedSymbol(expr)) return expr.canonical;
  if (!isBoxedFunction(expr)) return expr;

  return expr.engine._fn(expr.operator, expr.ops.map(symbolForm), {
    canonical: false,
  });
}

/**
 * Apply the 'Divide' form recursively. For `Divide` expressions, operands
 * are first passed through `powerForm` before being canonicalized via
 * `canonicalDivide`. This is because division canonicalization benefits from
 * having power expressions already normalized (e.g., `a / b^{-1}` simplifies
 * better when the exponent is already in canonical form).
 *
 * This is the only form that internally applies another form (`Power`) to
 * its operands.
 */
function divideForm(expr: BoxedExpression) {
  // If this is a divide, canonicalize it
  if (expr.operator === 'Divide' && isBoxedFunction(expr))
    return canonicalDivide(powerForm(expr.op1), powerForm(expr.op2));

  // Recursively visit all sub-expressions
  if (!isBoxedFunction(expr)) return expr;

  return expr.engine._fn(expr.operator, expr.ops.map(divideForm));
}
