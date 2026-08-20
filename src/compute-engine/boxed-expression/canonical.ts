import type {
  Expression,
  CanonicalForm,
  CanonicalOptions,
  Scope,
} from '../global-types.js';

import { canonicalInvisibleOperator } from './invisible-operator.js';

import { flatten } from './flatten.js';
import { canonicalAdd } from './arithmetic-add.js';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div.js';
import { canonicalPower } from './arithmetic-power.js';
import { canonicalOrder } from './order.js';
import { declaredBinders, binderShadowAt } from './binding-sites.js';
import { asBigint } from './numerics.js';
import { isOperatorDef, isImaginaryUnit } from './utils.js';
import { isFunction, isNumber, isSymbol } from './type-guards.js';

export function canonicalForm(
  expr: Expression,
  forms: CanonicalOptions,
  scope?: Scope
): Expression {
  // No canonical form?
  if (forms === false) return expr;

  // Full canonical form? Without a scope, `_inScope()` would just call its
  // callback: go straight to the getter. This is on the recursive path of
  // canonicalizing an already-boxed tree (each operand's `.canonical` comes
  // back through here), where every frame per level costs depth.
  if (forms === true)
    return scope === undefined
      ? expr.canonical
      : expr.engine._inScope(scope, () => expr.canonical);

  if (typeof forms === 'string') forms = [forms];

  // A partial form is not fully canonical, so it follows the STRUCTURAL symbol
  // contract: symbols resolve against the scope chain (a `holdUntil: 'never'`
  // constant still substitutes its value, an existing declaration still binds),
  // but a name that resolves to nothing is left unbound instead of being
  // declared into the caller's scope. The suppression wraps the whole pipeline
  // because the forms reach `.canonical` on a symbol through many helpers
  // (`isImaginaryUnit`, `flatten`, `canonicalInvisibleOperator`, …), not just
  // `symbolForm`. See `docs/SCOPING-MODEL.md` A1.
  //
  // The supplied scope is honored on this path too (B1): it steers the lookups
  // the forms perform, exactly as it does on the `forms === true` path above.
  // Without it, `scope` was silently ignored for every partial form.
  const formList = forms;
  return expr.engine._inScope(scope, () =>
    expr.engine._resolveOnly(() => applyForms(expr, formList))
  );
}

/**
 * `expr`'s symbol name, or `''` for anything that is not a symbol — a sentinel
 * no binder can bind, so a shadow-set membership test on it is always false.
 */
function symbolNameOf(expr: Expression): string {
  return isSymbol(expr) ? expr.symbol : '';
}

