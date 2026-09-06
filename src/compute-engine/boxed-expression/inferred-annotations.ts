import type { Expression } from '../global-types.js';
import { isFunction } from './type-guards.js';

/**
 * The `["Typed", param, type]` parameter nodes that per-application
 * element-type INFERENCE wrote (`annotateFunctionLiteralParams`, `function-utils.ts`), as opposed
 * to the ones the author wrote. Inside the engine the two are the same: the
 * body scope declares the parameter with the type, every type-reading gate
 * sees it, and a call checks the argument against it. Outside the engine they
 * are not: an annotation marks a contract the author CHOSE, so an inferred
 * one is left out of the MathJSON and the LaTeX of the literal
 * (`BoxedFunction.json`, `serialize.ts`), and the printed form of `Filter(C, Z ↦ …)` is the
 * same whether or not `C` is bound.
 *
 * The mark is keyed on the TYPE OPERAND — the string node inference creates
 * for the type — not on the `Typed` node: a parameter node is rebuilt at
 * several places (`normalizeTypedParameter`, the `Typed` canonical handler in
 * `library/core.ts`, the binding rewrite of `bindParameterOperands`, partial
 * application), and every one of them passes the type operand through by
 * reference, so the mark survives without each site knowing about it. This
 * rests on two facts: `ce.string()` returns a fresh node on every call (no
 * interning, so marking one string never marks another of the same text),
 * and a site that normalizes an already-string type operand returns that
 * same node rather than a copy (`normalizeTypeOperand`, and the `Typed`
 * canonical handler). A `WeakSet`: a node that is no longer reachable takes
 * its mark with it.
 */
const INFERRED_TYPE_OPERANDS = new WeakSet<Expression>();

/** Record that inference, not the author, wrote the annotation whose type
 * operand is `typeOperand`. */
export function markInferredTypeOperand(typeOperand: Expression): void {
  INFERRED_TYPE_OPERANDS.add(typeOperand);
}

/** Did inference, rather than the author, write the annotation `node`
 * (a `["Typed", param, type]` parameter node)? */
export function isInferredTypedParameter(node: Expression): boolean {
  return isFunction(node, 'Typed') && INFERRED_TYPE_OPERANDS.has(node.op2);
}
