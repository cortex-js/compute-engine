import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isFunction, isSymbol } from './type-guards.js';

/**
 * Producer-side chokepoint for a conditional value (conditional-values design,
 * decision 7). Resolves a *decidable* guard against evaluation + the assumption
 * store:
 *   - guard evaluates to `True`  → the bare `value` (guard discharged);
 *   - guard evaluates to `False` → `null` (the caller prunes / declines — the
 *     solution-set pruning contract, decision 8);
 *   - otherwise (undecidable)    → `When(value, guard)`, retained until the
 *     guard becomes decidable.
 *
 * A single chokepoint enforces "emit `When` only when genuinely undecidable" in
 * one place. Every `When`-producer (Solve validity conditions, Sum/Integrate
 * convergence conditions) routes through here, so decidable guards keep the
 * pre-conditional behavior exactly.
 */
export function conditionalValue(
  ce: ComputeEngine,
  value: Expression,
  guard: Expression
): Expression | null {
  const g = guard.evaluate();
  if (isSymbol(g, 'True')) return value;
  if (isSymbol(g, 'False')) return null;
  return ce.function('When', [value, g]);
}

/**
 * Read a restriction: `When(value, condition)`, or a single-branch
 * `If(condition, value)`, which is the form the parser gives a restriction
 * `value\{condition\}`. Both have the same value: `value` where `condition`
 * holds, and the absent value of the domain of `value` (`NaN` for a number,
 * `Missing` otherwise) where it does not. Return `undefined` for any other
 * expression: an `If` with an else branch, and a single-branch `If` whose
 * arm is a statement (`isStatementArm()`), which is a guard statement with
 * no value.
 *
 * Every site that reads a restriction calls this function, so that the two
 * spellings give the same result.
 */
export function restrictionParts(
  expr: Expression | null | undefined
): { value: Expression; condition: Expression } | undefined {
  if (!isFunction(expr) || expr.nops !== 2) return undefined;
  if (expr.operator === 'When') return { value: expr.op1, condition: expr.op2 };
  if (expr.operator === 'If' && !isStatementArm(expr.op2))
    return { value: expr.op2, condition: expr.op1 };
  return undefined;
}

/** True if `expr` is a restriction, `When(value, condition)` or a
 * single-branch `If(condition, value)` (see `restrictionParts()`). */
export function isRestriction(expr: Expression | null | undefined): boolean {
  return restrictionParts(expr) !== undefined;
}

/** The operators whose value is never absent although an operand can be:
 * `AssertPresent` raises an error on an absent operand, and `IsMissing` gives
 * a boolean. `Coalesce` is not one of them: its value is absent when every
 * operand is absent. */
const DISCHARGES = new Set(['AssertPresent', 'IsMissing']);

/** The collection constructors. The value of a constructor is the collection
 * itself, which is present even when an element is absent. An accessor over a
 * constructor (`First([If(c, 1), 2])`) can give the absent element, so this
 * applies only to a constructor that is the whole value being tested. */
const CONSTRUCTORS = new Set([
  'List',
  'Tuple',
  'Set',
  'Dictionary',
  'KeyValuePair',
]);

/**
 * True if `expr`, or one of its sub-expressions, is a restriction
 * (`isRestriction()`). A restriction is typed as its value, so its type does
 * not show that it is absent where its condition fails, and an expression
 * that contains one (`If(c, If(d, True), False)`, `Add(When(P, c), Q)`) can
 * be absent although its type admits no absent value. A presence proof that
 * reads the type must call this function first.
 *
 * The walk does not enter the operand of `AssertPresent` or `IsMissing`,
 * whose value is never absent, or the body of a function literal, which is
 * not evaluated where it is written. When `expr` itself is a collection
 * constructor (`List`, `Tuple`, `Set`, `Dictionary`, `KeyValuePair`), the
 * answer is false, because the collection is present even when an element is
 * absent. Below the root, the walk enters a constructor like any other
 * operator, because an accessor (`First`, `At`) can give its absent element.
 * The walk enters every operand of a `Coalesce`, whose value is absent when
 * every operand is absent, and every other operator (`Add(When(P, c), Q)`).
 * The answer is conservative: it is true for some expressions that are
 * present. This is sound, because an extra presence check or default fill
 * acts only on an absent value.
 */
export function mayHoldRestriction(
  expr: Expression | null | undefined
): boolean {
  if (isFunction(expr) && CONSTRUCTORS.has(expr.operator)) return false;
  return holdsRestriction(expr);
}

/** The walk of `mayHoldRestriction()` below the root, where a collection
 * constructor is entered like any other operator. */
function holdsRestriction(expr: Expression | null | undefined): boolean {
  if (!isFunction(expr)) return false;
  if (isRestriction(expr)) return true;
  const h = expr.operator;
  if (h === 'Function' || DISCHARGES.has(h)) return false;
  return expr.ops.some((x) => holdsRestriction(x));
}

/**
 * Whether an `If` arm is a STATEMENT — an assignment, a loop, a
 * declaration or a jump — rather than an expression with a value. Such an
 * arm has no expression form, so the two-operand `If` around it is a guard
 * statement, never the value-form selection that compiles as a one-clause
 * `Which`.
 *
 * A `Block` is read through to its VALUE statement, its last operand (the
 * same reading `statementBodyHead` gives it): `Block(y ≔ x, y)` is a value
 * arm, `Block(y ≔ x)` and an empty block are statements. A `Loop` is a
 * statement here even though `Break(v)` can give it a value: the
 * conditional-expression lowering has no form for a loop inside a ternary.
 */
export function isStatementArm(arm: Expression | undefined): boolean {
  if (arm === undefined || !isFunction(arm)) return false;
  const h = arm.operator;
  if (h === 'Block') {
    if (arm.nops === 0) return true;
    return isStatementArm(arm.ops[arm.nops - 1]);
  }
  return (
    h === 'Assign' ||
    h === 'Loop' ||
    h === 'Declare' ||
    h === 'Return' ||
    h === 'Break' ||
    h === 'Continue'
  );
}
