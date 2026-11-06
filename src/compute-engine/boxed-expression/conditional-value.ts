import type {
  Expression,
  IComputeEngine as ComputeEngine,
  OperandDescriptor,
} from '../global-types.js';

import { parseType } from '../../common/type/parse.js';
import { COLLECTION_SHAPE_TYPE } from '../../common/type/primitive.js';
import { isSubtype } from '../../common/type/subtype.js';
import { collectionElementType } from '../../common/type/utils.js';
import { isFunction, isSymbol } from './type-guards.js';

/** The type of a condition that selects element-wise: an ordered
 * collection of booleans, which is a flat list of booleans. */
export const FLAT_MASK_TYPE = parseType('indexed_collection<boolean>')!;

/**
 * True when the static type of the condition `cond` says that it is a flat
 * list of booleans (`FLAT_MASK_TYPE`), so that the selection is element-wise.
 * A condition of type `list<never>` (the empty list) is not one: it has no
 * cell to select.
 */
export function isListCondition(cond: Expression | undefined): boolean {
  if (cond === undefined || !cond.isValid) return false;
  const t = cond.type.type;
  return (
    t !== 'never' &&
    isSubtype(t, FLAT_MASK_TYPE) &&
    collectionElementType(t) !== 'never'
  );
}

/** True when `x` is a `Which` that has a list of conditions
 * (`isListCondition()`), so that it selects at each position and its value is
 * a list. */
export function isElementwiseWhich(x: Expression): boolean {
  return (
    isFunction(x, 'Which') &&
    x.ops.some((c, i) => i % 2 === 0 && isListCondition(c))
  );
}

/**
 * The comparison operators and the connectives. Each one is two-valued: it
 * answers `True` or `False`, also when an operand or a cell is absent (an
 * absent value reads as `False` in a connective and makes a comparison
 * `False`; user decision 2026-11-02, two-valued comparisons,
 * `docs/ERROR-MODEL.md`). So the type of such a result has no `missing` arm,
 * in its cells or as a whole.
 */
export const TWO_VALUED_OPERATORS: ReadonlySet<string> = new Set([
  'Less',
  'LessEqual',
  'Greater',
  'GreaterEqual',
  'Equal',
  'NotEqual',
  'And',
  'Or',
  'Not',
  'Xor',
  'Equivalent',
  'Implies',
  'Nand',
  'Nor',
]);

/** The coordinate accessors. Over a list of points they map cell by cell:
 * a point that is absent gives an absent cell, and the list stays. */
const COORDINATE_READS = new Set(['PointX', 'PointY', 'PointZ']);

/**
 * True when `expr`, a list condition or an arm of a selection, can be absent
 * as a whole although its type does not show it. The answer is
 * conservative: it is true for some values that are always present, which
 * keeps the scalar arm of a comparison type that did not need it.
 *
 * - A single-branch `If` or a `Which` can be absent as a whole, unless it
 *   selects element-wise (`selectsElementWise()`).
 * - A coordinate accessor (`PointX`, `PointY`, `PointZ`) maps a list of
 *   points cell by cell, so it is absent as a whole only when its operand
 *   is. Another read (`At`, `First`, `Field`, …) can read one element that
 *   is a list and does not exist, so it can be absent as a whole: with `LL`
 *   a list of one row, `At(LL, 5)` is `Missing`.
 * - A collection constructor is present (an element may be absent), and so
 *   are a discharge (`AssertPresent`, `IsMissing`) and a function literal.
 * - A comparison or a connective (`TWO_VALUED_OPERATORS`) is the scalar
 *   `False` (`True` for a negation) when an operand is absent as a whole.
 *   Its type has a `boolean` arm for an operand that is a collection-typed
 *   `If` restriction or `Which` (the broadcast typing of `boxed-function.ts`
 *   adds it), which the type test of a list condition (`isListCondition()`)
 *   refuses. For every other operand, its type does not show the absence,
 *   and the operand is walked: `At(LL, 5) < 3` is typed `list<boolean>` but
 *   is `False`.
 * - A symbol with a value is walked through that value: a mask stored as
 *   `m := If(c, [True, False])` is `Missing` when `c` becomes false.
 * - A call of a user function, an `Apply`, or an operator with no
 *   definition can be absent as a whole whatever its operands are: with
 *   `f(t) = If(t, [True, False])`, `f(c)` is `Missing` when `c` is false.
 * - Any other operator, a library operator, over an operand that is absent
 *   as a whole is absent as a whole: `Not(If(c, M))` is `Missing` when `c`
 *   is false.
 *
 * `seen` holds the symbols already walked. A symbol met again can be
 * absent: `a := If(b, M)` and `b := If(a, M)` refer to each other, and the
 * walk stops there.
 */
