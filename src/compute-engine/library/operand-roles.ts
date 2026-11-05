import type { Expression, OperandRole } from '../global-types.js';

// The operand roles that the library operators declare with their `operands`
// handler. A role says how an operand is canonicalized and whether it is
// evaluated before the `evaluate` handler (`OperandRole`,
// `types-definitions.ts`).

/** An operand that is canonicalized and evaluated as a value. */
export const VALUE_ROLE: OperandRole = Object.freeze({ kind: 'value' });

/** An operand that the operator runs as a statement (a branch, a body). */
export const STATEMENT_ROLE: OperandRole = Object.freeze({
  kind: 'statement',
});

/** An operand of a lazy operator that is kept as written. */
export const RAW_ROLE: OperandRole = Object.freeze({ kind: 'raw' });

/** An operand of a lazy operator that is kept as written, and where an
 * assignment is valid (`Hold`, `Error`). */
export const OPAQUE_ROLE: OperandRole = Object.freeze({ kind: 'opaque' });

/** An `operands` handler that gives every operand the role `role`. */
export function everyOperand(
  role: OperandRole
): (ops: ReadonlyArray<Expression>) => ReadonlyArray<OperandRole> {
  return (ops) => ops.map(() => role);
}

/** An operand that is a bound variable of the operator: a symbol that the
 * operator declares in its own scope (the variable of `D`). */
export const BOUND_ROLE: OperandRole = Object.freeze({ kind: 'bound' });

/** An operand that is an indexing set (`Limits`, `Element`, a tuple, or a
 * symbol) whose index is a bound variable of the operator. */
export const CLAUSE_ROLE: OperandRole = Object.freeze({ kind: 'clause' });

/** An indexing set whose index, in a range-shaped clause, is an integer (the
 * clauses of `Sum` and `Product`). */
export const INTEGER_CLAUSE_ROLE: OperandRole = Object.freeze({
  kind: 'clause',
  type: 'integer',
});

/** An `operands` handler that gives operand `i` the role `first[i]`, and
 * each operand after them the role `rest`. */
export function operandRolesFrom(
  first: ReadonlyArray<OperandRole>,
  rest: OperandRole
): (ops: ReadonlyArray<Expression>) => ReadonlyArray<OperandRole> {
  return (ops) => ops.map((_, i) => first[i] ?? rest);
}
