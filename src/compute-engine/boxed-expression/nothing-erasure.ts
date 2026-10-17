import type { Expression, OperandDescriptor } from '../global-types.js';
import { isFunction } from './type-guards.js';

/**
 * Whether the expression `expr`, an element of a `List` or `Tuple` literal,
 * may evaluate to `Nothing`. A list or a tuple erases such an element:
 * `[If(c, "a", Nothing)]` is `[]` when `c` is false. The number of
 * operands of the literal then does not prove the length of its value. The
 * type of `expr` cannot tell: `nothing` is the bottom type, so the type of
 * `If(c, "a", Nothing)` is `string`.
 *
 * Recognized: an element typed `nothing`, and an `If` or a `Which` with a
 * branch that may evaluate to `Nothing`. A call of a function whose body
 * returns `Nothing` on some branch is not recognized.
 *
 * {@link mayEvaluateToNothingD} applies the same rule to an operand
 * descriptor.
 */
export function mayEvaluateToNothing(expr: Expression): boolean {
  if (expr.type.type === 'nothing') return true;
  if (!isFunction(expr)) return false;
  if (expr.operator !== 'If' && expr.operator !== 'Which') return false;
  return expr.ops.some(mayEvaluateToNothing);
}

/** The rule of {@link mayEvaluateToNothing}, read from an operand
 * descriptor (the operand of a type handler). */
export function mayEvaluateToNothingD(d: OperandDescriptor): boolean {
  if (d.type === 'nothing') return true;
  const s = d.structureOf?.();
  if (s?.kind !== 'application') return false;
  if (s.head !== 'If' && s.head !== 'Which') return false;
  return s.children.some(mayEvaluateToNothingD);
}

/**
 * Whether `xs` is a `List` or `Tuple` literal with an element that may
 * evaluate to `Nothing` ({@link mayEvaluateToNothing}).
 *
 * A broadcast walks the operands of a list literal and evaluates each one in
 * its own cell, so the list never erases an element that evaluates to
 * `Nothing`: with `c` false, `Sin([If(c, 1, Nothing), 2])` was
 * `[Sin(Nothing), Sin(2)]`. A broadcast evaluates such a list first, and
 * walks the elements of its value: `[Sin(2)]`.
 */
export function literalMayEraseElement(xs: Expression): boolean {
  if (!isFunction(xs, 'List') && !isFunction(xs, 'Tuple')) return false;
  // The scan reads the type of every element, and a collection handler asks
  // this question on every call: a loop of `at(1)` … `at(n)` over a literal
  // scanned n elements n times. The answer is kept per literal. The types of
  // the elements can change only with a semantic change of the engine (a
  // declaration, an assignment), so the answer is valid while the engine's
  // `_semanticVersion` is the same.
  const generation = xs.engine._semanticVersion;
  const memo = erasureMemo.get(xs);
  if (memo !== undefined && memo.generation === generation) return memo.value;
  const value = xs.ops.some(mayEvaluateToNothing);
  erasureMemo.set(xs, { generation, value });
  return value;
}

/** The answers of {@link literalMayEraseElement}, with the engine's
 * `_semanticVersion` at the time each answer was computed. */
const erasureMemo = new WeakMap<
  Expression,
  { generation: number; value: boolean }
>();