function mayBeAbsentAsWhole(
  expr: Expression | undefined,
  seen: Set<string>
): boolean {
  if (expr === undefined) return false;
  if (isSymbol(expr)) {
    if (seen.has(expr.symbol)) return true;
    const value = expr.value;
    if (value === undefined || value === expr) return false;
    seen.add(expr.symbol);
    return mayBeAbsentAsWhole(value, seen);
  }
  if (!isFunction(expr)) return false;
  const h = expr.operator;
  if (isRestriction(expr) || h === 'Which')
    return !selectsElementWiseIn(expr, seen);
  if (COORDINATE_READS.has(h)) return mayBeAbsentAsWhole(expr.ops[0], seen);
  if (ABSENT_READS.has(h)) return true;
  if (CONSTRUCTORS.has(h) || DISCHARGES.has(h) || h === 'Function')
    return false;
  if (TWO_VALUED_OPERATORS.has(h))
    return expr.ops.some(
      (x) =>
        !(
          (isRestriction(x) || isFunction(x, 'Which')) &&
          isSubtype(x.type.type, COLLECTION_SHAPE_TYPE)
        ) && mayBeAbsentAsWhole(x, seen)
    );
  const def = expr.operatorDefinition;
  if (def === undefined || def.isUserFunctionDefinition || h === 'Apply')
    return true;
  return expr.ops.some((x) => mayBeAbsentAsWhole(x, seen));
}

/**
 * True when `expr` is an `If` or a `Which` that selects element-wise and
 * cannot be absent as a whole. Its value is then a list of the length of a
 * list condition (`isListCondition()`), with a `NaN` cell (or a `NaN`
 * point) where no condition holds.
 *
 * - `If(c, e)`: `c` is a list condition that cannot be absent as a whole.
 *   An absent condition reads as `False`, and the `If` is then absent as a
 *   whole: with `c` false, `If(If(c, m), L)` is `Missing`, although the type
 *   of `If(c, m)` is the list type of `m`.
 * - `Which(c_1, e_1, c_2, e_2, …)`: the conditions are tried in order, and
 *   the first list condition selects element-wise. That condition must not
 *   be absent as a whole, and no arm before it either: an earlier scalar
 *   condition that is true gives its arm whole, so with `t` true
 *   `Which(t, If(d, L), m, L)` is `Missing` when `d` is false. An earlier
 *   condition that is absent reads as `False`, and is no risk.
 *
 * A selection with scalar conditions only is absent as a whole when no
 * condition holds: `If(c, L)` is `Missing` when the boolean `c` is false.
 */
export function selectsElementWise(expr: Expression): boolean {
  return selectsElementWiseIn(expr, new Set());
}

/** `selectsElementWise()`, with the symbols already walked by
 * `mayBeAbsentAsWhole()` in `seen`. */
function selectsElementWiseIn(expr: Expression, seen: Set<string>): boolean {
  if (isFunction(expr, 'If')) {
    const c = expr.ops[0];
    return isListCondition(c) && !mayBeAbsentAsWhole(c, seen);
  }
  if (!isFunction(expr, 'Which')) return false;
  for (let i = 0; i < expr.nops; i += 2) {
    const c = expr.ops[i];
    if (isListCondition(c)) return !mayBeAbsentAsWhole(c, seen);
    if (mayBeAbsentAsWhole(expr.ops[i + 1], seen)) return false;
  }
  return false;
}

/**
 * Producer-side chokepoint for a conditional value (conditional-values design,
 * decision 7). Resolves a *decidable* guard against evaluation + the assumption
 * store:
 *   - guard evaluates to `True`  → the bare `value` (guard discharged);
 *   - guard evaluates to `False` → `null` (the caller prunes / declines — the
 *     solution-set pruning contract, decision 8);
 *   - otherwise (undecidable)    → `If(guard, value)`, retained until the
 *     guard becomes decidable.
 *
 * A single chokepoint enforces "emit a restriction only when genuinely
 * undecidable" in one place. Every producer of a restriction (Solve validity conditions, Sum/Integrate
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
  return ce.function('If', [g, value]);
}

/**
 * Read a restriction: a single-branch `If(condition, value)`, which is the
 * form the parser gives a restriction `value\{condition\}`. Its value is
 * `value` where `condition` holds, and the absent value of the domain of `value` (`NaN` for a number,
 * `Missing` otherwise) where it does not. Return `undefined` for any other
 * expression: an `If` with an else branch, and a single-branch `If` whose
 * arm is a statement (`isStatementArm()`), which is a guard statement with
 * no value.
 *
 * Every site that reads a restriction calls this function, so that each
 * site excludes the same statement arms.
 */
export function restrictionParts(
  expr: Expression | null | undefined
): { value: Expression; condition: Expression } | undefined {
  if (!isFunction(expr) || expr.nops !== 2) return undefined;
  if (expr.operator === 'If' && !isStatementArm(expr.op2))
    return { value: expr.op2, condition: expr.op1 };
  return undefined;
}

/** True if `expr` is a restriction, a single-branch `If(condition, value)`
 * whose arm is a value (see `restrictionParts()`). */
