/**
 * Purity that follows what an expression reads.
 *
 * `isPure` of an expression looks at the expression only: a symbol is pure
 * also when its stored value is an unevaluated impure call (`r` holds
 * `Random()`), and a call of a sequence is pure also when the recurrence of
 * the sequence draws a random number. An evaluation of such an expression
 * can give another value each time. `isTransitivelyPure()` also reads:
 *
 * - the value of each symbol: the value that an evaluation reads now
 *   (through the scope chain, so also the argument of a call frame), and
 *   the value that its definition holds,
 * - the body of each function that has a lambda definition, and the stored
 *   function value of a call such as `h(x)` for `h := z ↦ 2z`,
 * - the expressions that a `subscriptEvaluate` handler evaluates, when the
 *   module that made the handler registered them
 *   (`setSubscriptEvaluateReads()`). A sequence `a_n := …` registers its
 *   recurrence, its base values and its constraints.
 *
 * A `subscriptEvaluate` handler that registered nothing is taken as pure,
 * as the `evaluate` handler of a library function is: its effects are not
 * known here.
 *
 * The values are read, never evaluated. This module imports only the type
 * guards, so that a low-level module (for example `constraint-subject.ts`)
 * can use it without an import cycle.
 */
import type { Expression } from '../global-types.js';
import { isFunction, isSymbol } from './type-guards.js';

/** For a `subscriptEvaluate` handler, a function that returns the
 *  expressions that the handler evaluates. */
const SUBSCRIPT_EVALUATE_READS = new WeakMap<
  object,
  () => readonly (Expression | null | undefined)[]
>();

/**
 * Record the expressions that the `subscriptEvaluate` handler `handler`
 * evaluates, for `isTransitivelyPure()`. `reads` is called each time a
 * symbol with this handler is checked: it returns the expressions as they
 * are at that time (a recurrence can be parsed after the handler is made).
 * A `null` or `undefined` item is ignored.
 */
export function setSubscriptEvaluateReads(
  handler: object,
  reads: () => readonly (Expression | null | undefined)[]
): void {
  SUBSCRIPT_EVALUATE_READS.set(handler, reads);
}

/**
 * The expressions that the `subscriptEvaluate` handler `handler` evaluates,
 * as they are now, or `undefined` when no module registered them
 * (`setSubscriptEvaluateReads()`). A `null` or `undefined` item is to be
 * ignored. The dependency snapshot of a memo
 * (`snapshotMemoDeps()` in `collection-element-memo.ts`) follows them, so
 * that a memo of `k ↦ B_k` is outdated when the recurrence of `B` reads a
 * symbol whose value changed.
 */
export function subscriptEvaluateReads(
  handler: object
): readonly (Expression | null | undefined)[] | undefined {
  return SUBSCRIPT_EVALUATE_READS.get(handler)?.();
}

/**
 * True when an evaluation of `expr` cannot run a side effect and cannot
 * give another value at a second evaluation: `expr` is pure (`isPure`), and
 * so is each expression that it reads, followed to any depth (see the
 * description of this module).
 *
 * Each definition and each expression is read one time only, so a cycle
 * (a recursive function, a sequence whose recurrence reads the sequence,
 * two symbols whose values read each other) stops. `visited` holds the
 * definitions and the expressions that were read: pass the same set to
 * check several expressions as one.
 *
 * The arithmetic of `.N()` calls this function for each symbol operand, so
 * a number and a symbol that has no value, no handler and no function body
 * are answered with no walk. A store-backed list (`ce.list()`) holds
 * numbers only: its elements are not read, because a read of its `ops`
 * makes an expression for each element.
 */
export function isTransitivelyPure(
  expr: Expression,
  visited?: Set<unknown>
): boolean {
  if (!isFunction(expr)) {
    if (!isSymbol(expr)) return expr.isPure === true;
    if (visited === undefined) {
      const def = expr.valueDefinition;
      if (
        def === undefined
          ? expr.operatorDefinition?.lambda === undefined
          : def.value === undefined &&
            def.subscriptEvaluate === undefined &&
            expr.value === undefined
      )
        return expr.isPure === true;
    }
  }
  const seen = visited ?? new Set<unknown>();
  const stack: Expression[] = [expr];
  const push = (e: Expression | null | undefined): void => {
    if (e !== undefined && e !== null && !seen.has(e)) stack.push(e);
  };
  while (stack.length > 0) {
    const e = stack.pop()!;
    if (seen.has(e)) continue;
    seen.add(e);
    if (e.isPure !== true) return false;
    // A value that is not canonical (`ce.declare('u', {value: …})` with a
    // raw value) is not bound: its symbols have no definition. An
    // evaluation reads its canonical form, so that form is checked.
    if ((isSymbol(e) || isFunction(e)) && !e.isCanonical && !e.isStructural) {
      push(e.canonical);
      continue;
    }

    // The definition that a symbol or a call is bound to. A call whose
    // operator is a symbol with a value (`h(x)`) is bound to the value
    // definition of that symbol.
    const valueDef =
      isSymbol(e) || isFunction(e) ? e.valueDefinition : undefined;
    // The value that an evaluation of the symbol reads now. It is not
    // always the value of the definition: in a call frame, a parameter
    // reads the argument of the call.
    if (valueDef !== undefined && isSymbol(e)) push(e.value);
    if (valueDef !== undefined && !seen.has(valueDef)) {
      seen.add(valueDef);
      push(valueDef.value);
      const handler = valueDef.subscriptEvaluate;
      if (handler !== undefined) {
        const reads = SUBSCRIPT_EVALUATE_READS.get(handler);
        if (reads !== undefined) for (const r of reads()) push(r);
      }
    }
    const operatorDef =
      isSymbol(e) || isFunction(e) ? e.operatorDefinition : undefined;
    if (operatorDef !== undefined && !seen.has(operatorDef)) {
      seen.add(operatorDef);
      push(operatorDef.lambda?.body);
    }

    // A store-backed list (`ce.list()`) holds numbers only, which are pure,
    // and a read of its `ops` makes an expression for each element.
    if (isFunction(e) && e._numericStore === undefined)
      for (const op of e.ops) push(op);
  }
  return true;
}
