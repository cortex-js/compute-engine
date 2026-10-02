import type {
  Expression,
  IComputeEngine as ComputeEngine,
  Metadata,
  Scope,
} from '../global-types.js';
import { canonicalAdd } from './arithmetic-add.js';
import { canonicalMultiply, canonicalDivide } from './arithmetic-mul-div.js';
import { canonicalPower, canonicalRoot } from './arithmetic-power.js';
import { canonicalNegate } from './negate.js';
import { checkNumericArgs } from './validate.js';
import { isNumber } from './type-guards.js';
import { registerNumericCanonicalHandler } from './numeric-canonical-registry.js';

/**
 * The operators whose canonical form `canonicalNumericOperator` computes.
 * `makeNumericFunction` (`box.ts`) calls it by name for these operators
 * without looking up their definition, and each of their library definitions
 * has a `canonical` handler that calls it too (`numericCanonicalHandler`).
 */
export const NUMERIC_CANONICAL_NAMES: ReadonlySet<string> = new Set([
  'Add',
  'Multiply',
  'Negate',
  'Square',
  'Sqrt',
  'Exp',
  'Ln',
  'Log',
  'Power',
  'Root',
  'Divide',
]);

/**
 * The canonical form of the arithmetic operator `name` applied to `ops`,
 * which must already be canonical.
 *
 * Returns `null` when `name` is not one of `NUMERIC_CANONICAL_NAMES`, and
 * when an operand is a `Spread` (`Add(...t)`): the arity checks and the
 * folding below assume the final positional operands, which exist only when
 * the spread splices at evaluation.
 *
 * The operands are checked as numeric (`checkNumericArgs`); an invalid
 * operand gives a canonical, invalid expression with the operator `name`.
 */