function applyForms(
  expr: Expression,
  forms: readonly CanonicalForm[]
): Expression {
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
  if (isFunction(expr) && expr.isCanonical) {
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
function flattenForm(expr: Expression): Expression {
  if (!expr.operator) return expr;

  if (!isFunction(expr) || expr.nops === 0) return expr;

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
    return ce._fn(
      expr.operator,
      flatten(expr.ops.map(flattenForm), expr.operator, false),
      { canonical: false }
    );

  // For non-associative functions, still recurse into operands to
  // unwrap any nested Delimiters
  const newOps = expr.ops.map(flattenForm);
  if (newOps.every((op, i) => op === expr.ops[i])) return expr;
  return ce._fn(expr.operator, newOps, { canonical: false });
}

function invisibleOperatorForm(
  expr: Expression,
  shadowed?: ReadonlySet<string>
): Expression {
  if (!isFunction(expr)) return expr;

  const binders = declaredBinders(expr);

  if (expr.operator === 'InvisibleOperator') {
    return (
      // `2i` is the parse shape of an implicit product, and folding it to a
      // complex number reads the `i`: a bound index named `i` must not take
      // that path, exactly as in `symbolForm`/`numberForm`. `InvisibleOperator`
      // binds nothing itself, so the set it passes on is its caller's.
      canonicalInvisibleOperator(
        expr.ops.map((op, m) =>
          invisibleOperatorForm(op, binderShadowAt(binders, m, shadowed))
        ),
        { engine: expr.engine, shadowed }
      ) ?? expr
    );
  }

  return expr.engine._fn(
    expr.operator,
    [...expr.ops].map((op, m) =>
      invisibleOperatorForm(op, binderShadowAt(binders, m, shadowed))
    )
  );
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
function numberForm(
  expr: Expression,
  shadowed?: ReadonlySet<string>
): Expression {
  //(↓note: this is redundant, since numbers are _always_ boxed as canonical (v27.0), but preserving
  //for explicitness in case things change)
  if (isNumber(expr)) return expr.canonical;

  // Ensure that all representations of the imaginary unit are represented
  // with the BoxedNumber variant: this makes further simplifications more
  // straightforward. A symbol a binder BINDS is not the imaginary unit,
  // however it is spelled — `Sum(2i, Limits(i, 1, 3))` sums over an index that
  // happens to be named `i`, and rewriting it to `Complex(0, 1)` destroys both
  // the binding site and every use (`symbolForm` below carries the same guard,
  // and the same reasoning).
  if (!shadowed?.has(symbolNameOf(expr)) && isImaginaryUnit(expr))
    return expr.engine.I;

  // Only deal with function expressions henceforth
  if (!isFunction(expr)) return expr;

  const { engine: ce } = expr;

  const binders = declaredBinders(expr);
  // The shadow set in force at operand 0 — what the `Negate` arm below asks
  // about `ops[0]`. A clause-local name can be invisible at one operand and
  // bound at the next, so the set is per operand, not per node.
  const firstOpShadow = binderShadowAt(binders, 0, shadowed);

  // Recursively visit all sub-expressions
  const ops = expr.ops.map((op, m) =>
    numberForm(
      op,
      m === 0 ? firstOpShadow : binderShadowAt(binders, m, shadowed)
    )
  );
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
      if (isNumber(op1)) return ce.number(ce.complex(0, op1.re));

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
    if (isNumber(op1)) {
      const { numericValue } = op1;
      if (numericValue !== undefined)
        return ce.number(
          typeof numericValue === 'number' ? -numericValue : numericValue.neg()
        );
    }

    // @consider: getImaginaryFactor/InvisibleOperator: i.e. account for '-2i', & so on.
    // Capture -ve Imaginary — unless the operand is a bound variable that is
    // merely NAMED `i` (see the head of this function).
    if (!firstOpShadow?.has(symbolNameOf(op1)) && isImaginaryUnit(op1))
      return ce.number(ce.complex(0, -1));
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
function multiplyForm(expr: Expression): Expression {
  // Recursively visit all sub-expressions
  if (!isFunction(expr)) return expr;
  const ops = expr.ops.map(multiplyForm);

  // If this is a multiply, canonicalize it
  if (expr.operator === 'Multiply') return canonicalMultiply(expr.engine, ops);

  if (expr.operator === 'Negate')
    return canonicalMultiply(expr.engine, [ops[0], expr.engine.NegativeOne]);

  return expr;
}

function addForm(expr: Expression): Expression {
  // Recursively visit all sub-expressions
  if (!isFunction(expr)) return expr;
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
function powerForm(expr: Expression): Expression {
  if (!isFunction(expr)) return expr;

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
function symbolForm(
  expr: Expression,
  shadowed?: ReadonlySet<string>
): Expression {
  // A BOUND variable is not a reference to resolve. Canonicalizing it here
  // resolves it against the ambient scope — the binder's own scope does not
  // exist yet on this raw tree — so an index named after a library constant
  // came back as that constant: `Sum(2i, Limits(i, 1, 3))` with any partial
  // form requested became `Sum(2·Complex(0,1), Limits(Complex(0,1), 1, 3))`,
  // at the binding site as well as in the body. The names come from the
  // operator DEFINITION's binding sites, the only source a tree with no
  // `localScope` has, and they are applied per operand so a CLAUSE-LOCAL name
  // shadows only where it is actually in scope (`declaredBinders` /
  // `binderShadowAt`, `binding-sites.ts`).
  if (isSymbol(expr)) return shadowed?.has(expr.symbol) ? expr : expr.canonical;
  if (!isFunction(expr)) return expr;

  const binders = declaredBinders(expr);

  return expr.engine._fn(
    expr.operator,
    expr.ops.map((op, m) =>
      symbolForm(op, binderShadowAt(binders, m, shadowed))
    ),
    { canonical: false }
  );
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
function divideForm(expr: Expression): Expression {
  // If this is a divide, canonicalize it
  if (isFunction(expr, 'Divide'))
    return canonicalDivide(powerForm(expr.op1), powerForm(expr.op2));

  // Recursively visit all sub-expressions
  if (!isFunction(expr)) return expr;

  return expr.engine._fn(expr.operator, expr.ops.map(divideForm));
}
