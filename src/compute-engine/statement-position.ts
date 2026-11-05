import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from './global-types.js';
import { enterBranch, exitBranch } from './assignment-locals.js';
import { isSymbol } from './boxed-expression/type-guards.js';

// The canonical forms of a statement operand. A statement operand is an
// operand that the operator's definition declares with the `statement` role
// (the `operands` handler): a statement of a `Block`, a branch of an `If`,
// the body of a `Loop`. This module imports only `assignment-locals.ts` and
// the type guards, so that the boxing code (`box.ts`), which canonicalizes
// the statement operands of an operator without a `canonical` handler, and
// the handlers of the control structures can both import it.

/**
 * The canonical form of `op`, a branch of an `If` or a `Which`, the body of
 * a loop, or another statement operand that the operator runs zero, one or
 * several times. A first assignment of a name in it is a static error
 * (`enterBranch()`, `assignment-locals.ts`). With `statement` false, `op` is
 * a value position (a value of a `Which`), where a bare `Break` is not
 * refused.
 */
export function canonicalBranch(
  ce: ComputeEngine,
  op: Expression,
  statement = true
): Expression {
  enterBranch();
  try {
    return statement ? canonicalStatement(ce, op) : op.canonical;
  } finally {
    exitBranch();
  }
}

/**
 * Canonicalize an expression in **statement position** (a `Block` operand, an
 * `If` branch, or a `Loop` body). A bare *symbol* `Break`/`Continue` (as
 * opposed to the function forms `Break()`/`Continue()`) is almost certainly a
 * mistake: the control-flow dispatch in `evaluateStatements`/`runLoop` only
 * recognizes the function form, so a bare symbol would silently canonicalize
 * to an ordinary variable reference. Flag it as an error instead. Bare
 * `Return` is intentionally left alone.
 */
export function canonicalStatement(
  ce: ComputeEngine,
  op: Expression
): Expression {
  if (isSymbol(op) && (op.symbol === 'Break' || op.symbol === 'Continue'))
    return ce.error(
      `\`${op.symbol}\` must be written as a function: \`${op.symbol}()\``,
      op.symbol
    );
  return op.canonical;
}