export function canonicalNumericOperator(
  ce: ComputeEngine,
  name: string,
  canonicalOps: ReadonlyArray<Expression>,
  metadata?: Metadata
): Expression | null {
  let ops: ReadonlyArray<Expression> = [];
  if (name === 'Add' || name === 'Multiply')
    ops = checkNumericArgs(ce, canonicalOps, { flatten: name });
  else if (
    name === 'Negate' ||
    name === 'Square' ||
    name === 'Sqrt' ||
    name === 'Exp'
  )
    ops = checkNumericArgs(ce, canonicalOps, 1);
  else if (name === 'Ln' || name === 'Log') {
    ops = checkNumericArgs(ce, canonicalOps);
    if (ops.length === 0) ops = [ce.error('missing')];
  } else if (name === 'Power' || name === 'Root')
    ops = checkNumericArgs(ce, canonicalOps, 2);
  else if (name === 'Divide') {
    // Note: Divide can have more than one argument, i.e.
    // Divide(a, b, c) = a / b / c
    // But it needs at least two arguments
    ops = checkNumericArgs(ce, canonicalOps);
    if (ops.length === 0) ops = [ce.error('missing'), ce.error('missing')];
    if (ops.length === 1) ops = [ops[0], ce.error('missing')];
  } else return null;

  // A `Spread` operand (`Add(...t)`) defers the whole numeric route to the
  // generic operator route: the canonical constructors below (the
  // single-operand `Add`/`Multiply` unwrap, eager folding) and the arity
  // padding above assume the FINAL positional operands, which only exist
  // once the spread splices at evaluation (step 0 of the evaluate path).
  if (ops.some((x) => x.operator === 'Spread')) return null;

  // If some of the arguments are not valid, we're done
  // (note: the result is canonical, but not valid)
  if (!ops.every((x) => x.isValid))
    return ce._fn(name, ops, { metadata, canonical: true });

  if (name === 'Add') return canonicalAdd(ce, ops);
  if (name === 'Negate') return canonicalNegate(ops[0]);
  if (name === 'Multiply') return canonicalMultiply(ce, ops);
  if (name === 'Divide') {
    if (ops.length === 2)
      return canonicalDivide(...(ops as [Expression, Expression]));
    return ops.slice(1).reduce((a, b) => canonicalDivide(a, b), ops[0]);
  }
  if (name === 'Exp') return canonicalPower(ce.E, ops[0]);
  if (name === 'Square') return canonicalPower(ops[0], ce.number(2));
  if (name === 'Power') return canonicalPower(ops[0], ops[1]);
  if (name === 'Root') return canonicalRoot(ops[0], ops[1]);
  if (name === 'Sqrt') return canonicalRoot(ops[0], 2);

  // Ln or Log
  if (ops.length > 0) {
    // Ln(1) -> 0, Log(1) -> 0 — literal only: `.isSame(1)` follows symbol
    // value bindings, and a mutable symbol's transient value must not fold
    // into canonical structure (`Ln(x)` while `x` holds 1 stays `Ln(x)`).
    // Not for a literal base of 1 or NaN: `Log(1, 1)` is the quotient
    // `0/0 = NaN` and `Log(1, NaN)` propagates the NaN — both are the
    // evaluate route's answers (`logarithmAtExceptionalPoint`). A
    // SYMBOLIC base does fold: `Log(1, b) = 0` is the generic-point
    // convention, the same one that folds `1^x` to 1 without assuming
    // the exceptional exponent — the value `b` may later take is not
    // assumed to be 1.
    const base = ops[1];
    const baseIsOneOrNaN =
      base !== undefined && isNumber(base) && (base.isSame(1) || base.isNaN);
    // Only an EXACT `1` with an exact or symbolic base folds: `Ln(1.0)`
    // and `Log(1, 2.0)` stay, and evaluate to the float `0`, as a float
    // operand gives a float result.
    const baseIsFloat = base !== undefined && isNumber(base) && !base.isExact;
    if (
      isNumber(ops[0]) &&
      ops[0].isExact &&
      ops[0].isSame(1) &&
      !baseIsOneOrNaN &&
      !baseIsFloat
    )
      return ce.Zero;
    // Ln(a) -> Ln(a), Log(a) -> Log(a)
    if (ops.length === 1)
      return ce._fn(name, ops, { metadata, canonical: true });
  }
  // Ln(a,b) -> Log(a, b)
  return ce._fn('Log', ops, { metadata, canonical: true });
}

/**
 * The `canonical` handler of the library definition of the arithmetic
 * operator `name` (one of `NUMERIC_CANONICAL_NAMES`).
 *
 * Boxing does not call it for the library definition itself:
 * `makeNumericFunction` (`box.ts`) computes the same canonical form by name,
 * which avoids the definition lookup. The handler exists so that a copy of
 * the definition (`ce.declare('Sqrt', { ...ce.lookupDefinition('Sqrt')
 * .operator, evaluate })`) takes the canonical form along with it. The
 * handler is registered (`numeric-canonical-registry.ts`), and
 * `makeNumericFunction` uses its by-name route for a definition that holds
 * it, so a copy that changes no field gives the same results as the library
 * operator.
 *
 * When the generic route does call it (a named-argument call, a `Spread`
 * operand): the operands of the lazy `Add` and `Multiply` arrive as they were
 * written, not canonical, so the handler makes them canonical first. With a
 * `Spread` operand the handler keeps the operands as they arrived, as the
 * generic route did before these definitions had a handler.
 */
export function numericCanonicalHandler(
  name: string
): (
  ops: ReadonlyArray<Expression>,
  options: { engine: ComputeEngine; scope: Scope | undefined }
) => Expression | null {
  return registerNumericCanonicalHandler(name, (ops, { engine, scope }) => {
    const xs = ops.every((x) => x.isCanonical)
      ? ops
      : ops.map((x) => (x.isCanonical ? x : engine.expr(x, { scope })));
    return (
      canonicalNumericOperator(engine, name, xs) ??
      engine._fn(name, ops, { canonical: true, scope })
    );
  });
}