export function isRestriction(expr: Expression | null | undefined): boolean {
  return restrictionParts(expr) !== undefined;
}

/** The operators whose value is never absent although an operand can be:
 * `AssertPresent` raises an error on an absent operand, and `IsMissing` gives
 * a boolean. `Coalesce` is not one of them: its value is absent when every
 * operand is absent. */
const DISCHARGES = new Set(['AssertPresent', 'IsMissing']);

/** The accessors whose value is the absence marker of the element domain
 * (`NaN`, a point of `NaN` coordinates, or `Missing`) where the position
 * they read does not exist, and whose result type does not show it. */
export const ABSENT_READS: ReadonlySet<string> = new Set([
  'At',
  'First',
  'Second',
  'Third',
  'Last',
  'Field',
  'PointX',
  'PointY',
  'PointZ',
]);

/** The collection constructors. The value of a constructor is the collection
 * itself, which is present even when an element is absent. An accessor over a
 * constructor (`First([If(c, 1), 2])`) can give the absent element, so this
 * applies only to a constructor that is the whole value being tested. `Tuple`
 * is not one of them: a tuple of numbers is a point, and a point whose
 * coordinates are all `NaN` is absent (`(At(xs, j), At(xs, j))` with `j`
 * out of range). */
const CONSTRUCTORS = new Set(['List', 'Set', 'Dictionary', 'KeyValuePair']);

/**
 * True if `expr`, or one of its sub-expressions, is a restriction
 * (`isRestriction()`), a `Which`, or a read at a position that may not
 * exist (`ABSENT_READS`: `At(xs, i)`, `First(xs)`, `PointZ(p)`, …). Each
 * of them is typed as its present value: a restriction as its arm, and a
 * read as the element it reads, since the absence marker is implicit in a
 * result type (`At` is `(indexed_collection<T>, integer+) -> T`). So its
 * type does not show that it is absent where its condition fails or where
 * its position does not exist, and an expression that contains one
 * (`If(c, If(d, True), False)`, `Add(If(c, P), Q)`, `Add(At(xs, i), 1)`)
 * can be absent although its type admits no absent value. A presence proof
 * that reads the type must call this function first. The name tells the
 * first of these cases only.
 *
 * The walk does not enter the operand of `AssertPresent` or `IsMissing`,
 * whose value is never absent, or the body of a function literal, which is
 * not evaluated where it is written. When `expr` itself is a collection
 * constructor (`List`, `Set`, `Dictionary`, `KeyValuePair`), the answer is
 * false, because the collection is present even when an element is absent. A
 * `Tuple` is walked: a tuple of absent numbers is a `NaN` point, which the
 * readers read as absent. Below the root, the walk enters a constructor like any other
 * operator, because an accessor (`First`, `At`) can give its absent element.
 * The walk enters every operand of a `Coalesce`, whose value is absent when
 * every operand is absent, and every other operator (`Add(If(c, P), Q)`).
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

/**
 * `mayHoldRestriction()` for an operand that a `type` handler sees as a
 * descriptor, with no expression: true when the structural view of the
 * operand (`structureOf()`) is, or holds, a single-branch `If`, a `Which`
 * or a read of `ABSENT_READS`. A handler that proves a value from the type
 * of the operand calls it first: `At(xs, i)` with `xs: list<integer<1..10>>`
 * is typed `integer<1..10>`, but it is `NaN` when `i` is out of range, so
 * `At(xs, i) > 0` is not always `True`. The walk does not enter the operand
 * of `AssertPresent` or `IsMissing`, or the body of a function literal. As
 * in `mayHoldRestriction()`, a collection constructor that is the whole
 * operand gives false, and one below it is entered. An operand with no
 * structural view is not walked, and gives false.
 */
export function descriptorMayHoldRestriction(d: OperandDescriptor): boolean {
  const s = d.structureOf?.();
  if (s?.kind === 'application' && CONSTRUCTORS.has(s.head)) return false;
  return descriptorHoldsRestriction(d);
}

/** The walk of `descriptorMayHoldRestriction()` below the root, where a
 * collection constructor is entered like any other operator. */
function descriptorHoldsRestriction(d: OperandDescriptor): boolean {
  const s = d.structureOf?.();
  if (s?.kind !== 'application') return false;
  const h = s.head;
  if ((h === 'If' && s.children.length === 2) || h === 'Which') return true;
  if (ABSENT_READS.has(h)) return true;
  if (h === 'Function' || DISCHARGES.has(h)) return false;
  return s.children.some((x) => descriptorHoldsRestriction(x));
}

/** The walk of `mayHoldRestriction()` below the root, where a collection
 * constructor is entered like any other operator. */
function holdsRestriction(expr: Expression | null | undefined): boolean {
  if (!isFunction(expr)) return false;
  if (isRestriction(expr)) return true;
  const h = expr.operator;
  if (h === 'Which' || ABSENT_READS.has(h)) return true;
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
