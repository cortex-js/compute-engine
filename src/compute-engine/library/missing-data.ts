import type {
  Expression,
  IComputeEngine as ComputeEngine,
} from '../global-types.js';

import { isAbsentValue } from '../boxed-expression/type-guards.js';

/**
 * The absent-datum / empty-input gate shared by the 15 data-consuming
 * aggregates (`Mean`, `Variance`, …, `Max`, `Min`, `Mode`) — §3.C of the
 * missing-value typing design
 * (`docs/plans/2026-07-22-missing-value-typing-design.md`, revision 6).
 *
 * A data-consuming aggregate over data that contains an ABSENT datum — a
 * `Missing` symbol or a `NaN` number, whether a direct scalar operand or an
 * element flattened from a finite collection operand — is itself absent. So is
 * an aggregate over EMPTY input (no data at all). In a numeric result cell,
 * absence is normalized to `NaN` (I6 absorption): there is no `| missing` arm,
 * so the gate returns `NaN`, never the `Missing` symbol.
 *
 * Returns `ce.NaN` when the gate fires (absent datum or empty input),
 * otherwise `undefined` (the handler proceeds with its ordinary computation).
 *
 * A NON-finite collection operand (a symbolic-length range, an
 * enumeration-declined source) is UNDECIDABLE here: the gate returns
 * `undefined` so the operator's own handler decides (it typically stays
 * symbolic). Only a genuinely finite, fully-flattened input is judged empty.
 */
export function aggregateAbsence(
  ce: ComputeEngine,
  ops: ReadonlyArray<Expression>
): Expression | undefined {
  let sawData = false;
  let undecidable = false;
  for (const op of ops) {
    if (op.isCollection) {
      if (op.isFiniteCollection !== true) {
        // Can't flatten a non-finite collection: don't force `NaN`, but do not
        // claim the input is empty either.
        undecidable = true;
        continue;
      }
      for (const el of op.each()) {
        sawData = true;
        if (isAbsentValue(el)) return ce.NaN;
      }
    } else {
      sawData = true;
      if (isAbsentValue(op)) return ce.NaN;
    }
  }
  // Empty input ⇒ NaN — but only when every operand was decidably finite (an
  // undecidable operand may yet contribute data the handler can reach).
  if (!sawData && !undecidable) return ce.NaN;
  return undefined;
}
